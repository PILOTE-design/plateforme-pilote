'use client'

// ─── LES DEUX FACES DU MÊME MODULE ──────────────────────────────────────────
//
// Le planning et la préparation des payes travaillent sur la même matière : les
// heures de la semaine. Les séparer dans la navigation générale laissait croire
// à deux sujets distincts, alors que l'un est la mise au propre de l'autre —
// et c'est bien depuis le planning qu'on corrige ce que la paie révèle.
//
// D'où ce sélecteur, posé en tête des deux écrans, et une seule entrée de menu.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarDays, FileSpreadsheet } from 'lucide-react'

const ONGLETS = [
  { href: '/dashboard/planning',      icon: CalendarDays,    label: 'Planning' },
  { href: '/dashboard/planning/paie', icon: FileSpreadsheet, label: 'Préparation des payes' },
]

export default function OngletsPlanning() {
  const pathname = usePathname()
  // La paie est un sous-chemin du planning : c'est le libellé LE PLUS LONG qui
  // gagne, sinon « Planning » serait actif sur les deux écrans.
  const actif = ONGLETS
    .filter(o => pathname === o.href || pathname.startsWith(o.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href

  return (
    <div className="inline-flex items-center gap-1 bg-gray-100 rounded-xl p-1">
      {ONGLETS.map(o => {
        const on = o.href === actif
        return (
          <Link
            key={o.href}
            href={o.href}
            aria-current={on ? 'page' : undefined}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
              on ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <o.icon className="w-3.5 h-3.5" />
            {o.label}
          </Link>
        )
      })}
    </div>
  )
}
