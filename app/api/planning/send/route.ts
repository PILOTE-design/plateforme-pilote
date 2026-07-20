import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { sendPlanningEmails } from '@/lib/planning-email'

export const dynamic = 'force-dynamic'

/** Envoi manuel du planning de la semaine à chaque employé (bouton de la page planning) */
export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "Envoi d'emails non configuré (RESEND_API_KEY manquant)" }, { status: 500 })
  }

  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const week = parseInt(String(body?.week))
  const year = parseInt(String(body?.year))
  if (!week || !year || week < 1 || week > 53) {
    return NextResponse.json({ error: 'Semaine invalide' }, { status: 400 })
  }

  const { data: profile } = await service
    .from('profiles').select('business_name').eq('user_id', user.id).maybeSingle()
  const businessName = profile?.business_name || 'Votre boucherie'

  const result = await sendPlanningEmails(service, clientId, week, year, businessName)
  return NextResponse.json(result)
}
