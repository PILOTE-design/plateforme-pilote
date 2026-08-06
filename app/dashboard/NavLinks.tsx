'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart3, FileText, Settings, CalendarDays, Receipt, Scale, LineChart, Percent, ShoppingBasket, ChefHat, Factory, Wallet, Tags } from 'lucide-react'

const NAV = [
  { href: '/dashboard',              icon: BarChart3,    label: 'Tableau de bord', short: 'Accueil' },
  { href: '/dashboard/reports',      icon: FileText,     label: 'Mes rapports',    short: 'Rapports' },
  { href: '/dashboard/tendances',    icon: LineChart,    label: 'Tendances',       short: 'Tendances' },
  { href: '/dashboard/marges',       icon: Percent,      label: 'Marges',          short: 'Marges' },
  { href: '/dashboard/planning',     icon: CalendarDays, label: 'Planning',        short: 'Planning' },
  { href: '/dashboard/facturation',  icon: Receipt,      label: 'Facturation',     short: 'Factures' },
  { href: '/dashboard/tresorerie',   icon: Wallet,       label: 'Trésorerie',      short: 'Tréso' },
  { href: '/dashboard/mercuriale',   icon: ShoppingBasket, label: 'Mercuriale',     short: 'Prix' },
  { href: '/dashboard/recettes',     icon: ChefHat,      label: 'Fiches recettes', short: 'Recettes' },
  { href: '/dashboard/production',   icon: Factory,      label: 'Production',      short: 'Prod' },
  { href: '/dashboard/listing-prix', icon: Tags,         label: 'Listing des prix', short: 'Listing' },
  { href: '/dashboard/valorisation', icon: Scale,        label: 'Valorisation',    short: 'Valo' },
  { href: '/dashboard/settings',     icon: Settings,     label: 'Paramètres',      short: 'Réglages' },
]

function isActive(pathname: string, href: string) {
  return href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href)
}

/** Navigation latérale — desktop */
export function SidebarNav() {
  const pathname = usePathname()
  return (
    <nav className="flex-1 px-3 py-4 space-y-0.5">
      {NAV.map(item => {
        const active = isActive(pathname, item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`group flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              active
                ? 'bg-pilote-50 text-pilote font-semibold'
                : 'text-gray-600 font-medium hover:bg-gray-50 hover:text-gray-900'
            }`}
          >
            <item.icon
              className={`w-4 h-4 transition-colors ${active ? 'text-pilote' : 'text-gray-400 group-hover:text-gray-600'}`}
              strokeWidth={2}
            />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

/** Barre d'onglets — mobile */
export function MobileTabBar() {
  const pathname = usePathname()
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-white/95 backdrop-blur border-t border-gray-200 grid grid-cols-6 pb-[env(safe-area-inset-bottom)]">
      {/* Six onglets exactement (grid-cols-6 ci-dessus) : tout ajout au NAV
          doit être exclu ici, sinon la grille se casse en mobile. */}
      {/* La trésorerie a pris la place de la valorisation : elle se consulte
          tous les jours, une découpe de carcasse se saisit une fois de temps en
          temps, et la grille ne tient que six colonnes. La valorisation reste
          dans la barre latérale sur ordinateur. */}
      {NAV.filter(i => !['/dashboard/reports', '/dashboard/settings', '/dashboard/mercuriale', '/dashboard/recettes', '/dashboard/production', '/dashboard/valorisation', '/dashboard/listing-prix'].includes(i.href)).map(item => {
        const active = isActive(pathname, item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`flex flex-col items-center justify-center gap-0.5 py-2 transition-colors active:bg-gray-50 ${
              active ? 'text-pilote' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <item.icon className="w-5 h-5" strokeWidth={active ? 2.2 : 2} />
            <span className={`text-[10px] ${active ? 'font-semibold' : 'font-medium'}`}>{item.short}</span>
          </Link>
        )
      })}
    </nav>
  )
}
