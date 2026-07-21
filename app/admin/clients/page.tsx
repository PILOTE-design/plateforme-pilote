import { createClient, createServiceClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Users, FileText, Plus, CheckCircle, Clock } from 'lucide-react'
import { isAdminEmail } from '@/lib/admins'

export default async function AdminClientsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdminEmail(user.email)) redirect('/dashboard')

  // Service client bypasses RLS -> voit TOUS les clients
  const service = createServiceClient()
  const { data: clients } = await service
    .from('clients')
    .select('id, name, email, created_at, client_user_id')
    .order('created_at', { ascending: false })

  const list = clients ?? []

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
          <p className="text-gray-500 mt-1">
            {list.length} compte{list.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/clients/nouveau"
            className="inline-flex items-center gap-2 bg-white text-pilote border border-gray-200 text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-gray-50 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Nouveau client
          </Link>
          <Link
            href="/admin/reports/nouveau"
            className="inline-flex items-center gap-2 bg-[#1E3A5F] text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-[#2a4f7c] transition-colors shadow-sm"
          >
            <FileText className="w-4 h-4" />
            Nouveau rapport
          </Link>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center shadow-sm">
          <Users className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400 mb-5">Aucun client pour le moment</p>
          <Link
            href="/admin/clients/nouveau"
            className="inline-flex items-center gap-2 bg-pilote text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-pilote-hover transition-colors"
          >
            <Plus className="w-4 h-4" />
            Ajouter un client
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gray-50">
            <span className="text-[11px] font-semibold uppercase text-gray-400 tracking-wide">Client</span>
            <span className="text-[11px] font-semibold uppercase text-gray-400 tracking-wide">Statut</span>
          </div>
          {list.map((client) => (
            <Link
              key={client.id}
              href={`/admin/clients/${client.id}`}
              className="flex items-center justify-between px-5 py-4 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors group"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#1E3A5F] to-blue-400 flex items-center justify-center flex-shrink-0 shadow-sm">
                  <span className="text-white font-bold text-sm">
                    {client.name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <p className="font-semibold text-sm text-gray-900">{client.name}</p>
                  <p className="text-xs text-gray-400">{client.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {client.client_user_id ? (
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold text-green-700 bg-green-100 px-2.5 py-1 rounded-full">
                    <CheckCircle className="w-3 h-3" />
                    Actif
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold text-yellow-700 bg-yellow-100 px-2.5 py-1 rounded-full">
                    <Clock className="w-3 h-3" />
                    En attente
                  </span>
                )}
                <span className="flex items-center gap-1 text-xs text-gray-400 group-hover:text-[#1E3A5F] transition-colors">
                  <FileText className="w-3.5 h-3.5" />
                  Voir
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
