'use client'

// Fiche recette pleine page, façon Otami mais en style PILOTE : on clique une
// recette dans la liste et on arrive ICI. Bandeau de chiffres-clés (coût de
// revient, prix de vente, marge, coef, taux), puis onglets :
//   Infos · Ingrédients (qté net/brut, poids %, coût € et %) · Fabrication
//   (procédé en étapes, modifiable sur place) · Vente (coût & vente +
//   argumentaire modifiable).
// Les coûts viennent de GET /api/recipes (moteur lib/recipes — rien de stocké) ;
// les étapes et l'argumentaire s'enregistrent via PUT /api/recipes/[id].
// « Modifier la fiche » renvoie vers la liste avec ?edit=<id> (la modale
// d'édition complète existante s'y ouvre).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChefHat, ArrowLeft, Pencil, Plus, X, Clock, ShoppingBasket, Package, AlertTriangle } from 'lucide-react'
import { useToast } from '@/components/ui/toast'

type IngredientLine = {
  generic_id: string | null; article_id: string | null; label: string
  quantity: number; qty_unit: string | null; unit: string | null; loss_pct: number | null
  unit_price_ht: number | null; price_source: string; categorie: 'ingredient' | 'emballage'
  qty_base: number; qty_brute: number; line_total_ht: number
}

type RecipeCost = {
  matiere_ht: number; emballage_ht: number; main_oeuvre_ht: number; total_ht: number
  par_unite_ht: number | null; prix_manquants: number; labor_rate_ht: number | null
  pv_unitaire_ht: number | null; marge_pct: number | null; coefficient: number | null
}

type Recipe = {
  id: string; name: string; category: string | null
  yield_qty: number | null; yield_unit: string | null
  labor_minutes: number; selling_price_ttc: number | null; tva_rate: number; notes: string | null
  employee_id: string | null
  fabrication_steps?: string[] | null
  selling_points?: string[] | null
  ingredients: IngredientLine[]
  cost: RecipeCost
}

type Employee = { id: string; name: string; loaded_rate: number | null }

const fmtEuro = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const fmtQty = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 3 })
const unitFr = (u: string | null) => (u === 'piece' ? 'pièce' : u || 'u')

const ONGLETS = ['Infos', 'Ingrédients', 'Fabrication', 'Vente'] as const
type Onglet = typeof ONGLETS[number]

