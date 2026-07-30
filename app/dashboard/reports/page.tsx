import { createClient, createServiceClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Plus, FileText } from 'lucide-react'
import Link from 'next/link'
import { ReportsTree } from './ReportsTree'
import { isAdminEmail } from '@/lib/admins'

export default async function ReportsPage() {
  const supabase = createClient()
  const serviceSupabase = createServiceClient()
  const { data: { user } } = await supabase.auth.getUser()
  const isAdmin = isAdminEmail(user?.email)

  const { data: clientRecord } = await serviceSupabase
    .from('clients')
    .select('id')
    .eq('client_user_id', user?.id ?? '')
    .maybeSingle()
  const isClientUser = !!clientRecord

  let reports: { id: string; title: string; file_url: string; file_path: string | null; created_at: string }[] = []

  if (isClientUser && clientRecord) {
    const { data } = await serviceSupabase
      .from('reports')
      .select('id, title, file_url, file_path, created_at')
      .eq('client_id', clientRecord.id)
      .order('created_at', { ascending: false })
    reports = data ?? []
  } else {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', user?.id ?? '')
      .single()
    const { data } = await supabase
      .from('reports')
      .select('id, title, file_url, file_path, created_at')
      .eq('profile_id', profile?.id ?? '')
      .order('created_at', { ascending: false })
    reports = data ?? []
  }

  // Rapport confidentiel : le bucket est privé → chaque PDF est servi par URL
  // signée courte, calculée côté serveur (la page n'expose que les rapports du
  // client déjà autorisé). Repli sur file_url si la signature échoue, pour ne
  // jamais casser un téléchargement.
  const stripBucket = (u: string) => u.replace(/^.*\/reports\//, '')
  const pathOf = (r: { file_path: string | null; file_url: string }) => r.file_path || stripBucket(r.file_url)
  const signed = new Map<string, string>()
  const paths = reports.map(pathOf).filter(Boolean)
  if (paths.length > 0) {
    const { data: urls } = await serviceSupabase.storage.from('reports').createSignedUrls(paths, 3600)
    for (const u of urls ?? []) { if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl) }
  }
  const reportsOut = reports.map(r => ({
    id: r.id, title: r.title, created_at: r.created_at,
    download_url: signed.get(pathOf(r)) || r.file_url,
  }))

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-pilote-50 flex items-center justify-center flex-shrink-0 mt-0.5">
            <FileText className="w-5 h-5 text-pilote" />
          </div>
          <div>
            <span className="inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-pilote bg-pilote-50 mb-1.5">Archive</span>
            <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Mes rapports</h1>
            <p className="text-sm text-gray-500 mt-1">Vos analyses comparatives hebdomadaires, classées par année et par mois.</p>
          </div>
        </div>
        {isAdmin && (
          <Link href="/admin/reports/nouveau">
            <Button className="bg-pilote hover:bg-pilote-hover text-white rounded-xl shadow-card active:scale-[0.98] transition-all"><Plus className="w-4 h-4 mr-2" />Nouveau rapport</Button>
          </Link>
        )}
      </div>

      <Card className="rounded-2xl border-gray-100 shadow-card overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900 tracking-tight">Historique</h2>
            <p className="text-xs text-gray-400 mt-0.5">Dépliez une année, puis un mois</p>
          </div>
          <span className="text-[11px] font-semibold text-gray-400 tabular">{reports.length} rapport{reports.length > 1 ? 's' : ''}</span>
        </div>
        <CardContent className="p-0">
          <ReportsTree reports={reportsOut} />
        </CardContent>
      </Card>
    </div>
  )
}
