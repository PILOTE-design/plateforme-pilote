import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Prix personnalisés par pièce, mémorisés par boucherie (profil) et par espèce.
// - prices        : prix de référence marché (surcharge le prix indicatif)
// - sellOverrides  : prix conseillé/kg saisi manuellement (surcharge le prix auto réf × coefficient)
// GET → { prices, sellOverrides }
// PUT → enregistre l'un et/ou l'autre (upsert sur profile_id)

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { data, error } = await supabase
    .from('valorisation_prices')
    .select('prices, sell_overrides')
    .eq('profile_id', user.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ prices: data?.prices ?? {}, sellOverrides: data?.sell_overrides ?? {} })
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export async function PUT(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const row: Record<string, unknown> = { profile_id: user.id, updated_at: new Date().toISOString() }
  if (body && isPlainObject(body.prices)) row.prices = body.prices
  if (body && isPlainObject(body.sellOverrides)) row.sell_overrides = body.sellOverrides
  if (row.prices === undefined && row.sell_overrides === undefined) {
    return NextResponse.json({ error: 'Rien à enregistrer' }, { status: 400 })
  }

  const { error } = await supabase
    .from('valorisation_prices')
    .upsert(row, { onConflict: 'profile_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
