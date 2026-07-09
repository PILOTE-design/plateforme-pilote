'use client'

import { useState } from 'react'
import { FileText, Download, ChevronRight, ChevronDown } from 'lucide-react'
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
        <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-500">Aucun rapport encore</p>
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
              className="w-full flex items-center gap-3 px-6 py-4 hover:bg-gray-50 transition-colors text-left"
            >
              {isYearOpen
                ? <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
                : <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
              }
              <span className="font-bold text-gray-900 text-base">{year}</span>
              <span className="text-xs text-gray-400 ml-auto">
                {totalReports} rapport{totalReports > 1 ? 's' : ''}
              </span>
            </button>

            {/* Mois */}
            {isYearOpen && (
              <div className="border-l-2 border-gray-100 ml-7">
                {months.map(month => {
                  const key = `${year}-${month}`
                  const isMonthOpen = openMonths.has(key)
                  const monthReports = grouped[year][month]

                  return (
                    <div key={month}>
                      <button
                        onClick={() => toggleMonth(year, month)}
                        className="w-full flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors text-left"
                      >
                        {isMonthOpen
                          ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                          : <ChevronRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                        }
                        <span className="font-semibold text-gray-700 text-sm capitalize">
                          {MONTHS_FR[month]}
                        </span>
                        <span className="text-xs text-gray-400 ml-auto">
                          {monthReports.length} rapport{monthReports.length > 1 ? 's' : ''}
                        </span>
                      </button>

                      {/* Rapports du mois */}
                      {isMonthOpen && (
                        <div className="border-l-2 border-gray-100 ml-5">
                          {monthReports.map(report => (
                            <div
                              key={report.id}
                              className="flex items-center justify-between px-6 py-3 hover:bg-gray-50 transition-colors"
                            >
                              <div className="flex items-center gap-3">
                                <FileText className="w-4 h-4 text-blue-500 flex-shrink-0" />
                                <div>
                                  <p className="text-sm font-medium text-gray-800">{report.title}</p>
                                  <p className="text-xs text-gray-400">
                                    {new Date(report.created_at).toLocaleDateString('fr-FR')}
                                  </p>
                                </div>
                              </div>
                              <a href={report.file_url} target="_blank" rel="noopener noreferrer">
                                <Button variant="outline" size="sm" className="h-7 text-xs">
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
