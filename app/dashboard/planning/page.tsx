'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, ChevronLeft, ChevronRight, Trash2, CalendarDays, FileDown, Copy, BarChart2, X, Clock } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type DayType = 'travail' | 'conges' | 'maladie' | 'repos'
type CategoryKey = 'boucherie' | 'charcuterie' | 'traiteur' | 'vente'

const JOURS_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const JOURS_DB = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const
type JourDB = typeof JOURS_DB[number]

const CATEGORIES: Record<CategoryKey, { label: string; hex: string; light: string; textCss: string; dotCss: string; bgCss: string }> = {
  boucherie:   { label: 'Boucherie',   hex: '#ef4444', light: '#fee2e2', textCss: 'text-red-700',    dotCss: 'bg-red-500',    bgCss: 'bg-red-100'    },
  charcuterie: { label: 'Charcuterie', hex: '#a855f7', light: '#f3e8ff', textCss: 'text-purple-700', dotCss: 'bg-purple-500', bgCss: 'bg-purple-100' },
  traiteur:    { label: 'Traiteur',    hex: '#f97316', light: '#ffedd5', textCss: 'text-orange-700', dotCss: 'bg-orange-500', bgCss: 'bg-orange-100' },
  vente:       { label: 'Vente',       hex: '#14b8a6', light: '#ccfbf1', textCss: 'text-teal-700',   dotCss: 'bg-teal-500',   bgCss: 'bg-teal-100'   },
}

const TYPE_CONFIG: Record<DayType, { label: string; bg: string; text: string; dot: string; defaultHours: number; pdfColor: string; display: string }> = {
  travail: { label: 'Travail',        bg: '',            text: '',              dot: '',            defaultHours: 0, pdfColor: '',        display: '' },
  conges:  { label: 'Congé payé',    bg: 'bg-sky-100',  text: 'text-sky-800',  dot: 'bg-sky-400',  defaultHours: 7, pdfColor: '#bae6fd', display: '7h' },
  maladie: { label: 'Arrêt maladie', bg: 'bg-red-100',  text: 'text-red-800',  dot: 'bg-red-400',  defaultHours: 0, pdfColor: '#fecaca', display: 'AM' },
  repos:   { label: 'Repos',         bg: 'bg-gray-100', text: 'text-gray-400', dot: 'bg-gray-300', defaultHours: 0, pdfColor: '#f3f4f6', display: '—'  },
}

const CONTRACT_TYPES = [
  { key: 'CDI_35', label: 'CDI · 35h', short: 'CDI 35h', hours: 35, desc: '+25 % dès 36h' },
  { key: 'CDI_39', label: 'CDI · 39h', short: 'CDI 39h', hours: 39, desc: '+25 % dès 40h' },
  { key: 'CDD_35', label: 'CDD · 35h', short: 'CDD 35h', hours: 35, desc: '+25 % dès 36h' },
  { key: 'CDD_39', label: 'CDD · 39h', short: 'CDD 39h', hours: 39, desc: '+25 % dès 40h' },
] as const
type ContractKey = typeof CONTRACT_TYPES[number]['key']

const EMP_PALETTES = [
  { bg: 'bg-violet-100', lborder: 'border-l-4 border-l-violet-400', text: 'text-violet-900', dot: 'bg-violet-500', hex: '#8b5cf6', lightHex: '#ede9fe' },
  { bg: 'bg-pink-100',   lborder: 'border-l-4 border-l-pink-400',   text: 'text-pink-900',   dot: 'bg-pink-500',   hex: '#ec4899', lightHex: '#fce7f3' },
  { bg: 'bg-sky-100',    lborder: 'border-l-4 border-l-sky-400',    text: 'text-sky-900',    dot: 'bg-sky-500',    hex: '#0ea5e9', lightHex: '#e0f2fe' },
  { bg: 'bg-orange-100', lborder: 'border-l-4 border-l-orange-400', text: 'text-orange-900', dot: 'bg-orange-500', hex: '#f97316', lightHex: '#ffedd5' },
  { bg: 'bg-teal-100',   lborder: 'border-l-4 border-l-teal-500',   text: 'text-teal-900',   dot: 'bg-teal-500',   hex: '#14b8a6', lightHex: '#ccfbf1' },
  { bg: 'bg-rose-100',   lborder: 'border-l-4 border-l-rose-400',   text: 'text-rose-900',   dot: 'bg-rose-500',   hex: '#f43f5e', lightHex: '#ffe4e6' },
  { bg: 'bg-amber-100',  lborder: 'border-l-4 border-l-amber-400',  text: 'text-amber-900',  dot: 'bg-amber-500',  hex: '#f59e0b', lightHex: '#fef3c7' },
  { bg: 'bg-indigo-100', lborder: 'border-l-4 border-l-indigo-400', text: 'text-indigo-900', dot: 'bg-indigo-500', hex: '#6366f1', lightHex: '#e0e7ff' },
]

type Employee = {
  id: string; name: string; hourly_rate: number
  contract_hours: number; contract_type: string
  cp_initial?: number; created_at: string
}

type DaySchedule = {
  am_start?: string; am_end?: string; am_category?: CategoryKey
  pm_start?: string; pm_end?: string; pm_category?: CategoryKey
}
type ScheduleDetails = Partial<Record<JourDB, DaySchedule>>

type PlanningEntry = {
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
type EntriesMap = Record<string, PlanningEntry>
type MonthlyStat = { emp: Employee; hours: number; cost: number; worked: number; cp: number; sick: number }

type ScheduleModal = {
  empId: string; jour: JourDB; empName: string; jourLabel: string
  type: DayType
  am_start: string; am_end: string; am_category: CategoryKey | ''
  pm_start: string; pm_end: string; pm_category: CategoryKey | ''
  manualHours: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getISOWeek(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return { week: Math.ceil((((d.getTime() - y.getTime()) / 86400000) + 1) / 7), year: d.getUTCFullYear() }
}

function getWeekDates(week: number, year: number): Date[] {
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const dow = jan4.getUTCDay() || 7
  const mon = new Date(jan4)
  mon.setUTCDate(jan4.getUTCDate() - dow + 1 + (week - 1) * 7)
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setUTCDate(mon.getUTCDate() + i); return d })
}

