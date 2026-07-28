'use client'

// Fiches recettes — coût de revient au prix du jour, façon Otami mais branché sur
// les données PILOTE : chaque ingrédient est un ARTICLE GÉNÉRIQUE de la
// mercuriale (prix par unité de base kg/pièce, dernier prix facturé de ses réfs
// fournisseurs), la quantité se saisit en kg, g ou pièce, une perte % gonfle le
// brut, et la main-d'œuvre lit le taux chargé de l'employé choisi (repli : taux
// moyen d'équipe, CCN 992). Rien n'est figé : une facture lue, une association
// ou une embauche, et toutes les fiches se recalculent.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChefHat, Plus, X, Search, AlertTriangle, Clock, ShoppingBasket, Package } from 'lucide-react'
import Link from 'next/link'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Generic = {
  id: string; name: string
  base_unit: 'kg' | 'piece'
  category: 'ingredient' | 'emballage'
  default_loss_pct: number
  price_ht: number | null
}

type Employee = { id: string; name: string; loaded_rate: number | null }

type IngredientDraft = {
  generic_id: string | null
  article_id: string | null      // héritage (ancienne réf directe)
  label: string
  quantity: string
  qty_unit: 'kg' | 'g' | 'piece' | null
  unit: string | null            // héritage
  loss_pct: string
  manual_price_ht: string
  legacy_price: number | null    // prix serveur d'une ligne héritée (aperçu seulement)
}

type RecipeCost = {
  matiere_ht: number; emballage_ht: number; main_oeuvre_ht: number; total_ht: number; par_unite_ht: number | null
  prix_manquants: number; labor_rate_ht: number | null
  pv_unitaire_ht: number | null; marge_pct: number | null; coefficient: number | null
}

type Recipe = {
  id: string; name: string; category: string | null
  yield_qty: number | null; yield_unit: string | null
  labor_minutes: number; selling_price_ttc: number | null; tva_rate: number; notes: string | null
  employee_id: string | null
  ingredients: { generic_id: string | null; article_id: string | null; label: string; quantity: number; qty_unit: string | null; unit: string | null; loss_pct: number | null; manual_price_ht: number | null; unit_price_ht: number | null; price_source: string; line_total_ht: number }[]
  cost: RecipeCost
}

const fmtEuro = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const unitFr = (u: string | null) => (u === 'piece' ? 'pièce' : u || '')
const EMPTY_ING = (): IngredientDraft => ({ generic_id: null, article_id: null, label: '', quantity: '', qty_unit: null, unit: null, loss_pct: '0', manual_price_ht: '', legacy_price: null })

// Catégories proposées — les trois métiers de la maison. Le champ reste libre :
// une catégorie inconnue crée simplement sa propre section.
const CATEGORIES_SUGGEREES = ['boucherie', 'charcuterie', 'traiteur']
const catLabel = (c: string | null) => (c && c.trim() ? c.trim().toLowerCase() : 'sans catégorie')

