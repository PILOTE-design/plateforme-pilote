// lib/recurring-charges.ts
// Proration « au jour près » des charges récurrentes.
//
// Principe : chaque charge récurrente définit un montant PAR PÉRIODE (mensuel, trimestriel,
// semestriel, annuel, hebdo). On répartit ce montant sur les jours réels de la période civile
// qui la contient (taux journalier = montant / nombre de jours de la période). Le coût d'une
// semaine = somme des taux journaliers de ses 7 jours (seulement ceux dans la fenêtre active).
//
// Réconciliation : un « réel » (recurring_actuals) REMPLACE la provision sur sa fenêtre exacte
// [period_start, period_end] — sur ces jours, le taux journalier = réel / (jours de la fenêtre).

export type Periodicity = 'weekly' | 'monthly' | 'quarterly' | 'semester' | 'annual'

export type RecurringCharge = {
  id: string
  label: string
  category: string
  amount_ht: number
  tva_rate: number
  periodicity: Periodicity
  start_date: string        // 'YYYY-MM-DD'
  end_date: string | null   // 'YYYY-MM-DD' ou null (en cours)
  active: boolean
}

export type RecurringActual = {
  id: string
  recurring_charge_id: string
  period_start: string      // 'YYYY-MM-DD'
  period_end: string        // 'YYYY-MM-DD'
  amount_ht: number
}

// ── Utilitaires date (UTC, pour éviter toute dérive de fuseau) ──
export function parseISO(s: string): Date {
  const [y, m, d] = String(s).split('-').map(Number)
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1))
}
export function toISO(d: Date): string {
  return d.toISOString().slice(0, 10)
}
export function addDays(d: Date, n: number): Date {
  const r = new Date(d.getTime()); r.setUTCDate(r.getUTCDate() + n); return r
}
/** Nombre de jours inclus entre a et b (a<=b) : daysInclusive(1er, 31) = 31 */
export function daysInclusive(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1
}
function lastDayOfMonth(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate()
}

export type PeriodOccurrence = { start: Date; end: Date; key: string; label: string }

const MONTHS_ABBR = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.']

/** Période civile (occurrence) qui contient `day`, alignée sur le calendrier. */
export function periodBounds(day: Date, periodicity: Periodicity): PeriodOccurrence {
  const y = day.getUTCFullYear()
  const m0 = day.getUTCMonth()
  if (periodicity === 'weekly') {
    // Semaine ISO (lundi → dimanche)
    const dow = (day.getUTCDay() + 6) % 7 // 0 = lundi
    const start = addDays(day, -dow)
    const end = addDays(start, 6)
    return { start, end, key: `${toISO(start)}`, label: `Semaine du ${start.getUTCDate()}/${start.getUTCMonth() + 1}` }
  }
  if (periodicity === 'monthly') {
    const start = new Date(Date.UTC(y, m0, 1))
    const end = new Date(Date.UTC(y, m0, lastDayOfMonth(y, m0)))
    return { start, end, key: `${y}-${String(m0 + 1).padStart(2, '0')}`, label: `${MONTHS_ABBR[m0]} ${y}` }
  }
  if (periodicity === 'quarterly') {
    const q = Math.floor(m0 / 3)          // 0..3
    const sm = q * 3
    const start = new Date(Date.UTC(y, sm, 1))
    const end = new Date(Date.UTC(y, sm + 2, lastDayOfMonth(y, sm + 2)))
    return { start, end, key: `${y}-T${q + 1}`, label: `T${q + 1} ${y}` }
  }
  if (periodicity === 'semester') {
    const h = m0 < 6 ? 0 : 6
    const start = new Date(Date.UTC(y, h, 1))
    const end = new Date(Date.UTC(y, h + 5, lastDayOfMonth(y, h + 5)))
    return { start, end, key: `${y}-S${h === 0 ? 1 : 2}`, label: `S${h === 0 ? 1 : 2} ${y}` }
  }
  // annual
  const start = new Date(Date.UTC(y, 0, 1))
  const end = new Date(Date.UTC(y, 11, 31))
  return { start, end, key: `${y}`, label: `${y}` }
}

/** La charge est-elle active le jour `d` ? (dans [start_date, end_date] et active) */
function activeOn(charge: RecurringCharge, d: Date): boolean {
  if (!charge.active) return false
  const start = parseISO(charge.start_date)
  if (d.getTime() < start.getTime()) return false
  if (charge.end_date) { const end = parseISO(charge.end_date); if (d.getTime() > end.getTime()) return false }
  return true
}

