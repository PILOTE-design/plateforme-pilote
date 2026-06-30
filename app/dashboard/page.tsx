import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { FileText, TrendingUp, Calendar } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import Link from 'next/link'

const statusLabels: Record<string, { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }> = {
  active: { label: 'Actif', variant: 'success' },
  trialing: { label: 'Essai', variant: 'secondary' },
  past_due: { label: 'Paiement en retard', variant: 'warning' },
  canceled: { label: 'Résilié', variant: 'destructive' },
  incomplete: { label: 'Incomplet', variant: 'warning' },
}

export default async function DashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', user!.id)
    .single()

  const { data: reports } = await supabase
    .from('reports')
    .select('*')
    .eq('profile_id', profile?.id)
    .order('created_at', { ascending: false })
    .limit(3)

  const status = profile?.subscription_status
  const statusInfo = status ? statusLabels[status] : null

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          Bonjour, {profile?.business_name || 'bienvenue'} 👋
        </h1>
        <p className="text-gray-500 mt-1">Voici un aperçu de votre activité</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-500">Abonnement</span>
              {statusInfo && (
                <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
              )}
            </div>
            <p className="text-2xl font-bold text-gray-900">149€/mois</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="w-4 h-4 text-blue-600" />
              <span className="text-sm text-gray-500">Rapports reçus</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{reports?.length ?? 0}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-4 h-4 text-blue-600" />
              <span className="text-sm text-gray-500">Client depuis</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">
              {profile?.created_at ? formatDate(profile.created_at) : '—'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Last reports */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Derniers rapports</CardTitle>
            <CardDescription>Vos analyses comparatives récentes</CardDescription>
          </div>
          <Link href="/dashboard/reports" className="text-sm text-blue-600 hover:underline">
            Voir tout
          </Link>
        </CardHeader>
        <CardContent>
          {!reports || reports.length === 0 ? (
            <div className="text-center py-12">
              <TrendingUp className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">Votre premier rapport arrivera la semaine prochaine</p>
            </div>
          ) : (
            <div className="space-y-3">
              {reports.map((report) => (
                <div
                  key={report.id}
                  className="flex items-center justify-between p-4 rounded-lg border border-gray-100 hover:bg-gray-50"
                >
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-blue-600" />
                    <div>
                      <p className="font-medium text-gray-900">{report.title}</p>
                      <p className="text-xs text-gray-400">{formatDate(report.created_at)}</p>
                    </div>
                  </div>
                  <a
                    href={report.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline"
                  >
                    Télécharger
                  </a>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
