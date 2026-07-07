'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, FileText, Download, Plus, Mail, Calendar,
  CalendarDays, ChevronLeft, ChevronRight, Receipt,
  ShoppingCart, Users, Loader2, AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

// ─── Types ──────────────────────────────────────────────────────────────────

type Client = {
  id: string; name: string; email: string; created_at: string
  client_user_id?: string | null
}

type Employee = {
  id: string; name: string; contract_type: string
  contract_hours: number; hourly_rate: number
  hs_cumules?: number; cp_initial?: number
}

type DayType = 'travail' | 'conges' | 'maladie' | 'repos'

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

type Invoice = {
  id: string; supplier_name: string; invoice_number?: string
  invoice_date: string; category: string
  amount_ht: number; tva_rate: number; amount_ttc: number
  week_number: number; year: number
}

type WeeklyCA = {
  ca_total: number; ca_boucherie?: number
  ca_charcuterie?: number; ca_traiteur?: number; ca_vente?: number
}

type Report = {
  id: string; title: string; file_url: string
  created_at: string; week_number: number; year: number
}

// ─── Constants ───────────────────────────────────────────────────────────────

const JOURS_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const JOURS_DB = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const
type JourDB = typeof JOURS_DB[number]

const CONTRACT_H: Record<string, number> = {
  CDI_35: 35, CDI_39: 39, CDD_35: 35, CDD_39: 39,
}

const TYPE_STYLE: Record<DayType, string> = {
  travail: 'bg-blue-50 text-blue-700',
  conges:  'bg-sky-100 text-sky-700',
  maladie: 'bg-red-100 text-red-700',
  repos:   'bg-gray-100 text-gray-400',
}

const TYPE_LABEL: Record<DayType, string> = {
  travail: 'Travail', conges: 'CP', maladie: 'AM', repos: '—',
}

const CAT_STYLE: Record<string, string> = {
  viande:         'bg-red-100 text-red-800',
  charcuterie:    'bg-orange-100 text-orange-800',
  epicerie:       'bg-yellow-100 text-yellow-800',
  emballage:      'bg-blue-100 text-blue-800',
  frais_generaux: 'bg-purple-100 text-purple-800',
  autre:          'bg-gray-100 text-gray-600',
}

const CAT_LABEL: Record<string, string> = {
  viande: 'Viande', charcuterie: 'Charcuterie', epicerie: 'Épicerie',
  emballage: 'Emballage', frais_generaux: 'Frais gén.', autre: 'Autre',
}

const EMP_PAL = [
  { bg: 'bg-violet-100', text: 'text-violet-900' },
  { bg: 'bg-pink-100',   text: 'text-pink-900'   },
  { bg: 'bg-sky-100',    text: 'text-sky-900'     },
  { bg: 'bg-orange-100', text: 'text-orange-900'  },
  { bg: 'bg-teal-100',   text: 'text-teal-900'    },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isoWeek(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return {
    week: Math.ceil((((d.getTime() - y.getTime()) / 86400000) + 1) / 7),
    year: d.getUTCFullYear(),
  }
}

function getWeekDates(week: number, year: number): Date[] {
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const dow = jan4.getUTCDay() || 7
  const mon = new Date(jan4)
  mon.setUTCDate(jan4.getUTCDate() - dow + 1 + (week - 1) * 7)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon)
    d.setUTCDate(mon.getUTCDate() + i)
    return d
  })
}

function fmtD(d: Date) {
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function fmtEur(n: number) {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €'
}

function initials(name: string) {
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2)
}

function calcH(entry: PlanningEntry, ch: number): number {
  const cpH = ch >= 39 ? 7.83 : 7
  return JOURS_DB.reduce((s, j) => {
    const type = (entry[`${j}_type` as keyof PlanningEntry] as DayType) || 'travail'
    if (type === 'conges') return s + cpH
    if (type !== 'travail') return s
    return s + ((entry[j as keyof PlanningEntry] as number) || 0)
  }, 0)
}

function getEntry(
  entries: PlanningEntry[], empId: string, week: number, year: number
): PlanningEntry {
  return entries.find(e => e.employee_id === empId) ?? {
    employee_id: empId, week_number: week, year,
    lundi: 0, lundi_type: 'travail',
    mardi: 0, mardi_type: 'travail',
    mercredi: 0, mercredi_type: 'travail',
    jeudi: 0, jeudi_type: 'travail',
    vendredi: 0, vendredi_type: 'travail',
    samedi: 0, samedi_type: 'repos',
    dimanche: 0, dimanche_type: 'repos',
  }
}

