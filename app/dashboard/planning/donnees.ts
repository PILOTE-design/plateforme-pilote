/**
 * LA PAGE PLANNING — types, constantes et calculs d'affichage.
 *
 * Extraits de `page.tsx`, qui avait atteint 113 809 octets : au-delà, l'outil
 * de publication ne peut plus réémettre le fichier d'un seul tenant, et la page
 * devient tout simplement impossible à modifier. Le contenu est déplacé tel
 * quel — aucune règle n'est réécrite au passage.
 *
 * Rien ici ne calcule d'heures ni de coût : ces trois adaptateurs se contentent
 * de typer les objets de la page pour le moteur unique de `lib/payroll`.
 */

import { getWeekDates, entryHours, entryBrutCost, chargeMultiplier, type PayrollEmployee, type PayrollEntry } from '@/lib/payroll'
import { TYPES_CONTRAT } from '@/lib/contrat'
import { RAYONS, TEINTES_PERSONNALISEES } from '@/lib/rayons'

/** Le récapitulatif d'une ligne de la grille — calculé une fois, lu partout. */
export type StatLigne = {
  empId: string; name: string
  totalH: number; workedH: number
  cost: number; charged: number
  /** Heures majorées de la semaine (0 pour le gérant, qui n'en a jamais) */
  dimancheH: number; ferieH: number
  alerts: string[]
}

export type DayType = 'travail' | 'conges' | 'maladie' | 'repos'

export const JOURS_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
export const JOURS_DB = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const
export type JourDB = typeof JOURS_DB[number]

export type ScheduleDetail = {
  matin_debut?: string
  matin_fin?: string
  apmidi_debut?: string
  apmidi_fin?: string
  categorie?: string        // legacy : poste pour toute la journée
  categorie_matin?: string  // poste PRINCIPAL du matin (impression/envoi le lisent — inchangés)
  categorie_apmidi?: string // poste PRINCIPAL de l'après-midi
  postes_matin?: string[]   // MULTI-POSTES du matin — les heures du créneau se partagent à parts égales
  postes_apmidi?: string[]  // MULTI-POSTES de l'après-midi
  decoupe?: string          // temps de découpe du jour (min) — imputé à la valorisation
}
export type ScheduleDetails = Partial<Record<JourDB, ScheduleDetail>>

export type PosteDef = { key: string; short: string; abbr: string; color: string }

// Les couleurs viennent de lib/rayons. Elles étaient définies ICI **et** dans
// la facturation, avec deux valeurs différentes : la boucherie était
// `bg-red-100` d'un côté, `bg-red-50` de l'autre, et le point du camembert
// `#b91c1c`. Le même métier changeait d'apparence selon l'écran.
//
// Les teintes de Tailwind employées jusqu'ici tombaient par ailleurs sous le
// seuil lisible dès qu'elles portaient un libellé : `text-red-700` sur
// `bg-red-100` passe, mais rien ne le garantissait — personne ne l'avait
// mesuré. Celles de lib/rayons sont toutes vérifiées au-dessus de 4,5:1.
export const CATEGORIES: PosteDef[] = RAYONS
  .filter(r => r.cle !== 'divers')
  .map(r => ({ key: r.cle, short: r.label, abbr: r.abrege, color: r.pastille }))

// Couleurs des postes PERSONNALISÉS du client — même source, même garantie de
// lisibilité. Attribution cyclique par index, donc stable dans le temps : la
// couleur d'un poste ne change jamais une fois qu'il est créé.
export const CUSTOM_POSTE_COLORS = TEINTES_PERSONNALISEES.map(t => t.pastille)

/** Abréviation d'un libellé de poste personnalisé pour les badges compacts */
export function abbrOf(label: string): string {
  return label.length > 7 ? label.slice(0, 6) + '.' : label
}

