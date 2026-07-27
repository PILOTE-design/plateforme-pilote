// Historisation du CA et des produits de la semaine (weekly_ca /
// weekly_sales_products) — la mémoire qui alimente les comparaisons N-1.
import type { createServiceClient } from '@/lib/supabase/server'
import type { ExtractedData, Famille, FinancierData } from './report-types'

// ─── Historisation caisse ─────────────────────────────────────────────────────
// supabase-js ne lève pas : il renvoie { error }. Sans test explicite, un delete
// réussi suivi d'un insert en échec effaçait la semaine de weekly_ca en silence,
// et le client recevait quand même son PDF. On remonte donc l'erreur à l'appelant.

export async function archiveWeekData(
  serviceSupabase: ReturnType<typeof createServiceClient>,
  clientId: string,
  week: number,
  year: number,
  fin: FinancierData,
  familles: Famille[],
  produits: Map<string, number>,
  familleByProduct?: Map<string, string>,
) {
  const familiesDetail = familles.map((f: Famille) => ({ nom: f.nom, montant: f.total_montant }))

  const { error: delCaErr } = await serviceSupabase.from('weekly_ca').delete()
    .eq('client_id', clientId).eq('week_number', week).eq('year', year)
  if (delCaErr) throw new Error(`Historisation weekly_ca (suppression) : ${delCaErr.message}`)

  const { error: insCaErr } = await serviceSupabase.from('weekly_ca').insert({
    client_id: clientId,
    week_number: week,
    year,
    ca_total: fin.ca_net,
    families_detail: familiesDetail,
    nb_tickets: fin.nb_tickets,
    moyenne_ticket: fin.moyenne_ticket,
  })
  if (insCaErr) throw new Error(`Historisation weekly_ca (écriture) : ${insCaErr.message}`)

  const { error: delProdErr } = await serviceSupabase.from('weekly_sales_products').delete()
    .eq('client_id', clientId).eq('week_number', week).eq('year', year)
  if (delProdErr) throw new Error(`Historisation produits (suppression) : ${delProdErr.message}`)

  const rows = [...produits.entries()].map(([product, amount]) => ({
    client_id: clientId, week_number: week, year, product, amount,
    famille: familleByProduct?.get(product) ?? null,
  }))
  if (rows.length > 0) {
    const { error: insProdErr } = await serviceSupabase.from('weekly_sales_products').insert(rows)
    if (insProdErr) throw new Error(`Historisation produits (écriture) : ${insProdErr.message}`)
  }
}