export default function RecettesPage() {
  const { toast } = useToast()
  const router = useRouter()
  const { confirm: confirmAction } = useConfirm()
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [generics, setGenerics] = useState<Generic[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [laborRate, setLaborRate] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Modale création / édition
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [catFilter, setCatFilter] = useState<string | null>(null)
  const [show, setShow] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', category: '', yield_qty: '', yield_unit: 'pièces', labor_minutes: '', selling_price_ttc: '', tva_rate: '5.5', employee_id: '' })
  const [ings, setIngs] = useState<IngredientDraft[]>([EMPTY_ING()])
  const [pickerRow, setPickerRow] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const rec = await fetch('/api/recipes', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null)
    if (rec) {
      setRecipes(Array.isArray(rec.recipes) ? rec.recipes : [])
      setLaborRate(rec.labor_rate_ht ?? null)
      setGenerics(Array.isArray(rec.generics) ? rec.generics : [])
      setEmployees(Array.isArray(rec.employees) ? rec.employees : [])
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

  // Taux MO de l'aperçu : l'employé choisi (s'il a un taux), sinon le taux moyen
  const previewRate = useMemo(() => {
    if (!form.employee_id) return laborRate
    return employees.find(e => e.id === form.employee_id)?.loaded_rate ?? laborRate
  }, [form.employee_id, employees, laborRate])

  // Aperçu du coût dans la modale — même logique que le serveur, en lecture seule :
  // conversion g→kg, perte sur le brut, matière et emballage séparés.
  const preview = useMemo(() => {
    let matiere = 0, emballage = 0, manquants = 0
    for (const ing of ings) {
      const qty = parseFloat(ing.quantity.replace(',', '.')) || 0
      if (qty <= 0) continue
      const g = ing.generic_id ? genericById.get(ing.generic_id) ?? null : null
      const manual = parseFloat(ing.manual_price_ht.replace(',', '.')) || null
      const price = g ? (g.price_ht ?? manual) : (ing.legacy_price ?? manual)
      if (price === null) { manquants++; continue }
      const loss = Math.min(99, Math.max(0, parseFloat(ing.loss_pct.replace(',', '.')) || 0))
      const qtyBase = g && g.base_unit === 'kg' && ing.qty_unit === 'g' ? qty / 1000 : qty
      const cout = price * (qtyBase / (1 - loss / 100))
      if (g?.category === 'emballage') emballage += cout
      else matiere += cout
    }
    const minutes = parseFloat(form.labor_minutes.replace(',', '.')) || 0
    const mo = previewRate !== null ? minutes / 60 * previewRate : 0
    const total = matiere + emballage + mo
    const yieldQty = parseFloat(form.yield_qty.replace(',', '.')) || 0
    return { matiere, emballage, mo, total, parUnite: yieldQty > 0 ? total / yieldQty : null, manquants }
  }, [ings, form.labor_minutes, form.yield_qty, previewRate, genericById])

  // Recherche : par nom de recette, par catégorie, et par INGRÉDIENT — taper
  // « chipolata » amène aussi sur les fiches qui en contiennent.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = recipes
    if (catFilter !== null) list = list.filter(r => catLabel(r.category) === catFilter)
    if (q) {
      list = list.filter(r =>
        r.name.toLowerCase().includes(q)
        || catLabel(r.category).includes(q)
        || r.ingredients.some(i => i.label.toLowerCase().includes(q)))
    }
    return list
  }, [recipes, search, catFilter])

  // Résultats de la liste déroulante sous la barre : nom + catégorie, clic →
  // ouvre la fiche. Cherche dans TOUTES les fiches (ignore le filtre catégorie
  // actif — c'est un outil de navigation, pas un filtre).
  const suggestions = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return recipes
      .filter(r =>
        r.name.toLowerCase().includes(q)
        || catLabel(r.category).includes(q)
        || r.ingredients.some(i => i.label.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      .slice(0, 8)
  }, [recipes, search])

  // Sections par catégorie, triées ; les recettes par nom à l'intérieur.
  const grouped = useMemo(() => {
    const m = new Map<string, Recipe[]>()
    for (const r of filtered) {
      const c = catLabel(r.category)
      const arr = m.get(c) || []
      arr.push(r)
      m.set(c, arr)
    }
    return [...m.entries()]
      .map(([cat, list]) => [cat, [...list].sort((a, b) => a.name.localeCompare(b.name, 'fr'))] as const)
      .sort((a, b) => a[0].localeCompare(b[0], 'fr'))
  }, [filtered])

  const allCats = useMemo(() => {
    const set = new Set<string>()
    for (const r of recipes) set.add(catLabel(r.category))
    return [...set].sort((a, b) => a.localeCompare(b, 'fr'))
  }, [recipes])

  function openNew() {
    setEditId(null)
    setForm({ name: '', category: '', yield_qty: '', yield_unit: 'pièces', labor_minutes: '', selling_price_ttc: '', tva_rate: '5.5', employee_id: '' })
    setIngs([EMPTY_ING()])
    setShow(true)
  }

  function openEdit(r: Recipe) {
    setEditId(r.id)
    setForm({
      name: r.name, category: r.category ?? '',
      yield_qty: r.yield_qty != null ? String(r.yield_qty) : '', yield_unit: r.yield_unit ?? 'pièces',
      labor_minutes: String(r.labor_minutes ?? ''), selling_price_ttc: r.selling_price_ttc != null ? String(r.selling_price_ttc) : '',
      tva_rate: String(r.tva_rate ?? '5.5'), employee_id: r.employee_id ?? '',
    })
    setIngs(r.ingredients.length > 0
      ? r.ingredients.map(i => ({
          generic_id: i.generic_id, article_id: i.article_id, label: i.label,
          quantity: String(i.quantity),
          qty_unit: (i.qty_unit === 'kg' || i.qty_unit === 'g' || i.qty_unit === 'piece') ? i.qty_unit : null,
          unit: i.unit,
          loss_pct: String(i.loss_pct ?? 0),
          manual_price_ht: i.manual_price_ht != null ? String(i.manual_price_ht) : '',
          legacy_price: !i.generic_id ? i.unit_price_ht : null,
        }))
      : [EMPTY_ING()])
    setShow(true)
  }

  async function save() {
    const kept = ings.filter(i => i.label.trim() && parseFloat(i.quantity.replace(',', '.')) > 0)
    // Obligation d'associer : une ligne neuve doit viser un article générique.
    // Seules les lignes héritées (ancienne réf directe) échappent à la règle.
    const libres = kept.filter(i => !i.generic_id && !i.article_id)
    if (libres.length > 0) {
      toast({
        variant: 'error', title: 'Ingrédient hors mercuriale',
        description: `« ${libres[0].label.slice(0, 40)} » : choisissez un article générique dans la liste (créez-le depuis la page Mercuriale s'il n'existe pas encore).`,
      })
      return
    }
    setSaving(true)
    const payload = {
      name: form.name, category: form.category || null,
      yield_qty: form.yield_qty ? parseFloat(form.yield_qty.replace(',', '.')) : null,
      yield_unit: form.yield_unit || null,
      labor_minutes: parseFloat(form.labor_minutes.replace(',', '.')) || 0,
      selling_price_ttc: form.selling_price_ttc ? parseFloat(form.selling_price_ttc.replace(',', '.')) : null,
      tva_rate: parseFloat(form.tva_rate.replace(',', '.')) || 5.5,
      employee_id: form.employee_id || null,
      ingredients: kept.map(i => ({
        generic_id: i.generic_id, article_id: i.article_id, label: i.label, unit: i.unit,
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
          ...ing, generic_id: g.id, article_id: null, label: g.name, unit: null,
          qty_unit: g.base_unit === 'kg' ? 'kg' : 'piece',
          loss_pct: String(g.default_loss_pct || 0),
          manual_price_ht: '', legacy_price: null,
        }
      : ing))
    setPickerRow(null)
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      {/* En-tête */}
      <div className="mb-8 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-pilote to-pilote-hover rounded-2xl flex items-center justify-center flex-shrink-0 shadow-card">
            <ChefHat className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Fiches recettes</h1>
            <p className="text-sm text-gray-500 mt-1">
              Coût de revient au prix du jour — matière (mercuriale) + main-d&apos;œuvre
              {laborRate !== null ? ` à ${fmtEuro(laborRate)}/h chargé` : ''}
            </p>
          </div>
        </div>
        <Button onClick={openNew} className="bg-pilote hover:bg-pilote-hover text-white">
          <Plus className="w-4 h-4 mr-1.5" />Nouvelle recette
        </Button>
      </div>

      {laborRate === null && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>Aucun taux horaire exploitable : la main-d&apos;œuvre compte pour 0 €. Renseignez vos employés (taux horaire) dans le <Link href="/dashboard/planning" className="font-bold underline">planning</Link>.</span>
        </div>
      )}

      {/* Recherche + catégories */}
      {recipes.length > 0 && (
        <div className="mb-5 space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={search}
              onChange={e => { setSearch(e.target.value); setSearchOpen(true) }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setSearchOpen(false)}
              onKeyDown={e => { if (e.key === 'Escape') setSearchOpen(false) }}
              placeholder="Chercher une fiche par produit, catégorie ou ingrédient…"
              className="w-full border border-gray-200 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200" />
            {searchOpen && search.trim() !== '' && (
              <div className="absolute z-20 top-full left-0 right-0 mt-1.5 bg-white border border-gray-100 rounded-xl shadow-card-hover overflow-hidden">
                {suggestions.length === 0 ? (
                  <p className="px-3.5 py-3 text-xs text-gray-400">Aucune fiche pour « {search.trim()} »</p>
                ) : suggestions.map(r => (
                  <button key={r.id} type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => { setSearchOpen(false); router.push(`/dashboard/recettes/${r.id}`) }}
                    className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-pilote-50/60 transition-colors border-b border-gray-50 last:border-b-0">
                    <span className="text-sm font-semibold text-gray-900 truncate">{r.name}</span>
                    <span className={`text-[10px] font-semibold uppercase tracking-wider rounded-lg px-1.5 py-0.5 flex-shrink-0 capitalize ${r.category && r.category.trim() ? 'text-pilote bg-pilote-50' : 'text-gray-400 bg-gray-50'}`}>
                      {catLabel(r.category)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {allCats.length > 1 && (
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => setCatFilter(null)}
                className={`text-xs font-semibold rounded-full px-3 py-1.5 transition-colors ${catFilter === null ? 'bg-pilote text-white' : 'bg-pilote-50 text-pilote hover:bg-pilote-100'}`}>
                Toutes ({recipes.length})
              </button>
              {allCats.map(c => {
                const n = recipes.filter(r => catLabel(r.category) === c).length
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
          <p className="text-sm font-medium text-gray-500">Aucune fiche ne correspond{search ? <> à « {search} »</> : ''}</p>
          <button onClick={() => { setSearch(''); setCatFilter(null) }} className="mt-2 text-xs font-semibold text-pilote hover:underline">Tout afficher</button>
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(([cat, list]) => (
            <section key={cat}>
              <div className="flex items-baseline gap-2 mb-3">
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-700 capitalize">{cat}</h2>
                <span className="text-[11px] text-gray-400 tabular">{list.length} fiche{list.length > 1 ? 's' : ''}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {list.map(r => (
            <button key={r.id} onClick={() => router.push(`/dashboard/recettes/${r.id}`)}
              className="text-left bg-white rounded-2xl border border-gray-100 shadow-card p-5 hover:shadow-card-hover hover:-translate-y-0.5 transition-all">
              <div className="flex items-start justify-between gap-2 mb-3">
                <p className="text-sm font-bold text-gray-900 leading-snug">{r.name}</p>
                {r.category && <span className="text-[10px] font-semibold uppercase tracking-wider text-pilote bg-pilote-50 rounded-lg px-1.5 py-0.5 flex-shrink-0">{r.category}</span>}
              </div>
              <p className="text-2xl font-extrabold tracking-tight text-gray-900 tabular">
                {r.cost.par_unite_ht !== null ? fmtEuro(r.cost.par_unite_ht) : fmtEuro(r.cost.total_ht)}
                <span className="text-xs font-semibold text-gray-400 ml-1.5">
                  {r.cost.par_unite_ht !== null ? `/ ${r.yield_unit || 'unité'}` : '/ batch'}
                </span>
              </p>
              <div className="mt-2 space-y-0.5 text-[11px] text-gray-500 tabular">
                <p><ShoppingBasket className="w-3 h-3 inline mr-1 text-gray-400" />Matière {fmtEuro(r.cost.matiere_ht)}</p>
                {r.cost.emballage_ht > 0 && <p><Package className="w-3 h-3 inline mr-1 text-gray-400" />Emballage {fmtEuro(r.cost.emballage_ht)}</p>}
                <p><Clock className="w-3 h-3 inline mr-1 text-gray-400" />Main-d&apos;œuvre {fmtEuro(r.cost.main_oeuvre_ht)} ({r.labor_minutes} min{r.employee_id && employees.find(e => e.id === r.employee_id) ? ` · ${employees.find(e => e.id === r.employee_id)!.name}` : ''})</p>
              </div>
              <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2 flex-wrap">
                {r.cost.marge_pct !== null && (
                  <span className={`text-xs font-bold tabular ${r.cost.marge_pct >= 50 ? 'text-green-600' : r.cost.marge_pct >= 30 ? 'text-orange-500' : 'text-red-600'}`}>
                    marge {r.cost.marge_pct.toLocaleString('fr-FR')} %
                  </span>
                )}
                {r.cost.coefficient !== null && <span className="text-xs text-gray-400 tabular">coef ×{r.cost.coefficient.toLocaleString('fr-FR')}</span>}
                {r.cost.prix_manquants > 0 && (
                  <span className="text-[11px] font-semibold text-amber-600">{r.cost.prix_manquants} prix manquant{r.cost.prix_manquants > 1 ? 's' : ''}</span>
                )}
              </div>
            </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Modale création / édition */}
      {show && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm p-4" onClick={() => setShow(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-gray-900">{editId ? 'Modifier la recette' : 'Nouvelle recette'}</h2>
              <button onClick={() => setShow(false)} className="p-1.5 rounded-xl hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Nom</label>
                  <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Terrine de campagne" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Catégorie</label>
                  <Input list="recette-categories" value={form.category}
                    onChange={e => setForm(p => ({ ...p, category: e.target.value }))} placeholder="charcuterie, traiteur…" />
                  <datalist id="recette-categories">
                    {[...new Set([...CATEGORIES_SUGGEREES, ...allCats.filter(c => c !== 'sans catégorie')])].map(c => <option key={c} value={c} />)}
                  </datalist>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Production</label>
                    <Input inputMode="decimal" value={form.yield_qty} onChange={e => setForm(p => ({ ...p, yield_qty: e.target.value }))} placeholder="6" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Unité</label>
                    <Input value={form.yield_unit} onChange={e => setForm(p => ({ ...p, yield_unit: e.target.value }))} placeholder="pièces, kg…" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Main-d&apos;œuvre (minutes, pour le batch)</label>
                  <Input inputMode="decimal" value={form.labor_minutes} onChange={e => setForm(p => ({ ...p, labor_minutes: e.target.value }))} placeholder="45" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Prix de vente TTC (par unité, optionnel)</label>
                  <Input inputMode="decimal" value={form.selling_price_ttc} onChange={e => setForm(p => ({ ...p, selling_price_ttc: e.target.value }))} placeholder="4,50" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">TVA de vente</label>
                  <select value={form.tva_rate} onChange={e => setForm(p => ({ ...p, tva_rate: e.target.value }))}
                    className="w-full h-10 border border-gray-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200 bg-white">
                    <option value="5.5">5,5 % (à emporter)</option>
                    <option value="10">10 % (sur place)</option>
                    <option value="20">20 %</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Qui fabrique ? <span className="font-normal text-gray-400">— le coût main-d&apos;œuvre prend son taux chargé</span></label>
                  <select value={form.employee_id} onChange={e => setForm(p => ({ ...p, employee_id: e.target.value }))}
                    className="w-full h-10 border border-gray-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200 bg-white">
                    <option value="">Taux moyen de l&apos;équipe{laborRate !== null ? ` (${fmtEuro(laborRate)}/h)` : ''}</option>
                    {employees.map(e => (
                      <option key={e.id} value={e.id}>
                        {e.name}{e.loaded_rate !== null ? ` (${fmtEuro(e.loaded_rate)}/h chargé)` : ' (sans taux — repli taux moyen)'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Ingrédients — uniquement des articles génériques de la mercuriale */}
              <div>
                <p className="text-xs font-semibold text-gray-700 mb-2">Ingrédients <span className="font-normal text-gray-400">— choisis parmi vos articles génériques ; la perte gonfle la quantité brute à sortir</span></p>
                {generics.length === 0 && (
                  <p className="text-[11px] text-amber-600 mb-2">
                    Aucun article générique : associez d&apos;abord vos réfs dans la <Link href="/dashboard/mercuriale" className="font-bold underline">Mercuriale</Link>.
                  </p>
                )}
                <div className="space-y-2">
                  {ings.map((ing, i) => {
                    const g = ing.generic_id ? genericById.get(ing.generic_id) ?? null : null
                    const q = ing.label.trim().toLowerCase()
                    const sugg = pickerRow === i && q.length >= 2 && !ing.generic_id
                      ? generics.filter(x => x.name.toLowerCase().includes(q)).slice(0, 6)
                      : []
                    const isLegacy = !ing.generic_id && !!ing.article_id
                    return (
                      <div key={i} className="relative">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 relative min-w-[140px]">
                            <Search className="w-3.5 h-3.5 text-gray-300 absolute left-2.5 top-1/2 -translate-y-1/2" />
                            <input value={ing.label}
                              onChange={e => { setIngs(prev => prev.map((x, j) => j === i ? { ...x, label: e.target.value, generic_id: null, article_id: null, legacy_price: null } : x)); setPickerRow(i) }}
                              onFocus={() => setPickerRow(i)}
                              placeholder="Chercher un article générique…"
                              className={`w-full border rounded-lg pl-8 pr-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200 ${ing.generic_id ? 'border-pilote-200 bg-pilote-50/50 font-medium' : isLegacy ? 'border-amber-200 bg-amber-50/50' : 'border-gray-200'}`} />
                          </div>
                          <input inputMode="decimal" value={ing.quantity}
                            onChange={e => setIngs(prev => prev.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))}
                            placeholder="Qté" className="w-14 border border-gray-200 rounded-lg px-2 py-2 text-sm text-right tabular focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                          {g ? (
                            g.base_unit === 'kg' ? (
                              <select value={ing.qty_unit ?? 'kg'}
                                onChange={e => setIngs(prev => prev.map((x, j) => j === i ? { ...x, qty_unit: e.target.value as 'kg' | 'g' } : x))}
                                className="w-14 border border-gray-200 rounded-lg px-1 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200 flex-shrink-0">
                                <option value="kg">kg</option>
                                <option value="g">g</option>
                              </select>
                            ) : (
                              <span className="text-[11px] text-gray-400 w-14 flex-shrink-0 text-center">pièce</span>
                            )
                          ) : (
                            <span className="text-[11px] text-gray-400 w-14 flex-shrink-0 text-center">{ing.unit || '—'}</span>
                          )}
                          <div className="relative flex-shrink-0">
                            <input inputMode="decimal" value={ing.loss_pct} title="Perte / rendement (%)"
                              onChange={e => setIngs(prev => prev.map((x, j) => j === i ? { ...x, loss_pct: e.target.value } : x))}
                              className="w-14 border border-gray-200 rounded-lg pl-2 pr-5 py-2 text-xs text-right tabular focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                            <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">%</span>
                          </div>
                          {g ? (
                            g.price_ht !== null ? (
                              <span className="text-xs text-gray-500 tabular w-24 text-right flex-shrink-0">{fmtEuro(g.price_ht)} / {unitFr(g.base_unit)}</span>
                            ) : (
                              <input inputMode="decimal" value={ing.manual_price_ht} title={`Aucun prix facturé — saisissez un prix HT par ${unitFr(g.base_unit)}`}
                                onChange={e => setIngs(prev => prev.map((x, j) => j === i ? { ...x, manual_price_ht: e.target.value } : x))}
                                placeholder={`€/${unitFr(g.base_unit)}`} className="w-24 border border-amber-200 rounded-lg px-2 py-2 text-xs text-right tabular focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                            )
                          ) : (
                            <span className="text-xs text-gray-500 tabular w-24 text-right flex-shrink-0">{ing.legacy_price !== null ? fmtEuro(ing.legacy_price) : '—'}</span>
                          )}
                          <button onClick={() => setIngs(prev => prev.length > 1 ? prev.filter((_, j) => j !== i) : prev)}
                            className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400 flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
                        </div>
                        {isLegacy && (
                          <p className="text-[10px] text-amber-600 mt-0.5 ml-1">Ancienne réf directe — re-choisissez un article générique pour profiter des prix à jour.</p>
                        )}
                        {sugg.length > 0 && (
                          <div className="absolute z-10 left-0 right-24 mt-1 bg-white border border-gray-200 rounded-lg shadow-card-hover overflow-hidden">
                            {sugg.map(x => (
                              <button key={x.id} onClick={() => pickGeneric(i, x)}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-pilote-50 flex items-center justify-between gap-2">
                                <span className="truncate">{x.name}
                                  {x.category === 'emballage' && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wider text-blue-700 bg-blue-50 rounded px-1 py-0.5">Emballage</span>}
                                </span>
                                <span className="text-xs text-gray-500 tabular flex-shrink-0">
                                  {x.price_ht !== null ? `${fmtEuro(x.price_ht)} / ${unitFr(x.base_unit)}` : 'pas encore de prix'}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                <button onClick={() => setIngs(prev => [...prev, EMPTY_ING()])}
                  className="mt-2 text-xs font-semibold text-pilote hover:underline flex items-center gap-1"><Plus className="w-3.5 h-3.5" />Ajouter un ingrédient</button>
              </div>

              {/* Aperçu du coût */}
              <div className="bg-pilote-50/70 ring-1 ring-pilote-100 rounded-lg p-4 text-sm tabular">
                <div className="flex justify-between text-gray-600"><span>Matière (brut, perte comprise)</span><span className="font-semibold">{fmtEuro(preview.matiere)}</span></div>
                {preview.emballage > 0 && (
                  <div className="flex justify-between text-gray-600"><span>Emballage &amp; conditionnement</span><span className="font-semibold">{fmtEuro(preview.emballage)}</span></div>
                )}
                <div className="flex justify-between text-gray-600">
                  <span>Main-d&apos;œuvre{previewRate !== null ? ` (${fmtEuro(previewRate)}/h)` : ''}</span>
                  <span className="font-semibold">{fmtEuro(preview.mo)}</span>
                </div>
                <div className="flex justify-between font-extrabold text-pilote-800 mt-1.5 pt-1.5 border-t border-pilote-100">
                  <span>Coût de revient{preview.parUnite !== null ? ` (${fmtEuro(preview.parUnite)} / ${form.yield_unit || 'unité'})` : ''}</span>
                  <span>{fmtEuro(preview.total)}</span>
                </div>
                {preview.manquants > 0 && <p className="text-[11px] text-amber-600 mt-1.5">{preview.manquants} ingrédient{preview.manquants > 1 ? 's' : ''} sans prix — le prix arrivera avec la prochaine facture lue, ou saisissez un prix de repli.</p>}
              </div>

              <div className="flex gap-3 pt-1">
                {editId && (
                  <Button variant="outline" onClick={remove} className="text-red-600 border-red-200 hover:bg-red-50">Retirer</Button>
                )}
                <Button variant="outline" className="flex-1" onClick={() => setShow(false)}>Annuler</Button>
                <Button className="flex-1 bg-pilote hover:bg-pilote-hover text-white" onClick={save} disabled={saving || !form.name.trim()}>
                  {saving ? 'Enregistrement…' : 'Enregistrer'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