/** Réel couvrant le jour `d` pour cette charge (le 1er trouvé), ou null. */
function actualOn(actuals: RecurringActual[], chargeId: string, d: Date): RecurringActual | null {
  const t = d.getTime()
  for (const a of actuals) {
    if (a.recurring_charge_id !== chargeId) continue
    if (parseISO(a.period_start).getTime() <= t && t <= parseISO(a.period_end).getTime()) return a
  }
  return null
}

/** Taux journalier d'une charge le jour `d` (réel si présent, sinon provision), 0 si inactive. */
export function dailyRate(charge: RecurringCharge, actuals: RecurringActual[], d: Date): number {
  if (!activeOn(charge, d)) return 0
  const act = actualOn(actuals, charge.id, d)
  if (act) {
    const denom = daysInclusive(parseISO(act.period_start), parseISO(act.period_end))
    return denom > 0 ? Number(act.amount_ht) / denom : 0
  }
  const pb = periodBounds(d, charge.periodicity)
  const denom = daysInclusive(pb.start, pb.end)
  return denom > 0 ? Number(charge.amount_ht) / denom : 0
}

/** Coût d'UNE charge sur la fenêtre [startISO, endISO] inclus (réel remplace provision). */
export function costForWindow(charge: RecurringCharge, actuals: RecurringActual[], startISO: string, endISO: string): number {
  const start = parseISO(startISO), end = parseISO(endISO)
  let total = 0
  for (let d = new Date(start.getTime()); d.getTime() <= end.getTime(); d = addDays(d, 1)) {
    total += dailyRate(charge, actuals, d)
  }
  return Math.round(total * 100) / 100
}

/** Provision PURE (sans réel) d'une charge sur une fenêtre — pour l'écart de réconciliation. */
export function provisionForWindow(charge: RecurringCharge, startISO: string, endISO: string): number {
  const start = parseISO(startISO), end = parseISO(endISO)
  let total = 0
  for (let d = new Date(start.getTime()); d.getTime() <= end.getTime(); d = addDays(d, 1)) {
    if (!activeOn(charge, d)) continue
    const pb = periodBounds(d, charge.periodicity)
    const denom = daysInclusive(pb.start, pb.end)
    if (denom > 0) total += Number(charge.amount_ht) / denom
  }
  return Math.round(total * 100) / 100
}

export type WeekCostLine = { id: string; label: string; category: string; cost: number; hasActual: boolean }

/** Coût hebdo de TOUTES les charges + détail par charge (pour le résultat net et l'affichage). */
export function weekRecurringCost(
  charges: RecurringCharge[],
  actuals: RecurringActual[],
  weekStartISO: string,
  weekEndISO: string,
): { total: number; lines: WeekCostLine[] } {
  const lines: WeekCostLine[] = []
  let total = 0
  const start = parseISO(weekStartISO), end = parseISO(weekEndISO)
  for (const c of charges) {
    let cost = 0, hasActual = false
    for (let d = new Date(start.getTime()); d.getTime() <= end.getTime(); d = addDays(d, 1)) {
      if (!activeOn(c, d)) continue
      if (actualOn(actuals, c.id, d)) hasActual = true
      cost += dailyRate(c, actuals, d)
    }
    cost = Math.round(cost * 100) / 100
    if (cost !== 0 || hasActual) lines.push({ id: c.id, label: c.label, category: c.category, cost, hasActual })
    total += cost
  }
  return { total: Math.round(total * 100) / 100, lines }
}

/** Occurrences de période d'une charge chevauchant [fromISO, toISO] (pour la réconciliation). */
export function enumeratePeriods(charge: RecurringCharge, fromISO: string, toISO: string): PeriodOccurrence[] {
  const activeStart = parseISO(charge.start_date)
  const from0 = parseISO(fromISO)
  let cursor = from0.getTime() > activeStart.getTime() ? from0 : activeStart
  const to = parseISO(toISO)
  const hardEnd = charge.end_date && parseISO(charge.end_date).getTime() < to.getTime() ? parseISO(charge.end_date) : to
  const out: PeriodOccurrence[] = []
  let guard = 0
  while (cursor.getTime() <= hardEnd.getTime() && guard++ < 600) {
    const pb = periodBounds(cursor, charge.periodicity)
    out.push(pb)
    cursor = addDays(pb.end, 1)
  }
  return out
}
