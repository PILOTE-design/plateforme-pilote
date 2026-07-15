import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const serviceSupabase = createServiceClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const week = parseInt(searchParams.get('week') || '0')
  const year = parseInt(searchParams.get('year') || '0')
  if (!week || !year) return NextResponse.json([])

  const clientId = await resolveClientId(serviceSupabase, user.id, user.email)
  if (!clientId) return NextResponse.json([])

  const { data: empList } = await serviceSupabase
    .from('employees').select('id').eq('client_id', clientId)
  if (!empList || empList.length === 0) return NextResponse.json([])

  const { data: entries } = await serviceSupabase
    .from('planning_entries')
    .select('*')
    .in('employee_id', empList.map(e => e.id))
    .eq('week_number', week)
    .eq('year', year)

  return NextResponse.json(entries || [])
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const serviceSupabase = createServiceClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const clientId = await resolveClientId(serviceSupabase, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const body = await req.json()
  const {
    employee_id, week_number, year,
    lundi, mardi, mercredi, jeudi, vendredi, samedi, dimanche,
    lundi_type, mardi_type, mercredi_type, jeudi_type, vendredi_type, samedi_type, dimanche_type,
    schedule_details,
  } = body

  // Cloisonnement : l'employé doit appartenir au client connecté
  // (sinon n'importe quel compte pourrait écrire le planning d'une autre boucherie)
  const { data: ownedEmp } = await serviceSupabase
    .from('employees')
    .select('id')
    .eq('id', employee_id)
    .eq('client_id', clientId)
    .maybeSingle()
  if (!ownedEmp) return NextResponse.json({ error: 'Employé introuvable pour ce client' }, { status: 403 })

  const { data, error } = await serviceSupabase
    .from('planning_entries')
    .upsert(
      {
        employee_id, week_number, year,
        lundi: lundi || 0, mardi: mardi || 0, mercredi: mercredi || 0,
        jeudi: jeudi || 0, vendredi: vendredi || 0, samedi: samedi || 0, dimanche: dimanche || 0,
        lundi_type:    lundi_type    || 'travail',
        mardi_type:    mardi_type    || 'travail',
        mercredi_type: mercredi_type || 'travail',
        jeudi_type:    jeudi_type    || 'travail',
        vendredi_type: vendredi_type || 'travail',
        samedi_type:   samedi_type   || 'repos',
        dimanche_type: dimanche_type || 'repos',
        schedule_details: schedule_details ?? null,
      },
      { onConflict: 'employee_id,week_number,year' }
    )
    .select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
