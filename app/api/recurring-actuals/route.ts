import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'

export const dynamic = 'force-dynamic'

const isDate = (s: any) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const num = (n: any, d = 0) => { const v = parseFloat(String(n)); return Number.isFinite(v) ? v : d }

// POST → enregistre un RÉEL pour une charge récurrente. Il remplace la provision
// sur sa fenêtre exacte [period_start, period_end] (recalcul rétroactif au jour près).
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const svc = createServiceClient()
  const clientId = await resolveClientId(svc, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 400 })

  const b = await req.json().catch(() => null)
  if (!b) return NextResponse.json({ error: 'Format invalide' }, { status: 400 })

  const rcId = String(b.recurring_charge_id || '')
  if (!rcId) return NextResponse.json({ error: 'Charge liée requise' }, { status: 400 })
  if (!isDate(b.period_start) || !isDate(b.period_end)) return NextResponse.json({ error: 'Période requise' }, { status: 400 })
  if (b.period_end < b.period_start) return NextResponse.json({ error: 'Fin avant début' }, { status: 400 })

  // Vérifie que la charge appartient bien au client
  const { data: charge } = await svc
    .from('recurring_charges').select('id').eq('id', rcId).eq('client_id', clientId).maybeSingle()
  if (!charge) return NextResponse.json({ error: 'Charge introuvable' }, { status: 404 })

  const row = {
    client_id: clientId,
    recurring_charge_id: rcId,
    period_start: b.period_start,
    period_end: b.period_end,
    amount_ht: num(b.amount_ht),
    tva_rate: num(b.tva_rate, 20),
    invoice_number: b.invoice_number ? String(b.invoice_number) : null,
    invoice_date: isDate(b.invoice_date) ? b.invoice_date : null,
    notes: b.notes ? String(b.notes) : null,
  }

  const { data, error } = await svc.from('recurring_actuals').insert(row).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE → retire un réel (les semaines de sa fenêtre reviennent à la provision). ?id=...
export async function DELETE(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const svc = createServiceClient()
  const clientId = await resolveClientId(svc, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 400 })

  const id = new URL(req.url).searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  const { error } = await svc.from('recurring_actuals').delete().eq('id', id).eq('client_id', clientId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}