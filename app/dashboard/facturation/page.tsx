'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import {
  Receipt, ChevronLeft, ChevronRight, Plus, Trash2,
  TrendingUp, TrendingDown, ShoppingCart, Users, Euro,
  Save, X, Settings, Check, Loader2, AlertCircle,
  Link2, Link2Off, RefreshCw, ArrowUpRight, Repeat, Undo2
} from 'lucide-react'

// ─── Types ──────────────────────

type Invoice = {
  id: string; supplier_name: string; invoice_number?: string; invoice_date: string
  category: string; amount_ht: number; tva_rate: number; amount_ttc: number
  notes?: string; week_number: number; year: number
  is_fixed_charge?: boolean; period_days?: number | null; prorata_ht?: number | null
}

type WeeklyCA = { ca_total: number; ca_boucherie: number; ca_charcuterie: number; ca_traiteur: number; ca_vente: number }

type Summary = {
  achats_ht: number; achats_by_category: Record<string, number>; masse_salariale: number
  ca_total: number; ca_detail: WeeklyCA | null; marge_brute: number
  taux_marge: number | null; resultat_net: number; ratio_ms: number | null
}

type BillingIntegration = {
  provider: string; is_active: boolean; last_sync_at?: string
  last_sync_status?: 'success' | 'error' | 'pending'; invoices_synced?: number; company_id?: string
}

type ProviderMeta = {
  id: string; name: string; logo: string; color: string; tokenLabel: string
  tokenPlaceholder: string; needsCompanyId: boolean; companyIdLabel?: string
  helpUrl: string; description: string
}

// ─── Constantes ────────────────────────

// Palette catégories : teintes sourdes et cohérentes (fond -50, texte -700) + point de
// couleur pour la barre de répartition — évite l'effet « arc-en-ciel » criard.
const CATEGORIES = [
  { key: 'viande',         label: 'Viande',         color: 'bg-red-50 text-red-700',       dot: '#b91c1c' },
  { key: 'charcuterie',    label: 'Charcuterie',    color: 'bg-orange-50 text-orange-700', dot: '#c2410c' },
  { key: 'epicerie',       label: 'Épicerie',       color: 'bg-amber-50 text-amber-700',   dot: '#b45309' },
  { key: 'emballage',      label: 'Emballage',      color: 'bg-sky-50 text-sky-700',       dot: '#0369a1' },
  { key: 'frais_generaux', label: 'Frais généraux', color: 'bg-violet-50 text-violet-700', dot: '#6d28d9' },
  { key: 'autre',          label: 'Autre',          color: 'bg-gray-100 text-gray-600',    dot: '#6b7280' },
]

const TVA_RATES = [0, 5.5, 10, 20]

const PERIOD_OPTIONS = [
  { days: 30,  label: 'Mensuel'     },
  { days: 91,  label: 'Trimestriel' },
  { days: 182, label: 'Semestriel'  },
  { days: 365, label: 'Annuel'      },
]

const EMPTY_INVOICE = {
  supplier_name: '', invoice_number: '', invoice_date: '',
  category: 'viande', amount_ht: '', tva_rate: '20', notes: ''
}

const PROVIDERS_META: ProviderMeta[] = [
  { id: 'pennylane', name: 'Pennylane', logo: 'PL', color: 'bg-blue-600', tokenLabel: 'Token API Pennylane', tokenPlaceholder: 'eyJhbGci...', needsCompanyId: false, helpUrl: 'https://help.pennylane.com/fr/articles/developer-api', description: 'Importation automatique des factures fournisseurs via l\'API Pennylane' },
  { id: 'sage',      name: 'Sage',      logo: 'SG', color: 'bg-green-600', tokenLabel: 'Access Token Sage', tokenPlaceholder: 'Bearer token issu de Sage OAuth2', needsCompanyId: false, helpUrl: 'https://developer.sage.com/accounting/', description: 'Sage Business Cloud Comptabilité — factures achats' },
  { id: 'cegid',     name: 'Cegid',     logo: 'CG', color: 'bg-purple-600', tokenLabel: 'Clé API Cegid', tokenPlaceholder: 'Clé depuis votre espace Cegid', needsCompanyId: true, companyIdLabel: 'ID Entreprise Cegid', helpUrl: 'https://developers.cegid.com', description: 'Cegid Loop — import automatique des factures d\'achat' },
  { id: 'ebp',       name: 'EBP',       logo: 'EBP', color: 'bg-orange-500', tokenLabel: 'Token API EBP en ligne', tokenPlaceholder: 'Token depuis EBP → Paramètres → API', needsCompanyId: true, companyIdLabel: 'Identifiant dossier EBP', helpUrl: 'https://developer.ebp.com', description: 'EBP en ligne — import factures fournisseurs automatique' },
]

// ─── Helpers ────────────────────────────────────────────────────────────────────

function getISOWeek(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return { week: Math.ceil((((d.getTime() - y.getTime()) / 86400000) + 1) / 7), year: d.getUTCFullYear() }
}

function getWeekDates(week: number, year: number): [Date, Date] {
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const dow = jan4.getUTCDay() || 7
  const mon = new Date(jan4)
  mon.setUTCDate(jan4.getUTCDate() - dow + 1 + (week - 1) * 7)
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6)
  return [mon, sun]
}

