// Ce qui manque encore au client connecté pour que ses chiffres soient justes.
// Sert l'écran de démarrage et permettra à un écran de réglages d'afficher le
// même diagnostic — une seule source (lib/onboarding-status).
import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { readSetupStatus } from '@/lib/onboarding-status'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) {
    return NextResponse.json({
      error: "Aucune boucherie n'est rattachée à ce compte.",
      steps: [], done: 0, total: 0, complete: false, bloquants: [],
    }, { status: 404 })
  }

  const status = await readSetupStatus(service, clientId)
  return NextResponse.json(status)
}