export const TYPE_CONFIG: Record<DayType, {
  label: string; bg: string; text: string; dot: string; defaultHours: number; pdfColor: string; display: string
}> = {
  travail: { label: 'Travail',        bg: '',            text: '',              dot: '',           defaultHours: 0, pdfColor: '',        display: '' },
  conges:  { label: 'Congé payé',    bg: 'bg-sky-100',  text: 'text-sky-800',  dot: 'bg-sky-400', defaultHours: 7, pdfColor: '#bae6fd', display: 'CP' },
  maladie: { label: 'Arrêt maladie', bg: 'bg-red-100',  text: 'text-red-800',  dot: 'bg-red-400', defaultHours: 0, pdfColor: '#fecaca', display: 'AM' },
  repos:   { label: 'Repos',          bg: 'bg-gray-100', text: 'text-gray-400', dot: 'bg-gray-300', defaultHours: 0, pdfColor: '#f3f4f6', display: '—' },
}

/** Les types de contrat viennent de lib/contrat. Cette liste existait ici, dans
 *  la fiche employé et côté admin, avec trois contenus différents : le planning
 *  ignorait Apprenti et Intérim, qu'on pouvait pourtant enregistrer depuis la
 *  fiche. Une seule source désormais — ces deux types apparaissent donc ici. */
export const CONTRACT_TYPES = TYPES_CONTRAT.map(t => ({
  key: t.key, label: t.label, short: t.short, hours: t.heures,
  // Le seuil se déduit du contrat : la première heure au-delà est majorée.
  desc: `+25 % dès ${t.heures + 1}h`,
}))
export type ContractKey = string

export const EMP_PALETTES = [
  { bg: 'bg-violet-100', lborder: 'border-l-4 border-l-violet-400', text: 'text-violet-900', dot: 'bg-violet-500', hex: '#8b5cf6', lightHex: '#ede9fe' },
  { bg: 'bg-pink-100',   lborder: 'border-l-4 border-l-pink-400',   text: 'text-pink-900',   dot: 'bg-pink-500',   hex: '#ec4899', lightHex: '#fce7f3' },
  { bg: 'bg-sky-100',    lborder: 'border-l-4 border-l-sky-400',    text: 'text-sky-900',    dot: 'bg-sky-500',    hex: '#0ea5e9', lightHex: '#e0f2fe' },
  { bg: 'bg-orange-100', lborder: 'border-l-4 border-l-orange-400', text: 'text-orange-900', dot: 'bg-orange-500', hex: '#f97316', lightHex: '#ffedd5' },
  { bg: 'bg-teal-100',   lborder: 'border-l-4 border-l-teal-500',   text: 'text-teal-900',   dot: 'bg-teal-500',   hex: '#14b8a6', lightHex: '#ccfbf1' },
  { bg: 'bg-rose-100',   lborder: 'border-l-4 border-l-rose-400',   text: 'text-rose-900',   dot: 'bg-rose-500',   hex: '#f43f5e', lightHex: '#ffe4e6' },
  { bg: 'bg-amber-100',  lborder: 'border-l-4 border-l-amber-400',  text: 'text-amber-900',  dot: 'bg-amber-500',  hex: '#f59e0b', lightHex: '#fef3c7' },
  { bg: 'bg-indigo-100', lborder: 'border-l-4 border-l-indigo-400', text: 'text-indigo-900', dot: 'bg-indigo-500', hex: '#6366f1', lightHex: '#e0e7ff' },
]

export type Employee = {
  id: string; name: string; hourly_rate: number
  contract_hours: number; contract_type: string
  cp_initial?: number; created_at: string
  position?: string | null; hire_date?: string | null; contract_end_date?: string | null
  phone?: string | null; email?: string | null; notes?: string | null
  is_minor?: boolean; charges_patronales?: number; hs_cumules?: number
  weeks_off_per_year?: number
  is_gerant?: boolean; receive_planning_email?: boolean
}
export type PlanningEntry = {
  id?: string; employee_id: string; week_number: number; year: number
  lundi: number; lundi_type: DayType
  mardi: number; mardi_type: DayType
  mercredi: number; mercredi_type: DayType
  jeudi: number; jeudi_type: DayType
  vendredi: number; vendredi_type: DayType
  samedi: number; samedi_type: DayType
  dimanche: number; dimanche_type: DayType
  schedule_details?: ScheduleDetails
}
export type EntriesMap = Record<string, PlanningEntry>
export type MonthlyStat = {
  emp: Employee; hours: number; cost: number; charged: number; ot: number; worked: number; cp: number; sick: number
}

