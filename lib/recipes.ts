// lib/recipes.ts — moteur de coût des fiches recettes. Module PUR : les données
// (recette, ingrédients, prix mercuriale, taux horaire) viennent de l'appelant.
//
// Principe hérité du moteur hebdo : AUCUN coût figé. Depuis le passage aux
// ARTICLES GÉNÉRIQUES (28/07), chaque ligne d'ingrédient référence un générique
// de la mercuriale (prix ramené à l'unité de base kg ou pièce) ; la quantité se
// saisit en kg, g ou pièce, et un % de perte gonfle la quantité brute à acheter
// (brut = net ÷ (1 − perte)). Les lignes héritées (article_id / prix manuel)
// restent calculées comme avant. La main-d'œuvre lit le taux horaire chargé de
// l'EMPLOYÉ choisi sur la fiche (repli : taux moyen de l'équipe, CCN 992).

import { chargeMultiplier, productiveFactor, type PayrollEmployee } from '@/lib/payroll'
import { unitKind } from '@/lib/mercuriale-auto'

export type RecipeRow = {
  id: string
  name: string
  category: string | null
  yield_qty: number | null
  yield_unit: string | null
  labor_minutes: number
  selling_price_ttc: number | null
  tva_rate: number
  notes: string | null
  employee_id?: string | null
  /** jsonb : anciennes fiches = tableau de textes, nouvelles = { text, minutes } */
  fabrication_steps?: unknown
  /** jsonb : paliers de production [{ qty, mult }] — « pour 20, temps ×1,8 » */
  time_tiers?: unknown
}

/** Étape de fabrication : texte + durée en minutes (null = non chronométrée) */
export type FabricationStep = { text: string; minutes: number | null }

/** Palier de production : pour `qty` unités produites, le temps de base est
 *  multiplié par `mult` (saisi par le boucher : doubler ne double pas le temps). */
export type TimeTier = { qty: number; mult: number }

/** Lit fabrication_steps tel que stocké (jsonb) en tolérant les DEUX formats :
 *  tableau de chaînes (fiches d'avant les durées) et tableau { text, minutes }. */
export function parseStoredSteps(raw: unknown): FabricationStep[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((s): FabricationStep => {
      if (typeof s === 'string') return { text: s, minutes: null }
      const o = (s ?? {}) as Record<string, unknown>
      const m = Number(o.minutes)
      return { text: String(o.text ?? ''), minutes: Number.isFinite(m) && m > 0 ? m : null }
    })
    .filter(s => s.text.trim() !== '')
}

/** Lit time_tiers tel que stocké (jsonb), trié par quantité croissante. */
export function parseStoredTiers(raw: unknown): TimeTier[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((t): TimeTier | null => {
      const o = (t ?? {}) as Record<string, unknown>
      const qty = Number(o.qty)
      const mult = Number(o.mult)
      return Number.isFinite(qty) && qty > 0 && Number.isFinite(mult) && mult > 0 ? { qty, mult } : null
    })
    .filter((t): t is TimeTier => t !== null)
    .sort((a, b) => a.qty - b.qty)
}

/** Temps total du batch de base : la SOMME des durées d'étapes dès qu'au moins
 *  une étape est chronométrée, sinon le champ labor_minutes historique. C'est la
 *  seule définition du temps d'une fiche — coût MO et production la partagent. */
export function recipeTotalMinutes(recipe: Pick<RecipeRow, 'labor_minutes' | 'fabrication_steps'>): number {
  const timed = parseStoredSteps(recipe.fabrication_steps).filter(s => s.minutes !== null)
  if (timed.length > 0) return Math.round(timed.reduce((s, x) => s + (x.minutes as number), 0) * 10) / 10
  return Number(recipe.labor_minutes) || 0
}

export type IngredientRow = {
  id?: string
  generic_id: string | null
  article_id: string | null
  /** Sous-recette : la ligne vise une AUTRE fiche (quantité en unités de son rendement) */
  sub_recipe_id?: string | null
  label: string
  quantity: number
  unit: string | null              // héritage : unité libre des anciennes lignes
  qty_unit: string | null          // 'kg' | 'g' | 'piece' — lignes génériques
  loss_pct: number | null          // % de perte de la ligne (0-99)
  manual_price_ht: number | null   // repli de prix (par unité de base pour un générique)
  position?: number
}

