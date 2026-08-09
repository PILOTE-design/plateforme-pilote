// app/api/recipes/[id]/infos/route.ts — CONSERVATION ET ALLERGÈNES. Lot 125.
//
// Route dédiée, comme l'archivage (lot 123) : le PUT de la fiche est le chemin
// d'édition complet, avec sa validation de nom, ses ingrédients et son format
// par défaut. Exiger tout ça pour changer « 2 °C » en « 3 °C » obligerait
// l'écran à renvoyer la fiche entière — et un champ oublié au passage serait
// remis à zéro en silence. C'est la leçon `loss_pct` du lot 48 : chaque écran
// n'envoie QUE ce qu'il édite, et ce qui n'est pas envoyé ne bouge pas.
//
// Les trois champs suivent cette règle à la lettre : ABSENT = INCHANGÉ,
// `null` = effacé volontairement. Les allergènes passent par `parseAllergenes`
// — identifiants de l'annexe II seulement, dédoublonnés, ordonnés ; un intrus
// est écarté, jamais rangé.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { parseAllergenes } from '@/lib/allergenes'

export const dynamic = 'force-dynamic'

/** Mêmes bornes que la contrainte CHECK de la base — écrites ici pour rendre
 *  un message en français plutôt qu'une erreur Postgres. */
const TEMP_MIN = -40
const TEMP_MAX = 40
const JOURS_MAX = 365

function nombreOuNull(v: unknown): number | null {
  if (v === null) return null
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v)
  return Number.isFinite(n) ? n : null
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const { data: fiche } = await service.from('recipes')
    .select('id').eq('id', params.id).eq('client_id', clientId).eq('active', true)
    .maybeSingle()
  if (!fiche) return NextResponse.json({ error: 'Recette introuvable' }, { status: 404 })

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Corps JSON attendu' }, { status: 400 })

  const patch: Record<string, unknown> = {}

  if ('storage_temp_c' in body) {
    const t = nombreOuNull(body.storage_temp_c)
    if (body.storage_temp_c !== null && t === null) {
      return NextResponse.json({ error: 'Température illisible.' }, { status: 400 })
    }
    if (t !== null && (t < TEMP_MIN || t > TEMP_MAX)) {
      return NextResponse.json({ error: `Une température de conservation se situe entre ${TEMP_MIN} et ${TEMP_MAX} °C.` }, { status: 400 })
    }
    patch.storage_temp_c = t
  }

  if ('storage_days' in body) {
    const j = nombreOuNull(body.storage_days)
    if (body.storage_days !== null && j === null) {
      return NextResponse.json({ error: 'Durée illisible.' }, { status: 400 })
    }
    if (j !== null && (j < 0 || j > JOURS_MAX || !Number.isInteger(j))) {
      return NextResponse.json({ error: `Une durée de conservation s’écrit en jours entiers, entre 0 et ${JOURS_MAX}.` }, { status: 400 })
    }
    patch.storage_days = j
  }

  if ('allergens' in body) {
    // `parseAllergenes` écarte les intrus sans bruit : cette route reçoit les
    // cases cochées de notre propre écran, un identifiant inconnu est un débris
    // de transport, pas une information.
    patch.allergens = parseAllergenes(body.allergens)
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Rien à modifier : envoyez storage_temp_c, storage_days ou allergens.' }, { status: 400 })
  }

  patch.updated_at = new Date().toISOString()
  const { error } = await service.from('recipes')
    .update(patch).eq('id', params.id).eq('client_id', clientId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, ...patch })
}
