import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LogOut } from 'lucide-react'
import { SidebarNav, MobileTabBar } from './NavLinks'
import { ToastProvider } from '@/components/ui/toast'
import { ConfirmProvider } from '@/components/ui/confirm-dialog'

const ADMIN_EMAIL = 'nouvion.theo51@gmail.com'

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

  const displayName = profile?.business_name || user.email || ''
  const initial = displayName.charAt(0).toUpperCase()

  return (
    <ToastProvider>
    <ConfirmProvider>
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar — desktop uniquement */}
      <aside className="hidden md:flex w-64 bg-white border-r border-gray-200 flex-col">
        <div className="h-16 flex items-center px-6 border-b border-gray-100">
          <span className="text-[15px] font-extrabold tracking-[0.22em] text-pilote select-none">
            PILOTE<span className="text-pilote-orange">.</span>
          </span>
        </div>
        <SidebarNav />
        <div className="p-3 border-t border-gray-100">
          <div className="flex items-center gap-2.5 px-3 py-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-pilote-50 text-pilote flex items-center justify-center text-sm font-bold flex-shrink-0">
              {initial}
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-gray-400 leading-tight">Connecté en tant que</p>
              <p className="text-sm font-semibold text-gray-800 truncate leading-tight">{displayName}</p>
            </div>
          </div>
          <form action={signOut}>
            <button type="submit" className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors w-full">
              <LogOut className="w-4 h-4 text-gray-400" />
              Déconnexion
            </button>
          </form>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* En-tête — mobile uniquement */}
        <header className="md:hidden h-14 bg-white/95 backdrop-blur border-b border-gray-200 flex items-center justify-between px-4 sticky top-0 z-40">
          <span className="text-sm font-extrabold tracking-[0.22em] text-pilote select-none">
            PILOTE<span className="text-pilote-orange">.</span>
          </span>
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-gray-500 truncate max-w-[140px]">{displayName}</span>
            <form action={signOut}>
              <button type="submit" className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors" title="Déconnexion">
                <LogOut className="w-4 h-4" />
              </button>
            </form>
          </div>
        </header>

        <main className="flex-1 overflow-auto pb-20 md:pb-0">
          {children}
        </main>
      </div>

      <MobileTabBar />
    </div>
    </ConfirmProvider>
    </ToastProvider>
  )
}
