// app/api/recipes/[id]/archive/route.ts — ARCHIVER UNE FICHE, JAMAIS LA PERDRE.
// Lot 123, modèle Otami (« Passer en mode archivage » / « Recettes archivées »).
//
// ─── POURQUOI UN TROISIÈME ÉTAT ───────────────────────────────────────────
//
// La fiche connaissait deux états : vivante, ou retirée (`active = false`, le
// DELETE). Entre les deux, rien — alors que le cas le plus courant du métier
// est ENTRE les deux : la terrine d'été qu'on ne fait plus en janvier, la
// recette d'un salarié parti qu'on refera peut-être. La retirer, c'est perdre
// ses ingrédients, ses temps chronométrés, ses formats, son historique de
// coûts. La garder, c'est une liste qui s'encombre de fiches qu'on ne fabrique
// plus. D'où l'archivage :
//
//   active = true,  archived_at = NULL  → vivante, partout
//   active = true,  archived_at = date  → ARCHIVÉE : hors de la liste et des
//                                          choix d'ingrédients, restaurable en
//                                          un clic, TOUJOURS calculée
//   active = false                      → retirée (le DELETE existant)
//
// ─── LA RÈGLE QUI COMPTE : L'ARCHIVAGE NE FAUSSE JAMAIS UN COÛT ───────────
//
// Une fiche archivée peut servir de SOUS-RECETTE à une fiche vivante (la
// saumure d'hiver dans un produit d'été). Si l'archiver la sortait du moteur,
// le coût de la fiche vivante tomberait — en silence. C'est pourquoi les GET
// du moteur continuent de lire les fiches archivées (`active = true` suffit) :
// seuls la LISTE et les CHOIX d'ingrédients filtrent, côté écran.
//
// Route dédiée, volontairement PAS le PUT : le PUT est le chemin d'édition,
// avec sa validation de champs et son format par défaut. Archiver est un geste
// de cycle de vie — comme `POST /api/invoices/[id]/lecture` au lot 80.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const body = await request.json().catch(() => null) as { archive?: unknown } | null
  if (!body || typeof body.archive !== 'boolean') {
    return NextResponse.json({ error: 'Corps attendu : { archive: true | false }' }, { status: 400 })
  }

  // Cloisonnement : la fiche doit appartenir à la boutique, et être vivante —
  // on n'archive pas une fiche retirée, on ne restaure pas par cette porte.
  const { data: fiche } = await service.from('recipes')
    .select('id, name, archived_at')
    .eq('id', params.id).eq('client_id', clientId).eq('active', true)
    .maybeSingle()
  if (!fiche) return NextResponse.json({ error: 'Recette introuvable' }, { status: 404 })

  // Idempotent : archiver une fiche déjà archivée ne change pas sa date —
  // « archivée le 7 août » ne doit pas devenir « le 12 » parce qu'on a
  // recliqué. Restaurer une fiche vivante ne fait rien non plus.
  const dejaArchivee = fiche.archived_at !== null
  if (body.archive === dejaArchivee) {
    return NextResponse.json({ success: true, archived_at: fiche.archived_at, inchange: true })
  }

  const archived_at = body.archive ? new Date().toISOString() : null
  const { error } = await service.from('recipes')
    .update({ archived_at, updated_at: new Date().toISOString() })
    .eq('id', params.id).eq('client_id', clientId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, archived_at })
}
