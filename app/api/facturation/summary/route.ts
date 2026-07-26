import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { normalizeSupplierName, sameSupplierFamily } from '@/lib/supplier-memory'
import { weekRecurringCost } from '@/lib/recurring-charges'
import {
  entryCost, entryRayonWeights, weekHolidayFlags,
  PAYROLL_EMPLOYEE_COLUMNS, PAYROLL_ENTRY_COLUMNS,
  type PayrollEmployee, type PayrollEntry,
} from '@/lib/payroll'

export const dynamic = 'force-dynamic'

// Dates (lundi/dimanche) d'une semaine ISO — identiques au calcul de la page facturation.
function getWeekDatesISO(week: number, year: number): [string, string] {
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const dow = jan4.getUTCDay() || 7
  const mon = new Date(jan4)
  mon.setUTCDate(jan4.getUTCDate() - dow + 1 + (week - 1) * 7)
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6)
  return [mon.toISOString().slice(0, 10), sun.toISOString().slice(0, 10)]
}

// « Facture X - 6109622F… » → « X » : on ventile par société, pas par n° de facture.
function supplierSociete(raw: string): string {
  let s = String(raw || '').trim()
  s = s.replace(/^factures?\s+/i, '')
  s = s.split(/\s+[-–—]\s+/)[0]
  return s.trim()
}

