import { createClient, createServiceClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FileText, TrendingUp, TrendingDown, Users, Receipt, Euro, AlertTriangle, CalendarDays, Calculator, ArrowRight, Repeat, CheckCircle2, Circle } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import Link from 'next/link'
import { DonutChart } from './DashboardChart'

// ─── Helpers dates ────────────────────────────────────────────────────────

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

function getWeekDates(week: number, year: number): Date[] {
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const dow = jan4.getUTCDay() || 7
  const mon = new Date(jan4)
  mon.setUTCDate(jan4.getUTCDate() - dow + 1 + (week - 1) * 7)
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setUTCDate(mon.getUTCDate() + i); return d })
}

function weekPeriodLabel(week: number, year: number): string {
  const d = getWeekDates(week, year)
  const f = (x: Date) => x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `${f(d[0])} – ${f(d[6])}`
}

function getEaster(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(year, month - 1, day))
}

function frenchHolidays(year: number): Set<string> {
  const easter = getEaster(year)
  const add = (d: Date, n: number) => { const r = new Date(d); r.setUTCDate(d.getUTCDate() + n); return r }
  const fmtD = (d: Date) => d.toISOString().slice(0, 10)
  return new Set([
    fmtD(new Date(Date.UTC(year, 0, 1))), fmtD(add(easter, 1)), fmtD(new Date(Date.UTC(year, 4, 1))),
    fmtD(new Date(Date.UTC(year, 4, 8))), fmtD(add(easter, 39)), fmtD(add(easter, 50)),
    fmtD(new Date(Date.UTC(year, 6, 14))), fmtD(new Date(Date.UTC(year, 7, 15))), fmtD(new Date(Date.UTC(year, 10, 1))),
    fmtD(new Date(Date.UTC(year, 10, 11))), fmtD(new Date(Date.UTC(year, 11, 25))),
  ])
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

const fmt  = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })
const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']

type EmpRow = {
  id: string; name: string; hourly_rate: string; contract_type: string; contract_hours: number
  charges_patronales: string | null; is_minor: boolean | null; contract_end_date: string | null
}
type PlanRow = Record<string, string> & { employee_id: string }

/** Masse salariale CHARGÉE d'une semaine — même moteur que la page planning :
 *  HS calculées sur les heures travaillées (CP exclus), CP payés à ch/5,
 *  majorations CCN dimanche +20 % / férié +100 %, charges patronales par employé. */
function computeWeekPayroll(entries: PlanRow[], emps: EmpRow[], week: number, year: number): number {
  const empMap = new Map(emps.map(e => [e.id, e]))
  const dates = getWeekDates(week, year)
  const hol = frenchHolidays(year)
  const holidayFlags = dates.map(d => hol.has(d.toISOString().slice(0, 10)))
  let total = 0
  for (const entry of entries) {
    const emp = empMap.get(entry.employee_id)
    if (!emp) continue
    const ch = emp.contract_hours || 35
    const rate = parseFloat(emp.hourly_rate || '0')
    let workedH = 0, cpDays = 0, sundayH = 0, holidayH = 0
    JOURS.forEach((j, idx) => {
      const t = entry[`${j}_type`] || 'travail'
      const h = parseFloat(entry[j] || '0')
      if (t === 'travail' && h > 0) {
        workedH += h
        if (holidayFlags[idx]) holidayH += h
        else if (idx === 6) sundayH += h
      } else if (t === 'conges') cpDays++
    })
    const cpH = cpDays * ch / 5
    const t2 = ch + 8
    let brut = 0
    if (workedH <= ch) brut = workedH * rate
    else if (workedH <= t2) brut = ch * rate + (workedH - ch) * rate * 1.25
    else brut = ch * rate + (t2 - ch) * rate * 1.25 + (workedH - t2) * rate * 1.5
    brut += cpH * rate + sundayH * rate * 0.20 + holidayH * rate * 1.00
    const chargesPct = parseFloat(String(emp.charges_patronales ?? '45'))
    total += brut * (1 + chargesPct / 100)
  }
  return total
}

