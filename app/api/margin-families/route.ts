// Référentiel de familles de marge — lecture (avec semis à la première
// lecture) et création d'une famille ou sous-famille personnalisée.
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { ensureMarginFamilies, stemsFromName } from '@/lib/margin-families'
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
  const families = await ensureMarginFamilies(auth.service, auth.clientId)
  return NextResponse.json({ families })
}

export async function POST(request: NextRequest) {
  const auth = await authClient()
  if ('error' in auth) return auth.error
  const { service, clientId } = auth

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 60) return NextResponse.json({ error: 'Nom invalide' }, { status: 400 })
  // 'vente' (marges/ventilation) par défaut ; 'charge' = famille de charges fixes
  const kind = body.kind === 'charge' ? 'charge' : 'vente'

  let parent_id: string | null = null
  if (typeof body.parent_id === 'string' && body.parent_id) {
    const { data: parent } = await service.from('margin_families')
      .select('id').eq('id', body.parent_id).eq('client_id', clientId).eq('active', true)
      .is('parent_id', null).maybeSingle()
    if (!parent) return NextResponse.json({ error: 'Famille parente introuvable (un seul niveau de sous-familles)' }, { status: 400 })
    parent_id = parent.id
  }

  const lo = body.benchmark_lo != null && body.benchmark_lo !== '' ? Number(body.benchmark_lo) : null
  const hi = body.benchmark_hi != null && body.benchmark_hi !== '' ? Number(body.benchmark_hi) : null
  if ((lo !== null && (!Number.isFinite(lo) || lo < 0 || lo > 100)) || (hi !== null && (!Number.isFinite(hi) || hi < 0 || hi > 100))) {
    return NextResponse.json({ error: 'Repère invalide (0 à 100 %)' }, { status: 400 })
  }

  const { data: maxRow } = await service.from('margin_families')
    .select('position').eq('client_id', clientId).order('position', { ascending: false }).limit(1).maybeSingle()

  const { data, error } = await service.from('margin_families')
    .insert({
      client_id: clientId, parent_id, name, name_key: normText(name),
      match_stems: stemsFromName(name), is_rachat: false, kind,
      benchmark_lo: lo, benchmark_hi: hi,
      position: (Number(maxRow?.position) || 0) + 1,
    })
    .select('id').single()
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Création impossible' }, { status: 500 })
  return NextResponse.json({ success: true, id: data.id })
}
