'use client'

// Mercuriale — le catalogue de prix d'achat du client, alimenté automatiquement
// par l'extraction ligne à ligne des factures (PDF Pennylane stocké → lignes
// produits → articles). C'est la fondation des fiches recettes : chaque
// ingrédient y trouvera son dernier prix connu, mis à jour à chaque facture.
//
// La lecture des factures se déclenche ICI (file d'attente, une facture à la
// fois — chaque extraction est un appel pdf-parse + IA de quelques secondes),
// pour ne pas alourdir la page Facturation.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ShoppingBasket, FileSearch, TrendingUp, TrendingDown, Search, RefreshCw } from 'lucide-react'
import { useToast } from '@/components/ui/toast'

type Article = {
  id: string
  name: string
  unit: string | null
  supplier_name: string | null
  article_code: string | null
  last_price_ht: number | string | null
  last_price_date: string | null
  price_count: number
  previous_price: number | null
  variation_pct: number | null
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

export default function MercurialePage() {
  const { toast } = useToast()
  const [articles, setArticles] = useState<Article[]>([])
  const [pending, setPending] = useState<PendingInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0, errors: 0 })
  const stopRef = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await fetch('/api/mercuriale', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null)
    if (data) {
      setArticles(Array.isArray(data.articles) ? data.articles : [])
      setPending(Array.isArray(data.pending) ? data.pending : [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  /** Lit les factures en attente UNE PAR UNE : chaque appel est une extraction
   *  complète (PDF → lignes → articles), on n'en met jamais deux en parallèle
   *  pour rester loin du budget serveur. Interruptible, reprend où elle en était. */
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
      ? { variant: 'success', title: detail.join(' · '), description: 'Seules les factures de matière première nourrissent la mercuriale.' }
      : { variant: 'error', title: detail.join(' · '), description: 'Les factures en échec peuvent être relancées.' })
    load()
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return articles
    return articles.filter(a =>
      a.name.toLowerCase().includes(q)
      || (a.supplier_name || '').toLowerCase().includes(q)
      || (a.article_code || '').toLowerCase().includes(q))
  }, [articles, search])

  const suppliers = useMemo(() => new Set(articles.map(a => a.supplier_name || '')).size, [articles])
  const hausses = useMemo(() => articles.filter(a => (a.variation_pct ?? 0) > 0).length, [articles])

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
            <p className="text-sm text-gray-500 mt-1">Vos prix d&apos;achat, article par article — mis à jour à chaque facture lue</p>
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
            Seule la matière première entre dans la mercuriale : les charges fixes sont déjà écartées, et une facture de
            matériel ou de service sera reconnue à la lecture et mise de côté.
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
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Articles suivis</p>
          <p className="text-2xl font-extrabold tracking-tight text-gray-900 tabular">{articles.length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Fournisseurs</p>
          <p className="text-2xl font-extrabold tracking-tight text-gray-900 tabular">{suppliers}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Prix en hausse</p>
          <p className={`text-2xl font-extrabold tracking-tight tabular ${hausses > 0 ? 'text-red-600' : 'text-gray-900'}`}>{hausses}</p>
        </div>
      </div>

      {/* Recherche */}
      <div className="relative mb-4">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un article, un fournisseur, un code…"
          className="w-full border border-gray-200 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200" />
      </div>

      {/* Tableau */}
      {loading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-gray-200 py-16 text-center">
          <ShoppingBasket className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-500 mb-1">{articles.length === 0 ? 'Aucun article pour l’instant' : 'Aucun article ne correspond à la recherche'}</p>
          {articles.length === 0 && (
            <p className="text-xs text-gray-400 max-w-md mx-auto">
              Synchronisez Pennylane depuis la page Facturation (les PDF des factures sont récupérés au passage),
              puis revenez ici et cliquez sur « Lire les factures » : chaque ligne d&apos;article viendra remplir la mercuriale.
            </p>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="bg-gray-50 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  <th className="px-4 py-2.5 text-left">Article</th>
                  <th className="px-4 py-2.5 text-left">Fournisseur</th>
                  <th className="px-4 py-2.5 text-left">Code</th>
                  <th className="px-4 py-2.5 text-right">Dernier prix HT</th>
                  <th className="px-4 py-2.5 text-left">Unité</th>
                  <th className="px-4 py-2.5 text-right">Au</th>
                  <th className="px-4 py-2.5 text-right">Variation</th>
                  <th className="px-4 py-2.5 text-right">Relevés</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => {
                  const price = a.last_price_ht !== null ? parseFloat(String(a.last_price_ht)) : null
                  const up = (a.variation_pct ?? 0) > 0
                  return (
                    <tr key={a.id} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-2.5 text-sm font-semibold text-gray-900">{a.name}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500">{a.supplier_name || '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-400 tabular">{a.article_code || '—'}</td>
                      <td className="px-4 py-2.5 text-right text-sm font-bold text-gray-900 tabular">{price !== null ? fmtEuro(price) : '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500">{a.unit ? `/ ${a.unit}` : '—'}</td>
                      <td className="px-4 py-2.5 text-right text-xs text-gray-500 tabular">{fmtDate(a.last_price_date)}</td>
                      <td className="px-4 py-2.5 text-right">
                        {a.variation_pct === null ? (
                          <span className="text-xs text-gray-300">—</span>
                        ) : (
                          <span className={`inline-flex items-center gap-1 text-xs font-bold tabular ${up ? 'text-red-600' : 'text-green-600'}`}>
                            {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                            {a.variation_pct > 0 ? '+' : ''}{a.variation_pct.toLocaleString('fr-FR')} %
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-gray-400 tabular">{a.price_count}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-[11px] text-gray-400 border-t border-gray-100 leading-snug">
            Pour un ingrédient acheté, une hausse est en rouge — c&apos;est un coût. La variation compare les deux derniers
            prix unitaires relevés sur vos factures ; « Relevés » compte les passages en facture de l&apos;article.
          </p>
        </div>
      )}
    </div>
  )
}
