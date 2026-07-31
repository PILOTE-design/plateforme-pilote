// PDF source d'une facture — pour VÉRIFIER un prix depuis la mercuriale
// (mouvement marqué « à vérifier ») sans quitter la page : le lien ouvre le
// document du bucket privé `invoice-files` via une URL signée courte (5 min).
// La facture doit appartenir au client résolu — jamais celle d'une autre
// boucherie ; sans PDF stocké, on répond 404 en clair plutôt qu'un lien mort.
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const { data: invoice } = await service
    .from('invoices')
    .select('id, file_path')
    .eq('id', params.id)
    .eq('client_id', clientId)
    .maybeSingle()
  if (!invoice) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 })
  if (!invoice.file_path) {
    return NextResponse.json({ error: 'Cette facture n’a pas de PDF stocké' }, { status: 404 })
  }

  const { data: signed, error } = await service.storage
    .from('invoice-files')
    .createSignedUrl(String(invoice.file_path), 300)
  if (error || !signed?.signedUrl) {
    return NextResponse.json({ error: error?.message ?? 'Lien du PDF indisponible' }, { status: 500 })
  }

  return NextResponse.redirect(signed.signedUrl)
}
