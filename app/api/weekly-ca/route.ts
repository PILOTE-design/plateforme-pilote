import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const week = parseInt(searchParams.get('week') || '0')
  const year = parseInt(searchParams.get('year') || '0')
  if (!week || !year) return NextResponse.json({ error: 'week et year requis' }, { status: 400 })

  const serviceSupabase = createServiceClient()
  const clientId = await resolveClientId(serviceSupabase, user.id, user.email)
  if (!clientId) return NextResponse.json(null)

  const { data } = await serviceSupabase
    .from('weekly_ca')
    .select('*')
    .eq('client_id', clientId)
    .eq('week_number', week)
    .eq('year', year)
    .maybeSingle()

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
  const { week_number, year, ca_total = 0 } = body

  if (!week_number || !year) return NextResponse.json({ error: 'week_number et year requis' }, { status: 400 })

  // Seuls les champs PRÉSENTS dans la requête sont écrits : la modale ne saisit plus que le
  // total, et les détails par rayon éventuellement stockés (repli du rapport) sont préservés.
  const row: Record<string, any> = { client_id: clientId, week_number, year, ca_total, updated_at: new Date().toISOString() }
  for (const k of ['ca_boucherie', 'ca_charcuterie', 'ca_traiteur', 'ca_fruits_et_legumes', 'ca_vente']) {
    if (body[k] !== undefined) row[k] = body[k]
  }

  const { data, error } = await serviceSupabase
    .from('weekly_ca')
    .upsert(row, { onConflict: 'client_id,week_number,year' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