function fmtDate(d: Date) { return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' }) }
function fmtEuro(n: number) { return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €' }
function catInfo(key: string) { return CATEGORIES.find(c => c.key === key) ?? CATEGORIES[CATEGORIES.length - 1] }

/** Initiales du fournisseur pour la pastille d'avatar (2 lettres max) */
function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '·'
}

function weeklyShare(amountHt: number, days?: number | null) {
  return Math.round((amountHt * 7 / (days || 30)) * 100) / 100
}

/** Une charge structurelle couvre la semaine si sa période (date → date + period_days) chevauche la semaine */
function coversWeek(inv: Invoice, monISO: string, sunISO: string): boolean {
  if (!inv.invoice_date) return false
  const start = inv.invoice_date
  const end = new Date(inv.invoice_date)
  end.setUTCDate(end.getUTCDate() + (inv.period_days || 30))
  const endISO = end.toISOString().slice(0, 10)
  return start <= sunISO && endISO > monISO
}

/** Semaine écoulée (ISO) : celle que le gérant doit voir en arrivant le lundi */
function getLastWeek() {
  const ref = new Date()
  ref.setDate(ref.getDate() - 7)
  return getISOWeek(ref)
}

// ─── Composant principal ──────────────────────────────────────────────────────────────

export default function FacturationPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { confirm: confirmAction } = useConfirm()
  const lastWeek = getLastWeek()
  const [week, setWeek] = useState(lastWeek.week)
  const [year, setYear] = useState(lastWeek.year)
  const [invoices,  setInvoices]  = useState<Invoice[]>([])
  const [fixedAll,  setFixedAll]  = useState<Invoice[]>([])
  const [summary,   setSummary]   = useState<Summary | null>(null)
  const [loading,   setLoading]   = useState(false)
  const [showAdd,   setShowAdd]   = useState(false)
  const [showCA,    setShowCA]    = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showProviders, setShowProviders] = useState(false)
  const [newInvoice, setNewInvoice] = useState<any>(EMPTY_INVOICE)
  const [saving,    setSaving]    = useState(false)
  // Mémoire fournisseur → catégorie (pré-remplissage auto à la saisie d'un achat)
  const [supplierMap, setSupplierMap] = useState<Record<string, string>>({})
  const [caForm,    setCaForm]    = useState({ ca_total: '', ca_boucherie: '', ca_charcuterie: '', ca_traiteur: '', ca_vente: '' })
  const [settForm,  setSettForm]  = useState({ company_name: '', siret: '' })

  const [integrations,     setIntegrations]     = useState<BillingIntegration[]>([])
  const [showConnect,      setShowConnect]      = useState(false)
  const [connectProvider,  setConnectProvider]  = useState<ProviderMeta | null>(null)
  const [connectToken,     setConnectToken]     = useState('')
  const [connectCompanyId, setConnectCompanyId] = useState('')
  const [connecting,       setConnecting]       = useState(false)
  const [connectError,     setConnectError]     = useState('')
  const [syncing,          setSyncing]          = useState<string | null>(null)

  // Garde anti-réponses obsolètes : si l'utilisateur change de semaine pendant qu'un
  // chargement est en cours, la réponse de l'ancienne semaine ne doit PAS écraser l'affichage
  const reqIdRef = useRef(0)

  const [mon, sun] = getWeekDates(week, year)
  const monISO = mon.toISOString().slice(0, 10)
  const sunISO = sun.toISOString().slice(0, 10)
  const { week: cw, year: cy } = getISOWeek(new Date())
  const isCurrentWeek = week === cw && year === cy
  const isLastWeek    = week === lastWeek.week && year === lastWeek.year

  const load = useCallback(async () => {
    const reqId = ++reqIdRef.current
    setLoading(true)
    const noStore: RequestInit = { cache: 'no-store' }
    const [invRes, fixedRes, sumRes, caRes, settRes] = await Promise.all([
      fetch(`/api/invoices?week=${week}&year=${year}`, noStore).then(r => r.json()).catch(() => []),
      fetch(`/api/invoices?fixed=all`, noStore).then(r => r.json()).catch(() => []),
      fetch(`/api/facturation/summary?week=${week}&year=${year}`, noStore).then(r => r.json()).catch(() => null),
      fetch(`/api/weekly-ca?week=${week}&year=${year}`, noStore).then(r => r.json()).catch(() => null),
      fetch('/api/billing-settings', noStore).then(r => r.json()).catch(() => ({})),
    ])
    if (reqId !== reqIdRef.current) return // une navigation plus récente a eu lieu — on jette cette réponse
    setInvoices(Array.isArray(invRes) ? invRes : [])
    setFixedAll(Array.isArray(fixedRes) ? fixedRes : [])
    setSummary(sumRes)
    const s = settRes || {}
    setSettForm({ company_name: s.company_name || '', siret: s.siret || '' })
    if (caRes && !caRes.error) setCaForm({ ca_total: String(caRes.ca_total || ''), ca_boucherie: String(caRes.ca_boucherie || ''), ca_charcuterie: String(caRes.ca_charcuterie || ''), ca_traiteur: String(caRes.ca_traiteur || ''), ca_vente: String(caRes.ca_vente || '') })
    else setCaForm({ ca_total: '', ca_boucherie: '', ca_charcuterie: '', ca_traiteur: '', ca_vente: '' })
    setLoading(false)
  }, [week, year])

  const loadIntegrations = useCallback(async () => {
    const res = await fetch('/api/billing-integrations', { cache: 'no-store' }).catch(() => null)
    if (res?.ok) { const data = await res.json(); setIntegrations(Array.isArray(data) ? data : []) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadIntegrations() }, [loadIntegrations])

  // Charge la mémoire fournisseur → catégorie une fois (catégorie la plus récente par fournisseur)
  useEffect(() => {
    fetch('/api/invoices?suppliers=1', { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        if (!Array.isArray(data)) return
        const m: Record<string, string> = {}
        for (const s of data) {
          const key = String(s?.supplier_name || '').trim().toLowerCase()
          if (key && s?.category) m[key] = s.category
        }
        setSupplierMap(m)
      })
      .catch(() => {})
  }, [invoices.length])

  function prevWeek() { if (week === 1) { setYear(y => y - 1); setWeek(52) } else setWeek(w => w - 1) }
  function nextWeek() { if (week === 52) { setYear(y => y + 1); setWeek(1) } else setWeek(w => w + 1) }

  async function addInvoice() {
    if (!newInvoice.supplier_name || !newInvoice.invoice_date || !newInvoice.amount_ht) return
    setSaving(true)
    const res = await fetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newInvoice, week_number: week, year }) })
    const data = await res.json()
    if (data.id) { setShowAdd(false); setNewInvoice(EMPTY_INVOICE); load() }
    setSaving(false)
  }

  async function deleteInvoice(id: string) {
    const ok = await confirmAction({
      title: 'Supprimer cette facture ?',
      description: 'La facture sera définitivement retirée de la semaine et des totaux.',
      confirmLabel: 'Supprimer',
      variant: 'danger',
    })
    if (!ok) return
    await fetch(`/api/invoices/${id}`, { method: 'DELETE' })
    setInvoices(prev => prev.filter(i => i.id !== id))
    setFixedAll(prev => prev.filter(i => i.id !== id))
    toast({ variant: 'success', title: 'Facture supprimée' })
    load()
  }

  /** Change la catégorie d'un achat directement dans la liste (persisté aussitôt) */
  async function updateCategory(inv: Invoice, category: string) {
    if (category === inv.category) return
    setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, category } : i))
    setFixedAll(prev => prev.map(i => i.id === inv.id ? { ...i, category } : i))
    const res = await fetch(`/api/invoices/${inv.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category }) })
    if (res.ok) { toast({ variant: 'success', title: 'Catégorie mise à jour' }); load() }
    else toast({ variant: 'error', title: 'Erreur', description: 'La catégorie n\'a pas pu être modifiée.' })
  }

  /** Bascule manuelle charge fixe <-> achat variable */
  async function toggleFixed(inv: Invoice) {
    const makeFixed = !inv.is_fixed_charge
    const period = inv.period_days || 30
    const apiPatch = makeFixed
      ? { is_fixed_charge: true, period_days: period, prorata_ht: weeklyShare(inv.amount_ht, period) }
      : { is_fixed_charge: false, period_days: null, prorata_ht: null }
    setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, ...apiPatch } : i))
    setFixedAll(prev => makeFixed
      ? [...prev.filter(i => i.id !== inv.id), { ...inv, ...apiPatch }]
      : prev.filter(i => i.id !== inv.id))
    await fetch(`/api/invoices/${inv.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(apiPatch) })
  }

  /** Change la période d'une charge fixe et recalcule le prorata hebdo */
  async function setFixedPeriod(inv: Invoice, days: number) {
    const apiPatch = { period_days: days, prorata_ht: weeklyShare(inv.amount_ht, days) }
    setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, ...apiPatch } : i))
    setFixedAll(prev => prev.map(i => i.id === inv.id ? { ...i, ...apiPatch } : i))
    await fetch(`/api/invoices/${inv.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(apiPatch) })
  }

  async function saveCA() {
    const total  = parseFloat(caForm.ca_total)
    const rayons = {
      ca_boucherie:   parseFloat(caForm.ca_boucherie)   || 0,
      ca_charcuterie: parseFloat(caForm.ca_charcuterie) || 0,
      ca_traiteur:    parseFloat(caForm.ca_traiteur)    || 0,
      ca_vente:       parseFloat(caForm.ca_vente)       || 0,
    }
    if (!caForm.ca_total.trim() || isNaN(total) || total <= 0) {
      toast({ variant: 'error', title: 'CA total invalide', description: 'Saisissez un chiffre d\'affaires total strictement positif.' })
      return
    }
    if (Object.values(rayons).some(v => v < 0)) {
      toast({ variant: 'error', title: 'Montant négatif', description: 'Le détail par rayon ne peut pas contenir de valeur négative.' })
      return
    }
    const sumRayons = rayons.ca_boucherie + rayons.ca_charcuterie + rayons.ca_traiteur + rayons.ca_vente
    if (sumRayons > total + 0.01) {
      toast({ variant: 'error', title: 'Détail incohérent', description: `La somme des rayons (${fmtEuro(sumRayons)}) dépasse le CA total (${fmtEuro(total)}).` })
      return
    }
    setSaving(true)
    const body = { week_number: week, year, ca_total: total, ...rayons }
    const res = await fetch('/api/weekly-ca', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (res.ok) { setShowCA(false); toast({ variant: 'success', title: 'CA enregistré' }); load() }
    else toast({ variant: 'error', title: 'Erreur', description: 'Le CA n\'a pas pu être enregistré.' })
    setSaving(false)
  }

  async function saveSettings() {
    setSaving(true)
    await fetch('/api/billing-settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settForm) })
    setSaving(false); setShowSettings(false)
  }

  async function connectIntegration() {
    if (!connectProvider || !connectToken) return
    setConnecting(true); setConnectError('')
    const res = await fetch('/api/billing-integrations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: connectProvider.id, api_token: connectToken, company_id: connectCompanyId || undefined }) })
    const data = await res.json()
    if (!res.ok) { setConnectError(data.error || 'Erreur de connexion'); setConnecting(false); return }
    setShowConnect(false); setConnectToken(''); setConnectCompanyId(''); setConnectProvider(null); setConnecting(false); setShowProviders(false); loadIntegrations()
  }

  async function disconnectIntegration(provider: string) {
    const ok = await confirmAction({
      title: `Déconnecter ${provider} ?`,
      description: 'La synchronisation automatique des factures sera arrêtée. Vous pourrez reconnecter le logiciel à tout moment.',
      confirmLabel: 'Déconnecter',
      variant: 'danger',
    })
    if (!ok) return
    await fetch(`/api/billing-integrations/${provider}`, { method: 'DELETE' }); loadIntegrations()
    toast({ variant: 'info', title: `${provider} déconnecté` })
  }

  async function syncNow(provider: string) {
    setSyncing(provider)
    await fetch('/api/billing-integrations/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, week, year }),
    })
    setSyncing(null); loadIntegrations(); load()
  }

  function openValorisation(inv: Invoice) {
    const qs = new URLSearchParams({
      date:      inv.invoice_date,
      supplier:  inv.supplier_name,
      amount_ht: String(inv.amount_ht),
    })
    router.push(`/dashboard/valorisation?${qs.toString()}`)
  }

  const ttcAmount = parseFloat(newInvoice.amount_ht || '0') * (1 + parseFloat(newInvoice.tva_rate || '20') / 100)

  // ── Achats variables de la semaine + charges structurelles couvrant la semaine ──
  const variableInvoices = invoices.filter(i => !i.is_fixed_charge)
  const fixedInvoices    = fixedAll
    .filter(i => coversWeek(i, monISO, sunISO))
    .sort((a, b) => (Number(b.prorata_ht) || 0) - (Number(a.prorata_ht) || 0))
  // Liste plate triée par date (puis montant) — le groupement par catégorie était peu fiable,
  // la catégorie reste visible en pastille sur chaque ligne
  const sortedVariable   = [...variableInvoices].sort(
    (a, b) => (b.invoice_date || '').localeCompare(a.invoice_date || '') || b.amount_ht - a.amount_ht,
  )
  const variableTotalHt  = variableInvoices.reduce((s, i) => s + i.amount_ht, 0)
  const variableTotalTtc = variableInvoices.reduce((s, i) => s + i.amount_ttc, 0)
  const fixedTotalHt     = fixedInvoices.reduce((s, i) => s + i.amount_ht, 0)
  const fixedWeekly      = fixedInvoices.reduce((s, i) => s + (Number(i.prorata_ht) || 0), 0)

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* Header héro */}
      <div className="bg-white border-b border-gray-200 px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-pilote to-pilote-hover rounded-2xl flex items-center justify-center flex-shrink-0 shadow-card">
            <Receipt className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Facturation &amp; Achats</h1>
            <p className="text-sm text-gray-500">Achats de la semaine · Charges structurelles · CA &amp; marge</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowCA(true)} variant="outline" className="h-9 text-sm px-3.5 rounded-xl border-pilote text-pilote hover:bg-pilote-50 transition-colors">
            <Euro className="w-3.5 h-3.5 mr-1.5" />Saisir le CA
          </Button>
          <Button onClick={() => setShowAdd(true)} className="bg-pilote hover:bg-pilote-hover text-white h-9 text-sm px-3.5 rounded-xl shadow-card active:scale-95 transition-all">
            <Plus className="w-3.5 h-3.5 mr-1.5" />Ajouter une facture
          </Button>
          <button onClick={() => setShowSettings(true)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors">
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Week nav */}
      <div className="bg-white border-b border-gray-100 px-6 py-2.5 flex items-center gap-2">
        <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-xl px-1 py-0.5">
          <button onClick={prevWeek} className="p-1.5 rounded-lg hover:bg-white hover:shadow-sm transition-all"><ChevronLeft className="w-4 h-4 text-gray-500" /></button>
          <div className="flex items-center gap-2 px-2">
            <span className="font-bold text-gray-900 text-sm">Semaine {week}</span>
            <span className="text-gray-300 text-sm">·</span>
            <span className="text-xs text-gray-500 tabular">{fmtDate(mon)} – {fmtDate(sun)}</span>
            {isCurrentWeek && <span className="text-[10px] bg-pilote text-white px-1.5 py-0.5 rounded-md font-semibold">En cours</span>}
            {isLastWeek && !isCurrentWeek && <span className="text-[10px] bg-amber-500 text-white px-1.5 py-0.5 rounded-md font-semibold">Semaine écoulée</span>}
          </div>
          <button onClick={nextWeek} className="p-1.5 rounded-lg hover:bg-white hover:shadow-sm transition-all"><ChevronRight className="w-4 h-4 text-gray-500" /></button>
        </div>
        {!isLastWeek && <button onClick={() => { setWeek(lastWeek.week); setYear(lastWeek.year) }} className="text-xs text-pilote font-medium hover:underline">← Semaine écoulée</button>}
        {!isCurrentWeek && <button onClick={() => { setWeek(cw); setYear(cy) }} className="text-xs text-gray-400 hover:text-gray-600 hover:underline transition-colors">Semaine en cours →</button>}

        {/* Intégrations compactes */}
        <div className="ml-auto flex items-center gap-2">
          {integrations.map(integ => {
            const meta = PROVIDERS_META.find(p => p.id === integ.provider)
            if (!meta) return null
            const isSyncing = syncing === integ.provider
            return (
              <div key={integ.provider} className="flex items-center gap-1.5 bg-green-50 border border-green-200 rounded-lg pl-2 pr-1 py-1">
                <div className={`w-5 h-5 rounded ${meta.color} flex items-center justify-center text-white text-[8px] font-extrabold`}>{meta.logo}</div>
                <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                {integ.last_sync_status === 'error' && <span className="text-[9px] text-red-500 font-semibold">erreur</span>}
                <button onClick={() => syncNow(integ.provider)} disabled={isSyncing}
                  className="flex items-center gap-1 text-[11px] font-semibold text-green-800 hover:text-green-900 px-1.5 py-0.5 rounded hover:bg-green-100 transition-colors disabled:opacity-50"
                  title={`Synchroniser la semaine ${week}`}>
                  <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />{isSyncing ? '...' : `Sync S${week}`}
                </button>
                <button onClick={() => disconnectIntegration(integ.provider)} className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors" title="Déconnecter">
                  <Link2Off className="w-3 h-3" />
                </button>
              </div>
            )
          })}
          <button onClick={() => setShowProviders(v => !v)}
            className="flex items-center gap-1 text-xs font-semibold text-pilote border border-dashed border-gray-300 rounded-lg px-2.5 py-1.5 hover:border-pilote transition-colors">
            <Link2 className="w-3 h-3" />{integrations.length === 0 ? 'Connecter un logiciel' : 'Ajouter'}
          </button>
        </div>
      </div>

      {/* Panneau intégrations (replié par défaut) */}
      {showProviders && (
        <div className="bg-white border-b border-gray-100 px-6 py-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {PROVIDERS_META.filter(p => !integrations.find(i => i.provider === p.id)).map(prov => (
              <div key={prov.id} className="rounded-xl border-2 border-dashed border-gray-200 hover:border-gray-300 bg-gray-50/30 p-4 transition-all">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-8 h-8 rounded-lg ${prov.color} flex items-center justify-center text-white text-[10px] font-extrabold flex-shrink-0`}>{prov.logo}</div>
                  <span className="font-bold text-sm text-gray-900">{prov.name}</span>
                </div>
                <p className="text-[10px] text-gray-400 mb-3 leading-relaxed">{prov.description}</p>
                <button onClick={() => { setConnectProvider(prov); setConnectToken(''); setConnectCompanyId(''); setConnectError(''); setShowConnect(true) }}
                  className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold bg-pilote text-white rounded-lg py-1.5 hover:bg-pilote-hover transition-colors">
                  <Link2 className="w-3 h-3" />Connecter
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 px-6 py-6 space-y-6">

        {/* KPIs */}
        {summary !== null && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { icon: Euro,         label: 'CA semaine',      value: summary.ca_total > 0 ? fmtEuro(summary.ca_total) : '—',
                sub: summary.ca_total === 0 ? 'Cliquer sur « Saisir le CA »' : `${fmtDate(mon)} – ${fmtDate(sun)}`,
                chip: 'bg-pilote-50 text-pilote' },
              { icon: ShoppingCart, label: 'Achats HT',       value: fmtEuro(variableTotalHt + fixedWeekly),
                sub: `${variableInvoices.length} facture${variableInvoices.length > 1 ? 's' : ''} + fixes ≈ ${fmtEuro(fixedWeekly)}/sem`,
                chip: 'bg-pilote-50 text-pilote' },
              { icon: Users,        label: 'Masse salariale', value: fmtEuro(summary.masse_salariale),
                sub: summary.ratio_ms !== null ? `${summary.ratio_ms} % du CA` : 'Depuis le planning',
                chip: 'bg-pilote-50 text-pilote' },
              { icon: summary.marge_brute >= 0 ? TrendingUp : TrendingDown, label: 'Marge brute',
                value: summary.ca_total > 0 ? fmtEuro(summary.marge_brute) : '—',
                sub: summary.taux_marge !== null ? `Taux : ${summary.taux_marge} %` : 'Saisir le CA pour calculer',
                chip: summary.marge_brute >= 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500' },
            ].map(k => (
              <div key={k.label} className="bg-white rounded-2xl border border-gray-100 shadow-card p-4 transition-all hover:shadow-md hover:-translate-y-0.5">
                <div className="flex items-center gap-2 mb-2.5">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${k.chip}`}><k.icon className="w-4 h-4" /></div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{k.label}</p>
                </div>
                <p className="text-xl font-extrabold leading-tight text-gray-900 tabular">{k.value}</p>
                <p className="text-xs text-gray-400 mt-0.5 truncate">{k.sub}</p>
              </div>
            ))}
          </div>
        )}

        {/* Résultat net */}
        {summary !== null && summary.ca_total > 0 && (
          <div className={`rounded-2xl border p-5 flex items-center justify-between shadow-card ${
            summary.resultat_net >= 0 ? 'bg-gradient-to-r from-green-50 via-green-50/40 to-white border-green-200' : 'bg-gradient-to-r from-red-50 via-red-50/40 to-white border-red-200'
          }`}>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Résultat net estimé de la semaine</p>
              <p className={`text-4xl font-extrabold tracking-tight mt-1 tabular ${summary.resultat_net >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmtEuro(summary.resultat_net)}</p>
              <div className="flex flex-wrap items-center gap-1.5 mt-2.5 text-[11px] tabular">
                <span className="bg-white/80 border border-gray-200 rounded-md px-2 py-0.5 text-gray-600">CA <strong className="text-gray-900">{fmtEuro(summary.ca_total)}</strong></span>
                <span className="text-gray-400">−</span>
                <span className="bg-white/80 border border-gray-200 rounded-md px-2 py-0.5 text-gray-600">Achats <strong className="text-gray-900">{fmtEuro(summary.achats_ht)}</strong></span>
                <span className="text-gray-400">−</span>
                <span className="bg-white/80 border border-gray-200 rounded-md px-2 py-0.5 text-gray-600">Salaires <strong className="text-gray-900">{fmtEuro(summary.masse_salariale)}</strong></span>
              </div>
            </div>
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 ${summary.resultat_net >= 0 ? 'bg-green-100' : 'bg-red-100'}`}>
              {summary.resultat_net >= 0 ? <TrendingUp className="w-7 h-7 text-green-600" /> : <TrendingDown className="w-7 h-7 text-red-600" />}
            </div>
          </div>
        )}

        {/* Répartition des achats — barre de distribution + légende */}
        {summary !== null && summary.achats_ht > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Répartition des achats</h3>
              <span className="text-xs text-gray-400 tabular">{fmtEuro(summary.achats_ht)} HT</span>
            </div>
            <div className="h-2.5 rounded-full overflow-hidden flex bg-gray-100">
              {CATEGORIES.map(cat => {
                const amt = summary.achats_by_category[cat.key] as number | undefined
                if (!amt || amt <= 0) return null
                const pct = (amt / summary.achats_ht) * 100
                return <div key={cat.key} style={{ width: `${pct}%`, backgroundColor: cat.dot }} title={`${cat.label} · ${fmtEuro(amt)} (${Math.round(pct)} %)`} className="transition-all hover:opacity-80" />
              })}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 mt-3.5">
              {CATEGORIES.map(cat => {
                const amt = summary.achats_by_category[cat.key] as number | undefined
                if (!amt || amt <= 0) return null
                const pct = Math.round((amt / summary.achats_ht) * 100)
                return (
                  <div key={cat.key} className="flex items-center gap-1.5 text-xs">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cat.dot }} />
                    <span className="text-gray-600 font-medium">{cat.label}</span>
                    <span className="font-bold text-gray-900 tabular">{fmtEuro(amt)}</span>
                    <span className="text-gray-400">{pct} %</span>
                  </div>
                )
              })}
              {fixedWeekly > 0 && (
                <div className="flex items-center gap-1.5 text-xs" title={`${fixedInvoices.length} charge(s) structurelle(s) couvrant cette semaine`}>
                  <Repeat className="w-3 h-3 text-gray-400" />
                  <span className="text-gray-600 font-medium">Charges structurelles</span>
                  <span className="font-bold text-gray-900 tabular">≈ {fmtEuro(fixedWeekly)}/sem</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Achats de la semaine (liste plate, catégorie en pastille) ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-bold text-gray-900">Achats de la semaine {week}</h2>
            <span className="text-xs text-gray-400 tabular">{variableInvoices.length} facture{variableInvoices.length > 1 ? 's' : ''} · {fmtEuro(variableTotalHt)} HT</span>
          </div>
          {loading ? (
            <div className="p-6 animate-pulse space-y-3">
              <div className="h-10 bg-gray-100 rounded-lg" />
              <div className="h-10 bg-gray-100 rounded-lg" />
              <div className="h-10 bg-gray-100 rounded-lg" />
            </div>
          ) : variableInvoices.length === 0 ? (
            <div className="py-14 flex flex-col items-center justify-center text-center bg-gradient-to-b from-pilote-50/30 to-white">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-pilote-50 to-pilote-100 ring-1 ring-pilote-200/60 flex items-center justify-center mb-4 shadow-sm">
                <ShoppingCart className="w-6 h-6 text-pilote" />
              </div>
              <p className="text-sm font-bold text-gray-900">Aucun achat sur la semaine {week}</p>
              <p className="text-xs text-gray-400 mt-1 max-w-xs">Lancez un sync pour importer les factures, ou ajoutez-les à la main.</p>
              <button onClick={() => setShowAdd(true)} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-pilote hover:bg-pilote-hover rounded-xl px-4 py-2 shadow-card active:scale-95 transition-all">
                <Plus className="w-3.5 h-3.5" />Ajouter une facture
              </button>
            </div>
          ) : (
            <table className="w-full tabular">
              <thead>
                <tr className="bg-gray-50 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  <th className="px-4 py-2.5 text-left">Fournisseur</th>
                  <th className="px-4 py-2.5 text-left">Catégorie</th>
                  <th className="px-4 py-2.5 text-left">Date</th>
                  <th className="px-4 py-2.5 text-right">HT</th>
                  <th className="px-4 py-2.5 text-right">TVA</th>
                  <th className="px-4 py-2.5 text-right">TTC</th>
                  <th className="px-4 py-2.5 text-center w-24"></th>
                </tr>
              </thead>
              <tbody>
                {sortedVariable.map(inv => {
                  const cat = catInfo(inv.category)
                  const isViande = cat.key === 'viande'
                  return (
                    <tr key={inv.id} className="border-t border-gray-50 hover:bg-gray-50 group transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-pilote-50 text-pilote flex items-center justify-center text-[11px] font-extrabold flex-shrink-0">{initials(inv.supplier_name)}</div>
                          <div>
                            <div className="font-semibold text-sm text-gray-900">{inv.supplier_name}</div>
                            {inv.invoice_number && <div className="text-xs text-gray-400">{inv.invoice_number}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <select
                          value={inv.category}
                          onChange={e => updateCategory(inv, e.target.value)}
                          className={`text-xs font-semibold rounded-full pl-2.5 pr-1.5 py-0.5 border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-pilote-200 ${cat.color}`}
                          title="Modifier la catégorie"
                        >
                          {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-2.5 text-sm text-gray-600">{new Date(inv.invoice_date).toLocaleDateString('fr-FR')}</td>
                      <td className={`px-4 py-2.5 text-right font-semibold text-sm ${inv.amount_ht < 0 ? 'text-green-600' : 'text-gray-900'}`}>{fmtEuro(inv.amount_ht)}</td>
                      <td className="px-4 py-2.5 text-right text-xs text-gray-400">{inv.tva_rate} %</td>
                      <td className="px-4 py-2.5 text-right text-sm text-gray-600">{fmtEuro(inv.amount_ttc)}</td>
                      <td className="px-4 py-2.5 text-center">
                        <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                          <button onClick={() => toggleFixed(inv)} className="p-1.5 rounded hover:bg-pilote-50 text-gray-300 hover:text-pilote transition-colors" title="Marquer comme charge structurelle (prorata hebdo)">
                            <Repeat className="w-3.5 h-3.5" />
                          </button>
                          {isViande && (
                            <button onClick={() => openValorisation(inv)} className="p-1.5 rounded hover:bg-pilote-50 text-gray-300 hover:text-pilote transition-colors" title="Valoriser cet animal">
                              <ArrowUpRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button onClick={() => deleteInvoice(inv.id)} className="p-1.5 rounded hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors" title="Supprimer">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-pilote text-white">
                  <td colSpan={3} className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white/60">Total achats variables</td>
                  <td className="px-4 py-2.5 text-right font-bold">{fmtEuro(variableTotalHt)}</td>
                  <td className="px-4 py-2.5"></td>
                  <td className="px-4 py-2.5 text-right font-bold text-orange-300">{fmtEuro(variableTotalTtc)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* ── Charges structurelles couvrant la semaine ── */}
        <div className="bg-white rounded-2xl border border-pilote-100 shadow-card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-pilote-100 bg-pilote-50/60 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-white ring-1 ring-pilote-200/60 flex items-center justify-center flex-shrink-0"><Repeat className="w-4 h-4 text-pilote" /></div>
              <div>
                <h2 className="font-bold text-gray-900">Charges structurelles</h2>
                <p className="text-[11px] text-gray-400">Toutes les charges fixes dont la période couvre la semaine {week} — quelle que soit leur date de facture</p>
              </div>
            </div>
            {fixedInvoices.length > 0 && (
              <div className="text-right">
                <p className="text-sm font-bold text-pilote tabular">≈ {fmtEuro(fixedWeekly)}/sem</p>
                <p className="text-[10px] text-gray-400">{fixedInvoices.length} charge{fixedInvoices.length > 1 ? 's' : ''} · {fmtEuro(fixedTotalHt)} HT facturé</p>
              </div>
            )}
          </div>
          {loading ? (
            <div className="p-6 animate-pulse"><div className="h-10 bg-gray-100 rounded-lg" /></div>
          ) : fixedInvoices.length === 0 ? (
            <div className="py-10 flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 rounded-2xl bg-gray-50 ring-1 ring-gray-200/70 flex items-center justify-center mb-3">
                <Repeat className="w-5 h-5 text-gray-300" />
              </div>
              <p className="text-sm font-semibold text-gray-700">Aucune charge structurelle sur cette semaine</p>
              <p className="text-xs text-gray-400 mt-1 max-w-sm">Survolez une facture ci-dessus et cliquez sur l&apos;icône de récurrence pour la marquer comme charge fixe (loyer, EDF, assurance...)</p>
            </div>
          ) : (
            <table className="w-full tabular">
              <thead>
                <tr className="bg-gray-50 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  <th className="px-4 py-2.5 text-left">Fournisseur</th>
                  <th className="px-4 py-2.5 text-left">Facturée le</th>
                  <th className="px-4 py-2.5 text-right">Montant HT</th>
                  <th className="px-4 py-2.5 text-center">Période</th>
                  <th className="px-4 py-2.5 text-right">Part hebdo</th>
                  <th className="px-4 py-2.5 text-center w-20"></th>
                </tr>
              </thead>
              <tbody>
                {fixedInvoices.map((inv, i) => (
                  <tr key={inv.id} className={`border-t border-gray-100 hover:bg-pilote-50/40 group transition-colors ${i % 2 === 0 ? '' : 'bg-gray-50/50'}`}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center text-[11px] font-extrabold flex-shrink-0">{initials(inv.supplier_name)}</div>
                        <div>
                          <div className="font-semibold text-sm text-gray-900">{inv.supplier_name}</div>
                          {inv.invoice_number && <div className="text-xs text-gray-400">{inv.invoice_number}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-gray-600">{new Date(inv.invoice_date).toLocaleDateString('fr-FR')}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-sm text-gray-900">{fmtEuro(inv.amount_ht)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <select
                        value={inv.period_days || 30}
                        onChange={e => setFixedPeriod(inv, parseInt(e.target.value))}
                        className="text-xs border border-pilote-200 bg-pilote-50 text-pilote font-semibold rounded-lg px-2 py-1 focus:outline-none focus:border-pilote cursor-pointer"
                        title="Période couverte par cette facture"
                      >
                        {PERIOD_OPTIONS.map(p => <option key={p.days} value={p.days}>{p.label}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="font-bold text-sm text-pilote tabular">≈ {fmtEuro(Number(inv.prorata_ht) || weeklyShare(inv.amount_ht, inv.period_days))}</span>
                      <span className="text-[10px] text-gray-400">/sem</span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                        <button onClick={() => toggleFixed(inv)} className="p-1.5 rounded hover:bg-gray-100 text-gray-300 hover:text-gray-600 transition-colors" title="Retirer des charges structurelles (rebascule en achat variable)">
                          <Undo2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => deleteInvoice(inv.id)} className="p-1.5 rounded hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors" title="Supprimer">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-pilote text-white">
                  <td colSpan={2} className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white/60">Total charges structurelles</td>
                  <td className="px-4 py-2.5 text-right font-bold">{fmtEuro(fixedTotalHt)}</td>
                  <td className="px-4 py-2.5"></td>
                  <td className="px-4 py-2.5 text-right font-bold text-yellow-300">≈ {fmtEuro(fixedWeekly)}/sem</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>

      {/* Modal : Connecter intégration */}
      {showConnect && connectProvider && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm" onClick={() => setShowConnect(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl ${connectProvider.color} flex items-center justify-center text-white text-xs font-extrabold`}>{connectProvider.logo}</div>
                <div><h2 className="text-base font-bold text-gray-900">Connecter {connectProvider.name}</h2><p className="text-xs text-gray-400">{connectProvider.description}</p></div>
              </div>
              <button onClick={() => setShowConnect(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">{connectProvider.tokenLabel} *</label>
                <Input value={connectToken} onChange={e => setConnectToken(e.target.value)} placeholder={connectProvider.tokenPlaceholder} type="password" autoFocus />
              </div>
              {connectProvider.needsCompanyId && (
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">{connectProvider.companyIdLabel} *</label>
                  <Input value={connectCompanyId} onChange={e => setConnectCompanyId(e.target.value)} placeholder="Identifiant de votre entreprise" />
                </div>
              )}
              <p className="text-[10px] text-gray-400">Votre token est chiffré et stocké de manière sécurisée. <a href={connectProvider.helpUrl} target="_blank" rel="noreferrer" className="text-pilote underline">Comment trouver mon token ?</a></p>
              {connectError && <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />{connectError}</div>}
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setShowConnect(false)}>Annuler</Button>
                <Button className="flex-1 bg-pilote hover:bg-pilote-hover text-white" onClick={connectIntegration} disabled={!connectToken || connecting || (connectProvider.needsCompanyId && !connectCompanyId)}>
                  {connecting ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Test en cours...</> : <><Link2 className="w-4 h-4 mr-1.5" />Connecter</>}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal : Ajouter facture */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm" onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-gray-900">Nouvelle facture</h2>
              <button onClick={() => setShowAdd(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="space-y-4">
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-gray-600 mb-1">Fournisseur *</label>
                <Input value={newInvoice.supplier_name} onChange={e => {
                  const supplier_name = e.target.value
                  const known = supplierMap[supplier_name.trim().toLowerCase()]
                  setNewInvoice((p: any) => ({ ...p, supplier_name, ...(known ? { category: known } : {}) }))
                }} placeholder="Maison Dupont" autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">N° facture</label>
                  <Input value={newInvoice.invoice_number} onChange={e => setNewInvoice((p: any) => ({ ...p, invoice_number: e.target.value }))} placeholder="F-2024-001" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Date *</label>
                  <Input type="date" value={newInvoice.invoice_date} onChange={e => setNewInvoice((p: any) => ({ ...p, invoice_date: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Catégorie</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {CATEGORIES.map(cat => (
                    <button key={cat.key} onClick={() => setNewInvoice((p: any) => ({ ...p, category: cat.key }))}
                      className={`py-1.5 px-2 rounded-lg text-xs font-semibold border-2 transition-all ${
                        newInvoice.category === cat.key ? 'border-pilote bg-pilote text-white' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}>{cat.label}
                    </button>
                  ))}
                </div>
                {supplierMap[(newInvoice.supplier_name || '').trim().toLowerCase()] && (
                  <p className="text-[11px] text-pilote mt-1.5">Pré-remplie d'après vos achats précédents chez ce fournisseur — modifiable.</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Montant HT *</label>
                  <Input type="number" step="0.01" value={newInvoice.amount_ht} onChange={e => setNewInvoice((p: any) => ({ ...p, amount_ht: e.target.value }))} placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Taux TVA (%)</label>
                  <select value={newInvoice.tva_rate} onChange={e => setNewInvoice((p: any) => ({ ...p, tva_rate: e.target.value }))} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-pilote">
                    {TVA_RATES.map(r => <option key={r} value={r}>{r === 0 ? '0 % (exonéré)' : `${r} %`}</option>)}
                  </select>
                </div>
              </div>
              {newInvoice.amount_ht && <div className="bg-gray-50 rounded-lg px-3 py-2 flex items-center justify-between"><span className="text-xs text-gray-500">Montant TTC calculé</span><span className="font-bold text-gray-900">{fmtEuro(ttcAmount)}</span></div>}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Notes</label>
                <Input value={newInvoice.notes} onChange={e => setNewInvoice((p: any) => ({ ...p, notes: e.target.value }))} placeholder="Livraison lundi matin..." />
              </div>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setShowAdd(false)}>Annuler</Button>
                <Button className="flex-1 bg-pilote hover:bg-pilote-hover text-white" onClick={addInvoice} disabled={!newInvoice.supplier_name || !newInvoice.invoice_date || !newInvoice.amount_ht || saving}>
                  {saving ? 'Enregistrement...' : 'Enregistrer'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal : CA */}
      {showCA && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm" onClick={() => setShowCA(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div><h2 className="text-base font-bold text-gray-900">CA de la semaine {week}</h2><p className="text-xs text-gray-400 mt-0.5">{fmtDate(mon)} – {fmtDate(sun)}</p></div>
              <button onClick={() => setShowCA(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">CA Total (€)</label>
                <Input type="number" step="0.01" min="0" value={caForm.ca_total} onChange={e => setCaForm(p => ({ ...p, ca_total: e.target.value }))} placeholder="0.00" className="text-lg font-bold" autoFocus />
              </div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider pt-1">Détail par rayon (optionnel)</p>
              {[{ key: 'ca_boucherie', label: 'Boucherie' }, { key: 'ca_charcuterie', label: 'Charcuterie' }, { key: 'ca_traiteur', label: 'Traiteur' }, { key: 'ca_vente', label: 'Vente / Épicerie' }].map(({ key, label }) => (
                <div key={key} className="flex items-center gap-2">
                  <label className="text-xs text-gray-500 w-28 flex-shrink-0">{label}</label>
                  <Input type="number" step="0.01" min="0" value={(caForm as any)[key]} onChange={e => setCaForm(p => ({ ...p, [key]: e.target.value }))} placeholder="0.00" />
                </div>
              ))}
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowCA(false)}>Annuler</Button>
                <Button className="flex-1 bg-pilote hover:bg-pilote-hover text-white" onClick={saveCA} disabled={saving}>
                  <Check className="w-4 h-4 mr-1.5" />{saving ? 'Enregistrement...' : 'Enregistrer'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal : Paramètres */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm" onClick={() => setShowSettings(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-gray-900">Paramètres entreprise</h2>
              <button onClick={() => setShowSettings(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Nom de l&apos;entreprise</label>
                <Input value={settForm.company_name} onChange={e => setSettForm(p => ({ ...p, company_name: e.target.value }))} placeholder="Boucherie Dupont" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">SIRET</label>
                <Input value={settForm.siret} onChange={e => setSettForm(p => ({ ...p, siret: e.target.value }))} placeholder="123 456 789 00012" />
              </div>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setShowSettings(false)}>Annuler</Button>
                <Button className="flex-1 bg-pilote hover:bg-pilote-hover text-white" onClick={saveSettings} disabled={saving}>
                  <Save className="w-4 h-4 mr-1.5" />{saving ? 'Enregistrement...' : 'Sauvegarder'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
