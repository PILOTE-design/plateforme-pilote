// Mercuriale — le référentiel de prix d'achat, à deux étages :
//   1. les RÉFS FOURNISSEURS (articles), créées automatiquement par la lecture
//      des factures — chaque ligne extraite est un point de prix daté ;
//   2. les ARTICLES GÉNÉRIQUES, créés par l'utilisateur, qui regroupent les
//      réfs (« FILET DE POULET SV » + « FILET DE POULET LR » → « Filet de
//      poulet ») et ramènent tout à une unité de base (kg ou pièce) via le
//      facteur de conversion de chaque réf.
// Une réf sans générique est « à associer » : elle attend dans la file.
// Le prix d'un générique = dernier prix connu parmi ses réfs, converti.
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
  if (!clientId) return NextResponse.json({ generics: [], queue: [], pending: [] })

  const [{ data: generics }, { data: articles }, { data: pricePoints }, { data: pending }] = await Promise.all([
    service.from('generic_articles')
      .select('id, name, base_unit, category, default_loss_pct')
      .eq('client_id', clientId).eq('active', true)
      .order('name'),
    service.from('articles')
      .select('id, name, unit, supplier_name, article_code, last_price_ht, last_price_date, price_count, generic_id, conversion_factor')
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
    // File d'attente d'extraction : PDF présent, lignes jamais lues (ou échec à
    // retenter). Les CHARGES FIXES sont exclues d'office ; le reste passe par la
    // reconnaissance de nature à l'extraction — la CATÉGORIE n'est pas fiable.
    service.from('invoices')
      .select('id, supplier_name, invoice_date, amount_ht, lines_status')
      .eq('client_id', clientId)
      .eq('is_fixed_charge', false)
      .not('file_path', 'is', null)
      .or('lines_status.is.null,lines_status.eq.error')
      .order('invoice_date', { ascending: false })
      .limit(200),
  ])

  // Variation : deux derniers prix unitaires distincts par réf, datés par la facture
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
    const conv = a.conversion_factor !== null && Number(a.conversion_factor) > 0 ? Number(a.conversion_factor) : 1
    const price_base = last !== null ? last / conv : null
    return { ...a, last_price_ht: last, previous_price, variation_pct, price_base }
  })

  // Regroupement sous les génériques ; le prix du générique = la réf au dernier
  // prix le plus récent, ramené à l'unité de base (la variation % est celle de
  // cette réf : diviser par un facteur constant ne change pas le pourcentage).
  const refsByGeneric = new Map<string, any[]>()
  const queue: any[] = []
  for (const a of enriched) {
    if (a.generic_id) {
      const arr = refsByGeneric.get(a.generic_id) || []
      arr.push(a)
      refsByGeneric.set(a.generic_id, arr)
    } else {
      queue.push(a)
    }
  }

  const genericsOut = (generics || []).map((g: any) => {
    const refs = (refsByGeneric.get(g.id) || [])
      .sort((x, y) => String(y.last_price_date || '').localeCompare(String(x.last_price_date || '')))
    const best = refs.find(r => r.price_base !== null) || null
    return {
      ...g,
      default_loss_pct: Number(g.default_loss_pct) || 0,
      refs_count: refs.length,
      price_ht: best ? best.price_base : null,
      price_date: best ? best.last_price_date : null,
      price_supplier: best ? best.supplier_name : null,
      variation_pct: best ? best.variation_pct : null,
      refs,
    }
  })

  return NextResponse.json({ generics: genericsOut, queue, pending: pending || [] })
}
