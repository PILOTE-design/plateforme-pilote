import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Users, FileText, LogOut, ArrowLeft, ShieldCheck } from 'lucide-react'
import { isAdminEmail } from '@/lib/admins'

async function signOut() {
  'use server'
  const supabase = createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')
  if (!isAdminEmail(user.email)) redirect('/dashboard')

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Admin Sidebar — dark theme */}
      <aside className="w-64 bg-gray-900 flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-gray-700">
          <ShieldCheck className="w-5 h-5 text-orange-400 mr-2 flex-shrink-0" />
          <span className="text-base font-bold text-white">PILOTE Admin</span>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          <Link
            href="/admin/clients"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
          >
            <Users className="w-4 h-4" />
            Clients
          </Link>
          <Link
            href="/admin/reports/nouveau"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
          >
            <FileText className="w-4 h-4" />
            Générer un rapport
          </Link>
          <div className="pt-4 mt-2 border-t border-gray-700">
            <Link
              href="/dashboard"
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Retour dashboard
            </Link>
          </div>
        </nav>
        <div className="p-4 border-t border-gray-700">
          <div className="px-3 py-2 mb-2">
            <p className="text-xs text-gray-500">Administrateur</p>
            <p className="text-sm font-medium text-gray-300 truncate">{user.email}</p>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors w-full"
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