export default function FicheRecettePage() {
  const { toast } = useToast()
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Onglet>('Ingrédients')
  const [saving, setSaving] = useState(false)

  // Éditeurs locaux des deux blocs modifiables sur place
  const [steps, setSteps] = useState<string[]>([])
  const [points, setPoints] = useState<string[]>(['', '', '', '', '', ''])
  const [dirty, setDirty] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await fetch('/api/recipes', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null)
    const r: Recipe | undefined = (data?.recipes || []).find((x: Recipe) => x.id === params.id)
    if (r) {
      setRecipe(r)
      setEmployees(Array.isArray(data.employees) ? data.employees : [])
      setSteps(Array.isArray(r.fabrication_steps) ? r.fabrication_steps.map(String) : [])
      const pts = Array.isArray(r.selling_points) ? r.selling_points.map(String) : []
      setPoints([...pts, '', '', '', '', '', ''].slice(0, 6))
      setDirty(false)
    } else {
      setRecipe(null)
    }
    setLoading(false)
  }, [params.id])
  useEffect(() => { load() }, [load])

  /** Enregistre étapes + argumentaire en renvoyant les champs complets de la
   *  fiche (le PUT valide le nom) — les ingrédients ne sont PAS renvoyés,
   *  donc pas touchés. */
  async function saveBlocks() {
    if (!recipe || saving) return
    setSaving(true)
    const res = await fetch(`/api/recipes/${recipe.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: recipe.name, category: recipe.category,
        yield_qty: recipe.yield_qty, yield_unit: recipe.yield_unit,
        labor_minutes: recipe.labor_minutes, selling_price_ttc: recipe.selling_price_ttc,
        tva_rate: recipe.tva_rate, notes: recipe.notes, employee_id: recipe.employee_id,
        fabrication_steps: steps.map(s => s.trim()).filter(Boolean),
        selling_points: points.map(p => p.trim()),
      }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    setSaving(false)
    if (res?.ok) { toast({ variant: 'success', title: 'Fiche enregistrée' }); load() }
    else toast({ variant: 'error', title: 'Enregistrement impossible', description: data?.error || 'Réessayez.' })
  }

  const c = recipe?.cost
  const employeeName = useMemo(() =>
    recipe?.employee_id ? (employees.find(e => e.id === recipe.employee_id)?.name ?? null) : null,
  [recipe, employees])

  // Poids total NET des lignes en g/kg (les pièces sont hors assiette de poids)
  const poidsTotalKg = useMemo(() => {
    if (!recipe) return 0
    return recipe.ingredients.reduce((s, i) => {
      if (i.generic_id && (i.qty_unit === 'kg' || i.qty_unit === 'g')) return s + i.qty_base
      if (!i.generic_id && (i.unit || '').toLowerCase().includes('kg')) return s + (Number(i.quantity) || 0)
      return s
    }, 0)
  }, [recipe])

  const coutTotal = (c?.matiere_ht ?? 0) + (c?.emballage_ht ?? 0)

  if (loading) {
    return (
      <div className="p-6 md:p-8 max-w-6xl mx-auto">
        <div className="h-8 w-64 bg-gray-100 rounded-lg animate-pulse mb-6" />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">{[...Array(5)].map((_, i) => <div key={i} className="h-28 bg-gray-100 rounded-2xl animate-pulse" />)}</div>
        <div className="h-64 bg-gray-100 rounded-2xl animate-pulse" />
      </div>
    )
  }

  if (!recipe) {
    return (
      <div className="p-6 md:p-8 max-w-6xl mx-auto">
        <div className="bg-white rounded-2xl border border-dashed border-gray-200 py-16 text-center">
          <ChefHat className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-500 mb-3">Fiche introuvable</p>
          <Link href="/dashboard/recettes" className="text-sm text-pilote font-semibold hover:underline">← Retour aux fiches recettes</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      {/* En-tête */}
      <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <Link href="/dashboard/recettes" className="mt-1 p-2 rounded-xl border border-gray-100 text-gray-400 hover:text-pilote hover:bg-pilote-50 shadow-card transition-colors flex-shrink-0" title="Retour aux fiches">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 truncate">{recipe.name}</h1>
              {recipe.category && (
                <span className="text-[10px] font-semibold uppercase tracking-wider text-pilote bg-pilote-50 rounded-full px-2.5 py-1">{recipe.category}</span>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-1">
              {recipe.yield_qty ? `Production : ${fmtQty(recipe.yield_qty)} ${recipe.yield_unit || 'unités'} par batch` : 'Rendement non renseigné'}
              {' · '}coûts au prix du jour de la mercuriale
            </p>
          </div>
        </div>
        <button onClick={() => router.push(`/dashboard/recettes?edit=${recipe.id}`)}
          className="flex items-center gap-1.5 text-xs font-bold text-white bg-pilote hover:bg-pilote-hover rounded-xl px-4 py-2.5 shadow-card active:scale-[0.98] transition-all">
          <Pencil className="w-3.5 h-3.5" />Modifier la fiche
        </button>
      </div>

      {/* Chiffres-clés — le coût de revient est le héros */}
      {c && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <div className="rounded-2xl bg-pilote p-5 shadow-card">
            <p className="text-[11px] font-semibold text-pilote-200 uppercase tracking-wider">Coût de revient</p>
            <p className="text-2xl font-extrabold tracking-tight text-white tabular mt-1">
              {c.par_unite_ht !== null ? fmtEuro(c.par_unite_ht) : fmtEuro(c.total_ht)}
            </p>
            <p className="text-xs text-pilote-200 mt-1">{c.par_unite_ht !== null ? `/ ${recipe.yield_unit || 'unité'}` : '/ batch'}</p>
          </div>
          <div className="rounded-2xl bg-white border border-gray-100 shadow-card p-5">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Prix de vente TTC</p>
            <p className="text-2xl font-extrabold tracking-tight text-gray-900 tabular mt-1">{recipe.selling_price_ttc != null ? fmtEuro(recipe.selling_price_ttc) : '—'}</p>
            <p className="text-xs text-gray-400 mt-1">{c.pv_unitaire_ht !== null ? `${fmtEuro(c.pv_unitaire_ht)} HT` : 'à renseigner'}</p>
          </div>
          <div className="rounded-2xl bg-white border border-gray-100 shadow-card p-5">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Marge brute</p>
            <p className="text-2xl font-extrabold tracking-tight text-gray-900 tabular mt-1">
              {c.pv_unitaire_ht !== null && c.par_unite_ht !== null ? fmtEuro(c.pv_unitaire_ht - c.par_unite_ht) : '—'}
            </p>
            <p className="text-xs text-gray-400 mt-1">PV HT − coût de revient</p>
          </div>
          <div className="rounded-2xl bg-white border border-gray-100 shadow-card p-5">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Coef de marge</p>
            <p className="text-2xl font-extrabold tracking-tight text-gray-900 tabular mt-1">{c.coefficient !== null ? `×${c.coefficient.toLocaleString('fr-FR')}` : '—'}</p>
            <p className="text-xs text-gray-400 mt-1">PV HT ÷ coût</p>
          </div>
          <div className="rounded-2xl bg-white border border-gray-100 shadow-card p-5">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Taux de marge</p>
            <p className={`text-2xl font-extrabold tracking-tight tabular mt-1 ${c.marge_pct === null ? 'text-gray-900' : c.marge_pct >= 50 ? 'text-green-600' : c.marge_pct >= 30 ? 'text-orange-500' : 'text-red-600'}`}>
              {c.marge_pct !== null ? `${c.marge_pct.toLocaleString('fr-FR')} %` : '—'}
            </p>
            <p className="text-xs text-gray-400 mt-1">du PV HT</p>
          </div>
        </div>
      )}

      {c && c.prix_manquants > 0 && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{c.prix_manquants} ingrédient{c.prix_manquants > 1 ? 's' : ''} sans prix — le coût est sous-estimé. Le prix arrivera avec la prochaine facture lue en <Link href="/dashboard/mercuriale" className="font-bold underline">Mercuriale</Link>.</span>
        </div>
      )}

      {/* Onglets */}
      <div className="flex items-center gap-1.5 mb-5 flex-wrap">
        {ONGLETS.map(o => (
          <button key={o} onClick={() => setTab(o)}
            className={`text-xs font-semibold rounded-full px-4 py-2 transition-colors ${tab === o ? 'bg-pilote text-white shadow-card' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>
            {o}
          </button>
        ))}
        {dirty && (
          <button onClick={saveBlocks} disabled={saving}
            className="ml-auto text-xs font-bold text-white bg-pilote hover:bg-pilote-hover rounded-xl px-4 py-2 shadow-card active:scale-[0.98] transition-all disabled:opacity-50">
            {saving ? 'Enregistrement…' : 'Enregistrer les modifications'}
          </button>
        )}
      </div>

      {/* ── Onglet Infos ── */}
      {tab === 'Infos' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Identité</h3>
            {[
              ['Nom', recipe.name],
              ['Catégorie', recipe.category || 'sans catégorie'],
              ['Production par batch', recipe.yield_qty ? `${fmtQty(recipe.yield_qty)} ${recipe.yield_unit || ''}` : '—'],
              ['Notes', recipe.notes || '—'],
            ].map(([l, v]) => (
              <div key={l as string} className="flex items-start justify-between gap-3 text-sm">
                <span className="text-gray-400">{l}</span>
                <span className="font-semibold text-gray-900 text-right">{v}</span>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Main-d&apos;œuvre</h3>
            {[
              ['Temps par batch', `${recipe.labor_minutes || 0} min`],
              ['Qui fabrique', employeeName ?? 'Taux moyen de l’équipe'],
              ['Taux chargé utilisé', c?.labor_rate_ht != null ? `${fmtEuro(c.labor_rate_ht)}/h` : '—'],
              ['Coût main-d’œuvre', c ? fmtEuro(c.main_oeuvre_ht) : '—'],
            ].map(([l, v]) => (
              <div key={l as string} className="flex items-start justify-between gap-3 text-sm">
                <span className="text-gray-400">{l}</span>
                <span className="font-semibold text-gray-900 text-right tabular">{v}</span>
              </div>
            ))}
            <p className="text-[11px] text-gray-400 pt-1">Modifiable via « Modifier la fiche » — tout se recalcule au prix du jour.</p>
          </div>
        </div>
      )}

      {/* ── Onglet Ingrédients ── */}
      {tab === 'Ingrédients' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between gap-2">
            <div>
              <h2 className="font-bold text-gray-900 text-sm">Ingrédients</h2>
              <p className="text-[11px] text-gray-400">Quantités nettes — le brut (perte comprise) est indiqué dessous · prix du jour de la mercuriale</p>
            </div>
            <button onClick={() => router.push(`/dashboard/recettes?edit=${recipe.id}`)}
              className="flex items-center gap-1.5 text-xs font-semibold text-pilote border border-pilote-200 rounded-xl px-3 py-2 hover:bg-pilote-50 transition-colors">
              <Plus className="w-3.5 h-3.5" />Modifier les ingrédients
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px]">
              <thead>
                <tr className="bg-gray-50 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  <th className="px-4 py-2.5 text-left">Ingrédient</th>
                  <th className="px-4 py-2.5 text-right">Qté</th>
                  <th className="px-4 py-2.5 text-right">Poids (%)</th>
                  <th className="px-4 py-2.5 text-right">Coût (€)</th>
                  <th className="px-4 py-2.5 text-right">Coût (%)</th>
                </tr>
              </thead>
              <tbody>
                {recipe.ingredients.map((ing, i) => {
                  const isKg = ing.generic_id ? (ing.qty_unit === 'kg' || ing.qty_unit === 'g') : (ing.unit || '').toLowerCase().includes('kg')
                  const poidsPct = isKg && poidsTotalKg > 0 ? (ing.qty_base / poidsTotalKg) * 100 : null
                  const coutPct = coutTotal > 0 ? (ing.line_total_ht / coutTotal) * 100 : null
                  const loss = Number(ing.loss_pct) || 0
                  const uniteAffichee = ing.generic_id ? (ing.qty_unit === 'piece' ? 'pièce' : ing.qty_unit || '') : (ing.unit || '')
                  return (
                    <tr key={i} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <span className="text-sm font-semibold text-gray-900">{ing.label}</span>
                        {ing.categorie === 'emballage' && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wider text-blue-700 bg-blue-50 rounded px-1.5 py-0.5">Emballage</span>}
                        {ing.price_source === 'aucun' && <span className="ml-1.5 text-[10px] font-semibold text-amber-600">prix manquant</span>}
                        {ing.price_source === 'manuel' && <span className="ml-1.5 text-[10px] text-gray-400">prix manuel</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular">
                        <span className="text-sm font-semibold text-gray-900">{fmtQty(ing.quantity)} {uniteAffichee}</span>
                        {loss > 0 && <p className="text-[11px] text-gray-400">({fmtQty(ing.qty_brute)} {ing.generic_id ? unitFr(ing.qty_unit === 'g' ? 'kg' : ing.qty_unit) : uniteAffichee} brut · perte {loss.toLocaleString('fr-FR')} %)</p>}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-gray-600 tabular">{poidsPct !== null ? `${Math.round(poidsPct)} %` : '—'}</td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900 tabular">{ing.unit_price_ht !== null ? fmtEuro(ing.line_total_ht) : '—'}</td>
                      <td className="px-4 py-3 text-right text-sm text-gray-600 tabular">{coutPct !== null && ing.unit_price_ht !== null ? `${Math.round(coutPct)} %` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-pilote text-white">
                  <td className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-white/60">Total matière{c && c.emballage_ht > 0 ? ' + emballage' : ''}</td>
                  <td className="px-4 py-3 text-right font-bold tabular">{poidsTotalKg > 0 ? `${fmtQty(poidsTotalKg)} kg` : ''}</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-right font-bold tabular">{fmtEuro(coutTotal)}</td>
                  <td className="px-4 py-3 text-right font-bold tabular text-white/70">100 %</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-gray-100 flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-gray-500 tabular">
            <span><ShoppingBasket className="w-3 h-3 inline mr-1 text-gray-400" />Matière {c ? fmtEuro(c.matiere_ht) : '—'}</span>
            {c && c.emballage_ht > 0 && <span><Package className="w-3 h-3 inline mr-1 text-gray-400" />Emballage {fmtEuro(c.emballage_ht)}</span>}
            <span><Clock className="w-3 h-3 inline mr-1 text-gray-400" />Main-d&apos;œuvre {c ? fmtEuro(c.main_oeuvre_ht) : '—'} ({recipe.labor_minutes} min{employeeName ? ` · ${employeeName}` : ''})</span>
            <span className="font-bold text-gray-700">Coût du batch {c ? fmtEuro(c.total_ht) : '—'}</span>
          </div>
        </div>
      )}

      {/* ── Onglet Fabrication ── */}
      {tab === 'Fabrication' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div>
              <h2 className="font-bold text-gray-900 text-sm">Procédé de fabrication</h2>
              <p className="text-[11px] text-gray-400">Étapes ordonnées — modifiables ici, enregistrées avec le bouton en haut</p>
            </div>
          </div>
          {steps.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">Veuillez renseigner le procédé de fabrication pour cette recette.</p>
          )}
          <div className="space-y-2">
            {steps.map((s, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="w-7 h-7 rounded-full bg-pilote-50 text-pilote text-xs font-extrabold flex items-center justify-center flex-shrink-0 mt-1">{i + 1}</span>
                <textarea value={s} rows={2}
                  onChange={e => { setSteps(prev => prev.map((x, j) => j === i ? e.target.value : x)); setDirty(true) }}
                  placeholder={`Étape ${i + 1}…`}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200 resize-y" />
                <button onClick={() => { setSteps(prev => prev.filter((_, j) => j !== i)); setDirty(true) }}
                  className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 flex-shrink-0 mt-1"><X className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
          <button onClick={() => { setSteps(prev => [...prev, '']); setDirty(true) }}
            className="mt-4 w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-gray-500 border-2 border-dashed border-gray-200 rounded-xl py-3 hover:border-pilote-200 hover:text-pilote transition-colors">
            <Plus className="w-3.5 h-3.5" />Ajouter une nouvelle étape
          </button>
        </div>
      )}

      {/* ── Onglet Vente ── */}
      {tab === 'Vente' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
            <div className="flex items-center justify-between gap-2 mb-4">
              <h2 className="font-bold text-gray-900 text-sm">Coût et vente</h2>
              <button onClick={() => router.push(`/dashboard/recettes?edit=${recipe.id}`)}
                className="p-2 rounded-xl border border-gray-100 text-gray-400 hover:text-pilote hover:bg-pilote-50 shadow-card transition-colors" title="Modifier prix de vente et TVA">
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-2.5 text-sm">
              {([
                ['Coût de revient', c && c.par_unite_ht !== null ? fmtEuro(c.par_unite_ht) : c ? fmtEuro(c.total_ht) : '—'],
                ['Emballage', c && c.emballage_ht > 0 ? fmtEuro(c.emballage_ht) : 'Non renseigné'],
                ['Marge brute', c && c.pv_unitaire_ht !== null && c.par_unite_ht !== null ? fmtEuro(c.pv_unitaire_ht - c.par_unite_ht) : '—'],
                ['Main-d’œuvre', c ? fmtEuro(c.main_oeuvre_ht) : '—'],
                ['Prix de vente HT', c && c.pv_unitaire_ht !== null ? fmtEuro(c.pv_unitaire_ht) : '—'],
                ['TVA appliquée', `${recipe.tva_rate.toLocaleString('fr-FR')} %`],
              ] as [string, string][]).map(([l, v]) => (
                <div key={l} className="flex items-baseline justify-between gap-3 border-b border-gray-50 pb-1.5">
                  <span className="text-gray-400">{l}</span>
                  <span className={`font-semibold tabular ${v === 'Non renseigné' || v === '—' ? 'text-gray-300 italic font-normal' : 'text-gray-900'}`}>{v}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-3 flex-wrap">
              <span className="inline-flex items-center gap-2 bg-pilote-50 ring-1 ring-pilote-100 rounded-full px-4 py-2 text-sm font-bold text-pilote tabular">
                PV TTC {recipe.selling_price_ttc != null ? fmtEuro(recipe.selling_price_ttc) : '—'}
              </span>
              <span className="inline-flex items-center gap-2 bg-green-50 ring-1 ring-green-100 rounded-full px-4 py-2 text-sm font-bold text-green-700 tabular">
                coef {c?.coefficient !== null && c?.coefficient !== undefined ? `×${c.coefficient.toLocaleString('fr-FR')}` : '—'}
              </span>
              <span className="inline-flex items-center gap-2 bg-pilote text-white rounded-full px-4 py-2 text-sm font-bold tabular">
                marge {c?.marge_pct !== null && c?.marge_pct !== undefined ? `${c.marge_pct.toLocaleString('fr-FR')} %` : '—'}
              </span>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
            <h2 className="font-bold text-gray-900 text-sm mb-1">Argumentaire de vente</h2>
            <p className="text-[11px] text-gray-400 mb-4">Les arguments à donner en boutique — modifiables ici, enregistrés avec le bouton en haut</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {points.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-gray-400 w-20 flex-shrink-0">Argument {i + 1}</span>
                  <input value={p}
                    onChange={e => { setPoints(prev => prev.map((x, j) => j === i ? e.target.value : x)); setDirty(true) }}
                    placeholder="Non défini"
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
