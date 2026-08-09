'use client'

// Fiches recettes — coût de revient au prix du jour, façon Otami mais branché sur
// les données PILOTE : chaque ingrédient est un ARTICLE GÉNÉRIQUE de la
// mercuriale (prix par unité de base kg/pièce, dernier prix facturé de ses réfs
// fournisseurs), la quantité se saisit en kg, g ou pièce, une perte % gonfle le
// brut, et la main-d'œuvre lit le taux PRODUCTIF de l'employé choisi (chargé × 52/(52 − semaines non travaillées)) (repli : taux
// moyen d'équipe, CCN 992). Rien n'est figé : une facture lue, une association
// ou une embauche, et toutes les fiches se recalculent.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChefHat, Plus, X, Search, AlertTriangle, Check, Euro, Factory, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import FichePanel, { type FicheRecipe } from './fiche-panel'
import { manquesDeLaFiche, prochainGeste } from '@/lib/recettes-catalogue'
import ListeFiches, {
  coutUniteAffiche, verdictAffiche,
  type ListeLigne, type SortKey, type SortState,
} from './liste'
import { parseStoredSteps, recipeTotalMinutes } from '@/lib/recipes'
import { Button } from '@/components/ui/button'
import ModaleFiche, { EMPTY_ING, fmtEuro } from './modale'

export type Generic = {
  id: string; name: string
  base_unit: 'kg' | 'piece'
  category: 'ingredient' | 'emballage'
  default_loss_pct: number
  price_ht: number | null
}

export type Employee = { id: string; name: string; loaded_rate: number | null }

export type IngredientDraft = {
  generic_id: string | null
  article_id: string | null      // héritage (ancienne réf directe)
  sub_recipe_id: string | null   // sous-recette : la ligne vise une autre fiche
  label: string
  quantity: string
  qty_unit: 'kg' | 'g' | 'piece' | null
  unit: string | null            // héritage — et unité de rendement d'une sous-recette
  loss_pct: string
  manual_price_ht: string
  legacy_price: number | null    // prix serveur d'une ligne héritée (aperçu seulement)
}

type RecipeCost = {
  matiere_ht: number; emballage_ht: number; main_oeuvre_ht: number; total_ht: number; par_unite_ht: number | null
  /** Coût par unité de VENTE — la base du PV, de la marge et du coef */
  par_unite_vente_ht?: number | null
  prix_manquants: number; labor_rate_ht: number | null; total_minutes: number
  pv_unitaire_ht: number | null; marge_pct: number | null; coefficient: number | null
  /** Coût matière du batch relu aux prix mercuriale des 8 dernières semaines */
  matiere_series?: { d: string; v: number }[]
  matiere_series_motif?: string | null
}

/** Un FORMAT DE VENTE de la fiche, tel que l'API le renvoie : ses champs de
 *  vente PLUS son verdict, entièrement dérivé du coût du batch (jamais stocké).
 *  Depuis le lot 50, c'est LUI la ligne du tableau. */
type FormatVente = {
  id: string; name: string
  sell_unit: string | null; sell_qty: number | null
  selling_price_ttc: number | null; tva_rate: number
  validated: boolean; position: number
  /** Verdict du format — même moteur que la fiche (computeFormatVerdict) */
  vente_qty?: number
  cout_unite_ht?: number | null
  pv_unitaire_ht?: number | null
  marge_pct?: number | null
  coefficient?: number | null
}

export type Recipe = {
  id: string; name: string; category: string | null
  yield_qty: number | null; yield_unit: string | null
  /** Tous les conditionnements de la même fabrication (au moins un) */
  formats?: FormatVente[]
  /** Vendu dans une AUTRE unité que la production (pièces fabriquées, kg vendus) */
  sell_unit?: string | null; sell_qty?: number | null
  labor_minutes: number; selling_price_ttc: number | null; tva_rate: number; notes: string | null
  employee_id: string | null
  /** Archivée le … (lot 123) — null : vivante. Une fiche archivée sort de la
   *  liste et des choix d'ingrédients mais reste calculée : l'archivage ne
   *  fausse jamais le coût d'une fiche qui l'utilise en sous-recette. */
  archived_at?: string | null
  /** jsonb des étapes : dès qu'une est chronométrée, c'est LEUR somme qui fait le
   *  temps de la fiche côté serveur — le champ labor_minutes n'est plus qu'un repli. */
  fabrication_steps?: unknown
  ingredients: { generic_id: string | null; article_id: string | null; sub_recipe_id?: string | null; label: string; quantity: number; qty_unit: string | null; unit: string | null; loss_pct: number | null; manual_price_ht: number | null; unit_price_ht: number | null; price_source: string; line_total_ht: number }[]
  cost: RecipeCost
}

/** Cible de marge posée par le client pour une catégorie de fiches (R-A) */
type Target = { category: string; target_marge_pct: number }

/** Famille de la boutique (référentiel margin_families, kind='vente') —
 *  alimente le menu déroulant « Catégorie » de la modale. */
export type Famille = { id: string; parent_id: string | null; name: string; position: number }

// La couleur d'une marge (contre la cible de sa catégorie, sinon les repères
// 50/30) vit désormais dans ./liste — c'est le tableau qui la peint.

const catLabel = (c: string | null) => (c && c.trim() ? c.trim().toLowerCase() : 'sans catégorie')

