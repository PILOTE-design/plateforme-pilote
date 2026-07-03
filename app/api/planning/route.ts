import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const serviceSupabase = createServiceClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const week = parseInt(searchParams.get('week') || '0')
  const year = parseInt(searchParams.get('year') || '0')

  if (!week || !year) return NextResponse.json([])

  const { data: clientRecord } = await serviceSupabase
    .from('clients')
    .select('id')
    .eq('client_user_id', user.id)
    .maybeSingle()

  if (!clientRecord) return NextResponse.json([])

  const { data: empList } = await serviceSupabase
    .from('employees')
    .select('id')
    .eq('client_id', clientRecord.id)

  if (!empList || empList.length === 0) return NextResponse.json([])

  const employeeIds = empList.map(e => e.id)

  const { data: entries } = await serviceSupabase
    .from('planning_entries')
    .select('*')
    .in('employee_id', employeeIds)
    .eq('week_number', week)
    .eq('year', year)

  return NextResponse.json(entries || [])
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const serviceSupabase = createServiceClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const body = await req.json()
  const { employee_id, week_number, year, lundi, mardi, mercredi, jeudi, vendredi, samedi, dimanche } = body

  const { data, error } = await serviceSupabase
    .from('planning_entries')
    .upsert(
      {
        employee_id,
        week_number,
        year,
        lundi: lundi || 0,
        mardi: mardi || 0,
        mercredi: mercredi || 0,
        jeudi: jeudi || 0,
        vendredi: vendredi || 0,
        samedi: samedi || 0,
        dimanche: dimanche || 0,
      },
      { onConflict: 'employee_id,week_number,year' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
