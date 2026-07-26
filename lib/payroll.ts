// lib/payroll.ts — moteur UNIQUE de masse salariale hebdomadaire (CCN 992).
//
// Source de vérité alignée sur la page Planning :
//   - HS +25 % (contrat → contrat+8h) puis +50 %, calculées sur les heures
//     TRAVAILLÉES uniquement (les CP ne génèrent pas de HS) ;
//   - CP payés à heures contrat ÷ 5 par jour, au taux normal ;
//   - majorations dimanche travaillé +20 %, jour férié travaillé +100 % ;
//   - gérant/propriétaire : non salarié → toutes les heures au taux normal,
//     aucune majoration ni HS ;
//   - charges patronales par employé (défaut 45 %) → coût CHARGÉ.
//
// Avant ce module, trois implémentations divergeaient : le planning (complète),
// le tableau de bord (sans le cas gérant) et le résumé facturation (CP comptés
// 7 h dans la base des HS, aucune majoration, aucune charge patronale — la masse
// salariale y était sous-estimée d'environ 45 %). NE PAS re-dupliquer ce calcul.

export type PayrollEmployee = {
  id: string
  name?: string | null
  hourly_rate: string | number | null
  contract_hours: number | string | null
  charges_patronales?: string | number | null
  is_minor?: boolean | null
  is_gerant?: boolean | null
}

/** Ligne de planning telle que renvoyée par Supabase (colonnes lundi..dimanche + *_type) */
export type PayrollEntry = Record<string, unknown> & { employee_id: string }

/** Colonnes à sélectionner dans `employees` pour alimenter ce moteur */
export const PAYROLL_EMPLOYEE_COLUMNS =
  'id, name, hourly_rate, contract_hours, charges_patronales, is_minor, is_gerant'

/** Colonnes à sélectionner dans `planning_entries` pour alimenter ce moteur */
export const PAYROLL_ENTRY_COLUMNS =
  'employee_id,lundi,mardi,mercredi,jeudi,vendredi,samedi,dimanche,' +
  'lundi_type,mardi_type,mercredi_type,jeudi_type,vendredi_type,samedi_type,dimanche_type'

export const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const

// ─── Dates ────────────────────────────────────────────────────────────────────

/** Les 7 dates (UTC) d'une semaine ISO, du lundi au dimanche */
export function getWeekDates(week: number, year: number): Date[] {
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const dow = jan4.getUTCDay() || 7
  const mon = new Date(jan4)
  mon.setUTCDate(jan4.getUTCDate() - dow + 1 + (week - 1) * 7)
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setUTCDate(mon.getUTCDate() + i); return d })
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

/** Jours fériés français d'une année (dates ISO yyyy-mm-dd) */
export function frenchHolidays(year: number): Set<string> {
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

/** Drapeaux « jour férié » des 7 jours d'une semaine ISO.
 *  La semaine 1 peut contenir des jours de l'année précédente (et la 52/53 de la
 *  suivante) : chaque jour est testé contre les fériés de SA propre année. */
export function weekHolidayFlags(week: number, year: number): boolean[] {
  const dates = getWeekDates(week, year)
  const sets = new Map<number, Set<string>>()
  return dates.map(d => {
    const y = d.getUTCFullYear()
    if (!sets.has(y)) sets.set(y, frenchHolidays(y))
    return sets.get(y)!.has(d.toISOString().slice(0, 10))
  })
}

// ─── Moteur ───────────────────────────────────────────────────────────────────

const num = (v: unknown): number => { const n = parseFloat(String(v ?? '')); return Number.isFinite(n) ? n : 0 }

/** Coût CHARGÉ d'une ligne de planning pour un employé (CCN 992) */
export function entryCost(entry: PayrollEntry, emp: PayrollEmployee, holidayFlags: boolean[]): number {
  const ch = num(emp.contract_hours) || 35
  const rate = num(emp.hourly_rate)
  let workedH = 0, cpDays = 0, sundayH = 0, holidayH = 0
  JOURS.forEach((j, idx) => {
    const t = String(entry[`${j}_type`] ?? 'travail') || 'travail'
    const h = num(entry[j])
    if (t === 'travail' && h > 0) {
      workedH += h
      if (holidayFlags[idx]) holidayH += h
      else if (idx === 6) sundayH += h
    } else if (t === 'conges') cpDays++
  })
  const cpH = cpDays * ch / 5
  let brut: number
  if (emp.is_gerant) {
    // Gérant/propriétaire : non salarié — taux normal sur toutes les heures, aucune majoration
    brut = (workedH + cpH) * rate
  } else {
    const t2 = ch + 8
    let workCost: number
    if (workedH <= ch) workCost = workedH * rate
    else if (workedH <= t2) workCost = ch * rate + (workedH - ch) * rate * 1.25
    else workCost = ch * rate + (t2 - ch) * rate * 1.25 + (workedH - t2) * rate * 1.5
    brut = workCost + cpH * rate + sundayH * rate * 0.20 + holidayH * rate * 1.00
  }
  const chargesPct = emp.charges_patronales === null || emp.charges_patronales === undefined
    ? 45
    : num(emp.charges_patronales)
  return brut * (1 + chargesPct / 100)
}

/** Masse salariale CHARGÉE d'une semaine (somme des employés plannifiés) */
export function computeWeekPayroll(
  entries: PayrollEntry[],
  employees: PayrollEmployee[],
  week: number,
  year: number,
): number {
  const empMap = new Map(employees.map(e => [e.id, e]))
  const holidayFlags = weekHolidayFlags(week, year)
  let total = 0
  for (const entry of entries) {
    const emp = empMap.get(entry.employee_id)
    if (!emp) continue
    total += entryCost(entry, emp, holidayFlags)
  }
  return total
}

/** Alertes légales Code du travail / CCN 992 (le gérant, non salarié, n'est pas concerné) */
export function computeLegalAlerts(entries: PayrollEntry[], employees: PayrollEmployee[]): string[] {
  const empMap = new Map(employees.map(e => [e.id, e]))
  const alerts: string[] = []
  for (const entry of entries) {
    const emp = empMap.get(entry.employee_id)
    if (!emp || emp.is_gerant) continue
    const maxDay = emp.is_minor ? 8 : 10
    const maxWeek = emp.is_minor ? 35 : 48
    let workedH = 0, workedDays = 0, overDay = false
    for (const j of JOURS) {
      const t = String(entry[`${j}_type`] ?? 'travail') || 'travail'
      const h = num(entry[j])
      if (t === 'travail' && h > 0) {
        workedH += h; workedDays++
        if (h > maxDay) overDay = true
      }
    }
    const name = emp.name || 'Employé'
    if (overDay) alerts.push(`${name} : journée > ${maxDay}h${emp.is_minor ? ' (mineur)' : ''}`)
    if (workedH > maxWeek) alerts.push(`${name} : ${workedH.toFixed(1)}h travaillées — max légal ${maxWeek}h`)
    if (workedDays === 7) alerts.push(`${name} : 7 jours travaillés — repos hebdomadaire obligatoire`)
  }
  return alerts
}
