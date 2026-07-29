'use client'

// Mercuriale — le référentiel de prix d'achat, à deux étages :
//   · les RÉFS FOURNISSEURS, créées automatiquement par la lecture des factures ;
//   · les ARTICLES GÉNÉRIQUES, qui regroupent les réfs (« FILET DE POULET SV »
//     + « FILET DE POULET LR » → « Filet de poulet ») et ramènent tout à une
//     unité de base (kg ou pièce).
//
// Une réf qui ne ressemble à rien est associée TOUTE SEULE (générique auto,
// côté API). Le reste se regroupe par SÉLECTION : cliquer « Associer » sur une
// réf la met dans l'association en cours, cliquer « Associer » sur d'autres les
// ajoute, puis tout part vers le même générique (existant ou créé). Une réf
// facturée dans une autre unité que la base du générique (pièce vs kg) exige
// son facteur de conversion — sans lui, son prix serait faux, donc il est
// IGNORÉ et signalé.
//
// Deux vues : le CATALOGUE (prix du jour) et le DOSSIER DES ASSOCIATIONS
// (chaque générique avec ses réfs à plat — badge Auto, conversions manquantes
// à régler sur place, déplacer / dissocier une réf).
// La lecture des factures se déclenche ici (une facture à la fois).

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ShoppingBasket, FileSearch, TrendingUp, TrendingDown, Search, RefreshCw, Link2, ChevronDown, ChevronRight, Pencil, Trash2, Unlink, X, Check, AlertTriangle } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { guessBaseUnit, unitKind } from '@/lib/mercuriale-auto'

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
  /** Associée mais facturée dans une unité incompatible SANS facteur : prix ignoré */
  needs_conversion: boolean
  /** Clé de rapprochement (calculée serveur) — les réfs à la même clé se ressemblent */
  stem: string
  /** Ligne non-produit (taxe, remise, licence…) : jamais associée d'office */
  non_product: boolean
  /** Générique existant à la même clé, s'il y en a un : association suggérée */
  suggested_generic_id: string | null
}

type Generic = {
  id: string
  name: string
  base_unit: 'kg' | 'piece'
  category: 'ingredient' | 'emballage'
  default_loss_pct: number
  auto_created: boolean
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

/** Nom proposé pour un lot de réfs qui se ressemblent : le début COMMUN de
 *  leurs libellés (« FILET DE POULET LR 3,2 » + « FILET DE POULET ML 2,5KG »
 *  → « Filet de poulet »), repli sur le premier libellé. */
function commonLabel(names: string[]): string {
  if (names.length === 0) return ''
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
  )}

