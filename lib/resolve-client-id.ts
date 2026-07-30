import type { createServiceClient } from '@/lib/supabase/server'

/**
 * Retrouve le client rattaché à l'utilisateur connecté.
 * 1. Par `client_user_id` (compte déjà lié)
 * 2. Sinon par email — et lie le compte au passage pour les prochains appels.
 *
 * Source unique de vérité : cette fonction était dupliquée dans les pages
 * dashboard/marges/tendances et dans toutes les routes API.
 *
 * MODÈLE : un utilisateur = UNE boucherie. Un compte rattaché à plusieurs
 * clients (emails identiques en base, ou trigger de liaison ayant marqué
 * plusieurs lignes) était jusqu'ici renvoyé comme « aucun client » : tous les
 * écrans se vidaient et affichaient « Client introuvable » sans que personne ne
 * comprenne pourquoi. On distingue désormais les deux situations — voir
 * `resolveClient()` — pour pouvoir l'annoncer au lieu de laisser un compte
 * verrouillé en silence. La sécurité reste la même : dans le doute, on ne
 * renvoie AUCUN client (jamais celui d'une autre boucherie).
 */

export type ClientResolution =
  | { clientId: string; ambigu: false }
  | { clientId: null; ambigu: true; count: number }
  | { clientId: null; ambigu: false }

/** Résolution détaillée : distingue « aucun client » de « plusieurs clients ». */
export async function resolveClient(
  serviceSupabase: ReturnType<typeof createServiceClient>,
  userId: string,
  userEmail?: string | null,
): Promise<ClientResolution> {
  const { data: byId } = await serviceSupabase
    .from('clients').select('id').eq('client_user_id', userId)
  const linked = byId ?? []
  if (linked.length === 1) return { clientId: String(linked[0].id), ambigu: false }
  if (linked.length > 1) return { clientId: null, ambigu: true, count: linked.length }

  if (!userEmail) return { clientId: null, ambigu: false }

  const { data: byEmail } = await serviceSupabase
    .from('clients').select('id').eq('email', userEmail)
  const matched = byEmail ?? []
  if (matched.length > 1) return { clientId: null, ambigu: true, count: matched.length }
  if (matched.length === 0) return { clientId: null, ambigu: false }

  const id = String(matched[0].id)
  // Liaison du compte : écriture volontaire, faite UNE fois, à la première
  // reconnaissance par email. Elle est tolérante à l'échec — une lecture ne doit
  // jamais échouer parce qu'une écriture de confort n'est pas passée.
  const { error } = await serviceSupabase
    .from('clients').update({ client_user_id: userId }).eq('id', id).is('client_user_id', null)
  if (error) console.error('[resolveClient] liaison du compte impossible:', error.message)
  return { clientId: id, ambigu: false }
}

/** Identifiant du client de l'utilisateur, ou null. Signature historique —
 *  conservée telle quelle pour tous les appelants existants. */
export async function resolveClientId(
  serviceSupabase: ReturnType<typeof createServiceClient>,
  userId: string,
  userEmail?: string | null,
): Promise<string | null> {
  const r = await resolveClient(serviceSupabase, userId, userEmail)
  if (r.ambigu) {
    console.error(`[resolveClientId] compte ${userId} rattaché à ${r.count} boucheries — accès refusé par précaution`)
  }
  return r.clientId
}
