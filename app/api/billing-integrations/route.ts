import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { PROVIDERS } from '@/lib/billing-providers'
import { resolveClientId } from '@/lib/resolve-client-id'

// Résolution de compte : resolveClientId (user_id PUIS email), comme partout.
// Le lookup direct `client_user_id` renvoyait « Client introuvable » aux
// boutiques à deux logins — la fiche n'est rattachée qu'à UN user_id, le
// second compte n'est reconnu que par son email (bug clé API du 31/07).

// GET — liste les intégrations du client connecté
export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const service = createServiceClient()

  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json([])

  const { data } = await service
    .from('billing_integrations')
    .select('provider, is_active, last_sync_at, last_sync_status, last_sync_error, invoices_synced, company_id, backfill_at, backfill_imported, backfill_tronque')
    .eq('client_id', clientId)

  // Masquer le token, retourner les métadonnées + erreur lisible
  return NextResponse.json(data ?? [])
}

// POST — créer ou mettre à jour une intégration
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const { provider, api_token, company_id } = await req.json()

  if (!PROVIDERS[provider]) return NextResponse.json({ error: 'Plateforme inconnue' }, { status: 400 })
  if (!api_token) return NextResponse.json({ error: 'Token requis' }, { status: 400 })

  const service = createServiceClient()

  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  // Tester la connexion avant de sauvegarder
  const prov = PROVIDERS[provider]
  const ok = await prov.testConnection(api_token, company_id)
  if (!ok) return NextResponse.json({ error: `Connexion ${prov.name} échouée — vérifiez votre token` }, { status: 422 })

  const { error } = await service.from('billing_integrations').upsert({
    client_id:  clientId,
    provider,
    api_token,
    company_id: company_id || null,
    is_active:  true,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'client_id,provider' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
