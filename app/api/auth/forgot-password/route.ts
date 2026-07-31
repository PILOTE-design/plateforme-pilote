import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendPasswordResetEmail } from '@/lib/resend'
import { appUrl } from '@/lib/app-url'

// Réinitialisation de mot de passe « maison » — INDÉPENDANTE de la Site URL Supabase.
// On génère le jeton de récupération côté serveur (admin.generateLink), on envoie le
// lien par NOTRE Resend, et le lien pointe DIRECTEMENT sur /reset-password avec le
// token_hash. La page l'échange contre une session dans l'app (verifyOtp) : à aucun
// moment on ne dépend du « redirect_to » / de la Site URL de GoTrue (qui, mal réglés,
// renvoyaient le lien vers localhost).
//
// SÉCURITÉ : on ne révèle JAMAIS si l'email existe — la réponse est identique dans
// tous les cas (anti-énumération d'adresses).
export async function POST(req: NextRequest) {
  let email = ''
  try {
    const body = await req.json()
    email = String(body?.email ?? '').trim().toLowerCase()
  } catch {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 })
  }
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Email requis' }, { status: 400 })
  }

  try {
    const service = createServiceClient()
    const { data, error } = await service.auth.admin.generateLink({ type: 'recovery', email })
    const hashed = data?.properties?.hashed_token
    if (error) {
      // Utilisateur inexistant ou autre : on n'expose rien, on répond « ok » quand même.
      console.warn('[forgot-password] generateLink:', error.message)
    } else if (hashed) {
      const link = `${appUrl()}/reset-password?token_hash=${encodeURIComponent(hashed)}&type=recovery`
      await sendPasswordResetEmail(email, link)
    }
  } catch (e) {
    console.error('[forgot-password]', e instanceof Error ? e.message : e)
  }

  return NextResponse.json({ ok: true })
}
