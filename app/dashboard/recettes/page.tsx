'use client'

// Fiches recettes — coût de revient au prix du jour, façon Otami mais branché sur
// les données PILOTE : la matière lit la mercuriale (dernier prix facturé de
// chaque article), la main-d'œuvre lit le taux horaire chargé moyen de l'équipe
// (CCN 992, planning). Rien n'est figé : une facture lue ou une embauche, et
// toutes les fiches se recalculent.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChefHat, Plus, X, Search, AlertTriangle, Clock, ShoppingBasket } from 'lucide-react'
import Link from 'next/link'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Article = { id: string; name: string; unit: string | null; supplier_name: string | null; last_price_ht: number | string | null }

type IngredientDraft = {
  article_id: string | null
  label: string
  quantity: string
  unit: string | null
  manual_price_ht: string
}

type RecipeCost = {
  matiere_ht: number; main_oeuvre_ht: number; total_ht: number; par_unite_ht: number | null
  prix_manquants: number; pv_unitaire_ht: number | null; marge_pct: number | null; coefficient: number | null
}

type Recipe = {
  id: string; name: string; category: string | null
  yield_qty: number | null; yield_unit: string | null
  labor_minutes: number; selling_price_ttc: number | null; tva_rate: number; notes: string | null
  ingredients: { article_id: string | null; label: string; quantity: number; unit: string | null; manual_price_ht: number | null; unit_price_ht: number | null; price_source: string; line_total_ht: number }[]
  cost: RecipeCost
}

const fmtEuro = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const EMPTY_ING = (): IngredientDraft => ({ article_id: null, label: '', quantity: '', unit: null, manual_price_ht: '' })

// Catégories proposées — les trois métiers de la maison. Le champ reste libre :
// une catégorie inconnue crée simplement sa propre section.
const CATEGORIES_SUGGEREES = ['boucherie', 'charcuterie', 'traiteur']
const catLabel = (c: string | null) => (c && c.trim() ? c.trim().toLowerCase() : 'sans catégorie')

