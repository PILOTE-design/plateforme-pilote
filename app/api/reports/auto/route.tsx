import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendReportEmail } from '@/lib/resend'
import { renderToBuffer, Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ─── Dates / semaines ISO ────────────────────────────────────────────────────

function getISOWeek(date: Date): { week: number; year: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return { week: Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7), year: d.getUTCFullYear() }
}

function getWeekDates(week: number, year: number): Date[] {
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const dow = jan4.getUTCDay() || 7
  const mon = new Date(jan4)
  mon.setUTCDate(jan4.getUTCDate() - dow + 1 + (week - 1) * 7)
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setUTCDate(mon.getUTCDate() + i); return d })
}

function periodLabel(week: number, year: number): string {
  const d = getWeekDates(week, year)
  const f = (x: Date) => `${x.getUTCDate()}/${String(x.getUTCMonth() + 1).padStart(2, '0')}`
  return `du ${f(d[0])} au ${f(d[6])}/${year}`
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
  const f = (d: Date) => d.toISOString().slice(0, 10)
  return new Set([
    f(new Date(Date.UTC(year, 0, 1))), f(add(easter, 1)), f(new Date(Date.UTC(year, 4, 1))),
    f(new Date(Date.UTC(year, 4, 8))), f(add(easter, 39)), f(add(easter, 50)),
    f(new Date(Date.UTC(year, 6, 14))), f(new Date(Date.UTC(year, 7, 15))), f(new Date(Date.UTC(year, 10, 1))),
    f(new Date(Date.UTC(year, 10, 11))), f(new Date(Date.UTC(year, 11, 25))),
  ])
}

// ─── Format ──────────────────────────────────────────────────────────────────────