/** Un article générique vu du moteur : prix du jour PAR UNITÉ DE BASE (déjà
 *  converti depuis la dernière réf facturée), null si aucune réf n'a de prix. */
export type GenericInfo = {
  id: string
  name: string
  base_unit: 'kg' | 'piece'
  category: 'ingredient' | 'emballage'
  default_loss_pct: number
  price_ht: number | null
}

export type IngredientCost = IngredientRow & {
  unit_price_ht: number | null   // prix retenu, par unité de base (générique), d'achat (hérité) ou de rendement (sous-recette)
  price_source: 'mercuriale' | 'manuel' | 'aucun' | 'sous_recette'
  categorie: 'ingredient' | 'emballage'
  /** Sous-recette au coût sous-évalué (elle-même a des prix manquants) */
  sub_incomplete?: boolean
  qty_base: number               // quantité NETTE convertie en unité de base (kg/pièce)
  qty_brute: number              // quantité BRUTE à sortir (net ÷ (1 − perte))
  line_total_ht: number          // qty_brute × prix (0 si aucun prix connu)
}

export type RecipeCost = {
  matiere_ht: number
  emballage_ht: number
  main_oeuvre_ht: number
  total_ht: number
  par_unite_ht: number | null    // total ÷ yield_qty
  prix_manquants: number         // lignes sans prix mercuriale ni manuel
  labor_rate_ht: number | null   // taux €/h chargé réellement utilisé
  total_minutes: number          // temps du batch : somme des étapes chronométrées, repli labor_minutes
  // Si un prix de vente est renseigné (TTC, PAR UNITÉ produite) :
  pv_unitaire_ht: number | null
  marge_pct: number | null       // (PV HT − coût/unité) / PV HT
  coefficient: number | null     // PV HT ÷ coût/unité — le « coef » du métier
}

const round2 = (n: number) => Math.round(n * 100) / 100
const round4 = (n: number) => Math.round(n * 10000) / 10000

/** Taux horaire chargé moyen de l'équipe (€/h) — même base que le planning :
 *  taux horaire × multiplicateur de charges patronales (CCN 992). Le gérant sans
 *  taux horaire renseigné est ignoré. null si aucun employé exploitable. */
export function averageLoadedRate(employees: PayrollEmployee[]): number | null {
  // Taux PRODUCTIF : chargé × 52/(52 − semaines non travaillées). Le coût d'une
  // heure de fabrication est celui d'une heure RÉELLEMENT travaillée — l'heure
  // payée (CP, fériés, RCR compris) sous-évaluait la MO des fiches d'~15-20 %.
  const rates = employees
    .map(e => {
      const h = Number((e as Record<string, unknown>).hourly_rate) || 0
      return h > 0 ? h * chargeMultiplier(e) * productiveFactor(e) : 0
    })
    .filter(r => r > 0)
  if (rates.length === 0) return null
  return round2(rates.reduce((a, b) => a + b, 0) / rates.length)
}

/** Taux horaire PRODUCTIF chargé d'UN employé (€/h de travail réel : chargé ×
 *  52/(52 − semaines non travaillées)), null si introuvable ou sans taux —
 *  l'appelant replie alors sur averageLoadedRate. */
export function employeeLoadedRate(employees: PayrollEmployee[], employeeId: string | null | undefined): number | null {
  if (!employeeId) return null
  const e = employees.find(x => (x as Record<string, unknown>).id === employeeId)
  if (!e) return null
  const h = Number((e as Record<string, unknown>).hourly_rate) || 0
  return h > 0 ? round2(h * chargeMultiplier(e) * productiveFactor(e)) : null
}

/** Quantité nette convertie vers l'unité de base du générique.
 *  g → kg (÷1000) ; kg → kg ; pièce → pièce. Une unité incohérente avec la base
 *  (validée en amont) est traitée telle quelle plutôt que de casser le calcul. */
function toBaseQty(quantity: number, qtyUnit: string | null, baseUnit: 'kg' | 'piece'): number {
  if (baseUnit === 'kg' && qtyUnit === 'g') return quantity / 1000
  return quantity
}

