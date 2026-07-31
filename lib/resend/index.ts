import { Resend } from 'resend'
import { appUrl } from '@/lib/app-url'

// Clé de repli au build : le constructeur Resend lève une erreur si la clé est absente,
// ce qui casse `next build` lors du « Collecting page data ». En prod l'envoi reste protégé
// par les gardes des routes (qui vérifient RESEND_API_KEY avant d'envoyer).
export const resend = new Resend(process.env.RESEND_API_KEY || 'MISSING_RESEND_KEY')

// Email de réinitialisation « maison » : le lien pointe DIRECTEMENT sur
// /reset-password avec le token_hash (cf. app/api/auth/forgot-password) — il ne
// dépend donc PAS de la Site URL de Supabase. Repli d'expéditeur sur le domaine de
// test Resend si RESEND_FROM_EMAIL n'est pas défini (comme la route send-code).
export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
    to,
    subject: 'Réinitialisation de votre mot de passe PILOTE',
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
        <div style="background:#1E3A5F;padding:24px 32px">
          <div style="color:#FF8C00;font-size:10px;letter-spacing:4px;margin-bottom:6px">PILOTE</div>
          <h2 style="color:#fff;margin:0;font-size:18px">Réinitialisation du mot de passe</h2>
        </div>
        <div style="padding:28px 32px;border:1px solid #E0E0E0;border-top:none">
          <p style="font-size:14px;color:#1a1a1a;margin:0 0 16px">Bonjour,</p>
          <p style="font-size:14px;color:#444;margin:0 0 20px">Vous avez demandé à réinitialiser votre mot de passe. Cliquez sur le bouton ci-dessous pour en choisir un nouveau. Ce lien est valable une heure et à usage unique.</p>
          <div style="text-align:center;margin:24px 0">
            <a href="${resetUrl}" style="background:#1E3A5F;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:14px">Choisir un nouveau mot de passe</a>
          </div>
          <p style="font-size:12px;color:#888;margin:20px 0 0">Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : votre mot de passe reste inchangé.</p>
        </div>
        <p style="text-align:center;color:#bbb;font-size:11px;margin-top:12px">PILOTE · Email automatique</p>
      </div>
    `,
  })
}

export async function sendWelcomeEmail(to: string, businessName: string) {
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to,
    subject: 'Bienvenue sur PILOTE — Votre abonnement est activé',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #1a1a2e;">Bienvenue sur PILOTE 👋</h1>
        <p>Bonjour,</p>
        <p>Votre abonnement pour <strong>${businessName}</strong> est maintenant actif.</p>
        <p>Vous recevrez votre première analyse comparative dès la semaine prochaine.</p>
        <p>En attendant, vous pouvez accéder à votre espace client pour mettre à jour vos informations.</p>
        <a href="${appUrl()}/dashboard"
           style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px;
                  border-radius: 6px; text-decoration: none; margin-top: 16px;">
          Accéder à mon espace
        </a>
        <p style="color: #666; margin-top: 32px; font-size: 14px;">
          L'équipe PILOTE
        </p>
      </div>
    `,
  })
}

export async function sendReportEmail(
  to: string,
  businessName: string,
  reportTitle: string,
  reportUrl: string
) {
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to,
    subject: `Votre analyse PILOTE — ${reportTitle}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #1a1a2e;">Votre analyse hebdomadaire est prête</h1>
        <p>Bonjour,</p>
        <p>Votre analyse comparative de la semaine pour <strong>${businessName}</strong> est disponible.</p>
        <a href="${reportUrl}"
           style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px;
                  border-radius: 6px; text-decoration: none; margin-top: 16px;">
          Télécharger mon analyse
        </a>
        <p style="color: #666; margin-top: 32px; font-size: 14px;">
          L'équipe PILOTE
        </p>
      </div>
    `,
  })
}