function getWeekLabel(week: number, year: number) {
  const d = getWeekDates(week, year)
  const f = (x: Date) => x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' })
  return `${f(d[0])} – ${f(d[6])} ${year}`
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

function getFrenchHolidays(year: number): Map<string, string> {
  const easter = getEaster(year)
  const add = (d: Date, n: number) => { const r = new Date(d); r.setUTCDate(d.getUTCDate() + n); return r }
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return new Map([
    [fmt(new Date(Date.UTC(year, 0, 1))),   "Jour de l'An"],
    [fmt(add(easter, 1)),                    'Lundi de Pâques'],
    [fmt(new Date(Date.UTC(year, 4, 1))),   'Fête du Travail'],
    [fmt(new Date(Date.UTC(year, 4, 8))),   'Victoire 1945'],
    [fmt(add(easter, 39)),                   'Ascension'],
    [fmt(add(easter, 50)),                   'Lundi de Pentecôte'],
    [fmt(new Date(Date.UTC(year, 6, 14))),  'Fête Nationale'],
    [fmt(new Date(Date.UTC(year, 7, 15))),  'Assomption'],
    [fmt(new Date(Date.UTC(year, 10, 1))),  'Toussaint'],
    [fmt(new Date(Date.UTC(year, 10, 11))), 'Armistice'],
    [fmt(new Date(Date.UTC(year, 11, 25))), 'Noël'],
  ])
}

function getWeeksInMonth(year: number, month: number): { week: number; year: number }[] {
  const firstDay = new Date(Date.UTC(year, month - 1, 1))
  const lastDay  = new Date(Date.UTC(year, month, 0))
  const weeks: { week: number; year: number }[] = []
  const seen = new Set<string>()
  let d = new Date(firstDay)
  while (d <= lastDay) {
    const { week: w, year: y } = getISOWeek(d)
    const key = `${y}-${w}`
    if (!seen.has(key)) { seen.add(key); weeks.push({ week: w, year: y }) }
    d.setUTCDate(d.getUTCDate() + 7)
  }
  return weeks
}

function contractLabel(ct: string | undefined) {
  return CONTRACT_TYPES.find(c => c.key === ct)?.short ?? (ct ?? 'CDI 35h')
}

function parseTimeH(t?: string): number {
  if (!t) return 0
  const [h, m] = t.split(':').map(Number)
  return h + (m || 0) / 60
}

function scheduleHours(sched?: DaySchedule): number {
  if (!sched) return 0
  const am = sched.am_start && sched.am_end ? Math.max(0, parseTimeH(sched.am_end) - parseTimeH(sched.am_start)) : 0
  const pm = sched.pm_start && sched.pm_end ? Math.max(0, parseTimeH(sched.pm_end) - parseTimeH(sched.pm_start)) : 0
  return am + pm
}

function formatTime(t?: string) {
  if (!t) return ''
  return t.replace(':00', 'h').replace(':', 'h')
}

function calcTotalH(entry: PlanningEntry) {
  return JOURS_DB.reduce((s, j) => {
    const t = (entry[`${j}_type` as keyof PlanningEntry] as DayType) || 'travail'
    if (t === 'conges') return s + 7
    if (t !== 'travail') return s
    const sh = scheduleHours(entry.schedule_details?.[j])
    return s + (sh > 0 ? sh : (entry[j] || 0))
  }, 0)
}

function calcCost(entry: PlanningEntry, rate: number, contractH: number) {
  const totalH = calcTotalH(entry)
  const t2 = contractH + 8
  if (totalH <= contractH) return totalH * rate
  if (totalH <= t2) return contractH * rate + (totalH - contractH) * rate * 1.25
  return contractH * rate + (t2 - contractH) * rate * 1.25 + (totalH - t2) * rate * 1.5
}

function emptyEntry(empId: string, week: number, year: number): PlanningEntry {
  return {
    employee_id: empId, week_number: week, year,
    lundi: 0, lundi_type: 'travail', mardi: 0, mardi_type: 'travail',
    mercredi: 0, mercredi_type: 'travail', jeudi: 0, jeudi_type: 'travail',
    vendredi: 0, vendredi_type: 'travail', samedi: 0, samedi_type: 'repos',
    dimanche: 0, dimanche_type: 'repos',
  }
}

function initials(name: string) {
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2)
}