// ─── Helpers ──────────────────────────────────────────────────

export function isoWeeksInYear(y: number): number {
  const d = new Date(y, 11, 28)
  const d2 = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  d2.setUTCDate(d2.getUTCDate() + 4 - (d2.getUTCDay() || 7))
  const ys = new Date(Date.UTC(d2.getUTCFullYear(), 0, 1))
  return Math.ceil(((d2.getTime() - ys.getTime()) / 86400000 + 1) / 7)
}

export function getISOWeek(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return { week: Math.ceil((((d.getTime() - y.getTime()) / 86400000) + 1) / 7), year: d.getUTCFullYear() }
}

export function getWeekLabel(week: number, year: number) {
  const d = getWeekDates(week, year)
  const f = (x: Date) => x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' })
  return `${f(d[0])} – ${f(d[6])} ${year}`
}

// ── Vacances scolaires françaises par zone — calendriers officiels 2025-2026
// et 2026-2027 (arrêté du 22 octobre 2025). Intervalles [début, reprise) :
// du 1er jour de vacances (samedi) à la veille de la reprise des cours.
export type ZoneVac = 'A' | 'B' | 'C'
export const VACANCES_SCOLAIRES: { label: string; zones: ZoneVac[]; from: string; to: string }[] = [
  // 2025-2026
  { label: 'Toussaint', zones: ['A', 'B', 'C'], from: '2025-10-18', to: '2025-11-03' },
  { label: 'Noël',      zones: ['A', 'B', 'C'], from: '2025-12-20', to: '2026-01-05' },
  { label: 'Hiver',     zones: ['A'],           from: '2026-02-07', to: '2026-02-23' },
  { label: 'Hiver',     zones: ['B'],           from: '2026-02-14', to: '2026-03-02' },
  { label: 'Hiver',     zones: ['C'],           from: '2026-02-21', to: '2026-03-09' },
  { label: 'Printemps', zones: ['A'],           from: '2026-04-04', to: '2026-04-20' },
  { label: 'Printemps', zones: ['B'],           from: '2026-04-11', to: '2026-04-27' },
  { label: 'Printemps', zones: ['C'],           from: '2026-04-18', to: '2026-05-04' },
  { label: 'Été',       zones: ['A', 'B', 'C'], from: '2026-07-04', to: '2026-09-01' },
  // 2026-2027
  { label: 'Toussaint', zones: ['A', 'B', 'C'], from: '2026-10-17', to: '2026-11-02' },
  { label: 'Noël',      zones: ['A', 'B', 'C'], from: '2026-12-19', to: '2027-01-04' },
  { label: 'Hiver',     zones: ['C'],           from: '2027-02-06', to: '2027-02-22' },
  { label: 'Hiver',     zones: ['A'],           from: '2027-02-13', to: '2027-03-01' },
  { label: 'Hiver',     zones: ['B'],           from: '2027-02-20', to: '2027-03-08' },
  { label: 'Printemps', zones: ['C'],           from: '2027-04-03', to: '2027-04-19' },
  { label: 'Printemps', zones: ['A'],           from: '2027-04-10', to: '2027-04-26' },
  { label: 'Printemps', zones: ['B'],           from: '2027-04-17', to: '2027-05-03' },
  { label: 'Été',       zones: ['A', 'B', 'C'], from: '2027-07-03', to: '2027-09-01' },
]

