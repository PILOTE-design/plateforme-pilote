import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { PROVIDERS } from '@/lib/billing-providers'

// GET — liste les intégrations du client connecté
export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const service = createServiceClient()

  // Résoudre client_id
  const { data: clientRow } = await service
    .from('clients').select('id').eq('client_user_id', user.id).maybeSingle()
  if (!clientRow) return NextResponse.json([])

  const { data } = await service
    .from('billing_integrations')
    .select('provider, is_active, last_sync_at, last_sync_status, invoices_synced, company_id')
    .eq('client_id', clientRow.id)

  // Masquer le token, retourner juste les métadonnées
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

  const { data: clientRow } = await service
    .from('clients').select('id').eq('client_user_id', user.id).maybeSingle()
  if (!clientRow) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  // Tester la connexion avant de sauvegarder
  const prov = PROVIDERS[provider]
  const ok = await prov.testConnection(api_token, company_id)
  if (!ok) return NextResponse.json({ error: `Connexion ${prov.name} échouée — vérifiez votre token` }, { status: 422 })

  const { error } = await service.from('billing_integrations').upsert({
    client_id:  clientRow.id,
    provider,
    api_token,
    company_id: company_id || null,
    is_active:  true,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'client_id,provider' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
