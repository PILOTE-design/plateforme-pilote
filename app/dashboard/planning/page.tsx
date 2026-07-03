'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Plus, ChevronLeft, ChevronRight, Trash2, Save, CalendarDays, Users, Euro } from 'lucide-react'

const JOURS_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const JOURS_DB = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const
type JourDB = typeof JOURS_DB[number]

type Employee = {
  id: string
  name: string
  hourly_rate: number
  client_id: string
  created_at: string
}

type PlanningEntry = {
  id?: string
  employee_id: string
  week_number: number
  year: number
  lundi: number
  mardi: number
  mercredi: number
  jeudi: number
  vendredi: number
  samedi: number
  dimanche: number
}

type EntriesMap = Record<string, PlanningEntry>

function getISOWeek(date: Date): { week: number; year: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return { week, year: d.getUTCFullYear() }
}

function getWeekLabel(week: number, year: number): string {
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const dayOfWeek = jan4.getUTCDay() || 7
  const monday = new Date(jan4)
  monday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1 + (week - 1) * 7)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  const fmt = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `${fmt(monday)} – ${fmt(sunday)}`
}

function calcCost(totalHours: number, rate: number): number {
  if (totalHours <= 35) return totalHours * rate
  if (totalHours <= 43) return 35 * rate + (totalHours - 35) * rate * 1.25
  return 35 * rate + 8 * rate * 1.25 + (totalHours - 43) * rate * 1.5
}

function emptyEntry(empId: string, week: number, year: number): PlanningEntry {
  return { employee_id: empId, week_number: week, year, lundi: 0, mardi: 0, mercredi: 0, jeudi: 0, vendredi: 0, samedi: 0, dimanche: 0 }
}

