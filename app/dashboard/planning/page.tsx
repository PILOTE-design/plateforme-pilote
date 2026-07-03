'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, ChevronLeft, ChevronRight, Trash2, CalendarDays } from 'lucide-react'

const JOURS_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const JOURS_DB = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const
type JourDB = typeof JOURS_DB[number]

// Palette de couleurs pour les lignes employés (style agenda pro)
const ROW_COLORS = [
  { bg: 'bg-violet-50', border: 'border-l-4 border-l-violet-400', badge: 'bg-violet-400', text: 'text-violet-700' },
  { bg: 'bg-pink-50',   border: 'border-l-4 border-l-pink-400',   badge: 'bg-pink-400',   text: 'text-pink-700'   },
  { bg: 'bg-sky-50',    border: 'border-l-4 border-l-sky-400',    badge: 'bg-sky-400',    text: 'text-sky-700'    },
  { bg: 'bg-orange-50', border: 'border-l-4 border-l-orange-400', badge: 'bg-orange-400', text: 'text-orange-700' },
  { bg: 'bg-teal-50',   border: 'border-l-4 border-l-teal-500',   badge: 'bg-teal-500',   text: 'text-teal-700'   },
  { bg: 'bg-rose-50',   border: 'border-l-4 border-l-rose-400',   badge: 'bg-rose-400',   text: 'text-rose-700'   },
  { bg: 'bg-amber-50',  border: 'border-l-4 border-l-amber-400',  badge: 'bg-amber-400',  text: 'text-amber-700'  },
  { bg: 'bg-indigo-50', border: 'border-l-4 border-l-indigo-400', badge: 'bg-indigo-400', text: 'text-indigo-700' },
]

type Employee = { id: string; name: string; hourly_rate: number; client_id: string; created_at: string }
type PlanningEntry = { id?: string; employee_id: string; week_number: number; year: number; lundi: number; mardi: number; mercredi: number; jeudi: number; vendredi: number; samedi: number; dimanche: number }
type EntriesMap = Record<string, PlanningEntry>

function getISOWeek(date: Date): { week: number; year: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return { week: Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7), year: d.getUTCFullYear() }
}

function getWeekDates(week: number, year: number): Date[] {
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const dayOfWeek = jan4.getUTCDay() || 7
  const monday = new Date(jan4)
  monday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1 + (week - 1) * 7)
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setUTCDate(monday.getUTCDate() + i); return d })
}

function calcCost(totalHours: number, rate: number): number {
  if (totalHours <= 35) return totalHours * rate
  if (totalHours <= 43) return 35 * rate + (totalHours - 35) * rate * 1.25
  return 35 * rate + 8 * rate * 1.25 + (totalHours - 43) * rate * 1.5
}

