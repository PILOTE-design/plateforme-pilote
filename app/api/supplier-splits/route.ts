import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { normalizeSupplierName } from '@/lib/supplier-memory'

export const dynamic = 'force-dynamic'

// Extrait le nom de SOCIÉTÉ d'un libellé fournisseur : « Facture X - 6109622F… » → « X ».
// Permet de regrouper toutes les factures d'une même société sous une seule règle.
function supplierSociete(raw: string): string {
  let s = String(raw || '').trim()
  s = s.replace(/^factures?\s+/i, '')       // préfixe « Facture »/« Factures »
  s = s.split(/\s+[-–—]\s+/)[0]             // avant le 1er « - » (n° de facture)
  return s.trim()
}
const societeKey = (raw: string) => normalizeSupplierName(supplierSociete(raw))

// Rayon dominant → catégorie d'achat des factures de la société
const RAYON_TO_CATEGORY: Record<string, string> = {
  boucherie: 'boucherie', charcuterie: 'charcuterie', traiteur: 'traiteur',
  fruits_et_legumes: 'frais_divers', divers: 'frais_divers',
}
type Pcts = { pct_boucherie: number; pct_charcuterie: number; pct_traiteur: number; pct_fruits_et_legumes: number; pct_divers: number }
function categoryFromPcts(p: Pcts): string | null {
  const entries: Array<[string, number]> = [
    ['boucherie', p.pct_boucherie], ['charcuterie', p.pct_charcuterie], ['traiteur', p.pct_traiteur],
    ['fruits_et_legumes', p.pct_fruits_et_legumes], ['divers', p.pct_divers],
  ]
  const top = entries.sort((a, b) => b[1] - a[1])[0]
  if (!top || top[1] <= 0) return null
  return RAYON_TO_CATEGORY[top[0]] ?? null
}
const anyPct = (p: Pcts) => p.pct_boucherie || p.pct_charcuterie || p.pct_traiteur || p.pct_fruits_et_legumes || p.pct_divers

// Recatégorise toutes les factures d'une société (par clé société) vers `category`
async function retagInvoices(svc: ReturnType<typeof createServiceClient>, clientId: string, rows: Array<{ key: string; category: string }>) {
  if (rows.length === 0) return
  const { data } = await svc.from('invoices').select('id, supplier_name').eq('client_id', clientId)
  const byKey = new Map(rows.map(r => [r.key, r.category]))
  const updates = new Map<string, string[]>() // category → invoice ids
  for (const inv of data || []) {
    const cat = byKey.get(societeKey(inv.supplier_name))
    if (!cat) continue
    if (!updates.has(cat)) updates.set(cat, [])
    updates.get(cat)!.push(inv.id)
  }
  for (const [cat, ids] of updates) {
    if (ids.length) await svc.from('invoices').update({ category: cat }).in('id', ids)
  }
}

// Répartition (%) des achats par rayon (boucherie / charcuterie / traiteur / fruits & légumes / divers),
// fournisseur par fournisseur. Le « divers » est redistribué au prorata du CA côté résumé.
// GET → { splits: [...], suppliers: [{ key, name }] }
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
    .select('supplier_key, supplier_label, pct_boucherie, pct_charcuterie, pct_traiteur, pct_fruits_et_legumes, pct_divers')
    .eq('client_id', clientId)

  const { data: invRows } = await svc
    .from('invoices')
    .select('supplier_name, invoice_date')
    .eq('client_id', clientId)
    .order('invoice_date', { ascending: false })

  // Sociétés distinctes (une seule ligne par société, sans n° de facture), triées par nom
  const seen = new Map<string, string>()
  for (const r of invRows || []) {
    const soc = supplierSociete(r.supplier_name)
    const key = normalizeSupplierName(soc)
    if (key && !seen.has(key)) seen.set(key, soc)
  }
  const suppliers = Array.from(seen.entries())
    .map(([key, name]) => ({ key, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))

  return NextResponse.json({
    splits: (splitRows || []).map((s: any) => ({
      supplier_key: s.supplier_key,
      supplier_label: s.supplier_label,
      pct_boucherie: Number(s.pct_boucherie) || 0,
      pct_charcuterie: Number(s.pct_charcuterie) || 0,
      pct_traiteur: Number(s.pct_traiteur) || 0,
      pct_fruits_et_legumes: Number(s.pct_fruits_et_legumes) || 0,
      pct_divers: Number(s.pct_divers) || 0,
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
      supplier_key: societeKey(r.supplier_key || r.supplier_label || ''),
      supplier_label: supplierSociete(r.supplier_label || r.supplier_key || '') || null,
      pct_boucherie: clamp(r.pct_boucherie),
      pct_charcuterie: clamp(r.pct_charcuterie),
      pct_traiteur: clamp(r.pct_traiteur),
      pct_fruits_et_legumes: clamp(r.pct_fruits_et_legumes),
      pct_divers: clamp(r.pct_divers),
      updated_at: new Date().toISOString(),
    }))
    .filter((r: any) => {
      if (!r.supplier_key || seen.has(r.supplier_key)) return false
      if (!anyPct(r)) return false
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
  // Recatégorise les factures des sociétés concernées selon leur rayon dominant
  const retag = rows
    .map(r => ({ key: r.supplier_key, category: categoryFromPcts(r) }))
    .filter((r): r is { key: string; category: string } => !!r.category)
  await retagInvoices(svc, clientId, retag)
  return NextResponse.json({ ok: true, count: rows.length })
}

// POST → upsert d'UNE seule société (sans toucher aux autres). Utilisé à la saisie d'une facture.
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const svc = createServiceClient()
  const clientId = await resolveClientId(svc, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 400 })

  const body = await req.json().catch(() => null)
  const s = body?.split
  if (!s) return NextResponse.json({ error: 'Format invalide' }, { status: 400 })

  const key = societeKey(s.supplier_key || s.supplier_label || '')
  if (!key) return NextResponse.json({ error: 'Société manquante' }, { status: 400 })

  const clamp = (n: any) => { const v = parseFloat(String(n)); return isNaN(v) ? 0 : Math.min(100, Math.max(0, v)) }
  const pcts: Pcts = {
    pct_boucherie: clamp(s.pct_boucherie),
    pct_charcuterie: clamp(s.pct_charcuterie),
    pct_traiteur: clamp(s.pct_traiteur),
    pct_fruits_et_legumes: clamp(s.pct_fruits_et_legumes),
    pct_divers: clamp(s.pct_divers),
  }

  // Tout à zéro → on retire la règle de cette société
  if (!anyPct(pcts)) {
    const { error } = await svc.from('supplier_rayon_splits').delete().eq('client_id', clientId).eq('supplier_key', key)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, removed: true })
  }

  const { error } = await svc.from('supplier_rayon_splits').upsert({
    client_id: clientId,
    supplier_key: key,
    supplier_label: supplierSociete(s.supplier_label || s.supplier_key || '') || null,
    ...pcts,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'client_id,supplier_key' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Recatégorise les factures existantes de cette société selon son rayon dominant
  const cat = categoryFromPcts(pcts)
  if (cat) await retagInvoices(svc, clientId, [{ key, category: cat }])

  return NextResponse.json({ ok: true })
}
