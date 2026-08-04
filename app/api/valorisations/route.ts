import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'

// Les valorisations étaient la SEULE table métier rattachée à `profile_id`,
// alors que clients, articles, articles génériques et recettes le sont à
// `client_id`. Depuis que la découpe alimente la mercuriale (lot 53), l'écart
// n'est plus tenable : deux logins d'une même boucherie doivent voir la même
// carcasse, sinon un morceau chiffré chez l'un serait sans prix chez l'autre.
//
// On écrit donc les DEUX. `profile_id` reste renseigné (il porte les prix de
// référence et les préférences d'écran, et l'historique en dépend) ; `client_id`
// devient la clé de lecture, avec repli sur `profile_id` pour les lignes
// antérieures — la reprise du lot 53 les a toutes rattachées, le repli n'est là
// que par prudence.

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)

  if (clientId) {
    const { data, error } = await service
      .from('valorisations')
      .select('*')
      .eq('client_id', clientId)
      .order('purchase_date', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    // Une boucherie qui n'a encore rien enregistré SOUS son client_id peut
    // avoir des lignes plus anciennes sous le profil : on ne les perd pas.
    if ((data ?? []).length > 0) return NextResponse.json(data ?? [])
  }

  const { data, error } = await supabase
    .from('valorisations')
    .select('*')
    .eq('profile_id', user.id)
    .order('purchase_date', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const body = await req.json()

  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)

  // `client_id` n'est jamais accepté du corps de la requête : il est résolu ici,
  // côté serveur, depuis le compte connecté. C'est la barrière qui empêche une
  // carcasse d'atterrir dans la mercuriale d'une autre boucherie.
  const champs = { ...(body ?? {}) } as Record<string, unknown>
  delete champs.client_id
  delete champs.profile_id

  const { data, error } = await supabase
    .from('valorisations')
    .insert({ ...champs, profile_id: user.id, ...(clientId ? { client_id: clientId } : {}) })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