/** Vacances scolaires chevauchant la semaine affichée, par zone (A / B / C). */
export function getWeekVacances(weekDates: Date[]): { zone: ZoneVac; label: string }[] {
  const monday = weekDates[0].toISOString().slice(0, 10)
  const sunday = weekDates[6].toISOString().slice(0, 10)
  const out: { zone: ZoneVac; label: string }[] = []
  for (const v of VACANCES_SCOLAIRES) {
    // chevauchement : les vacances commencent avant la fin de semaine ET la reprise est après le lundi
    if (v.from <= sunday && v.to > monday) {
      for (const z of v.zones) if (!out.some(o => o.zone === z)) out.push({ zone: z, label: v.label })
    }
  }
  return out.sort((a, b) => a.zone.localeCompare(b.zone))
}

export function getWeeksInMonth(year: number, month: number): { week: number; year: number }[] {
  const firstDay = new Date(Date.UTC(year, month - 1, 1))
  const lastDay  = new Date(Date.UTC(year, month, 0))
  const weeks: { week: number; year: number }[] = []
  const seen = new Set<string>()
  // On part du LUNDI de la semaine du 1er, puis on avance de 7 jours jusqu'à
  // dépasser le dernier jour du mois. Partir du 1er lui-même et sauter de 7
  // (les 1, 8, 15, 22, 29) manquait la dernière semaine quand son lundi tombait
  // le 30 ou le 31 : en août 2026, le lundi 31/08 (semaine 36) disparaissait du
  // récap, et ses heures avec (idem novembre 2026, mai 2027). Même parcours que
  // `semainesDuMois` du rapport comptable — un seul raisonnement.
  const d = new Date(firstDay)
  d.setUTCDate(firstDay.getUTCDate() - ((firstDay.getUTCDay() || 7) - 1))
  while (d <= lastDay) {
    const { week: w, year: y } = getISOWeek(d)
    const key = `${y}-${w}`
    if (!seen.has(key)) { seen.add(key); weeks.push({ week: w, year: y }) }
    d.setUTCDate(d.getUTCDate() + 7)
  }
  return weeks
}

/** Une semaine du récap : ses 7 dates (lundi→dimanche, UTC), les drapeaux fériés
 *  correspondants, et les lignes de planning de la semaine. */
export type SemaineRecap = {
  dates: Date[]
  feries: boolean[]
  entries: PlanningEntry[]
}

/**
 * LE RÉCAP MENSUEL, ventilé JOUR PAR JOUR.
 *
 * Deux grandeurs, deux règles — les mêmes que le rapport comptable, pour que les
 * deux vues ne puissent pas diverger :
 *
 *  · Les HEURES payées et le décompte des jours (travaillés, CP, maladie) se
 *    ventilent au jour le jour : seuls les jours qui tombent dans le mois civil
 *    comptent. Une semaine à cheval ne verse au mois que SES jours — fini les
 *    5 jours de juillet comptés dans août.
 *  · Les HEURES SUPPLÉMENTAIRES et le COÛT CCN se lisent sur la SEMAINE ENTIÈRE
 *    (le seuil des HS et les majorations ne se découpent pas). On les rattache
 *    au mois qui contient la MAJORITÉ des sept jours — jamais deux fois, jamais
 *    coupés au milieu. Sept jours : la majorité existe toujours.
 *
 * Fonction PURE : elle reçoit les semaines déjà chargées, ne parle à aucune base.
 */