/** Coût détaillé des ingrédients.
 *  Ligne GÉNÉRIQUE : prix mercuriale par unité de base (PRIME sur le manuel),
 *  conversion g/kg/pièce, perte appliquée sur la quantité (coût sur le BRUT).
 *  Ligne HÉRITÉE (article_id / libre) : comportement historique inchangé. */
export function costIngredients(
  ingredients: IngredientRow[],
  priceByArticle: Map<string, number>,
  genericById?: Map<string, GenericInfo>,
  /** Résout le coût par unité d'une SOUS-RECETTE (cf. buildRecipeCostGraph).
   *  Sans résolveur, une ligne sous-recette garde ses quantités mais son prix
   *  est « manquant » — jamais un chiffre inventé. */
  subResolver?: (subRecipeId: string) => SubCostInfo | null,
): IngredientCost[] {
  return ingredients.map(ing => {
    const qty = Number(ing.quantity) || 0
    const loss = Math.min(99, Math.max(0, Number(ing.loss_pct) || 0))

    // Ligne SOUS-RECETTE : quantité en unités de rendement de la sous-fiche,
    // coût = son coût complet ÷ son rendement (relu, jamais stocké).
    if (ing.sub_recipe_id) {
      const info = subResolver ? subResolver(ing.sub_recipe_id) : null
      const price = info && info.per_unit !== null ? info.per_unit : null
      const qtyBrute = round4(qty / (1 - loss / 100))
      return {
        ...ing,
        unit_price_ht: price,
        price_source: (price !== null ? 'sous_recette' : 'aucun') as IngredientCost['price_source'],
        categorie: 'ingredient' as const,
        qty_base: qty,
        qty_brute: qtyBrute,
        line_total_ht: round2((price ?? 0) * qtyBrute),
        sub_incomplete: Boolean(info?.incomplete),
      }
    }

    const generic = ing.generic_id != null ? genericById?.get(ing.generic_id) ?? null : null

    if (generic) {
      const manual = ing.manual_price_ht != null && ing.manual_price_ht > 0 ? ing.manual_price_ht : null
      const price = generic.price_ht ?? manual
      const source: IngredientCost['price_source'] = generic.price_ht !== null ? 'mercuriale' : price !== null ? 'manuel' : 'aucun'
      const qtyBase = round4(toBaseQty(qty, ing.qty_unit, generic.base_unit))
      const qtyBrute = round4(qtyBase / (1 - loss / 100))
      return {
        ...ing,
        unit_price_ht: price,
        price_source: source,
        categorie: generic.category,
        qty_base: qtyBase,
        qty_brute: qtyBrute,
        line_total_ht: round2((price ?? 0) * qtyBrute),
      }
    }

    // Héritage : article de la mercuriale (prix par unité d'achat) ou saisie libre
    const mercuriale = ing.article_id != null ? priceByArticle.get(ing.article_id) ?? null : null
    const price = mercuriale ?? (ing.manual_price_ht != null && ing.manual_price_ht > 0 ? ing.manual_price_ht : null)
    const source: IngredientCost['price_source'] = mercuriale !== null ? 'mercuriale' : price !== null ? 'manuel' : 'aucun'
    const qtyBrute = round4(qty / (1 - loss / 100))
    return {
      ...ing,
      unit_price_ht: price,
      price_source: source,
      categorie: 'ingredient',
      qty_base: qty,
      qty_brute: qtyBrute,
      line_total_ht: round2((price ?? 0) * qtyBrute),
    }
  })
}

/** Coût complet d'une recette. laborRate en €/h chargé (celui de l'employé
 *  choisi, sinon le taux moyen) ; null = main-d'œuvre à 0 (le front signale
 *  alors qu'il manque des employés au planning). Matière et emballage sont
 *  séparés — les deux entrent dans le coût de revient. */
