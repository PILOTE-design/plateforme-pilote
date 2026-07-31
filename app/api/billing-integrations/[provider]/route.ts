import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { provider: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const service = createServiceClient()
  // resolveClientId (user_id puis email) — le lookup direct client_user_id
  // excluait le second login d'une boutique (fiche rattachée à un seul compte)
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  await service.from('billing_integrations')
    .delete()
    .eq('client_id', clientId)
    .eq('provider', params.provider)

  return NextResponse.json({ success: true })
}
