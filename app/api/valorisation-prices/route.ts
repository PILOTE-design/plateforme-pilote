import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Prix de vente personnalisés par pièce, mémorisés par boucherie (profil) et par espèce.
// GET  → { prices: { boeuf: { cutId: "22.5" }, ... } }
// PUT  → enregistre le bloc de prix complet (upsert sur profile_id)

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { data, error } = await supabase
    .from('valorisation_prices')
    .select('prices')
    .eq('profile_id', user.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ prices: data?.prices ?? {} })
}

export async function PUT(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const body = await req.json()
  const prices = body?.prices
  if (prices === null || typeof prices !== 'object' || Array.isArray(prices)) {
    return NextResponse.json({ error: 'Format de prix invalide' }, { status: 400 })
  }

  const { error } = await supabase
    .from('valorisation_prices')
    .upsert({ profile_id: user.id, prices, updated_at: new Date().toISOString() }, { onConflict: 'profile_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
