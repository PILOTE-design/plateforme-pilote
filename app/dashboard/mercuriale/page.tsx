'use client'

// Mercuriale — le référentiel de prix d'achat, à deux étages :
//   · les RÉFS FOURNISSEURS, créées automatiquement par la lecture des factures ;
//   · les ARTICLES GÉNÉRIQUES, qui regroupent les réfs (« FILET DE POULET SV »
//     + « FILET DE POULET LR » → « Filet de poulet ») et ramènent tout à une
//     unité de base (kg ou pièce).
// Depuis le 29/07 : une réf qui ne ressemble à rien est associée TOUTE SEULE
// (son propre générique, côté API). La file « À rapprocher » ne montre que les
// appellations proches, groupées — regroupement du groupe en un clic, ou réf
// par réf pour régler un facteur de conversion.
// La lecture des factures se déclenche ici (une facture à la fois).

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ShoppingBasket, FileSearch, TrendingUp, TrendingDown, Search, RefreshCw, Link2, ChevronDown, ChevronRight, Pencil, Trash2, Unlink } from 'lucide-react'
import { useToast } from '@/components/ui/toast'

type Ref = {
  id: string
  name: string
  unit: string | null
  supplier_name: string | null
  article_code: string | null
  last_price_ht: number | null
  last_price_date: string | null
  price_count: number
  variation_pct: number | null
  conversion_factor: number | string | null
  price_base: number | null
  /** Tronc du libellé (calculé serveur) — les réfs au même tronc se ressemblent */
  stem: string
  /** Générique existant au même tronc, s'il y en a un : association suggérée */
  suggested_generic_id: string | null
}

type Generic = {
  id: string
  name: string
  base_unit: 'kg' | 'piece'
  category: 'ingredient' | 'emballage'
  default_loss_pct: number
  refs_count: number
  price_ht: number | null
  price_date: string | null
  price_supplier: string | null
  variation_pct: number | null
  refs: Ref[]
}

type PendingInvoice = {
  id: string
  supplier_name: string
  invoice_date: string
  amount_ht: number | string
  lines_status: string | null
}

