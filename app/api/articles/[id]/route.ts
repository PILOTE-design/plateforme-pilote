// Réf fournisseur — association / dissociation à un article générique.
// conversion_factor : combien d'unités de base du générique vaut UNE unité
// facturée de cette réf (« 1 rouleau = 4,5 kg » → 4.5). NULL = 1 (mêmes unités).
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { isAdminEmail } from '@/lib/admins'
import { nourrirDictionnaire } from '@/lib/association-dictionary'

export const dynamic = 'force-dynamic'

/** ENTRETIEN PAR L'ADMINISTRATEUR : un corps { client_id } désigne la fiche à
 *  servir — accepté UNIQUEMENT pour un administrateur (la session
 *  d'association des réfs se fait pour le compte des boutiques). Pour tout
 *  autre compte, c'est un refus net, jamais un repli. */
async function authClient(ficheDemandee: string | null) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Non authentifié' }, { status: 401 }) }
  const service = createServiceClient()
  let clientId: string | null
  if (ficheDemandee) {
    if (!isAdminEmail(user.email)) return { error: NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 }) }
    clientId = ficheDemandee
  } else {
    clientId = await resolveClientId(service, user.id, user.email)
  }
  if (!clientId) return { error: NextResponse.json({ error: 'Client introuvable' }, { status: 404 }) }
  return { service, clientId }
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const auth = await authClient(typeof body.client_id === 'string' && body.client_id ? String(body.client_id) : null)
  if ('error' in auth) return auth.error
  const { service, clientId } = auth

  // Prix BLOQUÉ (lot 43, modèle Otami) : le prix négocié avec le fournisseur,
  // verrouillé sur la réf. blocked_at date le verrou — seules les factures
  // POSTÉRIEURES peuvent le dépasser. null = déverrouiller (surveillance levée).
  if ('blocked_price_ht' in body && !('generic_id' in body)) {
    let blocked: number | null = null
    if (body.blocked_price_ht !== null && body.blocked_price_ht !== '') {
      const v = Number(body.blocked_price_ht)
      if (!Number.isFinite(v) || v <= 0 || v > 100000) return NextResponse.json({ error: 'Prix bloqué invalide' }, { status: 400 })
      blocked = Math.round(v * 10000) / 10000
    }
    const { error } = await service.from('articles')
      .update({ blocked_price_ht: blocked, blocked_at: blocked !== null ? new Date().toISOString() : null })
      .eq('id', params.id).eq('client_id', clientId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  // Écarter / restaurer une réf de la file « À rapprocher » sans l'associer.
  // no_auto accompagne dans les deux sens : une réf écartée puis restaurée se
  // traite à la main, l'association automatique ne la reprend jamais.
  if ('ignored' in body && !('generic_id' in body)) {
    const { error } = await service.from('articles')
      .update({ ignored: body.ignored === true, no_auto: true })
      .eq('id', params.id).eq('client_id', clientId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  if (!('generic_id' in body)) return NextResponse.json({ error: 'generic_id requis (null pour dissocier)' }, { status: 400 })

  // Dissociation : la réf retourne dans la file d'attente. no_auto empêche
  // l'association automatique de la re-rattacher dans son dos au prochain
  // affichage de la mercuriale — dissocier est un geste volontaire.
  if (body.generic_id === null) {
    const { error } = await service.from('articles')
      .update({ generic_id: null, conversion_factor: null, no_auto: true })
      .eq('id', params.id).eq('client_id', clientId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  const genericId = String(body.generic_id)
  const { data: generic, error: gErr } = await service.from('generic_articles')
    .select('id').eq('id', genericId).eq('client_id', clientId).eq('active', true).maybeSingle()
  if (gErr) return NextResponse.json({ error: gErr.message }, { status: 500 })
  if (!generic) return NextResponse.json({ error: 'Article générique introuvable' }, { status: 404 })

  let conversion_factor: number | null = null
  if (body.conversion_factor !== undefined && body.conversion_factor !== null && body.conversion_factor !== '') {
    const v = Number(body.conversion_factor)
    if (!Number.isFinite(v) || v <= 0 || v > 10000) return NextResponse.json({ error: 'Facteur de conversion invalide' }, { status: 400 })
    conversion_factor = v
  }

  const { error } = await service.from('articles')
    .update({ generic_id: genericId, conversion_factor })
    .eq('id', params.id).eq('client_id', clientId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Le geste d'association nourrit le dictionnaire plateforme (lot 28) : la
  // prochaine boutique en héritera. Jamais bloquant.
  await nourrirDictionnaire(service, clientId, genericId, [params.id])
  return NextResponse.json({ success: true })
}
