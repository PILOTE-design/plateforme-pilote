import { createClient, createServiceClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FileText, TrendingUp, Users, Receipt } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import Link from 'next/link'
import { DonutChart } from './DashboardChart'

function getISOWeek(date: Date): { week: number; year: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return {
    week: Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7),
    year: d.getUTCFullYear(),
  }
}

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

const fmt = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })

export default async function DashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles').select('*').eq('user_id', user!.id).single()

  const serviceSupabase = createServiceClient()
  const clientId = await resolveClientId(serviceSupabase, user!.id, user?.email)
  const { week: currentWeek, year: currentYear } = getISOWeek(new Date())

  let caData: Record<string, number> | null = null
  let achats_ht = 0
  let masse_salariale = 0
  let reportWeek = currentWeek
  let reportYear = currentYear
  let lastReportTitle: string | null = null
  let reports: Array<{ id: string; title: string; file_url: string; created_at: string }> = []

  if (clientId) {
    // 1. Dernier rapport généré pour ce client
    const { data: lastReport } = await serviceSupabase
      .from('reports')
      .select('week_number, year, title')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (lastReport) {
      reportWeek = lastReport.week_number
      reportYear = lastReport.year
      lastReportTitle = lastReport.title
    }

    // 2. CA par famille — semaine du dernier rapport
    const { data: ca } = await serviceSupabase
      .from('weekly_ca').select('*')
      .eq('client_id', clientId)
      .eq('week_number', reportWeek)
      .eq('year', reportYear)
      .maybeSingle()
    caData = ca

    // 3. Achats HT (factures) — semaine courante
    const { data: invoices } = await serviceSupabase
      .from('invoices').select('amount_ht')
      .eq('client_id', clientId)
      .eq('week_number', currentWeek)
      .eq('year', currentYear)
    achats_ht = (invoices || []).reduce(
      (s: number, inv: { amount_ht: string | number }) => s + parseFloat(String(inv.amount_ht || 0)), 0
    )

    // 4. Masse salariale — employés du client, semaine courante
    const { data: clientEmployees } = await serviceSupabase
      .from('employees')
      .select('id, hourly_rate, contract_type, contract_hours')
      .eq('client_id', clientId)

    if (clientEmployees && clientEmployees.length > 0) {
      const empIds = clientEmployees.map((e: { id: string }) => e.id)
      const { data: planningData } = await serviceSupabase
        .from('planning_entries')
        .select(
          'lundi,mardi,mercredi,jeudi,vendredi,samedi,dimanche,' +
          'lundi_type,mardi_type,mercredi_type,jeudi_type,vendredi_type,samedi_type,dimanche_type,employee_id'
        )
        .in('employee_id', empIds)
        .eq('week_number', currentWeek)
        .eq('year', currentYear)

      if (planningData && planningData.length > 0) {
        const empMap: Record<string, { hourly_rate: string; contract_type: string; contract_hours: number }> = {}
        for (const emp of clientEmployees) empMap[emp.id] = emp

        const CONTRACT_HOURS: Record<string, number> = { CDI_35: 35, CDI_39: 39, CDD_35: 35, CDD_39: 39 }
        const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']

        for (const entry of planningData) {
          const emp = empMap[entry.employee_id]
          if (!emp) continue
          const ch = CONTRACT_HOURS[emp.contract_type] ?? emp.contract_hours ?? 35
          const rate = parseFloat(emp.hourly_rate || '0')
          const totalH = JOURS.reduce((s: number, j: string) => {
            const t: string = (entry as Record<string, string>)[`${j}_type`] || 'travail'
            const h = parseFloat((entry as Record<string, string>)[j] || '0')
            return s + (t === 'travail' ? h : t === 'conges' ? 7 : 0)
          }, 0)
          const t2 = ch + 8
          let cost = 0
          if (totalH <= ch) cost = totalH * rate
          else if (totalH <= t2) cost = ch * rate + (totalH - ch) * rate * 1.25
          else cost = ch * rate + (t2 - ch) * rate * 1.25 + (totalH - t2) * rate * 1.5
          masse_salariale += cost
        }
      }
    }

    // 5. Derniers rapports par client_id
    const { data: reps } = await serviceSupabase
      .from('reports').select('id, title, file_url, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(3)
    reports = reps || []
  }

  const ca_total = parseFloat(String(caData?.ca_total || 0))
  const marge_brute = ca_total - achats_ht
  const taux_marge = ca_total > 0 ? (marge_brute / ca_total) * 100 : null

  const segments = [
    { label: 'Boucherie', value: parseFloat(String(caData?.ca_boucherie || 0)), color: '#dc2626' },
    { label: 'Charcuterie', value: parseFloat(String(caData?.ca_charcuterie || 0)), color: '#f97316' },
    { label: 'Traiteur', value: parseFloat(String(caData?.ca_traiteur || 0)), color: '#22c55e' },
    { label: 'Vente', value: parseFloat(String(caData?.ca_vente || 0)), color: '#3b82f6' },
  ]

  const margeColor =
    taux_marge === null ? 'text-gray-400'
    : taux_marge >= 40 ? 'text-green-600'
    : taux_marge >= 30 ? 'text-orange-500'
    : 'text-red-600'

  const hasNoData = !clientId || (!caData && reports.length === 0)

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          Bonjour, {profile?.business_name || 'bienvenue'} 👋
        </h1>
        <p className="text-gray-500 mt-1">
          {lastReportTitle
            ? `Dernier rapport — Semaine ${reportWeek} · ${reportYear}`
            : `Semaine ${currentWeek} · ${currentYear}`
          }
        </p>
      </div>

      {hasNoData ? (
        <Card className="mb-8">
          <CardContent className="py-12 text-center">
            <TrendingUp className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">Aucun rapport généré pour ce compte</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <Card>
              <CardContent className="p-5">
                <p className="text-xs text-gray-500 mb-1">CA semaine</p>
                <p className="text-2xl font-bold text-gray-900">{fmt(ca_total)} €</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <p className="text-xs text-gray-500 mb-1">Marge brute</p>
                <p className={`text-2xl font-bold ${margeColor}`}>
                  {taux_marge !== null ? `${taux_marge.toFixed(1)} %` : '—'}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-1.5 mb-1">
                  <Users className="w-3.5 h-3.5 text-gray-400" />
                  <p className="text-xs text-gray-500">Coût employés</p>
                </div>
                <p className="text-2xl font-bold text-gray-900">{fmt(masse_salariale)} €</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-1.5 mb-1">
                  <Receipt className="w-3.5 h-3.5 text-gray-400" />
                  <p className="text-xs text-gray-500">Coût factures</p>
                </div>
                <p className="text-2xl font-bold text-gray-900">{fmt(achats_ht)} €</p>
              </CardContent>
            </Card>
          </div>

          {/* Graphique + détail */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Répartition CA par famille</CardTitle>
                <CardDescription>Semaine {reportWeek} · {reportYear}</CardDescription>
              </CardHeader>
              <CardContent>
                <DonutChart segments={segments} total={ca_total} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Détail par famille</CardTitle>
                <CardDescription>Chiffre d&apos;affaires HT</CardDescription>
              </CardHeader>
              <CardContent>
                {ca_total === 0 ? (
                  <p className="text-center text-sm text-gray-400 py-8">
                    Aucune donnée CA pour la semaine {reportWeek}
                  </p>
                ) : (
                  <div className="space-y-4">
                    {segments.map((seg) => {
                      const pct = ca_total > 0 ? (seg.value / ca_total) * 100 : 0
                      return (
                        <div key={seg.label}>
                          <div className="flex justify-between text-sm mb-1.5">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                style={{ backgroundColor: seg.color }}
                              />
                              <span className="text-gray-700">{seg.label}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="font-semibold text-gray-900">{fmt(seg.value)} €</span>
                              <span className="text-gray-400 w-9 text-right">{Math.round(pct)} %</span>
                            </div>
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${pct}%`, backgroundColor: seg.color }}
                            />
                          </div>
                        </div>
                      )
                    })}
                    <div className="pt-3 mt-3 border-t border-gray-100 flex justify-between text-sm">
                      <span className="text-gray-500">Marge brute estimée</span>
                      <span className={`font-semibold ${margeColor}`}>
                        {fmt(marge_brute)} € {taux_marge !== null ? `(${taux_marge.toFixed(1)} %)` : ''}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* Derniers rapports */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Derniers rapports</CardTitle>
            <CardDescription>Vos analyses comparatives récentes</CardDescription>
          </div>
          <Link href="/dashboard/reports" className="text-sm text-blue-600 hover:underline">
            Voir tout
          </Link>
        </CardHeader>
        <CardContent>
          {reports.length === 0 ? (
            <div className="text-center py-12">
              <TrendingUp className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">Votre premier rapport arrivera la semaine prochaine</p>
            </div>
          ) : (
            <div className="space-y-3">
              {reports.map((report) => (
                <div
                  key={report.id}
                  className="flex items-center justify-between p-4 rounded-lg border border-gray-100 hover:bg-gray-50"
                >
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-blue-600" />
                    <div>
                      <p className="font-medium text-gray-900">{report.title}</p>
                      <p className="text-xs text-gray-400">{formatDate(report.created_at)}</p>
                    </div>
                  </div>
                  <a
                    href={report.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline"
                  >
                    Télécharger
                  </a>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
