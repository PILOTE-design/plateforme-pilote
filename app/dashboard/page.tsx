import { createClient, createServiceClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FileText, TrendingUp, Users, Receipt } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import Link from 'next/link'
import { DonutChart } from './DashboardChart'

// ─── ISO week helper ──────────────────────────────────────────────────────────
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

// ─── Page ─────────────────────────────────────────────────────────────────────
export default async function DashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles').select('*').eq('user_id', user!.id).single()

  const serviceSupabase = createServiceClient()
  const clientId = await resolveClientId(serviceSupabase, user!.id, user?.email)
  const { week, year } = getISOWeek(new Date())

  // ── Données de la semaine ──────────────────────────────────────────────────
  let caData: Record<string, number> | null = null
  let achats_ht = 0
  let masse_salariale = 0

  if (clientId) {
    // 1. CA par famille
    const { data: ca } = await serviceSupabase
      .from('weekly_ca').select('*')
      .eq('client_id', clientId).eq('week_number', week).eq('year', year)
      .maybeSingle()
    caData = ca

    // 2. Achats HT (factures)
    const { data: invoices } = await serviceSupabase
      .from('invoices').select('amount_ht')
      .eq('client_id', clientId).eq('week_number', week).eq('year', year)
    achats_ht = (invoices || []).reduce(
      (s: number, inv: { amount_ht: string | number }) => s + parseFloat(String(inv.amount_ht || 0)), 0
    )

    // 3. Masse salariale (CCN IDCC 992)
    const { data: planningData } = await serviceSupabase
      .from('planning_entries')
      .select(
        'lundi,mardi,mercredi,jeudi,vendredi,samedi,dimanche,' +
        'lundi_type,mardi_type,mercredi_type,jeudi_type,vendredi_type,samedi_type,dimanche_type,employee_id'
      )
      .eq('week_number', week).eq('year', year)

    if (planningData && planningData.length > 0) {
      const employeeIds = [...new Set(planningData.map((p: { employee_id: string }) => p.employee_id))]
      const { data: employees } = await serviceSupabase
        .from('employees').select('id,hourly_rate,contract_type,contract_hours')
        .in('id', employeeIds)

      const empMap: Record<string, { hourly_rate: string; contract_type: string; contract_hours: number }> = {}
      for (const emp of employees || []) empMap[emp.id] = emp

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

  const ca_total = parseFloat(String(caData?.ca_total || 0))
  const marge_brute = ca_total - achats_ht
  const taux_marge = ca_total > 0 ? (marge_brute / ca_total) * 100 : null

  const segments = [
    { label: 'Boucherie', value: parseFloat(String(caData?.ca_boucherie || 0)), color: '#dc2626' },
    { label: 'Charcuterie', value: parseFloat(String(caData?.ca_charcuterie || 0)), color: '#f97316' },
    { label: 'Traiteur', value: parseFloat(String(caData?.ca_traiteur || 0)), color: '#22c55e' },
    { label: 'Vente', value: parseFloat(String(caData?.ca_vente || 0)), color: '#3b82f6' },
  ]

  // Couleur du taux de marge
  const margeColor =
    taux_marge === null ? 'text-gray-400'
    : taux_marge >= 40 ? 'text-green-600'
    : taux_marge >= 30 ? 'text-orange-500'
    : 'text-red-600'

  // Derniers rapports
  const { data: reports } = await supabase
    .from('reports').select('*').eq('profile_id', profile?.id)
    .order('created_at', { ascending: false }).limit(3)

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          Bonjour, {profile?.business_name || 'bienvenue'} 👋
        </h1>
        <p className="text-gray-500 mt-1">Semaine {week} · {year}</p>
      </div>

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
            <CardDescription>Semaine {week} · {year}</CardDescription>
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
                Aucune donnée pour la semaine {week}
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

                {/* Résumé marge */}
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
          {!reports || reports.length === 0 ? (
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