const fmtEuro = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const fmtDate = (s: string | null) => (s ? new Date(s + 'T00:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—')
const unitLabel = (u: 'kg' | 'piece') => (u === 'kg' ? 'kg' : 'pièce')
const titleize = (s: string) => { const t = s.trim().replace(/\s+/g, ' '); return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : t }
const guessUnitClient = (u: string | null): 'kg' | 'piece' =>
  (u || '').toLowerCase().includes('kg') ? 'kg' : (u || '').toLowerCase().match(/pi[eè]ce|pce|pcs|unit/) ? 'piece' : 'kg'

/** Nom proposé pour un groupe de réfs qui se ressemblent : le début COMMUN de
 *  leurs libellés (« FILET DE POULET LR 3,2 » + « FILET DE POULET ML 2,5KG »
 *  → « Filet de poulet »), repli sur le premier libellé. */
function commonLabel(names: string[]): string {
  if (names.length === 1) return titleize(names[0])
  const words = names.map(n => n.trim().split(/\s+/))
  const first = words[0]
  const out: string[] = []
  for (let i = 0; i < first.length; i++) {
    if (words.every(w => (w[i] || '').toLowerCase() === first[i].toLowerCase())) out.push(first[i])
    else break
  }
  const label = out.join(' ').replace(/[\s\-–·,]+$/, '')
  return titleize(label || names[0])
}

function Variation({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-gray-300">—</span>
  const up = pct > 0
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold tabular ${up ? 'text-red-600' : 'text-green-600'}`}>
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {pct > 0 ? '+' : ''}{pct.toLocaleString('fr-FR')} %
    </span>
  )
}

export default function MercurialePage() {
  const { toast } = useToast()
  const [generics, setGenerics] = useState<Generic[]>([])
  const [queue, setQueue] = useState<Ref[]>([])
  const [pending, setPending] = useState<PendingInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0, errors: 0 })
  const stopRef = useRef(false)

  // Association d'une réf : ligne ouverte + formulaire (générique existant ou création)
  const [assocId, setAssocId] = useState<string | null>(null)
  const [assoc, setAssoc] = useState({ choice: 'new', newName: '', newUnit: 'kg' as 'kg' | 'piece', newCat: 'ingredient' as 'ingredient' | 'emballage', factor: '' })
  const [saving, setSaving] = useState(false)

  // Regroupement d'un GROUPE de réfs qui se ressemblent (formulaire par tronc)
  const [groupOpen, setGroupOpen] = useState<string | null>(null)
  const [groupForm, setGroupForm] = useState({ name: '', unit: 'kg' as 'kg' | 'piece', cat: 'ingredient' as 'ingredient' | 'emballage' })
  const [groupSaving, setGroupSaving] = useState(false)

  // Catalogue : générique déplié + édition
  const [openId, setOpenId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [edit, setEdit] = useState({ name: '', base_unit: 'kg' as 'kg' | 'piece', category: 'ingredient' as 'ingredient' | 'emballage', loss: '0' })

  const load = useCallback(async () => {
    setLoading(true)
    const data = await fetch('/api/mercuriale', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null)
    if (data) {
      setGenerics(Array.isArray(data.generics) ? data.generics : [])
      setQueue(Array.isArray(data.queue) ? data.queue : [])
      setPending(Array.isArray(data.pending) ? data.pending : [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  /** Lit les factures en attente UNE PAR UNE (extraction PDF + IA par appel) ;
   *  interruptible, reprend où elle en était. */
  async function processQueue() {
    if (processing || pending.length === 0) return
    setProcessing(true)
    stopRef.current = false
    let done = 0, ecartees = 0, errors = 0
    const total = pending.length
    setProgress({ done: 0, total, errors: 0 })
    for (const inv of pending) {
      if (stopRef.current) break
      const res = await fetch('/api/invoices/extract-lines', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: inv.id }),
      }).catch(() => null)
      const data = res ? await res.json().catch(() => null) : null
      if (res?.ok && data?.status === 'hors_matiere') ecartees++
      else if (res?.ok) done++
      else errors++
      setProgress({ done: done + ecartees + errors, total, errors })
    }
    setProcessing(false)
    const detail = [`${done} lue${done > 1 ? 's' : ''}`]
    if (ecartees > 0) detail.push(`${ecartees} hors matière (écartée${ecartees > 1 ? 's' : ''})`)
    if (errors > 0) detail.push(`${errors} en échec`)
    toast(errors === 0
      ? { variant: 'success', title: detail.join(' · '), description: 'Les nouvelles réfs arrivent dans la file « À associer ».' }
      : { variant: 'error', title: detail.join(' · '), description: 'Les factures en échec peuvent être relancées.' })
    load()
  }

  function openAssoc(r: Ref) {
    setAssocId(r.id)
    // Pré-remplissage : suggestion de générique si son tronc correspond, sinon
    // nom nettoyé de la réf ; unité devinée depuis l'unité facturée.
    const suggested = r.suggested_generic_id && generics.some(g => g.id === r.suggested_generic_id) ? r.suggested_generic_id : null
    setAssoc({
      choice: suggested ?? (generics.length > 0 ? '' : 'new'),
      newName: titleize(r.name), newUnit: guessUnitClient(r.unit), newCat: 'ingredient', factor: '',
    })
  }

  /** Associe toutes les réfs d'un groupe au même générique (facteur de
   *  conversion laissé à 1 — réglable réf par réf via « Associer » individuel). */
  async function assocRefs(refs: Ref[], genericId: string, genericName: string) {
    if (groupSaving) return
    setGroupSaving(true)
    let ok = 0, ko = 0
    for (const r of refs) {
      const res = await fetch(`/api/articles/${r.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generic_id: genericId }),
      }).catch(() => null)
      if (res?.ok) ok++
      else ko++
    }
    setGroupSaving(false)
    setGroupOpen(null)
    toast(ko === 0
      ? { variant: 'success', title: `${ok} réf${ok > 1 ? 's' : ''} associée${ok > 1 ? 's' : ''} à « ${genericName} »` }
      : { variant: 'error', title: `${ok} associée${ok > 1 ? 's' : ''}, ${ko} en échec`, description: 'Relancez sur les réfs restantes.' })
    load()
  }

  /** Crée le générique du groupe (nom pré-rempli = tronc commun) puis y associe toutes les réfs */
  async function createGroupGeneric(refs: Ref[]) {
    if (groupSaving) return
    const name = groupForm.name.trim()
    if (!name) { toast({ variant: 'error', title: 'Nom du générique requis' }); return }
    setGroupSaving(true)
    const res = await fetch('/api/generic-articles', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, base_unit: groupForm.unit, category: groupForm.cat }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    setGroupSaving(false)
    if (!res?.ok || !data?.generic?.id) {
      toast({ variant: 'error', title: data?.error || 'Création du générique impossible' })
      return
    }
    await assocRefs(refs, data.generic.id, name)
  }

  async function submitAssoc(r: Ref) {
    if (saving) return
    let genericId = assoc.choice
    if (!genericId) { toast({ variant: 'error', title: 'Choisissez un article générique ou créez-en un' }); return }
    setSaving(true)
    if (genericId === 'new') {
      const name = assoc.newName.trim()
      if (!name) { toast({ variant: 'error', title: 'Nom du générique requis' }); setSaving(false); return }
      const res = await fetch('/api/generic-articles', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, base_unit: assoc.newUnit, category: assoc.newCat }),
      }).catch(() => null)
      const data = res ? await res.json().catch(() => null) : null
      if (!res?.ok || !data?.generic?.id) {
        toast({ variant: 'error', title: data?.error || 'Création du générique impossible' })
        setSaving(false)
        return
      }
      genericId = data.generic.id
    }
    const res2 = await fetch(`/api/articles/${r.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generic_id: genericId, conversion_factor: assoc.factor.trim() === '' ? null : Number(assoc.factor.replace(',', '.')) }),
    }).catch(() => null)
    const d2 = res2 ? await res2.json().catch(() => null) : null
    setSaving(false)
    if (!res2?.ok) { toast({ variant: 'error', title: d2?.error || 'Association impossible' }); return }
    toast({ variant: 'success', title: `« ${r.name} » associée` })
    setAssocId(null)
    load()
  }

  async function dissociate(refId: string, refName: string) {
    const res = await fetch(`/api/articles/${refId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generic_id: null }),
    }).catch(() => null)
    if (res?.ok) { toast({ variant: 'success', title: `« ${refName} » renvoyée dans la file d'attente` }); load() }
    else toast({ variant: 'error', title: 'Dissociation impossible' })
  }

  function startEdit(g: Generic) {
    setEditId(g.id)
    setEdit({ name: g.name, base_unit: g.base_unit, category: g.category, loss: String(g.default_loss_pct ?? 0) })
  }

  async function submitEdit(g: Generic) {
    if (saving) return
    setSaving(true)
    const res = await fetch(`/api/generic-articles/${g.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: edit.name, base_unit: edit.base_unit, category: edit.category, default_loss_pct: Number(edit.loss.replace(',', '.')) || 0 }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    setSaving(false)
    if (!res?.ok) { toast({ variant: 'error', title: data?.error || 'Modification impossible' }); return }
    setEditId(null)
    load()
  }

  // Suppression en deux temps (jamais de dialogue natif) : premier clic arme,
  // second clic exécute. Les réfs retournent dans la file d'attente.
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null)
  async function removeGeneric(g: Generic) {
    if (confirmDelId !== g.id) { setConfirmDelId(g.id); return }
    setConfirmDelId(null)
    const res = await fetch(`/api/generic-articles/${g.id}`, { method: 'DELETE' }).catch(() => null)
    if (res?.ok) { toast({ variant: 'success', title: `« ${g.name} » supprimé — ses réfs retournent dans la file d'attente` }); setOpenId(null); load() }
    else toast({ variant: 'error', title: 'Suppression impossible' })
  }

  const filteredGenerics = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return generics
    return generics.filter(g =>
      g.name.toLowerCase().includes(q)
      || g.refs.some(r => r.name.toLowerCase().includes(q) || (r.supplier_name || '').toLowerCase().includes(q)))
  }, [generics, search])

  const filteredQueue = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return queue
    return queue.filter(r => r.name.toLowerCase().includes(q) || (r.supplier_name || '').toLowerCase().includes(q) || (r.article_code || '').toLowerCase().includes(q))
  }, [queue, search])

  // Groupes de ressemblance : les réfs au même tronc de libellé, avec le
  // générique suggéré s'il existe et un nom proposé (début commun des libellés).
  const queueGroups = useMemo(() => {
    const m = new Map<string, Ref[]>()
    for (const r of filteredQueue) {
      const key = r.stem || r.name.toLowerCase()
      const arr = m.get(key) || []
      arr.push(r)
      m.set(key, arr)
    }
    return [...m.entries()]
      .map(([stem, refs]) => ({
        stem,
        refs,
        label: commonLabel(refs.map(r => r.name)),
        suggested: refs[0].suggested_generic_id ? generics.find(g => g.id === refs[0].suggested_generic_id) ?? null : null,
      }))
      .sort((a, b) => b.refs.length - a.refs.length || a.label.localeCompare(b.label, 'fr'))
  }, [filteredQueue, generics])

  const hausses = useMemo(() => generics.filter(g => (g.variation_pct ?? 0) > 0).length, [generics])

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      {/* En-tête */}
      <div className="mb-8 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-pilote to-pilote-hover rounded-2xl flex items-center justify-center flex-shrink-0 shadow-card">
            <ShoppingBasket className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Mercuriale</h1>
            <p className="text-sm text-gray-500 mt-1">Vos articles génériques, au kg ou à la pièce — chaque réf fournisseur s&apos;y rattache</p>
          </div>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 text-xs font-semibold text-pilote border border-pilote-200 rounded-xl px-3 py-2 hover:bg-pilote-50 transition-colors disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />Actualiser
        </button>
      </div>

      {/* File d'attente d'extraction */}
      {pending.length > 0 && (
        <div className="mb-6 bg-pilote-50 border border-pilote-200 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
          <FileSearch className="w-4 h-4 text-pilote flex-shrink-0" />
          <p className="text-sm text-pilote-800 flex-1 min-w-[200px]">
            <strong>{pending.length} facture{pending.length > 1 ? 's' : ''}</strong> avec PDF en attente de lecture.
            Seule la matière première entre dans la mercuriale ; les nouvelles réfs arrivent ensuite dans la file d&apos;association.
          </p>
          {processing ? (
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-pilote tabular">{progress.done} / {progress.total}{progress.errors > 0 ? ` · ${progress.errors} échec${progress.errors > 1 ? 's' : ''}` : ''}</span>
              <button onClick={() => { stopRef.current = true }}
                className="text-xs font-bold text-pilote underline">Arrêter</button>
            </div>
          ) : (
            <button onClick={processQueue}
              className="text-xs font-bold text-white bg-pilote hover:bg-pilote-hover rounded-lg px-3.5 py-2 shadow-card active:scale-[0.98] transition-all">
              Lire les factures
            </button>
          )}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Articles génériques</p>
          <p className="text-2xl font-extrabold tracking-tight text-gray-900 tabular">{generics.length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Réfs à rapprocher</p>
          <p className={`text-2xl font-extrabold tracking-tight tabular ${queue.length > 0 ? 'text-amber-600' : 'text-gray-900'}`}>{queue.length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Prix en hausse</p>
          <p className={`text-2xl font-extrabold tracking-tight tabular ${hausses > 0 ? 'text-red-600' : 'text-gray-900'}`}>{hausses}</p>
        </div>
      </div>

      {/* Recherche */}
      <div className="relative mb-5">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un article générique, une réf, un fournisseur…"
          className="w-full border border-gray-200 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200" />
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : (
        <>
          {/* File de RAPPROCHEMENT : uniquement les réfs qui se ressemblent — entre
              elles (même tronc de libellé) ou avec un générique existant. Les réfs
              sans ressemblance sont associées automatiquement, il n'y a rien à faire. */}
          {queueGroups.length > 0 && (
            <div className="mb-8">
              <div className="flex items-baseline gap-2 mb-1">
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-700">À rapprocher</h2>
                <span className="text-[11px] text-gray-400 tabular">{filteredQueue.length} réf{filteredQueue.length > 1 ? 's' : ''} · {queueGroups.length} produit{queueGroups.length > 1 ? 's' : ''}</span>
              </div>
              <p className="text-[11px] text-gray-400 mb-3">
                Les réfs qui ne ressemblent à rien deviennent automatiquement leur propre article générique.
                Ne restent ici que les appellations proches à regrouper — d&apos;un clic pour tout le groupe, ou réf par réf (utile pour régler un facteur de conversion).
              </p>
              <div className="space-y-3">
                {queueGroups.map(grp => (
                  <div key={grp.stem} className="bg-white rounded-2xl border border-amber-200 shadow-card overflow-hidden">
                    <div className="px-4 py-2.5 bg-amber-50/60 flex items-center gap-3 flex-wrap">
                      <p className="text-sm font-bold text-gray-900 flex-1 min-w-[180px]">
                        {grp.label}
                        <span className="ml-2 text-[11px] font-semibold text-amber-700 tabular">{grp.refs.length} réf{grp.refs.length > 1 ? 's' : ''}{grp.refs.length > 1 ? ' qui se ressemblent' : ''}</span>
                      </p>
                      {grp.suggested ? (
                        <button onClick={() => assocRefs(grp.refs, grp.suggested!.id, grp.suggested!.name)} disabled={groupSaving}
                          className="text-xs font-bold text-white bg-pilote hover:bg-pilote-hover rounded-lg px-3.5 py-2 shadow-card active:scale-[0.98] transition-all disabled:opacity-50">
                          {groupSaving ? 'Association…' : `${grp.refs.length > 1 ? 'Tout associer' : 'Associer'} à « ${grp.suggested.name} »`}
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setGroupOpen(prev => prev === grp.stem ? null : grp.stem)
                            setGroupForm({ name: grp.label, unit: guessUnitClient(grp.refs[0]?.unit ?? null), cat: 'ingredient' })
                          }}
                          className={`text-xs font-bold rounded-lg px-3.5 py-2 transition-all ${groupOpen === grp.stem ? 'text-gray-500 bg-gray-100' : 'text-white bg-pilote hover:bg-pilote-hover shadow-card active:scale-[0.98]'}`}>
                          {groupOpen === grp.stem ? 'Annuler' : grp.refs.length > 1 ? `Regrouper les ${grp.refs.length} réfs` : 'Créer son générique'}
                        </button>
                      )}
                    </div>
                    {groupOpen === grp.stem && !grp.suggested && (
                      <div className="px-4 py-3 bg-pilote-50/40 border-b border-dashed border-pilote-200 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
                        <div className="md:col-span-2">
                          <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Nom de l&apos;article générique</label>
                          <input value={groupForm.name} onChange={e => setGroupForm(f => ({ ...f, name: e.target.value }))}
                            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Unité de base</label>
                          <select value={groupForm.unit} onChange={e => setGroupForm(f => ({ ...f, unit: e.target.value as 'kg' | 'piece' }))}
                            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200">
                            <option value="kg">au kg</option>
                            <option value="piece">à la pièce</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Catégorie</label>
                          <select value={groupForm.cat} onChange={e => setGroupForm(f => ({ ...f, cat: e.target.value as 'ingredient' | 'emballage' }))}
                            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200">
                            <option value="ingredient">Ingrédient</option>
                            <option value="emballage">Emballage</option>
                          </select>
                        </div>
                        <button onClick={() => createGroupGeneric(grp.refs)} disabled={groupSaving}
                          className="text-xs font-bold text-white bg-pilote hover:bg-pilote-hover rounded-lg px-4 py-2.5 shadow-card active:scale-[0.98] transition-all disabled:opacity-50">
                          {groupSaving ? 'Création…' : `Créer et associer${grp.refs.length > 1 ? ` les ${grp.refs.length} réfs` : ''}`}
                        </button>
                      </div>
                    )}
                    <div className="divide-y divide-gray-100">
                      {grp.refs.map(r => {
                  const isOpen = assocId === r.id
                  const targetUnit = assoc.choice === 'new' ? assoc.newUnit : (generics.find(g => g.id === assoc.choice)?.base_unit ?? 'kg')
                  return (
                    <div key={r.id}>
                      <div className="flex items-center gap-3 px-4 py-2.5 flex-wrap">
                        <div className="flex-1 min-w-[220px]">
                          <p className="text-sm font-semibold text-gray-900">{r.name}</p>
                          <p className="text-[11px] text-gray-400">{r.supplier_name || '—'}{r.article_code ? ` · ${r.article_code}` : ''}</p>
                        </div>
                        <span className="text-xs text-gray-500 tabular">{r.last_price_ht !== null ? `${fmtEuro(Number(r.last_price_ht))}${r.unit ? ` / ${r.unit}` : ''}` : '—'}</span>
                        <button onClick={() => isOpen ? setAssocId(null) : openAssoc(r)}
                          className={`flex items-center gap-1.5 text-xs font-bold rounded-lg px-3 py-1.5 transition-all ${isOpen ? 'text-gray-500 bg-gray-100' : 'text-white bg-pilote hover:bg-pilote-hover shadow-card active:scale-[0.98]'}`}>
                          <Link2 className="w-3.5 h-3.5" />{isOpen ? 'Annuler' : 'Associer'}
                        </button>
                      </div>
                      {isOpen && (
                        <div className="px-4 pb-4 pt-1 bg-pilote-50/40 border-t border-dashed border-pilote-200">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                            <div>
                              <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Article générique</label>
                              <select value={assoc.choice} onChange={e => setAssoc(a => ({ ...a, choice: e.target.value }))}
                                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200">
                                <option value="">— Choisir —</option>
                                <option value="new">➕ Créer un nouvel article générique</option>
                                {generics.map(g => <option key={g.id} value={g.id}>{g.name} (/ {unitLabel(g.base_unit)})</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                                Conversion — 1 {r.unit || 'unité facturée'} = combien de {unitLabel(targetUnit)} ?
                              </label>
                              <input value={assoc.factor} onChange={e => setAssoc(a => ({ ...a, factor: e.target.value }))} placeholder="1 (mêmes unités)" inputMode="decimal"
                                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                            </div>
                          </div>
                          {assoc.choice === 'new' && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                              <div>
                                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Nom du générique</label>
                                <input value={assoc.newName} onChange={e => setAssoc(a => ({ ...a, newName: e.target.value }))} placeholder="Filet de poulet"
                                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                              </div>
                              <div>
                                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Unité de base</label>
                                <select value={assoc.newUnit} onChange={e => setAssoc(a => ({ ...a, newUnit: e.target.value as 'kg' | 'piece' }))}
                                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200">
                                  <option value="kg">au kg</option>
                                  <option value="piece">à la pièce</option>
                                </select>
                              </div>
                              <div>
                                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Catégorie</label>
                                <select value={assoc.newCat} onChange={e => setAssoc(a => ({ ...a, newCat: e.target.value as 'ingredient' | 'emballage' }))}
                                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200">
                                  <option value="ingredient">Ingrédient</option>
                                  <option value="emballage">Emballage &amp; conditionnement</option>
                                </select>
                              </div>
                            </div>
                          )}
                          <div className="mt-3 flex justify-end">
                            <button onClick={() => submitAssoc(r)} disabled={saving}
                              className="text-xs font-bold text-white bg-pilote hover:bg-pilote-hover rounded-lg px-4 py-2 shadow-card active:scale-[0.98] transition-all disabled:opacity-50">
                              {saving ? 'Association…' : 'Associer cette réf'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Catalogue des articles génériques */}
          {filteredGenerics.length === 0 && filteredQueue.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-gray-200 py-16 text-center">
              <ShoppingBasket className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-500 mb-1">{generics.length === 0 && queue.length === 0 ? 'Aucun article pour l’instant' : 'Rien ne correspond à la recherche'}</p>
              {generics.length === 0 && queue.length === 0 && (
                <p className="text-xs text-gray-400 max-w-md mx-auto">
                  Synchronisez Pennylane depuis la page Facturation, puis cliquez sur « Lire les factures » :
                  les réfs sans ressemblance deviennent automatiquement des articles génériques,
                  et seuls les produits aux appellations proches vous attendront ici pour être regroupés.
                </p>
              )}
            </div>
          ) : filteredGenerics.length > 0 && (
            <div>
              <div className="flex items-baseline gap-2 mb-3">
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-700">Catalogue</h2>
                <span className="text-[11px] text-gray-400 tabular">{filteredGenerics.length} article{filteredGenerics.length > 1 ? 's' : ''} générique{filteredGenerics.length > 1 ? 's' : ''}</span>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px]">
                    <thead>
                      <tr className="bg-gray-50 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                        <th className="px-4 py-2.5 text-left">Article générique</th>
                        <th className="px-4 py-2.5 text-left">Catégorie</th>
                        <th className="px-4 py-2.5 text-right">Dernier prix HT</th>
                        <th className="px-4 py-2.5 text-left">Unité</th>
                        <th className="px-4 py-2.5 text-right">Au</th>
                        <th className="px-4 py-2.5 text-right">Variation</th>
                        <th className="px-4 py-2.5 text-right">Réfs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredGenerics.map(g => {
                        const isOpen = openId === g.id
                        const isEdit = editId === g.id
                        return (
                          <Fragment key={g.id}>
                            <tr onClick={() => { setOpenId(isOpen ? null : g.id); setEditId(null); setConfirmDelId(null) }}
                              className="border-t border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer">
                              <td className="px-4 py-2.5 text-sm font-semibold text-gray-900">
                                <span className="inline-flex items-center gap-1.5">
                                  {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
                                  {g.name}
                                </span>
                              </td>
                              <td className="px-4 py-2.5">
                                <span className={`text-[10px] font-semibold uppercase tracking-wider rounded-lg px-1.5 py-0.5 ${g.category === 'emballage' ? 'text-blue-700 bg-blue-50' : 'text-pilote bg-pilote-50'}`}>
                                  {g.category === 'emballage' ? 'Emballage' : 'Ingrédient'}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-right text-sm font-bold text-gray-900 tabular">{g.price_ht !== null ? fmtEuro(Number(g.price_ht)) : '—'}</td>
                              <td className="px-4 py-2.5 text-xs text-gray-500">/ {unitLabel(g.base_unit)}</td>
                              <td className="px-4 py-2.5 text-right text-xs text-gray-500 tabular">{fmtDate(g.price_date)}</td>
                              <td className="px-4 py-2.5 text-right"><Variation pct={g.variation_pct} /></td>
                              <td className="px-4 py-2.5 text-right text-xs text-gray-400 tabular">{g.refs_count}</td>
                            </tr>
                            {isOpen && (
                              <tr className="bg-gray-50/60">
                                <td colSpan={7} className="px-4 py-3">
                                  {isEdit ? (
                                    <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end" onClick={e => e.stopPropagation()}>
                                      <div className="md:col-span-2">
                                        <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Nom</label>
                                        <input value={edit.name} onChange={e => setEdit(f => ({ ...f, name: e.target.value }))}
                                          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                                      </div>
                                      <div>
                                        <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Unité</label>
                                        <select value={edit.base_unit} onChange={e => setEdit(f => ({ ...f, base_unit: e.target.value as 'kg' | 'piece' }))}
                                          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200">
                                          <option value="kg">au kg</option>
                                          <option value="piece">à la pièce</option>
                                        </select>
                                      </div>
                                      <div>
                                        <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Catégorie</label>
                                        <select value={edit.category} onChange={e => setEdit(f => ({ ...f, category: e.target.value as 'ingredient' | 'emballage' }))}
                                          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200">
                                          <option value="ingredient">Ingrédient</option>
                                          <option value="emballage">Emballage</option>
                                        </select>
                                      </div>
                                      <div>
                                        <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Perte par défaut (%)</label>
                                        <input value={edit.loss} onChange={e => setEdit(f => ({ ...f, loss: e.target.value }))} inputMode="decimal"
                                          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                                      </div>
                                      <div className="md:col-span-5 flex justify-end gap-2">
                                        <button onClick={() => setEditId(null)} className="text-xs font-semibold text-gray-500 rounded-lg px-3 py-2 hover:bg-gray-100">Annuler</button>
                                        <button onClick={() => submitEdit(g)} disabled={saving}
                                          className="text-xs font-bold text-white bg-pilote hover:bg-pilote-hover rounded-lg px-4 py-2 shadow-card disabled:opacity-50">Enregistrer</button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div onClick={e => e.stopPropagation()}>
                                      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                                        <p className="text-[11px] text-gray-500">
                                          Perte par défaut : <strong className="tabular">{g.default_loss_pct.toLocaleString('fr-FR')} %</strong>
                                          {g.price_supplier ? <> · dernier prix chez <strong>{g.price_supplier}</strong></> : null}
                                        </p>
                                        <div className="flex items-center gap-2">
                                          <button onClick={() => startEdit(g)} className="flex items-center gap-1 text-xs font-semibold text-pilote rounded-lg px-2.5 py-1.5 hover:bg-pilote-50"><Pencil className="w-3 h-3" />Modifier</button>
                                          <button onClick={() => removeGeneric(g)}
                                            className={`flex items-center gap-1 text-xs font-semibold rounded-lg px-2.5 py-1.5 transition-colors ${confirmDelId === g.id ? 'text-white bg-red-600 hover:bg-red-700' : 'text-red-600 hover:bg-red-50'}`}>
                                            <Trash2 className="w-3 h-3" />{confirmDelId === g.id ? 'Confirmer la suppression ?' : 'Supprimer'}
                                          </button>
                                        </div>
                                      </div>
                                      {g.refs.length === 0 ? (
                                        <p className="text-xs text-gray-400">Aucune réf fournisseur rattachée.</p>
                                      ) : (
                                        <div className="space-y-1">
                                          {g.refs.map(r => (
                                            <div key={r.id} className="flex items-center gap-3 text-xs bg-white border border-gray-100 rounded-lg px-3 py-2 flex-wrap">
                                              <span className="font-semibold text-gray-800 flex-1 min-w-[180px]">{r.name}</span>
                                              <span className="text-gray-400">{r.supplier_name || '—'}</span>
                                              <span className="text-gray-500 tabular">
                                                {r.last_price_ht !== null ? `${fmtEuro(Number(r.last_price_ht))}${r.unit ? ` / ${r.unit}` : ''}` : '—'}
                                              </span>
                                              <span className="font-bold text-gray-900 tabular">
                                                {r.price_base !== null ? `${fmtEuro(r.price_base)} / ${unitLabel(g.base_unit)}` : '—'}
                                              </span>
                                              <button onClick={() => dissociate(r.id, r.name)} title="Renvoyer dans la file d'attente"
                                                className="flex items-center gap-1 font-semibold text-gray-400 hover:text-red-600 transition-colors"><Unlink className="w-3 h-3" />Dissocier</button>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="px-4 py-3 text-[11px] text-gray-400 border-t border-gray-100 leading-snug">
                  Le prix d&apos;un article générique est le dernier prix relevé parmi ses réfs fournisseurs, ramené à son unité
                  de base par le facteur de conversion (« 1 rouleau = 4,5 kg »). Une hausse est en rouge — c&apos;est un coût d&apos;achat.
                  Les fiches recettes s&apos;appuieront uniquement sur ces articles génériques.
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
