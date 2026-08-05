import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { doublesEmplois, phraseDoubleEmploi } from '@/lib/charges-doublon'

export const dynamic = 'force-dynamic'

/** Les factures qui comptent dans les ACHATS — celles qui peuvent doublonner
 *  avec une provision. Quatre colonnes, pas une de plus : c'est un contrôle de
 *  cohérence, pas une seconde source de chiffres. */
async function facturesEnAchats(svc: ReturnType<typeof createServiceClient>, clientId: string) {
  const { data } = await svc
    .from('invoices')
    .select('supplier_name, amount_ht, is_fixed_charge, invoice_date')
    .eq('client_id', clientId)
    .eq('is_fixed_charge', false)
  return data || []
}

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

  // `created_at` est LU ici, et ce n'est pas décoratif : c'est lui qui départage
  // deux réels de même durée qui se chevauchent (cf. `actualOn` dans
  // lib/recurring-charges). Sans lui, cet écran retombait sur l'ordre du
  // tableau là où le moteur hebdomadaire, qui le sélectionne, tranchait
  // autrement — la divergence écran/PDF que ce départage avait justement été
  // écrit pour supprimer.
  const { data: actuals } = await svc
    .from('recurring_actuals')
    .select('id, recurring_charge_id, period_start, period_end, amount_ht, tva_rate, invoice_number, invoice_date, notes, created_at')
    .eq('client_id', clientId)
    .order('period_start', { ascending: false })

  // LE MÊME FOURNISSEUR DES DEUX CÔTÉS ? (cf. lib/charges-doublon)
  //
  // Une charge récurrente s'AJOUTE aux factures du même fournisseur, elle ne
  // les remplace pas. Le contrôle est fait ici plutôt que dans l'écran pour que
  // la réponse porte la question avec elle : un écran qui devrait penser à la
  // poser finit par l'oublier.
  const doubles = doublesEmplois(charges || [], await facturesEnAchats(svc, clientId))
  const chargesVues = (charges || []).map(c => {
    const d = doubles.get(String(c.id))
    return d ? { ...c, double_emploi: { ...d, phrase: phraseDoubleEmploi(d) } } : { ...c, double_emploi: null }
  })

  return NextResponse.json({ charges: chargesVues, actuals: actuals || [] })
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

  // LE MOMENT OÙ LA QUESTION SE POSE. Une charge récurrente se crée en un clic
  // depuis une facture : c'est là, et pas trois semaines plus tard dans un
  // tableau, qu'il faut dire que ce fournisseur figure déjà dans les achats.
  // La charge est bien CRÉÉE — on n'a aucune raison de refuser, le cas
  // légitime existe (un fournisseur qui livre ET qui loue du matériel).
  const d = doublesEmplois([{ id: String(data.id), label, active: row.active }], await facturesEnAchats(svc, clientId))
    .get(String(data.id))
  return NextResponse.json({ ...data, double_emploi: d ? { ...d, phrase: phraseDoubleEmploi(d) } : null })
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
