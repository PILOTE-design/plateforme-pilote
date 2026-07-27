// Ordre de production — modification (batchs, affectation, statut, date) et
// suppression. Un ordre est léger : il ne porte aucune donnée dérivée, tout se
// recalcule depuis la fiche recette à la lecture.
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
  const patch: Record<string, unknown> = {}

  if ('batches' in body) {
    const b = Number(body.batches)
    if (!Number.isFinite(b) || b <= 0 || b > 500) return NextResponse.json({ error: 'Nombre de batchs invalide' }, { status: 400 })
    patch.batches = b
  }
  if ('employee_id' in body) {
    patch.employee_id = typeof body.employee_id === 'string' && body.employee_id ? body.employee_id : null
  }
  if ('status' in body) {
    const s = String(body.status)
    if (!['planifie', 'fait'].includes(s)) return NextResponse.json({ error: 'Statut invalide' }, { status: 400 })
    patch.status = s
  }
  if ('production_date' in body) {
    const d = String(body.production_date)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return NextResponse.json({ error: 'Date invalide' }, { status: 400 })
    patch.production_date = d
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Aucun champ à mettre à jour' }, { status: 400 })

  const { error } = await service.from('production_orders')
    .update(patch).eq('id', params.id).eq('client_id', clientId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authClient()
  if ('error' in auth) return auth.error
  const { service, clientId } = auth

  const { error } = await service.from('production_orders')
    .delete().eq('id', params.id).eq('client_id', clientId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