/** Alertes légales de la semaine (mêmes seuils que la page planning) */
function computeLegalAlerts(entries: PlanRow[], emps: EmpRow[]): string[] {
  const empMap = new Map(emps.map(e => [e.id, e]))
  const alerts: string[] = []
  for (const entry of entries) {
    const emp = empMap.get(entry.employee_id)
    if (!emp) continue
    const maxDay = emp.is_minor ? 8 : 10
    const maxWeek = emp.is_minor ? 35 : 48
    let workedH = 0, workedDays = 0, overDay = false
    for (const j of JOURS) {
      const t = entry[`${j}_type`] || 'travail'
      const h = parseFloat(entry[j] || '0')
      if (t === 'travail' && h > 0) {
        workedH += h; workedDays++
        if (h > maxDay) overDay = true
      }
    }
    if (overDay) alerts.push(`${emp.name} : journée > ${maxDay}h${emp.is_minor ? ' (mineur)' : ''}`)
    if (workedH > maxWeek) alerts.push(`${emp.name} : ${workedH.toFixed(1)}h travaillées — max légal ${maxWeek}h`)
    if (workedDays === 7) alerts.push(`${emp.name} : 7 jours travaillés — repos hebdomadaire obligatoire`)
  }
  return alerts
}

export default async function DashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles').select('*').eq('user_id', user!.id).maybeSingle()

  const serviceSupabase = createServiceClient()
  const clientId = await resolveClientId(serviceSupabase, user!.id, user?.email)

  const now = new Date()
  const { week: currentWeek, year: currentYear } = getISOWeek(now)
  const lastWeekRef = new Date(now); lastWeekRef.setDate(lastWeekRef.getDate() - 7)
  const { week: lastWeek, year: lastWeekYear } = getISOWeek(lastWeekRef)

  // Semaine de référence = SEMAINE ÉCOULÉE (le lundi, le gérant pilote la semaine qui vient de finir)
  let refWeek = lastWeek
  let refYear = lastWeekYear
  let refIsFallback = false

  type FamilyRow = { nom: string; montant: number }
  let familiesDetail: FamilyRow[] = []
  let ca_total = 0
  let achatsVariables = 0
  let chargesFixesSem = 0
  let payrollRef = 0
  let caTrend: { week: number; year: number; ca: number }[] = []
  let legalAlerts: string[] = []
  let cddAlerts: string[] = []
  let reports: Array<{ id: string; title: string; file_url: string; created_at: string }> = []
  let hasIntegration = false
  let anyPlanning = false
  let employeeCount = 0

  if (clientId) {
    // ── CA de la semaine écoulée (fallback : dernier CA connu) ──
    const { data: caRow } = await serviceSupabase
      .from('weekly_ca').select('week_number, year, ca_total, families_detail')
      .eq('client_id', clientId).eq('week_number', refWeek).eq('year', refYear)
      .maybeSingle()

    let caData = caRow
    if (!caData) {
      const { data: latestCa } = await serviceSupabase
        .from('weekly_ca').select('week_number, year, ca_total, families_detail')
        .eq('client_id', clientId)
        .order('year', { ascending: false }).order('week_number', { ascending: false })
        .limit(1).maybeSingle()
      if (latestCa) { caData = latestCa; refWeek = latestCa.week_number; refYear = latestCa.year; refIsFallback = true }
    }
    if (caData) {
      ca_total = parseFloat(String(caData.ca_total || 0))
      familiesDetail = Array.isArray(caData.families_detail) ? (caData.families_detail as FamilyRow[]) : []
    }

    // ── Achats de la semaine de référence : variables + charges fixes en prorata hebdo ──
    const { data: invoices } = await serviceSupabase
      .from('invoices').select('amount_ht, is_fixed_charge, prorata_ht')
      .eq('client_id', clientId).eq('week_number', refWeek).eq('year', refYear)
    for (const inv of invoices || []) {
      if (inv.is_fixed_charge) chargesFixesSem += parseFloat(String(inv.prorata_ht || 0))
      else achatsVariables += parseFloat(String(inv.amount_ht || 0))
    }

    // ── Intégration comptable connectée ? (checklist de démarrage) ──
    const { data: integ } = await serviceSupabase
      .from('billing_integrations').select('id').eq('client_id', clientId).eq('is_active', true).limit(1)
    hasIntegration = (integ || []).length > 0

    // ── Employés + plannings (semaine de référence pour la masse salariale, semaine courante pour les alertes) ──
    const { data: emps } = await serviceSupabase
      .from('employees')
      .select('id, name, hourly_rate, contract_type, contract_hours, charges_patronales, is_minor, contract_end_date')
      .eq('client_id', clientId)
    const employees = (emps || []) as EmpRow[]
    employeeCount = employees.length

    if (employees.length > 0) {
      const empIds = employees.map(e => e.id)
      const cols = 'employee_id,lundi,mardi,mercredi,jeudi,vendredi,samedi,dimanche,' +
        'lundi_type,mardi_type,mercredi_type,jeudi_type,vendredi_type,samedi_type,dimanche_type'

      const [{ data: refPlanning }, { data: curPlanning }, { data: anyPlan }] = await Promise.all([
        serviceSupabase.from('planning_entries').select(cols).in('employee_id', empIds).eq('week_number', refWeek).eq('year', refYear),
        serviceSupabase.from('planning_entries').select(cols).in('employee_id', empIds).eq('week_number', currentWeek).eq('year', currentYear),
        serviceSupabase.from('planning_entries').select('id').in('employee_id', empIds).limit(1),
      ])

      payrollRef  = computeWeekPayroll((refPlanning || []) as PlanRow[], employees, refWeek, refYear)
      legalAlerts = computeLegalAlerts((curPlanning || []) as PlanRow[], employees)
      anyPlanning = (anyPlan || []).length > 0

      // Fins de CDD dans les 45 jours
      for (const emp of employees) {
        if (!emp.contract_end_date) continue
        const days = Math.ceil((new Date(emp.contract_end_date).getTime() - Date.now()) / 86400000)
        if (days >= 0 && days <= 45) {
          cddAlerts.push(`${emp.name} : fin de CDD le ${new Date(emp.contract_end_date).toLocaleDateString('fr-FR')} (${days} j)`)
        }
      }
    }

    // ── Tendance CA — 8 dernières semaines saisies ──
    const { data: trendRows } = await serviceSupabase
      .from('weekly_ca').select('week_number, year, ca_total')
      .eq('client_id', clientId)
      .order('year', { ascending: false }).order('week_number', { ascending: false })
      .limit(8)
    caTrend = (trendRows || [])
      .map(r => ({ week: r.week_number as number, year: r.year as number, ca: parseFloat(String(r.ca_total || 0)) }))
      .reverse()

    const { data: reps } = await serviceSupabase
      .from('reports').select('id, title, file_url, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(3)
    reports = reps || []
  }

  // ── Agrégats ──
  const achatsTotal   = achatsVariables + chargesFixesSem
  const marge_brute   = ca_total > 0 ? ca_total - achatsTotal : 0
  const taux_marge    = ca_total > 0 ? (marge_brute / ca_total) * 100 : null
  const resultat      = ca_total > 0 ? ca_total - achatsTotal - payrollRef : null
  const ratioMS       = ca_total > 0 && payrollRef > 0 ? (payrollRef / ca_total) * 100 : null

  const margeColor =
    taux_marge === null ? 'text-gray-400'
    : taux_marge >= 40 ? 'text-green-600'
    : taux_marge >= 30 ? 'text-orange-500'
    : 'text-red-600'

  // Donut familles : top 4 + Autres
  const sorted = [...familiesDetail].sort((a, b) => b.montant - a.montant)
  const top4 = sorted.slice(0, 4)
  const autresTotal = sorted.slice(4).reduce((s, f) => s + f.montant, 0)
  const FAMILY_COLORS = ['#dc2626', '#f97316', '#22c55e', '#3b82f6']
  const segments = [
    ...top4.map((f, i) => ({ label: f.nom, value: f.montant, color: FAMILY_COLORS[i] })),
    ...(autresTotal > 0 ? [{ label: 'Autres', value: autresTotal, color: '#9ca3af' }] : []),
  ]
  const segTotal = segments.reduce((s, seg) => s + seg.value, 0) || ca_total

  // Tendance
  const maxTrend = caTrend.length > 0 ? Math.max(...caTrend.map(t => t.ca), 1) : 1
  const trendEvol = caTrend.length >= 2 && caTrend[caTrend.length - 2].ca > 0
    ? ((caTrend[caTrend.length - 1].ca - caTrend[caTrend.length - 2].ca) / caTrend[caTrend.length - 2].ca) * 100
    : null

  const attention: { color: string; text: string }[] = [
    ...legalAlerts.map(t => ({ color: 'bg-red-500', text: `Planning S${currentWeek} — ${t}` })),
    ...cddAlerts.map(t => ({ color: 'bg-amber-500', text: t })),
    ...(ratioMS !== null && ratioMS > 40 ? [{ color: 'bg-amber-500', text: `Masse salariale à ${ratioMS.toFixed(0)} % du CA (cible < 35 %)` }] : []),
  ]

  // ── Checklist de démarrage (onboarding nouveau client) ──
  const onboardingSteps = [
    { done: hasIntegration,      label: 'Connecter votre logiciel comptable (Pennylane...)', desc: 'Vos factures s’importeront automatiquement chaque lundi', href: '/dashboard/facturation' },
    { done: employeeCount > 0,   label: 'Ajouter vos employés',                              desc: 'Contrats, taux horaires et charges patronales',            href: '/dashboard/planning' },
    { done: anyPlanning,         label: 'Remplir votre premier planning',                    desc: 'Coûts CCN, heures sup et alertes légales calculés',       href: '/dashboard/planning' },
    { done: caTrend.length > 0,  label: 'Saisir votre CA hebdomadaire',                      desc: 'Débloque la marge, le résultat et le rapport automatique', href: '/dashboard/facturation' },
  ]
  const stepsDone = onboardingSteps.filter(s => s.done).length
  const showOnboarding = clientId !== null && stepsDone < onboardingSteps.length

  const weekLabel = `S${refWeek}`
  const hasAnyData = ca_total > 0 || achatsTotal > 0 || payrollRef > 0 || reports.length > 0

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* ── En-tête ── */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Bonjour, {profile?.business_name || 'bienvenue'} 👋
          </h1>
          <p className="text-gray-500 mt-1">
            Pilotage de la semaine écoulée — <span className="font-semibold text-gray-700">S{refWeek} · {weekPeriodLabel(refWeek, refYear)} {refYear}</span>
            {refIsFallback && <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">dernières données disponibles</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {[
            { href: '/dashboard/planning',     icon: CalendarDays, label: 'Planning' },
            { href: '/dashboard/facturation',  icon: Receipt,      label: 'Facturation' },
            { href: '/dashboard/valorisation', icon: Calculator,   label: 'Valorisation' },
          ].map(l => (
            <Link key={l.href} href={l.href}
              className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-2 hover:border-[#1E3A5F] hover:text-[#1E3A5F] transition-colors">
              <l.icon className="w-3.5 h-3.5" />{l.label}
            </Link>
          ))}
        </div>
      </div>

      {/* ── Checklist de démarrage ── */}
      {showOnboarding && (
        <div className="mb-6 bg-white rounded-xl border border-[#1E3A5F]/20 shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-[#1E3A5F] flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-white">Bien démarrer avec PILOTE</h2>
              <p className="text-[11px] text-blue-200">Encore {onboardingSteps.length - stepsDone} étape{onboardingSteps.length - stepsDone > 1 ? 's' : ''} pour un pilotage 100 % automatique</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-24 h-1.5 bg-white/20 rounded-full overflow-hidden">
                <div className="h-full bg-[#FF8C00] rounded-full" style={{ width: `${(stepsDone / onboardingSteps.length) * 100}%` }} />
              </div>
              <span className="text-xs font-bold text-white">{stepsDone}/{onboardingSteps.length}</span>
            </div>
          </div>
          <div className="divide-y divide-gray-50">
            {onboardingSteps.map((step, i) => (
              <Link key={i} href={step.href} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors group">
                {step.done
                  ? <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                  : <Circle className="w-5 h-5 text-gray-300 flex-shrink-0" />}
                <div className="flex-1">
                  <p className={`text-sm font-medium ${step.done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{step.label}</p>
                  {!step.done && <p className="text-xs text-gray-400">{step.desc}</p>}
                </div>
                {!step.done && <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-[#1E3A5F] transition-colors" />}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Points d'attention ── */}
      {attention.length > 0 && (
        <div className="mb-6 bg-white rounded-xl border border-red-100 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <h2 className="text-sm font-bold text-gray-900">Points d'attention</h2>
            <span className="text-[10px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">{attention.length}</span>
          </div>
          <div className="space-y-1.5">
            {attention.slice(0, 6).map((a, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${a.color}`} />
                <p className="text-xs text-gray-600">{a.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {!hasAnyData ? (
        <Card className="mb-8">
          <CardContent className="py-14 text-center">
            <TrendingUp className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-500 mb-1">Aucune donnée pour l'instant</p>
            <p className="text-xs text-gray-400 mb-4">Synchronisez vos factures, remplissez le planning ou générez votre premier rapport pour activer le tableau de bord.</p>
            <div className="flex items-center justify-center gap-3">
              <Link href="/dashboard/facturation" className="text-sm text-[#1E3A5F] font-semibold hover:underline">Facturation →</Link>
              <Link href="/dashboard/planning" className="text-sm text-[#1E3A5F] font-semibold hover:underline">Planning →</Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ── KPIs semaine écoulée ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-1.5 mb-1">
                  <Euro className="w-3.5 h-3.5 text-blue-500" />
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">CA — {weekLabel}</p>
                </div>
                <p className="text-2xl font-bold text-gray-900">{ca_total > 0 ? `${fmt(ca_total)} €` : '—'}</p>
                {ca_total === 0 && <p className="text-xs text-gray-400 mt-0.5">Saisir le CA ou générer le rapport</p>}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-1.5 mb-1">
                  <Receipt className="w-3.5 h-3.5 text-orange-500" />
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Achats HT — {weekLabel}</p>
                </div>
                <p className="text-2xl font-bold text-gray-900">{achatsTotal > 0 ? `${fmt(achatsTotal)} €` : '—'}</p>
                {chargesFixesSem > 0 && (
                  <p className="text-xs text-purple-600 mt-0.5 flex items-center gap-1"><Repeat className="w-3 h-3" />dont fixes ≈ {fmt(chargesFixesSem)} €/sem</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-1.5 mb-1">
                  <Users className="w-3.5 h-3.5 text-violet-500" />
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Masse salariale — {weekLabel}</p>
                </div>
                <p className="text-2xl font-bold text-gray-900">{payrollRef > 0 ? `${fmt(payrollRef)} €` : '—'}</p>
                <p className="text-xs text-gray-400 mt-0.5">{payrollRef > 0 ? (ratioMS !== null ? `${ratioMS.toFixed(0)} % du CA · chargée (CCN 992)` : 'chargée (CCN 992)') : 'Remplir le planning'}</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-1.5 mb-1">
                  {taux_marge !== null && taux_marge < 30 ? <TrendingDown className="w-3.5 h-3.5 text-red-500" /> : <TrendingUp className="w-3.5 h-3.5 text-green-600" />}
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Marge brute — {weekLabel}</p>
                </div>
                <p className={`text-2xl font-bold ${margeColor}`}>{taux_marge !== null ? `${taux_marge.toFixed(1)} %` : '—'}</p>
                {taux_marge !== null && <p className="text-xs text-gray-400 mt-0.5">{fmt(marge_brute)} € · CA − achats (fixes inclus)</p>}
              </CardContent>
            </Card>
          </div>

          {/* ── Résultat estimé ── */}
          {resultat !== null && (
            <div className={`mb-8 rounded-xl border p-4 flex items-center justify-between ${
              resultat >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
            }`}>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Résultat estimé — semaine {refWeek}</p>
                <p className="text-3xl font-extrabold mt-0.5 text-gray-900">{fmt(resultat)} €</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  CA {fmt(ca_total)} € − Achats {fmt(achatsTotal)} € (dont fixes {fmt(chargesFixesSem)} €) − Masse salariale chargée {fmt(payrollRef)} €
                </p>
              </div>
              <div className={`text-5xl font-black ${resultat >= 0 ? 'text-green-300' : 'text-red-200'}`}>{resultat >= 0 ? '+' : '−'}</div>
            </div>
          )}

          {/* ── Tendance CA ── */}
          {caTrend.length >= 2 && (
            <Card className="mb-8">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">Tendance du CA</CardTitle>
                  <CardDescription>{caTrend.length} dernières semaines saisies</CardDescription>
                </div>
                {trendEvol !== null && (
                  <span className={`text-sm font-bold px-2.5 py-1 rounded-full ${
                    trendEvol >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>{trendEvol >= 0 ? '+' : ''}{trendEvol.toFixed(1)} % vs sem. préc.</span>
                )}
              </CardHeader>
              <CardContent>
                <div className="flex items-end gap-2 h-32">
                  {caTrend.map((t, i) => {
                    const isLast = i === caTrend.length - 1
                    return (
                      <div key={`${t.year}-${t.week}`} className="flex-1 flex flex-col items-center gap-1" title={`S${t.week} ${t.year} : ${fmt(t.ca)} €`}>
                        <span className="text-[10px] font-semibold text-gray-500">{fmt(t.ca / 1000 >= 1 ? Math.round(t.ca / 100) / 10 : t.ca)}{t.ca >= 1000 ? ' k€' : ' €'}</span>
                        <div className="w-full flex items-end" style={{ height: '80px' }}>
                          <div
                            className={`w-full rounded-t-md transition-all ${isLast ? 'bg-[#1E3A5F]' : 'bg-gray-200'}`}
                            style={{ height: `${Math.max(6, (t.ca / maxTrend) * 100)}%` }}
                          />
                        </div>
                        <span className={`text-[10px] ${isLast ? 'font-bold text-[#1E3A5F]' : 'text-gray-400'}`}>S{t.week}</span>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Donut + top familles ── */}
          {segments.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Répartition CA par famille</CardTitle>
                  <CardDescription>Top 4 + Autres · {weekLabel}</CardDescription>
                </CardHeader>
                <CardContent>
                  <DonutChart segments={segments} total={segTotal} centerTotal={ca_total} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Top familles</CardTitle>
                  <CardDescription>Chiffre d&apos;affaires TTC · {weekLabel}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {segments.map((seg) => {
                      const pct = segTotal > 0 ? (seg.value / segTotal) * 100 : 0
                      return (
                        <div key={seg.label}>
                          <div className="flex justify-between text-sm mb-1.5">
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: seg.color }} />
                              <span className="text-gray-700">{seg.label}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="font-semibold text-gray-900">{fmt(seg.value)} €</span>
                              <span className="text-gray-400 w-9 text-right">{Math.round(pct)} %</span>
                            </div>
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: seg.color }} />
                          </div>
                        </div>
                      )
                    })}
                    <div className="pt-3 mt-3 border-t border-gray-100 flex justify-between text-sm">
                      <span className="text-gray-500">Marge brute estimée</span>
                      <span className={`font-semibold ${margeColor}`}>
                        {fmt(marge_brute)} €{taux_marge !== null ? ` (${taux_marge.toFixed(1)} %)` : ''}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}

      {/* ── Derniers rapports ── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Derniers rapports</CardTitle>
            <CardDescription>Rapport complet publié chaque semaine · flash automatique le lundi matin</CardDescription>
          </div>
          <Link href="/dashboard/reports" className="text-sm text-[#1E3A5F] font-medium hover:underline flex items-center gap-1">
            Voir tout <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </CardHeader>
        <CardContent>
          {reports.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-500 mb-1">Aucun rapport pour l'instant</p>
              <p className="text-xs text-gray-400">Votre premier rapport hebdomadaire apparaîtra ici</p>
            </div>
          ) : (
            <div className="space-y-3">
              {reports.map((report) => (
                <div
                  key={report.id}
                  className="flex items-center justify-between p-4 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-[#1E3A5F]" />
                    <div>
                      <p className="font-medium text-gray-900">{report.title}</p>
                      <p className="text-xs text-gray-400">{formatDate(report.created_at)}</p>
                    </div>
                  </div>
                  <a
                    href={report.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-[#1E3A5F] font-medium hover:underline"
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
