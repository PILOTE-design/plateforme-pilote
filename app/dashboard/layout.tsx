import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BarChart3, FileText, Settings, LogOut, CalendarDays, Receipt } from 'lucide-react'

async function signOut() {
  'use server'
  const supabase = createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

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
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-gray-200">
          <span className="text-lg font-bold text-blue-600">PILOTE</span>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          <Link
            href="/dashboard"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <BarChart3 className="w-4 h-4" />
            Tableau de bord
          </Link>
          <Link
            href="/dashboard/reports"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <FileText className="w-4 h-4" />
            Mes rapports
          </Link>
          <Link
            href="/dashboard/planning"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <CalendarDays className="w-4 h-4" />
            Planning
          </Link>
          <Link
            href="/dashboard/facturation"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <Receipt className="w-4 h-4" />
            Facturation
          </Link>
          <Link
            href="/dashboard/settings"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <Settings className="w-4 h-4" />
            Paramètres
          </Link>
        </nav>
        <div className="p-4 border-t border-gray-200">
          <div className="px-3 py-2 mb-2">
            <p className="text-xs text-gray-400">Connecté en tant que</p>
            <p className="text-sm font-medium text-gray-700 truncate">{profile?.business_name || user.email}</p>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100 transition-colors w-full"
            >
              <LogOut className="w-4 h-4" />
              Déconnexion
            </button>
          </form>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
