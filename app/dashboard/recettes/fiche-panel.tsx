'use client'

// Le CONTENU de la fiche recette, en composant réutilisable :
//   · dans la LISTE (/dashboard/recettes) : encadré ouvert SUR PLACE au clic
//     d'une carte — zéro navigation, fermeture à la croix ou au re-clic ;
//   · dans la page /dashboard/recettes/[id] : la même fiche en pleine page
//     (liens directs, partage d'URL).
//
// TOUT SUR UNE SEULE PAGE (plus d'onglets ni d'argumentaire de vente) :
//   · bandeau de chiffres-clés — prix de vente TTC et COEFFICIENT modifiables
//     sur place (saisir l'un recalcule et enregistre l'autre : un seul chiffre
//     stocké, le PV TTC) ;
//   · paliers de quantité — « pour 20, temps ×1,8 » — enregistrés sur la fiche ;
//   · double tableau : à gauche les ÉTAPES (durée en minutes par étape, temps
//     total = leur somme), à droite les INGRÉDIENTS aux quantités du palier choisi.

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Pencil, Plus, X, Clock, ShoppingBasket, Package, AlertTriangle, Users, Printer, Copy } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { parseStoredSteps, parseStoredTiers } from '@/lib/recipes'

export type FicheIngredient = {
  generic_id: string | null; article_id: string | null; label: string
  /** Sous-recette : la ligne vise une autre fiche (unités de son rendement) */
  sub_recipe_id?: string | null
  sub_incomplete?: boolean
  quantity: number; qty_unit: string | null; unit: string | null; loss_pct: number | null
  manual_price_ht?: number | null
  unit_price_ht: number | null; price_source: string; categorie: 'ingredient' | 'emballage'
  /** Date de la facture d'où vient le prix mercuriale — l'âge du chiffre */
  price_date?: string | null
  qty_base: number; qty_brute: number; line_total_ht: number
}

/** Article générique de la mercuriale, tel que renvoyé par GET /api/recipes —
 *  nécessaire pour AJOUTER un ingrédient directement depuis la fiche. */
export type FicheGeneric = {
  id: string; name: string
  base_unit: 'kg' | 'piece'
  category: 'ingredient' | 'emballage'
  default_loss_pct: number
  price_ht: number | null
}

export type FicheCost = {
  matiere_ht: number; emballage_ht: number; main_oeuvre_ht: number; total_ht: number
  par_unite_ht: number | null; prix_manquants: number; labor_rate_ht: number | null
  total_minutes: number
  pv_unitaire_ht: number | null; marge_pct: number | null; coefficient: number | null
  /** Coût matière (+ emballage) du batch relu aux prix mercuriale de chaque
   *  jalon (8 lundis ISO + aujourd'hui) — jalons incomplets absents */
  matiere_series?: { d: string; v: number }[]
}

export type FicheRecipe = {
  id: string; name: string; category: string | null
  yield_qty: number | null; yield_unit: string | null
  labor_minutes: number; selling_price_ttc: number | null; tva_rate: number; notes: string | null
  employee_id: string | null
  fabrication_steps?: unknown
  time_tiers?: unknown
  ingredients: FicheIngredient[]
  cost: FicheCost
}

export type FicheEmployee = { id: string; name: string; loaded_rate: number | null }

type StepDraft = { text: string; minutes: string }
type TierDraft = { qty: string; mult: string }

const fmtEuro = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const fmtQty = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 3 })
const unitFr = (u: string | null) => (u === 'piece' ? 'pièce' : u || 'u')
const num = (s: string) => parseFloat(s.replace(',', '.')) || 0
const round2 = (n: number) => Math.round(n * 100) / 100

/** 45 → « 45 min » ; 90 → « 1 h 30 » */
function fmtMin(m: number): string {
  const r = Math.round(m)
  if (r < 60) return `${(Math.round(m * 10) / 10).toLocaleString('fr-FR')} min`
  return `${Math.floor(r / 60)} h ${String(r % 60).padStart(2, '0')}`
}

const fmtDateFr = (s: string) => new Date(s + 'T00:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** Âge d'une date de prix, en jours pleins. null si la date est illisible. */
function ageJours(d: string | null | undefined): number | null {
  if (!d) return null
  const t = new Date(String(d).slice(0, 10) + 'T00:00:00Z').getTime()
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.floor((Date.now() - t) / 86400000))
}

/** Mini-courbe du coût matière : x = jalon hebdomadaire, y = coût du batch.
 *  Trait navy, dernier point orange — même langage que la mercuriale. */