function modalHours(m: ScheduleModal): number {
  const am = m.am_start && m.am_end ? Math.max(0, parseTimeH(m.am_end) - parseTimeH(m.am_start)) : 0
  const pm = m.pm_start && m.pm_end ? Math.max(0, parseTimeH(m.pm_end) - parseTimeH(m.pm_start)) : 0
  const fromTimes = am + pm
  if (fromTimes > 0) return fromTimes
  return parseFloat(m.manualHours) || 0
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PlanningPage() {
  const now = getISOWeek(new Date())
  const [week, setWeek]   = useState(now.week)
  const [year, setYear]   = useState(now.year)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [entries, setEntries]     = useState<EntriesMap>({})
  const entriesRef = useRef<EntriesMap>({})
  const [contractPopover, setContractPopover] = useState<string | null>(null)
  const [scheduleModal, setScheduleModal]     = useState<ScheduleModal | null>(null)
  const [loadingEmployees, setLoadingEmployees] = useState(true)
  const [showAdd,     setShowAdd]     = useState(false)
  const [newName,     setNewName]     = useState('')
  const [newRate,     setNewRate]     = useState('')
  const [newContractKey, setNewContractKey] = useState<ContractKey>('CDI_35')
  const [adding,      setAdding]      = useState(false)
  const [pageError,   setPageError]   = useState<string | null>(null)
  const [copying,     setCopying]     = useState(false)
  const [cpUsed,      setCpUsed]      = useState<Record<string, number>>({})
  const [showMonthly,    setShowMonthly]    = useState(false)
  const [monthlyData,    setMonthlyData]    = useState<MonthlyStat[] | null>(null)
  const [loadingMonthly, setLoadingMonthly] = useState(false)

  const { week: cw, year: cy } = getISOWeek(new Date())
  const isCurrentWeek = week === cw && year === cy
  const weekDates     = getWeekDates(week, year)
  const today         = new Date()
  const holidays      = getFrenchHolidays(year)
  const weekHolidays  = weekDates.map(d => holidays.get(d.toISOString().slice(0, 10)) ?? null)

  const setEntriesSync = (updater: (prev: EntriesMap) => EntriesMap) => {
    setEntries(prev => {
      const next = updater(prev)
      entriesRef.current = next
      return next
    })
  }

  useEffect(() => {
    const close = () => { setContractPopover(null) }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])

  useEffect(() => {
    fetch('/api/employees').then(r => r.json()).then(data => {
      if (Array.isArray(data)) { setEmployees(data); setPageError(null) }
      else setPageError(data?.error || 'Erreur chargement')
      setLoadingEmployees(false)
    }).catch(() => { setPageError('Erreur réseau'); setLoadingEmployees(false) })
  }, [])

  const refreshCpUsed = useCallback(() => {
    fetch(`/api/planning/stats?year=${year}`)
      .then(r => r.json()).then(data => {
        if (Array.isArray(data)) {
          const map: Record<string, number> = {}
          for (const { employee_id, cp_used } of data) map[employee_id] = cp_used
          setCpUsed(map)
        }
      }).catch(() => {})
  }, [year])

  useEffect(() => { refreshCpUsed() }, [refreshCpUsed])

  const loadEntries = useCallback(() => {
    fetch(`/api/planning?week=${week}&year=${year}`).then(r => r.json()).then(data => {
      if (Array.isArray(data)) {
        const map: EntriesMap = {}
        for (const e of data) map[e.employee_id] = e
        setEntries(map); entriesRef.current = map
      }
    })
  }, [week, year])

  useEffect(() => { loadEntries() }, [loadEntries])

  function getEntry(empId: string)      { return entriesRef.current[empId] ?? emptyEntry(empId, week, year) }
  function getEntryState(empId: string) { return entries[empId] ?? emptyEntry(empId, week, year) }

  async function saveEntryValues(empId: string, entry: PlanningEntry) {
    await fetch('/api/planning', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...entry, employee_id: empId, week_number: week, year }),
    })
  }

  async function updateContract(empId: string, contractKey: ContractKey) {
    const ct = CONTRACT_TYPES.find(c => c.key === contractKey)!
    setEmployees(prev => prev.map(e => e.id === empId ? { ...e, contract_type: ct.key, contract_hours: ct.hours } : e))
    setContractPopover(null)
    await fetch(`/api/employees/${empId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contract_type: ct.key, contract_hours: ct.hours }),
    })
  }

  function openModal(emp: Employee, jour: JourDB, jourIdx: number) {
    const entry = getEntry(emp.id)
    const sched = entry.schedule_details?.[jour] ?? {}
    const type  = (entry[`${jour}_type` as keyof PlanningEntry] as DayType) || (jourIdx >= 5 ? 'repos' : 'travail')
    setScheduleModal({
      empId: emp.id, jour,
      empName: emp.name,
      jourLabel: `${JOURS_SHORT[jourIdx]} ${weekDates[jourIdx].getUTCDate()}`,
      type,
      am_start: sched.am_start ?? '',
      am_end:   sched.am_end   ?? '',
      am_category: sched.am_category ?? '',
      pm_start: sched.pm_start ?? '',
      pm_end:   sched.pm_end   ?? '',
      pm_category: sched.pm_category ?? '',
      manualHours: String(entry[jour] || ''),
    })
  }

  function saveModal() {
    if (!scheduleModal) return
    const { empId, jour } = scheduleModal
    const typeKey = `${jour}_type` as keyof PlanningEntry
    const totalH  = modalHours(scheduleModal)

    const newSched: DaySchedule = {
      am_start:    scheduleModal.am_start    || undefined,
      am_end:      scheduleModal.am_end      || undefined,
      am_category: (scheduleModal.am_category as CategoryKey) || undefined,
      pm_start:    scheduleModal.pm_start    || undefined,
      pm_end:      scheduleModal.pm_end      || undefined,
      pm_category: (scheduleModal.pm_category as CategoryKey) || undefined,
    }

    const prev = getEntry(empId)
    const updated: PlanningEntry = {
      ...prev,
      [typeKey]: scheduleModal.type,
      [jour]: scheduleModal.type === 'travail' ? totalH : TYPE_CONFIG[scheduleModal.type].defaultHours,
      schedule_details: {
        ...(prev.schedule_details ?? {}),
        [jour]: newSched,
      },
    }

    setEntriesSync(p => ({ ...p, [empId]: updated }))
    setScheduleModal(null)
    saveEntryValues(empId, updated).then(() => refreshCpUsed())
  }

  async function addEmployee() {
    if (!newName.trim() || !newRate) return
    setAdding(true)
    const ct = CONTRACT_TYPES.find(c => c.key === newContractKey)!
    const res = await fetch('/api/employees', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), hourly_rate: parseFloat(newRate), contract_type: ct.key, contract_hours: ct.hours }),
    })
    const data = await res.json()
    if (data.id) { setEmployees(p => [...p, data]); setNewName(''); setNewRate(''); setNewContractKey('CDI_35'); setShowAdd(false) }
    setAdding(false)
  }

  async function deleteEmployee(id: string) {
    if (!confirm('Supprimer cet employé et tout son historique ?')) return
    await fetch(`/api/employees/${id}`, { method: 'DELETE' })
    setEmployees(p => p.filter(e => e.id !== id))
    setEntriesSync(prev => { const n = { ...prev }; delete n[id]; return n })
  }

  function prevWeek() { if (week === 1) { setYear(y => y - 1); setWeek(52) } else setWeek(w => w - 1) }
  function nextWeek() { if (week === 52) { setYear(y => y + 1); setWeek(1) } else setWeek(w => w + 1) }

  async function copyPrevWeek() {
    if (copying) return
    const prevW = week === 1 ? 52 : week - 1
    const prevY = week === 1 ? year - 1 : year
    setCopying(true)
    try {
      const res  = await fetch(`/api/planning?week=${prevW}&year=${prevY}`)
      const data = await res.json()
      if (!Array.isArray(data) || data.length === 0) return
      for (const entry of data) {
        const entryData = { ...entry }; delete entryData.id
        await fetch('/api/planning', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...entryData, week_number: week, year }),
        })
      }
      loadEntries()
    } finally { setCopying(false) }
  }

  async function openMonthly() {
    setShowMonthly(true); setLoadingMonthly(true); setMonthlyData(null)
    const monthYear = weekDates[0].getUTCFullYear()
    const month     = weekDates[0].getUTCMonth() + 1
    const weeks     = getWeeksInMonth(monthYear, month)
    try {
      const allResults = await Promise.all(
        weeks.map(({ week: w, year: y }) => fetch(`/api/planning?week=${w}&year=${y}`).then(r => r.json()).catch(() => []))
      )
      const stats: Record<string, { hours: number; cost: number; worked: number; cp: number; sick: number }> = {}
      for (const weekEntries of allResults) {
        if (!Array.isArray(weekEntries)) continue
        for (const entry of weekEntries) {
          if (!stats[entry.employee_id]) stats[entry.employee_id] = { hours: 0, cost: 0, worked: 0, cp: 0, sick: 0 }
          const emp = employees.find(e => e.id === entry.employee_id)
          if (!emp) continue
          stats[entry.employee_id].hours += calcTotalH(entry)
          stats[entry.employee_id].cost  += calcCost(entry, Number(emp.hourly_rate), emp.contract_hours || 35)
          for (const jour of JOURS_DB) {
            const t = (entry[`${jour}_type`] as DayType) || 'travail'
            const h = (entry[jour] as number) || 0
            if (t === 'conges') stats[entry.employee_id].cp++
            else if (t === 'maladie') stats[entry.employee_id].sick++
            else if (t === 'travail' && h > 0) stats[entry.employee_id].worked++
          }
        }
      }
      setMonthlyData(employees.map(emp => ({ emp, ...(stats[emp.id] || { hours: 0, cost: 0, worked: 0, cp: 0, sick: 0 }) })))
    } finally { setLoadingMonthly(false) }
  }

  const rowStats  = employees.map(emp => {
    const e  = getEntryState(emp.id)
    const ch = emp.contract_hours || 35
    return { empId: emp.id, totalH: calcTotalH(e), cost: calcCost(e, Number(emp.hourly_rate), ch) }
  })
  const grandH    = rowStats.reduce((s, r) => s + r.totalH, 0)
  const grandCost = rowStats.reduce((s, r) => s + r.cost, 0)

  function exportPDF() {
    const dates = getWeekDates(week, year)
    const fmtD  = (d: Date) => d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    const dayHeaders = dates.map((d, i) => {
      const fName = holidays.get(d.toISOString().slice(0, 10))
      const bg    = fName ? '#d97706' : i >= 5 ? '#94a3b8' : '#1E3A5F'
      return `<th style="background:${bg};color:white;padding:7px 5px;font-size:10px;text-align:center;">${fmtD(d)}${fName ? `<br><span style="font-size:8px;opacity:.9;">✦ ${fName}</span>` : ''}</th>`
    }).join('')
    const empRows = employees.map((emp, i) => {
      const pal    = EMP_PALETTES[i % EMP_PALETTES.length]
      const entry  = getEntryState(emp.id)
      const ch     = emp.contract_hours || 35
      const totalH = calcTotalH(entry)
      const cells  = JOURS_DB.map((j, idx) => {
        const type  = (entry[`${j}_type` as keyof PlanningEntry] as DayType) || (idx >= 5 ? 'repos' : 'travail')
        const sched = entry.schedule_details?.[j]
        const fName = weekHolidays[idx]
        const bg    = fName ? '#fef3c7' : type === 'travail' ? pal.lightHex : TYPE_CONFIG[type].pdfColor
        let content = ''
        if (type === 'travail' && sched) {
          const amCat = sched.am_category ? CATEGORIES[sched.am_category] : null
          const pmCat = sched.pm_category ? CATEGORIES[sched.pm_category] : null
          const amLine = sched.am_start ? `<div style="font-size:8px;${amCat ? `color:${amCat.hex};font-weight:bold;` : ''}">${amCat ? amCat.label : ''}${sched.am_start && sched.am_end ? ` ${formatTime(sched.am_start)}–${formatTime(sched.am_end)}` : ''}</div>` : ''
          const pmLine = sched.pm_start ? `<div style="font-size:8px;${pmCat ? `color:${pmCat.hex};font-weight:bold;` : ''}">${pmCat ? pmCat.label : ''}${sched.pm_start && sched.pm_end ? ` ${formatTime(sched.pm_start)}–${formatTime(sched.pm_end)}` : ''}</div>` : ''
          const h = scheduleHours(sched) || entry[j] || 0
          content = `${amLine}${pmLine}<strong style="font-size:10px;">${h > 0 ? h.toFixed(1) + 'h' : '—'}</strong>`
        } else if (type === 'travail') {
          const h = entry[j] || 0
          content = `<strong>${h > 0 ? h + 'h' : '—'}</strong>`
        } else {
          content = `<span style="font-size:9px;">${TYPE_CONFIG[type].label}</span>`
        }
        return `<td style="padding:5px 4px;text-align:center;background:${bg};border-bottom:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">${content}${fName ? `<br><span style="font-size:8px;color:#92400e;">Férié</span>` : ''}</td>`
      }).join('')
      return `<tr>
        <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;border-left:3px solid ${pal.hex};background:#fafafa;">
          <div style="display:flex;align-items:center;gap:7px;">
            <div style="width:26px;height:26px;border-radius:50%;background:${pal.hex};display:flex;align-items:center;justify-content:center;"><span style="color:white;font-size:9px;font-weight:700;">${initials(emp.name)}</span></div>
            <div><div style="font-weight:700;font-size:12px;">${emp.name}</div><div style="font-size:9px;color:#94a3b8;">${contractLabel(emp.contract_type)}</div></div>
          </div>
        </td>${cells}
        <td style="padding:6px;text-align:center;font-weight:700;font-size:12px;color:${totalH > ch ? '#ea580c' : '#1e293b'};background:#f8fafc;border-bottom:1px solid #e2e8f0;">${totalH.toFixed(1)}h</td>
        <td style="padding:6px;text-align:center;border-bottom:1px solid #e2e8f0;min-width:80px;"></td>
      </tr>`
    }).join('')
    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Planning S${week}</title>
<style>@page{size:A4 landscape;margin:1.2cm 1.5cm}*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;color:#1e293b}table{width:100%;border-collapse:collapse}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid #1E3A5F;">
  <div><div style="font-size:18px;font-weight:800;color:#1E3A5F;">Planning — Semaine ${week}</div><div style="font-size:11px;color:#64748b;margin-top:2px;">${getWeekLabel(week, year)}</div></div>
  <div style="display:flex;gap:16px;font-size:10px;color:#64748b;align-items:center;">
    ${Object.entries(CATEGORIES).map(([, c]) => `<span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;border-radius:2px;background:${c.hex};display:inline-block;"></span>${c.label}</span>`).join('')}
  </div>
</div>
<table><thead><tr>
  <th style="background:#1E3A5F;color:white;padding:7px 10px;font-size:10px;text-align:left;width:150px;">Employé</th>
  ${dayHeaders}
  <th style="background:#1E3A5F;color:white;padding:7px 5px;font-size:10px;text-align:center;width:50px;">Total</th>
  <th style="background:#1E3A5F;color:white;padding:7px 10px;font-size:10px;text-align:center;width:90px;">Signature</th>
</tr></thead><tbody>${empRows}</tbody></table>
<p style="margin-top:10px;font-size:9px;color:#94a3b8;">Seuils majoration : 35h → +25 % de 36–43h · 39h → +25 % de 40–47h · +50 % au-delà · CP = 7h/jour · Généré via PILOTE</p>
</body></html>`
    const win = window.open('', '_blank', 'width=1200,height=800')
    if (!win) return
    win.document.write(html); win.document.close(); win.focus()
    setTimeout(() => win.print(), 600)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <style>{`
        input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
        input[type=number]{-moz-appearance:textfield}
        input[type=time]{color-scheme:light}
      `}</style>

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <CalendarDays className="w-5 h-5 text-[#1E3A5F]" />
          <h1 className="text-lg font-bold text-gray-900">Planning des équipes</h1>
        </div>
        <div className="flex items-center gap-2">
          {employees.length > 0 && (
            <>
              <Button onClick={openMonthly} variant="outline" className="h-8 text-sm px-3 border-gray-300 text-gray-600 hover:bg-gray-50">
                <BarChart2 className="w-3.5 h-3.5 mr-1.5" />Récap du mois
              </Button>
              <Button onClick={exportPDF} variant="outline" className="h-8 text-sm px-3 border-[#1E3A5F] text-[#1E3A5F] hover:bg-blue-50">
                <FileDown className="w-3.5 h-3.5 mr-1.5" />PDF
              </Button>
            </>
          )}
          <Button onClick={() => setShowAdd(true)} className="bg-[#1E3A5F] hover:bg-[#2a4f7c] text-white h-8 text-sm px-3">
            <Plus className="w-3.5 h-3.5 mr-1.5" />Ajouter un employé
          </Button>
        </div>
      </div>

      {/* Week nav */}
      <div className="bg-white border-b border-gray-100 px-6 py-2.5 flex items-center gap-3">
        <button onClick={prevWeek} className="p-1.5 rounded hover:bg-gray-100"><ChevronLeft className="w-4 h-4 text-gray-500" /></button>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-900 text-sm">Semaine {week}</span>
          {isCurrentWeek && <span className="text-[10px] bg-[#1E3A5F] text-white px-1.5 py-0.5 rounded font-medium">Actuelle</span>}
        </div>
        <button onClick={nextWeek} className="p-1.5 rounded hover:bg-gray-100"><ChevronRight className="w-4 h-4 text-gray-500" /></button>
        {!isCurrentWeek && (
          <button onClick={() => { setWeek(cw); setYear(cy) }} className="text-xs text-[#1E3A5F] hover:underline">← Semaine actuelle</button>
        )}
        <button onClick={copyPrevWeek} disabled={copying}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded-md px-2.5 py-1 hover:bg-gray-50 disabled:opacity-40">
          <Copy className="w-3 h-3" />
          {copying ? 'Copie...' : `Copier S${week === 1 ? 52 : week - 1}`}
        </button>
        <div className="ml-auto flex items-center gap-4 text-xs text-gray-400">
          <span><span className="font-semibold text-gray-700">{grandH.toFixed(1)}h</span> total</span>
          <span><span className="font-semibold text-green-700">{grandCost.toFixed(2)} €</span> coût</span>
        </div>
      </div>

      {/* Legend */}
      <div className="bg-white border-b border-gray-100 px-6 py-2 flex items-center gap-5 flex-wrap">
        <span className="text-xs font-medium text-gray-400">Types :</span>
        {[
          { label: 'Travail', dot: 'bg-violet-400' },
          { label: 'Congé payé', dot: 'bg-sky-400' },
          { label: 'Arrêt maladie', dot: 'bg-red-400' },
          { label: 'Repos', dot: 'bg-gray-300' },
          { label: 'Jour férié', dot: 'bg-amber-400' },
        ].map(t => (
          <div key={t.label} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-sm ${t.dot}`} /><span className="text-xs text-gray-600">{t.label}</span>
          </div>
        ))}
        <span className="text-xs font-medium text-gray-400 ml-4">Catégories :</span>
        {(Object.entries(CATEGORIES) as [CategoryKey, typeof CATEGORIES[CategoryKey]][]).map(([k, c]) => (
          <div key={k} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: c.hex }} />
            <span className="text-xs text-gray-600">{c.label}</span>
          </div>
        ))}
      </div>

      {pageError && <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{pageError}</div>}

      {/* Grid */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse">
          <thead>
            <tr className="bg-white">
              <th className="w-52 px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider sticky left-0 bg-white z-10 border-b border-r border-gray-200">Employé</th>
              {weekDates.map((date, i) => {
                const isToday = date.getUTCDate() === today.getDate() && date.getUTCMonth() === today.getMonth() && date.getUTCFullYear() === today.getFullYear()
                const isWE  = i >= 5
                const fName = weekHolidays[i]
                return (
                  <th key={i} className={`px-2 py-2 text-center min-w-[120px] border-b border-r border-gray-200 ${isToday ? 'bg-[#1E3A5F]' : fName ? 'bg-amber-50' : isWE ? 'bg-gray-50' : 'bg-white'}`}>
                    <div className={`text-xs font-bold uppercase tracking-wide ${isToday ? 'text-white' : fName ? 'text-amber-700' : isWE ? 'text-gray-400' : 'text-gray-500'}`}>{JOURS_SHORT[i]}</div>
                    <div className={`text-lg font-bold ${isToday ? 'text-white' : fName ? 'text-amber-800' : isWE ? 'text-gray-300' : 'text-gray-800'}`}>{date.getUTCDate()}</div>
                    <div className={`text-[10px] ${isToday ? 'text-blue-200' : 'text-gray-400'}`}>{date.toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' })}</div>
                    {fName && <div className="text-[8px] font-semibold text-amber-700 bg-amber-100 px-1 py-0.5 rounded mt-0.5 leading-tight truncate" title={fName}>✦ {fName}</div>}
                  </th>
                )
              })}
              <th className="px-3 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-r border-gray-200 w-20">Total</th>
              <th className="px-3 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-200 w-24">Coût</th>
            </tr>
          </thead>
          <tbody>
            {loadingEmployees ? (
              <tr><td colSpan={11} className="py-12 text-center text-sm text-gray-400">Chargement...</td></tr>
            ) : employees.length === 0 && !pageError ? (
              <tr>
                <td colSpan={11} className="py-16 text-center">
                  <CalendarDays className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-400 mb-3">Aucun employé.</p>
                  <Button onClick={() => setShowAdd(true)} variant="outline" className="h-8 text-sm px-3">
                    <Plus className="w-3.5 h-3.5 mr-1.5" />Ajouter un employé
                  </Button>
                </td>
              </tr>
            ) : employees.map((emp, empIdx) => {
              const pal   = EMP_PALETTES[empIdx % EMP_PALETTES.length]
              const entry = getEntryState(emp.id)
              const ch    = emp.contract_hours || 35
              const { totalH, cost } = rowStats.find(r => r.empId === emp.id) || { totalH: 0, cost: 0 }
              const hasOT = totalH > ch
              const showContractPop = contractPopover === emp.id
              const cpInitial   = emp.cp_initial ?? 25
              const cpRemaining = cpInitial - (cpUsed[emp.id] || 0)

              return (
                <tr key={emp.id} className="group">
                  <td className={`px-3 py-0 sticky left-0 bg-white z-10 border-b border-r border-gray-200 ${pal.lborder}`}>
                    <div className="flex items-center gap-2 py-2">
                      <div className={`w-7 h-7 rounded-full ${pal.bg} flex items-center justify-center flex-shrink-0`}>
                        <span className={`text-[10px] font-bold ${pal.text}`}>{initials(emp.name)}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-900 leading-tight truncate">{emp.name}</p>
                        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                          <div className="relative">
                            <button onClick={e => { e.stopPropagation(); setContractPopover(showContractPop ? null : emp.id) }}
                              className="text-[10px] font-bold bg-[#1E3A5F] text-white px-1.5 py-0.5 rounded hover:bg-[#2a4f7c] transition-colors cursor-pointer">
                              {contractLabel(emp.contract_type)}
                            </button>
                            {showContractPop && (
                              <div className="absolute top-full left-0 mt-1 z-50 bg-white rounded-xl shadow-2xl border border-gray-100 p-1.5 w-40" onClick={e => e.stopPropagation()}>
                                <p className="text-[10px] text-gray-400 px-2 pb-1 font-medium">Type de contrat</p>
                                {CONTRACT_TYPES.map(ct => (
                                  <button key={ct.key} onClick={() => updateContract(emp.id, ct.key)}
                                    className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-left transition-colors ${emp.contract_type === ct.key ? 'bg-[#1E3A5F] text-white' : 'hover:bg-gray-50 text-gray-700'}`}>
                                    <div>
                                      <div className="text-xs font-semibold">{ct.short}</div>
                                      <div className={`text-[9px] ${emp.contract_type === ct.key ? 'text-blue-200' : 'text-gray-400'}`}>{ct.desc}</div>
                                    </div>
                                    {emp.contract_type === ct.key && <span className="text-[10px]">✓</span>}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <span className="text-[10px] text-gray-400">{Number(emp.hourly_rate).toFixed(2)} €/h</span>
                          <button onClick={() => deleteEmployee(emp.id)}
                            className="ml-auto opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-400 transition-all">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cpRemaining < 0 ? 'bg-red-400' : cpRemaining <= 3 ? 'bg-orange-400' : 'bg-sky-300'}`} />
                          <span className={`text-[9px] ${cpRemaining < 0 ? 'text-red-500 font-semibold' : cpRemaining <= 3 ? 'text-orange-500' : 'text-gray-400'}`}>{cpRemaining}j CP restants</span>
                        </div>
                      </div>
                    </div>
                  </td>

                  {JOURS_DB.map((jour, idx) => {
                    const typeKey = `${jour}_type` as keyof PlanningEntry
                    const type    = (entry[typeKey] as DayType) || (idx >= 5 ? 'repos' : 'travail')
                    const sched   = entry.schedule_details?.[jour]
                    const fName   = weekHolidays[idx]
                    const amCat   = sched?.am_category ? CATEGORIES[sched.am_category] : null
                    const pmCat   = sched?.pm_category ? CATEGORIES[sched.pm_category] : null
                    const sh      = scheduleHours(sched)
                    const hours   = sh > 0 ? sh : (entry[jour] || 0)
                    const cellBg  = fName ? 'bg-amber-50' : type === 'travail' ? pal.bg : TYPE_CONFIG[type].bg
                    const cellTxt = fName ? 'text-amber-800' : type === 'travail' ? pal.text : TYPE_CONFIG[type].text
                    const cellDot = fName ? 'bg-amber-400' : type === 'travail' ? pal.dot : TYPE_CONFIG[type].dot
                    const typeLabel = fName ? 'Férié' : type === 'travail' ? 'Travail' : TYPE_CONFIG[type].label

                    return (
                      <td key={jour} className="p-0 border-b border-r border-gray-200 align-stretch">
                        <div
                          className={`cursor-pointer transition-colors ${cellBg} w-full h-full min-h-[90px] px-2 pt-1.5 pb-1.5 flex flex-col hover:brightness-95`}
                          onClick={() => !fName && openModal(emp, jour, idx)}
                        >
                          <div className="flex items-center gap-1 mb-1">
                            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cellDot}`} />
                            <span className={`text-[9px] font-semibold truncate ${cellTxt}`}>{typeLabel}</span>
                            {!fName && <Clock className={`w-2.5 h-2.5 ml-auto opacity-20 ${cellTxt}`} />}
                          </div>
                          {type === 'travail' && !fName ? (
                            <div className="flex-1 flex flex-col justify-center gap-0.5">
                              {sched?.am_start && sched?.am_end ? (
                                <div className="flex items-center gap-1 px-1 py-0.5 rounded" style={{ background: amCat?.light || '#f3f4f6' }}>
                                  {amCat && <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: amCat.hex }} />}
                                  <span className="text-[9px] font-semibold truncate" style={{ color: amCat?.hex || '#374151' }}>
                                    {amCat?.label || 'Matin'} · {formatTime(sched.am_start)}–{formatTime(sched.am_end)}
                                  </span>
                                </div>
                              ) : null}
                              {sched?.pm_start && sched?.pm_end ? (
                                <div className="flex items-center gap-1 px-1 py-0.5 rounded" style={{ background: pmCat?.light || '#f3f4f6' }}>
                                  {pmCat && <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: pmCat.hex }} />}
                                  <span className="text-[9px] font-semibold truncate" style={{ color: pmCat?.hex || '#374151' }}>
                                    {pmCat?.label || 'A-M'} · {formatTime(sched.pm_start)}–{formatTime(sched.pm_end)}
                                  </span>
                                </div>
                              ) : null}
                              {!sched?.am_start && !sched?.pm_start && (
                                <span className={`font-bold text-xl text-center ${pal.text}`}>
                                  {hours > 0 ? `${hours}h` : '—'}
                                </span>
                              )}
                              {(sched?.am_start || sched?.pm_start) && (
                                <span className={`text-[10px] font-bold text-center mt-0.5 ${pal.text}`}>
                                  {hours > 0 ? `${hours % 1 === 0 ? hours : hours.toFixed(1)}h total` : ''}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="flex-1 flex items-center justify-center">
                              <span className={`font-bold text-xl ${cellTxt}`}>
                                {fName ? '✦' : TYPE_CONFIG[type].display}
                              </span>
                            </div>
                          )}
                        </div>
                      </td>
                    )
                  })}

                  <td className="px-2 py-3 text-center border-b border-r border-gray-200">
                    <div className={`inline-flex flex-col items-center px-2 py-1 rounded-lg ${hasOT ? 'bg-orange-50' : totalH > 0 ? 'bg-gray-50' : ''}`}>
                      <span className={`font-bold text-sm ${hasOT ? 'text-orange-600' : totalH > 0 ? 'text-gray-800' : 'text-gray-300'}`}>{totalH.toFixed(1)}h</span>
                      {hasOT && <span className="text-[9px] text-orange-400">+{(totalH - ch).toFixed(1)} sup</span>}
                    </div>
                  </td>
                  <td className="px-2 py-3 text-center border-b border-gray-200">
                    <span className={`font-bold text-sm ${cost > 0 ? 'text-green-700' : 'text-gray-300'}`}>
                      {cost > 0 ? `${cost.toFixed(0)} €` : '—'}
                    </span>
                  </td>
                </tr>
              )
            })}

            {employees.length > 0 && (
              <tr className="bg-gray-900">
                <td className="px-3 py-3 sticky left-0 bg-gray-900 z-10 border-r border-gray-700">
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Total / jour</span>
                </td>
                {JOURS_DB.map((jour, idx) => {
                  const dayH = employees.reduce((s, emp) => {
                    const e = getEntryState(emp.id)
                    const t = (e[`${jour}_type` as keyof PlanningEntry] as DayType) || 'travail'
                    if (t === 'conges') return s + 7
                    if (t !== 'travail') return s
                    const sh = scheduleHours(e.schedule_details?.[jour])
                    return s + (sh > 0 ? sh : (e[jour] || 0))
                  }, 0)
                  const present = employees.filter(emp => {
                    const t = (getEntryState(emp.id)[`${jour}_type` as keyof PlanningEntry] as DayType) || 'travail'
                    return t !== 'repos'
                  }).length
                  const isFerie = weekHolidays[idx] !== null
                  return (
                    <td key={jour} className={`px-2 py-3 text-center border-r border-gray-700 ${isFerie ? 'bg-amber-950/30' : ''}`}>
                      {dayH > 0
                        ? <><div className="text-sm font-bold text-white">{dayH.toFixed(1)}h</div><div className="text-[10px] text-gray-500">{present} pers.</div></>
                        : <span className="text-gray-700">—</span>}
                    </td>
                  )
                })}
                <td className="px-3 py-3 text-center border-r border-gray-700"><span className="font-bold text-white">{grandH.toFixed(1)}h</span></td>
                <td className="px-3 py-3 text-center"><span className="font-bold text-orange-400">{grandCost.toFixed(0)} €</span></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {employees.length > 0 && (
        <div className="px-6 py-2.5 bg-amber-50 border-t border-amber-100">
          <p className="text-xs text-amber-700">
            <span className="font-semibold">Majoration :</span> 35h → +25 % de 36–43h, +50 % au-delà · 39h → +25 % de 40–47h, +50 % au-delà · CP = 7h/jour
          </p>
        </div>
      )}

      {/* ── Schedule modal ── */}
      {scheduleModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm" onClick={() => setScheduleModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-gray-900">{scheduleModal.empName}</h2>
                <p className="text-sm text-gray-500">{scheduleModal.jourLabel}</p>
              </div>
              <button onClick={() => setScheduleModal(null)} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            {/* Type */}
            <div className="mb-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Type de journée</p>
              <div className="grid grid-cols-4 gap-1.5">
                {(['travail', 'conges', 'maladie', 'repos'] as DayType[]).map(t => (
                  <button key={t} onClick={() => setScheduleModal(s => s ? { ...s, type: t } : s)}
                    className={`py-1.5 px-1 rounded-lg text-xs font-semibold border-2 transition-all ${scheduleModal.type === t ? 'border-[#1E3A5F] bg-[#1E3A5F] text-white' : 'border-gray-200 text-gray-700 hover:border-gray-300 bg-white'}`}>
                    {TYPE_CONFIG[t].label || 'Travail'}
                  </button>
                ))}
              </div>
            </div>

            {scheduleModal.type === 'travail' && (
              <>
                {/* AM */}
                <div className="mb-4 p-3 bg-gray-50 rounded-xl border border-gray-200">
                  <p className="text-xs font-bold text-gray-800 mb-2.5 flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-amber-400 flex items-center justify-center text-[8px] text-white font-black">M</span>
                    Matin
                  </p>
                  <div className="flex gap-2 mb-2.5">
                    <div className="flex-1">
                      <label className="text-[11px] font-medium text-gray-600 block mb-1">De</label>
                      <input type="time" value={scheduleModal.am_start}
                        onChange={e => setScheduleModal(s => s ? { ...s, am_start: e.target.value } : s)}
                        className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]/30" />
                    </div>
                    <div className="flex-1">
                      <label className="text-[11px] font-medium text-gray-600 block mb-1">À</label>
                      <input type="time" value={scheduleModal.am_end}
                        onChange={e => setScheduleModal(s => s ? { ...s, am_end: e.target.value } : s)}
                        className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]/30" />
                    </div>
                  </div>
                  <p className="text-[11px] font-medium text-gray-600 mb-1.5">Catégorie matin</p>
                  <div className="grid grid-cols-4 gap-1">
                    {(Object.entries(CATEGORIES) as [CategoryKey, typeof CATEGORIES[CategoryKey]][]).map(([k, c]) => (
                      <button key={k} onClick={() => setScheduleModal(s => s ? { ...s, am_category: s.am_category === k ? '' : k } : s)}
                        className={`py-1.5 px-1 rounded-lg text-[9px] font-bold border-2 transition-all ${scheduleModal.am_category === k ? 'text-white' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'}`}
                        style={scheduleModal.am_category === k ? { background: c.hex, borderColor: c.hex } : {}}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* PM */}
                <div className="mb-4 p-3 bg-gray-50 rounded-xl border border-gray-200">
                  <p className="text-xs font-bold text-gray-800 mb-2.5 flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-blue-400 flex items-center justify-center text-[8px] text-white font-black">A</span>
                    Après-midi
                  </p>
                  <div className="flex gap-2 mb-2.5">
                    <div className="flex-1">
                      <label className="text-[11px] font-medium text-gray-600 block mb-1">De</label>
                      <input type="time" value={scheduleModal.pm_start}
                        onChange={e => setScheduleModal(s => s ? { ...s, pm_start: e.target.value } : s)}
                        className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]/30" />
                    </div>
                    <div className="flex-1">
                      <label className="text-[11px] font-medium text-gray-600 block mb-1">À</label>
                      <input type="time" value={scheduleModal.pm_end}
                        onChange={e => setScheduleModal(s => s ? { ...s, pm_end: e.target.value } : s)}
                        className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]/30" />
                    </div>
                  </div>
                  <p className="text-[11px] font-medium text-gray-600 mb-1.5">Catégorie après-midi</p>
                  <div className="grid grid-cols-4 gap-1">
                    {(Object.entries(CATEGORIES) as [CategoryKey, typeof CATEGORIES[CategoryKey]][]).map(([k, c]) => (
                      <button key={k} onClick={() => setScheduleModal(s => s ? { ...s, pm_category: s.pm_category === k ? '' : k } : s)}
                        className={`py-1.5 px-1 rounded-lg text-[9px] font-bold border-2 transition-all ${scheduleModal.pm_category === k ? 'text-white' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'}`}
                        style={scheduleModal.pm_category === k ? { background: c.hex, borderColor: c.hex } : {}}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Manual hours fallback */}
                {!scheduleModal.am_start && !scheduleModal.pm_start && (
                  <div className="mb-4">
                    <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider block mb-1.5">Heures (si pas d'horaires)</label>
                    <input type="number" min="0" max="24" step="0.5" value={scheduleModal.manualHours}
                      onChange={e => setScheduleModal(s => s ? { ...s, manualHours: e.target.value } : s)}
                      className="w-24 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]/30"
                      placeholder="0" />
                  </div>
                )}

                {modalHours(scheduleModal) > 0 && (
                  <div className="mb-4 flex items-center justify-center gap-2 py-2 bg-blue-50 rounded-lg border border-blue-100">
                    <Clock className="w-3.5 h-3.5 text-blue-600" />
                    <span className="text-sm font-bold text-blue-800">
                      {modalHours(scheduleModal) % 1 === 0 ? modalHours(scheduleModal) : modalHours(scheduleModal).toFixed(1)}h au total
                    </span>
                  </div>
                )}
              </>
            )}

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1 text-gray-700" onClick={() => setScheduleModal(null)}>Annuler</Button>
              <Button className="flex-1 bg-[#1E3A5F] hover:bg-[#2a4f7c] text-white" onClick={saveModal}>Valider</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Récap mensuel ── */}
      {showMonthly && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm" onClick={() => setShowMonthly(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl shadow-2xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-base font-bold text-gray-900">Récapitulatif mensuel</h2>
                <p className="text-sm text-gray-500 mt-0.5">{weekDates[0].toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</p>
              </div>
              <button onClick={() => setShowMonthly(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            {loadingMonthly ? (
              <div className="py-12 text-center text-sm text-gray-400">Chargement...</div>
            ) : monthlyData ? (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-gray-200">
                    <th className="text-left py-2.5 font-semibold text-gray-500 text-xs uppercase">Employé</th>
                    <th className="text-center py-2.5 font-semibold text-gray-500 text-xs uppercase">Heures</th>
                    <th className="text-center py-2.5 font-semibold text-gray-500 text-xs uppercase">Jours trav.</th>
                    <th className="text-center py-2.5 font-semibold text-sky-600 text-xs uppercase">CP</th>
                    <th className="text-center py-2.5 font-semibold text-red-500 text-xs uppercase">Arrêt</th>
                    <th className="text-center py-2.5 font-semibold text-green-700 text-xs uppercase">Coût</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyData.map(({ emp, hours, cost, worked, cp, sick }, i) => {
                    const pal   = EMP_PALETTES[i % EMP_PALETTES.length]
                    const hasOT = hours > (emp.contract_hours || 35) * 4
                    return (
                      <tr key={emp.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-3">
                          <div className="flex items-center gap-2">
                            <div className={`w-6 h-6 rounded-full ${pal.bg} flex items-center justify-center flex-shrink-0`}>
                              <span className={`text-[9px] font-bold ${pal.text}`}>{initials(emp.name)}</span>
                            </div>
                            <div>
                              <div className="font-semibold text-gray-900">{emp.name}</div>
                              <div className="text-[10px] text-gray-400">{contractLabel(emp.contract_type)}</div>
                            </div>
                          </div>
                        </td>
                        <td className="text-center py-3"><span className={`font-bold ${hasOT ? 'text-orange-600' : 'text-gray-800'}`}>{hours.toFixed(1)}h</span></td>
                        <td className="text-center py-3 text-gray-600">{worked > 0 ? `${worked}j` : '—'}</td>
                        <td className="text-center py-3">{cp > 0 ? <span className="text-sky-700 font-medium">{cp}j</span> : <span className="text-gray-300">—</span>}</td>
                        <td className="text-center py-3">{sick > 0 ? <span className="text-red-600 font-medium">{sick}j</span> : <span className="text-gray-300">—</span>}</td>
                        <td className="text-center py-3 font-bold text-green-700">{cost.toFixed(0)} €</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-900">
                    <td className="py-2.5 px-2 text-xs font-bold uppercase text-gray-400">Total mois</td>
                    <td className="text-center py-2.5 font-bold text-white">{monthlyData.reduce((s, r) => s + r.hours, 0).toFixed(1)}h</td>
                    <td className="text-center py-2.5 text-gray-400">{monthlyData.reduce((s, r) => s + r.worked, 0)}j</td>
                    <td className="text-center py-2.5 text-sky-400">{monthlyData.reduce((s, r) => s + r.cp, 0)}j</td>
                    <td className="text-center py-2.5 text-red-400">{monthlyData.reduce((s, r) => s + r.sick, 0)}j</td>
                    <td className="text-center py-2.5 font-bold text-orange-400">{monthlyData.reduce((s, r) => s + r.cost, 0).toFixed(0)} €</td>
                  </tr>
                </tfoot>
              </table>
            ) : null}
          </div>
        </div>
      )}

      {/* ── Ajout employé ── */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm" onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold text-gray-900 mb-1">Nouvel employé</h2>
            <p className="text-sm text-gray-500 mb-5">Renseignez les informations de l'employé.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Prénom et nom</label>
                <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Marie Dupont" autoFocus onKeyDown={e => e.key === 'Enter' && addEmployee()} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Taux horaire brut (€/h)</label>
                <Input type="number" step="0.01" min="0" value={newRate} onChange={e => setNewRate(e.target.value)} placeholder="12.50" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Type de contrat</label>
                <div className="grid grid-cols-2 gap-2">
                  {CONTRACT_TYPES.map(ct => (
                    <button key={ct.key} onClick={() => setNewContractKey(ct.key)}
                      className={`py-2.5 px-3 rounded-lg border-2 text-left transition-all ${newContractKey === ct.key ? 'border-[#1E3A5F] bg-[#1E3A5F] text-white' : 'border-gray-200 text-gray-700 hover:border-gray-300 bg-white'}`}>
                      <div className="text-sm font-bold">{ct.short}</div>
                      <div className={`text-[10px] mt-0.5 ${newContractKey === ct.key ? 'text-blue-200' : 'text-gray-400'}`}>{ct.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1 text-gray-700" onClick={() => setShowAdd(false)}>Annuler</Button>
                <Button className="flex-1 bg-[#1E3A5F] hover:bg-[#2a4f7c] text-white" onClick={addEmployee} disabled={!newName.trim() || !newRate || adding}>
                  {adding ? 'Ajout...' : 'Ajouter'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
