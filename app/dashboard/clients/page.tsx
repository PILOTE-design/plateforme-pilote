import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import ClientsList from './ClientsList'

const ADMIN_EMAIL = 'nouvion.theo51@gmail.com'

export default async function ClientsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user || user.email !== ADMIN_EMAIL) {
    redirect('/dashboard')
  }

  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, email, client_user_id, invited_at')
    .order('name')

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Clients</h1>
        <Link
          href="/dashboard/clients/nouveau"
          className="flex items-center gap-2 px-4 py-2 bg-pilote text-white rounded-lg text-sm font-medium hover:bg-pilote-hover transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nouveau client
        </Link>
      </div>

      <ClientsList clients={clients || []} />
    </div>
  )
}
