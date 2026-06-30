import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Users, FileText, TrendingUp, AlertCircle } from 'lucide-react'
import { formatDate } from '@/lib/utils'

export default async function AdminPage() {
  const supabase = createClient()

  const [
    { count: totalClients },
    { count: activeClients },
    { count: totalReports },
    { data: recentClients },
    { data: problemClients },
  ] = await Promise.all([
    supabase.from('profiles').select('*', { count: 'exact', head: true }),
    supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('subscription_status', 'active'),
    supabase.from('reports').select('*', { count: 'exact', head: true }),
    supabase
      .from('profiles')
      .select('business_name, city, subscription_status, created_at')
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('profiles')
      .select('business_name, city, subscription_status, delivery_email')
      .in('subscription_status', ['past_due', 'incomplete', 'canceled'])
      .limit(10),
  ])

  const mrr = (activeClients ?? 0) * 149

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Vue d&apos;ensemble</h1>
        <p className="text-gray-500 mt-1">Tableau de bord administrateur</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-blue-600" />
              <span className="text-sm text-gray-500">Clients total</span>
            </div>
            <p className="text-3xl font-bold text-gray-900">{totalClients ?? 0}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-green-600" />
              <span className="text-sm text-gray-500">Clients actifs</span>
            </div>
            <p className="text-3xl font-bold text-gray-900">{activeClients ?? 0}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-blue-600" />
              <span className="text-sm text-gray-500">MRR</span>
            </div>
            <p className="text-3xl font-bold text-gray-900">{mrr.toLocaleString('fr-FR')}€</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="w-4 h-4 text-blue-600" />
              <span className="text-sm text-gray-500">Rapports envoyés</span>
            </div>
            <p className="text-3xl font-bold text-gray-900">{totalReports ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent clients */}
        <Card>
          <CardHeader>
            <CardTitle>Derniers inscrits</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentClients?.map((client, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{client.business_name}</p>
                    <p className="text-xs text-gray-400">{client.city} · {formatDate(client.created_at)}</p>
                  </div>
                  <Badge
                    variant={
                      client.subscription_status === 'active' ? 'success' :
                      client.subscription_status === 'canceled' ? 'destructive' : 'warning'
                    }
                  >
                    {client.subscription_status || '—'}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Problem clients */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-orange-500" />
              Clients en alerte
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!problemClients || problemClients.length === 0 ? (
              <p className="text-gray-400 text-sm py-4 text-center">Aucun problème détecté</p>
            ) : (
              <div className="space-y-3">
                {problemClients.map((client, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                    <div>
                      <p className="font-medium text-gray-900 text-sm">{client.business_name}</p>
                      <p className="text-xs text-gray-400">{client.delivery_email}</p>
                    </div>
                    <Badge variant="destructive">{client.subscription_status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
