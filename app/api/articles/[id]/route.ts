// Réf fournisseur — association / dissociation à un article générique.
// conversion_factor : combien d'unités de base du générique vaut UNE unité
// facturée de cette réf (« 1 rouleau = 4,5 kg » → 4.5). NULL = 1 (mêmes unités).
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'

export const dynamic = 'force-dynamic'

async function authClient() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Non authentifié' }, { status: 401 }) }
  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return { error: NextResponse.json({ error: 'Client introuvable' }, { status: 404 }) }
  return { service, clientId }
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authClient()
  if ('error' in auth) return auth.error
  const { service, clientId } = auth

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
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
  return NextResponse.json({ success: true })
}
