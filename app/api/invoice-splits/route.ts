// Ventilation PAR FACTURE sur le référentiel de familles (margin_families).
//
// GET  ?week=&year= → { families (kind=vente), chargeFamilies (kind=charge,
//                       semées au premier passage), splits: lignes des factures
//                       de la semaine }
// PUT  { invoice_id, splits: [{ family_id, pct }] } — REMPLACE la ventilation
//      propre de la facture ; liste vide = retour à la répartition fournisseur.
// Le moteur hebdo (lib/week-economics) fait PRIMER ces lignes sur les splits
// fournisseur, sans toucher les autres factures du même fournisseur.
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { ensureMarginFamilies, ensureChargeFamilies } from '@/lib/margin-families'

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

export async function GET(request: NextRequest) {
  const auth = await authClient()
  if ('error' in auth) return auth.error
  const { service, clientId } = auth

  const url = new URL(request.url)
  const week = parseInt(url.searchParams.get('week') || '0')
  const year = parseInt(url.searchParams.get('year') || '0')

  const [families, chargeFamilies] = await Promise.all([
    ensureMarginFamilies(service, clientId),
    ensureChargeFamilies(service, clientId),
  ])

  let splits: any[] = []
  if (week > 0 && year > 0) {
    const { data: invs } = await service.from('invoices')
      .select('id').eq('client_id', clientId).eq('week_number', week).eq('year', year)
    const ids = (invs || []).map((i: any) => i.id)
    if (ids.length > 0) {
      const { data } = await service.from('invoice_family_splits')
        .select('invoice_id, family_id, pct').eq('client_id', clientId).in('invoice_id', ids)
      splits = data || []
    }
  }

  return NextResponse.json({
    families: families.map(f => ({ id: f.id, parent_id: f.parent_id, name: f.name, is_rachat: f.is_rachat })),
    chargeFamilies: chargeFamilies.map(f => ({ id: f.id, parent_id: f.parent_id, name: f.name, is_rachat: false })),
    splits,
  })
}

export async function PUT(request: NextRequest) {
  const auth = await authClient()
  if ('error' in auth) return auth.error
  const { service, clientId } = auth

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const invoiceId = typeof body.invoice_id === 'string' ? body.invoice_id : ''
  if (!invoiceId) return NextResponse.json({ error: 'invoice_id requis' }, { status: 400 })
  if (!Array.isArray(body.splits)) return NextResponse.json({ error: 'splits doit être une liste' }, { status: 400 })

  const { data: inv } = await service.from('invoices')
    .select('id').eq('id', invoiceId).eq('client_id', clientId).maybeSingle()
  if (!inv) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 })

  const rows: { family_id: string; pct: number }[] = []
  for (const s of body.splits as Record<string, unknown>[]) {
    const familyId = typeof s?.family_id === 'string' ? s.family_id : ''
    const pct = Number(s?.pct)
    if (!familyId || !Number.isFinite(pct) || pct <= 0 || pct > 100) {
      return NextResponse.json({ error: 'Ligne de ventilation invalide' }, { status: 400 })
    }
    if (!rows.some(r => r.family_id === familyId)) rows.push({ family_id: familyId, pct })
  }
  const total = rows.reduce((s, r) => s + r.pct, 0)
  if (rows.length > 0 && (total < 99.5 || total > 100.5)) {
    return NextResponse.json({ error: `Le total doit faire 100 % (actuellement ${total.toFixed(1)} %)` }, { status: 400 })
  }
  if (rows.length > 0) {
    const { data: fams } = await service.from('margin_families')
      .select('id').eq('client_id', clientId).eq('active', true).eq('kind', 'vente')
      .in('id', rows.map(r => r.family_id))
    if ((fams || []).length !== rows.length) return NextResponse.json({ error: 'Une des familles est introuvable' }, { status: 400 })
  }

  // Remplacement atomique côté logique : purge puis insertion.
  const { error: delErr } = await service.from('invoice_family_splits')
    .delete().eq('invoice_id', invoiceId).eq('client_id', clientId)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
  if (rows.length > 0) {
    const { error: insErr } = await service.from('invoice_family_splits')
      .insert(rows.map(r => ({ ...r, client_id: clientId, invoice_id: invoiceId })))
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
