import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

async function resolveClientId(serviceSupabase: any, userId: string, userEmail?: string | null) {
  const { data: byId } = await serviceSupabase.from('clients').select('id').eq('client_user_id', userId).maybeSingle()
  if (byId) return byId.id
  if (!userEmail) return null
  const { data: byEmail } = await serviceSupabase.from('clients').select('id').eq('email', userEmail).maybeSingle()
  if (!byEmail) return null
  await serviceSupabase.from('clients').update({ client_user_id: userId }).eq('id', byEmail.id)
  return byEmail.id
}

export async function GET(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const week = parseInt(searchParams.get('week') || '0')
  const year = parseInt(searchParams.get('year') || '0')
  if (!week || !year) return NextResponse.json({ error: 'week et year requis' }, { status: 400 })

  const serviceSupabase = createServiceClient()
  const clientId = await resolveClientId(serviceSupabase, user.id, user.email)
  if (!clientId) return NextResponse.json({ achats_ht: 0, masse_salariale: 0, ca_total: 0 })

  // 1. Achats HT de la semaine
  const { data: invoicesData } = await serviceSupabase
    .from('invoices')
    .select('amount_ht, category')
    .eq('client_id', clientId)
    .eq('week_number', week)
    .eq('year', year)

  const achats_ht = (invoicesData || []).reduce((s: number, inv: any) => s + parseFloat(inv.amount_ht || 0), 0)

  const achats_by_category: Record<string, number> = {}
  for (const inv of invoicesData || []) {
    const cat = inv.category || 'autre'
    achats_by_category[cat] = (achats_by_category[cat] || 0) + parseFloat(inv.amount_ht || 0)
  }

  // 2. Masse salariale depuis planning
  const { data: planningData } = await serviceSupabase
    .from('planning_entries')
    .select('lundi, mardi, mercredi, jeudi, vendredi, samedi, dimanche, lundi_type, mardi_type, mercredi_type, jeudi_type, vendredi_type, samedi_type, dimanche_type, employee_id')
    .eq('week_number', week)
    .eq('year', year)

  let masse_salariale = 0
  if (planningData && planningData.length > 0) {
    const employeeIds = [...new Set(planningData.map((p: any) => p.employee_id))]
    const { data: employees } = await serviceSupabase
      .from('employees')
      .select('id, hourly_rate, contract_type, contract_hours')
      .in('id', employeeIds)

    const empMap: Record<string, any> = {}
    for (const emp of employees || []) empMap[emp.id] = emp

    const CONTRACT_HOURS: Record<string, number> = { CDI_35: 35, CDI_39: 39, CDD_35: 35, CDD_39: 39 }
    const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']

    for (const entry of planningData) {
      const emp = empMap[entry.employee_id]
      if (!emp) continue
      const ch = CONTRACT_HOURS[emp.contract_type] ?? emp.contract_hours ?? 35
      const rate = parseFloat(emp.hourly_rate || 0)

      const totalH = JOURS.reduce((s: number, j: string) => {
        const t = entry[`${j}_type`] || 'travail'
        return s + (t === 'travail' ? parseFloat(entry[j] || 0) : t === 'conges' ? 7 : 0)
      }, 0)

      const t2 = ch + 8
      let cost = 0
      if (totalH <= ch) cost = totalH * rate
      else if (totalH <= t2) cost = ch * rate + (totalH - ch) * rate * 1.25
      else cost = ch * rate + (t2 - ch) * rate * 1.25 + (totalH - t2) * rate * 1.5
      masse_salariale += cost
    }
  }

  // 3. CA depuis weekly_ca
  const { data: caData } = await serviceSupabase
    .from('weekly_ca')
    .select('*')
    .eq('client_id', clientId)
    .eq('week_number', week)
    .eq('year', year)
    .maybeSingle()

  const ca_total = parseFloat(caData?.ca_total || 0)
  const marge_brute = ca_total - achats_ht
  const taux_marge = ca_total > 0 ? (marge_brute / ca_total) * 100 : null
  const resultat_net = marge_brute - masse_salariale
  const ratio_ms = ca_total > 0 ? (masse_salariale / ca_total) * 100 : null

  return NextResponse.json({
    achats_ht: Math.round(achats_ht * 100) / 100,
    achats_by_category,
    masse_salariale: Math.round(masse_salariale * 100) / 100,
    ca_total,
    ca_detail: caData || null,
    marge_brute: Math.round(marge_brute * 100) / 100,
    taux_marge: taux_marge !== null ? Math.round(taux_marge * 10) / 10 : null,
    resultat_net: Math.round(resultat_net * 100) / 100,
    ratio_ms: ratio_ms !== null ? Math.round(ratio_ms * 10) / 10 : null,
  })
}
