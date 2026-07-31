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
import Link from 'next/link'
import { ShoppingBasket, FileSearch, TrendingUp, TrendingDown, Search, RefreshCw, Link2, ChevronDown, ChevronRight, Pencil, Trash2, Unlink, X, Check, AlertTriangle, Sparkles, ChefHat } from 'lucide-react'
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
  /** Écartée par le gérant : hors file, restaurable depuis la section dédiée */
  ignored: boolean
  /** Générique existant à la même clé, s'il y en a un : association suggérée */
  suggested_generic_id: string | null
}

/** Point d'historique : date de facture + prix payé, à l'unité de base */
type PricePoint = { d: string; p: number }

/** Fiche recette utilisatrice d'un générique — quantité BRUTE par batch */
type RecipeUse = {
  id: string
  name: string
  qty_brute: number
  yield_qty: number | null
  yield_unit: string | null
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
  /** Prix payés sur 12 mois (inflexions, 40 points max) — réfs utilisables seulement */
  history: PricePoint[]
  points_12m: number
  min_12m: number | null
  max_12m: number | null
  /** Prix précédent (dernière valeur différente) — pour chiffrer l'impact */
  prev_price_ht: number | null
  recipes_count: number
  recipes_used: RecipeUse[]
  refs: Ref[]
}

/** Un changement de prix constaté entre deux factures d'une même réf (30 j) */
type Move = {
  date: string
  generic_id: string
  generic_name: string
  base_unit: 'kg' | 'piece'
  ref_name: string
  supplier_name: string | null
  old_base: number
  new_base: number
  pct: number | null
}

type PendingInvoice = {
  id: string
  supplier_name: string
  invoice_date: string
  amount_ht: number | string
  lines_status: string | null
}

const fmtEuro = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const fmtQty = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 3 })
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

/** Courbe d'historique d'un générique : x = rang du point (une inflexion par
 *  changement de prix), y = prix à l'unité de base. Trait navy, dernier prix
 *  marqué en orange — l'unique accent de la ligne. */
