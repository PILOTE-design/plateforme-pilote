import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

async function resolveClientId(serviceSupabase: any, userId: string, userEmail?: string | null) {
  const { data: byId } = await serviceSupabase.from('clients').select('id').eq('client_user_id', userId).maybeSingle()
  if (byId) return byId.id
  if (!userEmail) return null
  const { data: byEmail } = await serviceSupabase.from('clients').select('id').eq('email', userEmail).maybeSingle()
  if (!byEmail) return null
  await serviceSupabase.from('clients').update({ client_user_id: userId }).eq('id', byEmail.id)
  return byEmail.id
}

export async function GET(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const week = searchParams.get('week')
  const year = searchParams.get('year')

  const serviceSupabase = createServiceClient()
  const clientId = await resolveClientId(serviceSupabase, user.id, user.email)
  if (!clientId) return NextResponse.json([])

  let query = serviceSupabase.from('invoices').select('*').eq('client_id', clientId)
  if (week) query = query.eq('week_number', parseInt(week))
  if (year) query = query.eq('year', parseInt(year))
  query = query.order('invoice_date', { ascending: false })

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const serviceSupabase = createServiceClient()
  const clientId = await resolveClientId(serviceSupabase, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const body = await request.json()
  const { supplier_name, invoice_number, invoice_date, category = 'autre', amount_ht, tva_rate = 20, notes, week_number, year } = body

  if (!supplier_name || !invoice_date || amount_ht === undefined || !week_number || !year) {
    return NextResponse.json({ error: 'Champs manquants' }, { status: 400 })
  }

  const amount_ttc = parseFloat((parseFloat(amount_ht) * (1 + parseFloat(tva_rate) / 100)).toFixed(2))

  const { data, error } = await serviceSupabase
    .from('invoices')
    .insert({ client_id: clientId, supplier_name, invoice_number, invoice_date, category, amount_ht: parseFloat(amount_ht), tva_rate: parseFloat(tva_rate), amount_ttc, notes, week_number: parseInt(week_number), year: parseInt(year) })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
