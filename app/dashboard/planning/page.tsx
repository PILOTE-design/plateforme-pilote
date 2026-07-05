'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, ChevronLeft, ChevronRight, ChevronDown, Trash2, CalendarDays, FileDown, Copy, BarChart2, X, UserCog, Check } from 'lucide-react'
import EmployeeProfileModal, { type EmployeeProfile } from '@/components/EmployeeProfileModal'

type DayType = 'travail' | 'conges' | 'maladie' | 'repos'
type WorkCategory = 'boucherie' | 'charcuterie' | 'traiteur' | 'vente'
type DaySchedule = {
  matin: number
  apresMidi: number
  category: WorkCategory | null
  matinDebut: string
  matinFin: string
  apmDebut: string
  apmFin: string
}
type ScheduleMap = Record<string, Partial<Record<JourDB, DaySchedule>>>

const EMPTY_SCHED: DaySchedule = { matin: 0, apresMidi: 0, category: null, matinDebut: '', matinFin: '', apmDebut: '', apmFin: '' }

const WORK_CATS: { key: WorkCategory; label: string }[] = [
  { key: 'boucherie',   label: 'Boucherie'   },
  { key: 'charcuterie', label: 'Charcuterie' },
  { key: 'traiteur',    label: 'Traiteur'    },
  { key: 'vente',       label: 'Vente'       },
]

const JOURS_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const JOURS_DB = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const
type JourDB = typeof JOURS_DB[number]

const TYPE_CONFIG: Record<DayType, {
  label: string; bg: string; text: string; dot: string; defaultHours: number; pdfColor: string; display: string
}> = {
  travail: { label: 'Travail',        bg: '',            text: '',              dot: '',           defaultHours: 0, pdfColor: '',        display: '' },
  conges:  { label: 'Congé payé',    bg: 'bg-sky-100',  text: 'text-sky-800',  dot: 'bg-sky-400', defaultHours: 7, pdfColor: '#bae6fd', display: '7h' },
  maladie: { label: 'Arrêt maladie', bg: 'bg-red-100',  text: 'text-red-800',  dot: 'bg-red-400', defaultHours: 0, pdfColor: '#fecaca', display: 'AM' },
  repos:   { label: 'Repos',          bg: 'bg-gray-100', text: 'text-gray-400', dot: 'bg-gray-300', defaultHours: 0, pdfColor: '#f3f4f6', display: '—' },
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
  position?: string | null; hire_date?: string | null; contract_end_date?: string | null
  phone?: string | null; email?: string | null; notes?: string | null; is_minor?: boolean
}
type PlanningEntry = {
  id?: string; employee_id: string; week_number: number; year: number
  lundi: number; lundi_type: DayType; mardi: number; mardi_type: DayType
  mercredi: number; mercredi_type: DayType; jeudi: number; jeudi_type: DayType
  vendredi: number; vendredi_type: DayType; samedi: number; samedi_type: DayType
  dimanche: number; dimanche_type: DayType
}
type EntriesMap = Record<string, PlanningEntry>
type MonthlyStat = { emp: Employee; hours: number; cost: number; worked: number; cp: number; sick: number }

