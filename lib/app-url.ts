// URL publique de l'application, pour TOUS les liens envoyés par email (invitation,
// bienvenue, notifications admin) et les redirections d'authentification.
//
// Deux pièges corrigés ici :
//  1. des URL de déploiement PÉRIMÉES traînaient en dur dans le code
//     (`pilote-coral.vercel.app`, `plateforme-pilote.vercel.app`) ;
//  2. une valeur `localhost` (un `.env` de dev copié par erreur dans Vercel)
//     partait dans de vrais emails de prod — un lien de mot de passe vers
//     `http://localhost:3000` est inutilisable pour l'utilisateur.
//
// On préfère donc la variable d'environnement, MAIS on écarte toute valeur
// localhost / 127.0.0.1 au profit du domaine de prod. Un email ne doit jamais
// pointer vers localhost.
export function appUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || '').trim()
  if (raw && !/localhost|127\.0\.0\.1/i.test(raw)) return raw.replace(/\/+$/, '')
  return 'https://getpilote.app'
}