export default function PlanningPage() {
  const now = getISOWeek(new Date())
  const [week, setWeek] = useState(now.week)
  const [year, setYear] = useState(now.year)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [entries, setEntries] = useState<EntriesMap>({})
  const [savedRows, setSavedRows] = useState<Set<string>>(new Set())
  const [loadingEmployees, setLoadingEmployees] = useState(true)
  const [loadingEntries, setLoadingEntries] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newRate, setNewRate] = useState('')
  const [adding, setAdding] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)

  useEffect(() => {
    setLoadingEmployees(true)
    fetch('/api/employees')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setEmployees(data)
        else setPageError('Impossible de charger les employés')
        setLoadingEmployees(false)
      })
      .catch(() => { setPageError('Erreur réseau'); setLoadingEmployees(false) })
  }, [])

  const loadEntries = useCallback(() => {
    setLoadingEntries(true)
    fetch(`/api/planning?week=${week}&year=${year}`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          const map: EntriesMap = {}
          for (const e of data) map[e.employee_id] = e
          setEntries(map)
        }
        setSavedRows(new Set())
        setLoadingEntries(false)
      })
      .catch(() => setLoadingEntries(false))
  }, [week, year])

  useEffect(() => { loadEntries() }, [loadEntries])

  function getEntry(empId: string): PlanningEntry {
    return entries[empId] ?? emptyEntry(empId, week, year)
  }

  function updateHours(empId: string, jour: JourDB, value: string) {
    const hours = value === '' ? 0 : Math.max(0, Math.min(24, parseFloat(value) || 0))
    setSavedRows(prev => { const n = new Set(prev); n.delete(empId); return n })
    setEntries(prev => ({
      ...prev,
      [empId]: { ...getEntry(empId), [jour]: hours }
    }))
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
    if (data.id) {
      setEmployees(prev => [...prev, data])
      setNewName('')
      setNewRate('')
      setShowAdd(false)
    }
    setAdding(false)
  }

  async function deleteEmployee(id: string) {
    if (!confirm('Supprimer cet employé et tout son historique de planning ?')) return
    await fetch(`/api/employees/${id}`, { method: 'DELETE' })
    setEmployees(prev => prev.filter(e => e.id !== id))
    setEntries(prev => { const n = { ...prev }; delete n[id]; return n })
  }

  function prevWeek() {
    if (week === 1) { setYear(y => y - 1); setWeek(52) }
    else setWeek(w => w - 1)
  }

  function nextWeek() {
    if (week === 52) { setYear(y => y + 1); setWeek(1) }
    else setWeek(w => w + 1)
  }

  const rowStats = employees.map(emp => {
    const e = getEntry(emp.id)
    const totalH = JOURS_DB.reduce((s, j) => s + (e[j] || 0), 0)
    const cost = calcCost(totalH, Number(emp.hourly_rate))
    return { empId: emp.id, totalH, cost }
  })
  const totalH = rowStats.reduce((s, r) => s + r.totalH, 0)
  const totalCost = rowStats.reduce((s, r) => s + r.cost, 0)
  const { week: cw, year: cy } = getISOWeek(new Date())
  const isCurrentWeek = week === cw && year === cy

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-8 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-[#1E3A5F]" />
              Gestion de planning
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">Planifiez les horaires et calculez vos coûts main d’œuvre</p>
          </div>
          <Button
            onClick={() => setShowAdd(true)}
            className="bg-[#1E3A5F] hover:bg-[#2a4f7c] text-white"
          >
            <Plus className="w-4 h-4 mr-2" />
            Ajouter un employé
          </Button>
        </div>
      </div>

      <div className="px-8 py-6">
        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <Card className="border-0 shadow-sm">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center">
                  <Users className="w-4 h-4 text-[#1E3A5F]" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Employés</p>
                  <p className="text-xl font-bold text-gray-900">{employees.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-orange-50 rounded-lg flex items-center justify-center">
                  <CalendarDays className="w-4 h-4 text-orange-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Heures semaine {week}</p>
                  <p className="text-xl font-bold text-gray-900">{totalH.toFixed(1)}h</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-green-50 rounded-lg flex items-center justify-center">
                  <Euro className="w-4 h-4 text-green-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Coût main d’œuvre</p>
                  <p className="text-xl font-bold text-green-700">{totalCost.toFixed(2)} €</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Week navigation */}
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={prevWeek}
            className="p-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
          >
            <ChevronLeft className="w-4 h-4 text-gray-600" />
          </button>
          <div className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg">
            <span className="font-semibold text-gray-900 text-sm">Semaine {week}</span>
            {isCurrentWeek && (
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">Actuelle</span>
            )}
            <span className="text-gray-400 text-sm">·</span>
            <span className="text-gray-500 text-sm">{getWeekLabel(week, year)}</span>
          </div>
          <button
            onClick={nextWeek}
            className="p-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
          >
            <ChevronRight className="w-4 h-4 text-gray-600" />
          </button>
          {!isCurrentWeek && (
            <button
              onClick={() => { setWeek(cw); setYear(cy) }}
              className="text-sm text-[#1E3A5F] hover:underline font-medium ml-1"
            >
              ← Semaine actuelle
            </button>
          )}
        </div>

        {/* Grid */}
        {loadingEmployees ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400 text-sm">
            Chargement...
          </div>
        ) : employees.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-16 text-center">
            <CalendarDays className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium mb-1">Aucun employé</p>
            <p className="text-gray-400 text-sm mb-5">Commencez par ajouter vos employés pour créer votre planning.</p>
            <Button onClick={() => setShowAdd(true)} className="bg-[#1E3A5F] hover:bg-[#2a4f7c] text-white">
              <Plus className="w-4 h-4 mr-2" />
              Ajouter un employé
            </Button>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-[#1E3A5F] text-white">
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider w-44">Employé</th>
                    {JOURS_SHORT.map((j, i) => (
                      <th key={j} className={`px-2 py-3 text-center text-xs font-semibold uppercase tracking-wider ${i >= 5 ? 'text-blue-200' : ''}`}>
                        {j}
                      </th>
                    ))}
                    <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider">Total</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider">Coût brut</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider w-20">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp, i) => {
                    const entry = getEntry(emp.id)
                    const { totalH: empH, cost } = rowStats.find(r => r.empId === emp.id) || { totalH: 0, cost: 0 }
                    const hasOvertime = empH > 35
                    const isSaved = savedRows.has(emp.id)
                    return (
                      <tr key={emp.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                        <td className="px-4 py-3 border-b border-gray-100">
                          <div>
                            <p className="font-medium text-gray-900 text-sm">{emp.name}</p>
                            <p className="text-xs text-gray-400">{Number(emp.hourly_rate).toFixed(2)} €/h</p>
                          </div>
                        </td>
                        {JOURS_DB.map((jour, idx) => (
                          <td key={jour} className="px-2 py-3 border-b border-gray-100 text-center">
                            <input
                              type="number"
                              min="0"
                              max="24"
                              step="0.5"
                              value={entry[jour] || ''}
                              onChange={e => updateHours(emp.id, jour, e.target.value)}
                              onBlur={() => saveEntry(emp.id)}
                              className={`w-14 text-center border rounded py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E3A5F] focus:border-transparent transition-colors ${
                                idx >= 5 ? 'bg-blue-50 border-blue-200' : 'border-gray-200 bg-white'
                              }`}
                              placeholder="—"
                            />
                          </td>
                        ))}
                        <td className="px-3 py-3 border-b border-gray-100 text-center">
                          <span className={`font-bold text-sm ${hasOvertime ? 'text-orange-600' : 'text-gray-800'}`}>
                            {empH.toFixed(1)}h
                          </span>
                          {hasOvertime && (
                            <p className="text-xs text-orange-400 mt-0.5">+{(empH - 35).toFixed(1)}h sup</p>
                          )}
                        </td>
                        <td className="px-3 py-3 border-b border-gray-100 text-center">
                          <span className="font-semibold text-sm text-green-700">{cost.toFixed(2)} €</span>
                        </td>
                        <td className="px-3 py-3 border-b border-gray-100 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {isSaved ? (
                              <span className="text-xs text-green-600 font-bold">✓</span>
                            ) : (
                              <button
                                onClick={() => saveEntry(emp.id)}
                                className="p-1.5 rounded hover:bg-blue-50 text-gray-400 hover:text-[#1E3A5F] transition-colors"
                                title="Sauvegarder"
                              >
                                <Save className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              onClick={() => deleteEmployee(emp.id)}
                              className="p-1.5 rounded hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors"
                              title="Supprimer l'employé"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {/* Totals row */}
                  <tr className="bg-gray-900 text-white">
                    <td className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-gray-400">
                      Total semaine
                    </td>
                    {JOURS_DB.map(jour => {
                      const dayTotal = employees.reduce((s, emp) => s + (getEntry(emp.id)[jour] || 0), 0)
                      return (
                        <td key={jour} className="px-2 py-3 text-center text-sm font-medium text-gray-300">
                          {dayTotal > 0 ? `${dayTotal.toFixed(1)}h` : <span className="text-gray-600">—</span>}
                        </td>
                      )
                    })}
                    <td className="px-3 py-3 text-center font-bold text-white">{totalH.toFixed(1)}h</td>
                    <td className="px-3 py-3 text-center font-bold text-orange-400">{totalCost.toFixed(2)} €</td>
                    <td className="px-3 py-3"></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2.5 bg-amber-50 border-t border-amber-100">
              <p className="text-xs text-amber-700">
                <span className="font-medium">Calcul droit français :</span> taux normal jusqu’à 35h · +25 % de 36h à 43h · +50 % au-delà de 43h
              </p>
            </div>
          </div>
        )}

        {pageError && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{pageError}</div>
        )}
      </div>

      {/* Add employee modal */}
      {showAdd && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm"
          onClick={() => setShowAdd(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-gray-900 mb-1">Nouvel employé</h2>
            <p className="text-sm text-gray-500 mb-5">Le taux horaire brut sera utilisé pour calculer le coût main d’œuvre.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Prénom et nom</label>
                <Input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Marie Dupont"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && addEmployee()}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Taux horaire brut (€/h)</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={newRate}
                  onChange={e => setNewRate(e.target.value)}
                  placeholder="12.50"
                  onKeyDown={e => e.key === 'Enter' && addEmployee()}
                />
              </div>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setShowAdd(false)}>
                  Annuler
                </Button>
                <Button
                  className="flex-1 bg-[#1E3A5F] hover:bg-[#2a4f7c] text-white"
                  onClick={addEmployee}
                  disabled={!newName.trim() || !newRate || adding}
                >
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
