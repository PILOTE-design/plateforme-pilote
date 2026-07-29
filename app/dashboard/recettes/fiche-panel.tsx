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
import { Pencil, Plus, X, Clock, ShoppingBasket, Package, AlertTriangle, Users, Printer } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { parseStoredSteps, parseStoredTiers } from '@/lib/recipes'

export type FicheIngredient = {
  generic_id: string | null; article_id: string | null; label: string
  quantity: number; qty_unit: string | null; unit: string | null; loss_pct: number | null
  manual_price_ht?: number | null
  unit_price_ht: number | null; price_source: string; categorie: 'ingredient' | 'emballage'
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

export default function FichePanel({
  recipe, employees, generics, onEditFull, onSaved, onClose,
}: {
  recipe: FicheRecipe
  employees: FicheEmployee[]
  /** Articles génériques de la mercuriale — pour l'ajout d'ingrédient sur place */
  generics: FicheGeneric[]
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

  // Poids total NET des lignes en g/kg (les pièces sont hors assiette de poids)
  const poidsTotalKg = useMemo(() => recipe.ingredients.reduce((s, i) => {
    if (i.generic_id && (i.qty_unit === 'kg' || i.qty_unit === 'g')) return s + i.qty_base
    if (!i.generic_id && (i.unit || '').toLowerCase().includes('kg')) return s + (Number(i.quantity) || 0)
    return s
  }, 0), [recipe])

  const coutMatiere = (c?.matiere_ht ?? 0) + (c?.emballage_ht ?? 0)
  const coutUnite = c ? (c.par_unite_ht ?? c.total_ht) : null
  // Coût du palier : matière ×ratio (linéaire), MO ×multiple (économie d'échelle)
  const moScaled = c?.labor_rate_ht != null ? round2(scaledMinutes / 60 * c.labor_rate_ht) : 0
  const coutScaled = round2(coutMatiere * ratio + moScaled)

  /** Lignes d'ingrédients ACTUELLES au format d'écriture de l'API (PUT = remplacement complet) */
  const ingPayload = () => recipe.ingredients.map(i => ({
    generic_id: i.generic_id, article_id: i.article_id, label: i.label,
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

  /** Ajoute l'ingrédient choisi et enregistre aussitôt (la liste est REMPLACÉE côté API) */
  function addIngredient() {
    if (!newIng?.generic || num(newIng.qty) <= 0) return
    const g = newIng.generic
    saveAll({
      ingredients: [...ingPayload(), {
        generic_id: g.id, article_id: null, label: g.name,
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
            {' · '}coûts au prix du jour de la mercuriale
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
              <p className="text-[11px] text-pilote-200 mt-0.5">{c.par_unite_ht !== null ? `/ ${recipe.yield_unit || 'unité'}` : '/ batch'}</p>
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

            <div className="rounded-2xl bg-white border border-gray-100 shadow-card p-4 group cursor-pointer hover:border-pilote-200 transition-colors"
              onClick={() => !editKpi && setEditKpi({ field: 'coef', value: c.coefficient !== null ? String(c.coefficient).replace('.', ',') : '' })}>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                Coef multiplicateur <Pencil className="w-2.5 h-2.5 text-gray-300 group-hover:text-pilote transition-colors" />
              </p>
              {editKpi?.field === 'coef' ? kpiInput() : (
                <p className="text-xl font-extrabold tracking-tight text-gray-900 tabular mt-1">{c.coefficient !== null ? `×${c.coefficient.toLocaleString('fr-FR')}` : '—'}</p>
              )}
              <p className="text-[11px] text-gray-400 mt-0.5">saisir un coef fixe le PV</p>
            </div>

            <div className="rounded-2xl bg-white border border-gray-100 shadow-card p-4">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Taux de marge</p>
              <p className={`text-xl font-extrabold tracking-tight tabular mt-1 ${c.marge_pct === null ? 'text-gray-900' : c.marge_pct >= 50 ? 'text-green-600' : c.marge_pct >= 30 ? 'text-orange-500' : 'text-red-600'}`}>
                {c.marge_pct !== null ? `${c.marge_pct.toLocaleString('fr-FR')} %` : '—'}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5 tabular">
                {c.pv_unitaire_ht !== null && c.par_unite_ht !== null ? `marge ${fmtEuro(c.pv_unitaire_ht - c.par_unite_ht)}` : 'du PV HT'}
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
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 flex items-center gap-2 text-xs text-amber-800">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{c.prix_manquants} ingrédient{c.prix_manquants > 1 ? 's' : ''} sans prix — coût sous-estimé. Le prix arrivera via la <Link href="/dashboard/mercuriale" className="font-bold underline">Mercuriale</Link>.</span>
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
                          {ing.price_source === 'aucun' && <span className="ml-1.5 text-[10px] font-semibold text-amber-600">prix manquant</span>}
                          {ing.price_source === 'manuel' && <span className="ml-1.5 text-[10px] text-gray-400">prix manuel</span>}
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
                    <td className="px-3.5 py-2.5 text-right font-bold tabular text-sm">{poidsTotalKg > 0 ? `${fmtQty(poidsTotalKg * ratio)} kg` : ''}</td>
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
            {c?.labor_rate_ht != null && <span className="tabular">· {fmtEuro(c.labor_rate_ht)}/h chargé</span>}
          </span>
          {recipe.notes && <span className="text-gray-500">Notes : <span className="text-gray-700">{recipe.notes}</span></span>}
          <span className="text-gray-400">Nom, production, TVA, employé et ingrédients se modifient via « Modifier la fiche ».</span>
        </div>
      </div>
    </div>
  )
}
