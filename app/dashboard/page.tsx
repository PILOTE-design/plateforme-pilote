import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import {
  computeLegalAlerts, getWeekDates,
  PAYROLL_EMPLOYEE_COLUMNS, PAYROLL_ENTRY_COLUMNS,
  type PayrollEmployee, type PayrollEntry,
} from '@/lib/payroll'
import { computeWeekEconomics, type WeekEconomics } from '@/lib/week-economics'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FileText, TrendingUp, TrendingDown, Users, Receipt, Euro, AlertTriangle, CalendarDays, Calculator, ArrowRight, Repeat, CheckCircle2, Circle } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { societeKey, sameSupplierFamily } from '@/lib/supplier-memory'
import Link from 'next/link'
import { DonutChart } from './DashboardChart'

// ─── Helpers dates ──────────────────────────────────

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

// getWeekDates, jours fériés et alertes légales viennent de lib/payroll ; achats,
// masse salariale, charges récurrentes et marges viennent de lib/week-economics —
// le MÊME moteur que la page Facturation, la page Marges et le rapport PDF.
// Cette page n'a plus aucun calcul économique à elle : elle en avait un, et il
// divergeait (factures « à vérifier » comptées, charges récurrentes ignorées,
// charges fixes soustraites de la marge brute), si bien que l'accueil et la
// facturation annonçaient deux taux différents pour la même semaine.

function weekPeriodLabel(week: number, year: number): string {
  const d = getWeekDates(week, year)
  const f = (x: Date) => x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `${f(d[0])} – ${f(d[6])}`
}

const fmt  = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })

type EmpRow = PayrollEmployee & { contract_end_date: string | null }

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
  let ca_ttc = 0
  let caByRayonSaisi: Record<string, number> = {}
  let eco: WeekEconomics | null = null
  let caTrend: { week: number; year: number; ca: number }[] = []
  let legalAlerts: string[] = []
  let cddAlerts: string[] = []
  let reports: Array<{ id: string; title: string; file_url: string; created_at: string }> = []
  let hasIntegration = false
  let anyPlanning = false
  let employeeCount = 0
  let aVerifierCount = 0
  let fournisseursNonVentiles = 0

  if (clientId) {
    // ── CA de la semaine écoulée (fallback : dernier CA connu) ──
    const CA_COLS = 'week_number, year, ca_total, families_detail, ca_boucherie, ca_charcuterie, ca_traiteur'
    const { data: caRow } = await serviceSupabase
      .from('weekly_ca').select(CA_COLS)
      .eq('client_id', clientId).eq('week_number', refWeek).eq('year', refYear)
      .maybeSingle()

    let caData = caRow
    if (!caData) {
      const { data: latestCa } = await serviceSupabase
        .from('weekly_ca').select(CA_COLS)
        .eq('client_id', clientId)
        .order('year', { ascending: false }).order('week_number', { ascending: false })
        .limit(1).maybeSingle()
      if (latestCa) { caData = latestCa; refWeek = latestCa.week_number; refYear = latestCa.year; refIsFallback = true }
    }
    if (caData) {
      ca_ttc = parseFloat(String(caData.ca_total || 0))
      familiesDetail = Array.isArray(caData.families_detail) ? (caData.families_detail as FamilyRow[]) : []
      caByRayonSaisi = {
        boucherie:   parseFloat(String((caData as any).ca_boucherie || 0)) || 0,
        charcuterie: parseFloat(String((caData as any).ca_charcuterie || 0)) || 0,
        traiteur:    parseFloat(String((caData as any).ca_traiteur || 0)) || 0,
      }
    }

    // ── Économie de la semaine de référence : LE moteur, pas un calcul maison ──
    // Achats variables (hors factures « à vérifier »), masse salariale chargée depuis
    // le planning, charges récurrentes proratisées, CA ramené en HT. Exactement les
    // mêmes chiffres qu'en page Facturation pour la même semaine.
    eco = await computeWeekEconomics(serviceSupabase, clientId, refWeek, refYear, {
      ca_total: ca_ttc,
      familles: familiesDetail.length > 0 ? familiesDetail : null,
      by_rayon: caByRayonSaisi,
    })

    // ── Fiabilité des marges : factures importées « à vérifier » + fournisseurs non ventilés ──
    // Un fournisseur sans règle de ventilation pèse sur la marge globale mais sur aucune
    // famille : c'est LE réglage qui manque, et le seul (plus de « catégorisation » à part).
    const [{ count: avCount }, { data: splitRows }, { data: supRows }] = await Promise.all([
      serviceSupabase.from('invoices').select('id', { count: 'exact', head: true })
        .eq('client_id', clientId).eq('status', 'a_verifier'),
      serviceSupabase.from('supplier_rayon_splits').select('supplier_key').eq('client_id', clientId),
      serviceSupabase.from('invoices').select('supplier_name')
        .eq('client_id', clientId).eq('year', currentYear).eq('is_fixed_charge', false),
    ])
    aVerifierCount = avCount || 0
    const splitKeys = (splitRows || []).map(s => String(s.supplier_key))
    const manquants = new Set<string>()
    for (const inv of supRows || []) {
      const k = societeKey(inv.supplier_name)
      if (!k) continue
      if (splitKeys.some(sk => sk === k || sameSupplierFamily(sk, k))) continue
      manquants.add(k)
    }
    fournisseursNonVentiles = manquants.size

    // ── Intégration comptable connectée ? (checklist de démarrage) ──
    const { data: integ } = await serviceSupabase
      .from('billing_integrations').select('id').eq('client_id', clientId).eq('is_active', true).limit(1)
    hasIntegration = (integ || []).length > 0

    // ── Employés + plannings (semaine de référence pour la masse salariale, semaine courante pour les alertes) ──
    const { data: emps } = await serviceSupabase
      .from('employees')
      .select(`${PAYROLL_EMPLOYEE_COLUMNS}, contract_end_date`)
      .eq('client_id', clientId)
    const employees = (emps || []) as unknown as EmpRow[]
    employeeCount = employees.length

    if (employees.length > 0) {
      const empIds = employees.map(e => e.id)

      // La masse salariale de la semaine de référence vient du moteur (eco) ; ici on ne
      // lit que la semaine COURANTE, pour les alertes légales du planning en cours.
      const [{ data: curPlanning }, { data: anyPlan }] = await Promise.all([
        serviceSupabase.from('planning_entries').select(PAYROLL_ENTRY_COLUMNS).in('employee_id', empIds).eq('week_number', currentWeek).eq('year', currentYear),
        serviceSupabase.from('planning_entries').select('id').in('employee_id', empIds).limit(1),
      ])

      legalAlerts = computeLegalAlerts((curPlanning || []) as unknown as PayrollEntry[], employees)
      anyPlanning = (anyPlan || []).length > 0

      // Fins de CDD dans les 45 jours
      for (const emp of employees) {
        if (!emp.contract_end_date) continue
        const days = Math.ceil((new Date(emp.contract_end_date).getTime() - Date.now()) / 86400000)
        if (days >= 0 && days <= 45) {
          cddAlerts.push(`${emp.name || 'Employé'} : fin de CDD le ${new Date(emp.contract_end_date).toLocaleDateString('fr-FR')} (${days} j)`)
        }
      }
    }

    // ── Tendance CA — 8 dernières semaines de l'année en cours UNIQUEMENT ──
    // On ne mélange jamais les semaines de N-1 dans ce graphique : les barres
    // ne sont étiquetées que par numéro de semaine (S12), donc une semaine de
    // l'année précédente y serait indiscernable et fausserait la lecture.
    const { data: trendRows } = await serviceSupabase
      .from('weekly_ca').select('week_number, year, ca_total')
      .eq('client_id', clientId)
      .eq('year', refYear)
      .order('week_number', { ascending: false })
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

  // ── Agrégats — tous lus dans le moteur, aucun recalcul ici ──
  // ca_ttc = chiffre de caisse (ce que le gérant connaît) ; caHT = base des taux.
  const caHT          = eco?.ca_total ?? 0
  const achatsHT      = eco?.achats_ht ?? 0
  const chargesFixesSem = eco?.charges_fixes ?? 0
  const payrollRef    = eco?.masse_salariale ?? 0
  const marge_brute   = eco?.marge_brute ?? 0
  const taux_marge    = caHT > 0 ? (eco?.taux_marge ?? null) : null
  const resultat      = caHT > 0 ? (eco?.resultat_net ?? null) : null
  const ratioMS       = payrollRef > 0 ? (eco?.ratio_ms ?? null) : null
  const tvaRate       = eco?.tva_rate ?? 5.5

  const margeColor =
    taux_marge === null ? 'text-gray-400'
    : taux_marge >= 40 ? 'text-green-600'
    : taux_marge >= 30 ? 'text-orange-500'
    : 'text-red-600'

  // Donut familles : top 4 + Autres — palette marque (navy + orange), plus de conflit avec les couleurs sémantiques
  const sorted = [...familiesDetail].sort((a, b) => b.montant - a.montant)
  const top4 = sorted.slice(0, 4)
  const autresTotal = sorted.slice(4).reduce((s, f) => s + f.montant, 0)
  const FAMILY_COLORS = ['#1E3A5F', '#4A6B94', '#FF8C00', '#93A9C4']
  const segments = [
    ...top4.map((f, i) => ({ label: f.nom, value: f.montant, color: FAMILY_COLORS[i] })),
    ...(autresTotal > 0 ? [{ label: 'Autres', value: autresTotal, color: '#CBD5E1' }] : []),
  ]
  const segTotal = segments.reduce((s, seg) => s + seg.value, 0) || ca_ttc

  // Tendance
  const maxTrend = caTrend.length > 0 ? Math.max(...caTrend.map(t => t.ca), 1) : 1
  const trendEvol = caTrend.length >= 2 && caTrend[caTrend.length - 2].ca > 0
    ? ((caTrend[caTrend.length - 1].ca - caTrend[caTrend.length - 2].ca) / caTrend[caTrend.length - 2].ca) * 100
    : null

  const attention: { color: string; text: string; href?: string; cta?: string }[] = [
    ...legalAlerts.map(t => ({ color: 'bg-red-500', text: `Planning S${currentWeek} · ${t}` })),
    ...cddAlerts.map(t => ({ color: 'bg-amber-500', text: t })),
    ...(ratioMS !== null && ratioMS > 40 ? [{ color: 'bg-amber-500', text: `Masse salariale à ${ratioMS.toFixed(1)} % du CA HT (cible < 35 %)` }] : []),
    ...(aVerifierCount > 0 ? [{ color: 'bg-amber-500', text: `${aVerifierCount} facture${aVerifierCount > 1 ? 's' : ''} importée${aVerifierCount > 1 ? 's' : ''} « à vérifier » — exclue${aVerifierCount > 1 ? 's' : ''} des marges tant que non validée${aVerifierCount > 1 ? 's' : ''}`, href: '/dashboard/facturation', cta: 'Valider' }] : []),
    ...(fournisseursNonVentiles > 0 ? [{ color: 'bg-pilote', text: `${fournisseursNonVentiles} fournisseur${fournisseursNonVentiles > 1 ? 's' : ''} sans ventilation — leurs achats pèsent sur la marge globale, sur aucune famille`, href: '/dashboard/facturation', cta: 'Ventiler' }] : []),
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
  const hasAnyData = ca_ttc > 0 || achatsHT > 0 || payrollRef > 0 || reports.length > 0

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      {/* ── En-tête ── */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">
            Bonjour, {profile?.business_name || 'bienvenue'}
          </h1>
          <p className="text-sm text-gray-500 mt-1.5">
            Pilotage de la semaine écoulée · <span className="font-semibold text-gray-700">S{refWeek} · {weekPeriodLabel(refWeek, refYear)} {refYear}</span>
            {refIsFallback && <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">dernières données disponibles</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {[
            { href: '/dashboard/planning',     icon: CalendarDays, label: 'Planning' },
            { href: '/dashboard/facturation',  icon: Receipt,      label: 'Facturation' },
            { href: '/dashboard/valorisation', icon: Calculator,   label: 'Valorisation' },
            { href: '/dashboard/marges',       icon: TrendingUp,   label: 'Marges' },
          ].map(l => (
            <Link key={l.href} href={l.href}
              className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 bg-white border border-gray-100 rounded-xl px-3.5 h-9 shadow-card hover:text-pilote hover:-translate-y-px transition-all">
              <l.icon className="w-3.5 h-3.5" />{l.label}
            </Link>
          ))}
        </div>
      </div>

      {/* ── Checklist de démarrage ── */}
      {showOnboarding && (
        <div className="mb-6 bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
          <div className="px-5 py-3.5 bg-pilote flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight">Bien démarrer avec PILOTE</h2>
              <p className="text-[11px] text-white/70">Encore {onboardingSteps.length - stepsDone} étape{onboardingSteps.length - stepsDone > 1 ? 's' : ''} pour un pilotage 100 % automatique</p>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="w-24 h-1.5 bg-white/20 rounded-full overflow-hidden">
                <div className="h-full bg-pilote-orange rounded-full transition-all duration-500" style={{ width: `${(stepsDone / onboardingSteps.length) * 100}%` }} />
              </div>
              <span className="text-xs font-bold text-white tabular">{stepsDone}/{onboardingSteps.length}</span>
            </div>
          </div>
          <div className="divide-y divide-gray-50">
            {onboardingSteps.map((step, i) => (
              <Link key={i} href={step.href} className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors group">
                {step.done
                  ? <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                  : <Circle className="w-5 h-5 text-gray-300 flex-shrink-0" />}
                <div className="flex-1">
                  <p className={`text-sm font-medium ${step.done ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{step.label}</p>
                  {!step.done && <p className="text-xs text-gray-400 mt-0.5">{step.desc}</p>}
                </div>
                {!step.done && <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-pilote group-hover:translate-x-0.5 transition-all" />}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Points d'attention ── */}
      {attention.length > 0 && (
        <div className="mb-6 bg-white rounded-2xl border border-red-100 shadow-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <h2 className="text-sm font-bold text-gray-900 tracking-tight">Points d'attention</h2>
            <span className="text-[10px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full tabular">{attention.length}</span>
          </div>
          <div className="space-y-2">
            {attention.slice(0, 6).map((a, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${a.color}`} />
                <p className="text-xs text-gray-600 flex-1">{a.text}</p>
                {a.href && (
                  <Link href={a.href} className="text-[11px] font-bold text-pilote hover:underline whitespace-nowrap flex-shrink-0">
                    {a.cta ?? 'Voir'} →
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!hasAnyData ? (
        <Card className="mb-8">
          <CardContent className="py-16 text-center">
            <TrendingUp className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-500 mb-1">Aucune donnée pour l'instant</p>
            <p className="text-xs text-gray-400 mb-5 max-w-sm mx-auto">Synchronisez vos factures, remplissez le planning ou générez votre premier rapport pour activer le tableau de bord.</p>
            <div className="flex items-center justify-center gap-3">
              <Link href="/dashboard/facturation" className="text-sm text-pilote font-semibold hover:underline">Facturation →</Link>
              <Link href="/dashboard/planning" className="text-sm text-pilote font-semibold hover:underline">Planning →</Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ── KPIs semaine écoulée ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <Card className="hover:shadow-card-hover transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="w-6 h-6 rounded-lg bg-pilote-50 flex items-center justify-center flex-shrink-0">
                    <Euro className="w-3.5 h-3.5 text-pilote" />
                  </div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">CA TTC · {weekLabel}</p>
                </div>
                <p className="text-2xl font-extrabold tracking-tight text-gray-900 tabular">{ca_ttc > 0 ? `${fmt(ca_ttc)} €` : '—'}</p>
                {ca_ttc > 0
                  ? <p className="text-xs text-gray-400 mt-1 tabular">soit {fmt(caHT)} € HT · TVA {tvaRate.toString().replace('.', ',')} %</p>
                  : <p className="text-xs text-gray-400 mt-1">Saisir le CA ou générer le rapport</p>}
              </CardContent>
            </Card>

            <Card className="hover:shadow-card-hover transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="w-6 h-6 rounded-lg bg-pilote-50 flex items-center justify-center flex-shrink-0">
                    <Receipt className="w-3.5 h-3.5 text-pilote" />
                  </div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Achats HT · {weekLabel}</p>
                </div>
                <p className="text-2xl font-extrabold tracking-tight text-gray-900 tabular">{achatsHT > 0 ? `${fmt(achatsHT)} €` : '—'}</p>
                {chargesFixesSem > 0 && (
                  <p className="text-xs text-gray-500 mt-1 flex items-center gap-1 tabular"><Repeat className="w-3 h-3 text-gray-400" />+ charges récurrentes ≈ {fmt(chargesFixesSem)} €/sem</p>
                )}
              </CardContent>
            </Card>

            <Card className="hover:shadow-card-hover transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="w-6 h-6 rounded-lg bg-pilote-50 flex items-center justify-center flex-shrink-0">
                    <Users className="w-3.5 h-3.5 text-pilote" />
                  </div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Masse salariale · {weekLabel}</p>
                </div>
                <p className="text-2xl font-extrabold tracking-tight text-gray-900 tabular">{payrollRef > 0 ? `${fmt(payrollRef)} €` : '—'}</p>
                <p className="text-xs text-gray-400 mt-1 tabular">{payrollRef > 0 ? (ratioMS !== null ? `${ratioMS.toFixed(1)} % du CA HT · chargée (CCN 992)` : 'chargée (CCN 992)') : 'Remplir le planning'}</p>
              </CardContent>
            </Card>

            <Card className="hover:shadow-card-hover transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-2.5">
                  <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${taux_marge !== null && taux_marge < 30 ? 'bg-red-50' : 'bg-green-50'}`}>
                    {taux_marge !== null && taux_marge < 30 ? <TrendingDown className="w-3.5 h-3.5 text-red-500" /> : <TrendingUp className="w-3.5 h-3.5 text-green-600" />}
                  </div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Marge brute · {weekLabel}</p>
                </div>
                <p className={`text-2xl font-extrabold tracking-tight tabular ${margeColor}`}>{taux_marge !== null ? `${taux_marge.toFixed(1)} %` : '—'}</p>
                {taux_marge !== null && <p className="text-xs text-gray-400 mt-1 tabular">{fmt(marge_brute)} € · CA HT − achats HT</p>}
              </CardContent>
            </Card>
          </div>

          {/* ── Résultat estimé ── */}
          {resultat !== null && (
            <div className="mb-8 rounded-2xl bg-pilote text-white shadow-card-hover p-6 flex items-center justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-pilote-200">Résultat estimé · semaine {refWeek}</p>
                <p className={`text-4xl font-extrabold tracking-tight mt-1.5 tabular ${resultat >= 0 ? 'text-green-300' : 'text-red-300'}`}>{resultat >= 0 ? '+' : ''}{fmt(resultat)} €</p>
                <p className="text-xs text-pilote-200 mt-2 tabular">
                  CA HT {fmt(caHT)} € − Achats HT {fmt(achatsHT)} € − Masse salariale chargée {fmt(payrollRef)} € − Charges récurrentes {fmt(chargesFixesSem)} €
                </p>
              </div>
              <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center flex-shrink-0">
                {resultat >= 0 ? <TrendingUp className="w-7 h-7 text-green-300" /> : <TrendingDown className="w-7 h-7 text-red-300" />}
              </div>
            </div>
          )}

          {/* ── Tendance CA ── */}
          {caTrend.length >= 2 && (
            <Card className="mb-8">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">Tendance du CA</CardTitle>
                  <CardDescription>{caTrend.length} dernières semaines saisies · {refYear}</CardDescription>
                </div>
                {trendEvol !== null && (
                  <span className={`text-sm font-bold px-2.5 py-1 rounded-full tabular ${
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
                        <span className="text-[10px] font-semibold text-gray-500 tabular">{fmt(t.ca / 1000 >= 1 ? Math.round(t.ca / 100) / 10 : t.ca)}{t.ca >= 1000 ? ' k€' : ' €'}</span>
                        <div className="w-full flex items-end" style={{ height: '80px' }}>
                          <div
                            className={`w-full rounded-t-lg transition-all ${isLast ? 'bg-pilote-orange' : 'bg-pilote-100 hover:bg-pilote-200'}`}
                            style={{ height: `${Math.max(6, (t.ca / maxTrend) * 100)}%` }}
                          />
                        </div>
                        <span className={`text-[10px] tabular ${isLast ? 'font-bold text-pilote-orange' : 'text-gray-400'}`}>S{t.week}</span>
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
                  <DonutChart segments={segments} total={segTotal} centerTotal={ca_ttc} />
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
                              <span className="font-semibold text-gray-900 tabular">{fmt(seg.value)} €</span>
                              <span className="text-gray-400 w-9 text-right tabular">{Math.round(pct)} %</span>
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
                      <span className={`font-semibold tabular ${margeColor}`}>
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
            <CardDescription>Rapport complet publié chaque semaine</CardDescription>
          </div>
          <Link href="/dashboard/reports" className="text-sm text-pilote font-semibold hover:underline flex items-center gap-1 flex-shrink-0">
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
                  className="flex items-center justify-between p-4 rounded-xl border border-gray-100 hover:bg-gray-50 hover:shadow-card transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-pilote-50 flex items-center justify-center flex-shrink-0">
                      <FileText className="w-4 h-4 text-pilote" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{report.title}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{formatDate(report.created_at)}</p>
                    </div>
                  </div>
                  <a
                    href={report.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-semibold text-pilote border border-gray-200 rounded-lg px-3 py-2 hover:border-pilote hover:bg-pilote-50 transition-colors"
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