export function recapMensuel(
  year: number,
  month: number,
  employees: Employee[],
  semaines: SemaineRecap[],
): MonthlyStat[] {
  const vide = (emp: Employee): MonthlyStat => ({ emp, hours: 0, cost: 0, charged: 0, ot: 0, worked: 0, cp: 0, sick: 0 })
  const stats = new Map<string, MonthlyStat>(employees.map(e => [e.id, vide(e)]))
  const empById = new Map(employees.map(e => [e.id, e]))

  for (const s of semaines) {
    const dansLeMois = s.dates.map(d => d.getUTCFullYear() === year && d.getUTCMonth() === month - 1)
    const rattachee = dansLeMois.filter(Boolean).length >= 4
    for (const entry of s.entries) {
      const emp = empById.get(entry.employee_id)
      const st = emp ? stats.get(emp.id) : undefined
      if (!emp || !st) continue
      const ch = emp.contract_hours || 35

      // Jour par jour — seuls les jours DU MOIS civil.
      JOURS_DB.forEach((jour, idx) => {
        if (!dansLeMois[idx]) return
        const t = (entry[`${jour}_type` as keyof PlanningEntry] as DayType) || 'travail'
        const h = (entry[jour as keyof PlanningEntry] as number) || 0
        if (t === 'travail' && h > 0) { st.worked++; st.hours += h }
        else if (t === 'conges') { st.cp++; st.hours += ch / 5 }
        else if (t === 'maladie') { st.sick++ }
      })

      // Semaine entière — rattachée au mois majoritaire. Le gérant n'a jamais
      // d'heure supplémentaire (non salarié), même règle que le coût et la paie.
      if (rattachee) {
        const weekWorkedH = calcWorkedH(entry)
        const weekCost = calcCostCCN(entry, emp, s.feries)
        st.ot      += emp.is_gerant ? 0 : Math.max(0, weekWorkedH - ch)
        st.cost    += weekCost
        st.charged += weekCost * chargeMult(emp)
      }
    }
  }

  return employees.map(e => stats.get(e.id) ?? vide(e))
}

export function contractLabel(ct: string | undefined) {
  return CONTRACT_TYPES.find(c => c.key === ct)?.short ?? (ct ?? 'CDI 35h')
}

// Le calcul CCN (heures payées, HS, majorations, charges patronales) vit dans
// lib/payroll — moteur partagé avec le tableau de bord, la facturation et le
// rapport PDF. Ces trois adaptateurs ne font que typer les objets de la page.
export const asEntry = (e: PlanningEntry) => e as unknown as PayrollEntry
export const asEmp   = (e: Employee)      => e as unknown as PayrollEmployee

/** Heures payées de la semaine : travail + CP (les CP sont payés à heures contrat ÷ 5 par jour) */
export const calcTotalH = (entry: PlanningEntry, contractH = 35) => entryHours(asEntry(entry), contractH).totalH

/** Heures réellement travaillées — base légale des heures supplémentaires (les CP n'en génèrent pas) */
export const calcWorkedH = (entry: PlanningEntry) => entryHours(asEntry(entry)).workedH

/** Coût BRUT complet CCN : base + heures sup + majorations dimanche/férié */
export const calcCostCCN = (entry: PlanningEntry, emp: Employee, holidayFlags: boolean[]) =>
  entryBrutCost(asEntry(entry), asEmp(emp), holidayFlags)

/** Heures MAJORÉES de la semaine (dimanche +20 %, férié +100 %) — pour que
 *  l'écran explique un coût plus haut que « taux × heures ». Un 48 h dont 8 h
 *  un férié coûte 96 € de plus : sans cette ligne, le total du planning
 *  semblait contredire la masse salariale de la semaine d'avant (sans férié).
 *  Le GÉRANT n'a aucune majoration : l'appelant n'affiche rien pour lui. */
export const calcMajoH = (entry: PlanningEntry, contractH: number, holidayFlags: boolean[]) => {
  const w = entryHours(asEntry(entry), contractH, holidayFlags)
  return { dimancheH: w.sundayH, ferieH: w.holidayH }
}

/** Multiplicateur charges patronales (défaut 45 %) */
export const chargeMult = (emp: Employee) => chargeMultiplier(asEmp(emp))

/** Alertes légales Code du travail / CCN 992 pour la semaine (basées sur le travail effectif).
 *  Gérant/propriétaire : non salarié, durées maximales du Code du travail non applicables. */
