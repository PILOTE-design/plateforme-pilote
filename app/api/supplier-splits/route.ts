import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { normalizeSupplierName } from '@/lib/supplier-memory'

export const dynamic = 'force-dynamic'

// Répartition (%) des achats par rayon, fournisseur par fournisseur.
// GET → { splits: [...], suppliers: [{ key, name }] }  (fournisseurs connus depuis les factures)
// PUT → { splits: [...] }  remplace l'intégralité des règles du client

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const svc = createServiceClient()
  const clientId = await resolveClientId(svc, user.id, user.email)
  if (!clientId) return NextResponse.json({ splits: [], suppliers: [] })

  const { data: splitRows } = await svc
    .from('supplier_rayon_splits')
    .select('supplier_key, supplier_label, pct_boucherie, pct_charcuterie, pct_traiteur, pct_vente')
    .eq('client_id', clientId)

  const { data: invRows } = await svc
    .from('invoices')
    .select('supplier_name, invoice_date')
    .eq('client_id', clientId)
    .order('invoice_date', { ascending: false })

  // Fournisseurs distincts (clé normalisée), libellé = occurrence la plus récente
  const seen = new Map<string, string>()
  for (const r of invRows || []) {
    const key = normalizeSupplierName(r.supplier_name)
    if (key && !seen.has(key)) seen.set(key, String(r.supplier_name || '').trim())
  }
  const suppliers = Array.from(seen.entries()).map(([key, name]) => ({ key, name }))

  return NextResponse.json({
    splits: (splitRows || []).map((s: any) => ({
      supplier_key: s.supplier_key,
      supplier_label: s.supplier_label,
      pct_boucherie: Number(s.pct_boucherie) || 0,
      pct_charcuterie: Number(s.pct_charcuterie) || 0,
      pct_traiteur: Number(s.pct_traiteur) || 0,
      pct_vente: Number(s.pct_vente) || 0,
    })),
    suppliers,
  })
}

export async function PUT(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const svc = createServiceClient()
  const clientId = await resolveClientId(svc, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 400 })

  const body = await req.json().catch(() => null)
  const rowsIn = Array.isArray(body?.splits) ? body.splits : null
  if (!rowsIn) return NextResponse.json({ error: 'Format invalide' }, { status: 400 })

  const clamp = (n: any) => { const v = parseFloat(String(n)); return isNaN(v) ? 0 : Math.min(100, Math.max(0, v)) }
  const seen = new Set<string>()
  const rows = rowsIn
    .map((r: any) => ({
      client_id: clientId,
      supplier_key: normalizeSupplierName(r.supplier_key || r.supplier_label || ''),
      supplier_label: String(r.supplier_label || r.supplier_key || '').trim() || null,
      pct_boucherie: clamp(r.pct_boucherie),
      pct_charcuterie: clamp(r.pct_charcuterie),
      pct_traiteur: clamp(r.pct_traiteur),
      pct_vente: clamp(r.pct_vente),
      updated_at: new Date().toISOString(),
    }))
    .filter((r: any) => {
      if (!r.supplier_key || seen.has(r.supplier_key)) return false
      if (!(r.pct_boucherie || r.pct_charcuterie || r.pct_traiteur || r.pct_vente)) return false
      seen.add(r.supplier_key)
      return true
    })

  // Remplacement complet du jeu de règles du client
  const { error: delErr } = await svc.from('supplier_rayon_splits').delete().eq('client_id', clientId)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  if (rows.length > 0) {
    const { error: insErr } = await svc.from('supplier_rayon_splits').insert(rows)
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, count: rows.length })
}
