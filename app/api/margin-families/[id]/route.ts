// Famille de marge — modification (nom, repère de marge MODIFIABLE, racines de
// reconnaissance) et suppression douce. Les sous-familles d'une famille
// supprimée disparaissent avec elle (cascade du parent_id à la lecture active).
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
    if (!name || name.length > 60) return NextResponse.json({ error: 'Nom invalide' }, { status: 400 })
    patch.name = name
    patch.name_key = normText(name)
  }
  // Repère de marge : lo/hi en %, null pour effacer. lo ≤ hi exigé si les deux.
  for (const k of ['benchmark_lo', 'benchmark_hi'] as const) {
    if (k in body) {
      if (body[k] === null || body[k] === '') { patch[k] = null; continue }
      const v = Number(body[k])
      if (!Number.isFinite(v) || v < 0 || v > 100) return NextResponse.json({ error: 'Repère invalide (0 à 100 %)' }, { status: 400 })
      patch[k] = v
    }
  }
  if (patch.benchmark_lo != null && patch.benchmark_hi != null && Number(patch.benchmark_lo) > Number(patch.benchmark_hi)) {
    return NextResponse.json({ error: 'Le repère bas doit être inférieur au repère haut' }, { status: 400 })
  }
  if ('match_stems' in body) {
    if (!Array.isArray(body.match_stems)) return NextResponse.json({ error: 'match_stems doit être une liste' }, { status: 400 })
    patch.match_stems = (body.match_stems as unknown[]).map(s => normText(s).replace(/ /g, '')).filter(s => s.length >= 2).slice(0, 20)
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Aucun champ à mettre à jour' }, { status: 400 })
  patch.updated_at = new Date().toISOString()

  const { error } = await service.from('margin_families')
    .update(patch).eq('id', params.id).eq('client_id', clientId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authClient()
  if ('error' in auth) return auth.error
  const { service, clientId } = auth

  // Douce, et les sous-familles suivent leur parent.
  const now = new Date().toISOString()
  const { error: e1 } = await service.from('margin_families')
    .update({ active: false, updated_at: now })
    .eq('parent_id', params.id).eq('client_id', clientId)
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })
  const { error: e2 } = await service.from('margin_families')
    .update({ active: false, updated_at: now })
    .eq('id', params.id).eq('client_id', clientId)
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
