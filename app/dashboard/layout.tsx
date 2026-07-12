import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BarChart3, FileText, Settings, LogOut, CalendarDays, Receipt, Scale, LineChart, Percent } from 'lucide-react'

const ADMIN_EMAIL = 'nouvion.theo51@gmail.com'

async function signOut() {
  'use server'
  const supabase = createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

const NAV = [
  { href: '/dashboard',              icon: BarChart3,    label: 'Tableau de bord', short: 'Accueil' },
  { href: '/dashboard/reports',      icon: FileText,     label: 'Mes rapports',    short: 'Rapports' },
  { href: '/dashboard/tendances',    icon: LineChart,    label: 'Tendances',       short: 'Tendances' },
  { href: '/dashboard/marges',       icon: Percent,      label: 'Marges',          short: 'Marges' },
  { href: '/dashboard/planning',     icon: CalendarDays, label: 'Planning',        short: 'Planning' },
  { href: '/dashboard/facturation',  icon: Receipt,      label: 'Facturation',     short: 'Factures' },
  { href: '/dashboard/valorisation', icon: Scale,        label: 'Valorisation',    short: 'Valo' },
  { href: '/dashboard/settings',     icon: Settings,     label: 'Parametres',      short: 'Réglages' },
]

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // L'admin n'a pas acces au dashboard client — il va directement sur /admin
  if (user.email === ADMIN_EMAIL) redirect('/admin')

  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, onboarding_completed')
    .eq('user_id', user.id)
    .single()

  if (profile && !profile.onboarding_completed && process.env.NODE_ENV !== 'development') {
    redirect('/onboarding')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar — desktop uniquement */}
      <aside className="hidden md:flex w-64 bg-white border-r border-gray-200 flex-col">
        <div className="h-16 flex items-center px-6 border-b border-gray-200">
          <span className="text-lg font-bold text-blue-600">PILOTE</span>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {NAV.map(item => (
            <Link key={item.href} href={item.href} className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100 transition-colors">
              <item.icon className="w-4 h-4" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="p-4 border-t border-gray-200">
          <div className="px-3 py-2 mb-2">
            <p className="text-xs text-gray-400">Connecte en tant que</p>
            <p className="text-sm font-medium text-gray-700 truncate">{profile?.business_name || user.email}</p>
          </div>
          <form action={signOut}>
            <button type="submit" className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100 transition-colors w-full">
              <LogOut className="w-4 h-4" />
              Deconnexion
            </button>
          </form>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* En-tête — mobile uniquement */}
        <header className="md:hidden h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 sticky top-0 z-40">
          <span className="text-base font-bold text-blue-600">PILOTE</span>
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-gray-500 truncate max-w-[140px]">{profile?.business_name || user.email}</span>
            <form action={signOut}>
              <button type="submit" className="p-2 rounded-lg text-gray-400 hover:bg-gray-100" title="Deconnexion">
                <LogOut className="w-4 h-4" />
              </button>
            </form>
          </div>
        </header>

        <main className="flex-1 overflow-auto pb-20 md:pb-0">
          {children}
        </main>
      </div>

      {/* Barre d'onglets — mobile uniquement */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-white border-t border-gray-200 grid grid-cols-6 pb-[env(safe-area-inset-bottom)]">
        {NAV.filter(i => !['/dashboard/reports', '/dashboard/settings'].includes(i.href)).map(item => (
          <Link key={item.href} href={item.href} className="flex flex-col items-center justify-center gap-0.5 py-2 text-gray-500 hover:text-[#1E3A5F] active:bg-gray-50">
            <item.icon className="w-5 h-5" />
            <span className="text-[10px] font-medium">{item.short}</span>
          </Link>
        ))}
      </nav>
    </div>
  )
}
