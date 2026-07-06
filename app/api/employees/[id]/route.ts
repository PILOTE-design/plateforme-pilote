import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

async function resolveClient(
  serviceSupabase: ReturnType<typeof createServiceClient>,
  userId: string,
  userEmail?: string | null,
) {
  const { data: byId } = await serviceSupabase
    .from('clients').select('id').eq('client_user_id', userId).maybeSingle()
  if (byId) return byId
  if (!userEmail) return null
  const { data: byEmail } = await serviceSupabase
    .from('clients').select('id').eq('email', userEmail).maybeSingle()
  return byEmail ?? null
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const serviceSupabase = createServiceClient()
  const clientRecord = await resolveClient(serviceSupabase, user.id, user.email)
  if (!clientRecord) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const body = await req.json() as Record<string, unknown>
  const allowed = [
    'name', 'hourly_rate', 'contract_type', 'contract_hours', 'cp_initial',
    'charges_patronales',
    // Champs RH
    'position', 'hire_date', 'contract_end_date', 'phone', 'email', 'notes', 'is_minor',
  ]
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Aucun champ valide à mettre à jour' }, { status: 400 })
  }

  const { data, error } = await serviceSupabase
    .from('employees')
    .update(updates)
    .eq('id', params.id)
    .eq('client_id', (clientRecord as { id: string }).id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const serviceSupabase = createServiceClient()
  const clientRecord = await resolveClient(serviceSupabase, user.id, user.email)
  if (!clientRecord) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const { error } = await serviceSupabase
    .from('employees')
    .delete()
    .eq('id', params.id)
    .eq('client_id', (clientRecord as { id: string }).id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
