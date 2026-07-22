import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { TrendingUp, TrendingDown, LineChart, Euro, Ticket, ShoppingBasket } from 'lucide-react'
import Link from 'next/link'
import ProduitsParFamille from './ProduitsParFamille'

const fmt  = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })
const fmt2 = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type WeekKey = string // "2026-27"
const keyOf = (year: number, week: number): WeekKey => `${year}-${String(week).padStart(2, '0')}`
const labelOf = (k: WeekKey) => `S${parseInt(k.split('-')[1])}`

// Palette camembert — famille navy/orange PILOTE + dérivés
const PIE = ['#1E3A5F', '#FF8C00', '#2a4f7c', '#4a7ab5', '#ffb454', '#7d92ad', '#c5d2e2', '#9aa8bd']

export default async function TendancesPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const serviceSupabase = createServiceClient()
  const clientId = await resolveClientId(serviceSupabase, user!.id, user?.email)

  // Tendances = ANNÉE EN COURS pour la courbe. Les semaines N-1 servent uniquement à la
  // comparaison année précédente (KPIs), pas à la courbe de tendance.
  const currentYear = new Date().getFullYear()

  let weekKeys: WeekKey[] = []
  const byProduct = new Map<string, Map<WeekKey, number>>()
  const familleOf = new Map<string, string | null>()
  type CaRow = { key: WeekKey; ca: number; tickets: number | null; panier: number | null; familles: { nom: string; montant: number }[] }
  let caRows: CaRow[] = []

  if (clientId) {
    const [{ data: prodRows }, { data: caData }] = await Promise.all([
      serviceSupabase
        .from('weekly_sales_products')
        .select('product, amount, week_number, year, famille')
        .eq('client_id', clientId)
        .eq('year', currentYear)
        .order('year', { ascending: false }).order('week_number', { ascending: false })
        .limit(8000),
      serviceSupabase
        .from('weekly_ca')
        .select('week_number, year, ca_total, nb_tickets, moyenne_ticket, families_detail')
        .eq('client_id', clientId)
        .eq('year', currentYear)
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
      // rows triées desc → 1re occurrence = famille la plus récente
      if (r.famille && !familleOf.get(name)) familleOf.set(name, String(r.famille))
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

  // Comparaison année précédente : même semaine, année N-1 (données archivées par les rapports)
  let n1Ca: { ca: number; tickets: number | null; panier: number | null } | null = null
  if (clientId && lastKey) {
    const [ly, lw] = lastKey.split('-').map(Number)
    const { data: n1 } = await serviceSupabase
      .from('weekly_ca')
      .select('ca_total, nb_tickets, moyenne_ticket')
      .eq('client_id', clientId).eq('week_number', lw).eq('year', ly - 1)
      .maybeSingle()
    if (n1) n1Ca = {
      ca: parseFloat(String(n1.ca_total || 0)),
      tickets: n1.nb_tickets != null ? Number(n1.nb_tickets) : null,
      panier: n1.moyenne_ticket != null ? parseFloat(String(n1.moyenne_ticket)) : null,
    }
  }

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
  const hausses = deltas.filter(d => d.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 5)
  const baisses = deltas.filter(d => d.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 5)

  // Données pour le composant produits/familles (tous les produits, avec famille + série)
  const clientProducts = [...byProduct.entries()]
    .map(([name, series]) => {
      const vals = weekKeys.map(k => series.get(k) ?? 0)
      const last = lastKey ? (series.get(lastKey) ?? 0) : 0
      const prev = prevKey ? (series.get(prevKey) ?? 0) : 0
      return { name, famille: familleOf.get(name) ?? null, vals, last, prevDelta: last - prev }
    })
    .filter(p => p.vals.some(v => v > 0))

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

  // Camembert : répartition du CA de la dernière semaine par famille (top 7 + Autres)
  const donutRaw = (lastCa?.familles ?? [])
    .map(f => ({ nom: String(f.nom), montant: Number(f.montant) || 0 }))
    .filter(f => f.montant > 0)
    .sort((a, b) => b.montant - a.montant)
  let donut = donutRaw
  if (donutRaw.length > 7) {
    const rest = donutRaw.slice(7).reduce((s, d) => s + d.montant, 0)
    donut = [...donutRaw.slice(0, 7), { nom: 'Autres', montant: rest }]
  }
  const donutTotal = donut.reduce((s, d) => s + d.montant, 0)

  const hasData = weekKeys.length >= 1
  const hasComparison = weekKeys.length >= 2

  function Spark({ series }: { series: Map<WeekKey, number> }) {
    const vals = weekKeys.map(k => series.get(k) ?? 0)
    const max = Math.max(...vals, 1)
    return (
      <div className="flex items-end gap-0.5 h-6">
        {vals.map((v, i) => (
          <div key={i} title={`${labelOf(weekKeys[i])} : ${fmt2(v)} €`}
            className={`w-1.5 rounded-sm ${i === vals.length - 1 ? 'bg-pilote' : 'bg-pilote-100'}`}
            style={{ height: `${Math.max(8, (v / max) * 100)}%` }} />
        ))}
      </div>
    )
  }

  // Camembert SVG (donut) — segments via stroke-dasharray, sans dépendance
  function Donut() {
    const R = 54, SW = 22, C = 2 * Math.PI * R
    let offset = 0
    return (
      <svg viewBox="0 0 140 140" className="w-36 h-36 flex-shrink-0">
        <g transform="rotate(-90 70 70)">
          <circle cx="70" cy="70" r={R} fill="none" stroke="#f1f5f9" strokeWidth={SW} />
          {donut.map((d, i) => {
            const frac = donutTotal > 0 ? d.montant / donutTotal : 0
            const len = frac * C
            const seg = (
              <circle key={i} cx="70" cy="70" r={R} fill="none"
                stroke={PIE[i % PIE.length]} strokeWidth={SW}
                strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} />
            )
            offset += len
            return seg
          })}
        </g>
      </svg>
    )
  }

  function pctChange(last: number | null, base: number | null | undefined): number | null {
    if (last == null || base == null || base <= 0) return null
    return ((last - base) / base) * 100
  }
  function Cmp({ pct, label }: { pct: number | null; label: string }) {
    if (pct === null) return <p className="text-[11px] text-gray-300 tabular">— vs {label}</p>
    const up = pct >= 0
    return (
      <p className={`text-[11px] font-semibold tabular ${up ? 'text-green-600' : 'text-red-500'}`}>
        {up ? '▲' : '▼'} {up ? '+' : ''}{pct.toFixed(1)} % vs {label}
      </p>
    )
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      <div className="mb-8 flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-pilote-50 flex items-center justify-center flex-shrink-0 mt-0.5">
          <LineChart className="w-5 h-5 text-pilote" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Tendances produits</h1>
          <p className="text-sm text-gray-500 mt-1">
            Évolution semaine par semaine sur {currentYear}, alimentée automatiquement par vos rapports hebdomadaires
            {lastKey && <span className="ml-2 text-xs bg-pilote-50 text-pilote px-2 py-0.5 rounded-full font-semibold tabular">{weekKeys.length} semaine{weekKeys.length > 1 ? 's' : ''} · dernière : {labelOf(lastKey)}</span>}
          </p>
        </div>
      </div>

      {!hasData ? (
        <Card>
          <CardContent className="py-16 text-center">
            <LineChart className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-500 mb-1">Pas encore d'historique produits</p>
            <p className="text-xs text-gray-400 mb-4 max-w-sm mx-auto">Chaque rapport hebdomadaire généré archive automatiquement le CA de chaque produit.<br />Dès 2 semaines de rapports, les tendances apparaîtront ici.</p>
            <Link href="/dashboard/reports" className="text-sm text-pilote font-semibold hover:underline">Mes rapports →</Link>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPIs d'evolution — vs semaine précédente ET vs année précédente (N-1) */}
          {lastCa && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              {[
                { icon: Euro, label: 'CA', val: `${fmt(lastCa.ca)} €`, last: lastCa.ca, s1: prevCa?.ca ?? null, n1: n1Ca?.ca ?? null },
                { icon: Ticket, label: 'Tickets', val: lastCa.tickets != null ? String(lastCa.tickets) : '—', last: lastCa.tickets, s1: prevCa?.tickets ?? null, n1: n1Ca?.tickets ?? null },
                { icon: ShoppingBasket, label: 'Panier moyen', val: lastCa.panier != null ? `${fmt2(lastCa.panier)} €` : '—', last: lastCa.panier, s1: prevCa?.panier ?? null, n1: n1Ca?.panier ?? null },
              ].map((kpi, i) => (
                <Card key={i} className="hover:shadow-card-hover transition-shadow">
                  <CardContent className="p-5">
                    <div className="flex items-center gap-2 mb-2.5">
                      <div className="w-6 h-6 rounded-md bg-pilote-50 flex items-center justify-center flex-shrink-0">
                        <kpi.icon className="w-3.5 h-3.5 text-pilote" />
                      </div>
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{kpi.label} · {labelOf(lastKey)}</p>
                    </div>
                    <p className="text-2xl font-bold tracking-tight text-gray-900 tabular">{kpi.val}</p>
                    <div className="mt-1.5 space-y-0.5">
                      <Cmp pct={pctChange(kpi.last, kpi.s1)} label={prevKey ? labelOf(prevKey) : 'S-1'} />
                      <Cmp pct={pctChange(kpi.last, kpi.n1)} label="N-1" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Top hausses / baisses — 5 produits chacun */}
          {hasComparison && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="w-4 h-4 text-green-600" />Ce qui monte</CardTitle>
                  <CardDescription>Top 5 · {labelOf(lastKey)} vs {labelOf(prevKey)}</CardDescription>
                </CardHeader>
                <CardContent>
                  {hausses.length === 0 ? <p className="text-sm text-gray-400 text-center py-4">Aucune hausse détectée</p> : (
                    <div className="space-y-2.5">
                      {hausses.map(h => (
                        <div key={h.name} className="flex items-center justify-between text-sm">
                          <span className="text-gray-700 truncate mr-2">{h.name}</span>
                          <span className="font-bold text-green-600 whitespace-nowrap tabular">+{fmt(h.delta)} €</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2"><TrendingDown className="w-4 h-4 text-red-500" />Ce qui décroche</CardTitle>
                  <CardDescription>Top 5 · {labelOf(lastKey)} vs {labelOf(prevKey)}</CardDescription>
                </CardHeader>
                <CardContent>
                  {baisses.length === 0 ? <p className="text-sm text-gray-400 text-center py-4">Aucune baisse détectée</p> : (
                    <div className="space-y-2.5">
                      {baisses.map(b => (
                        <div key={b.name} className="flex items-center justify-between text-sm">
                          <span className="text-gray-700 truncate mr-2">{b.name}</span>
                          <span className="font-bold text-red-500 whitespace-nowrap tabular">{fmt(b.delta)} €</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Répartition & tendance par famille */}
          {familles.length > 0 && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="text-base">Répartition & tendance par famille</CardTitle>
                <CardDescription>Camembert : part de CA de {lastKey ? labelOf(lastKey) : ''} · barres : {weekKeys.length} dernières semaines</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col md:flex-row gap-6">
                  {donutTotal > 0 && (
                    <div className="flex items-center gap-4 md:w-1/2">
                      <Donut />
                      <div className="flex-1 space-y-1.5">
                        {donut.map((d, i) => (
                          <div key={d.nom} className="flex items-center gap-2 text-xs">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: PIE[i % PIE.length] }} />
                            <span className="text-gray-700 truncate flex-1">{d.nom}</span>
                            <span className="font-semibold text-gray-900 tabular">{donutTotal > 0 ? Math.round((d.montant / donutTotal) * 100) : 0} %</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="md:flex-1 space-y-3">
                    {familles.slice(0, 8).map(f => (
                      <div key={f.name} className="flex items-center gap-3">
                        <span className="text-sm text-gray-700 w-32 truncate flex-shrink-0">{f.name}</span>
                        <Spark series={f.series} />
                        <span className="text-sm font-semibold text-gray-900 ml-auto whitespace-nowrap tabular">{fmt(f.last)} €</span>
                        {hasComparison && (
                          <span className={`text-xs font-semibold w-16 text-right tabular ${f.delta >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                            {f.delta >= 0 ? '+' : ''}{fmt(f.delta)} €
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Produits par famille + 20/80 (composant interactif) */}
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <ProduitsParFamille
                products={clientProducts}
                lastLabel={lastKey ? labelOf(lastKey) : ''}
                prevLabel={prevKey ? labelOf(prevKey) : ''}
                hasComparison={hasComparison}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
