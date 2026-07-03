import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

async function resolveClientId(serviceSupabase: ReturnType<typeof createServiceClient>, userId: string, userEmail: string | undefined): Promise<string | null> {
  // 1. Try by client_user_id
  const { data: byId } = await serviceSupabase
    .from('clients')
    .select('id')
    .eq('client_user_id', userId)
    .maybeSingle()
  if (byId) return byId.id

  // 2. Fallback: try by email
  if (!userEmail) return null
  const { data: byEmail } = await serviceSupabase
    .from('clients')
    .select('id')
    .eq('email', userEmail)
    .maybeSingle()
  if (!byEmail) return null

  // Auto-repair: set client_user_id so future lookups work
  await serviceSupabase
    .from('clients')
    .update({ client_user_id: userId })
    .eq('id', byEmail.id)

  return byEmail.id
}

export async function GET() {
  const supabase = createClient()
  const serviceSupabase = createServiceClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const clientId = await resolveClientId(serviceSupabase, user.id, user.email)
  if (!clientId) return NextResponse.json([])

  const { data: employees, error } = await serviceSupabase
    .from('employees')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(employees || [])
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const serviceSupabase = createServiceClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const clientId = await resolveClientId(serviceSupabase, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const body = await req.json()
  const { name, hourly_rate } = body
  if (!name || hourly_rate === undefined) {
    return NextResponse.json({ error: 'Nom et taux horaire requis' }, { status: 400 })
  }

  const { data, error } = await serviceSupabase
    .from('employees')
    .insert({ client_id: clientId, name, hourly_rate: parseFloat(hourly_rate) })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