export function computeRecipeCost(
  recipe: RecipeRow,
  ingredients: IngredientCost[],
  laborRate: number | null,
): RecipeCost {
  const matiere = round2(ingredients.filter(i => i.categorie !== 'emballage').reduce((s, i) => s + i.line_total_ht, 0))
  const emballage = round2(ingredients.filter(i => i.categorie === 'emballage').reduce((s, i) => s + i.line_total_ht, 0))
  const totalMinutes = recipeTotalMinutes(recipe)
  const mo = round2(laborRate !== null ? totalMinutes / 60 * laborRate : 0)
  const total = round2(matiere + emballage + mo)
  const yieldQty = Number(recipe.yield_qty) || 0
  const parUnite = yieldQty > 0 ? round2(total / yieldQty) : null

  // Un ingrédient sans prix compte pour 0 € : le coût de revient est donc
  // SOUS-évalué, et la marge qui s'en déduit SUR-évaluée. Afficher « 62 % de
  // marge » avec un badge « 2 prix manquants » à côté laissait lire le chiffre
  // et ignorer le badge. Conformément au principe du projet (afficher le trou
  // plutôt qu'un chiffre plausible mais faux), la marge et le coefficient ne
  // sont PAS calculés tant qu'il manque un prix — le coût matière connu, lui,
  // reste affiché.
  // Une sous-recette au coût incomplet (elle-même a des prix manquants) compte
  // comme un prix manquant : son coût est sous-évalué, la marge serait flattée.
  const prixManquants = ingredients.filter(i => i.price_source === 'aucun' || i.sub_incomplete === true).length

  let pvHT: number | null = null
  let marge: number | null = null
  let coef: number | null = null
  const pvTTC = Number(recipe.selling_price_ttc) || 0
  if (pvTTC > 0) {
    const tva = Number(recipe.tva_rate) || 0
    pvHT = round2(pvTTC / (1 + tva / 100))
    const coutUnite = parUnite ?? total // sans rendement renseigné, le PV est comparé au batch entier
    if (pvHT > 0 && coutUnite > 0 && prixManquants === 0) {
      marge = round2(((pvHT - coutUnite) / pvHT) * 100)
      coef = round2(pvHT / coutUnite)
    }
  }

  return {
    matiere_ht: matiere,
    emballage_ht: emballage,
    main_oeuvre_ht: mo,
    total_ht: total,
    par_unite_ht: parUnite,
    prix_manquants: prixManquants,
    labor_rate_ht: laborRate,
    total_minutes: totalMinutes,
    pv_unitaire_ht: pvHT,
    marge_pct: marge,
    coefficient: coef,
  }
}

// ─── Validation des entrées (partagée entre POST /api/recipes et PUT /api/recipes/[id]) ───

/** Ingrédients : validation commune création/édition. Renvoie une erreur lisible ou les lignes propres.
 *  Une ligne NEUVE doit viser un article générique ; les lignes héritées
 *  (article_id ou libre) restent acceptées pour ne pas casser les fiches existantes. */
export function parseIngredients(raw: unknown): { error?: string; rows?: IngredientRow[] } {
  if (!Array.isArray(raw)) return { error: 'ingredients doit être une liste' }
  if (raw.length === 0) return { error: 'Une recette a au moins un ingrédient' }
  if (raw.length > 60) return { error: '60 ingrédients maximum' }
  const rows: IngredientRow[] = []
  for (const [i, r] of (raw as Record<string, unknown>[]).entries()) {
    const label = String(r?.label ?? '').trim()
    const quantity = Number(r?.quantity)
    if (!label) return { error: `Ingrédient ${i + 1} : libellé manquant` }
    if (!Number.isFinite(quantity) || quantity <= 0) return { error: `« ${label.slice(0, 40)} » : quantité invalide` }
    const manual = Number(r?.manual_price_ht)
    const loss = Number(r?.loss_pct)
    const qtyUnit = typeof r?.qty_unit === 'string' && ['kg', 'g', 'piece'].includes(r.qty_unit) ? r.qty_unit : null
    // Sous-recette : exclusive de l'article générique (contrainte CHECK en base)
    const subId = typeof r?.sub_recipe_id === 'string' && r.sub_recipe_id ? r.sub_recipe_id : null
    rows.push({
      generic_id: subId ? null : (typeof r?.generic_id === 'string' && r.generic_id ? r.generic_id : null),
      sub_recipe_id: subId,
      article_id: typeof r?.article_id === 'string' && r.article_id ? r.article_id : null,
      label: label.slice(0, 120),
      quantity,
      unit: typeof r?.unit === 'string' && r.unit ? String(r.unit).slice(0, 12) : null,
      qty_unit: qtyUnit,
      loss_pct: Number.isFinite(loss) && loss >= 0 && loss < 100 ? loss : 0,
      manual_price_ht: Number.isFinite(manual) && manual > 0 ? manual : null,
      position: i,
    })
  }
  return { rows }
}

