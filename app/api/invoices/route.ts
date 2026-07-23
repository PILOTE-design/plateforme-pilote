import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { sameSupplierFamily } from '@/lib/supplier-memory'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const week  = searchParams.get('week')
  const year  = searchParams.get('year')
  const fixed = searchParams.get('fixed')
  const suppliers = searchParams.get('suppliers')

  const serviceSupabase = createServiceClient()
  const clientId = await resolveClientId(serviceSupabase, user.id, user.email)
  if (!clientId) return NextResponse.json([])

  // Mémoire fournisseur : renvoie, pour chaque fournisseur connu, la catégorie et le taux
  // de TVA les plus récents — sert au pré-remplissage auto du formulaire d'ajout d'achat.
  if (suppliers) {
    const { data: rows } = await serviceSupabase
      .from('invoices').select('supplier_name, category, tva_rate, invoice_date')
      .eq('client_id', clientId).order('invoice_date', { ascending: false })
    const map = new Map<string, { supplier_name: string; category: string; tva_rate: number | null }>()
    for (const r of rows || []) {
      const name = String(r.supplier_name || '').trim()
      const key = name.toLowerCase()
      if (key && !map.has(key)) { // trié desc → 1re occurrence = plus récente
        const tva = r.tva_rate === null || r.tva_rate === undefined ? null : parseFloat(String(r.tva_rate))
        map.set(key, { supplier_name: name, category: r.category, tva_rate: Number.isFinite(tva as number) ? tva : null })
      }
    }
    return NextResponse.json(Array.from(map.values()))
  }

  let query = serviceSupabase.from('invoices').select('*').eq('client_id', clientId)

  if (fixed === 'all') {
    // Toutes les charges fixes, quelle que soit leur semaine — la page filtre celles dont la
    // période couvre la semaine affichée (une charge structurelle vit au-delà de sa date de facture)
    query = query.eq('is_fixed_charge', true)
  } else {
    if (week) query = query.eq('week_number', parseInt(week))
    if (year) query = query.eq('year', parseInt(year))
  }
  query = query.order('invoice_date', { ascending: false })

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/**
 * Règle de tri fournisseur : applique une catégorie à TOUTES les factures d'un
 * fournisseur, toutes semaines confondues — variantes du nom comprises :
 * « DAVID MASTER » couvre « DAVID MASTER SAS », « David Master 2 »…
 * (même famille de noms, voir lib/supplier-memory). Les imports futurs suivront
 * automatiquement — la mémoire fournisseur reprend la facture la plus récente.
 */
export async function PATCH(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const serviceSupabase = createServiceClient()
  const clientId = await resolveClientId(serviceSupabase, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const supplierName = String(body.supplier_name || '').trim()
  const category = String(body.category || '')
  const VALID_CATEGORIES = ['viande', 'charcuterie', 'epicerie', 'emballage', 'frais_generaux', 'charge_structure', 'frais_divers', 'autre']
  if (!supplierName || !VALID_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: 'supplier_name et category valides requis' }, { status: 400 })
  }

  // Sélection en deux temps : on lit les factures du client puis on filtre par
  // famille de noms en JS (limite de mot impossible à exprimer proprement en ilike).
  const { data: rows, error: readError } = await serviceSupabase
    .from('invoices')
    .select('id, supplier_name, category')
    .eq('client_id', clientId)
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 })

  const ids = (rows || [])
    .filter(r => r.category !== category && sameSupplierFamily(String(r.supplier_name || ''), supplierName))
    .map(r => r.id as string)

  // Mise à jour par lots (borne large : un client TPE reste loin de ces volumes)
  for (let i = 0; i < ids.length; i += 500) {
    const { error } = await serviceSupabase
      .from('invoices')
      .update({ category })
      .in('id', ids.slice(i, i + 500))
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, updated: ids.length })
}

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const serviceSupabase = createServiceClient()
  const clientId = await resolveClientId(serviceSupabase, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const body = await request.json()
  const { supplier_name, invoice_number, invoice_date, category = 'autre', amount_ht, tva_rate = 20, notes, week_number, year } = body

  if (!supplier_name || !invoice_date || amount_ht === undefined || !week_number || !year) {
    return NextResponse.json({ error: 'Champs manquants' }, { status: 400 })
  }

  const amount_ttc = parseFloat((parseFloat(amount_ht) * (1 + parseFloat(tva_rate) / 100)).toFixed(2))

  const { data, error } = await serviceSupabase
    .from('invoices')
    .insert({ client_id: clientId, supplier_name, invoice_number, invoice_date, category, amount_ht: parseFloat(amount_ht), tva_rate: parseFloat(tva_rate), amount_ttc, notes, week_number: parseInt(week_number), year: parseInt(year), status: 'validee' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
