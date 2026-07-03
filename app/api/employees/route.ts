import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = createClient()
  const serviceSupabase = createServiceClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { data: clientRecord } = await serviceSupabase
    .from('clients')
    .select('id')
    .eq('client_user_id', user.id)
    .maybeSingle()

  if (!clientRecord) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const { data: employees, error } = await serviceSupabase
    .from('employees')
    .select('*')
    .eq('client_id', clientRecord.id)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(employees || [])
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const serviceSupabase = createServiceClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { data: clientRecord } = await serviceSupabase
    .from('clients')
    .select('id')
    .eq('client_user_id', user.id)
    .maybeSingle()

  if (!clientRecord) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const body = await req.json()
  const { name, hourly_rate } = body
  if (!name || hourly_rate === undefined) {
    return NextResponse.json({ error: 'Nom et taux horaire requis' }, { status: 400 })
  }

  const { data, error } = await serviceSupabase
    .from('employees')
    .insert({ client_id: clientRecord.id, name, hourly_rate: parseFloat(hourly_rate) })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
