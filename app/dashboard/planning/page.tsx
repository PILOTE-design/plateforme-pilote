'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, ChevronLeft, ChevronRight, ChevronDown, Trash2, CalendarDays, FileDown } from 'lucide-react'

type DayType = 'travail' | 'conges' | 'maladie' | 'repos'

const JOURS_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const JOURS_DB = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const
type JourDB = typeof JOURS_DB[number]

const TYPE_CONFIG: Record<DayType, {
  label: string; bg: string; text: string; dot: string; defaultHours: number; pdfColor: string; display: string
}> = {
  travail: { label: 'Travail',       bg: '',             text: '',              dot: '',           defaultHours: 0, pdfColor: '',       display: '' },
  conges:  { label: 'Congé payé',    bg: 'bg-sky-100',   text: 'text-sky-800',  dot: 'bg-sky-400', defaultHours: 7, pdfColor: '#bae6fd', display: '7h' },
  maladie: { label: 'Arrêt maladie', bg: 'bg-red-100',   text: 'text-red-800',  dot: 'bg-red-400', defaultHours: 0, pdfColor: '#fecaca', display: 'AM' },
  repos:   { label: 'Repos',         bg: 'bg-gray-100',  text: 'text-gray-400', dot: 'bg-gray-300', defaultHours: 0, pdfColor: '#f3f4f6', display: '—' },
}

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

type Employee = { id: string; name: string; hourly_rate: number; created_at: string }
type PlanningEntry = {
  id?: string; employee_id: string; week_number: number; year: number
  lundi: number; lundi_type: DayType
  mardi: number; mardi_type: DayType
  mercredi: number; mercredi_type: DayType
  jeudi: number; jeudi_type: DayType
  vendredi: number; vendredi_type: DayType
  samedi: number; samedi_type: DayType
  dimanche: number; dimanche_type: DayType
}
type EntriesMap = Record<string, PlanningEntry>

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

function calcCost(entry: PlanningEntry, rate: number) {
  const totalH = JOURS_DB.reduce((s, j) => {
    const t = (entry[`${j}_type` as keyof PlanningEntry] as DayType) || 'travail'
    return s + (t === 'travail' ? (entry[j] || 0) : t === 'conges' ? 7 : 0)
  }, 0)
  if (totalH <= 35) return totalH * rate
  if (totalH <= 43) return 35 * rate + (totalH - 35) * rate * 1.25
  return 35 * rate + 8 * rate * 1.25 + (totalH - 43) * rate * 1.5
}

