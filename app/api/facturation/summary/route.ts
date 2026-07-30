import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { computeWeekEconomics } from '@/lib/week-economics'
import { readWeekCa, CA_SOURCES } from '@/lib/ca-sources'

export const dynamic = 'force-dynamic'

/**
 * Résumé économique de la semaine affichée en facturation.
 * Tout le calcul vit dans lib/week-economics (moteur partagé avec le rapport PDF) :
 * cette route ne fait qu'authentifier, lire le CA de la semaine et le lui passer.
 */
export async function GET(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const week = parseInt(searchParams.get('week') || '0')
  const year = parseInt(searchParams.get('year') || '0')
  if (!week || !year) return NextResponse.json({ error: 'week et year requis' }, { status: 400 })

  const serviceSupabase = createServiceClient()
  const clientId = await resolveClientId(serviceSupabase, user.id, user.email)
  if (!clientId) return NextResponse.json({ achats_ht: 0, masse_salariale: 0, ca_total: 0 })

  // CA de la semaine — lecteur UNIQUE (lib/ca-sources) : détail par famille du
  // rapport hebdo, repli sur les montants saisis à la main. Quelle que soit la
  // source qui l'a écrit, le moteur reçoit la même entrée.
  const record = await readWeekCa(serviceSupabase, clientId, week, year)

  const economics = await computeWeekEconomics(serviceSupabase, clientId, week, year,
    record?.ca ?? { ca_total: 0, familles: null, by_rayon: null })

  return NextResponse.json({
    ...economics,
    // Contrat inchangé pour les écrans existants : la ligne weekly_ca brute
    // (la page Facturation y lit families_detail).
    ca_detail: record?.raw ?? null,
    // Provenance du chiffre, pour que l'écran puisse l'annoncer au gérant
    ca_source: record?.source ?? null,
    ca_source_label: record ? CA_SOURCES[record.source].label : null,
  })
}
