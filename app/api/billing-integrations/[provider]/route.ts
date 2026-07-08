import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { provider: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const service = createServiceClient()
  const { data: clientRow } = await service
    .from('clients').select('id').eq('client_user_id', user.id).maybeSingle()
  if (!clientRow) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  await service.from('billing_integrations')
    .delete()
    .eq('client_id', clientRow.id)
    .eq('provider', params.provider)

  return NextResponse.json({ success: true })
}
