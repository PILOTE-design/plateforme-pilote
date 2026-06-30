import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FileText, TrendingUp } from 'lucide-react'
import { formatDate } from '@/lib/utils'

export default async function ReportsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user!.id)
    .single()

  const { data: reports } = await supabase
    .from('reports')
    .select('*')
    .eq('profile_id', profile?.id)
    .order('created_at', { ascending: false })

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Mes rapports</h1>
        <p className="text-gray-500 mt-1">Toutes vos analyses comparatives</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Analyses disponibles</CardTitle>
          <CardDescription>
            {reports?.length
              ? `${reports.length} rapport${reports.length > 1 ? 's' : ''} au total`
              : 'Aucun rapport pour le moment'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!reports || reports.length === 0 ? (
            <div className="text-center py-16">
              <TrendingUp className="w-12 h-12 text-gray-200 mx-auto mb-4" />
              <p className="text-gray-500 font-medium">Votre premier rapport est en cours de préparation</p>
              <p className="text-gray-400 text-sm mt-1">Il arrivera la semaine prochaine, chaque lundi matin</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {reports.map((report) => (
                <div key={report.id} className="flex items-center justify-between py-4">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
                      <FileText className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{report.title}</p>
                      <p className="text-sm text-gray-400">
                        Semaine {report.week_number} — {formatDate(report.created_at)}
                      </p>
                    </div>
                  </div>
                  <a
                    href={report.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-blue-600 hover:underline"
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
