'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Receipt, ChevronLeft, ChevronRight, Plus, Trash2,
  TrendingUp, TrendingDown, ShoppingCart, Users, Euro,
  Save, X, Settings, Check, Loader2, AlertCircle,
  Link2, Link2Off, RefreshCw
} from 'lucide-react'

// ─── Types ─────────────────────────────────────────────────────────────────────────────────

type Invoice = {
  id: string
  supplier_name: string
  invoice_number?: string
  invoice_date: string
  category: string
  amount_ht: number
  tva_rate: number
  amount_ttc: number
  notes?: string
  week_number: number
  year: number
}

type WeeklyCA = {
  ca_total: number
  ca_boucherie: number
  ca_charcuterie: number
  ca_traiteur: number
  ca_vente: number
}

type Summary = {
  achats_ht: number
  achats_by_category: Record<string, number>
  masse_salariale: number
  ca_total: number
  ca_detail: WeeklyCA | null
  marge_brute: number
  taux_marge: number | null
  resultat_net: number
  ratio_ms: number | null
}

type BillingIntegration = {
  provider: string
  is_active: boolean
  last_sync_at?: string
  last_sync_status?: 'success' | 'error' | 'pending'
  invoices_synced?: number
  company_id?: string
}

type ProviderMeta = {
  id: string
  name: string
  logo: string
  color: string
  tokenLabel: string
  tokenPlaceholder: string
  needsCompanyId: boolean
  companyIdLabel?: string
  helpUrl: string
  description: string
}

// ─── Constantes ──────────────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { key: 'viande',         label: 'Viande',          color: 'bg-red-100 text-red-800'       },
  { key: 'charcuterie',    label: 'Charcuterie',     color: 'bg-orange-100 text-orange-800'  },
  { key: 'epicerie',       label: 'Épicerie',        color: 'bg-yellow-100 text-yellow-800'  },
  { key: 'emballage',      label: 'Emballage',       color: 'bg-blue-100 text-blue-800'     },
  { key: 'frais_generaux', label: 'Frais généraux',  color: 'bg-purple-100 text-purple-800' },
  { key: 'autre',          label: 'Autre',           color: 'bg-gray-100 text-gray-700'     },
]

const TVA_RATES = [0, 5.5, 10, 20]

const EMPTY_INVOICE = {
  supplier_name: '', invoice_number: '', invoice_date: '',
  category: 'viande', amount_ht: '', tva_rate: '20', notes: ''
}

const PROVIDERS_META: ProviderMeta[] = [
  {
    id: 'pennylane',
    name: 'Pennylane',
    logo: 'PL',
    color: 'bg-blue-600',
    tokenLabel: 'Token API Pennylane',
    tokenPlaceholder: 'eyJhbGci...',
    needsCompanyId: false,
    helpUrl: 'https://help.pennylane.com/fr/articles/developer-api',
    description: 'Importation automatique des factures fournisseurs via l’API Pennylane',
  },
  {
    id: 'sage',
    name: 'Sage',
    logo: 'SG',
    color: 'bg-green-600',
    tokenLabel: 'Access Token Sage',
    tokenPlaceholder: 'Bearer token issu de Sage OAuth2',
    needsCompanyId: false,
    helpUrl: 'https://developer.sage.com/accounting/',
    description: 'Sage Business Cloud Comptabilité — factures achats',
  },
  {
    id: 'cegid',
    name: 'Cegid',
    logo: 'CG',
    color: 'bg-purple-600',
    tokenLabel: 'Clé API Cegid',
    tokenPlaceholder: 'Clé depuis votre espace Cegid',
    needsCompanyId: true,
    companyIdLabel: 'ID Entreprise Cegid',
    helpUrl: 'https://developers.cegid.com',
    description: 'Cegid Loop — import automatique des factures d’achat',
  },
  {
    id: 'ebp',
    name: 'EBP',
    logo: 'EBP',
    color: 'bg-orange-500',
    tokenLabel: 'Token API EBP en ligne',
    tokenPlaceholder: 'Token depuis EBP → Paramètres → API',
    needsCompanyId: true,
    companyIdLabel: 'Identifiant dossier EBP',
    helpUrl: 'https://developer.ebp.com',
    description: 'EBP en ligne — import factures fournisseurs automatique',
  },
]