// Popover avec coordonnées viewport (position:fixed)
type SelectedCell = {
  empId: string
  jour: JourDB
  x: number      // left en px viewport
  y: number      // top (si openUp=false) ou ancre top de cellule (si openUp=true)
  openUp: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeDiff(start: string, end: string): number {
  if (!start || !end) return 0
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const diff = (eh * 60 + em) - (sh * 60 + sm)
  return Math.max(0, diff / 60)
}

function fmtDecHours(h: number): string {
  if (h === 0) return '0h'
  const totalMin = Math.round(h * 60)
  const hrs = Math.floor(totalMin / 60)
  const mins = totalMin % 60
  return mins === 0 ? `${hrs}h` : `${hrs}h${mins.toString().padStart(2, '0')}`
}

function fmtTime(t: string): string {
  if (!t) return ''
  const [h, m] = t.split(':')
  return m === '00' ? `${parseInt(h)}h` : `${parseInt(h)}h${m}`
}

function fmtRange(start: string, end: string): string {
  if (!start && !end) return ''
  if (!start || !end) return fmtTime(start || end)
  return `${fmtTime(start)}-${fmtTime(end)}`
}

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

function calcTotalH(entry: PlanningEntry) {
  return JOURS_DB.reduce((s, j) => {
    const t = (entry[`${j}_type` as keyof PlanningEntry] as DayType) || 'travail'
    return s + (t === 'travail' ? (entry[j] || 0) : t === 'conges' ? 7 : 0)
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function PlanningPage() {
  const now = getISOWeek(new Date())
  const [week, setWeek]   = useState(now.week)
  const [year, setYear]   = useState(now.year)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [entries, setEntries]     = useState<EntriesMap>({})
  const entriesRef = useRef<EntriesMap>({})
  const [schedMap, setSchedMap]   = useState<ScheduleMap>({})
  const schedMapRef = useRef<ScheduleMap>({})

  // selectedCell stocke les coordonnées viewport pour position:fixed
  const [selectedCell,    setSelectedCell]    = useState<SelectedCell | null>(null)
  const [typeDropCell,    setTypeDropCell]     = useState<{ empId: string; jour: JourDB } | null>(null)
  const [contractPopover, setContractPopover]  = useState<string | null>(null)

  const [loadingEmployees, setLoadingEmployees] = useState(true)
  const [showAdd,        setShowAdd]        = useState(false)
  const [newName,        setNewName]        = useState('')
  const [newRate,        setNewRate]        = useState('')
  const [newContractKey, setNewContractKey] = useState<ContractKey>('CDI_35')
  const [adding,         setAdding]         = useState(false)
  const [pageError,      setPageError]      = useState<string | null>(null)
  const [copying,        setCopying]        = useState(false)
  const [cpUsed,         setCpUsed]         = useState<Record<string, number>>({})
  const [showMonthly,    setShowMonthly]    = useState(false)
  const [monthlyData,    setMonthlyData]    = useState<MonthlyStat[] | null>(null)
  const [loadingMonthly, setLoadingMonthly] = useState(false)
  const [profileEmp,     setProfileEmp]     = useState<EmployeeProfile | null>(null)

  const { week: cw, year: cy } = getISOWeek(new Date())
  const isCurrentWeek = week === cw && year === cy
  const weekDates     = getWeekDates(week, year)
  const today         = new Date()
  const holidays      = getFrenchHolidays(year)
  const weekHolidays  = weekDates.map(d => holidays.get(d.toISOString().slice(0, 10)) ?? null)

  const setEntriesSync = (updater: (prev: EntriesMap) => EntriesMap) => {
    setEntries(prev => { const next = updater(prev); entriesRef.current = next; return next })
  }
  const setSchedMapSync = (updater: (prev: ScheduleMap) => ScheduleMap) => {
    setSchedMap(prev => { const next = updater(prev); schedMapRef.current = next; return next })
  }

  function getSched(empId: string, jour: JourDB): DaySchedule {
    return schedMapRef.current[empId]?.[jour] ?? { ...EMPTY_SCHED }
  }

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest('[data-cell]')) {
        setSelectedCell(null)
        setTypeDropCell(null)
        setContractPopover(null)
      }
    }
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
      .then(r => r.json())
      .then(data => {
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
        const smap: ScheduleMap = {}
        for (const e of data) {
          map[e.employee_id] = e
          if (e.schedule_details) smap[e.employee_id] = e.schedule_details as Partial<Record<JourDB, DaySchedule>>
        }
        setEntries(map); entriesRef.current = map
        setSchedMap(smap); schedMapRef.current = smap
      }
    })
  }, [week, year])

  useEffect(() => { loadEntries() }, [loadEntries])

  function getEntry(empId: string)      { return entriesRef.current[empId] ?? emptyEntry(empId, week, year) }
  function getEntryState(empId: string) { return entries[empId] ?? emptyEntry(empId, week, year) }

  async function saveEntryValues(empId: string, entry: PlanningEntry) {
    const schedule_details = schedMapRef.current[empId] ?? {}
    await fetch('/api/planning', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...entry, employee_id: empId, week_number: week, year, schedule_details }),
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

  async function changeType(empId: string, jour: JourDB, newType: DayType) {
    const typeKey = `${jour}_type` as keyof PlanningEntry
    const currentH = getEntry(empId)[jour] || 0
    const updated: PlanningEntry = {
      ...getEntry(empId), [typeKey]: newType,
      [jour]: newType === 'travail' ? currentH : TYPE_CONFIG[newType].defaultHours,
    }
    if (newType !== 'travail') {
      setSchedMapSync(prev => {
        const empSched = { ...prev[empId] }
        delete empSched[jour]
        return { ...prev, [empId]: empSched }
      })
    }
    setEntriesSync(prev => ({ ...prev, [empId]: updated }))
    setSelectedCell(null); setTypeDropCell(null)
    await saveEntryValues(empId, updated)
    refreshCpUsed()
  }

  function updateTimeRange(
    empId: string, jour: JourDB,
    field: 'matinDebut' | 'matinFin' | 'apmDebut' | 'apmFin',
    value: string
  ) {
    const current = getSched(empId, jour)
    const updated = { ...current, [field]: value }
    const matinH = timeDiff(updated.matinDebut, updated.matinFin)
    const apmH   = timeDiff(updated.apmDebut,   updated.apmFin)
    updated.matin     = matinH
    updated.apresMidi = apmH
    setSchedMapSync(prev => ({ ...prev, [empId]: { ...prev[empId], [jour]: updated } }))
    setEntriesSync(prev => ({ ...prev, [empId]: { ...getEntry(empId), [jour]: matinH + apmH } }))
  }

  async function updateCategory(empId: string, jour: JourDB, category: WorkCategory | null) {
    const current = getSched(empId, jour)
    setSchedMapSync(prev => ({ ...prev, [empId]: { ...prev[empId], [jour]: { ...current, category } } }))
    await saveEntryValues(empId, entriesRef.current[empId] ?? emptyEntry(empId, week, year))
  }

  function saveDay(empId: string) {
    saveEntryValues(empId, entriesRef.current[empId] ?? emptyEntry(empId, week, year))
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
    if (data.id) {
      setEmployees(p => [...p, data])
      setNewName(''); setNewRate(''); setNewContractKey('CDI_35'); setShowAdd(false)
    }
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
        const entryData = { ...entry }
        delete entryData.id
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
      const cost   = calcCost(entry, Number(emp.hourly_rate), ch)
      const cells  = JOURS_DB.map((j, idx) => {
        const type   = (entry[`${j}_type` as keyof PlanningEntry] as DayType) || (idx >= 5 ? 'repos' : 'travail')
        const h      = entry[j] || 0
        const fName  = weekHolidays[idx]
        const sched  = schedMapRef.current[emp.id]?.[j]
        const catLabel = sched?.category ? WORK_CATS.find(c => c.key === sched.category)?.label : null
        const bg     = fName ? '#fef3c7' : type === 'travail' ? pal.lightHex : TYPE_CONFIG[type].pdfColor
        const matinRange = sched ? fmtRange(sched.matinDebut, sched.matinFin) : ''
        const apmRange   = sched ? fmtRange(sched.apmDebut,   sched.apmFin)   : ''
        const label  = type === 'travail'
          ? (h > 0
            ? `${catLabel ? `<span style="font-size:8px;color:#64748b;font-weight:600;">${catLabel}</span><br>` : ''}${matinRange ? `<span style="font-size:8px;">${matinRange}</span><br>` : ''}${apmRange ? `<span style="font-size:8px;">${apmRange}</span><br>` : ''}<strong style="font-size:11px;">${fmtDecHours(h)}</strong>`
            : '—')
          : `<span style="font-size:9px;">${TYPE_CONFIG[type].label}</span>`
        return `<td style="padding:5px 3px;text-align:center;background:${bg};border-bottom:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">${label}${fName ? `<br><span style="font-size:8px;color:#92400e;">Férié</span>` : ''}</td>`
      }).join('')
      return `<tr>
        <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;border-left:3px solid ${pal.hex};background:#fafafa;">
          <div style="display:flex;align-items:center;gap:7px;">
            <div style="width:26px;height:26px;border-radius:50%;background:${pal.hex};display:flex;align-items:center;justify-content:center;"><span style="color:white;font-size:9px;font-weight:700;">${initials(emp.name)}</span></div>
            <div><div style="font-weight:700;font-size:12px;">${emp.name}</div><div style="font-size:9px;color:#94a3b8;">${contractLabel(emp.contract_type)} · ${Number(emp.hourly_rate).toFixed(2)} €/h</div></div>
          </div>
        </td>${cells}
        <td style="padding:6px;text-align:center;font-weight:700;font-size:12px;color:${totalH > ch ? '#ea580c' : '#1e293b'};background:#f8fafc;border-bottom:1px solid #e2e8f0;">${fmtDecHours(totalH)}</td>
        <td style="padding:6px;text-align:center;font-weight:700;font-size:12px;color:#15803d;background:#f0fdf4;border-bottom:1px solid #e2e8f0;">${cost.toFixed(2)} €</td>
      </tr>`
    }).join('')
    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Planning S${week}</title>
