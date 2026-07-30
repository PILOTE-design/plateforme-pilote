// ─── Administrateurs de la plateforme ────────────────────────────────────────
// L'admin principal reste propriétaire des enregistrements clients
// (clients.user_id) — ne pas le changer sans migration.
// Pour ajouter un co-admin (associé) : renseigner la variable d'environnement
// ADMIN_EMAILS sur Vercel (emails séparés par des virgules) puis redéployer.
// Exemple : ADMIN_EMAILS=associe@exemple.fr,autre@exemple.fr

export const PRIMARY_ADMIN_EMAIL = 'nouvion.theo51@gmail.com'

/** Co-administrateurs (associés) ajoutés en dur : même accès admin que le
 *  principal. La propriété des enregistrements clients (clients.user_id) reste au
 *  principal (cf. avertissement plus haut). On peut aussi en ajouter sans code via
 *  la variable d'env ADMIN_EMAILS. */
const CO_ADMIN_EMAILS = ['boucherieduvaldesbois@gmail.com']

/** Tous les emails admin : le principal + les co-admins en dur + ceux de ADMIN_EMAILS */
export function getAdminEmails(): string[] {
  const extra = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
  return [...new Set([
    PRIMARY_ADMIN_EMAIL.toLowerCase(),
    ...CO_ADMIN_EMAILS.map(e => e.toLowerCase()),
    ...extra,
  ])]
}

/** Vrai si l'email appartient à un administrateur (insensible à la casse) */
export function isAdminEmail(email?: string | null): boolean {
  return !!email && getAdminEmails().includes(email.toLowerCase())
}
