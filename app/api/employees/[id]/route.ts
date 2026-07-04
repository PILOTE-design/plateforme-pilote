import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

async function resolveClient(serviceSupabase: any, userId: string, userEmail?: string | null) {
  const { data: byId } = await serviceSupabase.from('clients').select('id').eq('client_user_id', userId).maybeSingle()
  if (byId) return byId
  if (!userEmail) return null
  const { data: byEmail } = await serviceSupabase.from('clients').select('id').eq('email', userEmail).maybeSingle()
  return byEmail ?? null
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const serviceSupabase = createServiceClient()
  const clientRecord = await resolveClient(serviceSupabase, user.id, user.email)
  if (!clientRecord) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const body = await req.json()
  const allowed = ['name', 'hourly_rate', 'contract_hours']
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  const { data, error } = await serviceSupabase
    .from('employees')
    .update(updates)
    .eq('id', params.id)
    .eq('client_id', clientRecord.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const serviceSupabase = createServiceClient()
  const clientRecord = await resolveClient(serviceSupabase, user.id, user.email)
  if (!clientRecord) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const { error } = await serviceSupabase
    .from('employees')
    .delete()
    .eq('id', params.id)
    .eq('client_id', clientRecord.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
