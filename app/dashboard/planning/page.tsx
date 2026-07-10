'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, ChevronLeft, ChevronRight, ChevronDown, Trash2, CalendarDays, FileDown, Copy, Clipboard, BarChart2, X } from 'lucide-react'

type DayType = 'travail' | 'conges' | 'maladie' | 'repos'

const JOURS_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const JOURS_DB = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const
type JourDB = typeof JOURS_DB[number]

type ScheduleDetail = {
  matin_debut?: string
  matin_fin?: string
  apmidi_debut?: string
  apmidi_fin?: string
  categorie?: string
}
type ScheduleDetails = Partial<Record<JourDB, ScheduleDetail>>

const CATEGORIES = [
  { key: 'boucherie',   short: 'Boucherie',   color: 'bg-red-100 text-red-700',      ring: 'ring-red-300'      },
  { key: 'charcuterie', short: 'Charcuterie', color: 'bg-orange-100 text-orange-700', ring: 'ring-orange-300'  },
  { key: 'traiteur',    short: 'Traiteur',    color: 'bg-emerald-100 text-emerald-700', ring: 'ring-emerald-300' },
  { key: 'vente',       short: 'Vente',       color: 'bg-sky-100 text-sky-700',       ring: 'ring-sky-300'     },
] as const

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
}
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
type MonthlyStat = {
  emp: Employee; hours: number; cost: number; worked: number; cp: number; sick: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isoWeeksInYear(y: number): number {
  const d = new Date(y, 11, 28)
  const d2 = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  d2.setUTCDate(d2.getUTCDate() + 4 - (d2.getUTCDay() || 7))
  const ys = new Date(Date.UTC(d2.getUTCFullYear(), 0, 1))
  return Math.ceil(((d2.getTime() - ys.getTime()) / 86400000 + 1) / 7)
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

/** Returns a Map of ISO date string → holiday name for all 11 French public holidays */
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
  const [detailModal,    setDetailModal]     = useState<{ empId: string; jour: JourDB; idx: number } | null>(null)
  const [contractPopover,setContractPopover] = useState<string | null>(null)
  const [loadingEmployees, setLoadingEmployees] = useState(true)
  const [showAdd,      setShowAdd]      = useState(false)
  const [newName,      setNewName]      = useState('')
  const [newRate,      setNewRate]      = useState('')
  const [newContractKey, setNewContractKey] = useState<ContractKey>('CDI_35')
  const [adding,       setAdding]       = useState(false)
  const [pageError,    setPageError]    = useState<string | null>(null)
  // New
  const [copying,        setCopying]        = useState(false)
  const [copiedCell,     setCopiedCell]     = useState<{ empId: string; jour: JourDB } | null>(null)
  const [cpUsed,         setCpUsed]         = useState<Record<string, number>>({})
  const [showMonthly,    setShowMonthly]    = useState(false)
  const [monthlyData,    setMonthlyData]    = useState<MonthlyStat[] | null>(null)
  const [loadingMonthly, setLoadingMonthly] = useState(false)

  const { week: cw, year: cy } = getISOWeek(new Date())
  const isCurrentWeek = week === cw && year === cy
  const weekDates     = getWeekDates(week, year)
  const today         = new Date()

  // Jours fériés pour l'année affichée
  const holidays     = getFrenchHolidays(year)
  const weekHolidays = weekDates.map(d => holidays.get(d.toISOString().slice(0, 10)) ?? null)

  const setEntriesSync = (updater: (prev: EntriesMap) => EntriesMap) => {
    setEntries(prev => {
      const next = updater(prev)
      entriesRef.current = next
      return next
    })
  }

  useEffect(() => {
    const close = () => setContractPopover(null)
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

  // Solde CP : rechargé à chaque changement d'année
  const refreshCpUsed = useCallback(() => {
    fetch(`/api/planning/stats?year=${year}`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          const map: Record<string, number> = {}
          for (const { employee_id, cp_used } of data) map[employee_id] = cp_used
          setCpUsed(map)
        }
      })
      .catch(() => {})
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
    setEmployees(prev => prev.map(e =>
      e.id === empId ? { ...e, contract_type: ct.key, contract_hours: ct.hours } : e
    ))
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
    setEntriesSync(prev => ({ ...prev, [empId]: updated }))
    await saveEntryValues(empId, updated)
    refreshCpUsed()
  }

  function updateHours(empId: string, jour: JourDB, value: string) {
    const hours = value === '' ? 0 : Math.max(0, Math.min(24, parseFloat(value) || 0))
    setEntriesSync(prev => ({ ...prev, [empId]: { ...getEntry(empId), [jour]: hours } }))
  }

  function handleScheduleDetailChange(empId: string, jour: JourDB, field: keyof ScheduleDetail, value: string) {
    const current = getEntry(empId)
    const currentSd = ((current.schedule_details || {}) as ScheduleDetails)
    const updated: PlanningEntry = {
      ...current,
      schedule_details: { ...currentSd, [jour]: { ...(currentSd[jour] || {}), [field]: value } }
    }
    setEntriesSync(prev => ({ ...prev, [empId]: updated }))
  }

  function handleScheduleDetailBlur(empId: string) {
    const entry = entriesRef.current[empId] ?? emptyEntry(empId, week, year)
    saveEntryValues(empId, entry)
  }

  function handleBlur(empId: string) {
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

  function prevWeek() {
    if (week === 1) { setYear(y => y - 1); setWeek(isoWeeksInYear(year - 1)) }
    else setWeek(w => w - 1)
  }
  function nextWeek() {
    const maxW = isoWeeksInYear(year)
    if (week === maxW) { setYear(y => y + 1); setWeek(1) }
    else setWeek(w => w + 1)
  }

  async function copyPrevWeek() {
    if (copying) return
    const prevY = week === 1 ? year - 1 : year
    const prevW = week === 1 ? isoWeeksInYear(prevY) : week - 1
    setCopying(true)
    try {
      const res = await fetch(`/api/planning?week=${prevW}&year=${prevY}`)
      const data = await res.json()
      if (!Array.isArray(data) || data.length === 0) {
        alert(`Aucun planning trouvé pour la semaine ${prevW} (${prevY}).`)
        return
      }
      const posts = data.map((entry: Record<string, unknown>) => {
        const entryData = { ...entry }; delete entryData.id
        return fetch('/api/planning', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...entryData, week_number: week, year }),
        })
      })
      await Promise.all(posts)
      loadEntries()
    } finally {
      setCopying(false)
    }
  }

  function pasteDay(toEmpId: string, toJour: JourDB) {
    if (!copiedCell) return
    const fromEntry = getEntryState(copiedCell.empId)
    const fromType  = (fromEntry[`${copiedCell.jour}_type` as keyof PlanningEntry] as DayType) || 'travail'
    const fromHours = (fromEntry[copiedCell.jour as keyof PlanningEntry] as number) || 0
    const toEntry   = getEntryState(toEmpId)
    const updated: PlanningEntry = {
      ...toEntry,
      [`${toJour}_type`]: fromType,
      [toJour]: fromHours,
    }
    setEntriesSync(prev => ({ ...prev, [toEmpId]: updated }))
    saveEntryValues(toEmpId, updated)
  }

  async function openMonthly() {
    setShowMonthly(true)
    setLoadingMonthly(true)
    setMonthlyData(null)
    const monthYear = weekDates[0].getUTCFullYear()
    const month     = weekDates[0].getUTCMonth() + 1
    const weeks     = getWeeksInMonth(monthYear, month)
    try {
      const allResults = await Promise.all(
        weeks.map(({ week: w, year: y }) =>
          fetch(`/api/planning?week=${w}&year=${y}`).then(r => r.json()).catch(() => [])
        )
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
    } finally {
      setLoadingMonthly(false)
    }
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
        const bg     = fName ? '#fef3c7' : type === 'travail' ? pal.lightHex : TYPE_CONFIG[type].pdfColor
        const label  = type === 'travail'
          ? (h > 0 ? `<strong>${h}h</strong>` : '—')
          : `<span style="font-size:9px;">${TYPE_CONFIG[type].label}</span>`
        return `<td style="padding:6px 4px;text-align:center;background:${bg};border-bottom:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">${label}${fName ? `<br><span style="font-size:8px;color:#92400e;">Férié</span>` : ''}</td>`
      }).join('')
      return `<tr>
        <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;border-left:3px solid ${pal.hex};background:#fafafa;">
          <div style="display:flex;align-items:center;gap:7px;">
            <div style="width:26px;height:26px;border-radius:50%;background:${pal.hex};display:flex;align-items:center;justify-content:center;"><span style="color:white;font-size:9px;font-weight:700;">${initials(emp.name)}</span></div>
            <div><div style="font-weight:700;font-size:12px;">${emp.name}</div><div style="font-size:9px;color:#94a3b8;">${contractLabel(emp.contract_type)} · ${Number(emp.hourly_rate).toFixed(2)} €/h</div></div>
          </div>
        </td>${cells}
        <td style="padding:6px;text-align:center;font-weight:700;font-size:12px;color:${totalH > ch ? '#ea580c' : '#1e293b'};background:#f8fafc;border-bottom:1px solid #e2e8f0;">${totalH.toFixed(1)}h</td>
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
<p style="margin-top:10px;font-size:9px;color:#94a3b8;">Seuils : 35h → +25 % de 36–43h · 39h → +25 % de 40–47h · +50 % au-delà · CP = 7h/jour · Généré via PILOTE</p>
</body></html>`
    const win = window.open('', '_blank', 'width=1100,height=750')
    if (!win) return
    win.document.write(html); win.document.close(); win.focus()
    setTimeout(() => win.print(), 600)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <style>{`
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
      `}</style>

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
          onClick={copyPrevWeek}
          disabled={copying}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded-md px-2.5 py-1 hover:bg-gray-50 transition-colors disabled:opacity-40"
        >
          <Copy className="w-3 h-3" />
          {copying ? 'Copie...' : `Copier S${week === 1 ? isoWeeksInYear(year - 1) : week - 1}`}
        </button>
        <div className="ml-auto flex items-center gap-4 text-xs text-gray-400">
          <span><span className="font-semibold text-gray-700">{grandH.toFixed(1)}h</span> total</span>
          <span><span className="font-semibold text-green-700">{grandCost.toFixed(2)} €</span> coût</span>
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="bg-white border-b border-gray-100 px-6 py-2 flex items-center gap-5">
        <span className="text-xs font-medium text-gray-400">Types :</span>
        {([
          { label: 'Travail',       dot: 'bg-violet-400' },
          { label: 'Congé payé',   dot: 'bg-sky-400'    },
          { label: 'Arrêt maladie',dot: 'bg-red-400'    },
          { label: 'Repos',        dot: 'bg-gray-300'   },
          { label: 'Jour férié',   dot: 'bg-amber-400'  },
        ]).map(t => (
          <div key={t.label} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-sm ${t.dot}`} />
            <span className="text-xs text-gray-600">{t.label}</span>
          </div>
        ))}
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
                  <th key={i} className={`px-2 py-2 text-center min-w-[155px] border-b border-r border-gray-200 ${
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
                          <p className="text-sm font-semibold text-gray-900 leading-tight truncate">{emp.name}</p>
                          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                            <div className="relative">
                              <button
                                onClick={e => { e.stopPropagation(); setContractPopover(showContractPop ? null : emp.id) }}
                                className="text-[10px] font-bold bg-[#1E3A5F] text-white px-1.5 py-0.5 rounded hover:bg-[#2a4f7c] transition-colors cursor-pointer"
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
                          {/* CP balance */}
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
                      const typeKey  = `${jour}_type` as keyof PlanningEntry
                      const type     = (entry[typeKey] as DayType) || (idx >= 5 ? 'repos' : 'travail')
                      const hours    = entry[jour] || 0
                      const fName    = weekHolidays[idx]
                      const sd: ScheduleDetail = ((entry.schedule_details as ScheduleDetails | undefined) || {})[jour] || {}
                      const catSel   = CATEGORIES.find(c => c.key === sd.categorie)

                      const cellBg   = fName ? 'bg-amber-50'    : type === 'travail' ? pal.bg   : TYPE_CONFIG[type].bg
                      const cellTxt  = fName ? 'text-amber-800' : type === 'travail' ? pal.text : TYPE_CONFIG[type].text
                      const cellDot  = fName ? 'bg-amber-400'   : type === 'travail' ? pal.dot  : TYPE_CONFIG[type].dot
                      const typeLabel = fName ? 'Férié' : type === 'travail' ? 'Travail' : TYPE_CONFIG[type].label

                      return (
                        <td key={jour} className="p-0 border-b border-r border-gray-200 align-stretch group/cell">
                          <div className="relative h-full" data-cell="true" onClick={e => e.stopPropagation()}>
                            <div
                              className={`cursor-pointer transition-colors ${cellBg} w-full h-full min-h-[145px] px-2 pt-2 pb-2 flex flex-col select-none hover:brightness-95`}
                              onClick={e => { e.stopPropagation(); setContractPopover(null); setDetailModal({ empId: emp.id, jour, idx }) }}
                            >
                              {/* ── Top: type + copy ── */}
                              <div className="flex items-center justify-between gap-1">
                                <div className="flex items-center gap-1 min-w-0">
                                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cellDot}`} />
                                  <span className={`text-[10px] font-semibold truncate ${cellTxt}`}>{typeLabel}</span>
                                </div>
                                {!fName && (
                                  <div className="ml-auto flex items-center gap-0.5">
                                    <button
                                      className={`p-0.5 rounded transition-all ${
                                        copiedCell?.empId === emp.id && copiedCell?.jour === jour
                                          ? 'bg-blue-500 text-white opacity-100'
                                          : 'opacity-0 group-hover/cell:opacity-100 bg-white/60 text-gray-400 hover:text-gray-700'
                                      }`}
                                      onClick={e => { e.stopPropagation(); setCopiedCell(copiedCell?.empId === emp.id && copiedCell?.jour === jour ? null : { empId: emp.id, jour }) }}
                                      title="Copier ce jour"
                                    >
                                      <Copy className="w-2.5 h-2.5" />
                                    </button>
                                    {copiedCell && !(copiedCell.empId === emp.id && copiedCell.jour === jour) && (
                                      <button
                                        className="p-0.5 rounded bg-white/60 text-blue-500 hover:text-blue-700 opacity-0 group-hover/cell:opacity-100 transition-all"
                                        onClick={e => { e.stopPropagation(); pasteDay(emp.id, jour) }}
                                        title="Coller ici"
                                      >
                                        <Clipboard className="w-2.5 h-2.5" />
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* ── Centre: résumé ── */}
                              {!fName && type === 'travail' ? (
                                <div className="flex-1 flex flex-col py-1.5 gap-1 px-1.5">
                                  {/* Poste badge */}
                                  <div className="flex justify-center">
                                    {catSel ? (
                                      <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${catSel.color}`}>
                                        {catSel.short}
                                      </span>
                                    ) : (
                                      <span className="text-[9px] text-gray-300 font-medium">—</span>
                                    )}
                                  </div>

                                  {/* Matin row — toujours visible */}
                                  <div className={`flex items-center gap-1 rounded-md px-1.5 py-[3px] ${
                                    sd.matin_debut ? 'bg-amber-50 border border-amber-100' : 'bg-gray-50'
                                  }`}>
                                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sd.matin_debut ? 'bg-amber-400' : 'bg-gray-200'}`} />
                                    <span className="text-[8px] font-bold text-gray-400 w-3 shrink-0">M</span>
                                    <span className={`text-[9px] font-semibold truncate ${sd.matin_debut ? 'text-gray-700' : 'text-gray-300'}`}>
                                      {sd.matin_debut ? `${sd.matin_debut}→${sd.matin_fin || '?'}` : '--:--'}
                                    </span>
                                  </div>

                                  {/* Après-midi row — toujours visible */}
                                  <div className={`flex items-center gap-1 rounded-md px-1.5 py-[3px] ${
                                    sd.apmidi_debut ? 'bg-sky-50 border border-sky-100' : 'bg-gray-50'
                                  }`}>
                                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sd.apmidi_debut ? 'bg-sky-400' : 'bg-gray-200'}`} />
                                    <span className="text-[8px] font-bold text-gray-400 w-3 shrink-0">AM</span>
                                    <span className={`text-[9px] font-semibold truncate ${sd.apmidi_debut ? 'text-gray-700' : 'text-gray-300'}`}>
                                      {sd.apmidi_debut ? `${sd.apmidi_debut}→${sd.apmidi_fin || '?'}` : '--:--'}
                                    </span>
                                  </div>

                                  {/* Total heures */}
                                  <div className="flex justify-center mt-0.5">
                                    <span className={`text-sm font-bold ${hours > 0 ? pal.text : 'text-gray-300'}`}>
                                      {hours > 0 ? `${hours}h` : '—'}
                                    </span>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex-1 flex items-center justify-center">
                                  <span className={`font-bold text-2xl ${cellTxt}`}>
                                    {fName ? '✦' : TYPE_CONFIG[type].display}
                                  </span>
                                </div>
                              )}
                            </div>
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
                        }`}>{totalH.toFixed(1)}h</span>
                        {hasOT && <span className="text-[9px] text-orange-400">+{(totalH - ch).toFixed(1)} sup</span>}
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

            {/* Footer row */}
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
            <span className="font-semibold">Majoration :</span>{' '}
            35h → +25 % de 36–43h, +50 % au-delà{' · '}
            39h → +25 % de 40–47h, +50 % au-delà{' · '}
            CP = 7h/jour
          </p>
        </div>
      )}

      {/* ── Detail Modal ── */}
      {detailModal && (() => {
        const mEmpIdx = employees.findIndex(e => e.id === detailModal.empId)
        if (mEmpIdx < 0) return null
        const mEmp   = employees[mEmpIdx]
        const mPal   = EMP_PALETTES[mEmpIdx % EMP_PALETTES.length]
        const mEntry = getEntryState(detailModal.empId)
        const mJour  = detailModal.jour
        const mIdx   = detailModal.idx
        const mType  = (mEntry[`${mJour}_type` as keyof PlanningEntry] as DayType) || (mIdx >= 5 ? 'repos' : 'travail')
        const mHours = (mEntry[mJour] as number) || 0
        const mSd: ScheduleDetail = ((mEntry.schedule_details as ScheduleDetails | undefined) || {})[mJour] || {}
        const mDate  = weekDates[mIdx]
        const mFName = weekHolidays[mIdx]

        return (
          <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50 backdrop-blur-[2px]" onClick={() => setDetailModal(null)}>
            <div className="bg-white rounded-2xl w-full max-w-xs shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>

              {/* Barre couleur fine */}
              <div className="h-[3px]" style={{ background: mPal.hex }} />

              {/* Header minimal */}
              <div className="px-5 pt-4 pb-3.5 flex items-center justify-between border-b border-gray-100">
                <div>
                  <p className="font-semibold text-gray-900 text-sm leading-tight">{mEmp.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {JOURS_SHORT[mIdx]} {mDate.getUTCDate()} {mDate.toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' })}
                    {mFName && <span className="text-amber-500"> · {mFName}</span>}
                  </p>
                </div>
                <button onClick={() => setDetailModal(null)} className="p-1.5 rounded-lg text-gray-300 hover:text-gray-500 hover:bg-gray-50 transition-colors ml-4">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="px-5 py-4 space-y-4">

                {/* Segmented control type */}
                <div className="flex bg-gray-100 rounded-xl p-1 gap-0.5">
                  {(['travail', 'conges', 'maladie', 'repos'] as DayType[]).map(t => (
                    <button key={t}
                      onClick={() => changeType(detailModal.empId, mJour, t)}
                      className={`flex-1 py-1.5 text-[11px] font-semibold rounded-[9px] transition-all ${
                        mType === t ? 'bg-white shadow-sm text-gray-900' : 'text-gray-400 hover:text-gray-600'
                      }`}
                    >
                      {t === 'travail' ? 'Travail' : t === 'conges' ? 'Congé' : t === 'maladie' ? 'Maladie' : 'Repos'}
                    </button>
                  ))}
                </div>

                {mType === 'travail' && !mFName && (
                  <div className="space-y-3.5">

                    {/* Durée */}
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400 w-20 shrink-0">Durée</span>
                      <div className="flex items-center gap-2">
                        <input type="number" min="0" max="24" step="0.5"
                          value={mHours || ''}
                          onChange={e => updateHours(detailModal.empId, mJour, e.target.value)}
                          onBlur={() => handleBlur(detailModal.empId)}
                          className="w-14 text-center text-sm font-bold border border-gray-200 rounded-lg py-1.5 focus:outline-none focus:border-gray-400 transition-colors"
                          placeholder="0"
                        />
                        <span className="text-xs text-gray-400">heures</span>
                      </div>
                    </div>

                    {/* Poste */}
                    <div className="flex items-start gap-3">
                      <span className="text-xs text-gray-400 w-20 shrink-0 pt-1">Poste</span>
                      <div className="flex flex-wrap gap-1.5">
                        {CATEGORIES.map(cat => {
                          const isSel = mSd.categorie === cat.key
                          return (
                            <button key={cat.key}
                              onClick={() => {
                                handleScheduleDetailChange(detailModal.empId, mJour, 'categorie' as keyof ScheduleDetail, isSel ? '' : cat.key)
                                setTimeout(() => handleScheduleDetailBlur(detailModal.empId), 0)
                              }}
                              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                                isSel ? cat.color : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                              }`}
                            >
                              {cat.short}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* Horaires */}
                    <div className="flex items-start gap-3">
                      <span className="text-xs text-gray-400 w-20 shrink-0 pt-1.5">Horaires</span>
                      <div className="space-y-2 flex-1">
                        {([
                          { label: 'Matin',      startF: 'matin_debut'  as keyof ScheduleDetail, endF: 'matin_fin'  as keyof ScheduleDetail },
                          { label: 'Après-midi', startF: 'apmidi_debut' as keyof ScheduleDetail, endF: 'apmidi_fin' as keyof ScheduleDetail },
                        ]).map(({ label, startF, endF }) => (
                          <div key={label} className="flex items-center gap-2">
                            <span className="text-[11px] text-gray-300 w-16 shrink-0">{label}</span>
                            <input type="text" inputMode="numeric" placeholder="--:--" maxLength={5}
                              value={mSd[startF] || ''}
                              onChange={e => handleScheduleDetailChange(detailModal.empId, mJour, startF, e.target.value)}
                              onBlur={() => handleScheduleDetailBlur(detailModal.empId)}
                              className="w-14 text-center text-xs border border-gray-200 rounded-lg py-1.5 focus:outline-none focus:border-gray-400 transition-colors"
                            />
                            <span className="text-gray-200 text-xs">→</span>
                            <input type="text" inputMode="numeric" placeholder="--:--" maxLength={5}
                              value={mSd[endF] || ''}
                              onChange={e => handleScheduleDetailChange(detailModal.empId, mJour, endF, e.target.value)}
                              onBlur={() => handleScheduleDetailBlur(detailModal.empId)}
                              className="w-14 text-center text-xs border border-gray-200 rounded-lg py-1.5 focus:outline-none focus:border-gray-400 transition-colors"
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                  </div>
                )}

              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Récap mensuel modal ── */}
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
                    const pal  = EMP_PALETTES[i % EMP_PALETTES.length]
                    const ch   = emp.contract_hours || 35
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
                          <span className={`font-bold ${hasOT ? 'text-orange-600' : 'text-gray-800'}`}>{hours.toFixed(1)}h</span>
                        </td>
                        <td className="text-center py-3 text-gray-600">{worked > 0 ? `${worked}j` : '—'}</td>
                        <td className="text-center py-3">
                          {cp > 0 ? <span className="text-sky-700 font-medium">{cp}j</span> : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="text-center py-3">
                          {sick > 0 ? <span className="text-red-600 font-medium">{sick}j</span> : <span className="text-gray-300">—</span>}
                        </td>
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

      {/* ── Ajout employé modal ── */}
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
