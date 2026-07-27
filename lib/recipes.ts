// lib/recipes.ts — moteur de coût des fiches recettes. Module PUR : les données
// (recette, ingrédients, prix mercuriale, taux horaire) viennent de l'appelant.
//
// Principe hérité du moteur hebdo : AUCUN coût figé. Le coût matière lit le
// dernier prix mercuriale de chaque article au moment du calcul, la main-d'œuvre
// lit le taux horaire chargé courant des employés — une facture lue ou une
// embauche, et toutes les fiches sont à jour sans qu'on touche à rien.

import { chargeMultiplier, type PayrollEmployee } from '@/lib/payroll'

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
}

export type IngredientRow = {
  id?: string
  article_id: string | null
  label: string
  quantity: number
  unit: string | null
  manual_price_ht: number | null
  position?: number
}

export type IngredientCost = IngredientRow & {
  unit_price_ht: number | null   // prix mercuriale du jour, sinon prix manuel
  price_source: 'mercuriale' | 'manuel' | 'aucun'
  line_total_ht: number          // quantity × prix (0 si aucun prix connu)
}

export type RecipeCost = {
  matiere_ht: number
  main_oeuvre_ht: number
  total_ht: number
  par_unite_ht: number | null    // total ÷ yield_qty
  prix_manquants: number         // ingrédients sans prix mercuriale ni manuel
  // Si un prix de vente est renseigné (TTC, PAR UNITÉ produite) :
  pv_unitaire_ht: number | null
  marge_pct: number | null       // (PV HT − coût/unité) / PV HT
  coefficient: number | null     // PV HT ÷ coût/unité — le « coef » du métier
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Taux horaire chargé moyen de l'équipe (€/h) — même base que le planning :
 *  taux horaire × multiplicateur de charges patronales (CCN 992). Le gérant sans
 *  taux horaire renseigné est ignoré. null si aucun employé exploitable. */
export function averageLoadedRate(employees: PayrollEmployee[]): number | null {
  const rates = employees
    .map(e => {
      const h = Number((e as Record<string, unknown>).hourly_rate) || 0
      return h > 0 ? h * chargeMultiplier(e) : 0
    })
    .filter(r => r > 0)
  if (rates.length === 0) return null
  return round2(rates.reduce((a, b) => a + b, 0) / rates.length)
}

/** Coût détaillé des ingrédients — le prix mercuriale du jour PRIME sur le prix
 *  manuel dès qu'un article est rattaché (le manuel n'est qu'un repli de saisie). */
export function costIngredients(
  ingredients: IngredientRow[],
  priceByArticle: Map<string, number>,
): IngredientCost[] {
  return ingredients.map(ing => {
    const mercuriale = ing.article_id != null ? priceByArticle.get(ing.article_id) ?? null : null
    const price = mercuriale ?? (ing.manual_price_ht != null && ing.manual_price_ht > 0 ? ing.manual_price_ht : null)
    const source: IngredientCost['price_source'] = mercuriale !== null ? 'mercuriale' : price !== null ? 'manuel' : 'aucun'
    return {
      ...ing,
      unit_price_ht: price,
      price_source: source,
      line_total_ht: round2((price ?? 0) * (Number(ing.quantity) || 0)),
    }
  })
}

/** Coût complet d'une recette. laborRate en €/h chargé ; null = main-d'œuvre à 0
 *  (le front signale alors qu'il manque des employés au planning). */
export function computeRecipeCost(
  recipe: RecipeRow,
  ingredients: IngredientCost[],
  laborRate: number | null,
): RecipeCost {
  const matiere = round2(ingredients.reduce((s, i) => s + i.line_total_ht, 0))
  const mo = round2(laborRate !== null ? (Number(recipe.labor_minutes) || 0) / 60 * laborRate : 0)
  const total = round2(matiere + mo)
  const yieldQty = Number(recipe.yield_qty) || 0
  const parUnite = yieldQty > 0 ? round2(total / yieldQty) : null

  let pvHT: number | null = null
  let marge: number | null = null
  let coef: number | null = null
  const pvTTC = Number(recipe.selling_price_ttc) || 0
  if (pvTTC > 0) {
    const tva = Number(recipe.tva_rate) || 0
    pvHT = round2(pvTTC / (1 + tva / 100))
    const coutUnite = parUnite ?? total // sans rendement renseigné, le PV est comparé au batch entier
    if (pvHT > 0 && coutUnite > 0) {
      marge = round2(((pvHT - coutUnite) / pvHT) * 100)
      coef = round2(pvHT / coutUnite)
    }
  }

  return {
    matiere_ht: matiere,
    main_oeuvre_ht: mo,
    total_ht: total,
    par_unite_ht: parUnite,
    prix_manquants: ingredients.filter(i => i.price_source === 'aucun').length,
    pv_unitaire_ht: pvHT,
    marge_pct: marge,
    coefficient: coef,
  }
}

// ─── Validation des entrées (partagée entre POST /api/recipes et PUT /api/recipes/[id]) ───

/** Ingrédients : validation commune création/édition. Renvoie une erreur lisible ou les lignes propres. */
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
    rows.push({
      article_id: typeof r?.article_id === 'string' && r.article_id ? r.article_id : null,
      label: label.slice(0, 120),
      quantity,
      unit: typeof r?.unit === 'string' && r.unit ? String(r.unit).slice(0, 12) : null,
      manual_price_ht: Number.isFinite(manual) && manual > 0 ? manual : null,
      position: i,
    })
  }
  return { rows }
}

/** Champs de la recette elle-même — partagé entre POST (création) et PUT (édition). */
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
      updated_at: new Date().toISOString(),
    },
  }
}
