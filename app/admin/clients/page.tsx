import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'

export default async function AdminClientsPage() {
  const supabase = createClient()

  const { data: clients } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
        <p className="text-gray-500 mt-1">{clients?.length ?? 0} clients au total</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Liste des clients</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">Commerce</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">Ville</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">Email livraison</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">Statut</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">Inscription</th>
                  <th className="text-left py-3 px-4 text-gray-500 font-medium">Google Drive</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {clients?.map((client) => (
                  <tr key={client.id} className="hover:bg-gray-50">
                    <td className="py-3 px-4 font-medium text-gray-900">{client.business_name}</td>
                    <td className="py-3 px-4 text-gray-500">{client.city}</td>
                    <td className="py-3 px-4 text-gray-500">{client.delivery_email}</td>
                    <td className="py-3 px-4">
                      <Badge
                        variant={
                          client.subscription_status === 'active' ? 'success' :
                          client.subscription_status === 'canceled' ? 'destructive' : 'warning'
                        }
                      >
                        {client.subscription_status || '—'}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-gray-500">{formatDate(client.created_at)}</td>
                    <td className="py-3 px-4">
                      {client.google_drive_folder ? (
                        <a
                          href={client.google_drive_folder}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          Ouvrir
                        </a>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
