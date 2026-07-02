import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { redirect } from 'next/navigation'

export default async function ClientsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: clients } = await supabase
    .from('clients')
    .select('*')
    .order('name')

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mes clients</h1>
          <p className="text-gray-500 mt-1">{clients?.length || 0} client(s)</p>
        </div>
        <Link
          href="/dashboard/clients/nouveau"
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          + Ajouter un client
        </Link>
      </div>

      {clients && clients.length > 0 ? (
        <div className="space-y-3">
          {clients.map((client: any) => (
            <div key={client.id} className="bg-white border border-gray-200 rounded-xl p-4 flex justify-between items-center">
              <div>
                <p className="font-medium text-gray-900">{client.name}</p>
                <p className="text-sm text-gray-500">{client.email}</p>
                {client.phone && <p className="text-sm text-gray-400">{client.phone}</p>}
              </div>
              <div className="flex gap-3">
                <Link
                  href={`/dashboard/reports/nouveau?client=${client.id}&clientName=${encodeURIComponent(client.name)}`}
                  className="text-sm bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg hover:bg-blue-100 font-medium"
                >
                  Générer rapport
                </Link>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg mb-2">Aucun client pour l&apos;instant</p>
          <Link href="/dashboard/clients/nouveau" className="text-blue-600 hover:underline text-sm">
            Ajouter votre premier client →
          </Link>
        </div>
      )}
    </div>
  )
}
