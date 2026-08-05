import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { motifRefus, type VerrouSemaine } from '@/lib/planning-lock'

/** Le verrou de la semaine, s'il existe, pour ce client. */
async function verrouDeLaSemaine(
  serviceSupabase: ReturnType<typeof createServiceClient>,
  clientId: string, week: number, year: number,
): Promise<VerrouSemaine | null> {
  const { data } = await serviceSupabase
    .from('planning_locks')
    .select('week_number, year, locked_at, locked_by, note')
    .eq('client_id', clientId)
    .eq('week_number', week)
    .eq('year', year)
    .maybeSingle()
  return (data as VerrouSemaine | null) ?? null
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const serviceSupabase = createServiceClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const week = parseInt(searchParams.get('week') || '0')
  const year = parseInt(searchParams.get('year') || '0')
  if (!week || !year) return NextResponse.json({ entries: [], verrou: null })

  const clientId = await resolveClientId(serviceSupabase, user.id, user.email)
  if (!clientId) return NextResponse.json({ entries: [], verrou: null })

  // Le verrou part avec les entrées : l'écran sait dès le premier chargement
  // si la semaine affichée est figée, sans second aller-retour.
  const verrou = await verrouDeLaSemaine(serviceSupabase, clientId, week, year)

  const { data: empList } = await serviceSupabase
    .from('employees').select('id').eq('client_id', clientId)
  if (!empList || empList.length === 0) return NextResponse.json({ entries: [], verrou })

  const { data: entries } = await serviceSupabase
    .from('planning_entries')
    .select('*')
    .in('employee_id', empList.map(e => e.id))
    .eq('week_number', week)
    .eq('year', year)

  return NextResponse.json({ entries: entries || [], verrou })
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

  // LE GARDE-FOU. Cette route est le seul écrivain de planning_entries : c'est
  // donc ici, et nulle part ailleurs, que le verrou d'une semaine devient réel.
  // Un verrou qui ne vit que dans l'écran n'est pas un verrou.
  const verrou = await verrouDeLaSemaine(serviceSupabase, clientId, Number(week_number), Number(year))
  if (verrou) return NextResponse.json({ error: motifRefus(verrou) }, { status: 409 })

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
