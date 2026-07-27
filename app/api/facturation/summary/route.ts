import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { computeWeekEconomics } from '@/lib/week-economics'

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

  // CA de la semaine : détail automatique du rapport hebdo (families_detail),
  // repli sur les montants ca_* saisis à la main dans la modale « Saisir le CA ».
  const { data: caData } = await serviceSupabase
    .from('weekly_ca')
    .select('*')
    .eq('client_id', clientId)
    .eq('week_number', week)
    .eq('year', year)
    .maybeSingle()

  const economics = await computeWeekEconomics(serviceSupabase, clientId, week, year, {
    ca_total: parseFloat((caData as any)?.ca_total || 0) || 0,
    familles: Array.isArray((caData as any)?.families_detail) ? (caData as any).families_detail : null,
    by_rayon: {
      boucherie:   parseFloat((caData as any)?.ca_boucherie || 0) || 0,
      charcuterie: parseFloat((caData as any)?.ca_charcuterie || 0) || 0,
      traiteur:    parseFloat((caData as any)?.ca_traiteur || 0) || 0,
    },
  })

  return NextResponse.json({ ...economics, ca_detail: caData || null })
}