export function getEmployeeAlerts(emp: Employee, entry: PlanningEntry): string[] {
  const msgs: string[] = []
  if (emp.is_gerant) return msgs
  const maxDay = emp.is_minor ? 8 : 10
  let workedDays = 0
  JOURS_DB.forEach((j, idx) => {
    const t = (entry[`${j}_type` as keyof PlanningEntry] as DayType) || 'travail'
    const h = (entry[j] as number) || 0
    if (t === 'travail' && h > 0) {
      workedDays++
      if (h > maxDay) msgs.push(`${JOURS_SHORT[idx]} : ${fmtH(h)} — max légal ${maxDay}h/jour${emp.is_minor ? ' (mineur)' : ''}`)
    }
  })
  const workedH = calcWorkedH(entry)
  const maxWeek = emp.is_minor ? 35 : 48
  if (workedH > maxWeek) msgs.push(`${fmtH(workedH)} travaillées sur la semaine — max légal ${maxWeek}h${emp.is_minor ? ' (mineur)' : ''}`)
  if (workedDays === 7) msgs.push('7 jours travaillés — repos hebdomadaire de 35h consécutives obligatoire')
  return msgs
}

/** Badge fin de CDD si le contrat se termine dans les 45 jours */
export function cddEndInfo(emp: Employee): { label: string; urgent: boolean } | null {
  if (!emp.contract_end_date) return null
  const end = new Date(emp.contract_end_date)
  const days = Math.ceil((end.getTime() - Date.now()) / 86400000)
  if (isNaN(days) || days < 0 || days > 45) return null
  return { label: `CDD fin ${end.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`, urgent: days <= 15 }
}

export function emptyEntry(empId: string, week: number, year: number): PlanningEntry {
  return {
    employee_id: empId, week_number: week, year,
    lundi: 0, lundi_type: 'travail', mardi: 0, mardi_type: 'travail',
    mercredi: 0, mercredi_type: 'travail', jeudi: 0, jeudi_type: 'travail',
    vendredi: 0, vendredi_type: 'travail', samedi: 0, samedi_type: 'repos',
    dimanche: 0, dimanche_type: 'repos',
  }
}

export function initials(name: string) {
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2)
}

export function fmtH(h: number): string {
  const sign = h < 0 ? '-' : ''
  const abs = Math.abs(h)
  const hInt = Math.floor(abs)
  const min = Math.round((abs - hInt) * 60)
  if (min === 0) return `${sign}${hInt}h`
  return `${sign}${hInt}h${String(min).padStart(2, '0')}`
}

/** Extrait la partie heures ou minutes d'un horaire stocké "8h30" */
export function parseTimePart(val: string, part: 'h' | 'm'): string {
  if (!val) return ''
  const idx = val.indexOf('h')
  if (idx === -1) return part === 'h' ? val : ''
  return part === 'h' ? val.slice(0, idx) : val.slice(idx + 1)
}

export function combineTime(h: string, m: string): string {
  return `${h}h${m}`
}

export function parseTimeToHours(t: string): number | null {
  if (!t) return null
  const trimmed = t.trim()
  const hIdx = trimmed.indexOf('h')
  if (hIdx === -1) {
    const n = parseFloat(trimmed)
    return isNaN(n) ? null : n
  }
  const h = parseInt(trimmed.slice(0, hIdx)) || 0
  const mStr = trimmed.slice(hIdx + 1)
  const m = mStr ? parseInt(mStr) || 0 : 0
  return h + m / 60
}

export function calcSlotDuration(debut: string, fin: string): number | null {
  const s = parseTimeToHours(debut)
  const e = parseTimeToHours(fin)
  if (s === null || e === null || e <= s) return null
  return e - s
}

export function calcHoursFromSd(sd: ScheduleDetail): number | null {
  const matin  = calcSlotDuration(sd.matin_debut  || '', sd.matin_fin  || '')
  const apmidi = calcSlotDuration(sd.apmidi_debut || '', sd.apmidi_fin || '')
  if (matin === null && apmidi === null) return null
  return (matin || 0) + (apmidi || 0)
}