/** Champs de la recette elle-même — partagé entre POST (création) et PUT (édition).
 *  employee_id est transmis tel quel ; la route vérifie qu'il appartient au client. */
export function parseRecipeFields(body: Record<string, unknown>): { error?: string; fields?: Record<string, unknown> } {
  const name = String(body?.name ?? '').trim()
  if (!name || name.length > 80) return { error: 'Nom de recette requis (80 caractères max)' }
  const tva = Number(body?.tva_rate)
  const laborMin = Number(body?.labor_minutes)
  const yieldQty = Number(body?.yield_qty)
  const pv = Number(body?.selling_price_ttc)
  return {
    fields: {
      name,
      category: typeof body?.category === 'string' && body.category ? String(body.category).slice(0, 30) : null,
      yield_qty: Number.isFinite(yieldQty) && yieldQty > 0 ? yieldQty : null,
      yield_unit: typeof body?.yield_unit === 'string' && body.yield_unit ? String(body.yield_unit).slice(0, 20) : null,
      labor_minutes: Number.isFinite(laborMin) && laborMin >= 0 ? laborMin : 0,
      selling_price_ttc: Number.isFinite(pv) && pv > 0 ? pv : null,
      tva_rate: Number.isFinite(tva) && tva > 0 && tva <= 20 ? tva : 5.5,
      notes: typeof body?.notes === 'string' && body.notes ? String(body.notes).slice(0, 500) : null,
      employee_id: typeof body?.employee_id === 'string' && body.employee_id ? body.employee_id : null,
      // Procédé de fabrication : étapes ordonnées AVEC durée (minutes, null si non
      // chronométrée). Les anciens clients envoient encore des chaînes — tolérées.
      // Absent du corps = inchangé.
      ...(Array.isArray(body?.fabrication_steps)
        ? {
            fabrication_steps: (body.fabrication_steps as unknown[])
              .map((s): FabricationStep => {
                if (typeof s === 'string') return { text: s.trim(), minutes: null }
                const o = (s ?? {}) as Record<string, unknown>
                const m = Number(o.minutes)
                return {
                  text: String(o.text ?? '').trim(),
                  minutes: Number.isFinite(m) && m > 0 && m <= 6000 ? Math.round(m * 10) / 10 : null,
                }
              })
              .filter(st => st.text !== '')
              .slice(0, 30)
              .map(st => ({ text: st.text.slice(0, 300), minutes: st.minutes })),
          }
        : {}),
      // Paliers de temps : « pour 20 produits, temps ×1,8 ». Absent = inchangé.
      ...(Array.isArray(body?.time_tiers)
        ? {
            time_tiers: (body.time_tiers as unknown[])
              .map((t): TimeTier | null => {
                const o = (t ?? {}) as Record<string, unknown>
                const qty = Number(o.qty)
                const mult = Number(o.mult)
                return Number.isFinite(qty) && qty > 0 && Number.isFinite(mult) && mult > 0 && mult <= 50
                  ? { qty: Math.round(qty * 100) / 100, mult: Math.round(mult * 100) / 100 }
                  : null
              })
              .filter((t): t is TimeTier => t !== null)
              .slice(0, 12)
              .sort((a, b) => a.qty - b.qty),
          }
        : {}),
      updated_at: new Date().toISOString(),
    },
  }
}

/** Construit la carte des génériques avec leur prix du jour PAR UNITÉ DE BASE,
 *  à partir des lignes brutes de generic_articles et articles (mêmes règles que
 *  GET /api/mercuriale : dernière réf datée, ÷ facteur de conversion).
 *
 *  GARDE-FOU UNITÉS : une réf dont l'unité facturée est INCOMPATIBLE avec
 *  l'unité de base du générique (facturée à la pièce sur un générique au kg, ou
 *  l'inverse) et SANS facteur de conversion est IGNORÉE pour le prix — un prix
 *  à la pièce lu comme un prix au kg fausserait toutes les fiches. La ligne
 *  ressort alors « prix manquant » (visible), jamais un prix faux (silencieux).
 *  Une unité illisible (champ vide, valeur parasite) ne bloque pas : on garde
 *  le comportement historique. */
