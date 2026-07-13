import type { LucideIcon } from 'lucide-react'

export interface KpiCardProps {
  icon: LucideIcon
  label: string
  value: string
  sub?: string
  /** Classes du chip icône, ex. 'bg-pilote-50 text-pilote' */
  color?: string
  /** Passe la valeur en rouge (alerte) */
  warn?: boolean
}

/** Carte KPI unifiée PILOTE — micro-label, chip icône, valeur tabulaire. */
export function KpiCard({ icon: Icon, label, value, sub, color = 'bg-pilote-50 text-pilote', warn }: KpiCardProps) {
  return (
    <div className={`bg-white rounded-xl border p-4 flex flex-col gap-1 ${warn ? 'border-red-200' : 'border-gray-200/80'} shadow-card`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}><Icon className="w-4 h-4" /></div>
      </div>
      <p className={`text-2xl font-bold tracking-tight mt-1 ${warn ? 'text-red-600' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  )
}
