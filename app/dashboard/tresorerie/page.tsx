'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Landmark, Plus, RefreshCw, Loader2, Search, X, CheckCircle, AlertTriangle, ArrowUpRight, ArrowDownRight, ExternalLink } from 'lucide-react'

interface Account { id: string; name: string | null; iban: string | null; currency: string; balance: number | null; balance_at: string | null }
interface Connection { id: string; institution_name: string | null; status: string; agreement_expires_at: string | null; created_at: string }
interface Tx { id: string; account_id: string; booking_date: string | null; amount: number; currency: string; description: string | null; counterparty: string | null; category: string | null; status: string }
interface Institution { id: string; name: string; bic?: string; logo?: string }

function eur(n: number) { return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }) }
function fdate(s: string | null) { return s ? new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '—' }

export default function TresoreriePage() {
  const params = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [configured, setConfigured] = useState(true)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [transactions, setTransactions] = useState<Tx[]>([])
  const [syncing, setSyncing] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [instLoading, setInstLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/bank/data')
      const j = await res.json()
      setConfigured(j.configured !== false)
      setAccounts(j.accounts || [])
      setConnections(j.connections || [])
      setTransactions(j.transactions || [])
    } catch {
      setBanner({ kind: 'err', msg: 'Erreur de chargement des données bancaires.' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    if (params.get('connected')) setBanner({ kind: 'ok', msg: 'Banque connectée — comptes et opérations importés.' })
    const err = params.get('error')
    if (err) setBanner({ kind: 'err', msg: err === 'refus' ? 'Connexion annulée côté banque.' : 'La connexion bancaire a échoué. Réessayez.' })
  }, [params])

  const totalBalance = useMemo(() => accounts.reduce((s, a) => s + (a.balance || 0), 0), [accounts])
  const in30 = useMemo(() => {
    const cut = Date.now() - 30 * 86400000
    return transactions.filter(t => t.booking_date && new Date(t.booking_date).getTime() >= cut)
  }, [transactions])
  const encaisse30 = useMemo(() => in30.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0), [in30])
  const depense30 = useMemo(() => in30.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0), [in30])

  async function openPicker() {
    setShowPicker(true)
    if (institutions.length > 0) return
    setInstLoading(true)
    try {
      const res = await fetch('/api/bank/institutions')
      const j = await res.json()
      setConfigured(j.configured !== false)
      setInstitutions(j.institutions || [])
    } catch {
      setBanner({ kind: 'err', msg: 'Impossible de charger la liste des banques.' })
    } finally {
      setInstLoading(false)
    }
  }

  async function connect(inst: Institution) {
    setConnectingId(inst.id)
    try {
      const res = await fetch('/api/bank/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ institution_id: inst.id, institution_name: inst.name }),
      })
      const j = await res.json()
      if (!res.ok || !j.link) { setBanner({ kind: 'err', msg: j.error || 'Connexion impossible.' }); setConnectingId(null); return }
      window.location.href = j.link
    } catch {
      setBanner({ kind: 'err', msg: 'Connexion impossible.' })
      setConnectingId(null)
    }
  }

  async function sync() {
    setSyncing(true)
    try {
      const res = await fetch('/api/bank/sync', { method: 'POST' })
      const j = await res.json()
      if (!res.ok) setBanner({ kind: 'err', msg: j.error || 'Synchronisation impossible.' })
      else { setBanner({ kind: 'ok', msg: `Mis à jour · ${j.transactions ?? 0} opérations.` }); await loadData() }
    } catch {
      setBanner({ kind: 'err', msg: 'Synchronisation impossible.' })
    } finally {
      setSyncing(false)
    }
  }

  const filtered = institutions.filter(i => i.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-pilote-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <Landmark className="w-5 h-5 text-pilote" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Trésorerie</h1>
            <p className="text-sm text-gray-500">Comptes bancaires connectés · soldes et opérations en temps réel</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {accounts.length > 0 && (
            <button onClick={sync} disabled={syncing}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors">
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}Actualiser
            </button>
          )}
          {configured && (
            <button onClick={openPicker}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-pilote hover:bg-pilote-hover shadow-card transition-colors">
              <Plus className="w-4 h-4" />Connecter une banque
            </button>
          )}
        </div>
      </div>

      {banner && (
        <div className={`mb-4 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm border ${
          banner.kind === 'ok' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {banner.kind === 'ok' ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
          {banner.msg}
          <button onClick={() => setBanner(null)} className="ml-auto text-xs font-semibold underline hover:no-underline">OK</button>
        </div>
      )}

      {/* Setup requis (clés API absentes) */}
      {!configured && !loading && (
        <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-card">
          <h2 className="text-sm font-bold text-gray-900 mb-1">Connexion bancaire à activer</h2>
          <p className="text-sm text-gray-600 mb-4">
            La trésorerie s'appuie sur l'agrégateur <strong>GoCardless Bank Account Data</strong> (gratuit, lecture seule).
            Attention : ce n'est <strong>pas</strong> l'offre du site gocardless.com (paiements, payante). Il faut le produit dédié :
          </p>
          <ol className="space-y-3 text-sm text-gray-700">
            <li className="flex gap-3">
              <span className="w-5 h-5 flex-shrink-0 rounded-full bg-pilote text-white text-xs font-bold flex items-center justify-center">1</span>
              <span>
                Créer un compte gratuit sur{' '}
                <a href="https://bankaccountdata.gocardless.com/" target="_blank" rel="noopener noreferrer"
                  className="text-pilote font-semibold underline inline-flex items-center gap-0.5">
                  bankaccountdata.gocardless.com <ExternalLink className="w-3 h-3" />
                </a>
              </span>
            </li>
            <li className="flex gap-3">
              <span className="w-5 h-5 flex-shrink-0 rounded-full bg-pilote text-white text-xs font-bold flex items-center justify-center">2</span>
              <span>Dans le tableau de bord → <strong>Developers → User Secrets</strong>, générer un <strong>Secret ID</strong> et un <strong>Secret Key</strong>.</span>
            </li>
            <li className="flex gap-3">
              <span className="w-5 h-5 flex-shrink-0 rounded-full bg-pilote text-white text-xs font-bold flex items-center justify-center">3</span>
              <span>Ajouter ces deux valeurs dans les variables d'environnement Vercel :
                <code className="mx-1 px-1.5 py-0.5 bg-gray-100 rounded text-xs">GOCARDLESS_SECRET_ID</code> et
                <code className="mx-1 px-1.5 py-0.5 bg-gray-100 rounded text-xs">GOCARDLESS_SECRET_KEY</code>, puis redéployer.</span>
            </li>
          </ol>
          <p className="text-xs text-gray-400 mt-4">Une fois les clés en place, le bouton « Connecter une banque » apparaît ici. Aucun compte GoCardless n'est requis côté boucher.</p>
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-16 shadow-card flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-gray-300 animate-spin" />
        </div>
      ) : configured && (
        <>
          {/* KPIs */}
          {accounts.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
              <div className="bg-pilote rounded-2xl p-4 shadow-card text-white">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-pilote-200 mb-0.5">Solde total</p>
                <p className="text-2xl font-extrabold">{eur(totalBalance)}</p>
                <p className="text-xs text-pilote-200">{accounts.length} compte{accounts.length > 1 ? 's' : ''}</p>
              </div>
              <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-card">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">Encaissé 30 j</p>
                <p className="text-2xl font-bold text-green-600">{eur(encaisse30)}</p>
              </div>
              <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-card">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">Dépensé 30 j</p>
                <p className="text-2xl font-bold text-red-500">{eur(depense30)}</p>
              </div>
            </div>
          )}

          {/* Comptes */}
          {accounts.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              {accounts.map(a => (
                <div key={a.id} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-card">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-gray-800 text-sm">{a.name || 'Compte'}</p>
                      <p className="text-xs text-gray-400">{a.iban ? a.iban.replace(/(.{4})/g, '$1 ').trim() : '—'}</p>
                    </div>
                    <p className="text-lg font-bold text-gray-900">{a.balance !== null ? eur(a.balance) : '—'}</p>
                  </div>
                  {a.balance_at && <p className="text-[10px] text-gray-400 mt-1">à jour le {new Date(a.balance_at).toLocaleDateString('fr-FR')}</p>}
                </div>
              ))}
            </div>
          )}

          {/* Consentements à renouveler */}
          {connections.some(c => c.status === 'linked') && (
            <p className="text-[11px] text-gray-400 mb-4">
              Rappel DSP2 : le consentement bancaire est à renouveler tous les 90 jours (reconnecter la banque).
            </p>
          )}

          {/* Opérations */}
          {accounts.length > 0 ? (
            <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-card">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-900">Dernières opérations</h2>
              </div>
              {transactions.length === 0 ? (
                <p className="px-5 py-8 text-sm text-gray-400 text-center">Aucune opération importée pour l'instant.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {transactions.slice(0, 100).map(t => (
                        <tr key={t.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="px-5 py-2.5 text-gray-400 whitespace-nowrap w-16">{fdate(t.booking_date)}</td>
                          <td className="px-3 py-2.5">
                            <span className="font-medium text-gray-800">{t.counterparty || t.description || 'Opération'}</span>
                            {t.counterparty && t.description && <span className="text-gray-400 ml-2 text-xs">{t.description}</span>}
                            {t.status === 'pending' && <span className="ml-2 text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">en attente</span>}
                          </td>
                          <td className={`px-5 py-2.5 text-right font-semibold tabular-nums whitespace-nowrap ${t.amount < 0 ? 'text-gray-800' : 'text-green-600'}`}>
                            <span className="inline-flex items-center gap-1 justify-end">
                              {t.amount < 0 ? <ArrowDownRight className="w-3.5 h-3.5 text-gray-300" /> : <ArrowUpRight className="w-3.5 h-3.5 text-green-400" />}
                              {eur(t.amount)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white border border-gray-100 rounded-2xl p-16 shadow-card flex flex-col items-center justify-center text-center">
              <Landmark className="w-12 h-12 text-gray-200 mb-4" />
              <p className="text-gray-600 font-medium">Aucune banque connectée</p>
              <p className="text-sm text-gray-400 mt-1 mb-4">Connectez un compte pour suivre votre trésorerie automatiquement</p>
              <button onClick={openPicker} className="px-4 py-2 bg-pilote text-white rounded-xl text-sm font-semibold hover:bg-pilote-hover transition-colors">
                Connecter une banque
              </button>
            </div>
          )}
        </>
      )}

      {/* Sélecteur de banque */}
      {showPicker && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm p-4" onClick={() => setShowPicker(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="font-bold text-gray-900">Choisir votre banque</h2>
              <button onClick={() => setShowPicker(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="p-4 border-b border-gray-100">
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher une banque..."
                  className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200" />
              </div>
            </div>
            <div className="overflow-y-auto p-2">
              {instLoading ? (
                <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 text-gray-300 animate-spin" /></div>
              ) : filtered.length === 0 ? (
                <p className="py-10 text-center text-sm text-gray-400">Aucune banque trouvée.</p>
              ) : filtered.map(inst => (
                <button key={inst.id} onClick={() => connect(inst)} disabled={connectingId !== null}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors text-left disabled:opacity-50">
                  {inst.logo
                    ? <img src={inst.logo} alt="" className="w-7 h-7 rounded object-contain flex-shrink-0" />
                    : <span className="w-7 h-7 rounded bg-gray-100 flex items-center justify-center flex-shrink-0"><Landmark className="w-4 h-4 text-gray-400" /></span>}
                  <span className="flex-1 text-sm font-medium text-gray-800">{inst.name}</span>
                  {connectingId === inst.id && <Loader2 className="w-4 h-4 text-pilote animate-spin" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
