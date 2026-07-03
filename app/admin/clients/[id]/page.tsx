import { createClient, createServiceClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { FileText, Download, Plus, ArrowLeft, Mail, Calendar } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

export default async function ClientDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const serviceSupabase = createServiceClient()

  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!client) notFound()

  const { data: reports } = await serviceSupabase
    .from('reports')
    .select('id, title, file_url, created_at, week_number, year')
    .eq('client_id', client.id)
    .order('created_at', { ascending: false })

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/admin/clients"
          className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 mb-5 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour aux clients
        </Link>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center">
              <span className="text-blue-700 font-bold text-xl">
                {client.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{client.name}</h1>
              <p className="text-gray-400 flex items-center gap-1 mt-0.5">
                <Mail className="w-3.5 h-3.5" />
                {client.email}
              </p>
            </div>
          </div>
          <Link href={`/admin/reports/nouveau?client=${client.id}`}>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Générer un rapport
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Rapports générés</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{reports?.length ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Email</p>
            <p className="font-medium text-gray-900 mt-1 truncate">{client.email}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              Client depuis
            </p>
            <p className="font-medium text-gray-900 mt-1">
              {new Date(client.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Reports list */}
      <Card>
        <CardHeader>
          <CardTitle>Historique des rapports</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!reports || reports.length === 0 ? (
            <div className="text-center py-16">
              <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 mb-4">Aucun rapport pour ce client</p>
              <Link href={`/admin/reports/nouveau?client=${client.id}`}>
                <Button variant="outline">Générer le premier rapport</Button>
              </Link>
            </div>
          ) : (
            <div className="divide-y">
              {reports.map((report) => (
                <div key={report.id} className="flex items-center justify-between px-6 py-4 hover:bg-gray-50">
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-blue-600 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-gray-900">{report.title}</p>
                      <p className="text-xs text-gray-400">
                        {new Date(report.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
                      </p>
                    </div>
                  </div>
                  <a href={report.file_url} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="sm">
                      <Download className="w-4 h-4 mr-2" />
                      Télécharger
                    </Button>
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
