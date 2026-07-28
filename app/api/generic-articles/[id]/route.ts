// Article générique — modification et suppression. Supprimer un générique ne
// supprime JAMAIS les réfs fournisseurs : elles retournent simplement dans la
// file d'attente d'association (generic_id remis à NULL).
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { normText } from '@/lib/postes'

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
  const patch: Record<string, unknown> = {}

  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > 120) return NextResponse.json({ error: 'Nom invalide' }, { status: 400 })
    patch.name = name
    patch.name_key = normText(name)
  }
  if ('base_unit' in body) {
    if (!['kg', 'piece'].includes(String(body.base_unit))) return NextResponse.json({ error: 'Unité invalide' }, { status: 400 })
    patch.base_unit = body.base_unit
  }
  if ('category' in body) {
    if (!['ingredient', 'emballage'].includes(String(body.category))) return NextResponse.json({ error: 'Catégorie invalide' }, { status: 400 })
    patch.category = body.category
  }
  if ('default_loss_pct' in body) {
    const v = Number(body.default_loss_pct)
    if (!Number.isFinite(v) || v < 0 || v >= 100) return NextResponse.json({ error: 'Perte invalide (0 à 99 %)' }, { status: 400 })
    patch.default_loss_pct = v
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Aucun champ à mettre à jour' }, { status: 400 })
  patch.updated_at = new Date().toISOString()

  const { error } = await service.from('generic_articles')
    .update(patch).eq('id', params.id).eq('client_id', clientId)
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Un article générique porte déjà ce nom' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authClient()
  if ('error' in auth) return auth.error
  const { service, clientId } = auth

  // Les réfs repartent en file d'attente…
  const { error: e1 } = await service.from('articles')
    .update({ generic_id: null, conversion_factor: null })
    .eq('generic_id', params.id).eq('client_id', clientId)
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })

  // …puis le générique est désactivé (soft delete, le nom redevient libre).
  const { error: e2 } = await service.from('generic_articles')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', params.id).eq('client_id', clientId)
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