// Famille de vente (rapport) → rayon : permet de lire le CA par rayon depuis le rapport,
// sans que l'utilisateur ait à saisir un détail. Correspondance souple sur le nom.
function rayonOfFamily(nom: string): string | null {
  const n = String(nom || '').toLowerCase()
  if (n.includes('bouch')) return 'boucherie'
  if (n.includes('charcut')) return 'charcuterie'
  if (n.includes('traiteur')) return 'traiteur'
  if (n.includes('fruit') || n.includes('legume') || n.includes('légume') || n.includes('primeur')) return 'fruits_et_legumes'
  return null
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
    .select('amount_ht, category, supplier_name, is_fixed_charge, status')
    .eq('client_id', clientId)
    .eq('week_number', week)
    .eq('year', year)

  // Achats VARIABLES uniquement : les charges fixes/récurrentes sont désormais gérées à part
  // (provision étalée au jour près), elles ne doivent plus peser en plein sur leur semaine de saisie.
  // Les factures importées « à vérifier » sont EXCLUES des calculs tant qu'elles ne sont pas
  // validées — même règle que la page Marges (filtre en JS : un status null passe).
  const allVariable = (invoicesData || []).filter((inv: any) => !inv.is_fixed_charge)
  const varInv = allVariable.filter((inv: any) => inv.status !== 'a_verifier')
  const achats_a_verifier = allVariable
    .filter((inv: any) => inv.status === 'a_verifier')
    .reduce((s: number, inv: any) => s + parseFloat(inv.amount_ht || 0), 0)

  const achats_ht = varInv.reduce((s: number, inv: any) => s + parseFloat(inv.amount_ht || 0), 0)

  const achats_by_category: Record<string, number> = {}
  for (const inv of varInv) {
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
  for (const inv of varInv) {
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

  // 2. Masse salariale CHARGÉE depuis le planning — moteur partagé lib/payroll (CCN 992 :
  // HS sur heures travaillées, CP à contrat/5, majorations dimanche/férié, cas gérant,
  // charges patronales). UNIQUEMENT les employés de CE client (cloisonnement critique).
  //
  // Affectation par famille : le coût de chaque employé est réparti d'après les POSTES
  // du planning (schedule_details — journée entière ou créneaux matin/après-midi).
  // Ex. : 20 h pointées « boucherie » sur 40 h travaillées → la moitié du coût chargé
  // de l'employé pèse sur la marge boucherie. Les heures sans poste métier (vente,
  // administratif, livraison, non renseigné) restent transverses : elles comptent dans
  // le taux GLOBAL mais ne sont imputées à aucune des trois familles.
  let masse_salariale = 0
  const salaires_by_rayon: Record<string, number> = { boucherie: 0, charcuterie: 0, traiteur: 0 }
  let salaires_non_affectes = 0
  const { data: employees } = await serviceSupabase
    .from('employees')
    .select(PAYROLL_EMPLOYEE_COLUMNS)
    .eq('client_id', clientId)

  if (employees && employees.length > 0) {
    const { data: planningData } = await serviceSupabase
      .from('planning_entries')
      .select(`${PAYROLL_ENTRY_COLUMNS},schedule_details`)
      .in('employee_id', employees.map((e: any) => e.id))
      .eq('week_number', week)
      .eq('year', year)

    const empMap = new Map((employees as unknown as PayrollEmployee[]).map(e => [e.id, e]))
    const holidayFlags = weekHolidayFlags(week, year)
    for (const entry of (planningData || []) as unknown as PayrollEntry[]) {
      const emp = empMap.get(entry.employee_id)
      if (!emp) continue
      const cost = entryCost(entry, emp, holidayFlags)
      masse_salariale += cost
      const w = entryRayonWeights(entry)
      salaires_by_rayon.boucherie   += cost * w.boucherie
      salaires_by_rayon.charcuterie += cost * w.charcuterie
      salaires_by_rayon.traiteur    += cost * w.traiteur
      salaires_non_affectes         += cost * w.autres
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

  // 2 bis. Charges fixes / récurrentes — provision étalée au jour près sur la semaine,
  // le RÉEL (recurring_actuals) remplaçant la provision sur sa fenêtre (recalcul rétroactif).
  const [monISO, sunISO] = getWeekDatesISO(week, year)
  const { data: recCharges } = await serviceSupabase
    .from('recurring_charges')
    .select('id, label, category, amount_ht, tva_rate, periodicity, start_date, end_date, active')
    .eq('client_id', clientId)
  const { data: recActuals } = await serviceSupabase
    .from('recurring_actuals')
    .select('id, recurring_charge_id, period_start, period_end, amount_ht')
    .eq('client_id', clientId)
  const recur = weekRecurringCost((recCharges || []) as any, (recActuals || []) as any, monISO, sunISO)
  const charges_fixes = recur.total

  const ca_total = parseFloat(caData?.ca_total || 0)
  const marge_brute = ca_total - achats_ht
  const taux_marge = ca_total > 0 ? (marge_brute / ca_total) * 100 : null
  // Marge après salaires = la « marge brute d'exploitation » demandée par les gérants :
  // CA − achats matière − coût employés (chargé). Les charges fixes restent globales
  // (résultat net) — elles ne s'affectent pas à un rayon.
  const marge_apres_salaires = ca_total - achats_ht - masse_salariale
  const taux_apres_salaires = ca_total > 0 ? (marge_apres_salaires / ca_total) * 100 : null
  const resultat_net = marge_brute - masse_salariale - charges_fixes
  const ratio_ms = ca_total > 0 ? (masse_salariale / ca_total) * 100 : null

  // Marge par rayon = CA rayon (weekly_ca) − achats ventilés − salaires pointés au planning
  const round2 = (n: number) => Math.round(n * 100) / 100
  const round1 = (n: number) => Math.round(n * 10) / 10
  const RAYONS = ['boucherie', 'charcuterie', 'traiteur', 'fruits_et_legumes'] as const

  // CA par rayon — lu automatiquement depuis le rapport (families_detail).
  // Repli sur les champs ca_* saisis uniquement si le rapport n'a pas encore de détail par famille.
  const caByRayon: Record<string, number> = { boucherie: 0, charcuterie: 0, traiteur: 0, fruits_et_legumes: 0 }
  const fams: any[] = Array.isArray((caData as any)?.families_detail) ? (caData as any).families_detail : []
  for (const f of fams) { const rr = rayonOfFamily(f?.nom); if (rr) caByRayon[rr] += Number(f?.montant) || 0 }
  let caRayonSum = RAYONS.reduce((s, r) => s + caByRayon[r], 0)
  if (caRayonSum === 0) {
    for (const r of RAYONS) { const v = parseFloat((caData as any)?.[`ca_${r}`] || 0) || 0; caByRayon[r] = v; caRayonSum += v }
  }
  // Redistribution du « divers » sur les 4 rayons, au prorata de leur part de CA
  // (à défaut de CA par rayon renseigné : répartition égale)
  if (achats_divers > 0) {
    for (const r of RAYONS) {
      const share = caRayonSum > 0 ? caByRayon[r] / caRayonSum : 1 / RAYONS.length
      achats_by_rayon[r] += achats_divers * share
    }
  }
  // Salaires par famille = UNIQUEMENT le coût des heures pointées sur le poste dans le
  // planning (taux EXACT demandé par les gérants). Aucun prorata : les salaires sans
  // poste restent hors familles — ils pèsent sur le taux global et le résultat net.
  // fruits_et_legumes n'a pas de poste au planning → jamais de salaires directs.
  const marge_by_rayon: Record<string, {
    ca: number; achats: number; salaires: number
    marge: number; taux: number | null
    marge_totale: number; taux_totale: number | null
  }> = {}
  for (const r of RAYONS) {
    const caR = caByRayon[r] || 0
    const achR = achats_by_rayon[r] || 0
    const salR = salaires_by_rayon[r] || 0
    marge_by_rayon[r] = {
      ca: round2(caR),
      achats: round2(achR),
      salaires: round2(salR),
      marge: round2(caR - achR),
      taux: caR > 0 ? round1(((caR - achR) / caR) * 100) : null,
      marge_totale: round2(caR - achR - salR),
      taux_totale: caR > 0 ? round1(((caR - achR - salR) / caR) * 100) : null,
    }
  }
  const salaires_affectes_total = salaires_by_rayon.boucherie + salaires_by_rayon.charcuterie + salaires_by_rayon.traiteur

  return NextResponse.json({
    achats_ht: round2(achats_ht),
    achats_a_verifier: round2(achats_a_verifier),
    achats_by_category,
    achats_by_rayon: Object.fromEntries(Object.entries(achats_by_rayon).map(([k, v]) => [k, round2(v)])),
    achats_non_ventiles: round2(achats_non_ventiles),
    achats_divers: round2(achats_divers),
    marge_by_rayon,
    masse_salariale: round2(masse_salariale),
    salaires_affectes: round2(salaires_affectes_total),
    salaires_non_affectes: round2(salaires_non_affectes),
    charges_fixes: round2(charges_fixes),
    charges_fixes_lines: recur.lines,
    ca_total,
    ca_detail: caData || null,
    marge_brute: round2(marge_brute),
    taux_marge: taux_marge !== null ? round1(taux_marge) : null,
    marge_apres_salaires: round2(marge_apres_salaires),
    taux_apres_salaires: taux_apres_salaires !== null ? round1(taux_apres_salaires) : null,
    resultat_net: round2(resultat_net),
    ratio_ms: ratio_ms !== null ? round1(ratio_ms) : null,
  })
}
