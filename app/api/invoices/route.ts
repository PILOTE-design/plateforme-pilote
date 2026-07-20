import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'

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

  // Mémoire fournisseur → catégorie : renvoie la catégorie la plus récente utilisée pour
  // chaque fournisseur, pour pré-remplir automatiquement la catégorie à la saisie d'un achat.
  if (suppliers) {
    const { data: rows } = await serviceSupabase
      .from('invoices').select('supplier_name, category, invoice_date')
      .eq('client_id', clientId).order('invoice_date', { ascending: false })
    const map = new Map<string, string>()
    for (const r of rows || []) {
      const key = String(r.supplier_name || '').trim().toLowerCase()
      if (key && !map.has(key)) map.set(key, r.category) // trié desc → 1re occurrence = plus récente
    }
    return NextResponse.json(Array.from(map, ([supplier_name, category]) => ({ supplier_name, category })))
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
