import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { correctifFacture } from '@/lib/facture-champs'

// ─── Une facture : la corriger, la supprimer ────────────────────────────────
//
// Cette route appliquait le corps de la requête TEL QUEL (`update(body)`). Le
// raisonnement — ce qu'un navigateur a le droit de modifier, ce qui se
// recalcule, et pourquoi — vit désormais dans lib/facture-champs. Ici, on ne
// fait que le brancher.

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const serviceSupabase = createServiceClient()
  const clientId = await resolveClientId(serviceSupabase, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const body = await request.json().catch(() => null)

  // La facture telle qu'elle est en base : les champs dérivés se recalculent à
  // partir de l'état RÉSULTANT, pas du seul contenu de la requête. Corriger le
  // montant HT seul doit tout de même mettre à jour le TTC et la part
  // hebdomadaire — avec le taux et la période déjà enregistrés.
  const { data: existante } = await serviceSupabase
    .from('invoices')
    .select('amount_ht, tva_rate, period_days, is_fixed_charge')
    .eq('id', params.id)
    .eq('client_id', clientId)
    .maybeSingle()

  if (!existante) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 })

  const verdict = correctifFacture(body, existante)
  if (!verdict.ok) return NextResponse.json({ error: verdict.motif }, { status: 400 })

  const { data, error } = await serviceSupabase
    .from('invoices')
    .update(verdict.patch)
    .eq('id', params.id)
    .eq('client_id', clientId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const serviceSupabase = createServiceClient()
  const clientId = await resolveClientId(serviceSupabase, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const { error } = await serviceSupabase
    .from('invoices')
    .delete()
    .eq('id', params.id)
    .eq('client_id', clientId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
