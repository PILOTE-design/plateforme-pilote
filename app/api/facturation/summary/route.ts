import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { normalizeSupplierName, sameSupplierFamily } from '@/lib/supplier-memory'

export const dynamic = 'force-dynamic'

// « Facture X - 6109622F… » → « X » : on ventile par société, pas par n° de facture.
function supplierSociete(raw: string): string {
  let s = String(raw || '').trim()
  s = s.replace(/^factures?\s+/i, '')
  s = s.split(/\s+[-–—]\s+/)[0]
  return s.trim()
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
    .select('amount_ht, category, supplier_name')
    .eq('client_id', clientId)
    .eq('week_number', week)
    .eq('year', year)

  const achats_ht = (invoicesData || []).reduce((s: number, inv: any) => s + parseFloat(inv.amount_ht || 0), 0)

  const achats_by_category: Record<string, number> = {}
  for (const inv of invoicesData || []) {
    const cat = inv.category || 'autre'
    achats_by_category[cat] = (achats_by_category[cat] || 0) + parseFloat(inv.amount_ht || 0)
  }

  // 1 bis. Ventilation des achats par rayon (répartition par fournisseur, cf. supplier_rayon_splits)
  const { data: splitRows } = await serviceSupabase
    .from('supplier_rayon_splits')
    .select('supplier_key, pct_boucherie, pct_charcuterie, pct_traiteur, pct_fruits_et_legumes, pct_divers')
    .eq('client_id', clientId)
  const splitList = splitRows || []

  const splitFor = (supplierName: string) => {
    const q = normalizeSupplierName(supplierSociete(supplierName))
    if (!q) return null
    let best: any = null
    for (const s of splitList) {
      if (s.supplier_key === q) return s
      if (sameSupplierFamily(s.supplier_key, q) && (best === null || String(s.supplier_key).length > String(best.supplier_key).length)) best = s
    }
    return best
  }

  // 4 rayons réels ; le « divers » est accumulé à part puis redistribué au prorata du CA
  const achats_by_rayon: Record<string, number> = { boucherie: 0, charcuterie: 0, traiteur: 0, fruits_et_legumes: 0 }
  let achats_non_ventiles = 0
  let achats_divers = 0
  for (const inv of invoicesData || []) {
    const amt = parseFloat(inv.amount_ht || 0)
    if (!amt) continue
    const sp = splitFor(inv.supplier_name)
    const tot = sp ? (Number(sp.pct_boucherie) + Number(sp.pct_charcuterie) + Number(sp.pct_traiteur) + Number(sp.pct_fruits_et_legumes) + Number(sp.pct_divers)) : 0
    if (!sp || tot <= 0) { achats_non_ventiles += amt; continue }
    achats_by_rayon.boucherie         += amt * (Number(sp.pct_boucherie)         / tot)
    achats_by_rayon.charcuterie       += amt * (Number(sp.pct_charcuterie)       / tot)
    achats_by_rayon.traiteur          += amt * (Number(sp.pct_traiteur)          / tot)
    achats_by_rayon.fruits_et_legumes += amt * (Number(sp.pct_fruits_et_legumes) / tot)
    achats_divers                     += amt * (Number(sp.pct_divers)            / tot)
  }

  // 2. Masse salariale depuis planning — UNIQUEMENT les employés de CE client.
  // Cloisonnement critique : sans ce filtre, la requête additionnait les
  // plannings de TOUS les clients de la plateforme pour la même semaine.
  let masse_salariale = 0
  const { data: employees } = await serviceSupabase
    .from('employees')
    .select('id, hourly_rate, contract_type, contract_hours')
    .eq('client_id', clientId)

  if (employees && employees.length > 0) {
    const { data: planningData } = await serviceSupabase
      .from('planning_entries')
      .select('lundi, mardi, mercredi, jeudi, vendredi, samedi, dimanche, lundi_type, mardi_type, mercredi_type, jeudi_type, vendredi_type, samedi_type, dimanche_type, employee_id')
      .in('employee_id', employees.map((e: any) => e.id))
      .eq('week_number', week)
      .eq('year', year)

    const empMap: Record<string, any> = {}
    for (const emp of employees) empMap[emp.id] = emp

    const CONTRACT_HOURS: Record<string, number> = { CDI_35: 35, CDI_39: 39, CDD_35: 35, CDD_39: 39 }
    const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']

    for (const entry of planningData || []) {
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

  // Marge par rayon = CA rayon (weekly_ca) − achats ventilés du rayon
  const round2 = (n: number) => Math.round(n * 100) / 100
  const RAYONS = ['boucherie', 'charcuterie', 'traiteur', 'fruits_et_legumes'] as const

  // Redistribution du « divers » sur les 4 rayons, au prorata de leur part de CA
  // (à défaut de CA par rayon renseigné : répartition égale)
  const caByRayon: Record<string, number> = {}
  let caRayonSum = 0
  for (const r of RAYONS) { const v = parseFloat((caData as any)?.[`ca_${r}`] || 0) || 0; caByRayon[r] = v; caRayonSum += v }
  if (achats_divers > 0) {
    for (const r of RAYONS) {
      const share = caRayonSum > 0 ? caByRayon[r] / caRayonSum : 1 / RAYONS.length
      achats_by_rayon[r] += achats_divers * share
    }
  }
  const marge_by_rayon: Record<string, { ca: number; achats: number; marge: number; taux: number | null }> = {}
  for (const r of RAYONS) {
    const caR = parseFloat((caData as any)?.[`ca_${r}`] || 0)
    const achR = achats_by_rayon[r] || 0
    marge_by_rayon[r] = {
      ca: round2(caR),
      achats: round2(achR),
      marge: round2(caR - achR),
      taux: caR > 0 ? Math.round(((caR - achR) / caR) * 1000) / 10 : null,
    }
  }

  return NextResponse.json({
    achats_ht: Math.round(achats_ht * 100) / 100,
    achats_by_category,
    achats_by_rayon: Object.fromEntries(Object.entries(achats_by_rayon).map(([k, v]) => [k, round2(v)])),
    achats_non_ventiles: round2(achats_non_ventiles),
    achats_divers: round2(achats_divers),
    marge_by_rayon,
    masse_salariale: Math.round(masse_salariale * 100) / 100,
    ca_total,
    ca_detail: caData || null,
    marge_brute: Math.round(marge_brute * 100) / 100,
    taux_marge: taux_marge !== null ? Math.round(taux_marge * 10) / 10 : null,
    resultat_net: Math.round(resultat_net * 100) / 100,
    ratio_ms: ratio_ms !== null ? Math.round(ratio_ms * 10) / 10 : null,
  })
}
