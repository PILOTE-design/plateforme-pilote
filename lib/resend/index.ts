import { Resend } from 'resend'

// Clé de repli au build : le constructeur Resend lève une erreur si la clé est absente,
// ce qui casse `next build` lors du « Collecting page data ». En prod l'envoi reste protégé
// par les gardes des routes (qui vérifient RESEND_API_KEY avant d'envoyer).
export const resend = new Resend(process.env.RESEND_API_KEY || 'MISSING_RESEND_KEY')

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
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard"
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
