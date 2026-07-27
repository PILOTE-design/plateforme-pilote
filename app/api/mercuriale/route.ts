// Mercuriale — catalogue d'articles du client avec dernier prix et variation.
//
// L'historique de prix n'est PAS une table à part : chaque ligne de facture
// extraite (invoice_lines) est un point de prix daté. La variation affichée
// compare les deux derniers prix unitaires connus d'un article, toutes factures
// confondues. La route renvoie aussi la file d'attente d'extraction : les
// factures dont le PDF est stocké mais dont les lignes n'ont pas encore été lues.
import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json({ articles: [], pending: [] })

  const [{ data: articles }, { data: pricePoints }, { data: pending }] = await Promise.all([
    service.from('articles')
      .select('id, name, unit, supplier_name, article_code, last_price_ht, last_price_date, price_count')
      .eq('client_id', clientId)
      .order('updated_at', { ascending: false })
      .limit(1000),
    // Points de prix récents (pour la variation) — la date vient de la facture
    service.from('invoice_lines')
      .select('article_id, unit_price_ht, invoices!inner(invoice_date)')
      .eq('client_id', clientId)
      .not('article_id', 'is', null)
      .not('unit_price_ht', 'is', null)
      .order('created_at', { ascending: false })
      .limit(2000),
    // File d'attente : PDF présent, lignes jamais extraites (ou en échec à retenter)
    service.from('invoices')
      .select('id, supplier_name, invoice_date, amount_ht, lines_status')
      .eq('client_id', clientId)
      .not('file_path', 'is', null)
      .or('lines_status.is.null,lines_status.eq.error')
      .order('invoice_date', { ascending: false })
      .limit(200),
  ])

  // Variation : deux derniers prix unitaires distincts par article, triés par date de facture
  const pointsByArticle = new Map<string, { date: string; price: number }[]>()
  for (const p of (pricePoints || []) as any[]) {
    const date = p.invoices?.invoice_date
    if (!p.article_id || !date) continue
    const arr = pointsByArticle.get(p.article_id) || []
    arr.push({ date, price: parseFloat(p.unit_price_ht) })
    pointsByArticle.set(p.article_id, arr)
  }

  const enriched = (articles || []).map((a: any) => {
    const pts = (pointsByArticle.get(a.id) || []).sort((x, y) => y.date.localeCompare(x.date))
    let previous_price: number | null = null
    let variation_pct: number | null = null
    const last = pts[0]?.price ?? (a.last_price_ht !== null ? parseFloat(a.last_price_ht) : null)
    for (const p of pts.slice(1)) {
      if (last !== null && p.price !== last) { previous_price = p.price; break }
    }
    if (last !== null && previous_price !== null && previous_price !== 0) {
      variation_pct = Math.round(((last - previous_price) / previous_price) * 1000) / 10
    }
    return { ...a, previous_price, variation_pct }
  })

  return NextResponse.json({ articles: enriched, pending: pending || [] })
}
