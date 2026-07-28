// Articles génériques — le référentiel que l'utilisateur construit lui-même :
// chaque générique (« Filet de poulet ») regroupe des réfs fournisseurs
// (« FILET DE POULET SV », « FILET DE POULET LR ») et porte l'unité de base
// (kg ou pièce) sur laquelle tout est ramené. Les fiches recettes s'appuient
// sur ces génériques, jamais sur les réfs brutes.
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

export async function GET() {
  const auth = await authClient()
  if ('error' in auth) return auth.error
  const { service, clientId } = auth

  const { data, error } = await service.from('generic_articles')
    .select('id, name, base_unit, category, default_loss_pct')
    .eq('client_id', clientId).eq('active', true)
    .order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ generics: data || [] })
}

export async function POST(request: NextRequest) {
  const auth = await authClient()
  if ('error' in auth) return auth.error
  const { service, clientId } = auth

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 120) return NextResponse.json({ error: 'Nom invalide' }, { status: 400 })
  const base_unit = body.base_unit === 'piece' ? 'piece' : 'kg'
  const category = body.category === 'emballage' ? 'emballage' : 'ingredient'
  const lossRaw = Number(body.default_loss_pct ?? 0)
  const default_loss_pct = Number.isFinite(lossRaw) && lossRaw >= 0 && lossRaw < 100 ? lossRaw : 0

  const { data, error } = await service.from('generic_articles')
    .insert({ client_id: clientId, name, name_key: normText(name), base_unit, category, default_loss_pct })
    .select('id, name, base_unit, category, default_loss_pct')
    .single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Un article générique porte déjà ce nom' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ generic: data })
}