export function buildGenericMap(
  generics: Array<Record<string, unknown>>,
  articles: Array<Record<string, unknown>>,
): Map<string, GenericInfo> {
  const baseById = new Map<string, 'kg' | 'piece'>(
    generics.map(g => [String(g.id), g.base_unit === 'piece' ? 'piece' : 'kg']),
  )
  const bestByGeneric = new Map<string, { date: string; price: number }>()
  for (const a of articles) {
    const gid = a.generic_id as string | null
    if (!gid || a.last_price_ht == null) continue
    const raw = parseFloat(String(a.last_price_ht))
    if (!Number.isFinite(raw)) continue
    const hasConv = a.conversion_factor != null && Number(a.conversion_factor) > 0
    const base = baseById.get(gid)
    const kind = unitKind(a.unit as string | null | undefined)
    if (base && kind !== null && kind !== base && !hasConv) continue
    const conv = hasConv ? Number(a.conversion_factor) : 1
    const date = String(a.last_price_date || '')
    const cur = bestByGeneric.get(gid)
    if (!cur || date.localeCompare(cur.date) > 0) bestByGeneric.set(gid, { date, price: raw / conv })
  }
  const map = new Map<string, GenericInfo>()
  for (const g of generics) {
    const id = String(g.id)
    map.set(id, {
      id,
      name: String(g.name ?? ''),
      base_unit: g.base_unit === 'piece' ? 'piece' : 'kg',
      category: g.category === 'emballage' ? 'emballage' : 'ingredient',
      default_loss_pct: Number(g.default_loss_pct) || 0,
      price_ht: bestByGeneric.has(id) ? round4(bestByGeneric.get(id)!.price) : null,
    })
  }
  return map
}

// ── Coût matière dans le temps ────────────────────────────────────────────
// La question d'Otami — « la rentabilité de ce produit se dégrade-t-elle ? » —
// se répond en relisant la fiche AUX PRIX D'HIER : mêmes quantités brutes,
// prix mercuriale à la date demandée. Tout est relu, rien n'est stocké.

/** Série de prix d'un générique : points datés (date de facture), à l'unité de
 *  base, triés par date croissante. */
export type GenericPriceSeries = { d: string; p: number }[]

/** Construit les séries de prix PAR GÉNÉRIQUE depuis les lignes de factures
 *  VÉRIFIÉES (une ligne en quarantaine a unit_price_ht NULL et n'arrive jamais
 *  ici). Mêmes règles que le prix du jour : réf d'unité incompatible sans
 *  facteur de conversion exclue, prix ÷ facteur. */
export function buildGenericPriceSeries(
  generics: Array<Record<string, unknown>>,
  articles: Array<Record<string, unknown>>,
  points: Array<{ article_id: string | null; unit_price_ht: unknown; date: string | null }>,
): Map<string, GenericPriceSeries> {
  const baseById = new Map<string, 'kg' | 'piece'>(
    generics.map(g => [String(g.id), g.base_unit === 'piece' ? 'piece' : 'kg']),
  )
  // Réfs utilisables : rattachées à un générique, conversion posée si l'unité diverge
  const usable = new Map<string, { gid: string; conv: number }>()
  for (const a of articles) {
    const gid = a.generic_id as string | null
    if (!gid) continue
    const hasConv = a.conversion_factor != null && Number(a.conversion_factor) > 0
    const base = baseById.get(gid)
    const kind = unitKind(a.unit as string | null | undefined)
    if (base && kind !== null && kind !== base && !hasConv) continue
    usable.set(String(a.id), { gid, conv: hasConv ? Number(a.conversion_factor) : 1 })
  }
  const out = new Map<string, GenericPriceSeries>()
  for (const p of points) {
    if (!p.article_id || !p.date) continue
    const u = usable.get(String(p.article_id))
    if (!u) continue
    const raw = parseFloat(String(p.unit_price_ht))
    if (!Number.isFinite(raw)) continue
    const arr = out.get(u.gid) || []
    arr.push({ d: p.date, p: round4(raw / u.conv) })
    out.set(u.gid, arr)
  }
  for (const arr of out.values()) arr.sort((a, b) => a.d.localeCompare(b.d))
  return out
}

