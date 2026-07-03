import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Users, FileText, Plus } from 'lucide-react'
import Link from 'next/link'

export default async function AdminClientsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Get admin profile to fetch their clients
  const { data: profile } = await supabase.from('profiles').select('id').eq('user_id', user?.id ?? '').single()

  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, email, created_at')
    .order('created_at', { ascending: false })

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
          <p className="text-gray-500 mt-1">{clients?.length ?? 0} compte{(clients?.length ?? 0) > 1 ? 's' : ''} client{(clients?.length ?? 0) > 1 ? 's' : ''}</p>
        </div>
        <Link href="/dashboard/clients/nouveau">
          <Button variant="outline"><Plus className="w-4 h-4 mr-2" />Nouveau client</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Liste des clients</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!clients || clients.length === 0 ? (
            <div className="text-center py-16">
              <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 mb-4">Aucun client pour le moment</p>
              <Link href="/dashboard/clients/nouveau">
                <Button variant="outline">Ajouter un client</Button>
              </Link>
            </div>
          ) : (
            <div className="divide-y">
              {clients.map((client) => (
                <Link
                  key={client.id}
                  href={`/admin/clients/${client.id}`}
                  className="flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-blue-700 font-semibold text-sm">
                        {client.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{client.name}</p>
                      <p className="text-sm text-gray-400">{client.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <FileText className="w-4 h-4" />
                    <span>Voir les rapports</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