export default function RecettesPage() {
  const { toast } = useToast()
  const { confirm: confirmAction } = useConfirm()
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [articles, setArticles] = useState<Article[]>([])
  const [laborRate, setLaborRate] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Modale création / édition
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [catFilter, setCatFilter] = useState<string | null>(null)
  const [show, setShow] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', category: '', yield_qty: '', yield_unit: 'pièces', labor_minutes: '', selling_price_ttc: '', tva_rate: '5.5' })
  const [ings, setIngs] = useState<IngredientDraft[]>([EMPTY_ING()])
  const [pickerRow, setPickerRow] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [rec, merc] = await Promise.all([
      fetch('/api/recipes', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/mercuriale', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
    ])
    if (rec) { setRecipes(Array.isArray(rec.recipes) ? rec.recipes : []); setLaborRate(rec.labor_rate_ht ?? null) }
    if (merc) setArticles(Array.isArray(merc.articles) ? merc.articles : [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const priceOf = useCallback((articleId: string | null): number | null => {
    if (!articleId) return null
    const a = articles.find(x => x.id === articleId)
    return a?.last_price_ht != null ? parseFloat(String(a.last_price_ht)) : null
  }, [articles])

  // Aperçu du coût dans la modale — même logique que le serveur, en lecture seule
  const preview = useMemo(() => {
    let matiere = 0, manquants = 0
    for (const ing of ings) {
      const qty = parseFloat(ing.quantity.replace(',', '.')) || 0
      if (qty <= 0) continue
      const price = priceOf(ing.article_id) ?? (parseFloat(ing.manual_price_ht.replace(',', '.')) || null)
      if (price === null) { manquants++; continue }
      matiere += qty * price
    }
    const minutes = parseFloat(form.labor_minutes.replace(',', '.')) || 0
    const mo = laborRate !== null ? minutes / 60 * laborRate : 0
    const yieldQty = parseFloat(form.yield_qty.replace(',', '.')) || 0
    return { matiere, mo, total: matiere + mo, parUnite: yieldQty > 0 ? (matiere + mo) / yieldQty : null, manquants }
  }, [ings, form.labor_minutes, form.yield_qty, laborRate, priceOf])

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
    setForm({ name: '', category: '', yield_qty: '', yield_unit: 'pièces', labor_minutes: '', selling_price_ttc: '', tva_rate: '5.5' })
    setIngs([EMPTY_ING()])
    setShow(true)
  }

  function openEdit(r: Recipe) {
    setEditId(r.id)
    setForm({
      name: r.name, category: r.category ?? '',
      yield_qty: r.yield_qty != null ? String(r.yield_qty) : '', yield_unit: r.yield_unit ?? 'pièces',
      labor_minutes: String(r.labor_minutes ?? ''), selling_price_ttc: r.selling_price_ttc != null ? String(r.selling_price_ttc) : '',
      tva_rate: String(r.tva_rate ?? '5.5'),
    })
    setIngs(r.ingredients.length > 0
      ? r.ingredients.map(i => ({ article_id: i.article_id, label: i.label, quantity: String(i.quantity), unit: i.unit, manual_price_ht: i.manual_price_ht != null ? String(i.manual_price_ht) : '' }))
      : [EMPTY_ING()])
    setShow(true)
  }

  async function save() {
    setSaving(true)
    const payload = {
      name: form.name, category: form.category || null,
      yield_qty: form.yield_qty ? parseFloat(form.yield_qty.replace(',', '.')) : null,
      yield_unit: form.yield_unit || null,
      labor_minutes: parseFloat(form.labor_minutes.replace(',', '.')) || 0,
      selling_price_ttc: form.selling_price_ttc ? parseFloat(form.selling_price_ttc.replace(',', '.')) : null,
      tva_rate: parseFloat(form.tva_rate.replace(',', '.')) || 5.5,
      ingredients: ings
        .filter(i => i.label.trim() && parseFloat(i.quantity.replace(',', '.')) > 0)
        .map(i => ({
          article_id: i.article_id, label: i.label, unit: i.unit,
          quantity: parseFloat(i.quantity.replace(',', '.')),
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

  function pickArticle(row: number, a: Article) {
    setIngs(prev => prev.map((ing, i) => i === row
      ? { ...ing, article_id: a.id, label: a.name, unit: a.unit, manual_price_ht: '' }
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
                    onClick={() => { setSearchOpen(false); openEdit(r) }}
                    className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-pilote-50/60 transition-colors border-b border-gray-50 last:border-b-0">
                    <span className="text-sm font-semibold text-gray-900 truncate">{r.name}</span>
                    <span className={`text-[10px] font-semibold uppercase tracking-wider rounded-md px-1.5 py-0.5 flex-shrink-0 capitalize ${r.category && r.category.trim() ? 'text-pilote bg-pilote-50' : 'text-gray-400 bg-gray-50'}`}>
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
            <button key={r.id} onClick={() => openEdit(r)}
              className="text-left bg-white rounded-2xl border border-gray-100 shadow-card p-5 hover:shadow-card-hover hover:-translate-y-0.5 transition-all">
              <div className="flex items-start justify-between gap-2 mb-3">
                <p className="text-sm font-bold text-gray-900 leading-snug">{r.name}</p>
                {r.category && <span className="text-[10px] font-semibold uppercase tracking-wider text-pilote bg-pilote-50 rounded-md px-1.5 py-0.5 flex-shrink-0">{r.category}</span>}
              </div>
              <p className="text-2xl font-extrabold tracking-tight text-gray-900 tabular">
                {r.cost.par_unite_ht !== null ? fmtEuro(r.cost.par_unite_ht) : fmtEuro(r.cost.total_ht)}
                <span className="text-xs font-semibold text-gray-400 ml-1.5">
                  {r.cost.par_unite_ht !== null ? `/ ${r.yield_unit || 'unité'}` : '/ batch'}
                </span>
              </p>
              <div className="mt-2 space-y-0.5 text-[11px] text-gray-500 tabular">
                <p><ShoppingBasket className="w-3 h-3 inline mr-1 text-gray-400" />Matière {fmtEuro(r.cost.matiere_ht)}</p>
                <p><Clock className="w-3 h-3 inline mr-1 text-gray-400" />Main-d&apos;œuvre {fmtEuro(r.cost.main_oeuvre_ht)} ({r.labor_minutes} min)</p>
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
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-gray-900">{editId ? 'Modifier la recette' : 'Nouvelle recette'}</h2>
              <button onClick={() => setShow(false)} className="p-1.5 rounded-md hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
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
                    className="w-full h-10 border border-gray-200 rounded-md px-3 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200 bg-white">
                    <option value="5.5">5,5 % (à emporter)</option>
                    <option value="10">10 % (sur place)</option>
                    <option value="20">20 %</option>
                  </select>
                </div>
              </div>

              {/* Ingrédients */}
              <div>
                <p className="text-xs font-semibold text-gray-700 mb-2">Ingrédients <span className="font-normal text-gray-400">— quantité dans l&apos;unité de facturation de l&apos;article (kg le plus souvent)</span></p>
                <div className="space-y-2">
                  {ings.map((ing, i) => {
                    const price = priceOf(ing.article_id)
                    const q = ing.label.trim().toLowerCase()
                    const suggestions = pickerRow === i && q.length >= 2 && !ing.article_id
                      ? articles.filter(a => a.name.toLowerCase().includes(q)).slice(0, 6)
                      : []
                    return (
                      <div key={i} className="relative">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 relative">
                            <Search className="w-3.5 h-3.5 text-gray-300 absolute left-2.5 top-1/2 -translate-y-1/2" />
                            <input value={ing.label}
                              onChange={e => { setIngs(prev => prev.map((x, j) => j === i ? { ...x, label: e.target.value, article_id: null } : x)); setPickerRow(i) }}
                              onFocus={() => setPickerRow(i)}
                              placeholder="Chercher un article de la mercuriale, ou saisir librement"
                              className={`w-full border rounded-md pl-8 pr-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200 ${ing.article_id ? 'border-pilote-200 bg-pilote-50/50 font-medium' : 'border-gray-200'}`} />
                          </div>
                          <input inputMode="decimal" value={ing.quantity}
                            onChange={e => setIngs(prev => prev.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))}
                            placeholder="Qté" className="w-16 border border-gray-200 rounded-md px-2 py-2 text-sm text-right tabular focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                          <span className="text-[11px] text-gray-400 w-10 flex-shrink-0">{ing.unit || '—'}</span>
                          {ing.article_id ? (
                            <span className="text-xs text-gray-500 tabular w-20 text-right flex-shrink-0">{price !== null ? fmtEuro(price) : 'prix ?'}</span>
                          ) : (
                            <input inputMode="decimal" value={ing.manual_price_ht}
                              onChange={e => setIngs(prev => prev.map((x, j) => j === i ? { ...x, manual_price_ht: e.target.value } : x))}
                              placeholder="€ HT/u" className="w-20 border border-gray-200 rounded-md px-2 py-2 text-xs text-right tabular focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                          )}
                          <button onClick={() => setIngs(prev => prev.length > 1 ? prev.filter((_, j) => j !== i) : prev)}
                            className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
                        </div>
                        {suggestions.length > 0 && (
                          <div className="absolute z-10 left-0 right-24 mt-1 bg-white border border-gray-200 rounded-lg shadow-card-hover overflow-hidden">
                            {suggestions.map(a => (
                              <button key={a.id} onClick={() => pickArticle(i, a)}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-pilote-50 flex items-center justify-between gap-2">
                                <span className="truncate">{a.name} <span className="text-[11px] text-gray-400">· {a.supplier_name || '—'}</span></span>
                                <span className="text-xs text-gray-500 tabular flex-shrink-0">
                                  {a.last_price_ht != null ? `${fmtEuro(parseFloat(String(a.last_price_ht)))}${a.unit ? ` / ${a.unit}` : ''}` : '—'}
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
                <div className="flex justify-between text-gray-600"><span>Matière</span><span className="font-semibold">{fmtEuro(preview.matiere)}</span></div>
                <div className="flex justify-between text-gray-600"><span>Main-d&apos;œuvre</span><span className="font-semibold">{fmtEuro(preview.mo)}</span></div>
                <div className="flex justify-between font-extrabold text-pilote-800 mt-1.5 pt-1.5 border-t border-pilote-100">
                  <span>Coût de revient{preview.parUnite !== null ? ` (${fmtEuro(preview.parUnite)} / ${form.yield_unit || 'unité'})` : ''}</span>
                  <span>{fmtEuro(preview.total)}</span>
                </div>
                {preview.manquants > 0 && <p className="text-[11px] text-amber-600 mt-1.5">{preview.manquants} ingrédient{preview.manquants > 1 ? 's' : ''} sans prix — rattachez un article ou saisissez un prix manuel.</p>}
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
