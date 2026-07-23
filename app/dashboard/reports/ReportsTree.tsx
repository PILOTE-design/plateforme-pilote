'use client'

import { useState } from 'react'
import { FileText, Download, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

const MONTHS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
]

type Report = { id: string; title: string; file_url: string; created_at: string }

function groupReports(reports: Report[]) {
  const grouped: Record<number, Record<number, Report[]>> = {}
  for (const r of reports) {
    const d = new Date(r.created_at)
    const year = d.getFullYear()
    const month = d.getMonth()
    if (!grouped[year]) grouped[year] = {}
    if (!grouped[year][month]) grouped[year][month] = []
    grouped[year][month].push(r)
  }
  return grouped
}

export function ReportsTree({ reports }: { reports: Report[] }) {
  const grouped = groupReports(reports)
  const years = Object.keys(grouped).map(Number).sort((a, b) => b - a)

  const defaultYear = years[0]
  const defaultMonths = defaultYear
    ? Object.keys(grouped[defaultYear]).map(Number).sort((a, b) => b - a)
    : []
  const defaultMonth = defaultMonths[0]

  const [openYears, setOpenYears] = useState<Set<number>>(
    new Set(defaultYear ? [defaultYear] : [])
  )
  const [openMonths, setOpenMonths] = useState<Set<string>>(
    new Set(defaultMonth !== undefined ? [`${defaultYear}-${defaultMonth}`] : [])
  )

  function toggleYear(year: number) {
    setOpenYears(prev => {
      const next = new Set(prev)
      next.has(year) ? next.delete(year) : next.add(year)
      return next
    })
  }

  function toggleMonth(year: number, month: number) {
    const key = `${year}-${month}`
    setOpenMonths(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  if (reports.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-3">
          <FileText className="w-6 h-6 text-gray-300" />
        </div>
        <p className="text-sm font-medium text-gray-500">Aucun rapport pour l&apos;instant</p>
        <p className="text-xs text-gray-400 mt-1">Votre premier rapport hebdomadaire apparaîtra ici.</p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-gray-100">
      {years.map(year => {
        const isYearOpen = openYears.has(year)
        const months = Object.keys(grouped[year]).map(Number).sort((a, b) => b - a)
        const totalReports = months.reduce((s, m) => s + grouped[year][m].length, 0)

        return (
          <div key={year}>
            {/* Année */}
            <button
              onClick={() => toggleYear(year)}
              className="w-full flex items-center gap-3 px-6 py-4 hover:bg-gray-50 transition-colors text-left group"
            >
              <ChevronRight className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform duration-300 ${isYearOpen ? 'rotate-90' : ''}`} />
              <span className="font-extrabold text-pilote-800 text-lg tracking-tight tabular">{year}</span>
              <span className="ml-auto text-[11px] font-semibold text-gray-500 bg-gray-50 rounded-full px-2.5 py-0.5 tabular">
                {totalReports} rapport{totalReports > 1 ? 's' : ''}
              </span>
            </button>

            {/* Mois */}
            {isYearOpen && (
              <div className="ml-[30px] border-l border-gray-100 pl-2">
                {months.map(month => {
                  const key = `${year}-${month}`
                  const isMonthOpen = openMonths.has(key)
                  const monthReports = grouped[year][month]

                  return (
                    <div key={month}>
                      <button
                        onClick={() => toggleMonth(year, month)}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 rounded-lg hover:bg-gray-50 transition-colors text-left"
                      >
                        <ChevronRight className={`w-3.5 h-3.5 text-gray-400 flex-shrink-0 transition-transform duration-300 ${isMonthOpen ? 'rotate-90' : ''}`} />
                        <span className="font-semibold text-gray-700 text-sm capitalize">
                          {MONTHS_FR[month]}
                        </span>
                        <span className="ml-auto text-[11px] text-gray-400 tabular">
                          {monthReports.length}
                        </span>
                      </button>

                      {/* Rapports du mois */}
                      {isMonthOpen && (
                        <div className="ml-[26px] border-l border-gray-100 pl-2 pb-1 space-y-1">
                          {monthReports.map(report => (
                            <div
                              key={report.id}
                              className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-transparent hover:border-gray-100 hover:bg-gray-50 hover:shadow-card transition-all group"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="w-9 h-9 rounded-lg bg-pilote-50 flex items-center justify-center flex-shrink-0">
                                  <FileText className="w-4 h-4 text-pilote" />
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold text-gray-900 truncate">{report.title}</p>
                                  <p className="text-xs text-gray-400 tabular">
                                    {new Date(report.created_at).toLocaleDateString('fr-FR')}
                                  </p>
                                </div>
                              </div>
                              <a href={report.file_url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                                <Button variant="outline" size="sm" className="h-8 text-xs rounded-lg border-gray-200 text-pilote hover:border-pilote hover:bg-pilote-50 transition-colors">
                                  <Download className="w-3.5 h-3.5 mr-1.5" />Télécharger
                                </Button>
                              </a>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
