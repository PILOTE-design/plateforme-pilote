// Mercuriale — le référentiel de prix d'achat, à deux étages :
//   1. les RÉFS FOURNISSEURS (articles), créées automatiquement par la lecture
//      des factures — chaque ligne extraite est un point de prix daté ;
//   2. les ARTICLES GÉNÉRIQUES qui regroupent les réfs (« FILET DE POULET SV »
//      + « FILET DE POULET LR » → « Filet de poulet ») et ramènent tout à une
//      unité de base (kg ou pièce) via le facteur de conversion de chaque réf.
// Depuis le 29/07 (demande client) : une réf qui ne RESSEMBLE à rien devient
// automatiquement son propre générique (ensureAutoGenerics, rattrapage paresseux
// en tête de GET). Ne restent en file que les réfs qui se ressemblent — même
// tronc de libellé entre elles ou avec un générique existant (suggestion).
// Le prix d'un générique = dernier prix connu parmi ses réfs, converti.
// Depuis M-A (31/07) la réponse porte aussi la SURVEILLANCE des prix :
//   · `history` par générique — les prix payés sur 12 mois (points des réfs
//     utilisables, ramenés à l'unité de base), min/max sur la fenêtre ;
//   · `moves` — les CHANGEMENTS de prix des 30 derniers jours (par réf : deux
//     factures consécutives à prix différent), pour la section « Mouvements ».
// Seuls les prix VÉRIFIÉS participent (un prix en quarantaine a
// unit_price_ht NULL et n'apparaît jamais ici) ; une réf sans conversion
// d'unité reste exclue — mêmes règles que le prix du jour, rien d'inventé.
import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { ensureAutoGenerics, stemKey, isNonProduct, unitKind } from '@/lib/mercuriale-auto'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json({ generics: [], queue: [], pending: [] })

  // Association automatique des réfs sans ressemblance — AVANT les lectures,
  // pour que la réponse reflète l'état à jour. Idempotent, silencieux à vide.
  await ensureAutoGenerics(service, clientId)

  // Fenêtres de surveillance : l'historique se lit sur 12 mois glissants, les
  // mouvements sur 30 jours. Dates au format facture (YYYY-MM-DD).
  const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10)
  const cutoff12m = isoDay(Date.now() - 365 * 86400000)
  const cutoff30j = isoDay(Date.now() - 30 * 86400000)

  const [{ data: generics }, { data: articles }, { data: pricePoints }, { data: pending }] = await Promise.all([
    service.from('generic_articles')
      .select('id, name, base_unit, category, default_loss_pct, auto_created')
      .eq('client_id', clientId).eq('active', true)
      .order('name'),
    service.from('articles')
      .select('id, name, unit, supplier_name, article_code, last_price_ht, last_price_date, price_count, generic_id, conversion_factor, ignored')
      .eq('client_id', clientId)
      .order('updated_at', { ascending: false })
      .limit(1000),
    // Points de prix sur 12 mois (variation, historique, mouvements) — la date
    // vient de la facture ; un prix en quarantaine (unit_price_ht NULL) est absent
    service.from('invoice_lines')
      .select('article_id, unit_price_ht, invoices!inner(invoice_date)')
      .eq('client_id', clientId)
      .not('article_id', 'is', null)
      .not('unit_price_ht', 'is', null)
      .gte('invoices.invoice_date', cutoff12m)
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

  // Garde-fou unités (même règle que lib/recipes.buildGenericMap) : une réf
  // facturée dans une unité INCOMPATIBLE avec la base de son générique (pièce
  // vs kg) et SANS facteur de conversion n'a PAS de prix ramené à la base —
  // mieux vaut un prix manquant signalé qu'un prix pièce lu comme un prix kg.
  const baseByGenericId = new Map<string, 'kg' | 'piece'>(
    (generics || []).map((g: any) => [String(g.id), g.base_unit === 'piece' ? 'piece' : 'kg']),
  )
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
    const hasConv = a.conversion_factor !== null && Number(a.conversion_factor) > 0
    const base = a.generic_id ? baseByGenericId.get(String(a.generic_id)) ?? null : null
    const kind = unitKind(a.unit)
    const needs_conversion = base !== null && kind !== null && kind !== base && !hasConv
    const conv = hasConv ? Number(a.conversion_factor) : 1
    const price_base = last !== null && !needs_conversion ? last / conv : null
    return { ...a, last_price_ht: last, previous_price, variation_pct, price_base, needs_conversion }
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

  // Mouvements de prix des 30 derniers jours, collectés générique par générique
  // (par réf : deux factures consécutives à prix différent = un mouvement).
  const moves: any[] = []
  const round4 = (n: number) => Math.round(n * 10000) / 10000

  const genericsOut = (generics || []).map((g: any) => {
    const refs = (refsByGeneric.get(g.id) || [])
      .sort((x, y) => String(y.last_price_date || '').localeCompare(String(x.last_price_date || '')))
    const best = refs.find(r => r.price_base !== null) || null

    // Historique 12 mois : les prix PAYÉS (toutes réfs utilisables confondues,
    // ramenés à l'unité de base), triés par date de facture. Une réf sans
    // conversion d'unité n'y entre pas — même règle que le prix du jour.
    const points: { d: string; p: number }[] = []
    for (const r of refs) {
      if (r.needs_conversion) continue
      const conv = r.conversion_factor !== null && Number(r.conversion_factor) > 0 ? Number(r.conversion_factor) : 1
      const rpts = (pointsByArticle.get(r.id) || []).slice().sort((a, b) => a.date.localeCompare(b.date))
      for (const pt of rpts) points.push({ d: pt.date, p: round4(pt.price / conv) })
      // Mouvements : chaque changement de prix de CETTE réf daté des 30 derniers jours
      for (let i = 1; i < rpts.length; i++) {
        const prev = rpts[i - 1], cur = rpts[i]
        if (cur.price !== prev.price && cur.date >= cutoff30j) {
          moves.push({
            date: cur.date,
            generic_id: g.id,
            generic_name: g.name,
            base_unit: g.base_unit === 'piece' ? 'piece' : 'kg',
            ref_name: r.name,
            supplier_name: r.supplier_name ?? null,
            old_base: round4(prev.price / conv),
            new_base: round4(cur.price / conv),
            pct: prev.price !== 0 ? Math.round(((cur.price - prev.price) / prev.price) * 1000) / 10 : null,
          })
        }
      }
    }
    points.sort((a, b) => a.d.localeCompare(b.d))
    // La courbe se contente des inflexions : les prix identiques consécutifs
    // sont regroupés, et seuls les 40 derniers points voyagent vers la page.
    const history: { d: string; p: number }[] = []
    for (const pt of points) {
      if (history.length === 0 || history[history.length - 1].p !== pt.p) history.push(pt)
    }

    return {
      ...g,
      default_loss_pct: Number(g.default_loss_pct) || 0,
      refs_count: refs.length,
      price_ht: best ? best.price_base : null,
      price_date: best ? best.last_price_date : null,
      price_supplier: best ? best.supplier_name : null,
      variation_pct: best ? best.variation_pct : null,
      history: history.slice(-40),
      points_12m: points.length,
      min_12m: points.length > 0 ? Math.min(...points.map(x => x.p)) : null,
      max_12m: points.length > 0 ? Math.max(...points.map(x => x.p)) : null,
      refs,
    }
  })

  // Les mouvements les plus récents d'abord (à date égale, le plus fort écart) ;
  // la réponse est plafonnée mais annonce le total — jamais de troncature muette.
  moves.sort((a, b) => String(b.date).localeCompare(String(a.date)) || Math.abs(b.pct ?? 0) - Math.abs(a.pct ?? 0))
  const movesOut = moves.slice(0, 50)

  // File « À rapprocher » : chaque réf restante porte sa clé de rapprochement
  // (deux premiers mots significatifs), une suggestion si un générique existant
  // partage cette clé, et un marqueur non-produit (taxes, remises, licences…).
  const genericIdByKey = new Map<string, string>()
  for (const g of generics || []) {
    const k = stemKey(String((g as any).name))
    if (!genericIdByKey.has(k)) genericIdByKey.set(k, String((g as any).id))
  }
  const queueOut = queue.map((a: any) => {
    const nonProduct = isNonProduct(String(a.name))
    const stem = nonProduct ? `np:${String(a.id)}` : stemKey(String(a.name))
    return {
      ...a, stem,
      non_product: nonProduct,
      suggested_generic_id: nonProduct ? null : genericIdByKey.get(stem) ?? null,
    }
  })

  return NextResponse.json({
    generics: genericsOut,
    queue: queueOut,
    pending: pending || [],
    moves: movesOut,
    moves_total: moves.length,
  })
}
