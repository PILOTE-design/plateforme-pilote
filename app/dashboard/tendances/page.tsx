import { createClient, createServiceClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { TrendingUp, TrendingDown, LineChart, Euro, Ticket, ShoppingBasket } from 'lucide-react'
import Link from 'next/link'

const fmt  = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })
const fmt2 = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function resolveClientId(
  serviceSupabase: ReturnType<typeof createServiceClient>,
  userId: string,
  userEmail?: string | null
) {
  const { data: byId } = await serviceSupabase
    .from('clients').select('id').eq('client_user_id', userId).maybeSingle()
  if (byId) return byId.id as string
  if (!userEmail) return null
  const { data: byEmail } = await serviceSupabase
    .from('clients').select('id').eq('email', userEmail).maybeSingle()
  if (!byEmail) return null
  await serviceSupabase.from('clients').update({ client_user_id: userId }).eq('id', byEmail.id)
  return byEmail.id as string
}

type WeekKey = string // "2026-27"
const keyOf = (year: number, week: number): WeekKey => `${year}-${String(week).padStart(2, '0')}`
const labelOf = (k: WeekKey) => `S${parseInt(k.split('-')[1])}`

export default async function TendancesPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const serviceSupabase = createServiceClient()
  const clientId = await resolveClientId(serviceSupabase, user!.id, user?.email)

  let weekKeys: WeekKey[] = []
  const byProduct = new Map<string, Map<WeekKey, number>>()
  type CaRow = { key: WeekKey; ca: number; tickets: number | null; panier: number | null; familles: { nom: string; montant: number }[] }
  let caRows: CaRow[] = []

  if (clientId) {
    const [{ data: prodRows }, { data: caData }] = await Promise.all([
      serviceSupabase
        .from('weekly_sales_products')
        .select('product, amount, week_number, year')
        .eq('client_id', clientId)
        .order('year', { ascending: false }).order('week_number', { ascending: false })
        .limit(8000),
      serviceSupabase
        .from('weekly_ca')
        .select('week_number, year, ca_total, nb_tickets, moyenne_ticket, families_detail')
        .eq('client_id', clientId)
        .order('year', { ascending: false }).order('week_number', { ascending: false })
        .limit(16),
    ])

    const allKeys = new Set<WeekKey>()
    for (const r of prodRows || []) allKeys.add(keyOf(r.year, r.week_number))
    weekKeys = [...allKeys].sort().slice(-8) // 8 dernieres semaines chronologiques
    const keep = new Set(weekKeys)

    for (const r of prodRows || []) {
      const k = keyOf(r.year, r.week_number)
      if (!keep.has(k)) continue
      const name = String(r.product)
      if (!byProduct.has(name)) byProduct.set(name, new Map())
      byProduct.get(name)!.set(k, parseFloat(String(r.amount || 0)))
    }

    caRows = (caData || [])
      .map((r: any) => ({
        key: keyOf(r.year, r.week_number),
        ca: parseFloat(String(r.ca_total || 0)),
        tickets: r.nb_tickets != null ? Number(r.nb_tickets) : null,
        panier: r.moyenne_ticket != null ? parseFloat(String(r.moyenne_ticket)) : null,
        familles: Array.isArray(r.families_detail) ? r.families_detail : [],
      }))
      .filter(r => keep.has(r.key))
      .sort((a, b) => a.key.localeCompare(b.key))
  }

  const lastKey = weekKeys[weekKeys.length - 1]
  const prevKey = weekKeys[weekKeys.length - 2]

  // Ecarts produit derniere semaine vs precedente
  const deltas: { name: string; last: number; delta: number }[] = []
  if (lastKey && prevKey) {
    for (const [name, series] of byProduct.entries()) {
      const last = series.get(lastKey) ?? 0
      const prev = series.get(prevKey) ?? 0
      if (last === 0 && prev === 0) continue
      deltas.push({ name, last, delta: last - prev })
    }
  }
  const hausses = deltas.filter(d => d.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 8)
  const baisses = deltas.filter(d => d.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 8)

  // Tableau : produits tries par CA de la derniere semaine
  const products = [...byProduct.entries()]
    .map(([name, series]) => ({ name, series, last: lastKey ? (series.get(lastKey) ?? 0) : 0 }))
    .sort((a, b) => b.last - a.last)
    .slice(0, 40)

  // Tendance familles (depuis weekly_ca.families_detail)
  const famSeries = new Map<string, Map<WeekKey, number>>()
  for (const row of caRows) {
    for (const f of row.familles) {
      if (!famSeries.has(f.nom)) famSeries.set(f.nom, new Map())
      famSeries.get(f.nom)!.set(row.key, Number(f.montant) || 0)
    }
  }
  const familles = [...famSeries.entries()]
    .map(([name, series]) => ({
      name, series,
      last: lastKey ? (series.get(lastKey) ?? 0) : 0,
      delta: lastKey && prevKey ? (series.get(lastKey) ?? 0) - (series.get(prevKey) ?? 0) : 0,
    }))
    .sort((a, b) => b.last - a.last)

  const lastCa = caRows[caRows.length - 1]
  const prevCa = caRows[caRows.length - 2]

  const hasData = weekKeys.length >= 1
  const hasComparison = weekKeys.length >= 2

  function Spark({ series }: { series: Map<WeekKey, number> }) {
    const vals = weekKeys.map(k => series.get(k) ?? 0)
    const max = Math.max(...vals, 1)
    return (
      <div className="flex items-end gap-0.5 h-6">
        {vals.map((v, i) => (
          <div key={i} title={`${labelOf(weekKeys[i])} : ${fmt2(v)} €`}
            className={`w-1.5 rounded-sm ${i === vals.length - 1 ? 'bg-[#1E3A5F]' : 'bg-gray-200'}`}
            style={{ height: `${Math.max(8, (v / max) * 100)}%` }} />
        ))}
      </div>
    )
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <LineChart className="w-6 h-6 text-[#1E3A5F]" />Tendances produits
        </h1>
        <p className="text-gray-500 mt-1">
          Évolution semaine par semaine, alimentée automatiquement par vos rapports hebdomadaires
          {lastKey && <span className="ml-2 text-xs bg-blue-50 text-[#1E3A5F] px-2 py-0.5 rounded-full font-semibold">{weekKeys.length} semaine{weekKeys.length > 1 ? 's' : ''} · dernière : {labelOf(lastKey)}</span>}
        </p>
      </div>

      {!hasData ? (
        <Card>
          <CardContent className="py-16 text-center">
            <LineChart className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-500 mb-1">Pas encore d'historique produits</p>
            <p className="text-xs text-gray-400 mb-4">Chaque rapport hebdomadaire généré archive automatiquement le CA de chaque produit.<br />Dès 2 semaines de rapports, les tendances apparaîtront ici.</p>
            <Link href="/dashboard/reports" className="text-sm text-[#1E3A5F] font-semibold hover:underline">Mes rapports →</Link>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPIs d'evolution */}
          {lastCa && (
            <div className="grid grid-cols-3 gap-4 mb-6">
              {[
                { icon: Euro, label: 'CA', val: `${fmt(lastCa.ca)} €`, prev: prevCa ? lastCa.ca - prevCa.ca : null, isEuro: true },
                { icon: Ticket, label: 'Tickets', val: lastCa.tickets != null ? String(lastCa.tickets) : '—', prev: prevCa?.tickets != null && lastCa.tickets != null ? lastCa.tickets - prevCa.tickets : null, isEuro: false },
                { icon: ShoppingBasket, label: 'Panier moyen', val: lastCa.panier != null ? `${fmt2(lastCa.panier)} €` : '—', prev: prevCa?.panier != null && lastCa.panier != null ? lastCa.panier - prevCa.panier : null, isEuro: true },
              ].map((kpi, i) => (
                <Card key={i}>
                  <CardContent className="p-5">
                    <div className="flex items-center gap-1.5 mb-1">
                      <kpi.icon className="w-3.5 h-3.5 text-gray-400" />
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{kpi.label} — {labelOf(lastKey)}</p>
                    </div>
                    <p className="text-2xl font-bold text-gray-900">{kpi.val}</p>
                    {kpi.prev !== null && prevKey && (
                      <p className={`text-xs font-semibold mt-0.5 ${kpi.prev >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {kpi.prev >= 0 ? '+' : ''}{kpi.isEuro ? `${fmt2(kpi.prev)} €` : fmt(kpi.prev)} vs {labelOf(prevKey)}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Top hausses / baisses */}
          {hasComparison && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="w-4 h-4 text-green-600" />Ce qui monte</CardTitle>
                  <CardDescription>{labelOf(lastKey)} vs {labelOf(prevKey)}</CardDescription>
                </CardHeader>
                <CardContent>
                  {hausses.length === 0 ? <p className="text-sm text-gray-400 text-center py-4">Aucune hausse détectée</p> : (
                    <div className="space-y-2">
                      {hausses.map(h => (
                        <div key={h.name} className="flex items-center justify-between text-sm">
                          <span className="text-gray-700 truncate mr-2">{h.name}</span>
                          <span className="font-bold text-green-600 whitespace-nowrap">+{fmt(h.delta)} €</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2"><TrendingDown className="w-4 h-4 text-red-500" />Ce qui décroche</CardTitle>
                  <CardDescription>{labelOf(lastKey)} vs {labelOf(prevKey)}</CardDescription>
                </CardHeader>
                <CardContent>
                  {baisses.length === 0 ? <p className="text-sm text-gray-400 text-center py-4">Aucune baisse détectée</p> : (
                    <div className="space-y-2">
                      {baisses.map(b => (
                        <div key={b.name} className="flex items-center justify-between text-sm">
                          <span className="text-gray-700 truncate mr-2">{b.name}</span>
                          <span className="font-bold text-red-500 whitespace-nowrap">{fmt(b.delta)} €</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Familles */}
          {familles.length > 0 && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="text-base">Tendance par famille</CardTitle>
                <CardDescription>CA hebdomadaire des {weekKeys.length} dernières semaines archivées</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {familles.slice(0, 10).map(f => (
                    <div key={f.name} className="flex items-center gap-4">
                      <span className="text-sm text-gray-700 w-44 truncate flex-shrink-0">{f.name}</span>
                      <Spark series={f.series} />
                      <span className="text-sm font-semibold text-gray-900 ml-auto whitespace-nowrap">{fmt(f.last)} €</span>
                      {hasComparison && (
                        <span className={`text-xs font-semibold w-20 text-right ${f.delta >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                          {f.delta >= 0 ? '+' : ''}{fmt(f.delta)} €
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tableau produits */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tous les produits</CardTitle>
              <CardDescription>Top 40 par CA de la semaine {lastKey ? labelOf(lastKey) : ''} · mini-graphe = {weekKeys.length} semaines</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {products.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">Aucun produit archivé pour l'instant</p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                      <th className="px-4 py-2.5 text-left">Produit</th>
                      <th className="px-4 py-2.5 text-center">Évolution</th>
                      <th className="px-4 py-2.5 text-right">CA {lastKey ? labelOf(lastKey) : ''}</th>
                      {hasComparison && <th className="px-4 py-2.5 text-right">vs {labelOf(prevKey)}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p, i) => {
                      const prev = prevKey ? (p.series.get(prevKey) ?? 0) : 0
                      const delta = p.last - prev
                      return (
                        <tr key={p.name} className={`border-t border-gray-50 hover:bg-gray-50 transition-colors ${i % 2 === 1 ? 'bg-gray-50/40' : ''}`}>
                          <td className="px-4 py-2 text-sm font-medium text-gray-900">{p.name}</td>
                          <td className="px-4 py-2"><div className="flex justify-center"><Spark series={p.series} /></div></td>
                          <td className="px-4 py-2 text-right text-sm font-semibold text-gray-900">{fmt2(p.last)} €</td>
                          {hasComparison && (
                            <td className={`px-4 py-2 text-right text-xs font-bold ${delta >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                              {delta >= 0 ? '+' : ''}{fmt(delta)} €
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