export default function MercurialePage() {
  const { toast } = useToast()
  const [generics, setGenerics] = useState<Generic[]>([])
  const [queue, setQueue] = useState<Ref[]>([])
  const [pending, setPending] = useState<PendingInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'catalogue' | 'associations'>('catalogue')
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0, errors: 0 })
  const stopRef = useRef(false)

  // ── ASSOCIATION PAR SÉLECTION : « Associer » sur une réf l'ajoute au lot,
  // « Associer » sur une autre l'ajoute aussi ; tout part vers le même générique.
  const [selIds, setSelIds] = useState<string[]>([])
  const [selTarget, setSelTarget] = useState({ choice: '', newName: '', newUnit: 'kg' as 'kg' | 'piece', newCat: 'ingredient' as 'ingredient' | 'emballage' })
  const [factors, setFactors] = useState<Record<string, string>>({})
  const [selSaving, setSelSaving] = useState(false)
  const nameTouchedRef = useRef(false)

  // Dossier des associations : brouillons de conversion à régler sur place
  const [fixDrafts, setFixDrafts] = useState<Record<string, string>>({})

  // Catalogue : générique déplié + édition + suppression en deux clics
  const [openId, setOpenId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [edit, setEdit] = useState({ name: '', base_unit: 'kg' as 'kg' | 'piece', category: 'ingredient' as 'ingredient' | 'emballage', loss: '0' })
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null)
  const [showNonProduct, setShowNonProduct] = useState(false)

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
      ? { variant: 'success', title: detail.join(' · '), description: 'Les réfs sans ressemblance s’associent toutes seules ; les autres arrivent dans « À rapprocher ».' }
      : { variant: 'error', title: detail.join(' · '), description: 'Les factures en échec peuvent être relancées.' })
    load()
  }

  // ── Sélection ──────────────────────────────────────

  const selRefs = useMemo(() => {
    const byId = new Map(queue.map(r => [r.id, r]))
    return selIds.map(id => byId.get(id)).filter((r): r is Ref => !!r)
  }, [selIds, queue])

  const targetBase: 'kg' | 'piece' | null = selTarget.choice === 'new'
    ? selTarget.newUnit
    : selTarget.choice
      ? generics.find(g => g.id === selTarget.choice)?.base_unit ?? null
      : null

  /** « Associer » = ajouter/retirer la réf de l'association en cours */
  function toggleSel(r: Ref) {
    const adding = !selIds.includes(r.id)
    setSelIds(prev => adding ? [...prev, r.id] : prev.filter(x => x !== r.id))
    if (adding && selIds.length === 0) {
      // Première réf du lot : suggestion si un générique partage sa clé
      nameTouchedRef.current = false
      const sugg = r.suggested_generic_id && generics.some(g => g.id === r.suggested_generic_id) ? r.suggested_generic_id : ''
      setSelTarget({
        choice: sugg || (generics.length > 0 ? '' : 'new'),
        newName: titleize(r.name),
        newUnit: guessBaseUnit(r.unit),
        newCat: 'ingredient',
      })
      setFactors({})
    } else if (adding && !nameTouchedRef.current) {
      setSelTarget(t => ({ ...t, newName: commonLabel([...selRefs.map(x => x.name), r.name]) }))
    }
  }

  function clearSel() {
    setSelIds([])
    setFactors({})
    nameTouchedRef.current = false
  }

  /** Charge un groupe entier dans l'association en cours (préréglée) */
  function groupToPanel(refs: Ref[], choice: string, name?: string) {
    setSelIds(refs.map(r => r.id))
    nameTouchedRef.current = false
    setFactors({})
    setSelTarget({
      choice,
      newName: name ?? commonLabel(refs.map(r => r.name)),
      newUnit: guessBaseUnit(refs[0]?.unit ?? null),
      newCat: 'ingredient',
    })
  }

  /** Associe directement des réfs à un générique (toutes compatibles, facteur 1) */
  async function assocDirect(refs: Ref[], genericId: string, genericName: string) {
    if (selSaving) return
    setSelSaving(true)
    let ok = 0, ko = 0
    for (const r of refs) {
      const res = await fetch(`/api/articles/${r.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generic_id: genericId }),
      }).catch(() => null)
      if (res?.ok) ok++
      else ko++
    }
    setSelSaving(false)
    toast(ko === 0
      ? { variant: 'success', title: `${ok} réf${ok > 1 ? 's' : ''} associée${ok > 1 ? 's' : ''} à « ${genericName} »` }
      : { variant: 'error', title: `${ok} associée${ok > 1 ? 's' : ''}, ${ko} en échec`, description: 'Relancez sur les réfs restantes.' })
    load()
  }

  /** Bouton de groupe « Tout associer à X » : direct si toutes les unités sont
   *  compatibles, sinon passage par l'association en cours (facteurs exigés). */
  function assocSuggested(grp: { refs: Ref[]; suggested: Generic | null }) {
    const g = grp.suggested
    if (!g) return
    const incompatible = grp.refs.some(r => { const k = unitKind(r.unit); return k !== null && k !== g.base_unit })
    if (incompatible) { groupToPanel(grp.refs, g.id); return }
    assocDirect(grp.refs, g.id, g.name)
  }

  /** Valide l'association en cours : générique existant ou créé, facteurs par réf */
  async function submitSelection() {
    if (selSaving || selRefs.length === 0) return
    let genericId = selTarget.choice
    if (!genericId) { toast({ variant: 'error', title: 'Choisissez un article générique ou créez-en un' }); return }
    // Les réfs facturées dans une AUTRE unité que la base doivent porter leur conversion
    if (targetBase !== null) {
      for (const r of selRefs) {
        const kind = unitKind(r.unit)
        if (kind !== null && kind !== targetBase) {
          const v = parseFloat((factors[r.id] ?? '').replace(',', '.'))
          if (!(v > 0)) {
            toast({
              variant: 'error', title: `« ${r.name.slice(0, 40)} » : conversion requise`,
              description: `Cette réf est facturée en ${r.unit || '?'} pour un générique ${targetBase === 'kg' ? 'au kg' : 'à la pièce'} : indiquez combien de ${unitLabel(targetBase)} vaut 1 ${r.unit || 'unité'} (ex. 1,5). Sans ça, son prix serait faux.`,
            })
            return
          }
        }
      }
    }
    setSelSaving(true)
    let genericName = ''
    if (genericId === 'new') {
      const name = selTarget.newName.trim()
      if (!name) { toast({ variant: 'error', title: 'Nom du générique requis' }); setSelSaving(false); return }
      const res = await fetch('/api/generic-articles', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, base_unit: selTarget.newUnit, category: selTarget.newCat }),
      }).catch(() => null)
      const data = res ? await res.json().catch(() => null) : null
      if (!res?.ok || !data?.generic?.id) {
        toast({ variant: 'error', title: data?.error || 'Création du générique impossible' })
        setSelSaving(false)
        return
      }
      genericId = data.generic.id
      genericName = name
    } else {
      genericName = generics.find(g => g.id === genericId)?.name ?? ''
    }
    let ok = 0, ko = 0
    for (const r of selRefs) {
      const v = parseFloat((factors[r.id] ?? '').replace(',', '.'))
      const res = await fetch(`/api/articles/${r.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generic_id: genericId, conversion_factor: v > 0 ? v : null }),
      }).catch(() => null)
      if (res?.ok) ok++
      else ko++
    }
    setSelSaving(false)
    toast(ko === 0
      ? { variant: 'success', title: `${ok} réf${ok > 1 ? 's' : ''} associée${ok > 1 ? 's' : ''} à « ${genericName} »` }
      : { variant: 'error', title: `${ok} associée${ok > 1 ? 's' : ''}, ${ko} en échec`, description: 'Relancez sur les réfs restantes.' })
    clearSel()
    load()
  }

  // ── Dossier des associations : réglages sur les réfs rattachées ──

  async function dissociate(refId: string, refName: string) {
    const res = await fetch(`/api/articles/${refId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generic_id: null }),
    }).catch(() => null)
    if (res?.ok) { toast({ variant: 'success', title: `« ${refName} » renvoyée dans la file « À rapprocher »` }); load() }
    else toast({ variant: 'error', title: 'Dissociation impossible' })
  }

  /** Pose le facteur de conversion manquant d'une réf (prix à nouveau utilisable) */
  async function fixConversion(r: Ref, genericId: string) {
    const v = parseFloat((fixDrafts[r.id] ?? '').replace(',', '.'))
    if (!(v > 0)) { toast({ variant: 'error', title: 'Indiquez la conversion', description: 'Ex. « 1 pièce = 1,5 kg » → tapez 1,5.' }); return }
    const res = await fetch(`/api/articles/${r.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generic_id: genericId, conversion_factor: v }),
    }).catch(() => null)
    if (res?.ok) { toast({ variant: 'success', title: 'Conversion enregistrée — prix pris en compte' }); load() }
    else toast({ variant: 'error', title: 'Enregistrement impossible' })
  }

  /** Déplace une réf vers un autre générique (conversion remise à zéro) */
  async function moveRef(r: Ref, genericId: string) {
    const g = generics.find(x => x.id === genericId)
    if (!g) return
    const res = await fetch(`/api/articles/${r.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generic_id: genericId, conversion_factor: null }),
    }).catch(() => null)
    if (res?.ok) { toast({ variant: 'success', title: `« ${r.name} » déplacée vers « ${g.name} »` }); load() }
    else toast({ variant: 'error', title: 'Déplacement impossible' })
  }

  function startEdit(g: Generic) {
    setEditId(g.id)
    setEdit({ name: g.name, base_unit: g.base_unit, category: g.category, loss: String(g.default_loss_pct ?? 0) })
  }

  const [saving, setSaving] = useState(false)
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
  async function removeGeneric(g: Generic) {
    if (confirmDelId !== g.id) { setConfirmDelId(g.id); return }
    setConfirmDelId(null)
    const res = await fetch(`/api/generic-articles/${g.id}`, { method: 'DELETE' }).catch(() => null)
    if (res?.ok) { toast({ variant: 'success', title: `« ${g.name} » supprimé — ses réfs retournent dans la file d'attente` }); setOpenId(null); load() }
    else toast({ variant: 'error', title: 'Suppression impossible' })
  }

  // ── Dérivés ──────────────────────────────────────

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

  // Groupes de ressemblance : les réfs à la même clé de rapprochement, avec le
  // générique suggéré s'il existe et un nom proposé (début commun des libellés).
  const queueGroups = useMemo(() => {
    const m = new Map<string, Ref[]>()
    for (const r of filteredQueue) {
      if (r.non_product) continue
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

  const nonProductRefs = useMemo(() => filteredQueue.filter(r => r.non_product), [filteredQueue])
  const productRefCount = filteredQueue.length - nonProductRefs.length
  const hausses = useMemo(() => generics.filter(g => (g.variation_pct ?? 0) > 0).length, [generics])
  const conversionsManquantes = useMemo(() => generics.reduce((s, g) => s + g.refs.filter(r => r.needs_conversion).length, 0), [generics])
  const refsAssociees = useMemo(() => generics.reduce((s, g) => s + g.refs.length, 0), [generics])

  /** Ligne d'une réf en file : « Associer » l'ajoute à l'association en cours */
  const renderRef = (r: Ref) => {
    const isSel = selIds.includes(r.id)
    return (
      <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <p className="text-sm font-semibold text-gray-900">{r.name}</p>
          <p className="text-[11px] text-gray-400">{r.supplier_name || '—'}{r.article_code ? ` · ${r.article_code}` : ''}</p>
        </div>
        <span className="text-xs text-gray-500 tabular">{r.last_price_ht !== null ? `${fmtEuro(Number(r.last_price_ht))}${r.unit ? ` / ${r.unit}` : ''}` : '—'}</span>
        <button onClick={() => toggleSel(r)}
          className={`flex items-center gap-1.5 text-xs font-bold rounded-lg px-3 py-1.5 transition-all ${isSel ? 'text-white bg-green-600 hover:bg-green-700 shadow-card' : 'text-white bg-pilote hover:bg-pilote-hover shadow-card active:scale-[0.98]'}`}>
          {isSel ? <><Check className="w-3.5 h-3.5" />Sélectionnée</> : <><Link2 className="w-3.5 h-3.5" />Associer</>}
        </button>
      </div>
    )
  }

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
            Seule la matière première entre dans la mercuriale ; les réfs sans ressemblance s&apos;associent toutes seules.
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

      {/* Recherche + bascule Catalogue / Associations */}
      <div className="mb-5 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un article générique, une réf, un fournisseur…"
            className="w-full border border-gray-200 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200" />
        </div>
        <div className="inline-flex bg-pilote-50 ring-1 ring-pilote-100 rounded-full p-1 gap-1">
          <button onClick={() => setView('catalogue')}
            className={`text-xs font-semibold rounded-full px-3.5 py-1.5 transition-colors ${view === 'catalogue' ? 'bg-pilote text-white shadow-card' : 'text-pilote hover:bg-pilote-100'}`}>
            Catalogue
          </button>
          <button onClick={() => setView('associations')}
            className={`flex items-center gap-1.5 text-xs font-semibold rounded-full px-3.5 py-1.5 transition-colors ${view === 'associations' ? 'bg-pilote text-white shadow-card' : 'text-pilote hover:bg-pilote-100'}`}>
            Associations
            {conversionsManquantes > 0 && (
              <span className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 tabular ${view === 'associations' ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-700'}`}>{conversionsManquantes}</span>
            )}
          </button>
        </div>
      </div>

      {/* ── Association en cours (sélection par les boutons « Associer ») ── */}
      {selRefs.length > 0 && (
        <div className="sticky top-2 z-30 mb-5">
          <div className="bg-white rounded-2xl border-2 border-pilote-200 shadow-card-hover p-4">
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <p className="text-sm font-bold text-gray-900">
                Association en cours
                <span className="ml-2 text-[11px] font-bold text-pilote bg-pilote-50 rounded-full px-2 py-0.5 tabular">{selRefs.length} réf{selRefs.length > 1 ? 's' : ''}</span>
              </p>
              <p className="text-[11px] text-gray-400">Cliquez « Associer » sur d&apos;autres réfs pour les ajouter — tout partira vers le même générique.</p>
            </div>
            <div className="space-y-1.5 mb-3 max-h-56 overflow-y-auto">
              {selRefs.map(r => {
                const kind = unitKind(r.unit)
                const needFactor = targetBase !== null && kind !== null && kind !== targetBase
                return (
                  <div key={r.id} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900 flex-1 min-w-[150px]">{r.name}</span>
                    <span className="text-[11px] text-gray-400">{r.supplier_name || '—'}</span>
                    <span className="text-xs text-gray-500 tabular">{r.last_price_ht !== null ? `${fmtEuro(Number(r.last_price_ht))}${r.unit ? ` / ${r.unit}` : ''}` : '—'}</span>
                    {targetBase !== null && (
                      <span className={`flex items-center gap-1.5 text-[11px] rounded-lg px-2 py-1 tabular ${needFactor ? 'text-amber-700 bg-amber-50 ring-1 ring-amber-200' : 'text-gray-400'}`}>
                        1 {r.unit || 'unité'} =
                        <input value={factors[r.id] ?? ''} inputMode="decimal" placeholder={needFactor ? '?' : '1'}
                          onChange={e => setFactors(p => ({ ...p, [r.id]: e.target.value }))}
                          className={`w-14 border rounded px-1.5 py-0.5 text-right tabular bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200 ${needFactor ? 'border-amber-300' : 'border-gray-200'}`} />
                        {unitLabel(targetBase)}{needFactor ? ' (requis)' : ''}
                      </span>
                    )}
                    <button onClick={() => toggleSel(r)} className="p-1 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50" title="Retirer de la sélection">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className={selTarget.choice === 'new' ? '' : 'md:col-span-2'}>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Vers l&apos;article générique</label>
                <select value={selTarget.choice}
                  onChange={e => {
                    const v = e.target.value
                    setSelTarget(t => ({ ...t, choice: v, newName: v === 'new' && !t.newName ? commonLabel(selRefs.map(x => x.name)) : t.newName }))
                  }}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200">
                  <option value="">— Choisir —</option>
                  <option value="new">Créer un nouvel article générique</option>
                  {generics.map(g => <option key={g.id} value={g.id}>{g.name} (/ {unitLabel(g.base_unit)})</option>)}
                </select>
              </div>
              {selTarget.choice === 'new' && (
                <>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Nom</label>
                    <input value={selTarget.newName}
                      onChange={e => { nameTouchedRef.current = true; setSelTarget(t => ({ ...t, newName: e.target.value })) }}
                      placeholder="Filet de poulet"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Unité de base</label>
                    <select value={selTarget.newUnit} onChange={e => setSelTarget(t => ({ ...t, newUnit: e.target.value as 'kg' | 'piece' }))}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200">
                      <option value="kg">au kg</option>
                      <option value="piece">à la pièce</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Catégorie</label>
                    <select value={selTarget.newCat} onChange={e => setSelTarget(t => ({ ...t, newCat: e.target.value as 'ingredient' | 'emballage' }))}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200">
                      <option value="ingredient">Ingrédient</option>
                      <option value="emballage">Emballage</option>
                    </select>
                  </div>
                </>
              )}
              <div className={`flex items-end justify-end gap-2 ${selTarget.choice === 'new' ? 'md:col-span-4' : 'md:col-span-2'}`}>
                <button onClick={clearSel} className="text-xs font-semibold text-gray-500 rounded-xl px-3.5 py-2 hover:bg-gray-100 transition-colors">Tout annuler</button>
                <button onClick={submitSelection} disabled={selSaving}
                  className="text-xs font-bold text-white bg-pilote hover:bg-pilote-hover rounded-xl px-4 py-2 shadow-card active:scale-[0.98] transition-all disabled:opacity-50">
                  {selSaving ? 'Association…' : `Associer ${selRefs.length} réf${selRefs.length > 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : (
        <>
          {/* File de RAPPROCHEMENT : uniquement les réfs qui se ressemblent. */}
          {(queueGroups.length > 0 || nonProductRefs.length > 0) && (
            <div className="mb-8">
              <div className="flex items-baseline gap-2 mb-1">
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-700">À rapprocher</h2>
                <span className="text-[11px] text-gray-400 tabular">{productRefCount} réf{productRefCount > 1 ? 's' : ''} · {queueGroups.length} produit{queueGroups.length > 1 ? 's' : ''}</span>
              </div>
              <p className="text-[11px] text-gray-400 mb-3">
                Les réfs qui ne ressemblent à rien deviennent automatiquement leur propre article générique.
                Ici : cliquez « Associer » sur deux réfs (ou plus) pour les regrouper, ou utilisez le bouton du groupe.
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
                        <button onClick={() => assocSuggested(grp)} disabled={selSaving}
                          className="text-xs font-bold text-white bg-pilote hover:bg-pilote-hover rounded-lg px-3.5 py-2 shadow-card active:scale-[0.98] transition-all disabled:opacity-50">
                          {selSaving ? 'Association…' : `${grp.refs.length > 1 ? 'Tout associer' : 'Associer'} à « ${grp.suggested.name} »`}
                        </button>
                      ) : (
                        <button onClick={() => groupToPanel(grp.refs, 'new', grp.label)}
                          className="text-xs font-bold text-white bg-pilote hover:bg-pilote-hover rounded-lg px-3.5 py-2 shadow-card active:scale-[0.98] transition-all">
                          {grp.refs.length > 1 ? `Regrouper les ${grp.refs.length} réfs` : 'Créer son générique'}
                        </button>
                      )}
                    </div>
                    <div className="divide-y divide-gray-100">
                      {grp.refs.map(renderRef)}
                    </div>
                  </div>
                ))}

                {/* Lignes non-produit (taxes, remises, frais, licences, entretien…) —
                    jamais associées d'office, repliées pour ne pas encombrer */}
                {nonProductRefs.length > 0 && (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
                    <button onClick={() => setShowNonProduct(v => !v)}
                      className="w-full px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-gray-50 transition-colors">
                      <p className="text-xs font-semibold text-gray-500 text-left">
                        Lignes non-produit ignorées
                        <span className="text-gray-400 font-normal"> — taxes, remises, frais, licences, entretien… rien à faire, associables à la main si besoin</span>
                      </p>
                      <span className="text-[11px] font-bold text-gray-400 tabular flex items-center gap-1 flex-shrink-0">
                        {nonProductRefs.length}
                        {showNonProduct ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </span>
                    </button>
                    {showNonProduct && (
                      <div className="divide-y divide-gray-100 border-t border-gray-100">{nonProductRefs.map(renderRef)}</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══ Vue DOSSIER DES ASSOCIATIONS ══ */}
          {view === 'associations' ? (
            <div>
              <div className="flex items-baseline gap-2 mb-1">
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-700">Dossier des associations</h2>
                <span className="text-[11px] text-gray-400 tabular">{filteredGenerics.length} générique{filteredGenerics.length > 1 ? 's' : ''} · {refsAssociees} réf{refsAssociees > 1 ? 's' : ''} associée{refsAssociees > 1 ? 's' : ''}</span>
              </div>
              <p className="text-[11px] text-gray-400 mb-3">
                Chaque générique avec ses réfs : vérifiez les associations automatiques (badge Auto), réglez les conversions manquantes, déplacez ou dissociez une réf.
              </p>
              {conversionsManquantes > 0 && (
                <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center gap-2 text-xs text-amber-800">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span><strong>{conversionsManquantes} réf{conversionsManquantes > 1 ? 's' : ''} sans conversion d&apos;unité</strong> — leur prix est ignoré (jamais pris tel quel) tant que la conversion n&apos;est pas renseignée. Encadrés orange ci-dessous.</span>
                </div>
              )}
              {filteredGenerics.length === 0 ? (
                <div className="bg-white rounded-2xl border border-dashed border-gray-200 py-12 text-center">
                  <p className="text-sm font-medium text-gray-500">Aucun article générique{search ? ' ne correspond à la recherche' : ''}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredGenerics.map(g => (
                    <div key={g.id} className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
                      <div className="px-4 py-2.5 bg-gray-50/80 flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-bold text-gray-900">{g.name}</p>
                        <span className={`text-[10px] font-semibold uppercase tracking-wider rounded-lg px-1.5 py-0.5 ${g.category === 'emballage' ? 'text-blue-700 bg-blue-50' : 'text-pilote bg-pilote-50'}`}>
                          {g.category === 'emballage' ? 'Emballage' : 'Ingrédient'}
                        </span>
                        {g.auto_created && (
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-pilote bg-pilote-50 ring-1 ring-pilote-100 rounded-full px-2 py-0.5" title="Créé par l'association automatique — vérifiez nom et unité">Auto</span>
                        )}
                        <span className="text-[11px] text-gray-400">/ {unitLabel(g.base_unit)}</span>
                        <span className="flex-1" />
                        <span className="text-xs font-bold text-gray-900 tabular">{g.price_ht !== null ? `${fmtEuro(Number(g.price_ht))} / ${unitLabel(g.base_unit)}` : 'pas de prix'}</span>
                        <button onClick={() => { setView('catalogue'); setOpenId(g.id); setEditId(null) }}
                          className="text-[11px] font-semibold text-pilote hover:underline">Ouvrir au catalogue</button>
                      </div>
                      {g.refs.length === 0 ? (
                        <p className="px-4 py-3 text-xs text-gray-400">Aucune réf fournisseur rattachée.</p>
                      ) : (
                        <div className="divide-y divide-gray-50">
                          {g.refs.map(r => (
                            <div key={r.id} className="px-4 py-2 flex items-center gap-3 flex-wrap text-xs">
                              <span className="font-semibold text-gray-800 flex-1 min-w-[170px]">{r.name}</span>
                              <span className="text-gray-400">{r.supplier_name || '—'}</span>
                              <span className="text-gray-500 tabular">{r.last_price_ht !== null ? `${fmtEuro(Number(r.last_price_ht))}${r.unit ? ` / ${r.unit}` : ''}` : '—'}</span>
                              {r.needs_conversion ? (
                                <span className="flex items-center gap-1.5 text-[11px] text-amber-700 bg-amber-50 ring-1 ring-amber-200 rounded-lg px-2 py-1 tabular">
                                  1 {r.unit || 'unité'} =
                                  <input value={fixDrafts[r.id] ?? ''} inputMode="decimal" placeholder="?"
                                    onChange={e => setFixDrafts(p => ({ ...p, [r.id]: e.target.value }))}
                                    onKeyDown={e => { if (e.key === 'Enter') fixConversion(r, g.id) }}
                                    className="w-14 border border-amber-300 rounded px-1.5 py-0.5 text-right tabular bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                                  {unitLabel(g.base_unit)}
                                  <button onClick={() => fixConversion(r, g.id)}
                                    className="font-bold text-white bg-pilote hover:bg-pilote-hover rounded px-1.5 py-0.5 transition-colors">OK</button>
                                </span>
                              ) : (
                                <span className="font-bold text-gray-900 tabular">{r.price_base !== null ? `${fmtEuro(r.price_base)} / ${unitLabel(g.base_unit)}` : '—'}</span>
                              )}
                              <select value="" onChange={e => { if (e.target.value) moveRef(r, e.target.value) }}
                                className="text-[11px] border border-gray-200 rounded-lg px-1.5 py-1 bg-white max-w-[150px] text-gray-500 focus:outline-none focus:ring-2 focus:ring-pilote-200">
                                <option value="">Déplacer vers…</option>
                                {generics.filter(x => x.id !== g.id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                              </select>
                              <button onClick={() => dissociate(r.id, r.name)} title="Renvoyer dans la file « À rapprocher »"
                                className="flex items-center gap-1 font-semibold text-gray-400 hover:text-red-600 transition-colors"><Unlink className="w-3 h-3" />Dissocier</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* ══ Vue CATALOGUE ══ */
            filteredGenerics.length === 0 && filteredQueue.length === 0 ? (
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
            ) : filteredGenerics.length > 0 ? (
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
                                    {g.auto_created && <span className="text-[9px] font-semibold uppercase tracking-wider text-pilote bg-pilote-50 rounded-full px-1.5 py-0.5" title="Créé par l'association automatique">Auto</span>}
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
                                <td className="px-4 py-2.5 text-right text-xs text-gray-400 tabular">
                                  {g.refs_count}
                                  {g.refs.some(r => r.needs_conversion) && <AlertTriangle className="w-3 h-3 text-amber-500 inline ml-1" />}
                                </td>
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
                                                {r.needs_conversion ? (
                                                  <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 rounded px-1.5 py-0.5">conversion manquante — voir Associations</span>
                                                ) : (
                                                  <span className="font-bold text-gray-900 tabular">
                                                    {r.price_base !== null ? `${fmtEuro(r.price_base)} / ${unitLabel(g.base_unit)}` : '—'}
                                                  </span>
                                                )}
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
                    de base par le facteur de conversion (« 1 rouleau = 4,5 kg »). Une réf facturée dans une autre unité que la
                    base et sans conversion est ignorée pour le prix — réglez-la dans l&apos;onglet Associations. Une hausse est en
                    rouge — c&apos;est un coût d&apos;achat. Les fiches recettes s&apos;appuient uniquement sur ces articles génériques.
                  </p>
                </div>
              </div>
            ) : null
          )}
        </>
      )}
    </div>
  )
}
