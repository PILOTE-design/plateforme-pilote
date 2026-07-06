import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { Resend } from 'resend'
import crypto from 'crypto'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Vérification de la clé Resend
  if (!process.env.RESEND_API_KEY) {
    console.error('[send-code] RESEND_API_KEY manquante')
    return NextResponse.json({ error: 'Configuration email manquante (RESEND_API_KEY)' }, { status: 500 })
  }

  const { billing_email } = await request.json()
  if (!billing_email || !billing_email.includes('@')) {
    return NextResponse.json({ error: 'Email invalide' }, { status: 400 })
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString()
  const codeHash = crypto.createHash('sha256').update(code).digest('hex')
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString()

  const serviceSupabase = createServiceClient()

  const { data: existingProfile } = await serviceSupabase
    .from('profiles')
    .select('billing_forward_id')
    .eq('user_id', user.id)
    .maybeSingle()

  const forwardId = existingProfile?.billing_forward_id
    || Math.random().toString(36).slice(2, 12)

  await serviceSupabase
    .from('profiles')
    .update({
      billing_email,
      billing_email_verified: false,
      billing_email_code: codeHash,
      billing_email_code_expires: expires,
      billing_forward_id: forwardId,
    })
    .eq('user_id', user.id)

  const { data: sendData, error: emailError } = await resend.emails.send({
    from: 'PILOTE <onboarding@resend.dev>',
    to: billing_email,
    subject: `${code} — Code de validation PILOTE`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;">
        <div style="margin-bottom:24px;">
          <span style="font-size:22px;font-weight:900;color:#1E3A5F;">PILOTE</span>
        </div>
        <h2 style="color:#0f172a;font-size:18px;margin-bottom:8px;">Validation de votre adresse de facturation</h2>
        <p style="color:#64748b;font-size:14px;margin-bottom:24px;">
          Vous avez demandé à connecter <strong>${billing_email}</strong> à PILOTE pour la lecture automatique de vos factures.
        </p>
        <div style="background:#f1f5f9;border-radius:16px;padding:28px;text-align:center;margin-bottom:24px;">
          <p style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:2px;margin:0 0 12px;">Votre code de validation</p>
          <span style="font-size:40px;font-weight:900;letter-spacing:10px;color:#1E3A5F;font-family:monospace;">${code}</span>
        </div>
        <p style="color:#94a3b8;font-size:12px;">Ce code expire dans <strong>15 minutes</strong>. Ne le partagez avec personne.</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
        <p style="color:#cbd5e1;font-size:11px;">Si vous n&apos;avez pas demand&eacute; ce code, ignorez cet email.</p>
      </div>
    `,
  })

  if (emailError) {
    console.error('[send-code] Resend error:', JSON.stringify(emailError))
    // On retourne l'erreur Resend brute en dev pour débugger
    const msg = (emailError as any)?.message || (emailError as any)?.name || 'Erreur envoi email'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  console.log('[send-code] Email envoyé:', sendData?.id, '→', billing_email)
  return NextResponse.json({ ok: true })
}
