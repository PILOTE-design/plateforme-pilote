import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/admins'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  const service = createServiceClient()
  const [clientRes, reportsRes] = await Promise.all([
    service.from('clients').select('*').eq('id', params.id).single(),
    service
      .from('reports')
      .select('id, title, file_url, file_path, created_at, week_number, year')
      .eq('client_id', params.id)
      .order('created_at', { ascending: false }),
  ])

  if (clientRes.error || !clientRes.data) {
    return NextResponse.json({ error: 'Client non trouvé' }, { status: 404 })
  }

  // Bucket `reports` privé : on renvoie des URL signées courtes plutôt que le
  // chemin stocké (repli sur file_url si la signature échoue — lot A).
  const rawReports = (reportsRes.data ?? []) as Array<Record<string, any>>
  const stripBucket = (u: unknown) => String(u || '').replace(/^.*\/reports\//, '')
  const pathOf = (r: Record<string, any>) => (r.file_path as string) || stripBucket(r.file_url)
  const signed = new Map<string, string>()
  const paths = rawReports.map(pathOf).filter(Boolean)
  if (paths.length > 0) {
    const { data: urls } = await service.storage.from('reports').createSignedUrls(paths, 3600)
    for (const u of urls ?? []) { if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl) }
  }
  const reports = rawReports.map(r => ({ ...r, file_url: signed.get(pathOf(r)) || r.file_url }))

  return NextResponse.json({
    client: clientRes.data,
    reports,
  })
}