// ─── Week Nav ────────────────────────────────────────────────────────────────

function WeekNav({
  week, year, setWeek, setYear,
}: {
  week: number; year: number
  setWeek: (n: number) => void
  setYear: (n: number) => void
}) {
  const { week: cw, year: cy } = isoWeek(new Date())
  const dates = getWeekDates(week, year)
  const isCurrent = week === cw && year === cy
  const prev = () => { if (week === 1) { setYear(year - 1); setWeek(52) } else setWeek(week - 1) }
  const next = () => { if (week === 52) { setYear(year + 1); setWeek(1) } else setWeek(week + 1) }

  return (
    <div className="flex items-center gap-3 mb-4">
      <button onClick={prev} className="p-1.5 rounded hover:bg-gray-100 transition-colors">
        <ChevronLeft className="w-4 h-4 text-gray-500" />
      </button>
      <div className="flex items-center gap-2">
        <span className="font-semibold text-sm text-gray-900">Semaine {week}</span>
        <span className="text-xs text-gray-400">{fmtD(dates[0])} – {fmtD(dates[6])} {year}</span>
        {isCurrent && (
          <span className="text-[10px] bg-[#1E3A5F] text-white px-1.5 py-0.5 rounded font-semibold">
            Actuelle
          </span>
        )}
      </div>
      <button onClick={next} className="p-1.5 rounded hover:bg-gray-100 transition-colors">
        <ChevronRight className="w-4 h-4 text-gray-500" />
      </button>
      {!isCurrent && (
        <button
          onClick={() => { setWeek(cw); setYear(cy) }}
          className="text-xs text-[#1E3A5F] hover:underline ml-1"
        >
          ← Actuelle
        </button>
      )}
    </div>
  )
}

// ─── Tab: Rapports ────────────────────────────────────────────────────────────

