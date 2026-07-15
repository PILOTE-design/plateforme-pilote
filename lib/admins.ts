// ─── Administrateurs de la plateforme ────────────────────────────────────────
// L'admin principal reste propriétaire des enregistrements clients
// (clients.user_id) — ne pas le changer sans migration.
// Pour ajouter un co-admin (associé) : renseigner la variable d'environnement
// ADMIN_EMAILS sur Vercel (emails séparés par des virgules) puis redéployer.
// Exemple : ADMIN_EMAILS=associe@exemple.fr,autre@exemple.fr

export const PRIMARY_ADMIN_EMAIL = 'nouvion.theo51@gmail.com'

/** Tous les emails admin : le principal + ceux de la variable d'env ADMIN_EMAILS */
export function getAdminEmails(): string[] {
  const extra = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
  return [...new Set([PRIMARY_ADMIN_EMAIL.toLowerCase(), ...extra])]
}

/** Vrai si l'email appartient à un administrateur (insensible à la casse) */
export function isAdminEmail(email?: string | null): boolean {
  return !!email && getAdminEmails().includes(email.toLowerCase())
}