// ─── Helpers ────────────────────────────────────────────────────────────────────────────────

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
  const sun = new Date(mon)
  sun.setUTCDate(mon.getUTCDate() + 6)
  return [mon, sun]
}

function fmtDate(d: Date) {
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function fmtEuro(n: number) {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

function catInfo(key: string) {
  return CATEGORIES.find(c => c.key === key) ?? CATEGORIES[CATEGORIES.length - 1]
}

// ─── Composant principal ─────────────────────────────────────────────────────────────────

export default function FacturationPage() {
  const now = getISOWeek(new Date())
  const [week, setWeek] = useState(now.week)
  const [year, setYear] = useState(now.year)
  const [invoices,  setInvoices]  = useState<Invoice[]>([])
  const [summary,   setSummary]   = useState<Summary | null>(null)
  const [loading,   setLoading]   = useState(false)
  const [showAdd,   setShowAdd]   = useState(false)
  const [showCA,    setShowCA]    = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [newInvoice, setNewInvoice] = useState<any>(EMPTY_INVOICE)
  const [saving,    setSaving]    = useState(false)
  const [caForm,    setCaForm]    = useState({ ca_total: '', ca_boucherie: '', ca_charcuterie: '', ca_traiteur: '', ca_vente: '' })
  const [settForm,  setSettForm]  = useState({ company_name: '', siret: '' })

  // ─ Intégrations comptables
  const [integrations,     setIntegrations]     = useState<BillingIntegration[]>([])
  const [showConnect,      setShowConnect]      = useState(false)
  const [connectProvider,  setConnectProvider]  = useState<ProviderMeta | null>(null)
  const [connectToken,     setConnectToken]     = useState('')
  const [connectCompanyId, setConnectCompanyId] = useState('')
  const [connecting,       setConnecting]       = useState(false)
  const [connectError,     setConnectError]     = useState('')
  const [syncing,          setSyncing]          = useState<string | null>(null)

  const [mon, sun] = getWeekDates(week, year)
  const { week: cw, year: cy } = getISOWeek(new Date())
  const isCurrentWeek = week === cw && year === cy

  const load = useCallback(async () => {
    setLoading(true)
    const [invRes, sumRes, caRes, settRes] = await Promise.all([
      fetch(`/api/invoices?week=${week}&year=${year}`).then(r => r.json()).catch(() => []),
      fetch(`/api/facturation/summary?week=${week}&year=${year}`).then(r => r.json()).catch(() => null),
      fetch(`/api/weekly-ca?week=${week}&year=${year}`).then(r => r.json()).catch(() => null),
      fetch('/api/billing-settings').then(r => r.json()).catch(() => ({})),
    ])
    setInvoices(Array.isArray(invRes) ? invRes : [])
    setSummary(sumRes)
    const s = settRes || {}
    setSettForm({ company_name: s.company_name || '', siret: s.siret || '' })
    if (caRes) {
      setCaForm({
        ca_total:       String(caRes.ca_total       || ''),
        ca_boucherie:   String(caRes.ca_boucherie   || ''),
        ca_charcuterie: String(caRes.ca_charcuterie || ''),
        ca_traiteur:    String(caRes.ca_traiteur    || ''),
        ca_vente:       String(caRes.ca_vente       || ''),
      })
    } else {
      setCaForm({ ca_total: '', ca_boucherie: '', ca_charcuterie: '', ca_traiteur: '', ca_vente: '' })
    }
    setLoading(false)
  }, [week, year])

  const loadIntegrations = useCallback(async () => {
    const res = await fetch('/api/billing-integrations').catch(() => null)
    if (res?.ok) {
      const data = await res.json()
      setIntegrations(Array.isArray(data) ? data : [])
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadIntegrations() }, [loadIntegrations])

  function prevWeek() { if (week === 1) { setYear(y => y - 1); setWeek(52) } else setWeek(w => w - 1) }
  function nextWeek() { if (week === 52) { setYear(y => y + 1); setWeek(1) } else setWeek(w => w + 1) }

  async function addInvoice() {
    if (!newInvoice.supplier_name || !newInvoice.invoice_date || !newInvoice.amount_ht) return
    setSaving(true)
    const res = await fetch('/api/invoices', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newInvoice, week_number: week, year }),
    })
    const data = await res.json()
    if (data.id) {
      setInvoices(prev => [data, ...prev])
      setShowAdd(false)
      setNewInvoice(EMPTY_INVOICE)
      load()
    }
    setSaving(false)
  }

  async function deleteInvoice(id: string) {
    if (!confirm('Supprimer cette facture ?')) return
    await fetch(`/api/invoices/${id}`, { method: 'DELETE' })
    setInvoices(prev => prev.filter(i => i.id !== id))
    load()
  }

  async function saveCA() {
    setSaving(true)
    const body = {
      week_number: week, year,
      ca_total:       parseFloat(caForm.ca_total)       || 0,
      ca_boucherie:   parseFloat(caForm.ca_boucherie)   || 0,
      ca_charcuterie: parseFloat(caForm.ca_charcuterie) || 0,
      ca_traiteur:    parseFloat(caForm.ca_traiteur)    || 0,
      ca_vente:       parseFloat(caForm.ca_vente)       || 0,
    }
    const res = await fetch('/api/weekly-ca', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (res.ok) { setShowCA(false); load() }
    setSaving(false)
  }

  async function saveSettings() {
    setSaving(true)
    await fetch('/api/billing-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settForm),
    })
    setSaving(false)
    setShowSettings(false)
  }

  async function connectIntegration() {
    if (!connectProvider || !connectToken) return
    setConnecting(true)
    setConnectError('')
    const res = await fetch('/api/billing-integrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider:   connectProvider.id,
        api_token:  connectToken,
        company_id: connectCompanyId || undefined,
      }),
    })
    const data = await res.json()
    if (!res.ok) { setConnectError(data.error || 'Erreur de connexion'); setConnecting(false); return }
    setShowConnect(false)
    setConnectToken('')
    setConnectCompanyId('')
    setConnectProvider(null)
    setConnecting(false)
    loadIntegrations()
  }

  async function disconnectIntegration(provider: string) {
    if (!confirm(`Déconnecter ${provider} ? Les factures déjà importées sont conservées.`)) return
    await fetch(`/api/billing-integrations/${provider}`, { method: 'DELETE' })
    loadIntegrations()
  }

  async function syncNow(provider: string) {
    setSyncing(provider)
    await fetch('/api/billing-integrations/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider }),
    })
    setSyncing(null)
    loadIntegrations()
    load()
  }

  const ttcAmount = parseFloat(newInvoice.amount_ht || '0') * (1 + parseFloat(newInvoice.tva_rate || '20') / 100)

  function KpiCard({ icon: Icon, label, value, sub, color, warn }: any) {
    return (
      <div className={`bg-white rounded-xl border p-4 flex flex-col gap-1 ${warn ? 'border-red-200' : 'border-gray-100'} shadow-sm`}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</span>
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
            <Icon className="w-4 h-4" />
          </div>
        </div>
        <p className={`text-2xl font-bold mt-1 ${warn ? 'text-red-600' : 'text-gray-900'}`}>{value}</p>
        {sub && <p className="text-xs text-gray-400">{sub}</p>}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* ── Header ── */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Receipt className="w-5 h-5 text-[#1E3A5F]" />
          <h1 className="text-lg font-bold text-gray-900">Facturation &amp; Achats</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowCA(true)} variant="outline" className="h-8 text-sm px-3 border-[#1E3A5F] text-[#1E3A5F] hover:bg-blue-50">
            <Euro className="w-3.5 h-3.5 mr-1.5" />Saisir le CA
          </Button>
          <Button onClick={() => setShowAdd(true)} className="bg-[#1E3A5F] hover:bg-[#2a4f7c] text-white h-8 text-sm px-3">
            <Plus className="w-3.5 h-3.5 mr-1.5" />Ajouter une facture
          </Button>
          <button onClick={() => setShowSettings(true)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700">
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Week nav ── */}
      <div className="bg-white border-b border-gray-100 px-6 py-2.5 flex items-center gap-3">
        <button onClick={prevWeek} className="p-1.5 rounded hover:bg-gray-100"><ChevronLeft className="w-4 h-4 text-gray-500" /></button>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-900 text-sm">Semaine {week}</span>
          <span className="text-gray-300 text-sm">·</span>
          <span className="text-xs text-gray-500">{fmtDate(mon)} – {fmtDate(sun)}</span>
          {isCurrentWeek && <span className="text-[10px] bg-[#1E3A5F] text-white px-1.5 py-0.5 rounded font-medium">Actuelle</span>}
        </div>
        <button onClick={nextWeek} className="p-1.5 rounded hover:bg-gray-100"><ChevronRight className="w-4 h-4 text-gray-500" /></button>
        {!isCurrentWeek && (
          <button onClick={() => { setWeek(cw); setYear(cy) }} className="text-xs text-[#1E3A5F] hover:underline">← Semaine actuelle</button>
        )}
      </div>

      <div className="flex-1 px-6 py-6 space-y-6">

        {/* ── Intégrations comptables ── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="mb-4">
            <h2 className="font-semibold text-gray-900">Intégrations comptables</h2>
            <p className="text-xs text-gray-400 mt-0.5">Connectez votre logiciel pour importer les factures fournisseurs automatiquement chaque dimanche</p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {PROVIDERS_META.map(prov => {
              const integ = integrations.find(i => i.provider === prov.id)
              const isSyncing = syncing === prov.id
              return (
                <div key={prov.id} className={`rounded-xl border-2 p-4 transition-all ${
                  integ ? 'border-green-200 bg-green-50/50' : 'border-dashed border-gray-200 hover:border-gray-300 bg-gray-50/30'
                }`}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`w-8 h-8 rounded-lg ${prov.color} flex items-center justify-center text-white text-[10px] font-extrabold flex-shrink-0`}>
                      {prov.logo}
                    </div>
                    <span className="font-bold text-sm text-gray-900">{prov.name}</span>
                  </div>
                  {integ ? (
                    <>
                      <div className="flex items-center gap-1.5 mb-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                        <span className="text-xs text-green-700 font-semibold">Connecté</span>
                        {integ.last_sync_status === 'error' && <span className="text-[10px] text-red-500 ml-1">Erreur sync</span>}
                      </div>
                      {integ.last_sync_at ? (
                        <p className="text-[10px] text-gray-400 mb-3">
                          Sync : {new Date(integ.last_sync_at).toLocaleDateString('fr-FR')}
                          {(integ.invoices_synced ?? 0) > 0 && ` · ${integ.invoices_synced} facture${(integ.invoices_synced ?? 0) > 1 ? 's' : ''}`}
                        </p>
                      ) : (
                        <p className="text-[10px] text-gray-400 mb-3">Jamais synchronisé</p>
                      )}
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => syncNow(prov.id)}
                          disabled={isSyncing}
                          className="flex-1 flex items-center justify-center gap-1 text-[11px] font-semibold bg-white border border-gray-200 rounded-lg py-1.5 hover:bg-gray-50 text-gray-600 transition-colors disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
                          {isSyncing ? 'Sync...' : 'Sync'}
                        </button>
                        <button
                          onClick={() => disconnectIntegration(prov.id)}
                          className="flex items-center justify-center p-1.5 rounded-lg border border-red-100 hover:bg-red-50 text-red-400 transition-colors"
                          title="Déconnecter"
                        >
                          <Link2Off className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-[10px] text-gray-400 mb-3 leading-relaxed">{prov.description}</p>
                      <button
                        onClick={() => { setConnectProvider(prov); setConnectToken(''); setConnectCompanyId(''); setConnectError(''); setShowConnect(true) }}
                        className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold bg-[#1E3A5F] text-white rounded-lg py-1.5 hover:bg-[#2a4f7c] transition-colors"
                      >
                        <Link2 className="w-3 h-3" />Connecter
                      </button>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* ── KPIs ── */}
        {summary !== null && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard icon={Euro} label="CA semaine"
              value={summary.ca_total > 0 ? fmtEuro(summary.ca_total) : '—'}
              sub={summary.ca_total === 0 ? 'Cliquer sur « Saisir le CA »' : ''}
              color="bg-blue-50 text-blue-600"
            />
            <KpiCard icon={ShoppingCart} label="Achats HT"
              value={fmtEuro(summary.achats_ht)}
              sub={`${invoices.length} facture${invoices.length > 1 ? 's' : ''}`}
              color="bg-orange-50 text-orange-600"
            />
            <KpiCard icon={Users} label="Masse salariale"
              value={fmtEuro(summary.masse_salariale)}
              sub={summary.ratio_ms !== null ? `${summary.ratio_ms} % du CA` : 'Depuis le planning'}
              color="bg-violet-50 text-violet-600"
            />
            <KpiCard
              icon={summary.marge_brute >= 0 ? TrendingUp : TrendingDown}
              label="Marge brute"
              value={summary.ca_total > 0 ? fmtEuro(summary.marge_brute) : '—'}
              sub={summary.taux_marge !== null ? `Taux : ${summary.taux_marge} %` : 'Saisir le CA pour calculer'}
              color={summary.marge_brute >= 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'}
              warn={summary.marge_brute < 0}
            />
          </div>
        )}

        {/* ── Résultat net ── */}
        {summary !== null && summary.ca_total > 0 && (
          <div className={`rounded-xl border p-4 flex items-center justify-between ${
            summary.resultat_net >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
          }`}>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Résultat net estimé (après charges salariales)</p>
              <p className="text-3xl font-extrabold mt-0.5 text-gray-900">{fmtEuro(summary.resultat_net)}</p>
              <p className="text-xs text-gray-400 mt-0.5">CA {fmtEuro(summary.ca_total)} − Achats {fmtEuro(summary.achats_ht)} − Salaires {fmtEuro(summary.masse_salariale)}</p>
            </div>
            <div className={`text-5xl font-black ${summary.resultat_net >= 0 ? 'text-green-300' : 'text-red-200'}`}>
              {summary.resultat_net >= 0 ? '+' : '−'}
            </div>
          </div>
        )}

        {/* ── Achats par catégorie ── */}
        {summary !== null && summary.achats_ht > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Achats par catégorie</h3>
            <div className="flex flex-wrap gap-2">
              {Object.entries(summary.achats_by_category).map(([cat, amt]) => {
                const info = catInfo(cat)
                const pct = summary.achats_ht > 0 ? Math.round((amt / summary.achats_ht) * 100) : 0
                return (
                  <div key={cat} className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ${info.color}`}>
                    <span>{info.label}</span>
                    <span className="font-bold">{fmtEuro(amt as number)}</span>
                    <span className="opacity-60">{pct} %</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Liste des factures ── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">Factures de la semaine</h2>
            <span className="text-xs text-gray-400">{invoices.length} facture{invoices.length > 1 ? 's' : ''} · {fmtEuro(invoices.reduce((s, i) => s + i.amount_ht, 0))} HT</span>
          </div>
          {loading ? (
            <div className="py-10 text-center text-sm text-gray-400">Chargement...</div>
          ) : invoices.length === 0 ? (
            <div className="py-10 text-center">
              <ShoppingCart className="w-8 h-8 text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-400">Aucune facture cette semaine</p>
              <button onClick={() => setShowAdd(true)} className="mt-3 text-sm text-[#1E3A5F] hover:underline font-medium">+ Ajouter une facture</button>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  <th className="px-4 py-2.5 text-left">Fournisseur</th>
                  <th className="px-4 py-2.5 text-left">Date</th>
                  <th className="px-4 py-2.5 text-left">Catégorie</th>
                  <th className="px-4 py-2.5 text-right">HT</th>
                  <th className="px-4 py-2.5 text-right">TVA</th>
                  <th className="px-4 py-2.5 text-right">TTC</th>
                  <th className="px-4 py-2.5 text-center w-12"></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv, i) => {
                  const info = catInfo(inv.category)
                  return (
                    <tr key={inv.id} className={`border-t border-gray-100 hover:bg-gray-50 group transition-colors ${i % 2 === 0 ? '' : 'bg-gray-50/50'}`}>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-sm text-gray-900">{inv.supplier_name}</div>
                        {inv.invoice_number && <div className="text-xs text-gray-400">{inv.invoice_number}</div>}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{new Date(inv.invoice_date).toLocaleDateString('fr-FR')}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${info.color}`}>{info.label}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-sm text-gray-900">{fmtEuro(inv.amount_ht)}</td>
                      <td className="px-4 py-3 text-right text-xs text-gray-400">{inv.tva_rate} %</td>
                      <td className="px-4 py-3 text-right text-sm text-gray-600">{fmtEuro(inv.amount_ttc)}</td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => deleteInvoice(inv.id)}
                          className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-red-50 text-gray-300 hover:text-red-400 transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-900 text-white">
                  <td colSpan={3} className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-gray-400">Total</td>
                  <td className="px-4 py-2.5 text-right font-bold">{fmtEuro(invoices.reduce((s, i) => s + i.amount_ht, 0))}</td>
                  <td className="px-4 py-2.5"></td>
                  <td className="px-4 py-2.5 text-right font-bold text-orange-300">{fmtEuro(invoices.reduce((s, i) => s + i.amount_ttc, 0))}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>

      {/* ── Modal : Connecter une intégration ── */}
      {showConnect && connectProvider && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm" onClick={() => setShowConnect(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl ${connectProvider.color} flex items-center justify-center text-white text-xs font-extrabold`}>
                  {connectProvider.logo}
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900">Connecter {connectProvider.name}</h2>
                  <p className="text-xs text-gray-400">{connectProvider.description}</p>
                </div>
              </div>
              <button onClick={() => setShowConnect(false)} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">{connectProvider.tokenLabel} *</label>
                <Input
                  value={connectToken}
                  onChange={e => setConnectToken(e.target.value)}
                  placeholder={connectProvider.tokenPlaceholder}
                  type="password"
                  autoFocus
                />
              </div>
              {connectProvider.needsCompanyId && (
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">{connectProvider.companyIdLabel} *</label>
                  <Input
                    value={connectCompanyId}
                    onChange={e => setConnectCompanyId(e.target.value)}
                    placeholder="Identifiant de votre entreprise"
                  />
                </div>
              )}
              <p className="text-[10px] text-gray-400">
                Votre token est chiffré et stocké de manière sécurisée.{' '}
                <a href={connectProvider.helpUrl} target="_blank" rel="noreferrer" className="text-[#1E3A5F] underline">
                  Comment trouver mon token ?
                </a>
              </p>
              {connectError && (
                <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />{connectError}
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setShowConnect(false)}>Annuler</Button>
                <Button
                  className="flex-1 bg-[#1E3A5F] hover:bg-[#2a4f7c] text-white"
                  onClick={connectIntegration}
                  disabled={!connectToken || connecting || (connectProvider.needsCompanyId && !connectCompanyId)}
                >
                  {connecting
                    ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Test en cours...</>
                    : <><Link2 className="w-4 h-4 mr-1.5" />Connecter</>}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal : Ajouter facture ── */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm" onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-gray-900">Nouvelle facture</h2>
              <button onClick={() => setShowAdd(false)} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Fournisseur *</label>
                  <Input value={newInvoice.supplier_name} onChange={e => setNewInvoice((p: any) => ({ ...p, supplier_name: e.target.value }))} placeholder="Maison Dupont Boucherie" autoFocus />
                </div>
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
                        newInvoice.category === cat.key ? 'border-[#1E3A5F] bg-[#1E3A5F] text-white' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Montant HT *</label>
                  <Input type="number" step="0.01" min="0" value={newInvoice.amount_ht} onChange={e => setNewInvoice((p: any) => ({ ...p, amount_ht: e.target.value }))} placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Taux TVA (%)</label>
                  <select
                    value={newInvoice.tva_rate}
                    onChange={e => setNewInvoice((p: any) => ({ ...p, tva_rate: e.target.value }))}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-[#1E3A5F]"
                  >
                    {TVA_RATES.map(r => <option key={r} value={r}>{r === 0 ? '0 % (exonéré)' : `${r} %`}</option>)}
                  </select>
                </div>
              </div>
              {newInvoice.amount_ht && (
                <div className="bg-gray-50 rounded-lg px-3 py-2 flex items-center justify-between">
                  <span className="text-xs text-gray-500">Montant TTC calculé</span>
                  <span className="font-bold text-gray-900">{fmtEuro(ttcAmount)}</span>
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Notes</label>
                <Input value={newInvoice.notes} onChange={e => setNewInvoice((p: any) => ({ ...p, notes: e.target.value }))} placeholder="Livraison lundi matin..." />
              </div>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setShowAdd(false)}>Annuler</Button>
                <Button
                  className="flex-1 bg-[#1E3A5F] hover:bg-[#2a4f7c] text-white"
                  onClick={addInvoice}
                  disabled={!newInvoice.supplier_name || !newInvoice.invoice_date || !newInvoice.amount_ht || saving}
                >
                  {saving ? 'Enregistrement...' : 'Enregistrer'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal : Saisir le CA ── */}
      {showCA && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm" onClick={() => setShowCA(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-base font-bold text-gray-900">CA de la semaine {week}</h2>
                <p className="text-xs text-gray-400 mt-0.5">{fmtDate(mon)} – {fmtDate(sun)}</p>
              </div>
              <button onClick={() => setShowCA(false)} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">CA Total (€)</label>
                <Input type="number" step="0.01" min="0" value={caForm.ca_total}
                  onChange={e => setCaForm(p => ({ ...p, ca_total: e.target.value }))}
                  placeholder="0.00" className="text-lg font-bold" autoFocus
                />
              </div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider pt-1">Détail par rayon (optionnel)</p>
              {[
                { key: 'ca_boucherie',   label: 'Boucherie' },
                { key: 'ca_charcuterie', label: 'Charcuterie' },
                { key: 'ca_traiteur',    label: 'Traiteur' },
                { key: 'ca_vente',       label: 'Vente / Épicerie' },
              ].map(({ key, label }) => (
                <div key={key} className="flex items-center gap-2">
                  <label className="text-xs text-gray-500 w-28 flex-shrink-0">{label}</label>
                  <Input type="number" step="0.01" min="0"
                    value={(caForm as any)[key]}
                    onChange={e => setCaForm(p => ({ ...p, [key]: e.target.value }))}
                    placeholder="0.00"
                  />
                </div>
              ))}
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowCA(false)}>Annuler</Button>
                <Button className="flex-1 bg-[#1E3A5F] hover:bg-[#2a4f7c] text-white" onClick={saveCA} disabled={saving}>
                  <Check className="w-4 h-4 mr-1.5" />{saving ? 'Enregistrement...' : 'Enregistrer'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal : Paramètres entreprise ── */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm" onClick={() => setShowSettings(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-gray-900">Paramètres entreprise</h2>
              <button onClick={() => setShowSettings(false)} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X className="w-4 h-4 text-gray-500" />
              </button>
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
                <Button className="flex-1 bg-[#1E3A5F] hover:bg-[#2a4f7c] text-white" onClick={saveSettings} disabled={saving}>
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
