import { createClient, createServiceClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { FileText, Plus, Download } from 'lucide-react'
import Link from 'next/link'

const ADMIN_EMAIL = 'nouvion.theo51@gmail.com'

export default async function ReportsPage() {
  const supabase = createClient()
  const serviceSupabase = createServiceClient()
  const { data: { user } } = await supabase.auth.getUser()
  const isAdmin = user?.email === ADMIN_EMAIL

  // Use serviceSupabase to bypass RLS — clients can't read their own record otherwise
  const { data: clientRecord } = await serviceSupabase
    .from('clients')
    .select('id')
    .eq('client_user_id', user?.id ?? '')
    .maybeSingle()
  const isClientUser = !!clientRecord

  let reports: { id: string; title: string; file_url: string; created_at: string }[] | null = null

  if (isClientUser && clientRecord) {
    const { data } = await serviceSupabase
      .from('reports')
      .select('id, title, file_url, created_at')
      .eq('client_id', clientRecord.id)
      .order('created_at', { ascending: false })
    reports = data
  } else {
    const { data: profile } = await supabase.from('profiles').select('id').eq('user_id', user?.id ?? '').single()
    const { data } = await supabase
      .from('reports')
      .select('id, title, file_url, created_at')
      .eq('profile_id', profile?.id ?? '')
      .order('created_at', { ascending: false })
    reports = data
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Rapports</h1>
          <p className="text-gray-500 mt-1">Vos analyses comparatives hebdomadaires</p>
        </div>
        {isAdmin && (
          <Link href="/admin/reports/nouveau">
            <Button><Plus className="w-4 h-4 mr-2" />Nouveau rapport</Button>
          </Link>
        )}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Historique</CardTitle>
          <CardDescription>Cliquez sur Télécharger pour ouvrir le rapport PDF</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {!reports || reports.length === 0 ? (
            <div className="text-center py-16">
              <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 mb-4">Aucun rapport encore</p>
              {isAdmin && (
                <Link href="/admin/reports/nouveau">
                  <Button variant="outline">Générer votre premier rapport</Button>
                </Link>
              )}
            </div>
          ) : (
            <div className="divide-y">
              {reports.map((report) => (
                <div key={report.id} className="flex items-center justify-between px-6 py-4 hover:bg-gray-50">
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-blue-600 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-gray-900">{report.title}</p>
                      <p className="text-xs text-gray-400">{new Date(report.created_at).toLocaleDateString('fr-FR')}</p>
                    </div>
                  </div>
                  <a href={report.file_url} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="sm"><Download className="w-4 h-4 mr-2" />Télécharger</Button>
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
