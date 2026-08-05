import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { normalizeSupplierName, supplierSociete, societeKey } from '@/lib/supplier-memory'
import { ensureMarginFamilies, type MarginFamily } from '@/lib/margin-families'
import {
  colonnesDepuisParts, familleDominante, partsDepuisColonnes, partsNormalisees,
  type PartsParFamille,
} from '@/lib/supplier-parts'

export const dynamic = 'force-dynamic'

// Rayon dominant → catégorie d'achat des factures de la société
const RAYON_TO_CATEGORY: Record<string, string> = {
  boucherie: 'boucherie', charcuterie: 'charcuterie', traiteur: 'traiteur', divers: 'frais_divers',
}
// pct_fruits_et_legumes n'est plus saisie : la colonne survit pour l'historique et
// tout reliquat est replié dans « divers » à la lecture comme à l'écriture.
/** La catégorie d'achat des factures d'une société : celle de la famille qui
 *  pèse le plus lourd dans sa répartition.
 *
 *  Les catégories de facture, elles, restent au nombre de quatre — c'est un
 *  autre axe, celui du plan comptable de l'écran Facturation, et l'élargir
 *  serait un autre lot. Une famille qui n'est ni boucherie, ni charcuterie,
 *  ni traiteur donne donc « frais_divers ». */
function categorieDominante(parts: PartsParFamille, familles: MarginFamily[]): string | null {
  const f = familleDominante(parts, familles)
  if (!f) return null
  const parIds = new Map(familles.map(x => [String(x.id), x]))
  let racine = f
  for (let i = 0; i < 8 && racine.parent_id; i++) {
    const p = parIds.get(String(racine.parent_id))
    if (!p) break
    racine = p
  }
  const k = String(racine.name_key || '').toLowerCase()
  if (k.startsWith('boucherie')) return RAYON_TO_CATEGORY.boucherie
  if (k.startsWith('charcuterie')) return RAYON_TO_CATEGORY.charcuterie
  if (k.startsWith('traiteur')) return RAYON_TO_CATEGORY.traiteur
  return RAYON_TO_CATEGORY.divers
}

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
  // Cloisonnement redondant à l'écriture (les ids sont déjà lus filtrés par
  // client, mais on refiltre pour que l'invariant tienne — garde-fou lot A).
  for (const [cat, ids] of updates) {
    if (ids.length) await svc.from('invoices').update({ category: cat }).eq('client_id', clientId).in('id', ids)
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

  // LES FAMILLES DE LA BOUTIQUE — les mêmes que celles du CA.
  // `ensureMarginFamilies` sème la nomenclature par défaut si la boutique
  // n'en a pas encore : l'écran de répartition ne peut pas se retrouver sans
  // aucune case à cocher.
  const familles = await ensureMarginFamilies(svc, clientId).catch(() => [] as MarginFamily[])

  const { data: splitRows } = await svc
    .from('supplier_rayon_splits')
    .select('supplier_key, supplier_label, parts, pct_boucherie, pct_charcuterie, pct_traiteur, pct_fruits_et_legumes, pct_divers')
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
    splits: (splitRows || []).map((s: any) => {
      // Une société répartie AVANT ce lot n'a pas de `parts` : ses quatre
      // colonnes sont reprises sur les familles racines correspondantes. La
      // reprise est faite à la LECTURE, jamais par une migration de données —
      // les familles appartiennent au boucher, il peut les avoir renommées
      // depuis, et une part posée sur la mauvaise famille serait pire qu'une
      // case vide qu'il voit et remplit.
      const parts = s.parts && typeof s.parts === 'object'
        ? partsNormalisees(s.parts, familles)
        : partsDepuisColonnes(s, familles)
      return {
        supplier_key: s.supplier_key,
        supplier_label: s.supplier_label,
        parts,
        // Les quatre colonnes restent renvoyées : deux écrans les lisent encore.
        ...colonnesDepuisParts(parts, familles),
      }
    }),
    suppliers,
    familles: familles.map(f => ({
      id: f.id, parent_id: f.parent_id, name: f.name, position: f.position, is_rachat: f.is_rachat,
    })),
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

  const familles = await ensureMarginFamilies(svc, clientId).catch(() => [] as MarginFamily[])
  const seen = new Set<string>()
  const rows = rowsIn
    .map((r: any) => {
      // `parts` fait foi. Un client qui n'enverrait que les quatre colonnes
      // historiques reste servi : ses pourcentages sont reposés sur les
      // familles racines correspondantes.
      const parts: PartsParFamille = r.parts && typeof r.parts === 'object'
        ? partsNormalisees(r.parts, familles)
        : partsDepuisColonnes(r, familles)
      return {
        client_id: clientId,
        supplier_key: societeKey(r.supplier_key || r.supplier_label || ''),
        supplier_label: supplierSociete(r.supplier_label || r.supplier_key || '') || null,
        parts,
        // Les quatre colonnes sont DÉRIVÉES et toujours écrites : le moteur
        // hebdomadaire et l'écran des marges les lisent encore.
        ...colonnesDepuisParts(parts, familles),
        updated_at: new Date().toISOString(),
      }
    })
    .filter((r: any) => {
      if (!r.supplier_key || seen.has(r.supplier_key)) return false
      if (Object.keys(r.parts).length === 0) return false
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
    .map((r: any) => ({ key: r.supplier_key as string, category: categorieDominante(r.parts, familles) }))
    .filter((r: { key: string; category: string | null }): r is { key: string; category: string } => !!r.category)
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

  const familles = await ensureMarginFamilies(svc, clientId).catch(() => [] as MarginFamily[])
  const parts: PartsParFamille = s.parts && typeof s.parts === 'object'
    ? partsNormalisees(s.parts, familles)
    : partsDepuisColonnes(s, familles)
  const pcts = colonnesDepuisParts(parts, familles)

  // Tout à zéro → on retire la règle de cette société
  if (Object.keys(parts).length === 0) {
    const { error } = await svc.from('supplier_rayon_splits').delete().eq('client_id', clientId).eq('supplier_key', key)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, removed: true })
  }

  const { error } = await svc.from('supplier_rayon_splits').upsert({
    client_id: clientId,
    supplier_key: key,
    supplier_label: supplierSociete(s.supplier_label || s.supplier_key || '') || null,
    parts,
    ...pcts,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'client_id,supplier_key' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Recatégorise les factures existantes de cette société selon son rayon dominant
  const cat = categorieDominante(parts, familles)
  if (cat) await retagInvoices(svc, clientId, [{ key, category: cat }])

  return NextResponse.json({ ok: true })
}