function TrendSpark({ points }: { points: { d: string; v: number }[] }) {
  const W = 160, H = 36, PAD = 4
  const vs = points.map(x => x.v)
  const min = Math.min(...vs), max = Math.max(...vs)
  const span = max - min
  const X = (i: number) => (points.length < 2 ? W / 2 : PAD + (i / (points.length - 1)) * (W - PAD * 2))
  const Y = (v: number) => (span === 0 ? H / 2 : H - PAD - ((v - min) / span) * (H - PAD * 2))
  const d = vs.map((v, i) => `${i === 0 ? 'M' : 'L'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-40 h-9 flex-shrink-0" role="img" aria-label="Coût matière sur les 8 dernières semaines">
      {points.length >= 2 && (
        <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="text-pilote" />
      )}
      <circle cx={X(points.length - 1)} cy={Y(vs[vs.length - 1] ?? 0)} r={3} className="fill-pilote-orange" />
    </svg>
  )
}

export default function FichePanel({
  recipe, employees, generics, target = null, historiqueIncomplet = false, onEditFull, onSaved, onClose,
}: {
  recipe: FicheRecipe
  employees: FicheEmployee[]
  /** L'historique de prix a été tronqué côté serveur : la courbe ci-dessous ne
   *  porte que sur ce qui a pu être lu. Une courbe qui rétrécit ressemble en
   *  tout point à un prix qui n'a pas bougé — il faut donc le dire. */
  historiqueIncomplet?: boolean
  /** Articles génériques de la mercuriale — pour l'ajout d'ingrédient sur place */
  generics: FicheGeneric[]
  /** Cible de marge de la catégorie de la fiche (R-A) — null : pas de cible posée */
  target?: number | null
  /** Ouvre l'édition complète (modale sur la liste, ?edit= en pleine page) */
  onEditFull: () => void
  /** Appelé après un enregistrement réussi (étapes, paliers, prix, ingrédients) */
  onSaved: () => void
  /** Absent en pleine page ; présent dans l'encadré de la liste */
  onClose?: () => void
}) {
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [steps, setSteps] = useState<StepDraft[]>(() =>
    parseStoredSteps(recipe.fabrication_steps).map(s => ({ text: s.text, minutes: s.minutes !== null ? String(s.minutes) : '' })))
  const [tiers, setTiers] = useState<TierDraft[]>(() =>
    parseStoredTiers(recipe.time_tiers).map(t => ({ qty: String(t.qty), mult: String(t.mult) })))
  const [selTier, setSelTier] = useState<number | null>(null)
  const [newTier, setNewTier] = useState<TierDraft | null>(null)
  // Édition sur place du PV TTC / du coefficient (un seul champ à la fois)
  const [editKpi, setEditKpi] = useState<{ field: 'pv' | 'coef'; value: string } | null>(null)
  const kpiCancelRef = useRef(false)
  // Ajout d'ingrédient directement depuis le tableau (comme les étapes)
  const [newIng, setNewIng] = useState<{ query: string; generic: FicheGeneric | null; qty: string; unit: 'kg' | 'g' | 'piece'; loss: string } | null>(null)
  // Retrait d'ingrédient en deux clics (jamais de confirm() natif)
  const [confirmIng, setConfirmIng] = useState<number | null>(null)

  const c = recipe.cost
  const employeeName = useMemo(() =>
    recipe.employee_id ? (employees.find(e => e.id === recipe.employee_id)?.name ?? null) : null,
  [recipe, employees])

  // ── Temps : somme LIVE des étapes chronométrées, repli labor_minutes ──
  const stepMins = steps.map(s => num(s.minutes))
  const hasTimed = stepMins.some(m => m > 0)
  const baseMinutes = hasTimed ? Math.round(stepMins.reduce((a, b) => a + b, 0) * 10) / 10 : (Number(recipe.labor_minutes) || 0)

  // ── Palier sélectionné : quantités ×ratio, temps ×multiple ──
  const baseQty = Number(recipe.yield_qty) || 0
  const sel = selTier !== null && tiers[selTier] ? { qty: num(tiers[selTier].qty), mult: num(tiers[selTier].mult) } : null
  const active = sel && sel.qty > 0 && sel.mult > 0 ? sel : null
  const ratio = active && baseQty > 0 ? active.qty / baseQty : 1
  const timeMult = active ? active.mult : 1
  const scaledMinutes = baseMinutes * timeMult

  // Poids total des lignes en g/kg (les pièces sont hors assiette de poids).
  // NET *et* BRUT : chaque ligne du tableau affiche sa quantité BRUTE — ce qu'on
  // sort du frigo, perte comprise — alors que le pied ne sommait que le NET,
  // dans la même colonne. Sur une fiche à 15 % de perte l'écart saute aux yeux
  // et jette le doute sur le reste des chiffres. Les deux sont affichés.
  const poids = useMemo(() => recipe.ingredients.reduce((acc, i) => {
    if (i.generic_id && (i.qty_unit === 'kg' || i.qty_unit === 'g')) return { net: acc.net + i.qty_base, brut: acc.brut + i.qty_brute }
    if (!i.generic_id && (i.unit || '').toLowerCase().includes('kg')) {
      const q = Number(i.quantity) || 0
      return { net: acc.net + q, brut: acc.brut + (Number(i.qty_brute) || q) }
    }
    return acc
  }, { net: 0, brut: 0 }), [recipe])

  const coutMatiere = (c?.matiere_ht ?? 0) + (c?.emballage_ht ?? 0)
  const coutUnite = c ? (c.par_unite_ht ?? c.total_ht) : null
  // Ingrédients comptés pour ZÉRO dans le coût, nommés. Le moteur refuse déjà de
  // publier marge et coefficient quand il en reste (lib/recipes.ts) ; la
  // conversion coefficient → prix de vente, elle, passait quand même : le coût
  // sous-évalué produisait un prix trop bas, enregistré et affiché en boutique.
  // Chaque ingrédient sans prix porte de quoi ALLER LE CORRIGER : l'article
  // générique visé, ou la sous-fiche fautive. Le bandeau renvoyait jusqu'ici
  // vers la page Mercuriale entière — un catalogue de 125 lignes à fouiller
  // pour retrouver l'article dont on venait de lire le nom.
  const sansPrix = useMemo(
    () => recipe.ingredients
      .filter(i => i.price_source === 'aucun' || i.sub_incomplete === true)
      .map(i => ({
        nom: (i.label || '').trim() || 'ingrédient sans nom',
        href: i.sub_recipe_id
          ? `/dashboard/recettes/${i.sub_recipe_id}`
          : i.generic_id ? `/dashboard/mercuriale?generic=${i.generic_id}` : null,
      })),
    [recipe.ingredients],
  )
  const nomsSansPrix = sansPrix.slice(0, 3).map(x => x.nom).join(', ') + (sansPrix.length > 3 ? `, +${sansPrix.length - 3}` : '')
  /** Le prix mercuriale le PLUS ANCIEN de la fiche — le niveau de confiance du
   *  coût de revient tient à lui. Signalé seulement au-delà de 30 jours : en
   *  deçà, « prix du jour » reste une description honnête. */
  const prixLePlusAncien = useMemo(() => {
    let pire: { date: string; jours: number; nom: string } | null = null
    for (const i of recipe.ingredients) {
      if (i.price_source !== 'mercuriale' || !i.price_date) continue
      const j = ageJours(i.price_date)
      if (j === null || j <= 30) continue
      if (!pire || j > pire.jours) pire = { date: String(i.price_date).slice(0, 10), jours: j, nom: (i.label || '').trim() || 'un ingrédient' }
    }
    return pire
  }, [recipe.ingredients])
  const coutIncomplet = (c?.prix_manquants ?? 0) > 0
  // Coût matière (« food cost ») : part de la matière SEULE dans le PV HT d'une
  // unité — calculable uniquement quand rendement et prix de vente sont connus.
  const foodCostPct = c && c.pv_unitaire_ht !== null && c.pv_unitaire_ht > 0 && baseQty > 0
    ? Math.round(((c.matiere_ht / baseQty) / c.pv_unitaire_ht) * 100)
    : null
  // Couleur de la marge : contre la CIBLE de la catégorie si elle existe,
  // sinon les repères historiques 50/30.
  const margeColor = c === null || c.marge_pct === null
    ? 'text-gray-900'
    : target != null
      ? (c.marge_pct >= target ? 'text-green-600' : c.marge_pct >= target - 10 ? 'text-orange-500' : 'text-red-600')
      : (c.marge_pct >= 50 ? 'text-green-600' : c.marge_pct >= 30 ? 'text-orange-500' : 'text-red-600')
  // Coût du palier : matière ×ratio (linéaire), MO ×multiple (économie d'échelle)
  const moScaled = c?.labor_rate_ht != null ? round2(scaledMinutes / 60 * c.labor_rate_ht) : 0
  const coutScaled = round2(coutMatiere * ratio + moScaled)

  /** Lignes d'ingrédients ACTUELLES au format d'écriture de l'API (PUT = remplacement
   *  complet) — sub_recipe_id DOIT voyager, sinon un enregistrement d'étapes ou de
   *  paliers déferait les sous-recettes de la fiche. */
  const ingPayload = () => recipe.ingredients.map(i => ({
    generic_id: i.generic_id, article_id: i.article_id, sub_recipe_id: i.sub_recipe_id ?? null, label: i.label,
    quantity: i.quantity, qty_unit: i.qty_unit, unit: i.unit,
    loss_pct: i.loss_pct, manual_price_ht: i.manual_price_ht ?? null,
  }))

  async function saveAll(extra?: { selling_price_ttc?: number | null; ingredients?: ReturnType<typeof ingPayload> }) {
    if (saving) return
    setSaving(true)
    const res = await fetch(`/api/recipes/${recipe.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: recipe.name, category: recipe.category,
        yield_qty: recipe.yield_qty, yield_unit: recipe.yield_unit,
        labor_minutes: recipe.labor_minutes,
        selling_price_ttc: extra && 'selling_price_ttc' in extra ? extra.selling_price_ttc : recipe.selling_price_ttc,
        tva_rate: recipe.tva_rate, notes: recipe.notes, employee_id: recipe.employee_id,
        fabrication_steps: steps
          .filter(s => s.text.trim())
          .map(s => ({ text: s.text.trim(), minutes: num(s.minutes) > 0 ? num(s.minutes) : null })),
        time_tiers: tiers
          .map(t => ({ qty: num(t.qty), mult: num(t.mult) }))
          .filter(t => t.qty > 0 && t.mult > 0),
        ...(extra?.ingredients ? { ingredients: extra.ingredients } : {}),
      }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    setSaving(false)
    if (res?.ok) { toast({ variant: 'success', title: 'Fiche enregistrée' }); setDirty(false); onSaved() }
    else toast({ variant: 'error', title: 'Enregistrement impossible', description: data?.error || 'Réessayez.' })
  }

  /** Duplique la fiche entière — champs, étapes chronométrées, paliers et
   *  ingrédients — sous « (copie) », puis ouvre la copie.
   *
   *  Les cinq fiches vont devenir cinquante, dont une bonne moitié de variantes
   *  (saucisse nature / herbes / piment, terrine 500 g / 1 kg). Sans ce bouton,
   *  chaque variante se ressaisit intégralement : douze ingrédients, les pertes,
   *  les étapes minutées, les paliers. La route POST accepte déjà tout — c'est
   *  de la réutilisation, pas du nouveau code serveur. */
  async function dupliquer() {
    if (saving) return
    setSaving(true)
    const res = await fetch('/api/recipes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // 80 caractères maximum côté serveur : on rogne le nom, pas le suffixe,
        // sinon dupliquer une fiche au nom long échouerait sur un 400 obscur.
        name: `${recipe.name.slice(0, 72).trim()} (copie)`,
        category: recipe.category,
        yield_qty: recipe.yield_qty, yield_unit: recipe.yield_unit,
        labor_minutes: recipe.labor_minutes,
        // Le PV n'est PAS repris : une variante n'a aucune raison de se vendre
        // au même prix, et un prix hérité en silence est un prix qu'on oublie.
        selling_price_ttc: null,
        tva_rate: recipe.tva_rate, notes: recipe.notes, employee_id: recipe.employee_id,
        fabrication_steps: parseStoredSteps(recipe.fabrication_steps),
        time_tiers: parseStoredTiers(recipe.time_tiers),
        ingredients: ingPayload(),
      }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    setSaving(false)
    if (!res?.ok || !data?.id) {
      toast({ variant: 'error', title: 'Duplication impossible', description: data?.error || 'Réessayez.' })
      return
    }
    toast({ variant: 'success', title: 'Copie créée', description: 'Le prix de vente est à poser sur la copie.' })
    window.location.href = `/dashboard/recettes/${data.id}`
  }

  /** Ajoute l'ingrédient choisi et enregistre aussitôt (la liste est REMPLACÉE côté API) */
  function addIngredient() {
    if (!newIng?.generic || num(newIng.qty) <= 0) return
    const g = newIng.generic
    saveAll({
      ingredients: [...ingPayload(), {
        generic_id: g.id, article_id: null, sub_recipe_id: null, label: g.name,
        quantity: num(newIng.qty),
        qty_unit: g.base_unit === 'kg' ? (newIng.unit === 'g' ? 'g' : 'kg') : 'piece',
        unit: null, loss_pct: num(newIng.loss), manual_price_ht: null,
      }],
    })
    setNewIng(null)
  }

  /** Retire une ligne (2e clic) — au moins un ingrédient doit rester */
  function removeIngredient(idx: number) {
    if (confirmIng !== idx) { setConfirmIng(idx); return }
    setConfirmIng(null)
    if (recipe.ingredients.length <= 1) {
      toast({ variant: 'error', title: 'Une recette garde au moins un ingrédient' })
      return
    }
    saveAll({ ingredients: ingPayload().filter((_, i) => i !== idx) })
  }

  /** Valide l'édition sur place du PV ou du coef → recalcule et enregistre le PV TTC */
  function commitKpi() {
    if (kpiCancelRef.current) { kpiCancelRef.current = false; setEditKpi(null); return }
    if (!editKpi) return
    const v = num(editKpi.value)
    setEditKpi(null)
    if (v <= 0) return
    if (editKpi.field === 'pv') {
      if (recipe.selling_price_ttc !== null && Math.abs(v - recipe.selling_price_ttc) < 0.005) return
      saveAll({ selling_price_ttc: round2(v) })
      return
    }
    // Coefficient saisi → PV TTC = coût de revient × coef, remis en TTC
    if (coutUnite === null || coutUnite <= 0) {
      toast({ variant: 'error', title: 'Coût de revient inconnu', description: 'Renseignez d’abord les ingrédients (et leurs prix) pour calculer un prix depuis le coefficient.' })
      return
    }
    // Un coût dont il manque un prix est SOUS-ESTIMÉ : le multiplier par un coef
    // donnerait un prix de vente trop bas, enregistré tel quel et affiché en
    // boutique. On refuse, en nommant ce qui manque.
    if (coutIncomplet) {
      toast({
        variant: 'error', title: 'Coût incomplet — prix non calculable',
        description: `${nomsSansPrix} sans prix : ${sansPrix.length > 1 ? 'ils comptent' : 'il compte'} pour 0 €, le coût est sous-estimé et le prix obtenu serait trop bas. Renseignez le prix depuis la Mercuriale, ou saisissez le prix de vente directement.`,
      })
      return
    }
    const pvTTC = round2(coutUnite * v * (1 + (Number(recipe.tva_rate) || 0) / 100))
    saveAll({ selling_price_ttc: pvTTC })
  }

  function kpiInput() {
    if (!editKpi) return null
    return (
      <input
        autoFocus inputMode="decimal" value={editKpi.value}
        onChange={e => setEditKpi(p => (p ? { ...p, value: e.target.value } : p))}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') { kpiCancelRef.current = true; e.currentTarget.blur() }
        }}
        onBlur={commitKpi}
        className="w-full bg-transparent text-xl font-extrabold tracking-tight text-gray-900 tabular border-b-2 border-pilote-orange focus:outline-none mt-1"
      />
    )
  }

  const uniteLabel = recipe.yield_unit || 'unités'

  return (
    <div className="bg-white rounded-2xl border border-pilote-100 shadow-card-hover overflow-hidden">
      {/* Bandeau d'identité de l'encadré */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3 flex-wrap bg-pilote-50/40">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-extrabold tracking-tight text-gray-900 truncate">{recipe.name}</h2>
            {recipe.category && (
              <span className="text-[10px] font-semibold uppercase tracking-wider text-pilote bg-pilote-50 ring-1 ring-pilote-100 rounded-full px-2.5 py-1">{recipe.category}</span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {recipe.yield_qty ? `Base : ${fmtQty(recipe.yield_qty)} ${uniteLabel} par batch` : 'Rendement non renseigné'}
            {/* « Prix du jour » sans nuance était une promesse que les données
                ne tiennent pas toujours : le plus ancien prix de la fiche peut
                dater de plusieurs mois. On dit lequel, et depuis quand. */}
            {prixLePlusAncien
              ? <>{' · '}coûts aux prix de la mercuriale — le plus ancien remonte au {fmtDateFr(prixLePlusAncien.date)} ({prixLePlusAncien.jours} j, {prixLePlusAncien.nom})</>
              : <>{' · '}coûts au prix du jour de la mercuriale</>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {dirty && (
            <button onClick={() => saveAll()} disabled={saving}
              className="text-xs font-bold text-white bg-pilote hover:bg-pilote-hover rounded-xl px-3.5 py-2 shadow-card active:scale-[0.98] transition-all disabled:opacity-50">
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          )}
          <button onClick={() => window.open(`/api/recipes/${recipe.id}/pdf`, '_blank')}
            title="Fiche atelier à imprimer pour le classeur — sans coûts, prix ni marges"
            className="flex items-center gap-1.5 text-xs font-bold text-pilote border border-pilote-200 bg-white rounded-xl px-3.5 py-2 hover:bg-pilote-50 transition-colors">
            <Printer className="w-3.5 h-3.5" />Imprimer
          </button>
          <button onClick={dupliquer} disabled={saving}
            title="Créer une variante : mêmes ingrédients, mêmes étapes et paliers, sans le prix de vente"
            className="flex items-center gap-1.5 text-xs font-bold text-pilote border border-pilote-200 bg-white rounded-xl px-3.5 py-2 hover:bg-pilote-50 transition-colors disabled:opacity-50">
            <Copy className="w-3.5 h-3.5" />Dupliquer
          </button>
          <button onClick={onEditFull}
            className="flex items-center gap-1.5 text-xs font-bold text-pilote border border-pilote-200 bg-white rounded-xl px-3.5 py-2 hover:bg-pilote-50 transition-colors">
            <Pencil className="w-3.5 h-3.5" />Modifier la fiche
          </button>
          {onClose && (
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-white text-gray-400 hover:text-gray-700 transition-colors" title="Fermer la fiche">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="p-5">
        {/* Chiffres-clés — PV TTC et coefficient MODIFIABLES sur place */}
        {c && (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
            <div className="rounded-2xl bg-pilote p-4 shadow-card">
              <p className="text-[10px] font-semibold text-pilote-200 uppercase tracking-wider">Coût de revient</p>
              <p className="text-xl font-extrabold tracking-tight text-white tabular mt-1">
                {c.par_unite_ht !== null ? fmtEuro(c.par_unite_ht) : fmtEuro(c.total_ht)}
              </p>
              {/* « Matière » désignait deux montants différents à quelques
                  centimètres l'un de l'autre : le total du tableau inclut
                  l'emballage, ce pourcentage l'exclut. Le food cost du métier
                  exclut l'emballage — c'est donc le libellé qui est précisé. */}
              <p className="text-[11px] text-pilote-200 mt-0.5 tabular">
                {c.par_unite_ht !== null ? `/ ${recipe.yield_unit || 'unité'}` : '/ batch'}
                {foodCostPct !== null ? ` · matière seule ${foodCostPct} % du PV HT` : ''}
              </p>
            </div>

            <div className="rounded-2xl bg-white border border-gray-100 shadow-card p-4 group cursor-pointer hover:border-pilote-200 transition-colors"
              onClick={() => !editKpi && setEditKpi({ field: 'pv', value: recipe.selling_price_ttc != null ? String(recipe.selling_price_ttc).replace('.', ',') : '' })}>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                Prix de vente TTC <Pencil className="w-2.5 h-2.5 text-gray-300 group-hover:text-pilote transition-colors" />
              </p>
              {editKpi?.field === 'pv' ? kpiInput() : (
                <p className="text-xl font-extrabold tracking-tight text-gray-900 tabular mt-1">{recipe.selling_price_ttc != null ? fmtEuro(recipe.selling_price_ttc) : '—'}</p>
              )}
              <p className="text-[11px] text-gray-400 mt-0.5">{c.pv_unitaire_ht !== null ? `${fmtEuro(c.pv_unitaire_ht)} HT` : 'cliquer pour saisir'}</p>
            </div>

            <div className={`rounded-2xl bg-white border border-gray-100 shadow-card p-4 group transition-colors ${coutIncomplet ? 'cursor-not-allowed' : 'cursor-pointer hover:border-pilote-200'}`}
              onClick={() => {
                if (editKpi) return
                if (coutIncomplet) {
                  toast({
                    variant: 'error', title: 'Coût incomplet — coefficient inutilisable',
                    description: `${nomsSansPrix} sans prix : le coût est sous-estimé, un prix calculé dessus serait trop bas.`,
                  })
                  return
                }
                setEditKpi({ field: 'coef', value: c.coefficient !== null ? String(c.coefficient).replace('.', ',') : '' })
              }}>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                Coef multiplicateur {!coutIncomplet && <Pencil className="w-2.5 h-2.5 text-gray-300 group-hover:text-pilote transition-colors" />}
              </p>
              {editKpi?.field === 'coef' ? kpiInput() : (
                <p className="text-xl font-extrabold tracking-tight text-gray-900 tabular mt-1">{c.coefficient !== null ? `×${c.coefficient.toLocaleString('fr-FR')}` : '—'}</p>
              )}
              <p className="text-[11px] text-gray-400 mt-0.5">{coutIncomplet ? 'coût incomplet — prix non calculable' : 'saisir un coef fixe le PV'}</p>
            </div>

            <div className="rounded-2xl bg-white border border-gray-100 shadow-card p-4">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Taux de marge</p>
              <p className={`text-xl font-extrabold tracking-tight tabular mt-1 ${margeColor}`}>
                {c.marge_pct !== null ? `${c.marge_pct.toLocaleString('fr-FR')} %` : '—'}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5 tabular">
                {c.pv_unitaire_ht !== null && c.par_unite_ht !== null ? `marge ${fmtEuro(c.pv_unitaire_ht - c.par_unite_ht)}` : 'du PV HT'}
                {target != null ? ` · cible ${target.toLocaleString('fr-FR')} %` : ''}
              </p>
            </div>

            <div className="rounded-2xl bg-white border border-gray-100 shadow-card p-4">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Temps de fabrication</p>
              <p className="text-xl font-extrabold tracking-tight text-gray-900 tabular mt-1">{fmtMin(baseMinutes)}</p>
              <p className="text-[11px] text-gray-400 mt-0.5 tabular">MO {fmtEuro(c.main_oeuvre_ht)}{c.labor_rate_ht != null ? ` · ${fmtEuro(c.labor_rate_ht)}/h` : ''}</p>
            </div>
          </div>
        )}

        {c && c.prix_manquants > 0 && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 flex items-start gap-2 text-xs text-amber-800">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>
              {c.prix_manquants} ingrédient{c.prix_manquants > 1 ? 's' : ''} sans prix
              {sansPrix.length > 0 && (
                <> — {sansPrix.map((x, i) => (
                  <span key={`${x.nom}-${i}`}>
                    {i > 0 ? ', ' : ''}
                    {x.href
                      ? <Link href={x.href} className="font-bold underline hover:text-amber-950">{x.nom}</Link>
                      : <span className="font-bold">{x.nom}</span>}
                  </span>
                ))}</>
              )}
              {' '}: {c.prix_manquants > 1 ? 'ils comptent' : 'il compte'} pour 0 €, le coût affiché est donc <span className="font-semibold">sous-estimé</span> et la marge ne peut pas être calculée. Cliquez un nom pour aller lui donner un prix.
            </span>
          </div>
        )}

        {/* ── Coût matière dans le temps : la fiche relue aux prix d'hier ── */}
        {c && Array.isArray(c.matiere_series) && c.matiere_series.length >= 2 && (() => {
          const s = c.matiere_series
          const first = s[0], last = s[s.length - 1]
          const delta = round2(last.v - first.v)
          const stable = Math.abs(delta) < 0.005
          const deltaUnit = baseQty > 0 ? round2(delta / baseQty) : null
          // Marge qu'aurait la fiche au coût du début de période, à PV inchangé
          let margeAvant: number | null = null
          if (!stable && c.pv_unitaire_ht !== null && c.pv_unitaire_ht > 0 && c.par_unite_ht !== null && deltaUnit !== null) {
            margeAvant = Math.round(((c.pv_unitaire_ht - (c.par_unite_ht - deltaUnit)) / c.pv_unitaire_ht) * 1000) / 10
          }
          return (
            <div className="mb-4 rounded-2xl border border-gray-100 bg-gray-50/60 px-4 py-3 flex items-center gap-4 flex-wrap">
              <div className="min-w-[240px] flex-1">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Coût matière — 8 dernières semaines</p>
                <p className="text-xs text-gray-600 mt-1 tabular">
                  {stable ? (
                    <>Stable depuis le {fmtDateFr(first.d)} — {fmtEuro(last.v)} le batch, aux prix mercuriale relus à chaque date.</>
                  ) : (
                    <>
                      {fmtEuro(first.v)} le {fmtDateFr(first.d)} → {fmtEuro(last.v)} aujourd&apos;hui :{' '}
                      <span className={`font-bold ${delta > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {delta > 0 ? '+' : '−'}{fmtEuro(Math.abs(delta))} / batch
                        {deltaUnit !== null && Math.abs(deltaUnit) >= 0.005 ? ` (${delta > 0 ? '+' : '−'}${fmtEuro(Math.abs(deltaUnit))} / ${unitFr(recipe.yield_unit)})` : ''}
                      </span>
                      {margeAvant !== null && c.marge_pct !== null && (
                        <> · à PV inchangé, marge <span className="font-bold tabular">{margeAvant.toLocaleString('fr-FR')} %</span> → <span className={`font-bold tabular ${delta > 0 ? 'text-red-600' : 'text-green-600'}`}>{c.marge_pct.toLocaleString('fr-FR')} %</span></>
                      )}
                    </>
                  )}
                </p>
              </div>
              <TrendSpark points={s} />
            </div>
          )
        })()}

        {/* Historique tronqué : la courbe est partielle, ou absente faute de
            points. Le silence donnerait à lire « le prix n'a pas bougé ». */}
        {historiqueIncomplet && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 flex items-start gap-2 text-xs text-amber-800">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>L&apos;historique des prix n&apos;a pas pu être lu en entier : la courbe du coût matière ci-dessus est partielle. Actualisez ; si le message persiste, signalez-le.</span>
          </div>
        )}

        {/* ── Paliers de quantité : pour N produits, temps ×multiple ── */}
        <div className="mb-4 rounded-2xl border border-gray-100 bg-gray-50/60 px-4 py-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mr-1">Quantité produite</span>
            <button onClick={() => setSelTier(null)}
              className={`text-xs font-semibold rounded-full px-3 py-1.5 transition-colors tabular ${selTier === null ? 'bg-pilote text-white shadow-card' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'}`}>
              Base{baseQty > 0 ? ` · ${fmtQty(baseQty)} ${uniteLabel}` : ''} · {fmtMin(baseMinutes)}
            </button>
            {tiers.map((t, i) => (
              <span key={i} className={`inline-flex items-center gap-1 rounded-full transition-colors tabular ${selTier === i ? 'bg-pilote text-white shadow-card' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'}`}>
                <button onClick={() => setSelTier(prev => prev === i ? null : i)} className="text-xs font-semibold pl-3 py-1.5">
                  {fmtQty(num(t.qty))} {uniteLabel} · ×{num(t.mult).toLocaleString('fr-FR')}
                </button>
                <button onClick={() => { setTiers(prev => prev.filter((_, j) => j !== i)); setSelTier(p => (p === i ? null : p !== null && p > i ? p - 1 : p)); setDirty(true) }}
                  className={`pr-2 py-1.5 ${selTier === i ? 'text-white/60 hover:text-white' : 'text-gray-300 hover:text-gray-600'}`} title="Retirer ce palier">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            {newTier ? (
              <span className="inline-flex items-center gap-1.5 bg-white border border-pilote-200 rounded-full pl-3 pr-1.5 py-1">
                <input autoFocus inputMode="decimal" value={newTier.qty} placeholder="Qté"
                  onChange={e => setNewTier(p => (p ? { ...p, qty: e.target.value } : p))}
                  className="w-12 text-xs tabular focus:outline-none" />
                <span className="text-[11px] text-gray-400">{uniteLabel} → ×</span>
                <input inputMode="decimal" value={newTier.mult} placeholder="1,8"
                  onChange={e => setNewTier(p => (p ? { ...p, mult: e.target.value } : p))}
                  onKeyDown={e => { if (e.key === 'Enter' && num(newTier.qty) > 0 && num(newTier.mult) > 0) { setTiers(prev => [...prev, newTier]); setNewTier(null); setDirty(true) } }}
                  className="w-10 text-xs tabular focus:outline-none" />
                <button onClick={() => { if (num(newTier.qty) > 0 && num(newTier.mult) > 0) { setTiers(prev => [...prev, newTier]); setNewTier(null); setDirty(true) } }}
                  className="w-6 h-6 rounded-full bg-pilote text-white flex items-center justify-center"><Plus className="w-3 h-3" /></button>
                <button onClick={() => setNewTier(null)} className="w-6 h-6 rounded-full text-gray-400 hover:bg-gray-100 flex items-center justify-center"><X className="w-3 h-3" /></button>
              </span>
            ) : (
              <button onClick={() => setNewTier({ qty: '', mult: '' })}
                className="inline-flex items-center gap-1 text-xs font-semibold text-pilote border border-dashed border-pilote-200 rounded-full px-3 py-1.5 hover:bg-pilote-50 transition-colors">
                <Plus className="w-3 h-3" />Palier
              </button>
            )}
          </div>
          {active ? (
            <p className="text-xs text-gray-600 mt-2 tabular">
              Pour <span className="font-bold">{fmtQty(active.qty)} {uniteLabel}</span> : temps <span className="font-bold">{fmtMin(scaledMinutes)}</span> (×{active.mult.toLocaleString('fr-FR')})
              {baseQty > 0 && c ? <> · matière {fmtEuro(round2(coutMatiere * ratio))} · MO {fmtEuro(moScaled)} · coût total <span className="font-bold">{fmtEuro(coutScaled)}</span>{active.qty > 0 ? <> soit {fmtEuro(round2(coutScaled / active.qty))} / {unitFr(recipe.yield_unit)}</> : null}</> : null}
              {baseQty <= 0 && <> · renseignez la production par batch (« Modifier la fiche ») pour multiplier aussi les ingrédients</>}
            </p>
          ) : (
            <p className="text-[11px] text-gray-400 mt-2">Un palier = « pour tant de {uniteLabel}, le temps de base est multiplié par tant » — ex. 20 → ×1,8. Cliquez un palier pour lire temps, quantités et coûts correspondants.</p>
          )}
        </div>

        {/* ── Double tableau : étapes à gauche, ingrédients à droite ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          {/* Étapes de fabrication */}
          <div className="rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 flex items-center justify-between gap-2">
              <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Étapes de fabrication</h3>
              <span className="text-[11px] text-gray-400 tabular">durées en min</span>
            </div>
            <div className="p-3 space-y-2">
              {steps.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-5">Ajoutez les étapes du procédé — chaque étape porte sa durée, le temps total est leur somme.</p>
              )}
              {steps.map((s, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="w-6 h-6 rounded-full bg-pilote-50 text-pilote text-[11px] font-extrabold flex items-center justify-center flex-shrink-0 mt-1.5">{i + 1}</span>
                  <textarea value={s.text} rows={2}
                    onChange={e => { setSteps(prev => prev.map((x, j) => j === i ? { ...x, text: e.target.value } : x)); setDirty(true) }}
                    placeholder={`Étape ${i + 1}…`}
                    className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200 resize-y min-w-0" />
                  <div className="relative flex-shrink-0 mt-1">
                    <input inputMode="decimal" value={s.minutes} title="Durée de l'étape (minutes)"
                      onChange={e => { setSteps(prev => prev.map((x, j) => j === i ? { ...x, minutes: e.target.value } : x)); setDirty(true) }}
                      placeholder="—"
                      className="w-16 border border-gray-200 rounded-lg pl-2 pr-7 py-1.5 text-sm text-right tabular focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">min</span>
                  </div>
                  {active && num(s.minutes) > 0 && (
                    <span className="text-[11px] text-pilote font-semibold tabular flex-shrink-0 mt-2.5 w-12 text-right" title={`Durée pour ${fmtQty(active.qty)} ${uniteLabel}`}>
                      {(Math.round(num(s.minutes) * timeMult * 10) / 10).toLocaleString('fr-FR')}
                    </span>
                  )}
                  <button onClick={() => { setSteps(prev => prev.filter((_, j) => j !== i)); setDirty(true) }}
                    className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 flex-shrink-0 mt-1"><X className="w-3.5 h-3.5" /></button>
                </div>
              ))}
              <button onClick={() => { setSteps(prev => [...prev, { text: '', minutes: '' }]); setDirty(true) }}
                className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-gray-500 border-2 border-dashed border-gray-200 rounded-xl py-2 hover:border-pilote-200 hover:text-pilote transition-colors">
                <Plus className="w-3.5 h-3.5" />Ajouter une étape
              </button>
            </div>
            <div className="px-4 py-2.5 bg-pilote text-white flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-white/60 flex items-center gap-1.5"><Clock className="w-3 h-3" />Temps total</span>
              <span className="font-bold tabular text-sm">
                {active ? <>{fmtMin(scaledMinutes)} <span className="text-white/60 font-semibold">(base {fmtMin(baseMinutes)})</span></> : fmtMin(baseMinutes)}
              </span>
            </div>
            {!hasTimed && (Number(recipe.labor_minutes) || 0) > 0 && (
              <p className="px-4 py-2 text-[11px] text-amber-600 border-t border-gray-100">Étapes non chronométrées — temps repris du champ « minutes » de la fiche ({recipe.labor_minutes} min). Renseignez les durées pour un temps calculé.</p>
            )}
          </div>

          {/* Ingrédients — aux quantités du palier choisi */}
          <div className="rounded-2xl border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto max-h-[30rem] overflow-y-auto">
              <table className="w-full min-w-[420px]">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-gray-50 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                    <th className="px-3.5 py-2.5 text-left">Ingrédient</th>
                    <th className="px-3.5 py-2.5 text-right">Qté{active ? ` (×${(Math.round(ratio * 100) / 100).toLocaleString('fr-FR')})` : ''}</th>
                    <th className="px-3.5 py-2.5 text-right">Coût (€)</th>
                    <th className="px-3.5 py-2.5 text-right">%</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {recipe.ingredients.map((ing, i) => {
                    const coutPct = coutMatiere > 0 ? (ing.line_total_ht / coutMatiere) * 100 : null
                    const loss = Number(ing.loss_pct) || 0
                    const uniteAffichee = ing.generic_id ? (ing.qty_unit === 'piece' ? 'pièce' : ing.qty_unit || '') : (ing.unit || '')
                    return (
                      <tr key={i} className="group border-t border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="px-3.5 py-2.5">
                          <span className="text-sm font-semibold text-gray-900">{ing.label}</span>
                          {ing.categorie === 'emballage' && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wider text-blue-700 bg-blue-50 rounded px-1.5 py-0.5">Emballage</span>}
                          {ing.sub_recipe_id && (
                            <Link href={`/dashboard/recettes/${ing.sub_recipe_id}`}
                              title="Sous-recette — coût complet de la fiche ÷ son rendement, relu en continu. Cliquer pour l'ouvrir."
                              className="ml-1.5 text-[10px] font-semibold uppercase tracking-wider text-pilote bg-pilote-50 ring-1 ring-pilote-100 rounded px-1.5 py-0.5 hover:bg-pilote-100 transition-colors">
                              Sous-recette
                            </Link>
                          )}
                          {ing.price_source === 'aucun' && <span className="ml-1.5 text-[10px] font-semibold text-amber-600">{ing.sub_recipe_id ? 'rendement de la sous-fiche requis' : 'prix manquant'}</span>}
                          {ing.price_source === 'manuel' && <span className="ml-1.5 text-[10px] text-gray-400">prix manuel</span>}
                          {ing.sub_incomplete && <span className="ml-1.5 text-[10px] font-semibold text-amber-600">coût de la sous-fiche incomplet</span>}
                          {/* De QUAND date ce prix. Même code que la mercuriale :
                              au-delà de 30 jours, l'orange signale que le chiffre
                              a vieilli — c'est sur lui que se décide un PV. */}
                          {ing.price_source === 'mercuriale' && ing.price_date && (() => {
                            const j = ageJours(ing.price_date)
                            if (j === null) return null
                            return (
                              <span className={`ml-1.5 text-[10px] tabular ${j > 30 ? 'font-semibold text-orange-500' : 'text-gray-400'}`}
                                title={`Dernière facture connue pour cet article : ${fmtDateFr(ing.price_date)}`}>
                                prix du {fmtDateFr(ing.price_date)}{j > 30 ? ` · ${j} j` : ''}
                              </span>
                            )
                          })()}
                        </td>
                        <td className="px-3.5 py-2.5 text-right tabular">
                          <span className="text-sm font-semibold text-gray-900">{fmtQty(ing.quantity * ratio)} {uniteAffichee}</span>
                          {loss > 0 && <p className="text-[11px] text-gray-400">({fmtQty(ing.qty_brute * ratio)} {ing.generic_id ? unitFr(ing.qty_unit === 'g' ? 'kg' : ing.qty_unit) : uniteAffichee} brut · perte {loss.toLocaleString('fr-FR')} %)</p>}
                        </td>
                        <td className="px-3.5 py-2.5 text-right text-sm font-semibold text-gray-900 tabular">{ing.unit_price_ht !== null ? fmtEuro(ing.line_total_ht * ratio) : '—'}</td>
                        <td className="px-3.5 py-2.5 text-right text-sm text-gray-600 tabular">{coutPct !== null && ing.unit_price_ht !== null ? `${Math.round(coutPct)} %` : '—'}</td>
                        <td className="pr-2 text-right">
                          {confirmIng === i ? (
                            <button onClick={() => removeIngredient(i)} onBlur={() => setConfirmIng(null)}
                              className="text-[10px] font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg px-1.5 py-1 whitespace-nowrap" title="Confirmer le retrait">
                              OK ?
                            </button>
                          ) : (
                            <button onClick={() => removeIngredient(i)} disabled={saving}
                              className="p-1 rounded-lg text-gray-300 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all" title="Retirer cet ingrédient">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-pilote text-white">
                    <td className="px-3.5 py-2.5 text-[11px] font-bold uppercase tracking-wider text-white/60">Total matière{c && c.emballage_ht > 0 ? ' + emb.' : ''}</td>
                    <td className="px-3.5 py-2.5 text-right font-bold tabular text-sm">
                      {poids.brut > 0 ? (
                        <>
                          {fmtQty(poids.brut * ratio)} kg <span className="font-semibold text-white/60">brut</span>
                          {Math.abs(poids.brut - poids.net) >= 0.005 && (
                            <span className="block text-[10px] font-semibold text-white/60">{fmtQty(poids.net * ratio)} kg net</span>
                          )}
                        </>
                      ) : ''}
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-bold tabular text-sm">{fmtEuro(coutMatiere * ratio)}</td>
                    <td className="px-3.5 py-2.5 text-right font-bold tabular text-white/70 text-sm">100 %</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Ajout d'ingrédient sur place — comme les étapes, enregistré aussitôt */}
            <div className="px-3 py-2 border-t border-gray-100">
              {newIng ? (
                <div className="relative">
                  <div className="flex items-center gap-2 flex-wrap">
                    {newIng.generic ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-pilote bg-pilote-50 ring-1 ring-pilote-100 rounded-full pl-3 pr-1.5 py-1.5">
                        {newIng.generic.name}
                        <button onClick={() => setNewIng(p => (p ? { ...p, generic: null, query: '' } : p))}
                          className="w-4 h-4 rounded-full hover:bg-white/70 flex items-center justify-center"><X className="w-3 h-3" /></button>
                      </span>
                    ) : (
                      <input autoFocus value={newIng.query}
                        onChange={e => setNewIng(p => (p ? { ...p, query: e.target.value } : p))}
                        placeholder="Chercher un article générique…"
                        className="flex-1 min-w-[160px] border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                    )}
                    <input inputMode="decimal" value={newIng.qty} placeholder="Qté"
                      onChange={e => setNewIng(p => (p ? { ...p, qty: e.target.value } : p))}
                      onKeyDown={e => { if (e.key === 'Enter') addIngredient() }}
                      className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-right tabular focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                    {newIng.generic?.base_unit === 'kg' ? (
                      <select value={newIng.unit === 'g' ? 'g' : 'kg'}
                        onChange={e => setNewIng(p => (p ? { ...p, unit: e.target.value as 'kg' | 'g' } : p))}
                        className="border border-gray-200 rounded-lg px-1.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200">
                        <option value="kg">kg</option>
                        <option value="g">g</option>
                      </select>
                    ) : (
                      <span className="text-[11px] text-gray-400">{newIng.generic ? 'pièce' : ''}</span>
                    )}
                    <div className="relative">
                      <input inputMode="decimal" value={newIng.loss} title="Perte / rendement (%)"
                        onChange={e => setNewIng(p => (p ? { ...p, loss: e.target.value } : p))}
                        className="w-14 border border-gray-200 rounded-lg pl-2 pr-5 py-1.5 text-xs text-right tabular focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                      <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">%</span>
                    </div>
                    <button onClick={addIngredient} disabled={saving || !newIng.generic || num(newIng.qty) <= 0}
                      className="text-xs font-bold text-white bg-pilote hover:bg-pilote-hover rounded-lg px-3 py-1.5 shadow-card active:scale-[0.98] transition-all disabled:opacity-40">
                      Ajouter
                    </button>
                    <button onClick={() => setNewIng(null)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"><X className="w-3.5 h-3.5" /></button>
                  </div>
                  {!newIng.generic && newIng.query.trim().length >= 2 && (
                    <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-card-hover overflow-hidden">
                      {generics.filter(g => g.name.toLowerCase().includes(newIng.query.trim().toLowerCase())).slice(0, 6).map(g => (
                        <button key={g.id}
                          onClick={() => setNewIng(p => (p ? { ...p, generic: g, query: g.name, unit: g.base_unit === 'kg' ? 'kg' : 'piece', loss: String(g.default_loss_pct || 0) } : p))}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-pilote-50 flex items-center justify-between gap-2">
                          <span className="truncate">{g.name}
                            {g.category === 'emballage' && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wider text-blue-700 bg-blue-50 rounded px-1 py-0.5">Emballage</span>}
                          </span>
                          <span className="text-xs text-gray-500 tabular flex-shrink-0">
                            {g.price_ht !== null ? `${fmtEuro(g.price_ht)} / ${unitFr(g.base_unit)}` : 'pas encore de prix'}
                          </span>
                        </button>
                      ))}
                      {generics.filter(g => g.name.toLowerCase().includes(newIng.query.trim().toLowerCase())).length === 0 && (
                        <p className="px-3 py-2 text-xs text-gray-400">Aucun article générique — créez-le d&apos;abord dans la Mercuriale.</p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <button onClick={() => setNewIng({ query: '', generic: null, qty: '', unit: 'kg', loss: '0' })}
                  className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-gray-500 border-2 border-dashed border-gray-200 rounded-xl py-2 hover:border-pilote-200 hover:text-pilote transition-colors">
                  <Plus className="w-3.5 h-3.5" />Ajouter un ingrédient
                </button>
              )}
            </div>
            <div className="px-3.5 py-2.5 border-t border-gray-100 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-gray-500 tabular">
              <span><ShoppingBasket className="w-3 h-3 inline mr-1 text-gray-400" />Matière {c ? fmtEuro(c.matiere_ht * ratio) : '—'}</span>
              {c && c.emballage_ht > 0 && <span><Package className="w-3 h-3 inline mr-1 text-gray-400" />Emballage {fmtEuro(c.emballage_ht * ratio)}</span>}
              <span><Clock className="w-3 h-3 inline mr-1 text-gray-400" />Main-d&apos;œuvre {active ? fmtEuro(moScaled) : (c ? fmtEuro(c.main_oeuvre_ht) : '—')}</span>
              <span className="font-bold text-gray-700">Coût {active ? `pour ${fmtQty(active.qty)} ${uniteLabel}` : 'du batch'} : {active ? fmtEuro(coutScaled) : (c ? fmtEuro(c.total_ht) : '—')}</span>
            </div>
          </div>
        </div>

        {/* ── Main-d'œuvre & notes — une ligne, plus d'onglets ── */}
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1.5 text-xs text-gray-500">
          <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-gray-400" />
            Fabriqué par <span className="font-semibold text-gray-700">{employeeName ?? 'taux moyen de l’équipe'}</span>
            {c?.labor_rate_ht != null && <span className="tabular">· {fmtEuro(c.labor_rate_ht)}/h productif</span>}
          </span>
          {recipe.notes && <span className="text-gray-500">Notes : <span className="text-gray-700">{recipe.notes}</span></span>}
          <span className="text-gray-400">Nom, production, TVA, employé et ingrédients se modifient via « Modifier la fiche ».</span>
        </div>
      </div>
    </div>
  )
}
