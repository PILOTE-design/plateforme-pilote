import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { isoWeekOf } from '@/lib/invoice-week'
import { peutFiger, type VerrouSemaine } from '@/lib/planning-lock'

export const dynamic = 'force-dynamic'

// ─── Verrous de semaine (figer une semaine de planning) ─────────────────────
//
// Le raisonnement, les phrases et la règle « une semaine à venir ne se fige
// pas » vivent dans lib/planning-lock. Cette route ne fait que les brancher sur
// la table planning_locks, cloisonnée par client_id comme toute écriture du
// projet.

const CHAMPS = 'week_number, year, locked_at, locked_by, note'

/** Les verrous d'une année, pour le client connecté. */
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const serviceSupabase = createServiceClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const year = parseInt(searchParams.get('year') || '0')
  if (!year) return NextResponse.json([])

  const clientId = await resolveClientId(serviceSupabase, user.id, user.email)
  if (!clientId) return NextResponse.json([])

  const { data, error } = await serviceSupabase
    .from('planning_locks')
    .select(CHAMPS)
    .eq('client_id', clientId)
    .eq('year', year)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json((data || []) as VerrouSemaine[])
}

/** Figer (locked: true) ou libérer (locked: false) une semaine. */
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const serviceSupabase = createServiceClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const clientId = await resolveClientId(serviceSupabase, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const week = parseInt(String(body?.week))
  const year = parseInt(String(body?.year))
  const locked = body?.locked === true
  const note = typeof body?.note === 'string' ? body.note.trim() : ''
  if (!week || !year || week < 1 || week > 53) {
    return NextResponse.json({ error: 'Semaine invalide' }, { status: 400 })
  }

  if (!locked) {
    const { error } = await serviceSupabase
      .from('planning_locks')
      .delete()
      .eq('client_id', clientId)
      .eq('week_number', week)
      .eq('year', year)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ verrou: null })
  }

  // La semaine courante est calculée ICI, pas envoyée par le navigateur :
  // l'horloge du poste du boucher n'est pas une autorisation.
  const courante = isoWeekOf(new Date())
  if (!courante) return NextResponse.json({ error: 'Semaine courante illisible' }, { status: 500 })

  const verdict = peutFiger({ week, year }, courante)
  if (!verdict.ok) return NextResponse.json({ error: verdict.motif }, { status: 409 })

  const { data, error } = await serviceSupabase
    .from('planning_locks')
    .upsert(
      {
        client_id: clientId,
        week_number: week,
        year,
        locked_at: new Date().toISOString(),
        locked_by: user.id,
        ...(note ? { note } : {}),
      },
      { onConflict: 'client_id,week_number,year' }
    )
    .select(CHAMPS)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ verrou: data as VerrouSemaine })
}
