import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendPlanningEmails } from '@/lib/planning-email'

export const dynamic = 'force-dynamic'

function isoWeekOf(date: Date): { week: number; year: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return { week: Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7), year: d.getUTCFullYear() }
}

/** Cron du dimanche soir (vercel.json) : envoie à chaque employé de chaque client
 *  son planning individuel de la semaine qui COMMENCE le lendemain. */
export async function GET(request: NextRequest) {
  // Sécurité cron Vercel : si CRON_SECRET est défini, l'en-tête doit correspondre
  const auth = request.headers.get('authorization')
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'RESEND_API_KEY manquant' }, { status: 500 })
  }

  const service = createServiceClient()
  // Le cron tourne le dimanche : la semaine cible est celle qui démarre demain (lundi)
  const target = new Date(Date.now() + 24 * 3600 * 1000)
  const { week, year } = isoWeekOf(target)

  const { data: clients } = await service.from('clients').select('id, name')
  const results: Array<Record<string, unknown>> = []
  for (const c of clients || []) {
    try {
      const r = await sendPlanningEmails(service, c.id, week, year, c.name || 'Votre boucherie')
      results.push({ client: c.id, ...r })
    } catch (e) {
      results.push({ client: c.id, error: String((e as Error)?.message || e) })
    }
  }
  return NextResponse.json({ week, year, results })
}
