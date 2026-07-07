import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

const ADMIN_EMAIL = 'theo.nouvion@gmail.com'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  const service = createServiceClient()
  const [clientRes, reportsRes] = await Promise.all([
    service.from('clients').select('*').eq('id', params.id).single(),
    service
      .from('reports')
      .select('id, title, file_url, created_at, week_number, year')
      .eq('client_id', params.id)
      .order('created_at', { ascending: false }),
  ])

  if (clientRes.error || !clientRes.data) {
    return NextResponse.json({ error: 'Client non trouvé' }, { status: 404 })
  }

  return NextResponse.json({
    client: clientRes.data,
    reports: reportsRes.data ?? [],
  })
}