<style>@page{size:A4 landscape;margin:1.2cm 1.5cm}*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;color:#1e293b}table{width:100%;border-collapse:collapse}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid #1E3A5F;">
  <div><div style="font-size:18px;font-weight:800;color:#1E3A5F;">Planning — Semaine ${week}</div><div style="font-size:11px;color:#64748b;margin-top:2px;">${getWeekLabel(week, year)}</div></div>
  <div style="text-align:right;"><div style="font-size:10px;color:#64748b;">Coût main d'œuvre</div><div style="font-size:16px;font-weight:800;color:#15803d;">${grandCost.toFixed(2)} €</div></div>
</div>
<table><thead><tr><th style="background:#1E3A5F;color:white;padding:7px 10px;font-size:10px;text-align:left;width:160px;">Employé</th>${dayHeaders}<th style="background:#1E3A5F;color:white;padding:7px 5px;font-size:10px;text-align:center;">Total</th><th style="background:#1E3A5F;color:white;padding:7px 5px;font-size:10px;text-align:center;">Coût</th></tr></thead><tbody>${empRows}</tbody></table>
<p style="margin-top:10px;font-size:9px;color:#94a3b8;">CCN 992 : 35h → +25 % de 36–43h · 39h → +25 % de 40–47h · +50 % au-delà · Généré via PILOTE</p>
</body></html>`
    const win = window.open('', '_blank', 'width=1100,height=750')
    if (!win) return
    win.document.write(html); win.document.close(); win.focus()
    setTimeout(() => win.print(), 600)
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  // Popover actif (cherche l'employé et la cellule correspondante)
  const activeEmp   = selectedCell ? employees.find(e => e.id === selectedCell.empId) : null
  const activeEmpIdx = activeEmp ? employees.indexOf(activeEmp) : 0
  const activePal   = EMP_PALETTES[activeEmpIdx % EMP_PALETTES.length]
  const activeSched = selectedCell ? getSched(selectedCell.empId, selectedCell.jour) : { ...EMPTY_SCHED }

  return (
    <div className="min-h-screen bg-gray-50">
      <style>{`
        input[type=time]::-webkit-calendar-picker-indicator { opacity: 0.5; cursor: pointer; }
        input[type=time] { color: #0f172a !important; background-color: #ffffff !important; }
      `}</style>

      {/* ── Popover détail (position:fixed — au-dessus de tout) ── */}
      {selectedCell && activeEmp && (
        <div
          style={{
            position: 'fixed',
            left: selectedCell.x,
            ...(selectedCell.openUp
              ? { bottom: window.innerHeight - selectedCell.y + 8 }
              : { top: selectedCell.y + 8 }),
            zIndex: 99999,
            width: '288px',
          }}
          className="bg-white rounded-xl shadow-2xl border border-gray-100 p-3"
          data-cell="true"
          onClick={e => e.stopPropagation()}
        >
          {/* Poste */}
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Poste</p>
          <div className="grid grid-cols-2 gap-1 mb-3">
            {WORK_CATS.map(cat => {
              const isActive = activeSched.category === cat.key
              return (
                <button key={cat.key}
                  onClick={() => updateCategory(selectedCell.empId, selectedCell.jour, isActive ? null : cat.key)}
                  className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-all text-center ${
                    isActive ? 'bg-[#1E3A5F] text-white shadow-sm' : 'bg-gray-50 hover:bg-gray-100 text-gray-600 border border-gray-200'
                  }`}
                >
                  {cat.label}
                </button>
              )
            })}
          </div>

          {/* Horaires */}
          <div className="border-t border-gray-100 pt-2.5 space-y-3">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Horaires</p>

            {/* Matin */}
            <div>
              <p className="text-xs font-medium text-gray-600 mb-1.5">Matin</p>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={activeSched.matinDebut}
                  onChange={e => updateTimeRange(selectedCell.empId, selectedCell.jour, 'matinDebut', e.target.value)}
                  className="flex-1 text-sm text-gray-900 border border-gray-300 bg-white rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/20"
                />
                <span className="text-gray-400 text-sm font-medium flex-shrink-0">→</span>
                <input
                  type="time"
                  value={activeSched.matinFin}
                  onChange={e => updateTimeRange(selectedCell.empId, selectedCell.jour, 'matinFin', e.target.value)}
                  className="flex-1 text-sm text-gray-900 border border-gray-300 bg-white rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/20"
                />
                {activeSched.matinDebut && activeSched.matinFin && (
                  <span className={`text-xs font-bold w-10 text-right flex-shrink-0 ${activePal.text}`}>
                    {fmtDecHours(timeDiff(activeSched.matinDebut, activeSched.matinFin))}
                  </span>
                )}
              </div>
            </div>

            {/* Après-midi */}
            <div>
              <p className="text-xs font-medium text-gray-600 mb-1.5">Après-midi</p>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={activeSched.apmDebut}
                  onChange={e => updateTimeRange(selectedCell.empId, selectedCell.jour, 'apmDebut', e.target.value)}
                  className="flex-1 text-sm text-gray-900 border border-gray-300 bg-white rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/20"
                />
                <span className="text-gray-400 text-sm font-medium flex-shrink-0">→</span>
                <input
                  type="time"
                  value={activeSched.apmFin}
                  onChange={e => updateTimeRange(selectedCell.empId, selectedCell.jour, 'apmFin', e.target.value)}
                  className="flex-1 text-sm text-gray-900 border border-gray-300 bg-white rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/20"
                />
                {activeSched.apmDebut && activeSched.apmFin && (
                  <span className={`text-xs font-bold w-10 text-right flex-shrink-0 ${activePal.text}`}>
                    {fmtDecHours(timeDiff(activeSched.apmDebut, activeSched.apmFin))}
                  </span>
                )}
              </div>
            </div>

            {/* Total journée */}
            {(activeSched.matin > 0 || activeSched.apresMidi > 0) && (
              <div className="flex items-center justify-between pt-1.5 border-t border-gray-100">
                <span className="text-xs text-gray-400">Total journée</span>
                <span className={`text-sm font-bold ${activePal.text}`}>
                  {fmtDecHours(activeSched.matin + activeSched.apresMidi)}
                </span>
              </div>
            )}

            {/* Bouton Valider */}
            <button
              onClick={() => {
                saveDay(selectedCell.empId)
                setSelectedCell(null)
              }}
              className="w-full flex items-center justify-center gap-2 bg-[#1E3A5F] hover:bg-[#2a4f7c] text-white rounded-xl py-2.5 font-semibold text-sm transition-colors mt-1"
            >
              <Check className="w-4 h-4" />
              Valider
            </button>
          </div>
        </div>
      )}

      {/* ── Header ── */}
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
                <FileDown className="w-3.5 h-3.5 mr-1.5" />Enregistrer en PDF
              </Button>
            </>
          )}
          <Button onClick={() => setShowAdd(true)} className="bg-[#1E3A5F] hover:bg-[#2a4f7c] text-white h-8 text-sm px-3">
            <Plus className="w-3.5 h-3.5 mr-1.5" />Ajouter un employé
          </Button>
        </div>
      </div>

      {/* ── Week nav ── */}
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
        <button
          onClick={copyPrevWeek} disabled={copying}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded-md px-2.5 py-1 hover:bg-gray-50 transition-colors disabled:opacity-40"
        >
          <Copy className="w-3 h-3" />
          {copying ? 'Copie...' : `Copier S${week === 1 ? 52 : week - 1}`}
        </button>
        <div className="ml-auto flex items-center gap-4 text-xs text-gray-400">
          <span><span className="font-semibold text-gray-700">{fmtDecHours(grandH)}</span> total</span>
          <span><span className="font-semibold text-green-700">{grandCost.toFixed(2)} €</span> coût</span>
        </div>
      </div>

      {pageError && <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{pageError}</div>}

      {/* ── Grid ── */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse">
          <thead>
            <tr className="bg-white">
              <th className="w-52 px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider sticky left-0 bg-white z-10 border-b border-r border-gray-200">Employé</th>
              {weekDates.map((date, i) => {
                const isToday = date.getUTCDate() === today.getDate() && date.getUTCMonth() === today.getMonth() && date.getUTCFullYear() === today.getFullYear()
                const isWE    = i >= 5
                const fName   = weekHolidays[i]
                return (
                  <th key={i} className={`px-2 py-2 text-center min-w-[120px] border-b border-r border-gray-200 ${
                    isToday ? 'bg-[#1E3A5F]' : fName ? 'bg-amber-50' : isWE ? 'bg-gray-50' : 'bg-white'
                  }`}>
                    <div className={`text-xs font-bold uppercase tracking-wide ${
                      isToday ? 'text-white' : fName ? 'text-amber-700' : isWE ? 'text-gray-400' : 'text-gray-500'
                    }`}>{JOURS_SHORT[i]}</div>
                    <div className={`text-lg font-bold ${
                      isToday ? 'text-white' : fName ? 'text-amber-800' : isWE ? 'text-gray-300' : 'text-gray-800'
                    }`}>{date.getUTCDate()}</div>
                    <div className={`text-[10px] ${isToday ? 'text-blue-200' : 'text-gray-400'}`}>
                      {date.toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' })}
                    </div>
                    {fName && (
                      <div className="text-[8px] font-semibold text-amber-700 bg-amber-100 px-1 py-0.5 rounded mt-0.5 leading-tight truncate" title={fName}>
                        ✦ {fName}
                      </div>
                    )}
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
                  <p className="text-sm text-gray-400 mb-3">Aucun employé. Ajoutez votre équipe pour commencer.</p>
                  <Button onClick={() => setShowAdd(true)} variant="outline" className="h-8 text-sm px-3">
                    <Plus className="w-3.5 h-3.5 mr-1.5" />Ajouter un employé
                  </Button>
                </td>
              </tr>
            ) : (
              employees.map((emp, empIdx) => {
                const pal    = EMP_PALETTES[empIdx % EMP_PALETTES.length]
                const entry  = getEntryState(emp.id)
                const ch     = emp.contract_hours || 35
                const { totalH, cost } = rowStats.find(r => r.empId === emp.id) || { totalH: 0, cost: 0 }
                const hasOT  = totalH > ch
                const showContractPop = contractPopover === emp.id
                const cpInitial   = emp.cp_initial ?? 25
                const cpUsedCount = cpUsed[emp.id] || 0
                const cpRemaining = cpInitial - cpUsedCount

                return (
                  <tr key={emp.id} className="group">
                    {/* Employee cell */}
                    <td className={`px-3 py-0 sticky left-0 bg-white z-10 border-b border-r border-gray-200 ${pal.lborder}`}>
                      <div className="flex items-center gap-2 py-2">
                        <div className={`w-7 h-7 rounded-full ${pal.bg} flex items-center justify-center flex-shrink-0`}>
                          <span className={`text-[10px] font-bold ${pal.text}`}>{initials(emp.name)}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1">
                            <p className="text-sm font-semibold text-gray-900 leading-tight truncate">{emp.name}</p>
                            <button
                              onClick={e => { e.stopPropagation(); setProfileEmp({ ...emp, cp_initial: emp.cp_initial ?? 25, position: emp.position ?? null, hire_date: emp.hire_date ?? null, contract_end_date: emp.contract_end_date ?? null, phone: emp.phone ?? null, email: emp.email ?? null, notes: emp.notes ?? null, is_minor: emp.is_minor ?? false }) }}
                              className="p-1 rounded-md bg-[#1E3A5F]/10 hover:bg-[#1E3A5F]/20 text-[#1E3A5F] transition-colors flex-shrink-0"
                              title="Fiche employé"
                            >
                              <UserCog className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                            <div className="relative">
                              <button
                                onClick={e => { e.stopPropagation(); setContractPopover(showContractPop ? null : emp.id) }}
                                className="text-[10px] font-bold bg-[#1E3A5F] text-white px-1.5 py-0.5 rounded hover:bg-[#2a4f7c] transition-colors"
                              >
                                {contractLabel(emp.contract_type)}
                              </button>
                              {showContractPop && (
                                <div className="absolute top-full left-0 mt-1 z-50 bg-white rounded-xl shadow-2xl border border-gray-100 p-1.5 w-40" onClick={e => e.stopPropagation()}>
                                  <p className="text-[10px] text-gray-400 px-2 pb-1 font-medium">Type de contrat</p>
                                  {CONTRACT_TYPES.map(ct => (
                                    <button key={ct.key} onClick={() => updateContract(emp.id, ct.key)}
                                      className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-left transition-colors ${
                                        emp.contract_type === ct.key ? 'bg-[#1E3A5F] text-white' : 'hover:bg-gray-50 text-gray-700'
                                      }`}
                                    >
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
                              className="ml-auto opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-400 transition-all"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                          <div className="flex items-center gap-1 mt-1">
                            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                              cpRemaining < 0 ? 'bg-red-400' : cpRemaining <= 3 ? 'bg-orange-400' : 'bg-sky-300'
                            }`} />
                            <span className={`text-[9px] ${
                              cpRemaining < 0 ? 'text-red-500 font-semibold' : cpRemaining <= 3 ? 'text-orange-500' : 'text-gray-400'
                            }`}>{cpRemaining}j CP restants</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Day cells */}
                    {JOURS_DB.map((jour, idx) => {
                      const typeKey   = `${jour}_type` as keyof PlanningEntry
                      const type      = (entry[typeKey] as DayType) || (idx >= 5 ? 'repos' : 'travail')
                      const hours     = entry[jour] || 0
                      const sched     = getSched(emp.id, jour)
                      const isDetailOpen = selectedCell?.empId === emp.id && selectedCell?.jour === jour
                      const isTypeOpen   = typeDropCell?.empId  === emp.id && typeDropCell?.jour  === jour
                      const fName     = weekHolidays[idx]
                      const catInfo   = sched.category ? WORK_CATS.find(c => c.key === sched.category) : null
                      const matinRange = fmtRange(sched.matinDebut, sched.matinFin)
                      const apmRange   = fmtRange(sched.apmDebut,   sched.apmFin)
                      const hasRanges  = !!(matinRange || apmRange)

                      const cellBg  = fName ? 'bg-amber-50'    : type === 'travail' ? pal.bg    : TYPE_CONFIG[type].bg
                      const cellTxt = fName ? 'text-amber-800' : type === 'travail' ? pal.text  : TYPE_CONFIG[type].text
                      const cellDot = fName ? 'bg-amber-400'   : type === 'travail' ? pal.dot   : TYPE_CONFIG[type].dot
                      const typeLabel = fName ? 'Férié' : type === 'travail' ? 'Travail' : TYPE_CONFIG[type].label

                      return (
                        <td key={jour} className="p-0 border-b border-r border-gray-200 align-stretch">
                          <div className="relative h-full" data-cell="true">
                            <div className={`${cellBg} w-full h-full min-h-[100px] flex flex-col`}>

                              {/* Type badge */}
                              <div className="flex items-center px-2 pt-1.5 pb-0.5">
                                <button
                                  onClick={e => {
                                    e.stopPropagation()
                                    if (fName) return
                                    setSelectedCell(null)
                                    setTypeDropCell(isTypeOpen ? null : { empId: emp.id, jour })
                                  }}
                                  className={`flex items-center gap-1 rounded px-1 py-0.5 transition-colors ${
                                    fName ? 'cursor-default' : 'hover:bg-black/10 cursor-pointer'
                                  }`}
                                >
                                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cellDot}`} />
                                  <span className={`text-[10px] font-semibold ${cellTxt}`}>{typeLabel}</span>
                                  {!fName && <ChevronDown className={`w-2.5 h-2.5 ${cellTxt} opacity-40`} />}
                                </button>
                              </div>

                              {/* Corps cellule */}
                              <div
                                className={`flex-1 flex flex-col items-center justify-center gap-0.5 pb-2 px-1 ${
                                  !fName && type === 'travail' ? 'cursor-pointer hover:brightness-95' : ''
                                }`}
                                onClick={e => {
                                  e.stopPropagation()
                                  if (fName || type !== 'travail') return
                                  if (isDetailOpen) { setSelectedCell(null); return }
                                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                                  // Estime si le popover tient en dessous (hauteur ~380px)
                                  const openUp = rect.bottom + 390 > window.innerHeight
                                  // Evite de déborder à droite (popover = 288px)
                                  const x = Math.min(rect.left, window.innerWidth - 296)
                                  setTypeDropCell(null)
                                  setSelectedCell({
                                    empId: emp.id,
                                    jour,
                                    x,
                                    y: openUp ? rect.top : rect.bottom,
                                    openUp,
                                  })
                                }}
                              >
                                {type === 'travail' && !fName ? (
                                  <>
                                    {catInfo && (
                                      <span className={`text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-white/50 ${pal.text}`}>
                                        {catInfo.label}
                                      </span>
                                    )}
                                    {hasRanges ? (
                                      <div className="flex flex-col items-center gap-0.5">
                                        {matinRange && <span className={`text-[9px] font-semibold ${pal.text} leading-tight`}>{matinRange}</span>}
                                        {apmRange   && <span className={`text-[9px] font-semibold ${pal.text} leading-tight`}>{apmRange}</span>}
                                        <span className={`text-[11px] font-bold ${pal.text} mt-0.5`}>
                                          {hours > 0 ? `= ${fmtDecHours(hours)}` : ''}
                                        </span>
                                      </div>
                                    ) : (
                                      <>
                                        <span className={`font-bold text-xl ${pal.text} leading-none`}>
                                          {hours > 0 ? fmtDecHours(hours) : '—'}
                                        </span>
                                        {hours === 0 && <span className={`text-[9px] opacity-40 ${pal.text}`}>cliquer pour saisir</span>}
                                      </>
                                    )}
                                  </>
                                ) : (
                                  <span className={`font-bold text-2xl ${cellTxt}`}>
                                    {fName ? '✦' : TYPE_CONFIG[type].display}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* ── Dropdown type ── */}
                            {isTypeOpen && (
                              <div className="absolute top-full left-0 z-50 mt-1 bg-white rounded-xl shadow-2xl border border-gray-100 p-1.5 min-w-[170px]" data-cell="true" onClick={e => e.stopPropagation()}>
                                <p className="text-[10px] text-gray-400 px-2 py-1 font-medium uppercase tracking-wide">Type de journée</p>
                                {([
                                  { key: 'travail' as DayType, label: 'Travail',       dot: pal.dot      },
                                  { key: 'conges'  as DayType, label: 'Congé payé',    dot: 'bg-sky-400' },
                                  { key: 'maladie' as DayType, label: 'Arrêt maladie', dot: 'bg-red-400' },
                                  { key: 'repos'   as DayType, label: 'Repos',         dot: 'bg-gray-300' },
                                ]).map(opt => (
                                  <button key={opt.key} onClick={() => changeType(emp.id, jour, opt.key)}
                                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                                      type === opt.key ? 'bg-gray-100 font-semibold text-gray-900' : 'hover:bg-gray-50 text-gray-600'
                                    }`}
                                  >
                                    <div className={`w-2.5 h-2.5 rounded-sm flex-shrink-0 ${opt.dot}`} />
                                    {opt.label}
                                    {type === opt.key && <span className="ml-auto text-gray-400 text-xs">✓</span>}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                      )
                    })}

                    {/* Total */}
                    <td className="px-2 py-3 text-center border-b border-r border-gray-200">
                      <div className={`inline-flex flex-col items-center px-2 py-1 rounded-lg ${
                        hasOT ? 'bg-orange-50' : totalH > 0 ? 'bg-gray-50' : ''
                      }`}>
                        <span className={`font-bold text-sm ${
                          hasOT ? 'text-orange-600' : totalH > 0 ? 'text-gray-800' : 'text-gray-300'
                        }`}>{fmtDecHours(totalH)}</span>
                        {hasOT && <span className="text-[9px] text-orange-400">+{fmtDecHours(totalH - ch)} sup</span>}
                      </div>
                    </td>

                    {/* Cost */}
                    <td className="px-2 py-3 text-center border-b border-gray-200">
                      <span className={`font-bold text-sm ${cost > 0 ? 'text-green-700' : 'text-gray-300'}`}>
                        {cost > 0 ? `${cost.toFixed(0)} €` : '—'}
                      </span>
                    </td>
                  </tr>
                )
              })
            )}

            {/* Footer totals */}
            {employees.length > 0 && (
              <tr className="bg-gray-900">
                <td className="px-3 py-3 sticky left-0 bg-gray-900 z-10 border-r border-gray-700">
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Total / jour</span>
                </td>
                {JOURS_DB.map((jour, idx) => {
                  const dayH = employees.reduce((s, emp) => {
                    const e = getEntryState(emp.id)
                    const t = (e[`${jour}_type` as keyof PlanningEntry] as DayType) || 'travail'
                    return s + (t === 'travail' ? (e[jour] || 0) : t === 'conges' ? 7 : 0)
                  }, 0)
                  const present = employees.filter(emp => {
                    const t = (getEntryState(emp.id)[`${jour}_type` as keyof PlanningEntry] as DayType) || 'travail'
                    return t !== 'repos'
                  }).length
                  const isFerie = weekHolidays[idx] !== null
                  return (
                    <td key={jour} className={`px-2 py-3 text-center border-r border-gray-700 ${isFerie ? 'bg-amber-950/30' : ''}`}>
                      {dayH > 0
                        ? <><div className="text-sm font-bold text-white">{fmtDecHours(dayH)}</div><div className="text-[10px] text-gray-500">{present} pers.</div></>
                        : <span className="text-gray-700">—</span>}
                    </td>
                  )
                })}
                <td className="px-3 py-3 text-center border-r border-gray-700"><span className="font-bold text-white">{fmtDecHours(grandH)}</span></td>
                <td className="px-3 py-3 text-center"><span className="font-bold text-orange-400">{grandCost.toFixed(0)} €</span></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {employees.length > 0 && (
        <div className="px-6 py-2.5 bg-amber-50 border-t border-amber-100">
          <p className="text-xs text-amber-700">
            <span className="font-semibold">CCN 992 :</span>{' '}
            35h → +25 % de 36–43h · 39h → +25 % de 40–47h · +50 % au-delà · CP = 7h/jour
          </p>
        </div>
      )}

      {/* ── Récap mensuel ── */}
      {showMonthly && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm" onClick={() => setShowMonthly(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl shadow-2xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-base font-bold text-gray-900">Récapitulatif mensuel</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {weekDates[0].toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
                </p>
              </div>
              <button onClick={() => setShowMonthly(false)} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            {loadingMonthly ? (
              <div className="py-12 text-center text-sm text-gray-400">Chargement des données...</div>
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
                    const ch    = emp.contract_hours || 35
                    const hasOT = hours > ch * 4
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
                        <td className="text-center py-3">
                          <span className={`font-bold ${hasOT ? 'text-orange-600' : 'text-gray-800'}`}>{fmtDecHours(hours)}</span>
                        </td>
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
                    <td className="text-center py-2.5 font-bold text-white">{fmtDecHours(monthlyData.reduce((s, r) => s + r.hours, 0))}</td>
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

      {/* ── Fiche employé ── */}
      {profileEmp && (
        <EmployeeProfileModal
          employee={profileEmp}
          onClose={() => setProfileEmp(null)}
          onSaved={updated => {
            setEmployees(prev => prev.map(e => e.id === updated.id ? { ...e, ...updated } : e))
            setProfileEmp(null)
          }}
        />
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
                      className={`py-2.5 px-3 rounded-lg border-2 text-left transition-all ${
                        newContractKey === ct.key ? 'border-[#1E3A5F] bg-[#1E3A5F] text-white' : 'border-gray-200 text-gray-700 hover:border-gray-300 bg-white'
                      }`}
                    >
                      <div className="text-sm font-bold">{ct.short}</div>
                      <div className={`text-[10px] mt-0.5 ${newContractKey === ct.key ? 'text-blue-200' : 'text-gray-400'}`}>{ct.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setShowAdd(false)}>Annuler</Button>
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
