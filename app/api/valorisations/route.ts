import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { coutsMorceauxDuClient, ensureGeneriquesDecoupe } from '@/lib/valorisation-source'

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

  // ── LA CARCASSE DEVIENT DES INGRÉDIENTS, ICI ET MAINTENANT ───────────────
  //
  // Les morceaux chiffrés reçoivent leur article générique dès l'enregistrement
  // de la découpe, et non plus seulement quand quelqu'un ouvre la liste des
  // fiches recettes.
  //
  // Le rattrapage paresseux du lot 53 n'avait qu'un seul déclencheur — cette
  // liste — et le résultat se mesure en production le 04/08 : une boucherie
  // avec 43 pièces pesées sur un bœuf à 3 090,42 € n'avait AUCUN morceau dans
  // sa mercuriale. Le boucher enregistre sa carcasse, va la chercher comme
  // ingrédient, ne la trouve pas, et rien à l'écran ne lui dit pourquoi.
  //
  // Le geste qui crée les morceaux est celui qui enregistre la découpe : c'est
  // donc là que ça se passe. Reste idempotent (les pièces déjà connues ne sont
  // pas recréées) et tolérant à l'échec — une carcasse enregistrée le reste,
  // même si le catalogue ne suit pas.
  let morceaux_crees = 0
  if (clientId) {
    try {
      const couts = await coutsMorceauxDuClient(service, clientId, user.id)
      morceaux_crees = await ensureGeneriquesDecoupe(service, clientId, couts)
    } catch (e) {
      console.error('[valorisations] création des morceaux de découpe', e)
    }
  }

  return NextResponse.json({ ...(data as Record<string, unknown>), morceaux_crees }, { status: 201 })
}