function Sparkline({ points }: { points: PricePoint[] }) {
  const W = 240, H = 48, PAD = 5
  const ps = points.map(x => x.p)
  const min = Math.min(...ps), max = Math.max(...ps)
  const span = max - min
  const X = (i: number) => (points.length < 2 ? W / 2 : PAD + (i / (points.length - 1)) * (W - PAD * 2))
  const Y = (p: number) => (span === 0 ? H / 2 : H - PAD - ((p - min) / span) * (H - PAD * 2))
  const d = ps.map((p, i) => `${i === 0 ? 'M' : 'L'}${X(i).toFixed(1)},${Y(p).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-12" role="img" aria-label="Historique du prix sur 12 mois">
      {points.length >= 2 && (
        <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="text-pilote" />
      )}
      <circle cx={X(points.length - 1)} cy={Y(ps[ps.length - 1] ?? 0)} r={3.5} className="fill-pilote-orange" />
    </svg>
  )
}

export default function MercurialePage() {
  const { toast } = useToast()
  const [generics, setGenerics] = useState<Generic[]>([])
  const [queue, setQueue] = useState<Ref[]>([])
  const [pending, setPending] = useState<PendingInvoice[]>([])
  const [moves, setMoves] = useState<Move[]>([])
  const [movesTotal, setMovesTotal] = useState(0)
  const [movesOpen, setMovesOpen] = useState(false)
  // KPI « Prix en hausse » cliquable : restreint le catalogue aux génériques en hausse
  const [hausseFilter, setHausseFilter] = useState(false)
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

  // Rapprochement intelligent : fusions d'appellations proposées par l'IA,
  // chacune VALIDÉE à la main ; « Fusionner dans… » par générique en manuel.
  const [smartLoading, setSmartLoading] = useState(false)
  const [smartSuggestions, setSmartSuggestions] = useState<{ name: string; ids: string[] }[] | null>(null)
  const [smartNames, setSmartNames] = useState<Record<string, string>>({})
  const [mergeSel, setMergeSel] = useState<Record<string, string>>({})
  const [merging, setMerging] = useState(false)

  // Catalogue : générique déplié + édition + suppression en deux clics
  const [openId, setOpenId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [edit, setEdit] = useState({ name: '', base_unit: 'kg' as 'kg' | 'piece', category: 'ingredient' as 'ingredient' | 'emballage', loss: '0' })
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null)
  const [showNonProduct, setShowNonProduct] = useState(false)
  const [showIgnored, setShowIgnored] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await fetch('/api/mercuriale', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null)
    if (data) {
      setGenerics(Array.isArray(data.generics) ? data.generics : [])
      setQueue(Array.isArray(data.queue) ? data.queue : [])
      setPending(Array.isArray(data.pending) ? data.pending : [])
      setMoves(Array.isArray(data.moves) ? data.moves : [])
      setMovesTotal(Number(data.moves_total) || 0)
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

  /** La lecture intelligente (même IA que l'extraction des factures) propose
   *  les génériques en doublon d'appellation — cervelas acheté chez trois
   *  fournisseurs sous trois noms. Rien n'est fusionné sans validation. */
  async function runSmart() {
    if (smartLoading) return
    setSmartLoading(true)
    setSmartSuggestions(null)
    const res = await fetch('/api/mercuriale/smart-groups', { method: 'POST' }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    setSmartLoading(false)
    if (!res?.ok) { toast({ variant: 'error', title: data?.error || 'Lecture intelligente indisponible' }); return }
    const sugg = Array.isArray(data?.suggestions) ? data.suggestions : []
    setSmartSuggestions(sugg)
    setSmartNames({})
    if (sugg.length === 0) toast({ variant: 'info', title: 'Aucun doublon d’appellation détecté', description: 'La lecture intelligente n’a rien trouvé à fusionner dans le catalogue.' })
  }

  /** Cible d'une fusion : le générique du groupe qui a le plus de réfs (kg favorisé à égalité) */
  function pickTarget(ids: string[]): Generic | null {
    const members = ids.map(id => generics.find(g => g.id === id)).filter((g): g is Generic => !!g)
    if (members.length < 2) return null
    return [...members].sort((a, b) =>
      b.refs_count - a.refs_count
      || (a.base_unit === 'kg' ? 0 : 1) - (b.base_unit === 'kg' ? 0 : 1)
      || a.name.localeCompare(b.name, 'fr'))[0]
  }

  /** Fusionne des génériques (réfs + fiches vers la cible, sources désactivées) */
  async function doMerge(targetId: string, sourceIds: string[], newName?: string): Promise<boolean> {
    if (merging) return false
    setMerging(true)
    const res = await fetch('/api/generic-articles/merge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_id: targetId, source_ids: sourceIds }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    if (!res?.ok) {
      setMerging(false)
      toast({ variant: 'error', title: 'Fusion impossible', description: data?.error || 'Réessayez.' })
      return false
    }
    // Renommage éventuel de la cible — non bloquant (nom déjà pris → conservé)
    if (newName && newName.trim()) {
      const cur = generics.find(g => g.id === targetId)
      if (cur && cur.name.trim().toLowerCase() !== newName.trim().toLowerCase()) {
        const r2 = await fetch(`/api/generic-articles/${targetId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName.trim() }),
        }).catch(() => null)
        if (!r2?.ok) toast({ variant: 'info', title: 'Fusion faite, nom conservé', description: `« ${newName.trim()} » n'a pas pu être appliqué (déjà pris ?).` })
      }
    }
    setMerging(false)
    const n = Number(data?.moved_refs) || 0
    toast({ variant: 'success', title: `Fusion faite${n > 0 ? ` — ${n} réf${n > 1 ? 's' : ''} regroupée${n > 1 ? 's' : ''}` : ''}` })
    load()
    return true
  }

  /** Valide une suggestion de la lecture intelligente */
  async function applySuggestion(key: string, s: { name: string; ids: string[] }) {
    const target = pickTarget(s.ids)
    if (!target) { toast({ variant: 'error', title: 'Suggestion périmée', description: 'Relancez le rapprochement intelligent.' }); return }
    const sources = s.ids.filter(id => id !== target.id)
    const ok = await doMerge(target.id, sources, smartNames[key] ?? s.name)
    if (ok) setSmartSuggestions(prev => prev ? prev.filter(x => x.ids.join(',') !== key) : prev)
  }

  /** Écarte une réf de la file (le gérant ne veut pas la rapprocher) ou la restaure */
  async function setIgnored(r: Ref, ignored: boolean) {
    const res = await fetch(`/api/articles/${r.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ignored }),
    }).catch(() => null)
    if (res?.ok) {
      toast(ignored
        ? { variant: 'info', title: `« ${r.name} » écartée`, description: 'Restaurable depuis « Réfs écartées » en bas de file.' }
        : { variant: 'success', title: `« ${r.name} » remise dans la file` })
      if (ignored) setSelIds(prev => prev.filter(x => x !== r.id))
      load()
    } else toast({ variant: 'error', title: 'Action impossible' })
  }

  /** Écarte tout un groupe de réfs d'un coup */
  async function ignoreGroup(refs: Ref[]) {
    let ok = 0
    for (const r of refs) {
      const res = await fetch(`/api/articles/${r.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ignored: true }),
      }).catch(() => null)
      if (res?.ok) ok++
    }
    setSelIds(prev => prev.filter(id => !refs.some(r => r.id === id)))
    toast({ variant: 'info', title: `${ok} réf${ok > 1 ? 's' : ''} écartée${ok > 1 ? 's' : ''}`, description: 'Restaurables depuis « Réfs écartées » en bas de file.' })
    load()
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
    let list = generics
    if (hausseFilter) list = list.filter(g => (g.variation_pct ?? 0) > 0)
    if (!q) return list
    return list.filter(g =>
      g.name.toLowerCase().includes(q)
      || g.refs.some(r => r.name.toLowerCase().includes(q) || (r.supplier_name || '').toLowerCase().includes(q)))
  }, [generics, search, hausseFilter])

  const filteredQueue = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return queue
    return queue.filter(r => r.name.toLowerCase().includes(q) || (r.supplier_name || '').toLowerCase().includes(q) || (r.article_code || '').toLowerCase().includes(q))
  }, [queue, search])

  // Groupes de ressemblance : les réfs à la même clé de rapprochement, avec le
  // générique suggéré s'il existe et un nom proposé (début commun des libellés).
  // Les lignes non-produit et les réfs ÉCARTÉES par le gérant vivent à part.
  const visibleQueue = useMemo(() => filteredQueue.filter(r => !r.ignored), [filteredQueue])
  const ignoredRefs = useMemo(() => filteredQueue.filter(r => r.ignored), [filteredQueue])
  const queueGroups = useMemo(() => {
    const m = new Map<string, Ref[]>()
    for (const r of visibleQueue) {
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
  }, [visibleQueue, generics])

  const nonProductRefs = useMemo(() => visibleQueue.filter(r => r.non_product), [visibleQueue])
  const productRefCount = visibleQueue.length - nonProductRefs.length
  const hausses = useMemo(() => generics.filter(g => (g.variation_pct ?? 0) > 0).length, [generics])
  const conversionsManquantes = useMemo(() => generics.reduce((s, g) => s + g.refs.filter(r => r.needs_conversion).length, 0), [generics])
  // Dossier des associations : les génériques à conversion manquante d'abord —
  // c'est ce que le gérant vient régler.
  const assocGenerics = useMemo(() =>
    [...filteredGenerics].sort((a, b) =>
      (b.refs.some(r => r.needs_conversion) ? 1 : 0) - (a.refs.some(r => r.needs_conversion) ? 1 : 0)),
  [filteredGenerics])
  /** Âge du dernier prix en jours — au-delà de 30 j, le catalogue le signale */
  const priceAge = (d: string | null) => (d ? Math.floor((Date.now() - new Date(d + 'T00:00:00Z').getTime()) / 86400000) : null)
  const refsAssociees = useMemo(() => generics.reduce((s, g) => s + g.refs.length, 0), [generics])
  const recipesCountByGeneric = useMemo(() => new Map(generics.map(g => [g.id, g.recipes_count])), [generics])

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
        <button onClick={() => setIgnored(r, true)} title="Écarter — ne pas rapprocher cette réf"
          className="p-1.5 rounded-lg text-gray-300 hover:text-red-600 hover:bg-red-50 transition-colors flex-shrink-0">
          <X className="w-3.5 h-3.5" />
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
        {hausses > 0 ? (
          <button onClick={() => { setHausseFilter(v => !v); setView('catalogue') }}
            className={`text-left bg-white rounded-2xl border shadow-card p-5 transition-all hover:shadow-card-hover ${hausseFilter ? 'border-pilote-200 ring-2 ring-pilote-200' : 'border-gray-100'}`}>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Prix en hausse</p>
            <p className="text-2xl font-extrabold tracking-tight tabular text-red-600">{hausses}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">{hausseFilter ? 'filtre actif — cliquer pour tout revoir' : 'cliquer pour filtrer le catalogue'}</p>
          </button>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Prix en hausse</p>
            <p className="text-2xl font-extrabold tracking-tight tabular text-gray-900">0</p>
          </div>
        )}
      </div>

      {/* ── Mouvements de prix — chaque changement constaté sur 30 jours ── */}
      {moves.length > 0 && (
        <div className="mb-6 bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-baseline gap-2 flex-wrap">
            <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-700">Mouvements de prix</h2>
            <span className="text-[11px] text-gray-400 tabular">
              30 derniers jours · {movesTotal} changement{movesTotal > 1 ? 's' : ''}
              {movesTotal > moves.length ? ` (les ${moves.length} plus récents affichés)` : ''}
            </span>
          </div>
          <div className="divide-y divide-gray-50">
            {(movesOpen ? moves : moves.slice(0, 5)).map((m, i) => (
              <button key={`${m.generic_id}-${m.date}-${i}`}
                onClick={() => { setView('catalogue'); setHausseFilter(false); setOpenId(m.generic_id); setEditId(null) }}
                title="Ouvrir cet article au catalogue"
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors flex-wrap">
                <span className="text-[11px] text-gray-400 tabular w-16 flex-shrink-0">{fmtDate(m.date)}</span>
                <span className="flex-1 min-w-[180px]">
                  <span className="text-sm font-bold text-gray-900">{m.generic_name}</span>
                  <span className="block text-[11px] text-gray-400 truncate">{m.ref_name}{m.supplier_name ? ` · ${m.supplier_name}` : ''}</span>
                </span>
                <span className="text-xs text-gray-500 tabular">
                  {fmtEuro(m.old_base)} <span className="text-gray-300">→</span>{' '}
                  <span className={`font-bold ${m.new_base > m.old_base ? 'text-red-600' : 'text-green-600'}`}>{fmtEuro(m.new_base)}</span>
                  <span className="text-gray-400"> / {unitLabel(m.base_unit)}</span>
                </span>
                {(recipesCountByGeneric.get(m.generic_id) ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-pilote bg-pilote-50 rounded-full px-2 py-0.5 tabular" title="Fiches recettes qui utilisent cet article — impact détaillé dans la ligne dépliée du catalogue">
                    <ChefHat className="w-3 h-3" />{recipesCountByGeneric.get(m.generic_id)} fiche{(recipesCountByGeneric.get(m.generic_id) ?? 0) > 1 ? 's' : ''}
                  </span>
                )}
                <Variation pct={m.pct} />
              </button>
            ))}
          </div>
          {moves.length > 5 && (
            <button onClick={() => setMovesOpen(v => !v)}
              className="w-full px-4 py-2 text-[11px] font-semibold text-pilote hover:bg-pilote-50 transition-colors border-t border-gray-100 flex items-center justify-center gap-1">
              {movesOpen ? <>Replier <ChevronDown className="w-3 h-3 rotate-180" /></> : <>Afficher les {moves.length - 5} autres <ChevronDown className="w-3 h-3" /></>}
            </button>
          )}
        </div>
      )}

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
                      <button onClick={() => ignoreGroup(grp.refs)} title="Ne pas rapprocher — écarter tout le groupe"
                        className="text-[11px] font-semibold text-gray-400 hover:text-red-600 rounded-lg px-2 py-1.5 transition-colors">
                        Écarter
                      </button>
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

                {/* Réfs écartées par le gérant — restaurables */}
                {ignoredRefs.length > 0 && (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
                    <button onClick={() => setShowIgnored(v => !v)}
                      className="w-full px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-gray-50 transition-colors">
                      <p className="text-xs font-semibold text-gray-500 text-left">
                        Réfs écartées
                        <span className="text-gray-400 font-normal"> — vous avez choisi de ne pas les rapprocher ; restaurables à tout moment</span>
                      </p>
                      <span className="text-[11px] font-bold text-gray-400 tabular flex items-center gap-1 flex-shrink-0">
                        {ignoredRefs.length}
                        {showIgnored ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </span>
                    </button>
                    {showIgnored && (
                      <div className="divide-y divide-gray-100 border-t border-gray-100">
                        {ignoredRefs.map(r => (
                          <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 flex-wrap">
                            <div className="flex-1 min-w-[220px]">
                              <p className="text-sm font-semibold text-gray-500">{r.name}</p>
                              <p className="text-[11px] text-gray-400">{r.supplier_name || '—'}{r.article_code ? ` · ${r.article_code}` : ''}</p>
                            </div>
                            <span className="text-xs text-gray-400 tabular">{r.last_price_ht !== null ? `${fmtEuro(Number(r.last_price_ht))}${r.unit ? ` / ${r.unit}` : ''}` : '—'}</span>
                            <button onClick={() => setIgnored(r, false)}
                              className="text-xs font-bold text-pilote border border-pilote-200 bg-white rounded-lg px-3 py-1.5 hover:bg-pilote-50 transition-colors">
                              Restaurer
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══ Vue DOSSIER DES ASSOCIATIONS ══ */}
          {view === 'associations' ? (
            <div>
              <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
                <div className="flex items-baseline gap-2">
                  <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-700">Dossier des associations</h2>
                  <span className="text-[11px] text-gray-400 tabular">{filteredGenerics.length} générique{filteredGenerics.length > 1 ? 's' : ''} · {refsAssociees} réf{refsAssociees > 1 ? 's' : ''} associée{refsAssociees > 1 ? 's' : ''}</span>
                </div>
                <button onClick={runSmart} disabled={smartLoading}
                  className="flex items-center gap-1.5 text-xs font-bold text-white bg-pilote hover:bg-pilote-hover rounded-xl px-3.5 py-2 shadow-card active:scale-[0.98] transition-all disabled:opacity-50">
                  <Sparkles className="w-3.5 h-3.5" />{smartLoading ? 'Lecture intelligente…' : 'Rapprochement intelligent'}
                </button>
              </div>
              <p className="text-[11px] text-gray-400 mb-3">
                Chaque générique avec ses réfs : vérifiez les associations automatiques (badge Auto), réglez les conversions manquantes, déplacez ou dissociez une réf.
                Le rapprochement intelligent repère les doublons d&apos;appellation entre fournisseurs (« cervelas » acheté chez trois maisons) — chaque fusion se valide.
              </p>

              {/* Fusions proposées par la lecture intelligente — à valider une par une */}
              {smartSuggestions !== null && smartSuggestions.length > 0 && (
                <div className="mb-4 space-y-2.5">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{smartSuggestions.length} fusion{smartSuggestions.length > 1 ? 's' : ''} proposée{smartSuggestions.length > 1 ? 's' : ''} — rien n&apos;est fait sans votre accord</p>
                  {smartSuggestions.map(s => {
                    const key = s.ids.join(',')
                    const target = pickTarget(s.ids)
                    const members = s.ids.map(id => generics.find(g => g.id === id)).filter((g): g is Generic => !!g)
                    if (!target || members.length < 2) return null
                    return (
                      <div key={key} className="bg-white rounded-2xl border border-pilote-200 shadow-card p-4">
                        <div className="flex items-center gap-3 flex-wrap mb-2.5">
                          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Appellation</span>
                          <input value={smartNames[key] ?? s.name}
                            onChange={e => setSmartNames(p => ({ ...p, [key]: e.target.value }))}
                            className="border border-gray-200 rounded-xl px-3 py-1.5 text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-pilote-200 min-w-[180px]" />
                          <span className="text-[11px] text-gray-400">/ {unitLabel(target.base_unit)} · les réfs des autres rejoignent « {target.name} »</span>
                          <span className="flex-1" />
                          <button onClick={() => applySuggestion(key, s)} disabled={merging}
                            className="text-xs font-bold text-white bg-pilote hover:bg-pilote-hover rounded-xl px-3.5 py-2 shadow-card active:scale-[0.98] transition-all disabled:opacity-50">
                            {merging ? 'Fusion…' : `Fusionner les ${members.length}`}
                          </button>
                          <button onClick={() => setSmartSuggestions(prev => prev ? prev.filter(x => x.ids.join(',') !== key) : prev)}
                            className="text-xs font-semibold text-gray-500 rounded-xl px-3 py-2 hover:bg-gray-100 transition-colors">Ignorer</button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {members.map(m => (
                            <span key={m.id} className="text-[11px] text-gray-600 bg-gray-50 ring-1 ring-gray-100 rounded-full px-2.5 py-1 tabular">
                              {m.name} · {m.refs_count} réf{m.refs_count > 1 ? 's' : ''} / {unitLabel(m.base_unit)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
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
                  {assocGenerics.map(g => (
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
                        <select value={mergeSel[g.id] ?? ''} onChange={e => setMergeSel(p => ({ ...p, [g.id]: e.target.value }))}
                          className="text-[11px] border border-gray-200 rounded-lg px-1.5 py-1 bg-white max-w-[150px] text-gray-500 focus:outline-none focus:ring-2 focus:ring-pilote-200">
                          <option value="">Fusionner dans…</option>
                          {generics.filter(x => x.id !== g.id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                        {mergeSel[g.id] && (
                          <button onClick={async () => { const ok = await doMerge(mergeSel[g.id], [g.id]); if (ok) setMergeSel(p => ({ ...p, [g.id]: '' })) }} disabled={merging}
                            className="text-[11px] font-bold text-white bg-pilote hover:bg-pilote-hover rounded-lg px-2.5 py-1 shadow-card transition-colors disabled:opacity-50">
                            Confirmer
                          </button>
                        )}
                        <button onClick={() => { setView('catalogue'); setOpenId(g.id); setEditId(null) }}
                          className="text-[11px] font-semibold text-pilote hover:underline">Ouvrir au catalogue</button>
                      </div>
                      {g.refs.length === 0 ? (
                        <p className="px-4 py-3 text-xs text-gray-400">Aucune réf fournisseur rattachée.</p>
                      ) : (
                        <div className="divide-y divide-gray-50">
                          {[...g.refs].sort((a, b) => (b.needs_conversion ? 1 : 0) - (a.needs_conversion ? 1 : 0)).map(r => (
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
                          <th className="px-4 py-2.5 text-right">Fiches</th>
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
                                <td className="px-4 py-2.5 text-right text-xs tabular">
                                  {(() => { const age = priceAge(g.price_date); const vieux = age !== null && age > 30; return (
                                    <span className={vieux ? 'text-amber-600 font-semibold' : 'text-gray-500'} title={vieux ? `Dernier prix il y a ${age} jours — pas de facture récente pour ce produit` : undefined}>
                                      {fmtDate(g.price_date)}{vieux ? ` (${age} j)` : ''}
                                    </span>
                                  ) })()}
                                </td>
                                <td className="px-4 py-2.5 text-right"><Variation pct={g.variation_pct} /></td>
                                <td className="px-4 py-2.5 text-right text-xs text-gray-400 tabular">
                                  {g.refs_count}
                                  {g.refs.some(r => r.needs_conversion) && <AlertTriangle className="w-3 h-3 text-amber-500 inline ml-1" />}
                                </td>
                                <td className="px-4 py-2.5 text-right text-xs tabular">
                                  {g.recipes_count > 0
                                    ? <span className="font-semibold text-pilote">{g.recipes_count}</span>
                                    : <span className="text-gray-300">—</span>}
                                </td>
                              </tr>
                              {isOpen && (
                                <tr className="bg-gray-50/60">
                                  <td colSpan={8} className="px-4 py-3">
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
                                        {/* Historique 12 mois : la courbe des prix payés, min/max — ou l'absence assumée */}
                                        {g.history.length >= 2 ? (
                                          <div className="mb-2.5 bg-white border border-gray-100 rounded-xl px-3.5 py-2.5 flex items-center gap-6 flex-wrap">
                                            <div className="w-60 flex-shrink-0">
                                              <Sparkline points={g.history} />
                                              <div className="flex justify-between text-[10px] text-gray-400 tabular mt-0.5">
                                                <span>{fmtDate(g.history[0].d)}</span>
                                                <span>{fmtDate(g.history[g.history.length - 1].d)}</span>
                                              </div>
                                            </div>
                                            <div>
                                              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Min 12 mois</p>
                                              <p className="text-sm font-extrabold text-gray-900 tabular">{g.min_12m !== null ? fmtEuro(g.min_12m) : '—'}</p>
                                            </div>
                                            <div>
                                              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Max 12 mois</p>
                                              <p className="text-sm font-extrabold text-gray-900 tabular">{g.max_12m !== null ? fmtEuro(g.max_12m) : '—'}</p>
                                            </div>
                                            <p className="text-[11px] text-gray-400">
                                              {g.points_12m} prix relevé{g.points_12m > 1 ? 's' : ''} sur 12 mois · en € / {unitLabel(g.base_unit)}
                                            </p>
                                          </div>
                                        ) : (
                                          <p className="mb-2.5 text-[11px] text-gray-400">
                                            {g.points_12m > 0
                                              ? <>Prix stable : {g.points_12m} prix relevé{g.points_12m > 1 ? 's' : ''} sur 12 mois, aucun changement — la courbe apparaîtra au premier mouvement.</>
                                              : <>Pas encore d&apos;historique — la courbe des prix se construit à chaque facture lue.</>}
                                          </p>
                                        )}
                                        {/* Impact sur les fiches recettes : Δprix × quantité brute, par batch et par unité produite */}
                                        {g.recipes_used.length > 0 ? (() => {
                                          const delta = g.price_ht !== null && g.prev_price_ht !== null
                                            ? Math.round((g.price_ht - g.prev_price_ht) * 10000) / 10000
                                            : null
                                          const hasImpact = delta !== null && delta !== 0
                                          return (
                                            <div className="mb-2.5 bg-white border border-gray-100 rounded-xl overflow-hidden">
                                              <div className="px-3.5 py-2 bg-gray-50/80 flex items-center gap-2 flex-wrap">
                                                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                                                  <ChefHat className="w-3 h-3" />Utilisé dans {g.recipes_used.length} fiche{g.recipes_used.length > 1 ? 's' : ''} recette{g.recipes_used.length > 1 ? 's' : ''}
                                                </p>
                                                {hasImpact && (
                                                  <span className={`text-[11px] font-bold tabular ${delta! > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                                    dernier mouvement : {delta! > 0 ? '+' : '−'}{fmtEuro(Math.abs(delta!))} / {unitLabel(g.base_unit)}
                                                  </span>
                                                )}
                                              </div>
                                              <div className="divide-y divide-gray-50">
                                                {g.recipes_used.map(u => {
                                                  const impact = hasImpact ? delta! * u.qty_brute : null
                                                  const perUnit = impact !== null && u.yield_qty !== null && u.yield_qty > 0 ? impact / u.yield_qty : null
                                                  return (
                                                    <div key={u.id} className="px-3.5 py-2 flex items-center gap-3 flex-wrap text-xs">
                                                      <Link href={`/dashboard/recettes/${u.id}`} className="font-semibold text-pilote hover:underline flex-1 min-w-[150px]">{u.name}</Link>
                                                      <span className="text-gray-400 tabular">{fmtQty(u.qty_brute)} {unitLabel(g.base_unit)} brut / batch</span>
                                                      {impact !== null && Math.abs(impact) >= 0.005 && (
                                                        <span className={`font-bold tabular ${impact > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                                          {impact > 0 ? '+' : '−'}{fmtEuro(Math.abs(impact))} / batch
                                                          {perUnit !== null && Math.abs(perUnit) >= 0.005 ? ` · ${impact > 0 ? '+' : '−'}${fmtEuro(Math.abs(perUnit))} / ${u.yield_unit || 'unité'}` : ''}
                                                        </span>
                                                      )}
                                                    </div>
                                                  )
                                                })}
                                              </div>
                                              {hasImpact && (
                                                <p className="px-3.5 py-1.5 text-[10px] text-gray-400 border-t border-gray-50">
                                                  Impact matière seule (Δprix × quantité brute de la fiche) — le coût complet à jour est sur chaque fiche.
                                                </p>
                                              )}
                                            </div>
                                          )
                                        })() : (
                                          <p className="mb-2.5 text-[11px] text-gray-400">Utilisé dans aucune fiche recette pour l&apos;instant.</p>
                                        )}
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