/** Format euro sans toLocaleString (WinAnsi-safe pour react-pdf) */
function eur(n: number): string {
  const neg = n < 0 ? '-' : ''
  const v = Math.abs(Math.round(n))
  const s = v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${neg}${s} €`
}

const CAT_LABELS: Record<string, string> = {
  viande: 'Viande', charcuterie: 'Charcuterie', epicerie: 'Epicerie',
  emballage: 'Emballage', frais_generaux: 'Frais generaux', autre: 'Autre',
}

const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']

type EmpRow = {
  id: string; name: string; hourly_rate: string; contract_type: string; contract_hours: number
  charges_patronales: string | null; contract_end_date: string | null
}

/** Masse salariale chargée CCN 992 : HS sur heures travaillées, CP a ch/5, dimanche +20%, ferie +100% */
function computePayroll(entries: any[], emps: EmpRow[], week: number, year: number): number {
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

// ─── PDF ─────────────────────────────────────────────────────────────────────────

const NAVY = '#1E3A5F'
const ORANGE = '#FF8C00'

const st = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: 'Helvetica', color: '#1a1a1a' },
  header: { backgroundColor: NAVY, marginHorizontal: -36, marginTop: -36, paddingHorizontal: 36, paddingVertical: 20, marginBottom: 18 },
  brand: { color: ORANGE, fontSize: 8, letterSpacing: 3, marginBottom: 4 },
  h1: { color: '#ffffff', fontSize: 17, fontFamily: 'Helvetica-Bold' },
  sub: { color: '#9fb3c8', fontSize: 9, marginTop: 3 },
  kpiRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  kpi: { flex: 1, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 6, padding: 9 },
  kpiLabel: { fontSize: 6.5, color: '#8a94a6', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  kpiValue: { fontSize: 13, fontFamily: 'Helvetica-Bold' },
  kpiSub: { fontSize: 6.5, color: '#8a94a6', marginTop: 2 },
  resultBand: { borderRadius: 6, padding: 12, marginBottom: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  secTitle: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: NAVY, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, marginTop: 4 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#eef0f3', paddingVertical: 4 },
  cellL: { flex: 2 },
  cellR: { flex: 1, textAlign: 'right' },
  trendRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  trendLabel: { width: 40, fontSize: 8, color: '#556' },
  trendBarBg: { flex: 1, height: 9, backgroundColor: '#eef0f3', borderRadius: 3, marginHorizontal: 6 },
  trendBar: { height: 9, borderRadius: 3, backgroundColor: NAVY },
  trendVal: { width: 60, fontSize: 8, textAlign: 'right', fontFamily: 'Helvetica-Bold' },
  alertBox: { backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', borderRadius: 6, padding: 9, marginTop: 10 },
  alertLine: { fontSize: 8, color: '#7f1d1d', marginBottom: 2 },
  footer: { position: 'absolute', bottom: 22, left: 36, right: 36, textAlign: 'center', fontSize: 7, color: '#b0b7c3' },
})

type FlashData = {
  business: string; week: number; year: number
  ca: number; achatsVar: number; fixesSem: number; payroll: number
  cats: { label: string; amount: number }[]
  fixes: { name: string; weekly: number }[]
  trend: { week: number; ca: number }[]
  alerts: string[]
}

function FlashPDF({ d }: { d: FlashData }) {
  const achats = d.achatsVar + d.fixesSem
  const marge = d.ca > 0 ? d.ca - achats : 0
  const tauxMarge = d.ca > 0 ? (marge / d.ca) * 100 : null
  const resultat = d.ca > 0 ? d.ca - achats - d.payroll : null
  const ratioMS = d.ca > 0 && d.payroll > 0 ? (d.payroll / d.ca) * 100 : null
  const maxTrend = Math.max(...d.trend.map(t => t.ca), 1)

  return (
    <Document>
      <Page size="A4" style={st.page}>
        <View style={st.header}>
          <Text style={st.brand}>P I L O T E</Text>
          <Text style={st.h1}>Flash hebdo - Semaine {d.week}</Text>
          <Text style={st.sub}>{d.business} - {periodLabel(d.week, d.year)} - genere automatiquement</Text>
        </View>

        <View style={st.kpiRow}>
          <View style={st.kpi}>
            <Text style={st.kpiLabel}>Chiffre d'affaires</Text>
            <Text style={st.kpiValue}>{d.ca > 0 ? eur(d.ca) : '-'}</Text>
            {d.ca === 0 ? <Text style={st.kpiSub}>CA non saisi</Text> : null}
          </View>
          <View style={st.kpi}>
            <Text style={st.kpiLabel}>Achats HT</Text>
            <Text style={st.kpiValue}>{eur(achats)}</Text>
            <Text style={st.kpiSub}>dont fixes {eur(d.fixesSem)}/sem</Text>
          </View>
          <View style={st.kpi}>
            <Text style={st.kpiLabel}>Masse salariale chargee</Text>
            <Text style={st.kpiValue}>{d.payroll > 0 ? eur(d.payroll) : '-'}</Text>
            {ratioMS !== null ? <Text style={st.kpiSub}>{ratioMS.toFixed(0)} % du CA</Text> : null}
          </View>
          <View style={st.kpi}>
            <Text style={st.kpiLabel}>Marge brute</Text>
            <Text style={{ ...st.kpiValue, color: tauxMarge === null ? '#8a94a6' : tauxMarge >= 40 ? '#16a34a' : tauxMarge >= 30 ? '#ea580c' : '#dc2626' }}>
              {tauxMarge !== null ? `${tauxMarge.toFixed(1)} %` : '-'}
            </Text>
            {tauxMarge !== null ? <Text style={st.kpiSub}>{eur(marge)}</Text> : null}
          </View>
        </View>

        {resultat !== null ? (
          <View style={{ ...st.resultBand, backgroundColor: resultat >= 0 ? '#f0fdf4' : '#fef2f2', borderWidth: 1, borderColor: resultat >= 0 ? '#bbf7d0' : '#fecaca' }}>
            <View>
              <Text style={{ fontSize: 7, color: '#667', textTransform: 'uppercase', letterSpacing: 1 }}>Resultat estime de la semaine</Text>
              <Text style={{ fontSize: 18, fontFamily: 'Helvetica-Bold', marginTop: 2 }}>{eur(resultat)}</Text>
            </View>
            <Text style={{ fontSize: 8, color: '#667', maxWidth: 220, textAlign: 'right' }}>
              CA {eur(d.ca)} - achats {eur(achats)} - masse salariale {eur(d.payroll)}
            </Text>
          </View>
        ) : null}

        {d.cats.length > 0 ? (
          <View>
            <Text style={st.secTitle}>Achats de la semaine par categorie</Text>
            {d.cats.map((c, i) => (
              <View key={i} style={st.row}>
                <Text style={st.cellL}>{c.label}</Text>
                <Text style={{ ...st.cellR, fontFamily: 'Helvetica-Bold' }}>{eur(c.amount)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {d.fixes.length > 0 ? (
          <View style={{ marginTop: 10 }}>
            <Text style={st.secTitle}>Charges structurelles (part hebdomadaire)</Text>
            {d.fixes.slice(0, 8).map((fx, i) => (
              <View key={i} style={st.row}>
                <Text style={st.cellL}>{fx.name}</Text>
                <Text style={{ ...st.cellR, color: '#7c3aed', fontFamily: 'Helvetica-Bold' }}>{eur(fx.weekly)}/sem</Text>
              </View>
            ))}
          </View>
        ) : null}

        {d.trend.length >= 2 ? (
          <View style={{ marginTop: 12 }}>
            <Text style={st.secTitle}>Tendance du CA</Text>
            {d.trend.map((t, i) => (
              <View key={i} style={st.trendRow}>
                <Text style={st.trendLabel}>S{t.week}</Text>
                <View style={st.trendBarBg}>
                  <View style={{ ...st.trendBar, width: `${Math.max(4, (t.ca / maxTrend) * 100)}%`, backgroundColor: i === d.trend.length - 1 ? ORANGE : NAVY }} />
                </View>
                <Text style={st.trendVal}>{eur(t.ca)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {d.alerts.length > 0 ? (
          <View style={st.alertBox}>
            <Text style={{ ...st.secTitle, color: '#dc2626', marginTop: 0 }}>Points d'attention</Text>
            {d.alerts.slice(0, 5).map((a, i) => <Text key={i} style={st.alertLine}>- {a}</Text>)}
          </View>
        ) : null}

        <Text style={st.footer}>PILOTE - Flash hebdomadaire genere automatiquement chaque lundi matin - www.plateforme-pilote.fr</Text>
      </Page>
    </Document>
  )
}

// ─── Route ─────────────────────────────────────────────────────────────────────

async function runAutoReports(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = createServiceClient()

  // Semaine écoulée
  const ref = new Date()
  ref.setUTCDate(ref.getUTCDate() - 7)
  const { week, year } = getISOWeek(ref)
  const dates = getWeekDates(week, year)
  const monISO = dates[0].toISOString().slice(0, 10)
  const sunISO = dates[6].toISOString().slice(0, 10)

  const { data: clients } = await service.from('clients').select('id, name, email, client_user_id')
  const results: any[] = []

  for (const client of clients || []) {
    try {
      // Déjà généré ?
      const { data: existing } = await service
        .from('reports').select('id')
        .eq('client_id', client.id).eq('week_number', week).eq('year', year)
        .ilike('title', 'Flash%')
        .maybeSingle()
      if (existing) { results.push({ client: client.name, status: 'deja_genere' }); continue }

      // Profil (pour delivery_email et profile_id)
      let profile: any = null
      if (client.client_user_id) {
        const { data: p } = await service
          .from('profiles').select('id, business_name, delivery_email')
          .eq('user_id', client.client_user_id).maybeSingle()
        profile = p
      }

      // CA + tendance
      const { data: caRow } = await service
        .from('weekly_ca').select('ca_total')
        .eq('client_id', client.id).eq('week_number', week).eq('year', year).maybeSingle()
      const ca = parseFloat(String(caRow?.ca_total || 0))

      const { data: trendRows } = await service
        .from('weekly_ca').select('week_number, year, ca_total')
        .eq('client_id', client.id)
        .order('year', { ascending: false }).order('week_number', { ascending: false })
        .limit(5)
      const trend = (trendRows || [])
        .map((r: any) => ({ week: r.week_number, ca: parseFloat(String(r.ca_total || 0)) }))
        .reverse()

      // Achats : variables de la semaine + charges fixes couvrant la semaine
      const [{ data: weekInvoices }, { data: allFixed }] = await Promise.all([
        service.from('invoices').select('supplier_name, category, amount_ht, is_fixed_charge')
          .eq('client_id', client.id).eq('week_number', week).eq('year', year),
        service.from('invoices').select('supplier_name, invoice_date, amount_ht, period_days, prorata_ht')
          .eq('client_id', client.id).eq('is_fixed_charge', true),
      ])

      const variables = (weekInvoices || []).filter((i: any) => !i.is_fixed_charge)
      const achatsVar = variables.reduce((s: number, i: any) => s + parseFloat(String(i.amount_ht || 0)), 0)

      const catTotals: Record<string, number> = {}
      for (const inv of variables) {
        const cat = CAT_LABELS[inv.category] || 'Autre'
        catTotals[cat] = (catTotals[cat] || 0) + parseFloat(String(inv.amount_ht || 0))
      }
      const cats = Object.entries(catTotals)
        .map(([label, amount]) => ({ label, amount }))
        .sort((a, b) => b.amount - a.amount)

      const fixes: { name: string; weekly: number }[] = []
      let fixesSem = 0
      for (const fx of allFixed || []) {
        if (!fx.invoice_date) continue
        const end = new Date(fx.invoice_date)
        end.setUTCDate(end.getUTCDate() + (fx.period_days || 30))
        const endISO = end.toISOString().slice(0, 10)
        if (fx.invoice_date <= sunISO && endISO > monISO) {
          const weekly = parseFloat(String(fx.prorata_ht || 0)) || Math.round((parseFloat(String(fx.amount_ht || 0)) * 7 / (fx.period_days || 30)) * 100) / 100
          fixes.push({ name: fx.supplier_name, weekly })
          fixesSem += weekly
        }
      }
      fixes.sort((a, b) => b.weekly - a.weekly)

      // Masse salariale + alertes CDD
      const { data: emps } = await service
        .from('employees')
        .select('id, name, hourly_rate, contract_type, contract_hours, charges_patronales, contract_end_date')
        .eq('client_id', client.id)
      const employees = (emps || []) as EmpRow[]

      let payroll = 0
      const alerts: string[] = []
      if (employees.length > 0) {
        const { data: planning } = await service
          .from('planning_entries')
          .select('employee_id,lundi,mardi,mercredi,jeudi,vendredi,samedi,dimanche,lundi_type,mardi_type,mercredi_type,jeudi_type,vendredi_type,samedi_type,dimanche_type')
          .in('employee_id', employees.map(e => e.id))
          .eq('week_number', week).eq('year', year)
        payroll = computePayroll(planning || [], employees, week, year)

        for (const emp of employees) {
          if (!emp.contract_end_date) continue
          const days = Math.ceil((new Date(emp.contract_end_date).getTime() - Date.now()) / 86400000)
          if (days >= 0 && days <= 45) alerts.push(`${emp.name} : fin de CDD dans ${days} jours`)
        }
      }
      if (ca > 0 && payroll > 0 && (payroll / ca) * 100 > 40) {
        alerts.push(`Masse salariale a ${((payroll / ca) * 100).toFixed(0)} % du CA (cible < 35 %)`)
      }

      // Rien a raconter ? on passe
      if (ca === 0 && achatsVar === 0 && fixesSem === 0 && payroll === 0) {
        results.push({ client: client.name, status: 'aucune_donnee' })
        continue
      }

      // Génération PDF
      const businessName = profile?.business_name || client.name
      const buffer = await renderToBuffer(
        <FlashPDF d={{ business: businessName, week, year, ca, achatsVar, fixesSem, payroll, cats, fixes, trend, alerts }} />
      )

      const fileName = `flash-s${week}-${year}-${Date.now()}.pdf`
      const { error: uploadError } = await service.storage
        .from('reports')
        .upload(fileName, buffer, { contentType: 'application/pdf' })
      if (uploadError) { results.push({ client: client.name, status: 'erreur_upload', error: uploadError.message }); continue }

      const { data: pub } = service.storage.from('reports').getPublicUrl(fileName)
      const fileUrl = pub.publicUrl

      const title = `Flash hebdo - Semaine ${week} ${year}`
      const { error: insertError } = await service.from('reports').insert({
        client_id: client.id,
        profile_id: profile?.id ?? null,
        title,
        week_number: week,
        year,
        file_url: fileUrl,
      })
      if (insertError) { results.push({ client: client.name, status: 'erreur_insert', error: insertError.message }); continue }

      // Email
      let emailStatus = 'non_envoye'
      const to = profile?.delivery_email || client.email
      if (to) {
        try { await sendReportEmail(to, businessName, title, fileUrl); emailStatus = `envoye a ${to}` }
        catch (e: any) { emailStatus = `erreur email: ${e?.message || 'inconnue'}` }
      }

      results.push({ client: client.name, status: 'genere', url: fileUrl, email: emailStatus })
    } catch (e: any) {
      results.push({ client: client.name, status: 'erreur', error: e?.message || String(e) })
    }
  }

  return NextResponse.json({ week, year, results })
}

export async function GET(request: NextRequest) { return runAutoReports(request) }
export async function POST(request: NextRequest) { return runAutoReports(request) }
