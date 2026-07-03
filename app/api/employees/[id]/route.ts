import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const serviceSupabase = createServiceClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  // Security: verify the employee belongs to this user's client
  const { data: clientRecord } = await serviceSupabase
    .from('clients')
    .select('id')
    .eq('client_user_id', user.id)
    .maybeSingle()

  if (!clientRecord) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const { error } = await serviceSupabase
    .from('employees')
    .delete()
    .eq('id', params.id)
    .eq('client_id', clientRecord.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
