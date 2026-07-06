import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import crypto from 'crypto'

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { code } = await request.json()
  if (!code || code.length !== 6) {
    return NextResponse.json({ error: 'Code invalide' }, { status: 400 })
  }

  const serviceSupabase = createServiceClient()
  const { data: profile } = await serviceSupabase
    .from('profiles')
    .select('billing_email_code, billing_email_code_expires, billing_forward_id, billing_email')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!profile?.billing_email_code) {
    return NextResponse.json({ error: 'Aucun code en attente' }, { status: 400 })
  }

  // Vérifier l'expiration
  if (new Date(profile.billing_email_code_expires) < new Date()) {
    return NextResponse.json({ error: 'Code expiré. Renvoyez un nouveau code.' }, { status: 400 })
  }

  // Vérifier le hash
  const inputHash = crypto.createHash('sha256').update(code.trim()).digest('hex')
  if (inputHash !== profile.billing_email_code) {
    return NextResponse.json({ error: 'Code incorrect' }, { status: 400 })
  }

  // Marquer comme vérifié, effacer le code
  await serviceSupabase
    .from('profiles')
    .update({
      billing_email_verified: true,
      billing_email_code: null,
      billing_email_code_expires: null,
    })
    .eq('user_id', user.id)

  return NextResponse.json({
    ok: true,
    billing_email: profile.billing_email,
    forward_address: `factures-${profile.billing_forward_id}@mail.getpilote.app`,
  })
}
