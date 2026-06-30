import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createCheckoutSession } from '@/lib/stripe'

export async function POST() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }

  try {
    const session = await createCheckoutSession(user.id, user.email!)
    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('Erreur Stripe checkout:', err)
    return NextResponse.json({ error: 'Erreur création session Stripe' }, { status: 500 })
  }
}