function emptyEntry(empId: string, week: number, year: number): PlanningEntry {
  return { employee_id: empId, week_number: week, year, lundi: 0, mardi: 0, mercredi: 0, jeudi: 0, vendredi: 0, samedi: 0, dimanche: 0 }
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
  const [savedRows, setSavedRows] = useState<Set<string>>(new Set())
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

  useEffect(() => {
    setLoadingEmployees(true)
    fetch('/api/employees')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) { setEmployees(data); setPageError(null) }
        else setPageError(data?.error || 'Impossible de charger les employés')
        setLoadingEmployees(false)
      })
      .catch(() => { setPageError('Erreur réseau'); setLoadingEmployees(false) })
  }, [])

  const loadEntries = useCallback(() => {
    fetch(`/api/planning?week=${week}&year=${year}`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          const map: EntriesMap = {}
          for (const e of data) map[e.employee_id] = e
          setEntries(map)
        }
        setSavedRows(new Set())
      })
  }, [week, year])

  useEffect(() => { loadEntries() }, [loadEntries])

  function getEntry(empId: string): PlanningEntry {
    return entries[empId] ?? emptyEntry(empId, week, year)
  }

  function updateHours(empId: string, jour: JourDB, value: string) {
    const hours = value === '' ? 0 : Math.max(0, Math.min(24, parseFloat(value) || 0))
    setSavedRows(prev => { const n = new Set(prev); n.delete(empId); return n })
    setEntries(prev => ({ ...prev, [empId]: { ...getEntry(empId), [jour]: hours } }))
  }

  async function saveEntry(empId: string) {
    const entry = getEntry(empId)
    const res = await fetch('/api/planning', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...entry, employee_id: empId, week_number: week, year })
    })
    if (res.ok) {
      setSavedRows(prev => new Set([...prev, empId]))
      setTimeout(() => setSavedRows(prev => { const n = new Set(prev); n.delete(empId); return n }), 2000)
    }
  }

  async function addEmployee() {
    if (!newName.trim() || !newRate) return
    setAdding(true)
    const res = await fetch('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), hourly_rate: parseFloat(newRate) })
    })
    const data = await res.json()
    if (data.id) { setEmployees(prev => [...prev, data]); setNewName(''); setNewRate(''); setShowAdd(false) }
    setAdding(false)
  }

  async function deleteEmployee(id: string) {
    if (!confirm('Supprimer cet employé et tout son historique de planning ?')) return
    await fetch(`/api/employees/${id}`, { method: 'DELETE' })
    setEmployees(prev => prev.filter(e => e.id !== id))
    setEntries(prev => { const n = { ...prev }; delete n[id]; return n })
  }

  function prevWeek() {
    if (week === 1) { setYear(y => y - 1); setWeek(52) } else setWeek(w => w - 1)
  }
  function nextWeek() {
    if (week === 52) { setYear(y => y + 1); setWeek(1) } else setWeek(w => w + 1)
  }

  const rowStats = employees.map(emp => {
    const e = getEntry(emp.id)
    const totalH = JOURS_DB.reduce((s, j) => s + (e[j] || 0), 0)
    const cost = calcCost(totalH, Number(emp.hourly_rate))
    return { empId: emp.id, totalH, cost }
  })
  const grandTotalH = rowStats.reduce((s, r) => s + r.totalH, 0)
  const grandTotalCost = rowStats.reduce((s, r) => s + r.cost, 0)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CalendarDays className="w-5 h-5 text-[#1E3A5F]" />
          <h1 className="text-lg font-bold text-gray-900">Planning des équipes</h1>
        </div>
        <Button onClick={() => setShowAdd(true)} className="bg-[#1E3A5F] hover:bg-[#2a4f7c] text-white h-8 text-sm px-3">
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Ajouter un employé
        </Button>
      </div>

      {/* Week nav bar */}
      <div className="bg-white border-b border-gray-100 px-6 py-2.5 flex items-center gap-3">
        <button onClick={prevWeek} className="p-1.5 rounded hover:bg-gray-100 transition-colors">
          <ChevronLeft className="w-4 h-4 text-gray-500" />
        </button>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-900 text-sm">Semaine {week}</span>
          {isCurrentWeek && <span className="text-[10px] bg-[#1E3A5F] text-white px-1.5 py-0.5 rounded font-medium">Actuelle</span>}
        </div>
        <button onClick={nextWeek} className="p-1.5 rounded hover:bg-gray-100 transition-colors">
          <ChevronRight className="w-4 h-4 text-gray-500" />
        </button>
        {!isCurrentWeek && (
          <button onClick={() => { setWeek(cw); setYear(cy) }} className="text-xs text-[#1E3A5F] hover:underline">
            ← Semaine actuelle
          </button>
        )}
        <div className="ml-auto flex items-center gap-4 text-xs text-gray-400">
          <span><span className="font-semibold text-gray-700">{grandTotalH.toFixed(1)}h</span> total semaine</span>
          <span><span className="font-semibold text-green-700">{grandTotalCost.toFixed(2)} €</span> main d’œuvre</span>
        </div>
      </div>

      {pageError && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{pageError}</div>
      )}

      {/* Planning grid */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px]">
          {/* Column headers: days */}
          <thead>
            <tr className="bg-white border-b border-gray-200">
              <th className="w-48 px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider sticky left-0 bg-white z-10">
                Employés
              </th>
              {weekDates.map((date, i) => {
                const isToday = date.getUTCFullYear() === today.getFullYear() &&
                  date.getUTCMonth() === today.getMonth() &&
                  date.getUTCDate() === today.getDate()
                const isWeekend = i >= 5
                return (
                  <th key={i} className={`px-2 py-3 text-center min-w-[90px] ${
                    isToday ? 'bg-[#1E3A5F]' : isWeekend ? 'bg-gray-50' : 'bg-white'
                  }`}>
                    <div className={`text-xs font-semibold uppercase tracking-wider ${
                      isToday ? 'text-white' : isWeekend ? 'text-gray-400' : 'text-gray-500'
                    }`}>{JOURS_SHORT[i]}</div>
                    <div className={`text-sm font-bold mt-0.5 ${
                      isToday ? 'text-white' : isWeekend ? 'text-gray-400' : 'text-gray-800'
                    }`}>{date.getUTCDate()}</div>
                    <div className={`text-[10px] ${
                      isToday ? 'text-blue-200' : 'text-gray-400'
                    }`}>{date.toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' })}</div>
                  </th>
                )
              })}
              <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider min-w-[80px]">Total</th>
              <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider min-w-[90px]">Coût</th>
              <th className="w-10 bg-white"></th>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-100">
            {loadingEmployees ? (
              <tr>
                <td colSpan={11} className="px-6 py-12 text-center text-sm text-gray-400">Chargement...</td>
              </tr>
            ) : employees.length === 0 && !pageError ? (
              <tr>
                <td colSpan={11} className="px-6 py-16 text-center">
                  <CalendarDays className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-400 mb-3">Aucun employé. Ajoutez votre équipe pour commencer.</p>
                  <Button onClick={() => setShowAdd(true)} variant="outline" className="text-sm h-8 px-3">
                    <Plus className="w-3.5 h-3.5 mr-1.5" /> Ajouter un employé
                  </Button>
                </td>
              </tr>
            ) : (
              employees.map((emp, i) => {
                const color = ROW_COLORS[i % ROW_COLORS.length]
                const entry = getEntry(emp.id)
                const { totalH, cost } = rowStats.find(r => r.empId === emp.id) || { totalH: 0, cost: 0 }
                const hasOvertime = totalH > 35
                const isSaved = savedRows.has(emp.id)

                // Day totals
                const dayTotals = JOURS_DB.map(j => employees.reduce((s, e2) => s + (getEntry(e2.id)[j] || 0), 0))

                return (
                  <tr key={emp.id} className={`${color.bg} hover:brightness-[0.98] transition-all`}>
                    {/* Employee cell */}
                    <td className={`px-3 py-3 sticky left-0 z-10 ${color.bg} ${color.border}`}>
                      <div className="flex items-center gap-2">
                        <div className={`w-7 h-7 rounded-full ${color.badge} flex items-center justify-center flex-shrink-0`}>
                          <span className="text-white text-[10px] font-bold">{initials(emp.name)}</span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{emp.name}</p>
                          <p className="text-[10px] text-gray-400">{Number(emp.hourly_rate).toFixed(2)} €/h</p>
                        </div>
                      </div>
                    </td>

                    {/* Hour inputs */}
                    {JOURS_DB.map((jour, idx) => {
                      const val = entry[jour] || 0
                      const isWeekend = idx >= 5
                      return (
                        <td key={jour} className={`px-2 py-3 text-center ${isWeekend ? 'opacity-70' : ''}`}>
                          <div className="relative inline-block">
                            <input
                              type="number"
                              min="0"
                              max="24"
                              step="0.5"
                              value={val > 0 ? val : ''}
                              onChange={e => updateHours(emp.id, jour, e.target.value)}
                              onBlur={() => saveEntry(emp.id)}
                              className={`w-14 text-center border rounded-lg py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#1E3A5F] focus:border-transparent transition-all bg-white/80 ${
                                val > 0 ? `${color.text} border-transparent shadow-sm` : 'border-gray-200 text-gray-300'
                              }`}
                              placeholder="—"
                            />
                            {val > 0 && (
                              <span className="absolute -top-1.5 -right-1.5 text-[9px] font-bold bg-white text-gray-400 rounded px-0.5 leading-tight border border-gray-100">
                                h
                              </span>
                            )}
                          </div>
                        </td>
                      )
                    })}

                    {/* Total hours */}
                    <td className="px-3 py-3 text-center">
                      <div className={`inline-flex flex-col items-center px-2.5 py-1 rounded-lg ${
                        hasOvertime ? 'bg-orange-100' : totalH > 0 ? 'bg-white shadow-sm' : ''
                      }`}>
                        <span className={`font-bold text-sm ${
                          hasOvertime ? 'text-orange-600' : totalH > 0 ? 'text-gray-800' : 'text-gray-300'
                        }`}>{totalH.toFixed(1)}h</span>
                        {hasOvertime && (
                          <span className="text-[9px] text-orange-400 font-medium">+{(totalH-35).toFixed(1)} sup</span>
                        )}
                      </div>
                    </td>

                    {/* Cost */}
                    <td className="px-3 py-3 text-center">
                      <span className={`font-bold text-sm ${
                        cost > 0 ? 'text-green-700' : 'text-gray-300'
                      }`}>
                        {cost > 0 ? `${cost.toFixed(0)} €` : '—'}
                      </span>
                      {isSaved && <span className="block text-[9px] text-green-500">✓ enregistré</span>}
                    </td>

                    {/* Delete */}
                    <td className="px-2 py-3 text-center">
                      <button
                        onClick={() => deleteEmployee(emp.id)}
                        className="p-1.5 rounded hover:bg-red-50 text-gray-200 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                )
              })
            )}

            {/* Footer: daily totals */}
            {employees.length > 0 && (
              <tr className="bg-gray-900 text-white">
                <td className="px-3 py-3 sticky left-0 bg-gray-900 z-10">
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Total jour</span>
                </td>
                {JOURS_DB.map(jour => {
                  const dayTotal = employees.reduce((s, emp) => s + (getEntry(emp.id)[jour] || 0), 0)
                  return (
                    <td key={jour} className="px-2 py-3 text-center">
                      {dayTotal > 0 ? (
                        <div>
                          <div className="text-sm font-bold text-white">{dayTotal.toFixed(1)}h</div>
                          <div className="text-[10px] text-gray-500">{employees.filter(e => (getEntry(e.id)[jour] || 0) > 0).length} pers.</div>
                        </div>
                      ) : <span className="text-gray-700">—</span>}
                    </td>
                  )
                })}
                <td className="px-3 py-3 text-center">
                  <span className="font-bold text-white">{grandTotalH.toFixed(1)}h</span>
                </td>
                <td className="px-3 py-3 text-center">
                  <span className="font-bold text-orange-400">{grandTotalCost.toFixed(0)} €</span>
                </td>
                <td></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Overtime legend */}
      {employees.length > 0 && (
        <div className="px-6 py-2.5 bg-amber-50 border-t border-amber-100">
          <p className="text-xs text-amber-700">
            <span className="font-semibold">Droit français :</span> taux normal jusqu’à 35h · +25 % de 36-43h · +50 % au-delà de 43h
          </p>
        </div>
      )}

      {/* Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm" onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold text-gray-900 mb-1">Nouvel employé</h2>
            <p className="text-sm text-gray-500 mb-5">Renseignez le nom et le taux horaire brut pour le calcul des coûts.</p>
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