/** « 2026-08-07T… » → « 7 août 2026 ». Rendu tel quel si ce n'est pas une date. */
const fmtDateArchive = (iso: string | null | undefined) => {
  const t = String(iso ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return String(iso ?? '')
  return new Date(t + 'T00:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export default function RecettesPage() {
  const { toast } = useToast()
  const { confirm: confirmAction } = useConfirm()
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [generics, setGenerics] = useState<Generic[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [laborRate, setLaborRate] = useState<number | null>(null)
  const [targets, setTargets] = useState<Target[]>([])
  // Familles de la boutique (référentiel des marges) — le menu « Catégorie »
  const [familles, setFamilles] = useState<Famille[]>([])
  // Historique de prix tronqué côté serveur : les courbes de coût matière sont
  // partielles, et une courbe qui rétrécit se lit comme un prix stable.
  const [historiqueIncomplet, setHistoriqueIncomplet] = useState(false)
  // Cible en cours d'édition dans un en-tête de section (une seule à la fois)
  const [editTarget, setEditTarget] = useState<{ cat: string; value: string } | null>(null)
  const [targetSaving, setTargetSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Modale création / édition
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [catFilter, setCatFilter] = useState<string | null>(null)
  // Interrupteur global : le coût affiché comprend-il la main-d'œuvre ?
  // Le même écran répond alors à deux questions — « ce que ça me coûte
  // vraiment » (MO comprise, la base d'un prix de vente) et « ce que ça coûte
  // en matière » (le chiffre qu'on compare à un tarif de grossiste).
  const [avecMainOeuvre, setAvecMainOeuvre] = useState(true)
  const [sort, setSort] = useState<SortState>({ key: 'nom', dir: 'asc' })
  // Fiche ouverte EN ENCADRÉ sur la page (zéro navigation) — re-clic = fermeture
  // Ligne dépliée en encadré : une FICHE ouverte SUR UN FORMAT. Le format fait
  // partie de l'identité de l'ouverture — cliquer « au kg » puis « à la pièce »
  // doit changer ce qu'on lit, pas rouvrir la même chose.
  const [open, setOpen] = useState<{ key: string; recipeId: string; formatId: string | null } | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [show, setShow] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', category: '', yield_qty: '', yield_unit: 'pièces', sell_unit: '', sell_qty: '', labor_minutes: '', selling_price_ttc: '', tva_rate: '5.5', employee_id: '' })
  // « Autre… » : catégorie ou unité saisies librement, hors des listes proposées
  const [catLibre, setCatLibre] = useState(false)
  const [uniteLibre, setUniteLibre] = useState(false)
  // Coefficient multiplicateur affiché dans la modale — synchronisé avec le PV
  // TTC dans les deux sens (saisir l'un recalcule l'autre) ; seul le PV est stocké.
  const [coefField, setCoefField] = useState('')
  const [ings, setIngs] = useState<IngredientDraft[]>([EMPTY_ING()])
  const [pickerRow, setPickerRow] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [rec, fam] = await Promise.all([
      fetch('/api/recipes', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/margin-families', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
    ])
    if (fam && Array.isArray(fam.families)) {
      setFamilles(fam.families.map((f: any) => ({
        id: String(f.id), parent_id: f.parent_id ? String(f.parent_id) : null,
        name: String(f.name ?? ''), position: Number(f.position) || 0,
      })))
    }
    if (rec) {
      setRecipes(Array.isArray(rec.recipes) ? rec.recipes : [])
      setLaborRate(rec.labor_rate_ht ?? null)
      setGenerics(Array.isArray(rec.generics) ? rec.generics : [])
      setEmployees(Array.isArray(rec.employees) ? rec.employees : [])
      setTargets(Array.isArray(rec.targets) ? rec.targets : [])
      setHistoriqueIncomplet(rec.historique_incomplet === true)
    }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  // ?edit=<id> (posé par la fiche pleine page) : ouvre la modale d'édition
  // complète une fois les recettes chargées — une seule fois.
  const editConsumedRef = useRef(false)
  useEffect(() => {
    if (loading || recipes.length === 0 || editConsumedRef.current) return
    const id = new URLSearchParams(window.location.search).get('edit')
    if (!id) return
    const r = recipes.find(x => x.id === id)
    if (r) { editConsumedRef.current = true; openEdit(r) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, recipes])

  const genericById = useMemo(() => new Map(generics.map(g => [g.id, g])), [generics])
  const recipeById = useMemo(() => new Map(recipes.map(r => [r.id, r])), [recipes])

  // Taux MO de l'aperçu : l'employé choisi (s'il a un taux), sinon le taux moyen
  const previewRate = useMemo(() => {
    if (!form.employee_id) return laborRate
    return employees.find(e => e.id === form.employee_id)?.loaded_rate ?? laborRate
  }, [form.employee_id, employees, laborRate])

  // Temps de la fiche en cours d'édition : le serveur somme les étapes
  // CHRONOMÉTRÉES dès qu'il y en a une et ne retombe sur le champ « Temps » qu'à
  // défaut (recipeTotalMinutes). L'aperçu appliquait l'autre règle et affichait
  // donc une main-d'œuvre différente de celle enregistrée — sur une fiche dont
  // les étapes totalisent 80 min avec un champ resté à 45, le coût de revient
  // était sous-évalué à l'écran, et ce coût alimentait le calcul du prix de
  // vente par coefficient. Le chiffre vient désormais du moteur lui-même.
  const etapesChrono = useMemo(() => {
    const r = editId ? recipeById.get(editId) : null
    if (!r) return null
    const chrono = parseStoredSteps(r.fabrication_steps).filter(s => s.minutes !== null)
    if (chrono.length === 0) return null
    return { n: chrono.length, minutes: recipeTotalMinutes({ labor_minutes: 0, fabrication_steps: r.fabrication_steps }) }
  }, [editId, recipeById])

  // Aperçu du coût dans la modale — même logique que le serveur, en lecture seule :
  // conversion g→kg, perte sur le brut, matière et emballage séparés.
  const preview = useMemo(() => {
    let matiere = 0, emballage = 0
    // Les ingrédients comptés pour ZÉRO, nommés : « il manque un prix » sans dire
    // lequel n'indique aucun geste à faire, et c'est ce qui bloque le coefficient.
    const sansPrix: string[] = []
    const nomDe = (i: IngredientDraft) => i.label.trim() || 'ingrédient sans nom'
    for (const ing of ings) {
      const qty = parseFloat(ing.quantity.replace(',', '.')) || 0
      if (qty <= 0) continue
      const loss = Math.min(99, Math.max(0, parseFloat(ing.loss_pct.replace(',', '.')) || 0))
      // Sous-recette : coût complet de la fiche ÷ rendement (même règle que le serveur)
      if (ing.sub_recipe_id) {
        const sub = recipeById.get(ing.sub_recipe_id)
        const price = sub && sub.cost.par_unite_ht !== null ? sub.cost.par_unite_ht : null
        if (price === null) { sansPrix.push(nomDe(ing)); continue }
        if (sub && sub.cost.prix_manquants > 0) sansPrix.push(`${nomDe(ing)} (fiche au coût incomplet)`)
        matiere += price * (qty / (1 - loss / 100))
        continue
      }
      const g = ing.generic_id ? genericById.get(ing.generic_id) ?? null : null
      const manual = parseFloat(ing.manual_price_ht.replace(',', '.')) || null
      const price = g ? (g.price_ht ?? manual) : (ing.legacy_price ?? manual)
      if (price === null) { sansPrix.push(nomDe(ing)); continue }
      const qtyBase = g && g.base_unit === 'kg' && ing.qty_unit === 'g' ? qty / 1000 : qty
      const cout = price * (qtyBase / (1 - loss / 100))
      if (g?.category === 'emballage') emballage += cout
      else matiere += cout
    }
    const minutes = etapesChrono ? etapesChrono.minutes : (parseFloat(form.labor_minutes.replace(',', '.')) || 0)
    const mo = previewRate !== null ? minutes / 60 * previewRate : 0
    const total = matiere + emballage + mo
    const yieldQty = parseFloat(form.yield_qty.replace(',', '.')) || 0
    const parUnite = yieldQty > 0 ? total / yieldQty : null
    // Unité de vente distincte : le coût se rapporte à la quantité VENDABLE du
    // batch (2,4 kg pour 6 pièces de 400 g) — même règle que le moteur serveur.
    const sellQty = form.sell_unit ? (parseFloat(form.sell_qty.replace(',', '.')) || 0) : 0
    return { matiere, emballage, mo, minutes, total, parUnite, parUniteVente: sellQty > 0 ? total / sellQty : parUnite, manquants: sansPrix.length, sansPrix }
  }, [ings, form.labor_minutes, form.yield_qty, form.sell_unit, form.sell_qty, previewRate, genericById, recipeById, etapesChrono])

  // ── PV TTC ↔ coefficient : saisir l'un recalcule l'autre sur le coût de
  // l'aperçu (coût / unité, repli coût du batch). Seul le PV TTC est enregistré.
  //
  // Un coût auquel il MANQUE un prix ne sert pas de base : les lignes sans prix
  // comptent pour 0 €, le coût est donc sous-évalué et un coefficient appliqué
  // dessus produit un prix de vente trop bas — affiché en boutique, encaissé, et
  // jamais repris. Le moteur refuse déjà de publier marge et coefficient dans ce
  // cas (lib/recipes.ts) ; la conversion inverse doit refuser pareil.
  const coutIncomplet = preview.manquants > 0
  // Base du coefficient : le coût PAR UNITÉ DE VENTE — une fiche fabriquée en
  // pièces mais vendue au kg compare son PV au coût du kilo, pas de la pièce.
  const previewCoutUnite = coutIncomplet ? null : (preview.parUniteVente ?? (preview.total > 0 ? preview.total : null))
  /** Les ingrédients à prix manquant, nommés, pour l'info-bulle et le message */
  const nomsSansPrix = preview.sansPrix.slice(0, 3).join(', ') + (preview.sansPrix.length > 3 ? `, +${preview.sansPrix.length - 3}` : '')

  /** CE QU'IL RESTE À FAIRE SUR LE BROUILLON EN COURS DE SAISIE.
   *
   *  Même moteur que la liste (`lib/recettes-catalogue`), appliqué au formulaire
   *  plutôt qu'à une fiche enregistrée : le créateur voit ce qui lui manque
   *  PENDANT qu'il tape, pas après avoir découvert un tiret dans le tableau.
   *
   *  `validated: true` est délibéré et n'est pas un mensonge : « ce format n'a
   *  jamais été relu » est vrai de tout brouillon, et le reprocher à quelqu'un
   *  qui est en train de le créer n'indiquerait aucun geste à faire. La coche de
   *  relecture se pose depuis la fiche, une fois la recette rangée. */
  const manquesBrouillon = useMemo(() => manquesDeLaFiche({
    ingredients: ings.filter(i => (parseFloat(i.quantity.replace(',', '.')) || 0) > 0).length,
    prix_manquants: preview.manquants,
    vente_qty: form.sell_unit
      ? (parseFloat(form.sell_qty.replace(',', '.')) || 0)
      : (parseFloat(form.yield_qty.replace(',', '.')) || 0),
    selling_price_ttc: parseFloat(form.selling_price_ttc.replace(',', '.')) || null,
    minutes: preview.minutes,
    category: form.category,
    validated: true,
  }), [ings, preview.manquants, preview.minutes, form.sell_unit, form.sell_qty, form.yield_qty, form.selling_price_ttc, form.category])

  /** UN seul geste à la fois. Une liste de six choses à faire ne se lit pas ;
   *  une phrase se lit. Les cinq autres attendront leur tour. */
  const gesteSuivant = prochainGeste(manquesBrouillon)

  /** Aucune ligne d'ingrédient avec une quantité : il n'y a rien à chiffrer, et
   *  afficher « 0,00 € » trois fois ferait passer un formulaire vide pour une
   *  recette gratuite. */
  const rienAChiffrer = ings.every(i => (parseFloat(i.quantity.replace(',', '.')) || 0) <= 0)
  function onPvChange(v: string) {
    setForm(p => ({ ...p, selling_price_ttc: v }))
    const pv = parseFloat(v.replace(',', '.'))
    const tva = parseFloat(form.tva_rate.replace(',', '.')) || 0
    // Coût inconnu ou incomplet : le coef affiché serait faux — on le vide plutôt
    // que de laisser à l'écran celui d'avant.
    if (pv > 0 && previewCoutUnite) {
      setCoefField(String(Math.round((pv / (1 + tva / 100)) / previewCoutUnite * 100) / 100).replace('.', ','))
    } else setCoefField('')
  }
  function onCoefChange(v: string) {
    setCoefField(v)
    const k = parseFloat(v.replace(',', '.'))
    const tva = parseFloat(form.tva_rate.replace(',', '.')) || 0
    if (k > 0 && previewCoutUnite) {
      setForm(p => ({ ...p, selling_price_ttc: String(Math.round(previewCoutUnite * k * (1 + tva / 100) * 100) / 100).replace('.', ',') }))
    }
  }

  // Recherche : par nom de recette, par catégorie, et par INGRÉDIENT — taper
  // « chipolata » amène aussi sur les fiches qui en contiennent.
  /**
   * LA LISTE, à une ligne par FORMAT DE VENTE (lot 50).
   *
   * Le relevé d'Otami est sans ambiguïté : sa liste est une liste de formats,
   * pas de recettes — nom du format en gras, recette mère en italique dessous.
   * Le besoin est réel : un même produit vendu à la pièce ET au kilo a deux
   * prix donc deux marges, et une ligne unique n'en montrait qu'une, celle du
   * format par défaut. Or c'est cette liste qu'on balaye pour trouver ce qui ne
   * marge pas.
   *
   * Rien n'est recalculé ici : le coût du batch est commun à tous les formats
   * (même fabrication), et la partie VENTE de chaque ligne est le verdict que
   * le serveur a déjà produit avec `computeFormatVerdict`. On ne fait que
   * ranger.
   */
  const lignes = useMemo<ListeLigne[]>(() => {
    const out: ListeLigne[] = []
    for (const r of recipes) {
      // Les archivées ont leur section à elles, en bas — les mêler ici
      // reviendrait à ne pas les avoir archivées.
      if (r.archived_at) continue
      const communs = {
        recipeId: r.id,
        recetteNom: r.name,
        category: r.category,
        yield_qty: r.yield_qty,
        yield_unit: r.yield_unit,
        labor_minutes: r.labor_minutes,
      }
      const fmts = [...(r.formats || [])].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'fr'))
      if (fmts.length === 0) {
        // Fiche sans aucun format : ne devrait plus exister depuis la reprise du
        // lot 46. On la montre quand même — une fiche absente de sa propre liste
        // serait pire qu'une fiche sans prix — avec les champs de vente que
        // l'API renvoie déjà (ceux du format par défaut, donc nuls ici).
        out.push({
          ...communs,
          key: `${r.id}:`,
          formatId: null,
          nom: r.name,
          sell_unit: r.sell_unit ?? null,
          sell_qty: r.sell_qty ?? null,
          selling_price_ttc: r.selling_price_ttc,
          validated: false,
          cost: r.cost,
        })
        continue
      }
      for (const f of fmts) {
        out.push({
          ...communs,
          key: `${r.id}:${f.id}`,
          formatId: f.id,
          nom: f.name,
          sell_unit: f.sell_unit,
          sell_qty: f.sell_qty,
          selling_price_ttc: f.selling_price_ttc,
          validated: f.validated === true,
          // Coût du BATCH tel quel, partie VENTE remplacée par celle du format —
          // exactement ce que fait `costPourFormat` côté serveur pour la fiche.
          cost: {
            ...r.cost,
            pv_unitaire_ht: f.pv_unitaire_ht ?? null,
            marge_pct: f.marge_pct ?? null,
            coefficient: f.coefficient ?? null,
          },
        })
      }
    }
    return out
  }, [recipes])

  /** Les ingrédients se cherchent par RECETTE — indexés une fois, relus par
   *  chacun des formats de la fiche. */
  const ingredientsTexte = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of recipes) m.set(r.id, r.ingredients.map(i => i.label).join(' | ').toLowerCase())
    return m
  }, [recipes])

  const correspond = useCallback((l: ListeLigne, q: string) => (
    l.nom.toLowerCase().includes(q)
    || l.recetteNom.toLowerCase().includes(q)
    || catLabel(l.category).includes(q)
    || (ingredientsTexte.get(l.recipeId) || '').includes(q)
  ), [ingredientsTexte])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = lignes
    if (catFilter !== null) list = list.filter(l => catLabel(l.category) === catFilter)
    if (q) list = list.filter(l => correspond(l, q))
    return list
  }, [lignes, search, catFilter, correspond])

  // Résultats de la liste déroulante sous la barre : format + catégorie, clic →
  // ouvre la fiche SUR CE FORMAT. Cherche dans TOUS les formats (ignore le
  // filtre catégorie actif — c'est un outil de navigation, pas un filtre).
  const suggestions = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return lignes
      .filter(l => correspond(l, q))
      .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
      .slice(0, 8)
  }, [lignes, search, correspond])

  /** Les fiches archivées, les plus récentes d'abord. Elles vivent dans leur
   *  section repliée en bas de page : visibles quand on les cherche, absentes
   *  quand on travaille. */
  const archivees = useMemo(() =>
    recipes.filter(r => r.archived_at)
      .sort((a, b) => String(b.archived_at).localeCompare(String(a.archived_at))),
  [recipes])

  /** Les fiches qui entrent dans une AUTRE fiche — la chip « Sous-recette » de
   *  la liste. Lu des lignes d'ingrédients : rien n'est stocké pour ça. */
  const sousRecetteIds = useMemo(() => {
    const s = new Set<string>()
    for (const r of recipes) for (const i of r.ingredients) if (i.sub_recipe_id) s.add(String(i.sub_recipe_id))
    return s
  }, [recipes])

  /** Un clic sur un en-tête : même colonne → on inverse le sens ; autre colonne
   *  → on démarre dans le sens le plus utile (le nom de A à Z, les chiffres du
   *  plus fort au plus faible — on ouvre un tri de marge pour voir les extrêmes). */
  const onSort = useCallback((key: SortKey) => {
    setSort(prev => (prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'nom' ? 'asc' : 'desc' }))
  }, [])

  /** Tri d'une liste de fiches selon l'en-tête choisi. Une valeur ABSENTE
   *  (pas de prix de vente, marge non calculable) part toujours EN DERNIER,
   *  quel que soit le sens : un trou n'est ni le meilleur ni le pire, il est
   *  hors classement — le remonter en tête d'un tri décroissant ferait passer
   *  des fiches non chiffrées pour les plus rentables. */
  const trier = useCallback((list: ListeLigne[]): ListeLigne[] => {
    const sens = sort.dir === 'asc' ? 1 : -1
    const val = (l: ListeLigne): number | null => {
      switch (sort.key) {
        case 'cout': return coutUniteAffiche(l, avecMainOeuvre)
        case 'marge': return verdictAffiche(l, avecMainOeuvre).marge_pct
        case 'pv': return l.selling_price_ttc
        case 'temps': return l.cost.total_minutes ?? l.labor_minutes
        default: return null
      }
    }
    // À valeur égale, les formats d'une même fiche restent groupés et dans leur
    // ordre (le nom du format départage) — deux lignes voisines qui parlent de
    // la même fabrication doivent se lire l'une sous l'autre.
    const parNom = (a: ListeLigne, b: ListeLigne) =>
      a.recetteNom.localeCompare(b.recetteNom, 'fr') || a.nom.localeCompare(b.nom, 'fr')
    return [...list].sort((a, b) => {
      if (sort.key === 'nom') return sens * parNom(a, b)
      const va = val(a), vb = val(b)
      if (va === null && vb === null) return parNom(a, b)
      if (va === null) return 1
      if (vb === null) return -1
      if (va === vb) return parNom(a, b)
      return sens * (va - vb)
    })
  }, [sort, avecMainOeuvre])

  // Sections par catégorie, triées ; les lignes à l'intérieur suivent l'en-tête.
  const grouped = useMemo(() => {
    const m = new Map<string, ListeLigne[]>()
    for (const l of filtered) {
      const c = catLabel(l.category)
      const arr = m.get(c) || []
      arr.push(l)
      m.set(c, arr)
    }
    return [...m.entries()]
      .map(([cat, list]) => [cat, trier(list)] as const)
      .sort((a, b) => a[0].localeCompare(b[0], 'fr'))
  }, [filtered, trier])

  const allCats = useMemo(() => {
    const set = new Set<string>()
    for (const r of recipes) { if (!r.archived_at) set.add(catLabel(r.category)) }
    return [...set].sort((a, b) => a.localeCompare(b, 'fr'))
  }, [recipes])

  /** Nombre de FORMATS par catégorie — les chips comptent ce que la liste
   *  affiche, c'est-à-dire des lignes. */
  const formatsParCat = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of lignes) {
      const c = catLabel(l.category)
      m.set(c, (m.get(c) || 0) + 1)
    }
    return m
  }, [lignes])

  const targetByCat = useMemo(() => new Map(targets.map(t => [t.category, t.target_marge_pct])), [targets])

  // Options du menu « Catégorie » : les familles de la boutique, racines dans
  // l'ordre du référentiel des marges, sous-familles indentées sous la leur.
  const optionsFamilles = useMemo(() => {
    const tri = (a: Famille, b: Famille) => a.position - b.position || a.name.localeCompare(b.name, 'fr')
    const out: { value: string; label: string }[] = []
    for (const r of familles.filter(f => !f.parent_id).sort(tri)) {
      out.push({ value: r.name, label: r.name })
      for (const c of familles.filter(f => f.parent_id === r.id).sort(tri)) {
        out.push({ value: c.name, label: `  · ${c.name}` })
      }
    }
    return out
  }, [familles])

  // Bandeau de pilotage : calculé sur TOUS les formats (jamais sur le filtre en
  // cours). Un format sans marge calculable n'entre pas dans la moyenne.
  //
  // Depuis le lot 50, l'unité de compte est le FORMAT, pas la fiche — c'est le
  // format qui porte un prix, donc une marge, et une fiche vendue en deux
  // conditionnements peut très bien tenir sa cible sur l'un et pas sur l'autre.
  // Le bandeau écrit « formats » en toutes lettres et rappelle le nombre de
  // fiches, pour qu'aucun chiffre ne se lise à côté.
  const stats = useMemo(() => {
    // La marge suit l'INTERRUPTEUR : afficher des coûts hors main-d'œuvre dans
    // le tableau et une marge MO comprise dans le bandeau juste au-dessus
    // donnerait deux verdicts contradictoires sur le même écran.
    const margeDe = (l: ListeLigne) => verdictAffiche(l, avecMainOeuvre).marge_pct
    const chiffrees = lignes.filter(l => margeDe(l) !== null)
    const margeMoyenne = chiffrees.length > 0
      ? chiffrees.reduce((s, l) => s + (margeDe(l) as number), 0) / chiffrees.length
      : null
    const sousCible = lignes.filter(l => {
      const t = targetByCat.get(catLabel(l.category))
      const m = margeDe(l)
      return t !== undefined && m !== null && m < t
    })
    // Un prix manquant est un défaut de la FICHE (un ingrédient sans prix), pas
    // d'un format : on compte des fiches, et le libellé le dit.
    const prixManquants = recipes.filter(r => !r.archived_at && r.cost.prix_manquants > 0).length
    return {
      total: lignes.length,
      fiches: recipes.filter(r => !r.archived_at).length,
      chiffrees: chiffrees.length,
      margeMoyenne,
      sousCible,
      prixManquants,
      hasTargets: targets.length > 0,
    }
  }, [lignes, recipes, targetByCat, targets, avecMainOeuvre])

  /** Pose (ou retire, champ vide) la cible de marge d'une catégorie */
  async function saveTarget(cat: string) {
    if (targetSaving || !editTarget) return
    const raw = editTarget.value.trim().replace(',', '.')
    setTargetSaving(true)
    const res = await fetch('/api/recipe-targets', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: cat, target_marge_pct: raw === '' ? null : parseFloat(raw) }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    setTargetSaving(false)
    if (res?.ok) {
      setEditTarget(null)
      toast(raw === ''
        ? { variant: 'info', title: `Cible retirée pour « ${cat} »`, description: 'Sans cible, la marge de ces fiches n’est plus jugée.' }
        : { variant: 'success', title: `Cible « ${cat} » : ${raw.replace('.', ',')} %` })
      load()
    } else toast({ variant: 'error', title: data?.error || 'Enregistrement impossible', description: data?.error ? undefined : 'Réessayez.' })
  }

  /** Ouvre la fiche en encadré sur la page, SUR LE FORMAT de la ligne cliquée
   *  (ou la ferme si cette même ligne est déjà ouverte). */
  function openFiche(l: ListeLigne) {
    setOpen(prev => {
      const next = prev?.key === l.key ? null : { key: l.key, recipeId: l.recipeId, formatId: l.formatId }
      if (next) setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
      return next
    })
  }

  /** Archiver ou restaurer une fiche. Route dédiée (pas le PUT d'édition) ;
   *  le toast dit à chaque fois OÙ la fiche est partie et comment revenir —
   *  une fiche qui disparaît de la liste sans explication se lit « perdue ». */
  const [archivant, setArchivant] = useState<string | null>(null)
  const [voirArchivees, setVoirArchivees] = useState(false)
  async function archiverFiche(id: string, archive: boolean) {
    if (archivant) return
    setArchivant(id)
    const res = await fetch(`/api/recipes/${id}/archive`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archive }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    setArchivant(null)
    if (res?.ok) {
      setShow(false)
      toast(archive
        ? { variant: 'info', title: 'Fiche archivée', description: 'Elle attend en bas de la liste, dans « Fiches archivées » — un clic sur Restaurer la fait revenir, avec ses ingrédients, ses temps et ses formats.' }
        : { variant: 'success', title: 'Fiche restaurée', description: 'Elle a repris sa place dans la liste, telle qu’elle était.' })
      load()
    } else {
      toast({ variant: 'error', title: data?.error || 'Action impossible', description: 'Réessayez.' })
    }
  }

  function openNew() {
    setEditId(null)
    setForm({ name: '', category: '', yield_qty: '', yield_unit: 'pièces', sell_unit: '', sell_qty: '', labor_minutes: '', selling_price_ttc: '', tva_rate: '5.5', employee_id: '' })
    setCatLibre(false)
    setUniteLibre(false)
    setCoefField('')
    setIngs([EMPTY_ING()])
    setShow(true)
  }

  function openEdit(r: Recipe) {
    setEditId(r.id)
    // Catégorie héritée en minuscules (« traiteur rachat ») : rebasculée sur la
    // famille du référentiel qui porte le même nom — sans ça, le menu déroulant
    // n'afficherait rien, la valeur ne correspondant exactement à aucune option.
    const catCanonique = familles.find(f => f.name.trim().toLowerCase() === (r.category ?? '').trim().toLowerCase())?.name ?? r.category ?? ''
    setForm({
      name: r.name, category: catCanonique,
      yield_qty: r.yield_qty != null ? String(r.yield_qty) : '', yield_unit: r.yield_unit ?? 'pièces',
      sell_unit: r.sell_unit ?? '', sell_qty: r.sell_qty != null ? String(r.sell_qty) : '',
      labor_minutes: String(r.labor_minutes ?? ''), selling_price_ttc: r.selling_price_ttc != null ? String(r.selling_price_ttc) : '',
      tva_rate: String(r.tva_rate ?? '5.5'), employee_id: r.employee_id ?? '',
    })
    setCatLibre(false)
    setUniteLibre(false)
    setCoefField(r.cost.coefficient !== null ? String(r.cost.coefficient).replace('.', ',') : '')
    setIngs(r.ingredients.length > 0
      ? r.ingredients.map(i => ({
          generic_id: i.generic_id, article_id: i.article_id, sub_recipe_id: i.sub_recipe_id ?? null, label: i.label,
          quantity: String(i.quantity),
          qty_unit: (i.qty_unit === 'kg' || i.qty_unit === 'g' || i.qty_unit === 'piece') ? i.qty_unit : null,
          unit: i.unit,
          loss_pct: String(i.loss_pct ?? 0),
          manual_price_ht: i.manual_price_ht != null ? String(i.manual_price_ht) : '',
          legacy_price: !i.generic_id && !i.sub_recipe_id ? i.unit_price_ht : null,
        }))
      : [EMPTY_ING()])
    setShow(true)
  }

  async function save() {
    const kept = ings.filter(i => i.label.trim() && parseFloat(i.quantity.replace(',', '.')) > 0)
    // Obligation d'associer : une ligne neuve vise un article générique OU une
    // sous-recette. Seules les lignes héritées (ancienne réf directe) échappent.
    const libres = kept.filter(i => !i.generic_id && !i.article_id && !i.sub_recipe_id)
    if (libres.length > 0) {
      toast({
        variant: 'error', title: 'Ingrédient hors mercuriale',
        description: `« ${libres[0].label.slice(0, 40)} » : choisissez un article générique ou une fiche recette dans la liste (créez l'article depuis la page Mercuriale s'il n'existe pas encore).`,
      })
      return
    }
    // Vendu dans une autre unité : sans la quantité vendable du batch, marge et
    // coef seraient calculés sur la mauvaise base — on demande le chiffre.
    if (form.sell_unit && !(parseFloat(form.sell_qty.replace(',', '.')) > 0)) {
      toast({
        variant: 'error', title: 'Quantité vendable manquante',
        description: `La fiche se vend en ${form.sell_unit} : indiquez ce que le batch représente dans cette unité (ex. 6 pièces de 400 g → 2,4 kg).`,
      })
      return
    }
    setSaving(true)
    const payload = {
      name: form.name, category: form.category || null,
      yield_qty: form.yield_qty ? parseFloat(form.yield_qty.replace(',', '.')) : null,
      yield_unit: form.yield_unit || null,
      sell_unit: form.sell_unit || null,
      sell_qty: form.sell_unit && form.sell_qty ? parseFloat(form.sell_qty.replace(',', '.')) : null,
      labor_minutes: parseFloat(form.labor_minutes.replace(',', '.')) || 0,
      selling_price_ttc: form.selling_price_ttc ? parseFloat(form.selling_price_ttc.replace(',', '.')) : null,
      tva_rate: parseFloat(form.tva_rate.replace(',', '.')) || 5.5,
      employee_id: form.employee_id || null,
      ingredients: kept.map(i => ({
        generic_id: i.generic_id, article_id: i.article_id, sub_recipe_id: i.sub_recipe_id, label: i.label, unit: i.unit,
        quantity: parseFloat(i.quantity.replace(',', '.')),
        qty_unit: i.qty_unit,
        loss_pct: parseFloat(i.loss_pct.replace(',', '.')) || 0,
        manual_price_ht: i.manual_price_ht ? parseFloat(i.manual_price_ht.replace(',', '.')) : null,
      })),
    }
    const res = await fetch(editId ? `/api/recipes/${editId}` : '/api/recipes', {
      method: editId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => ({} as any)) : ({} as any)
    setSaving(false)
    if (res?.ok) { setShow(false); toast({ variant: 'success', title: editId ? 'Recette mise à jour' : 'Recette créée' }); load() }
    else toast({ variant: 'error', title: 'Enregistrement impossible', description: data?.error || 'Réessayez.' })
  }

  async function remove() {
    if (!editId) return
    const ok = await confirmAction({
      title: 'Retirer cette fiche recette ?',
      description: 'Elle disparaît de la liste. Ses ingrédients et son historique sont conservés.',
      confirmLabel: 'Retirer', variant: 'danger',
    })
    if (!ok) return
    const res = await fetch(`/api/recipes/${editId}`, { method: 'DELETE' }).catch(() => null)
    if (res?.ok) { setShow(false); toast({ variant: 'info', title: 'Recette retirée' }); load() }
    else toast({ variant: 'error', title: 'Suppression impossible' })
  }

  function pickGeneric(row: number, g: Generic) {
    setIngs(prev => prev.map((ing, i) => i === row
      ? {
          ...ing, generic_id: g.id, article_id: null, sub_recipe_id: null, label: g.name, unit: null,
          qty_unit: g.base_unit === 'kg' ? 'kg' : 'piece',
          loss_pct: String(g.default_loss_pct || 0),
          manual_price_ht: '', legacy_price: null,
        }
      : ing))
    setPickerRow(null)
  }

  /** Crée un article générique SANS quitter la modale, et le choisit aussitôt.
   *
   *  Avant : taper « sel nitrité » sur une ligne d'ingrédient ne donnait aucune
   *  suggestion et aucune issue. Il fallait sortir de la modale — en PERDANT
   *  toute la saisie en cours —, aller en Mercuriale, créer l'article, revenir,
   *  et tout retaper. En pleine mise au point d'une terrine, c'est le genre de
   *  détour qui fait renoncer à la fiche.
   *
   *  L'unité est demandée explicitement, jamais devinée : c'est elle qui décide
   *  si un prix se lit en euros par kilo ou par pièce, et une unité devinée est
   *  exactement ce qui a publié des prix faux ailleurs dans le produit. */
  const [creantRow, setCreantRow] = useState<number | null>(null)
  async function creerGenerique(row: number, nom: string, base_unit: 'kg' | 'piece') {
    if (creantRow !== null) return
    const name = nom.trim()
    if (name.length < 2) return
    setCreantRow(row)
    const res = await fetch('/api/generic-articles', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, base_unit, category: 'ingredient' }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    setCreantRow(null)
    if (!res?.ok || !data?.generic?.id) {
      toast({ variant: 'error', title: data?.error || 'Création impossible', description: 'Rien n’a été créé — votre saisie est intacte.' })
      return
    }
    const g: Generic = {
      id: String(data.generic.id),
      name: String(data.generic.name ?? name),
      base_unit: data.generic.base_unit === 'piece' ? 'piece' : 'kg',
      category: data.generic.category === 'emballage' ? 'emballage' : 'ingredient',
      default_loss_pct: Number(data.generic.default_loss_pct) || 0,
      price_ht: null,
    }
    setGenerics(prev => [...prev, g])
    pickGeneric(row, g)
    toast({
      variant: 'success', title: `« ${g.name} » créé — ${g.base_unit === 'kg' ? 'au kg' : 'à la pièce'}`,
      description: 'Aucune facture ne lui donne encore de prix : saisissez un prix de repli, il s’effacera devant le premier prix facturé.',
    })
    // Le geste suivant est le prix de repli : on y amène le curseur directement,
    // sinon la ligne compte pour 0 € et le coefficient reste bloqué.
    setTimeout(() => document.getElementById(`prix-repli-${row}`)?.focus(), 60)
  }

  /** Sous-recette choisie : la ligne vise la fiche entière — quantité en unités
   *  de SON rendement, coût = son coût complet ÷ rendement (relu en continu) */
  function pickSub(row: number, r: Recipe) {
    setIngs(prev => prev.map((ing, i) => i === row
      ? {
          ...ing, sub_recipe_id: r.id, generic_id: null, article_id: null, label: r.name,
          unit: r.yield_unit || 'u', qty_unit: null,
          loss_pct: '0', manual_price_ht: '', legacy_price: null,
        }
      : ing))
    setPickerRow(null)
  }

  /** Propriétés communes à tous les tableaux de la page — l'interrupteur, le
   *  tri et l'ouverture d'une fiche sont les mêmes partout. */
  const tableauCommun = {
    sort, onSort, avecMainOeuvre, sousRecetteIds,
    onOpen: openFiche, openKey: open?.key ?? null,
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      {/* En-tête */}
      <div className="mb-6 flex items-start justify-between gap-6 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-pilote to-pilote-hover rounded-2xl flex items-center justify-center flex-shrink-0 shadow-card">
            <ChefHat className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Fiches recettes</h1>
            <p className="text-sm text-gray-500 mt-1">
              Coût de revient au prix du jour — matière (mercuriale) + main-d&apos;œuvre
              {laborRate !== null ? ` à ${fmtEuro(laborRate)}/h productif (l'heure réellement travaillée, CP et fériés déduits)` : ''}
            </p>
          </div>
        </div>

        {/* Les trois gestes principaux, en pastilles rondes étiquetées — un
            bouton de texte perdu dans une barre ne se voit pas, et les deux
            pages où l'on va depuis les fiches (les prix, la production) se
            cherchaient jusqu'ici dans le menu. */}
        <div className="flex items-start gap-5">
          <button onClick={openNew} className="group flex flex-col items-center gap-1.5 w-20">
            <span className="w-12 h-12 rounded-full bg-pilote text-white flex items-center justify-center shadow-card group-hover:bg-pilote-hover group-active:scale-[0.95] transition-all">
              <Plus className="w-5 h-5" />
            </span>
            <span className="text-[11px] font-semibold text-gray-600 text-center leading-tight group-hover:text-pilote transition-colors">Nouvelle fiche</span>
          </button>
          <Link href="/dashboard/mercuriale" className="group flex flex-col items-center gap-1.5 w-20">
            <span className="w-12 h-12 rounded-full bg-white ring-1 ring-pilote-200 text-pilote flex items-center justify-center shadow-card group-hover:bg-pilote-50 group-active:scale-[0.95] transition-all">
              <Euro className="w-5 h-5" />
            </span>
            <span className="text-[11px] font-semibold text-gray-600 text-center leading-tight group-hover:text-pilote transition-colors">Mercuriale</span>
          </Link>
          <Link href="/dashboard/production" className="group flex flex-col items-center gap-1.5 w-20">
            <span className="w-12 h-12 rounded-full bg-white ring-1 ring-pilote-200 text-pilote flex items-center justify-center shadow-card group-hover:bg-pilote-50 group-active:scale-[0.95] transition-all">
              <Factory className="w-5 h-5" />
            </span>
            <span className="text-[11px] font-semibold text-gray-600 text-center leading-tight group-hover:text-pilote transition-colors">Production</span>
          </Link>
        </div>
      </div>

      {laborRate === null && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>Aucun taux horaire exploitable : la main-d&apos;œuvre compte pour 0 €. Renseignez vos employés (taux horaire) dans le <Link href="/dashboard/planning" className="font-bold underline">planning</Link>.</span>
        </div>
      )}

      {/* ── Pilotage : la santé des fiches d'un coup d'œil ── */}
      {!loading && recipes.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="rounded-2xl bg-pilote p-5 shadow-card">
            <p className="text-[11px] font-semibold text-pilote-200 uppercase tracking-wider mb-1.5">Marge moyenne</p>
            <p className="text-2xl font-extrabold tracking-tight text-white tabular">
              {stats.margeMoyenne !== null ? `${(Math.round(stats.margeMoyenne * 10) / 10).toLocaleString('fr-FR')} %` : '—'}
            </p>
            <p className="text-[11px] text-pilote-200 mt-0.5">
              {stats.chiffrees > 0 ? `sur ${stats.chiffrees} format${stats.chiffrees > 1 ? 's' : ''} chiffré${stats.chiffrees > 1 ? 's' : ''}` : 'aucun format avec PV et coût'}
              {avecMainOeuvre ? ' · MO comprise' : ' · hors main-d’œuvre'}
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
            {/* On compte des FORMATS — c'est ce que la liste affiche, une ligne
                par format. Le nombre de fiches est rappelé juste dessous : sans
                lui, « 12 » sur 9 fiches se lirait comme 12 produits. */}
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Formats de vente</p>
            <p className="text-2xl font-extrabold tracking-tight text-gray-900 tabular">{stats.total}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              sur {stats.fiches} fiche{stats.fiches > 1 ? 's' : ''}
              {stats.chiffrees < stats.total ? ` · ${stats.total - stats.chiffrees} sans marge (PV ou coût manquant)` : ' · tous chiffrés'}
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Sous la cible</p>
            {stats.hasTargets ? (
              <>
                <p className={`text-2xl font-extrabold tracking-tight tabular ${stats.sousCible.length > 0 ? 'text-red-600' : 'text-green-600'}`}>{stats.sousCible.length}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">{stats.sousCible.length > 0 ? 'formats à retravailler, listés ci-dessous' : 'toutes les cibles sont tenues'}</p>
              </>
            ) : (
              <>
                <p className="text-2xl font-extrabold tracking-tight tabular text-gray-300">—</p>
                <p className="text-[11px] text-gray-400 mt-0.5">posez une cible de marge par catégorie (« + cible de marge »)</p>
              </>
            )}
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Prix manquants</p>
            <p className={`text-2xl font-extrabold tracking-tight tabular ${stats.prixManquants > 0 ? 'text-amber-600' : 'text-gray-900'}`}>{stats.prixManquants}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">{stats.prixManquants > 0 ? `fiche${stats.prixManquants > 1 ? 's' : ''} au coût sous-estimé` : 'tous les ingrédients ont un prix'}</p>
          </div>
        </div>
      )}

      {/* Recherche + catégories */}
      {recipes.length > 0 && (
        <div className="mb-5 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={search}
              onChange={e => { setSearch(e.target.value); setSearchOpen(true) }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setSearchOpen(false)}
              onKeyDown={e => { if (e.key === 'Escape') setSearchOpen(false) }}
              placeholder="Chercher un format par produit, catégorie ou ingrédient…"
              className="w-full border border-gray-200 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200" />
            {searchOpen && search.trim() !== '' && (
              <div className="absolute z-20 top-full left-0 right-0 mt-1.5 bg-white border border-gray-100 rounded-xl shadow-card-hover overflow-hidden">
                {suggestions.length === 0 ? (
                  <p className="px-3.5 py-3 text-xs text-gray-400">Aucun format pour « {search.trim()} »</p>
                ) : suggestions.map(l => (
                  <button key={l.key} type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => { setSearchOpen(false); openFiche(l) }}
                    className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-pilote-50/60 transition-colors border-b border-gray-50 last:border-b-0">
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-gray-900 truncate">{l.nom}</span>
                      {l.recetteNom.trim().toLowerCase() !== l.nom.trim().toLowerCase() && (
                        <span className="block text-[11px] italic text-gray-400 truncate">{l.recetteNom}</span>
                      )}
                    </span>
                    <span className={`text-[10px] font-semibold uppercase tracking-wider rounded-lg px-1.5 py-0.5 flex-shrink-0 capitalize ${l.category && l.category.trim() ? 'text-pilote bg-pilote-50' : 'text-gray-400 bg-gray-50'}`}>
                      {catLabel(l.category)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Interrupteur global — il change la lecture de TOUTE la liste :
              coûts, marges, coefficients et bandeau du haut. C'est le geste le
              plus fort repris d'Otami : deux questions, un seul écran. */}
          <button type="button" onClick={() => setAvecMainOeuvre(v => !v)}
            title={avecMainOeuvre
              ? 'Coûts main-d’œuvre COMPRISE — ce que le produit coûte réellement à la maison, la base d’un prix de vente. Cliquer pour ne lire que la matière.'
              : 'Coûts SANS la main-d’œuvre — la matière seule, à comparer à un tarif de grossiste. Cliquer pour réintégrer le temps de fabrication.'}
            className={`flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 border transition-all flex-shrink-0 ${avecMainOeuvre ? 'bg-pilote-50 border-pilote-200' : 'bg-white border-gray-200 hover:bg-gray-50'}`}>
            <span className={`w-9 h-5 rounded-full flex items-center p-0.5 transition-colors ${avecMainOeuvre ? 'bg-pilote justify-end' : 'bg-gray-300 justify-start'}`}>
              <span className="w-4 h-4 rounded-full bg-white shadow-card" />
            </span>
            <span className="text-left">
              <span className={`block text-xs font-bold ${avecMainOeuvre ? 'text-pilote' : 'text-gray-600'}`}>Main-d&apos;œuvre</span>
              <span className="block text-[10px] text-gray-400">{avecMainOeuvre ? 'comprise dans les coûts' : 'exclue — matière seule'}</span>
            </span>
          </button>
          </div>

          {allCats.length > 1 && (
            <div className="flex items-center gap-2 flex-wrap">
              {/* Les compteurs des chips comptent des FORMATS — comme les lignes
                  qu'ils filtrent. « Tous » le dit en toutes lettres. */}
              <button onClick={() => setCatFilter(null)}
                title={`${stats.total} format${stats.total > 1 ? 's' : ''} de vente sur ${stats.fiches} fiche${stats.fiches > 1 ? 's' : ''}`}
                className={`text-xs font-semibold rounded-full px-3 py-1.5 transition-colors ${catFilter === null ? 'bg-pilote text-white' : 'bg-pilote-50 text-pilote hover:bg-pilote-100'}`}>
                Tous les formats ({stats.total})
              </button>
              {allCats.map(c => {
                const n = formatsParCat.get(c) || 0
                return (
                  <button key={c} onClick={() => setCatFilter(prev => prev === c ? null : c)}
                    className={`text-xs font-semibold rounded-full px-3 py-1.5 capitalize transition-colors ${catFilter === c ? 'bg-pilote text-white' : 'bg-pilote-50 text-pilote hover:bg-pilote-100'}`}>
                    {c} ({n})
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Fiche ouverte en encadré — directement sur la page, sans navigation */}
      {open && (() => {
        const r = recipes.find(x => x.id === open.recipeId)
        if (!r) return null
        return (
          <div ref={panelRef} className="mb-6 scroll-mt-6">
            <FichePanel
              // Le format fait partie de la clé : passer d'une ligne « au kg » à
              // une ligne « à la pièce » de la même fiche remonte bien le
              // panneau sur le bon format.
              key={open.key}
              recipe={r as unknown as FicheRecipe}
              initialFormatId={open.formatId}
              employees={employees}
              generics={generics}
              target={targetByCat.get(catLabel(r.category)) ?? null}
              historiqueIncomplet={historiqueIncomplet}
              onEditFull={() => openEdit(r)}
              onSaved={load}
              onClose={() => setOpen(null)}
            />
          </div>
        )
      })()}

      {/* Liste */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{[...Array(6)].map((_, i) => <div key={i} className="h-44 bg-gray-100 rounded-2xl animate-pulse" />)}</div>
      ) : recipes.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-gray-200 py-16 text-center">
          <ChefHat className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-500 mb-1">Aucune fiche recette pour l&apos;instant</p>
          <p className="text-xs text-gray-400 max-w-md mx-auto mb-4">
            Créez votre première recette : chaque ingrédient pioche son prix dans la <Link href="/dashboard/mercuriale" className="text-pilote font-semibold hover:underline">mercuriale</Link>,
            la main-d&apos;œuvre vient du planning — et le coût se met à jour tout seul à chaque nouvelle facture.
          </p>
          <Button onClick={openNew} className="bg-pilote hover:bg-pilote-hover text-white"><Plus className="w-4 h-4 mr-1.5" />Créer une recette</Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-gray-200 py-12 text-center">
          <Search className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm font-medium text-gray-500">Aucun format ne correspond{search ? <> à « {search} »</> : ''}</p>
          <button onClick={() => { setSearch(''); setCatFilter(null) }} className="mt-2 text-xs font-semibold text-pilote hover:underline">Tout afficher</button>
        </div>
      ) : (
        <div className="space-y-8">
          {/* ── À retravailler : les fiches sous la cible de leur catégorie ── */}
          {stats.sousCible.length > 0 && !search.trim() && catFilter === null && (
            <section>
              <div className="flex items-baseline gap-2 mb-3">
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-red-600">À retravailler</h2>
                {/* On compte des FORMATS : une fiche vendue en deux
                    conditionnements peut tenir sa cible sur l'un et pas sur
                    l'autre, et c'est le format qu'il faut retravailler. Le dire
                    évite de lire « 3 » comme trois produits. */}
                <span className="text-[11px] text-gray-400 tabular">
                  {stats.sousCible.length} format{stats.sousCible.length > 1 ? 's' : ''} sous la cible de marge de sa catégorie — le plus bas d&apos;abord
                </span>
              </div>
              {/* Toutes catégories mélangées : chaque ligne se juge contre SA
                  cible, l'en-tête ne peut donc pas en afficher une seule. */}
              <ListeFiches
                {...tableauCommun}
                lignes={[...stats.sousCible]
                  .sort((a, b) => (verdictAffiche(a, avecMainOeuvre).marge_pct ?? 0)
                    - (verdictAffiche(b, avecMainOeuvre).marge_pct ?? 0))}
                target={null}
                targetFor={l => targetByCat.get(catLabel(l.category)) ?? null}
                cibleTexte="cible propre à chaque catégorie"
              />
            </section>
          )}
          {grouped.map(([cat, list]) => (
            <section key={cat}>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-700 capitalize">{cat}</h2>
                <span className="text-[11px] text-gray-400 tabular">{list.length} format{list.length > 1 ? 's' : ''}</span>
                {/* Cible de marge de la catégorie — posée, modifiée ou retirée sur place */}
                {cat !== 'sans catégorie' && (editTarget?.cat === cat ? (
                  <span className="inline-flex items-center gap-1 bg-white border border-pilote-200 rounded-full pl-2.5 pr-1 py-0.5">
                    <span className="text-[11px] text-gray-400">cible</span>
                    <input autoFocus inputMode="decimal" value={editTarget.value}
                      onChange={e => setEditTarget(p => (p ? { ...p, value: e.target.value } : p))}
                      onKeyDown={e => { if (e.key === 'Enter') saveTarget(cat); if (e.key === 'Escape') setEditTarget(null) }}
                      placeholder="55"
                      className="w-10 text-xs tabular focus:outline-none" />
                    <span className="text-[11px] text-gray-400">%</span>
                    <button onClick={() => saveTarget(cat)} disabled={targetSaving}
                      className="w-5 h-5 rounded-full bg-pilote text-white flex items-center justify-center disabled:opacity-50" title="Enregistrer (champ vide = retirer la cible)">
                      <Check className="w-3 h-3" />
                    </button>
                    <button onClick={() => setEditTarget(null)}
                      className="w-5 h-5 rounded-full text-gray-400 hover:bg-gray-100 flex items-center justify-center" title="Annuler">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ) : (
                  <button onClick={() => setEditTarget({ cat, value: targetByCat.has(cat) ? String(targetByCat.get(cat)).replace('.', ',') : '' })}
                    title="Cible de marge de la catégorie — les fiches en dessous remontent dans « À retravailler ». Vider le champ pour la retirer."
                    className="text-[11px] font-semibold text-pilote bg-pilote-50 hover:bg-pilote-100 rounded-full px-2.5 py-0.5 transition-colors tabular">
                    {targetByCat.has(cat) ? `cible ${Number(targetByCat.get(cat)).toLocaleString('fr-FR')} %` : '+ cible de marge'}
                  </button>
                ))}
              </div>
              <ListeFiches
                {...tableauCommun}
                lignes={list}
                target={targetByCat.get(cat) ?? null}
              />
            </section>
          ))}

          {/* LES FICHES ARCHIVÉES — en bas, repliées (lot 123, modèle Otami).
              Visibles quand on les cherche, absentes quand on travaille. Le
              compte est écrit sur le pli : une section fantôme qui n'annonce
              pas ce qu'elle cache ne serait jamais ouverte. */}
          {archivees.length > 0 && (
            <section className="pt-2">
              <button type="button" onClick={() => setVoirArchivees(v => !v)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-pilote-200 rounded">
                <ChevronRight className={`w-3.5 h-3.5 transition-transform ${voirArchivees ? 'rotate-90' : ''}`} />
                Fiches archivées ({archivees.length.toLocaleString('fr-FR')})
              </button>
              {voirArchivees && (
                <div className="mt-3 bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
                  <ul className="divide-y divide-gray-50">
                    {archivees.map(r => (
                      <li key={r.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <Link href={`/dashboard/recettes/${r.id}`}
                            className="text-sm font-semibold text-gray-800 hover:text-pilote hover:underline truncate block" title={r.name}>
                            {r.name}
                          </Link>
                          <p className="text-[11px] text-gray-500 whitespace-nowrap">
                            archivée le {fmtDateArchive(r.archived_at)}
                          </p>
                        </div>
                        <button type="button" onClick={() => archiverFiche(r.id, false)} disabled={archivant !== null}
                          className="text-xs font-semibold text-pilote border border-pilote-200 hover:bg-pilote-50 disabled:opacity-50 rounded-xl px-3 py-1.5 whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-pilote-200">
                          {archivant === r.id ? 'Restauration…' : 'Restaurer'}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="px-4 py-2.5 border-t border-gray-100 text-[11px] text-gray-600">
                    Une fiche archivée garde tout — ingrédients, temps, formats — et ses coûts continuent
                    de servir aux fiches qui l’utilisent en sous-recette.
                  </p>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      <ModaleFiche m={{
        catLibre, coefField, coutIncomplet, creantRow, creerGenerique, editId, employees,
        etapesChrono, familles, form, genericById, generics, gesteSuivant, ings, laborRate,
        manquesBrouillon, nomsSansPrix, onCoefChange, onPvChange, optionsFamilles, pickGeneric,
        pickSub, pickerRow, preview, previewRate, recipeById, recipes, remove, rienAChiffrer,
        save, saving, setCatLibre, setForm, setIngs, setPickerRow, setShow, setUniteLibre,
        show, suggestions, uniteLibre,
        archiver: () => { if (editId) archiverFiche(editId, true) },
        archivant: archivant !== null,
      }} />
    </div>
  )
}
