// lib/week-economics.ts — moteur UNIQUE de l'économie d'une semaine.
//
// Achats ventilés, salaires pointés au planning, charges fixes étalées, marge par
// famille : tout le monde lit ce module, personne ne recalcule dans son coin.
//   - app/api/facturation/summary  → CA lu dans weekly_ca ;
//   - app/api/reports/generate     → CA fraîchement extrait des PDF de la semaine,
//     weekly_ca n'étant écrit qu'APRÈS la génération du rapport.
// Le CA est donc une ENTRÉE du calcul, jamais une lecture cachée : c'est la seule
// façon d'obtenir les mêmes chiffres à l'écran et dans le PDF.

import { normalizeSupplierName, sameSupplierFamily, supplierSociete } from '@/lib/supplier-memory'
import { weekRecurringCost } from '@/lib/recurring-charges'
import {
  entryCost, entryPosteHours, weekHolidayFlags, getWeekDates,
  PAYROLL_EMPLOYEE_COLUMNS, PAYROLL_ENTRY_COLUMNS,
  type PayrollEmployee, type PayrollEntry,
} from '@/lib/payroll'
import { parseCustomPostes, parseMarginFamilies, posteLabel, familleMatchesText, classicRayonOfLabel } from '@/lib/postes'
import type { createServiceClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceClient>

/** CA de la semaine, fourni par l'appelant (rapport hebdo ou weekly_ca) */
export type CaInput = {
  ca_total: number
  /** Familles de vente telles qu'elles sortent du rapport (nom libre, montant) */
  familles?: { nom: string; montant: number }[] | null
  /** Repli saisi à la main, par clé de rayon classique (boucherie, charcuterie…) */
  by_rayon?: Record<string, number> | null
}

/** Marge d'une famille choisie par le client (clé de poste du planning) */
export type FamilleEconomics = {
  key: string
  label: string
  ca: number
  achats: number
  achats_ventiles: boolean
  salaires: number
  marge: number
  taux: number | null
  marge_totale: number
  taux_totale: number | null
}

export type WeekEconomics = {
  achats_ht: number
  achats_a_verifier: number
  achats_by_category: Record<string, number>
  achats_by_rayon: Record<string, number>
  achats_non_ventiles: number
  achats_divers: number
  familles: FamilleEconomics[]
  masse_salariale: number
  salaires_affectes: number
  salaires_non_affectes: number
  charges_fixes: number
  charges_fixes_lines: ReturnType<typeof weekRecurringCost>['lines']
  ca_total: number
  marge_brute: number
  taux_marge: number | null
  marge_apres_salaires: number
  taux_apres_salaires: number | null
  resultat_net: number
  ratio_ms: number | null
}

// Les 4 rayons de la ventilation fournisseur (colonnes de supplier_rayon_splits)
const VENT_RAYONS = [
  { key: 'boucherie',         label: 'Boucherie' },
  { key: 'charcuterie',       label: 'Charcuterie' },
  { key: 'traiteur',          label: 'Traiteur' },
  { key: 'fruits_et_legumes', label: 'Fruits et légumes' },
] as const

const RAYONS = ['boucherie', 'charcuterie', 'traiteur', 'fruits_et_legumes'] as const

/** Dates ISO (lundi, dimanche) d'une semaine — dérivées du calendrier de lib/payroll */
function weekBoundsISO(week: number, year: number): [string, string] {
  const dates = getWeekDates(week, year)
  return [dates[0].toISOString().slice(0, 10), dates[6].toISOString().slice(0, 10)]
}

const round2 = (n: number) => Math.round(n * 100) / 100
const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * Économie complète d'une semaine pour un client : achats, salaires, charges
 * fixes et marge par famille. Le CA vient de l'appelant (cf. CaInput).
 */
export async function computeWeekEconomics(
  supabase: ServiceClient,
  clientId: string,
  week: number,
  year: number,
  ca: CaInput,
): Promise<WeekEconomics> {
  // 0. Configuration du client : postes personnalisés + les 3 familles de marge choisies.
  const { data: clientRow } = await supabase
    .from('clients').select('custom_postes, margin_families').eq('id', clientId).maybeSingle()
  const customPostes = parseCustomPostes(clientRow?.custom_postes)
  const familleKeys = parseMarginFamilies(clientRow?.margin_families)
  const familles = familleKeys.map(key => ({ key, label: posteLabel(key, customPostes) }))
  // Reconnaissance floue : première famille (dans l'ordre choisi) qui reconnaît le texte.
  const familleFor = (textKey: string, textLabel?: string): number => {
    for (let i = 0; i < familles.length; i++) {
      if (familleMatchesText(familles[i].key, familles[i].label, textKey, textLabel)) return i
    }
    return -1
  }

  // 1. Achats HT de la semaine
  const { data: invoicesData } = await supabase
    .from('invoices')
    .select('amount_ht, category, supplier_name, is_fixed_charge, status')
    .eq('client_id', clientId)
    .eq('week_number', week)
    .eq('year', year)

  // Achats VARIABLES uniquement : les charges fixes/récurrentes sont gérées à part
  // (provision étalée au jour près). Les factures importées « à vérifier » sont
  // EXCLUES des calculs tant qu'elles ne sont pas validées.
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

  // 1 bis. Ventilation des achats par rayon (répartition par fournisseur)
  const { data: splitRows } = await supabase
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

  // 2. Masse salariale CHARGÉE depuis le planning — moteur partagé lib/payroll (CCN 992).
  // Le coût de chaque employé est réparti d'après les POSTES pointés dans le planning,
  // puis rattaché aux familles de marge par reconnaissance floue (« boucher » ≈
  // « boucherie »). Les heures dont le poste ne correspond à aucune famille restent
  // transverses : comptées dans le taux GLOBAL, imputées à aucune famille.
  let masse_salariale = 0
  const salaires_by_famille = [0, 0, 0]
  let salaires_non_affectes = 0
  const { data: employees } = await supabase
    .from('employees')
    .select(PAYROLL_EMPLOYEE_COLUMNS)
    .eq('client_id', clientId)

  if (employees && employees.length > 0) {
    const { data: planningData } = await supabase
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
      const { hours, worked } = entryPosteHours(entry)
      if (worked <= 0) { salaires_non_affectes += cost; continue }
      for (const [posteKey, h] of Object.entries(hours)) {
        const share = cost * (h / worked)
        const fi = posteKey ? familleFor(posteKey, posteLabel(posteKey, customPostes)) : -1
        if (fi >= 0) salaires_by_famille[fi] += share
        else salaires_non_affectes += share
      }
    }
  }

  // 3. Charges fixes / récurrentes — provision étalée au jour près sur la semaine,
  // le RÉEL (recurring_actuals) remplaçant la provision sur sa fenêtre.
  const [monISO, sunISO] = weekBoundsISO(week, year)
  const { data: recCharges } = await supabase
    .from('recurring_charges')
    .select('id, label, category, amount_ht, tva_rate, periodicity, start_date, end_date, active')
    .eq('client_id', clientId)
  const { data: recActuals } = await supabase
    .from('recurring_actuals')
    .select('id, recurring_charge_id, period_start, period_end, amount_ht')
    .eq('client_id', clientId)
  const recur = weekRecurringCost((recCharges || []) as any, (recActuals || []) as any, monISO, sunISO)
  const charges_fixes = recur.total

  // 4. CA — fourni par l'appelant
  const ca_total = Number(ca.ca_total) || 0
  const marge_brute = ca_total - achats_ht
  const taux_marge = ca_total > 0 ? (marge_brute / ca_total) * 100 : null
  // Marge après salaires = la « marge brute d'exploitation » que vient chercher le
  // gérant : CA − achats matière − coût employés (chargé). Les charges fixes restent
  // globales (résultat net) — elles ne s'affectent pas à une famille.
  const marge_apres_salaires = ca_total - achats_ht - masse_salariale
  const taux_apres_salaires = ca_total > 0 ? (marge_apres_salaires / ca_total) * 100 : null
  const resultat_net = marge_brute - masse_salariale - charges_fixes
  const ratio_ms = ca_total > 0 ? (masse_salariale / ca_total) * 100 : null

  // CA par rayon CLASSIQUE — lu depuis les familles de vente du rapport, repli sur
  // les montants saisis. Sert à la redistribution du « divers » et au repli de CA
  // des familles classiques.
  const caByRayon: Record<string, number> = { boucherie: 0, charcuterie: 0, traiteur: 0, fruits_et_legumes: 0 }
  const fams: { nom: string; montant: number }[] = Array.isArray(ca.familles) ? ca.familles : []
  for (const f of fams) { const rr = classicRayonOfLabel(f?.nom); if (rr && rr in caByRayon) caByRayon[rr] += Number(f?.montant) || 0 }
  let caRayonSum = RAYONS.reduce((s, r) => s + caByRayon[r], 0)
  if (caRayonSum === 0) {
    for (const r of RAYONS) { const v = Number(ca.by_rayon?.[r]) || 0; caByRayon[r] = v; caRayonSum += v }
  }
  // Redistribution du « divers » sur les 4 rayons, au prorata de leur part de CA
  // (à défaut de CA par rayon renseigné : répartition égale)
  if (achats_divers > 0) {
    for (const r of RAYONS) {
      const share = caRayonSum > 0 ? caByRayon[r] / caRayonSum : 1 / RAYONS.length
      achats_by_rayon[r] += achats_divers * share
    }
  }

  // CA par FAMILLE de marge : chaque famille de vente est rattachée à la première
  // famille qui la reconnaît (flou). Repli : une famille sans CA reconnu qui
  // correspond à un rayon classique reprend le CA de ce rayon.
  const caByFamille = [0, 0, 0]
  for (const f of fams) {
    const fi = familleFor('', String(f?.nom ?? ''))
    if (fi >= 0) caByFamille[fi] += Number(f?.montant) || 0
  }
  const rayonClaimedByFamille: number[] = VENT_RAYONS.map(r => familleFor(r.key, r.label))
  for (let i = 0; i < familles.length; i++) {
    if (caByFamille[i] > 0) continue
    const ri = rayonClaimedByFamille.findIndex(fi => fi === i)
    if (ri >= 0) caByFamille[i] = caByRayon[VENT_RAYONS[ri].key] || 0
  }

  // Achats par famille : la famille récupère les rayons de ventilation qu'elle
  // reconnaît (un rayon ne compte que pour une seule famille — la première).
  const famillesOut: FamilleEconomics[] = familles.map((f, i) => {
    const claimed = VENT_RAYONS.filter((_, ri) => rayonClaimedByFamille[ri] === i)
    const achR = claimed.reduce((s, r) => s + (achats_by_rayon[r.key] || 0), 0)
    const caR = caByFamille[i] || 0
    const salR = salaires_by_famille[i] || 0
    return {
      key: f.key,
      label: f.label,
      ca: round2(caR),
      achats: round2(achR),
      achats_ventiles: claimed.length > 0,
      salaires: round2(salR),
      marge: round2(caR - achR),
      taux: caR > 0 ? round1(((caR - achR) / caR) * 100) : null,
      marge_totale: round2(caR - achR - salR),
      taux_totale: caR > 0 ? round1(((caR - achR - salR) / caR) * 100) : null,
    }
  })
  const salaires_affectes_total = salaires_by_famille[0] + salaires_by_famille[1] + salaires_by_famille[2]

  return {
    achats_ht: round2(achats_ht),
    achats_a_verifier: round2(achats_a_verifier),
    achats_by_category,
    achats_by_rayon: Object.fromEntries(Object.entries(achats_by_rayon).map(([k, v]) => [k, round2(v)])),
    achats_non_ventiles: round2(achats_non_ventiles),
    achats_divers: round2(achats_divers),
    familles: famillesOut,
    masse_salariale: round2(masse_salariale),
    salaires_affectes: round2(salaires_affectes_total),
    salaires_non_affectes: round2(salaires_non_affectes),
    charges_fixes: round2(charges_fixes),
    charges_fixes_lines: recur.lines,
    ca_total,
    marge_brute: round2(marge_brute),
    taux_marge: taux_marge !== null ? round1(taux_marge) : null,
    marge_apres_salaires: round2(marge_apres_salaires),
    taux_apres_salaires: taux_apres_salaires !== null ? round1(taux_apres_salaires) : null,
    resultat_net: round2(resultat_net),
    ratio_ms: ratio_ms !== null ? round1(ratio_ms) : null,
  }
}
