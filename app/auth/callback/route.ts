import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Échange le code de vérification (lien email : récupération de mot de passe,
// confirmation de compte) contre une session, puis redirige vers `next`.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  const message = encodeURIComponent('Lien invalide ou expiré. Merci de refaire une demande.')
  return NextResponse.redirect(`${origin}/login?message=${message}`)
}
