import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

async function resolveClientId(serviceSupabase: any, userId: string, userEmail?: string | null) {
  const { data: byId } = await serviceSupabase.from('clients').select('id').eq('client_user_id', userId).maybeSingle()
  if (byId) return byId.id
  if (!userEmail) return null
  const { data: byEmail } = await serviceSupabase.from('clients').select('id').eq('email', userEmail).maybeSingle()
  if (!byEmail) return null
  await serviceSupabase.from('clients').update({ client_user_id: userId }).eq('id', byEmail.id)
  return byEmail.id
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const serviceSupabase = createServiceClient()
  const clientId = await resolveClientId(serviceSupabase, user.id, user.email)
  if (!clientId) return NextResponse.json([])

  const { data, error } = await serviceSupabase
    .from('employees')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const serviceSupabase = createServiceClient()
  const clientId = await resolveClientId(serviceSupabase, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const body = await request.json()
  const { name, hourly_rate, contract_hours = 35 } = body

  if (!name || !hourly_rate) return NextResponse.json({ error: 'Champs manquants' }, { status: 400 })

  const { data, error } = await serviceSupabase
    .from('employees')
    .insert({ client_id: clientId, name, hourly_rate, contract_hours })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