/** Prix d'un générique à une date : le dernier point daté ≤ d, null si aucun. */
export function priceAtDate(series: GenericPriceSeries | undefined, d: string): number | null {
  if (!series || series.length === 0) return null
  let found: number | null = null
  for (const pt of series) {
    if (pt.d <= d) found = pt.p
    else break
  }
  return found
}

/** Coût matière (+ emballage) d'une fiche à une date passée : les lignes au
 *  prix MERCURIALE sont relues au prix de la date, le reste (prix manuel, réf
 *  héritée, ligne sans prix) reste constant. Renvoie null si une ligne
 *  mercuriale n'a pas de prix connu à cette date — un point incomparable est
 *  un TROU assumé, jamais un total partiel silencieux. */
export function costMatiereAtDate(
  costed: IngredientCost[],
  seriesByGeneric: Map<string, GenericPriceSeries>,
  d: string,
): number | null {
  let total = 0
  for (const line of costed) {
    if (line.generic_id && line.price_source === 'mercuriale') {
      const p = priceAtDate(seriesByGeneric.get(line.generic_id), d)
      if (p === null) return null
      total += p * line.qty_brute
    } else {
      total += line.line_total_ht
    }
  }
  return Math.round(total * 100) / 100
}

// ── Sous-recettes ─────────────────────────────────────────────────────────
// Une fiche peut entrer dans une autre (farce fine, pâte, court-bouillon…).
// Son coût d'ingrédient = son coût COMPLET (matière + emballage + MO au taux
// productif) ÷ son rendement — relu à chaque affichage, jamais stocké.

/** Coût par unité de rendement d'une sous-recette, et honnêteté du chiffre */
export type SubCostInfo = {
  per_unit: number | null   // null : rendement absent ou boucle — « prix manquant »
  incomplete: boolean       // la sous-fiche a elle-même des prix manquants
}

/** Graphe de coût des fiches avec sous-recettes : mémoïsation + garde
 *  anti-cycle. Une sous-recette en boucle ou sans rendement se résout en
 *  « prix manquant » (per_unit null) — jamais un chiffre inventé, jamais de
 *  boucle infinie. `costFor` renvoie null pour un id inconnu. */
export function buildRecipeCostGraph(args: {
  recipes: (RecipeRow & Record<string, unknown>)[]
  ingredientsByRecipe: Map<string, IngredientRow[]>
  priceByArticle: Map<string, number>
  genericById: Map<string, GenericInfo>
  rateForRecipe: (r: RecipeRow & Record<string, unknown>) => number | null
}): { costedFor: (id: string) => IngredientCost[]; costFor: (id: string) => RecipeCost | null } {
  const byId = new Map(args.recipes.map(r => [String(r.id), r]))
  const memo = new Map<string, { costed: IngredientCost[]; cost: RecipeCost }>()
  const visiting = new Set<string>()

  const compute = (id: string): { costed: IngredientCost[]; cost: RecipeCost } | null => {
    const hit = memo.get(id)
    if (hit) return hit
    if (visiting.has(id)) return null // boucle : la ligne appelante devient « prix manquant »
    const r = byId.get(id)
    if (!r) return null
    visiting.add(id)
    const costed = costIngredients(args.ingredientsByRecipe.get(id) || [], args.priceByArticle, args.genericById, subResolver)
    const cost = computeRecipeCost(r, costed, args.rateForRecipe(r))
    visiting.delete(id)
    const out = { costed, cost }
    memo.set(id, out)
    return out
  }

  const subResolver = (subId: string): SubCostInfo | null => {
    const key = String(subId)
    const r = byId.get(key)
    if (!r) return null
    const res = compute(key)
    if (!res) return null // boucle détectée
    const y = Number(r.yield_qty) || 0
    return {
      per_unit: y > 0 ? round4(res.cost.total_ht / y) : null,
      incomplete: res.cost.prix_manquants > 0,
    }
  }

  return {
    costedFor: (id: string) => compute(String(id))?.costed ?? [],
    costFor: (id: string) => compute(String(id))?.cost ?? null,
  }
}
