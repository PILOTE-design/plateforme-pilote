import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { gocardlessConfigured, createRequisition } from '@/lib/gocardless'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Démarre la connexion d'une banque : crée une requisition GoCardless et renvoie le lien de redirection. */
export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!gocardlessConfigured()) {
    return NextResponse.json({ error: 'Connexion bancaire pas encore configurée' }, { status: 503 })
  }

  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const institutionId: string | undefined = body?.institution_id
  const institutionName: string | null = body?.institution_name ?? null
  if (!institutionId) return NextResponse.json({ error: 'institution_id manquant' }, { status: 400 })

  const reference = `${clientId}:${crypto.randomUUID()}`
  const origin = new URL(request.url).origin
  const redirect = `${origin}/api/bank/callback`

  try {
    const { id, link } = await createRequisition({ institutionId, redirect, reference })
    await service.from('bank_connections').insert({
      client_id: clientId,
      provider: 'gocardless',
      institution_id: institutionId,
      institution_name: institutionName,
      requisition_id: id,
      reference,
      status: 'pending',
    })
    return NextResponse.json({ link })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Erreur GoCardless' }, { status: 500 })
  }
}