function calcTotalH(entry: PlanningEntry) {
  return JOURS_DB.reduce((s, j) => {
    const t = (entry[`${j}_type` as keyof PlanningEntry] as DayType) || 'travail'
    return s + (t === 'travail' ? (entry[j] || 0) : t === 'conges' ? 7 : 0)
  }, 0)
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

export default function PlanningPage() {
  const now = getISOWeek(new Date())
  const [week, setWeek] = useState(now.week)
  const [year, setYear] = useState(now.year)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [entries, setEntries] = useState<EntriesMap>({})
  const entriesRef = useRef<EntriesMap>({})
  const [selectedCell, setSelectedCell] = useState<{ empId: string; jour: JourDB } | null>(null)
  const [editingCell, setEditingCell] = useState<{ empId: string; jour: JourDB } | null>(null)
  const [loadingEmployees, setLoadingEmployees] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newRate, setNewRate] = useState('')
  const [adding, setAdding] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)

  const { week: cw, year: cy } = getISOWeek(new Date())
  const isCurrentWeek = week === cw && year === cy
  const weekDates = getWeekDates(week, year)
  const today = new Date()

  const setEntriesSync = (updater: (prev: EntriesMap) => EntriesMap) => {
    setEntries(prev => {
      const next = updater(prev)
      entriesRef.current = next
      return next
    })
  }

  useEffect(() => {
    if (!selectedCell) return
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest('[data-cell]')) setSelectedCell(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [selectedCell])

  useEffect(() => {
    fetch('/api/employees').then(r => r.json()).then(data => {
      if (Array.isArray(data)) { setEmployees(data); setPageError(null) }
      else setPageError(data?.error || 'Erreur chargement')
      setLoadingEmployees(false)
    }).catch(() => { setPageError('Erreur réseau'); setLoadingEmployees(false) })
  }, [])

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

  function getEntry(empId: string) { return entriesRef.current[empId] ?? emptyEntry(empId, week, year) }
  function getEntryState(empId: string) { return entries[empId] ?? emptyEntry(empId, week, year) }

  async function saveEntryValues(empId: string, entry: PlanningEntry) {
    await fetch('/api/planning', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...entry, employee_id: empId, week_number: week, year }),
    })
  }

  function changeType(empId: string, jour: JourDB, newType: DayType) {
    const typeKey = `${jour}_type` as keyof PlanningEntry
    const currentH = getEntry(empId)[jour] || 0
    const updated: PlanningEntry = {
      ...getEntry(empId), [typeKey]: newType,
      [jour]: newType === 'travail' ? currentH : TYPE_CONFIG[newType].defaultHours,
    }
    setEntriesSync(prev => ({ ...prev, [empId]: updated }))
    setSelectedCell(null)
    setEditingCell(null)
    saveEntryValues(empId, updated)
  }

  function updateHours(empId: string, jour: JourDB, value: string) {
    const hours = value === '' ? 0 : Math.max(0, Math.min(24, parseFloat(value) || 0))
    const updated = { ...getEntry(empId), [jour]: hours }
    setEntriesSync(prev => ({ ...prev, [empId]: updated }))
  }

  function handleBlur(empId: string) {
    saveEntryValues(empId, entriesRef.current[empId] ?? emptyEntry(empId, week, year))
    setEditingCell(null)
  }

  async function addEmployee() {
    if (!newName.trim() || !newRate) return
    setAdding(true)
    const res = await fetch('/api/employees', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), hourly_rate: parseFloat(newRate) }),
    })
    const data = await res.json()
    if (data.id) { setEmployees(p => [...p, data]); setNewName(''); setNewRate(''); setShowAdd(false) }
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

  const rowStats = employees.map(emp => {
    const e = getEntryState(emp.id)
    return { empId: emp.id, totalH: calcTotalH(e), cost: calcCost(e, Number(emp.hourly_rate)) }
  })
  const grandH = rowStats.reduce((s, r) => s + r.totalH, 0)
  const grandCost = rowStats.reduce((s, r) => s + r.cost, 0)

  function exportPDF() {
    const dates = getWeekDates(week, year)
    const fmtD = (d: Date) => d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    const dayHeaders = dates.map((d, i) =>
      `<th style="background:${i >= 5 ? '#94a3b8' : '#1E3A5F'};color:white;padding:7px 5px;font-size:10px;text-align:center;">${fmtD(d)}</th>`
    ).join('')
    const empRows = employees.map((emp, i) => {
      const pal = EMP_PALETTES[i % EMP_PALETTES.length]
      const entry = getEntryState(emp.id)
      const totalH = calcTotalH(entry); const cost = calcCost(entry, Number(emp.hourly_rate))
      const cells = JOURS_DB.map((j, idx) => {
        const type = (entry[`${j}_type` as keyof PlanningEntry] as DayType) || (idx >= 5 ? 'repos' : 'travail')
        const h = entry[j] || 0
        const bg = type === 'travail' ? pal.lightHex : TYPE_CONFIG[type].pdfColor
        const label = type === 'travail' ? (h > 0 ? `<strong>${h}h</strong>` : '—') : `<span style="font-size:9px;">${TYPE_CONFIG[type].label}</span>`
        return `<td style="padding:6px 4px;text-align:center;background:${bg};border-bottom:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">${label}</td>`
      }).join('')
      return `<tr>
        <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;border-left:3px solid ${pal.hex};background:#fafafa;">
          <div style="display:flex;align-items:center;gap:7px;">
            <div style="width:26px;height:26px;border-radius:50%;background:${pal.hex};display:flex;align-items:center;justify-content:center;"><span style="color:white;font-size:9px;font-weight:700;">${initials(emp.name)}</span></div>
            <div><div style="font-weight:700;font-size:12px;">${emp.name}</div><div style="font-size:9px;color:#94a3b8;">${Number(emp.hourly_rate).toFixed(2)} €/h</div></div>
          </div>
        </td>${cells}
        <td style="padding:6px;text-align:center;font-weight:700;font-size:12px;color:${totalH > 35 ? '#ea580c' : '#1e293b'};background:#f8fafc;border-bottom:1px solid #e2e8f0;">${totalH.toFixed(1)}h</td>
        <td style="padding:6px;text-align:center;font-weight:700;font-size:12px;color:#15803d;background:#f0fdf4;border-bottom:1px solid #e2e8f0;">${cost.toFixed(2)} €</td>
      </tr>`
    }).join('')
    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Planning S${week}</title>
<style>@page{size:A4 landscape;margin:1.2cm 1.5cm}*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;color:#1e293b}table{width:100%;border-collapse:collapse}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid #1E3A5F;">
  <div><div style="font-size:18px;font-weight:800;color:#1E3A5F;">Planning — Semaine ${week}</div><div style="font-size:11px;color:#64748b;margin-top:2px;">${getWeekLabel(week, year)}</div></div>
  <div style="text-align:right;"><div style="font-size:10px;color:#64748b;">Coût main d'œuvre</div><div style="font-size:16px;font-weight:800;color:#15803d;">${grandCost.toFixed(2)} €</div></div>
</div>
<table><thead><tr><th style="background:#1E3A5F;color:white;padding:7px 10px;font-size:10px;text-align:left;width:150px;">Employé</th>${dayHeaders}<th style="background:#1E3A5F;color:white;padding:7px 5px;font-size:10px;text-align:center;">Total</th><th style="background:#1E3A5F;color:white;padding:7px 5px;font-size:10px;text-align:center;">Coût</th></tr></thead><tbody>${empRows}</tbody></table>
<p style="margin-top:10px;font-size:9px;color:#94a3b8;">Droit français : ≤ 35h normal · +25 % de 36-43h · +50 % au-delà · CP = 7h/jour · Généré via PILOTE</p>
</body></html>`
    const win = window.open('', '_blank', 'width=1100,height=750')
    if (!win) return
    win.document.write(html); win.document.close(); win.focus()
    setTimeout(() => win.print(), 600)
  }

  return (
    <div className="min-h-screen bg-gray-50" onClick={() => { setSelectedCell(null); setEditingCell(null) }}>
      {/* Hide number input spinners globally */}
      <style>{`
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
      `}</style>

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <CalendarDays className="w-5 h-5 text-[#1E3A5F]" />
          <h1 className="text-lg font-bold text-gray-900">Planning des équipes</h1>
        </div>
        <div className="flex items-center gap-2">
          {employees.length > 0 && (
            <Button onClick={exportPDF} variant="outline" className="h-8 text-sm px-3 border-[#1E3A5F] text-[#1E3A5F] hover:bg-blue-50">
              <FileDown className="w-3.5 h-3.5 mr-1.5" />Enregistrer en PDF
            </Button>
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
        <div className="ml-auto flex items-center gap-4 text-xs text-gray-400">
          <span><span className="font-semibold text-gray-700">{grandH.toFixed(1)}h</span> total</span>
          <span><span className="font-semibold text-green-700">{grandCost.toFixed(2)} €</span> coût</span>
        </div>
      </div>

      {/* Legend */}
      <div className="bg-white border-b border-gray-100 px-6 py-2 flex items-center gap-5">
        <span className="text-xs font-medium text-gray-400">Types :</span>
        {([
          { key: 'travail', label: 'Travail',       dot: 'bg-violet-400' },
          { key: 'conges',  label: 'Congé payé',    dot: 'bg-sky-400'    },
          { key: 'maladie', label: 'Arrêt maladie', dot: 'bg-red-400'    },
          { key: 'repos',   label: 'Repos',         dot: 'bg-gray-300'   },
        ] as const).map(t => (
          <div key={t.key} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-sm ${t.dot}`} />
            <span className="text-xs text-gray-600">{t.label}</span>
          </div>
        ))}
      </div>

      {pageError && <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{pageError}</div>}

      {/* Grid */}
      <div className="overflow-x-auto" onClick={e => e.stopPropagation()}>
        <table className="w-full min-w-[860px] border-collapse">
          <thead>
            <tr className="bg-white">
              <th className="w-44 px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider sticky left-0 bg-white z-10 border-b border-r border-gray-200">Employé</th>
              {weekDates.map((date, i) => {
                const isToday = date.getUTCDate() === today.getDate() && date.getUTCMonth() === today.getMonth() && date.getUTCFullYear() === today.getFullYear()
                const isWE = i >= 5
                return (
                  <th key={i} className={`px-2 py-3 text-center min-w-[110px] border-b border-r border-gray-200 ${
                    isToday ? 'bg-[#1E3A5F]' : isWE ? 'bg-gray-50' : 'bg-white'
                  }`}>
                    <div className={`text-xs font-bold uppercase tracking-wide ${
                      isToday ? 'text-white' : isWE ? 'text-gray-400' : 'text-gray-500'
                    }`}>{JOURS_SHORT[i]}</div>
                    <div className={`text-lg font-bold ${
                      isToday ? 'text-white' : isWE ? 'text-gray-300' : 'text-gray-800'
                    }`}>{date.getUTCDate()}</div>
                    <div className={`text-[10px] ${
                      isToday ? 'text-blue-200' : 'text-gray-400'
                    }`}>{date.toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' })}</div>
                  </th>
                )
              })}
              <th className="px-3 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-r border-gray-200 w-20">Total</th>
              <th className="px-3 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-r border-gray-200 w-24">Coût</th>
              <th className="w-10 border-b border-gray-200" />
            </tr>
          </thead>
          <tbody>
            {loadingEmployees ? (
              <tr><td colSpan={12} className="py-12 text-center text-sm text-gray-400">Chargement...</td></tr>
            ) : employees.length === 0 && !pageError ? (
              <tr>
                <td colSpan={12} className="py-16 text-center">
                  <CalendarDays className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-400 mb-3">Aucun employé. Ajoutez votre équipe pour commencer.</p>
                  <Button onClick={() => setShowAdd(true)} variant="outline" className="h-8 text-sm px-3">
                    <Plus className="w-3.5 h-3.5 mr-1.5" />Ajouter un employé
                  </Button>
                </td>
              </tr>
            ) : (
              employees.map((emp, empIdx) => {
                const pal = EMP_PALETTES[empIdx % EMP_PALETTES.length]
                const entry = getEntryState(emp.id)
                const { totalH, cost } = rowStats.find(r => r.empId === emp.id) || { totalH: 0, cost: 0 }
                const hasOT = totalH > 35

                return (
                  <tr key={emp.id}>
                    {/* Employee name */}
                    <td className={`px-3 py-0 sticky left-0 bg-white z-10 border-b border-r border-gray-200 ${pal.lborder}`}>
                      <div className="flex items-center gap-2 py-3">
                        <div className={`w-7 h-7 rounded-full ${pal.bg} flex items-center justify-center flex-shrink-0`}>
                          <span className={`text-[10px] font-bold ${pal.text}`}>{initials(emp.name)}</span>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900 leading-tight">{emp.name}</p>
                          <p className="text-[10px] text-gray-400">{Number(emp.hourly_rate).toFixed(2)} €/h</p>
                        </div>
                      </div>
                    </td>

                    {/* Day cells */}
                    {JOURS_DB.map((jour, idx) => {
                      const typeKey = `${jour}_type` as keyof PlanningEntry
                      const type = (entry[typeKey] as DayType) || (idx >= 5 ? 'repos' : 'travail')
                      const hours = entry[jour] || 0
                      const isSelected = selectedCell?.empId === emp.id && selectedCell?.jour === jour
                      const isEditing = editingCell?.empId === emp.id && editingCell?.jour === jour

                      const cellBg  = type === 'travail' ? pal.bg : TYPE_CONFIG[type].bg
                      const cellTxt = type === 'travail' ? pal.text : TYPE_CONFIG[type].text
                      const cellDot = type === 'travail' ? pal.dot  : TYPE_CONFIG[type].dot
                      const typeLabel = type === 'travail' ? 'Travail' : TYPE_CONFIG[type].label

                      return (
                        <td key={jour} className="p-0 border-b border-r border-gray-200 align-stretch">
                          <div className="relative h-full" data-cell="true" onClick={e => e.stopPropagation()}>
                            {/* Case plein cadre */}
                            <div
                              className={`cursor-pointer transition-colors ${cellBg} w-full h-full min-h-[76px] px-2.5 pt-2 pb-2 flex flex-col justify-between select-none hover:brightness-95`}
                              onClick={() => setSelectedCell(isSelected ? null : { empId: emp.id, jour })}
                            >
                              {/* Type label + chevron */}
                              <div className="flex items-center justify-between gap-1">
                                <div className="flex items-center gap-1 min-w-0">
                                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cellDot}`} />
                                  <span className={`text-[10px] font-semibold truncate ${cellTxt}`}>{typeLabel}</span>
                                </div>
                                <ChevronDown className={`w-3 h-3 flex-shrink-0 opacity-30 ${cellTxt}`} />
                              </div>

                              {/* Valeur centrale — même affichage pour tous les types */}
                              <div className="flex-1 flex items-center justify-center">
                                {type === 'travail' ? (
                                  isEditing ? (
                                    <input
                                      autoFocus
                                      type="number" min="0" max="24" step="0.5"
                                      value={hours || ''}
                                      onChange={e => updateHours(emp.id, jour, e.target.value)}
                                      onBlur={() => handleBlur(emp.id)}
                                      onClick={e => e.stopPropagation()}
                                      className={`w-16 text-center font-bold text-2xl bg-transparent focus:outline-none border-b border-current ${pal.text}`}
                                      placeholder="0"
                                    />
                                  ) : (
                                    <span
                                      onClick={e => { e.stopPropagation(); setEditingCell({ empId: emp.id, jour }) }}
                                      className={`font-bold text-2xl ${pal.text} cursor-text`}
                                    >
                                      {hours > 0 ? `${hours}h` : '—'}
                                    </span>
                                  )
                                ) : (
                                  <span className={`font-bold text-2xl ${cellTxt}`}>
                                    {TYPE_CONFIG[type].display}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Dropdown type */}
                            {isSelected && (
                              <div
                                className="absolute top-full left-0 z-40 mt-1 bg-white rounded-xl shadow-2xl border border-gray-100 p-1.5 min-w-[168px]"
                                data-cell="true"
                                onClick={e => e.stopPropagation()}
                              >
                                {([
                                  { key: 'travail' as DayType, label: 'Travail',       dot: pal.dot         },
                                  { key: 'conges'  as DayType, label: 'Congé payé',    dot: 'bg-sky-400'    },
                                  { key: 'maladie' as DayType, label: 'Arrêt maladie', dot: 'bg-red-400'    },
                                  { key: 'repos'   as DayType, label: 'Repos',         dot: 'bg-gray-300'   },
                                ]).map(opt => (
                                  <button
                                    key={opt.key}
                                    onClick={() => changeType(emp.id, jour, opt.key)}
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
                        }`}>{totalH.toFixed(1)}h</span>
                        {hasOT && <span className="text-[9px] text-orange-400">+{(totalH - 35).toFixed(1)} sup</span>}
                      </div>
                    </td>

                    {/* Cost */}
                    <td className="px-2 py-3 text-center border-b border-r border-gray-200">
                      <span className={`font-bold text-sm ${cost > 0 ? 'text-green-700' : 'text-gray-300'}`}>
                        {cost > 0 ? `${cost.toFixed(0)} €` : '—'}
                      </span>
                    </td>

                    {/* Delete */}
                    <td className="px-2 py-3 text-center border-b border-gray-200">
                      <button onClick={() => deleteEmployee(emp.id)} className="p-1.5 rounded hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                )
              })
            )}

            {/* Footer totaux */}
            {employees.length > 0 && (
              <tr className="bg-gray-900">
                <td className="px-3 py-3 sticky left-0 bg-gray-900 z-10 border-r border-gray-700">
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Total / jour</span>
                </td>
                {JOURS_DB.map(jour => {
                  const dayH = employees.reduce((s, emp) => {
                    const e = getEntryState(emp.id)
                    const t = (e[`${jour}_type` as keyof PlanningEntry] as DayType) || 'travail'
                    return s + (t === 'travail' ? (e[jour] || 0) : t === 'conges' ? 7 : 0)
                  }, 0)
                  const present = employees.filter(emp => {
                    const t = (getEntryState(emp.id)[`${jour}_type` as keyof PlanningEntry] as DayType) || 'travail'
                    return t !== 'repos'
                  }).length
                  return (
                    <td key={jour} className="px-2 py-3 text-center border-r border-gray-700">
                      {dayH > 0
                        ? <div><div className="text-sm font-bold text-white">{dayH.toFixed(1)}h</div><div className="text-[10px] text-gray-500">{present} pers.</div></div>
                        : <span className="text-gray-700">—</span>}
                    </td>
                  )
                })}
                <td className="px-3 py-3 text-center border-r border-gray-700"><span className="font-bold text-white">{grandH.toFixed(1)}h</span></td>
                <td className="px-3 py-3 text-center border-r border-gray-700"><span className="font-bold text-orange-400">{grandCost.toFixed(0)} €</span></td>
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {employees.length > 0 && (
        <div className="px-6 py-2.5 bg-amber-50 border-t border-amber-100">
          <p className="text-xs text-amber-700">
            <span className="font-semibold">Droit français :</span> taux normal ≤ 35h · +25 % de 36-43h · +50 % au-delà · CP = 7h/jour
          </p>
        </div>
      )}

      {/* Modal ajout employé */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm" onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold text-gray-900 mb-1">Nouvel employé</h2>
            <p className="text-sm text-gray-500 mb-5">Renseignez le nom et le taux horaire brut.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Prénom et nom</label>
                <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Marie Dupont" autoFocus onKeyDown={e => e.key === 'Enter' && addEmployee()} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Taux horaire brut (€/h)</label>
                <Input type="number" step="0.01" min="0" value={newRate} onChange={e => setNewRate(e.target.value)} placeholder="12.50" onKeyDown={e => e.key === 'Enter' && addEmployee()} />
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
