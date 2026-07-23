import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'

export const dynamic = 'force-dynamic'

const VALID_CATEGORIES = ['boucherie', 'charcuterie', 'traiteur', 'frais_divers']
const VALID_PERIODICITY = ['weekly', 'monthly', 'quarterly', 'semester', 'annual']

const isDate = (s: any) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const num = (n: any, d = 0) => { const v = parseFloat(String(n)); return Number.isFinite(v) ? v : d }

// GET → { charges: [...], actuals: [...] } pour le client courant
export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const svc = createServiceClient()
  const clientId = await resolveClientId(svc, user.id, user.email)
  if (!clientId) return NextResponse.json({ charges: [], actuals: [] })

  const { data: charges } = await svc
    .from('recurring_charges')
    .select('id, label, category, amount_ht, tva_rate, periodicity, start_date, end_date, active, notes')
    .eq('client_id', clientId)
    .order('label', { ascending: true })

  const { data: actuals } = await svc
    .from('recurring_actuals')
    .select('id, recurring_charge_id, period_start, period_end, amount_ht, tva_rate, invoice_number, invoice_date, notes')
    .eq('client_id', clientId)
    .order('period_start', { ascending: false })

  return NextResponse.json({ charges: charges || [], actuals: actuals || [] })
}

// POST → crée une charge récurrente
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const svc = createServiceClient()
  const clientId = await resolveClientId(svc, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 400 })

  const b = await req.json().catch(() => null)
  if (!b) return NextResponse.json({ error: 'Format invalide' }, { status: 400 })

  const label = String(b.label || '').trim()
  if (!label) return NextResponse.json({ error: 'Libellé requis' }, { status: 400 })
  if (!isDate(b.start_date)) return NextResponse.json({ error: 'Date de début requise' }, { status: 400 })

  const row = {
    client_id: clientId,
    label,
    category: VALID_CATEGORIES.includes(b.category) ? b.category : 'frais_divers',
    amount_ht: num(b.amount_ht),
    tva_rate: num(b.tva_rate, 20),
    periodicity: VALID_PERIODICITY.includes(b.periodicity) ? b.periodicity : 'monthly',
    start_date: b.start_date,
    end_date: isDate(b.end_date) ? b.end_date : null,
    active: b.active === undefined ? true : !!b.active,
    notes: b.notes ? String(b.notes) : null,
  }

  const { data, error } = await svc.from('recurring_charges').insert(row).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH → met à jour une charge (partiel). body.id requis.
export async function PATCH(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const svc = createServiceClient()
  const clientId = await resolveClientId(svc, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 400 })

  const b = await req.json().catch(() => null)
  const id = String(b?.id || '')
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  const patch: Record<string, any> = { updated_at: new Date().toISOString() }
  if (b.label !== undefined) { const l = String(b.label).trim(); if (l) patch.label = l }
  if (b.category !== undefined && VALID_CATEGORIES.includes(b.category)) patch.category = b.category
  if (b.amount_ht !== undefined) patch.amount_ht = num(b.amount_ht)
  if (b.tva_rate !== undefined) patch.tva_rate = num(b.tva_rate, 20)
  if (b.periodicity !== undefined && VALID_PERIODICITY.includes(b.periodicity)) patch.periodicity = b.periodicity
  if (b.start_date !== undefined && isDate(b.start_date)) patch.start_date = b.start_date
  if (b.end_date !== undefined) patch.end_date = isDate(b.end_date) ? b.end_date : null
  if (b.active !== undefined) patch.active = !!b.active
  if (b.notes !== undefined) patch.notes = b.notes ? String(b.notes) : null

  const { data, error } = await svc
    .from('recurring_charges')
    .update(patch)
    .eq('id', id)
    .eq('client_id', clientId)   // cloisonnement : on ne modifie que ses propres charges
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE → supprime une charge (et ses réels via cascade). ?id=...
export async function DELETE(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const svc = createServiceClient()
  const clientId = await resolveClientId(svc, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 400 })

  const id = new URL(req.url).searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  const { error } = await svc.from('recurring_charges').delete().eq('id', id).eq('client_id', clientId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}