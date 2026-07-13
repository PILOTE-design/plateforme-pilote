import type { createServiceClient } from '@/lib/supabase/server'

/**
 * Retrouve le client rattaché à l'utilisateur connecté.
 * 1. Par `client_user_id` (compte déjà lié)
 * 2. Sinon par email — et lie le compte au passage pour les prochains appels.
 *
 * Source unique de vérité : cette fonction était dupliquée dans les pages
 * dashboard/marges/tendances et dans toutes les routes API.
 */
export async function resolveClientId(
  serviceSupabase: ReturnType<typeof createServiceClient>,
  userId: string,
  userEmail?: string | null,
): Promise<string | null> {
  const { data: byId } = await serviceSupabase
    .from('clients').select('id').eq('client_user_id', userId).maybeSingle()
  if (byId) return byId.id as string
  if (!userEmail) return null
  const { data: byEmail } = await serviceSupabase
    .from('clients').select('id').eq('email', userEmail).maybeSingle()
  if (!byEmail) return null
  await serviceSupabase.from('clients').update({ client_user_id: userId }).eq('id', byEmail.id)
  return byEmail.id as string
}