function RapportsTab({ clientId, reports }: { clientId: string; reports: Report[] }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">
          {reports.length} rapport{reports.length !== 1 ? 's' : ''}
        </p>
        <Link href={`/admin/reports/nouveau?client=${clientId}`}>
          <Button size="sm" className="bg-[#1E3A5F] hover:bg-[#2a4f7c] text-white h-8 text-xs gap-1.5">
            <Plus className="w-3.5 h-3.5" />Générer un rapport
          </Button>
        </Link>
      </div>

      {reports.length === 0 ? (
        <div className="py-16 text-center">
          <FileText className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400 text-sm mb-4">Aucun rapport pour ce client</p>
          <Link href={`/admin/reports/nouveau?client=${clientId}`}>
            <Button variant="outline" size="sm">Générer le premier rapport</Button>
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-100">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase">Rapport</th>
                <th className="px-4 py-3 text-center text-[11px] font-semibold text-gray-400 uppercase">Semaine</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase">Généré le</th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold text-gray-400 uppercase">PDF</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-blue-400 flex-shrink-0" />
                      <span className="font-medium text-sm text-gray-900">{r.title}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-xs bg-[#1E3A5F]/10 text-[#1E3A5F] font-semibold px-2 py-0.5 rounded">
                      S{r.week_number} {r.year}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {new Date(r.created_at).toLocaleDateString('fr-FR', {
                      day: '2-digit', month: 'long', year: 'numeric',
                    })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <a href={r.file_url} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                        <Download className="w-3 h-3" />PDF
                      </Button>
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Tab: Planning (read-only) ────────────────────────────────────────────────

function PlanningTab({ clientId }: { clientId: string }) {
  const now = isoWeek(new Date())
  const [week, setWeek] = useState(now.week)
  const [year, setYear] = useState(now.year)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [entries, setEntries] = useState<PlanningEntry[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [empRes, planRes] = await Promise.all([
      fetch(`/api/admin/clients/${clientId}/employees`)
        .then(r => r.json()).catch(() => []),
      fetch(`/api/admin/clients/${clientId}/planning?week=${week}&year=${year}`)
        .then(r => r.json()).catch(() => []),
    ])
    setEmployees(Array.isArray(empRes) ? empRes : [])
    setEntries(Array.isArray(planRes) ? planRes : [])
    setLoading(false)
  }, [clientId, week, year])

  useEffect(() => { load() }, [load])

  const dates = getWeekDates(week, year)
  const totalH = employees.reduce((s, e) => {
    const ch = CONTRACT_H[e.contract_type] ?? e.contract_hours ?? 35
    return s + calcH(getEntry(entries, e.id, week, year), ch)
  }, 0)

  return (
    <div>
      <div className="flex items-center justify-between">
        <WeekNav week={week} year={year} setWeek={setWeek} setYear={setYear} />
        <p className="text-xs text-gray-500 mb-4">
          Total semaine : <span className="font-bold text-gray-900">{totalH.toFixed(1)}h</span>
        </p>
      </div>

      {loading ? (
        <div className="py-12 text-center">
          <Loader2 className="w-6 h-6 text-gray-300 mx-auto animate-spin" />
        </div>
      ) : employees.length === 0 ? (
        <div className="py-12 text-center">
          <Users className="w-8 h-8 text-gray-200 mx-auto mb-2" />
          <p className="text-sm text-gray-400">Aucun employé enregistré</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full border-collapse min-w-[720px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase w-36">
                  Employé
                </th>
                {dates.map((d, i) => (
                  <th
                    key={i}
                    className="px-1 py-2.5 text-center text-[11px] font-semibold text-gray-400 uppercase min-w-[78px]"
                  >
                    <div>{JOURS_SHORT[i]}</div>
                    <div className="font-bold text-gray-600">{d.getUTCDate()}</div>
                  </th>
                ))}
                <th className="px-3 py-2.5 text-center text-[11px] font-semibold text-gray-400 uppercase">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp, idx) => {
                const pal = EMP_PAL[idx % EMP_PAL.length]
                const entry = getEntry(entries, emp.id, week, year)
                const ch = CONTRACT_H[emp.contract_type] ?? emp.contract_hours ?? 35
                const total = calcH(entry, ch)
                const hasOT = total > ch

                return (
                  <tr key={emp.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2.5 border-r border-gray-100">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-7 h-7 rounded-full ${pal.bg} flex items-center justify-center flex-shrink-0`}
                        >
                          <span className={`text-[10px] font-bold ${pal.text}`}>
                            {initials(emp.name)}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-gray-900 truncate">{emp.name}</div>
                          <div className="text-[9px] text-gray-400">
                            {emp.contract_type?.replace('_', ' ')} · {ch}h
                          </div>
                        </div>
                      </div>
                    </td>
                    {(JOURS_DB as readonly JourDB[]).map((jour, ji) => {
                      const type = (
                        entry[`${jour}_type` as keyof PlanningEntry] as DayType
                      ) ?? (ji >= 5 ? 'repos' : 'travail')
                      const h = (entry[jour as keyof PlanningEntry] as number) ?? 0
                      return (
                        <td key={jour} className="px-1 py-1.5 border-r border-gray-100 text-center">
                          <div className={`rounded-lg px-1 py-1 ${TYPE_STYLE[type]}`}>
                            <div className="text-[9px] font-semibold">{TYPE_LABEL[type]}</div>
                            {type === 'travail' && h > 0 && (
                              <div className="text-[11px] font-bold leading-tight">{h}h</div>
                            )}
                          </div>
                        </td>
                      )
                    })}
                    <td className="px-3 py-2.5 text-center">
                      <div
                        className={`inline-flex flex-col items-center px-2 py-0.5 rounded ${
                          hasOT ? 'bg-orange-50' : 'bg-gray-50'
                        }`}
                      >
                        <span
                          className={`text-sm font-bold ${
                            hasOT ? 'text-orange-600' : 'text-gray-700'
                          }`}
                        >
                          {total.toFixed(1)}h
                        </span>
                        {hasOT && (
                          <span className="text-[9px] text-orange-400">
                            +{(total - ch).toFixed(1)}h sup
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-900 border-t-2 border-gray-700">
                <td className="px-4 py-2 text-[10px] font-bold uppercase text-gray-400">
                  Total / jour
                </td>
                {(JOURS_DB as readonly JourDB[]).map((jour) => {
                  const dH = employees.reduce((s, emp) => {
                    const e = getEntry(entries, emp.id, week, year)
                    const t = (e[`${jour}_type` as keyof PlanningEntry] as DayType) || 'travail'
                    const ch = CONTRACT_H[emp.contract_type] ?? emp.contract_hours ?? 35
                    if (t === 'conges') return s + (ch >= 39 ? 7.83 : 7)
                    if (t !== 'travail') return s
                    return s + ((e[jour as keyof PlanningEntry] as number) || 0)
                  }, 0)
                  return (
                    <td key={jour} className="px-1 py-2 text-center text-xs font-bold text-white">
                      {dH > 0 ? `${dH.toFixed(1)}h` : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                  )
                })}
                <td className="px-3 py-2 text-center text-sm font-bold text-white">
                  {totalH.toFixed(1)}h
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Tab: Facturation ─────────────────────────────────────────────────────────

function FacturationTab({ clientId }: { clientId: string }) {
  const now = isoWeek(new Date())
  const [week, setWeek] = useState(now.week)
  const [year, setYear] = useState(now.year)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [ca, setCA] = useState<WeeklyCA | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [invRes, caRes] = await Promise.all([
      fetch(`/api/admin/clients/${clientId}/invoices?week=${week}&year=${year}`)
        .then(r => r.json()).catch(() => []),
      fetch(`/api/admin/clients/${clientId}/weekly-ca?week=${week}&year=${year}`)
        .then(r => r.json()).catch(() => null),
    ])
    setInvoices(Array.isArray(invRes) ? invRes : [])
    setCA(caRes && typeof caRes === 'object' && !Array.isArray(caRes) ? caRes : null)
    setLoading(false)
  }, [clientId, week, year])

  useEffect(() => { load() }, [load])

  const totalHT  = invoices.reduce((s, i) => s + (i.amount_ht  || 0), 0)
  const totalTTC = invoices.reduce((s, i) => s + (i.amount_ttc || 0), 0)
  const caTotal  = ca?.ca_total ?? 0
  const marge    = caTotal > 0 ? caTotal - totalHT : 0
  const txMarge  = caTotal > 0 ? Math.round((marge / caTotal) * 100) : null

  return (
    <div>
      <WeekNav week={week} year={year} setWeek={setWeek} setYear={setYear} />

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
          <p className="text-[11px] font-semibold text-gray-400 uppercase mb-1">CA semaine</p>
          <p className="text-2xl font-bold text-gray-900">
            {caTotal > 0 ? fmtEur(caTotal) : <span className="text-gray-300">—</span>}
          </p>
          {ca && (
            <div className="mt-2 flex flex-wrap gap-1">
              {(ca.ca_boucherie ?? 0) > 0 && (
                <span className="text-[9px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded font-semibold">
                  Boucherie {fmtEur(ca.ca_boucherie!)}
                </span>
              )}
              {(ca.ca_charcuterie ?? 0) > 0 && (
                <span className="text-[9px] bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded font-semibold">
                  Charc. {fmtEur(ca.ca_charcuterie!)}
                </span>
              )}
              {(ca.ca_traiteur ?? 0) > 0 && (
                <span className="text-[9px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded font-semibold">
                  Traiteur {fmtEur(ca.ca_traiteur!)}
                </span>
              )}
              {(ca.ca_vente ?? 0) > 0 && (
                <span className="text-[9px] bg-teal-50 text-teal-600 px-1.5 py-0.5 rounded font-semibold">
                  Vente {fmtEur(ca.ca_vente!)}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
          <p className="text-[11px] font-semibold text-gray-400 uppercase mb-1">Achats HT</p>
          <p className="text-2xl font-bold text-gray-900">{fmtEur(totalHT)}</p>
          <p className="text-xs text-gray-400 mt-1">
            {invoices.length} facture{invoices.length !== 1 ? 's' : ''} · TTC {fmtEur(totalTTC)}
          </p>
        </div>

        <div
          className={`rounded-xl p-4 border ${
            caTotal > 0
              ? marge >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
              : 'bg-gray-50 border-gray-100'
          }`}
        >
          <p className="text-[11px] font-semibold text-gray-400 uppercase mb-1">Marge brute estimée</p>
          <p className="text-2xl font-bold text-gray-900">
            {caTotal > 0 ? fmtEur(marge) : <span className="text-gray-300">—</span>}
          </p>
          {txMarge !== null && (
            <p className="text-xs text-gray-500 mt-1">
              Taux :{' '}
              <span
                className={`font-bold ${
                  txMarge >= 35 ? 'text-green-600' : txMarge >= 25 ? 'text-orange-500' : 'text-red-500'
                }`}
              >
                {txMarge} %
              </span>
            </p>
          )}
        </div>
      </div>

      {/* Invoice list */}
      {loading ? (
        <div className="py-10 text-center">
          <Loader2 className="w-5 h-5 text-gray-300 mx-auto animate-spin" />
        </div>
      ) : invoices.length === 0 ? (
        <div className="py-10 text-center">
          <ShoppingCart className="w-8 h-8 text-gray-200 mx-auto mb-2" />
          <p className="text-sm text-gray-400">Aucune facture cette semaine</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-100">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase">Fournisseur</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase">Date</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase">Catégorie</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-400 uppercase">HT</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-400 uppercase">TVA</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-400 uppercase">TTC</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-sm text-gray-900">{inv.supplier_name}</div>
                    {inv.invoice_number && (
                      <div className="text-xs text-gray-400">{inv.invoice_number}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {new Date(inv.invoice_date).toLocaleDateString('fr-FR')}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                        CAT_STYLE[inv.category] ?? 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {CAT_LABEL[inv.category] ?? inv.category}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-sm text-gray-900">
                    {fmtEur(inv.amount_ht)}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-gray-400">{inv.tva_rate} %</td>
                  <td className="px-4 py-3 text-right text-sm text-gray-600">
                    {fmtEur(inv.amount_ttc)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-900">
                <td colSpan={3} className="px-4 py-2.5 text-[10px] font-bold uppercase text-gray-400">
                  Total
                </td>
                <td className="px-4 py-2.5 text-right font-bold text-white">{fmtEur(totalHT)}</td>
                <td />
                <td className="px-4 py-2.5 text-right font-bold text-orange-300">{fmtEur(totalTTC)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = 'rapports' | 'planning' | 'facturation'

export default function ClientDetailPage({ params }: { params: { id: string } }) {
  const [tab, setTab] = useState<Tab>('rapports')
  const [client, setClient] = useState<Client | null>(null)
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/admin/clients/${params.id}`)
      .then(r => r.json())
      .then(data => {
        if (data.client) {
          setClient(data.client)
          setReports(data.reports ?? [])
        } else {
          setError(data.error || 'Erreur')
        }
        setLoading(false)
      })
      .catch(() => { setError('Erreur réseau'); setLoading(false) })
  }, [params.id])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 text-gray-300 animate-spin" />
      </div>
    )
  }

  if (error || !client) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-2 text-red-500 mb-4">
          <AlertCircle className="w-5 h-5" />
          <span>{error || 'Client introuvable'}</span>
        </div>
        <Link href="/admin/clients" className="text-sm text-gray-400 hover:text-gray-600">
          ← Retour aux clients
        </Link>
      </div>
    )
  }

  const TABS: { key: Tab; label: string; icon: React.ElementType; count?: number }[] = [
    { key: 'rapports',    label: 'Rapports',    icon: FileText,    count: reports.length },
    { key: 'planning',    label: 'Planning',    icon: CalendarDays },
    { key: 'facturation', label: 'Facturation', icon: Receipt      },
  ]

  return (
    <div className="p-8 max-w-6xl">
      {/* Back */}
      <Link
        href="/admin/clients"
        className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 mb-5 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />Retour aux clients
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#1E3A5F] to-blue-500 flex items-center justify-center shadow-md flex-shrink-0">
            <span className="text-white font-bold text-xl">
              {client.name.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{client.name}</h1>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-sm text-gray-400 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" />{client.email}
              </span>
              {client.client_user_id
                ? <span className="text-[10px] bg-green-100 text-green-700 font-semibold px-1.5 py-0.5 rounded">Compte actif</span>
                : <span className="text-[10px] bg-yellow-100 text-yellow-700 font-semibold px-1.5 py-0.5 rounded">En attente</span>
              }
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-400 mt-1">
          <Calendar className="w-4 h-4" />
          Client depuis{' '}
          {new Date(client.created_at).toLocaleDateString('fr-FR', {
            day: '2-digit', month: 'long', year: 'numeric',
          })}
        </div>
      </div>

      {/* Tabbed panel */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {/* Tab bar */}
        <div className="flex border-b border-gray-100">
          {TABS.map(({ key, label, icon: Icon, count }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-6 py-3.5 text-sm font-semibold border-b-2 transition-colors ${
                tab === key
                  ? 'border-[#1E3A5F] text-[#1E3A5F] bg-blue-50/40'
                  : 'border-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
              {count !== undefined && count > 0 && (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    tab === key ? 'bg-[#1E3A5F] text-white' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-5">
          {tab === 'rapports'    && <RapportsTab clientId={params.id} reports={reports} />}
          {tab === 'planning'    && <PlanningTab clientId={params.id} />}
          {tab === 'facturation' && <FacturationTab clientId={params.id} />}
        </div>
      </div>
    </div>
  )
}
