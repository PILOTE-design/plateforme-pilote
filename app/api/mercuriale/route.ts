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
// Depuis M-C : chaque générique porte aussi ses FICHES RECETTES utilisatrices
// (`recipes_used` — quantité BRUTE par batch, perte comprise) et le prix
// précédent (`prev_price_ht`) pour chiffrer l'impact d'un mouvement : la page
// affiche Δprix × quantité brute, en € par batch et par unité produite.
// L'impact est de l'arithmétique sur les prix de la mercuriale — AUCUN moteur
// de coût dupliqué ici (le coût complet reste calculé par lib/recipes).
import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { ensureAutoGenerics, stemKey, isNonProduct, unitKind } from '@/lib/mercuriale-auto'
import { fetchAllPages } from '@/lib/fetch-all'

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

  // Toutes ces lectures sont PAGINÉES (lib/fetch-all) : elles portaient des
  // `.limit()` muets — 1000 réfs, 2000 points de prix, 200 factures en file —
  // qui n'apparaissaient nulle part dans la réponse. Le tri se termine par une
  // colonne unique (`id`) pour que deux pages ne se recouvrent ni ne s'omettent
  // quand deux lignes partagent la même date.
  const [{ data: generics }, refsPage, pointsPage, pendingPage] = await Promise.all([
    service.from('generic_articles')
      .select('id, name, base_unit, category, default_loss_pct, auto_created')
      .eq('client_id', clientId).eq('active', true)
      .order('name'),
    fetchAllPages<any>(() => service.from('articles')
      .select('id, name, unit, supplier_name, article_code, last_price_ht, last_price_date, price_count, generic_id, conversion_factor, ignored')
      .eq('client_id', clientId)
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true })),
    // Points de prix sur 12 mois (variation, historique, mouvements) — la date
    // vient de la facture ; un prix en quarantaine (unit_price_ht NULL) est absent
    // Les lignes SANS prix (quarantaine) sont lues elles aussi : sans elles, on
    // ne peut pas dire à quel article il manque un prix À CAUSE d'un refus de
    // lecture — l'écran affichait « pas de prix » pour quatre causes opposées.
    fetchAllPages<any>(() => service.from('invoice_lines')
      .select('article_id, unit_price_ht, invoice_id, invoices!inner(invoice_date)')
      .eq('client_id', clientId)
      .not('article_id', 'is', null)
      .not('unit_price_ht', 'is', null)
      .gte('invoices.invoice_date', cutoff12m)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })),
    // File d'attente d'extraction : PDF présent, lignes jamais lues (ou échec à
    // retenter). Les CHARGES FIXES sont exclues d'office ; le reste passe par la
    // reconnaissance de nature à l'extraction — la CATÉGORIE n'est pas fiable.
    // File de lecture (lot 1, 31/07) : jusqu'ici seules les factures JAMAIS
    // tentées ou en erreur y entraient. Une facture lue PARTIELLEMENT — 17 en
    // prod, 41 prix en quarantaine — n'était donc jamais relue : corriger le
    // prompt ou le seuil ne débloquait rien, la facture restait figée. Idem
    // pour un `no_file` à qui on vient de poser un PDF. Les quatre états
    // relisables sont maintenant dans la file, les jamais-lues d'abord.
    fetchAllPages<any>(() => service.from('invoices')
      .select('id, supplier_name, invoice_date, amount_ht, lines_status, lines_error, lines_checked_at')
      .eq('client_id', clientId)
      .eq('is_fixed_charge', false)
      .not('file_path', 'is', null)
      .or('lines_status.is.null,lines_status.eq.error,lines_status.eq.no_file,lines_status.eq.partial')
      .order('invoice_date', { ascending: false })
      .order('id', { ascending: true }), { max: 5000 }),
  ])
  const articles = refsPage.rows
  const pricePoints = pointsPage.rows
  const pending = pendingPage.rows

  // Fiches recettes utilisatrices — pour « utilisé dans N fiches » et l'impact
  // d'un mouvement de prix (Δprix × quantité brute). Lignes génériques seulement.
  const [{ data: recipesRows }, { data: recipeIngs }] = await Promise.all([
    service.from('recipes')
      .select('id, name, yield_qty, yield_unit')
      .eq('client_id', clientId).eq('active', true),
    service.from('recipe_ingredients')
      .select('recipe_id, generic_id, quantity, qty_unit, loss_pct')
      .eq('client_id', clientId)
      .not('generic_id', 'is', null),
  ])

  // Lignes en QUARANTAINE par réf : un prix a été lu sur la facture mais refusé
  // par les garde-fous. C'est une cause d'absence de prix radicalement différente
  // de « jamais facturé », et le boucher doit pouvoir les distinguer.
  const quarantainePage = await fetchAllPages<any>(() => service.from('invoice_lines')
    .select('article_id')
    .eq('client_id', clientId)
    .is('unit_price_ht', null)
    .not('article_id', 'is', null)
    .order('id', { ascending: true }))
  const quarantaine = quarantainePage.rows
  const quarantaineParArticle = new Map<string, number>()
  for (const q of (quarantaine || []) as any[]) {
    const k = String(q.article_id)
    quarantaineParArticle.set(k, (quarantaineParArticle.get(k) || 0) + 1)
  }

  // Variation : deux derniers prix unitaires distincts par réf, datés par la facture
  const pointsByArticle = new Map<string, { date: string; price: number; invoiceId: string | null }[]>()
  for (const p of (pricePoints || []) as any[]) {
    const date = p.invoices?.invoice_date
    if (!p.article_id || !date) continue
    const arr = pointsByArticle.get(p.article_id) || []
    arr.push({ date, price: parseFloat(p.unit_price_ht), invoiceId: p.invoice_id ? String(p.invoice_id) : null })
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

  // Quantité BRUTE d'un générique par fiche (perte comprise, en unité de base) :
  // brut = net ÷ (1 − perte), g ramenés en kg. Plusieurs lignes d'une même fiche
  // sur le même générique s'additionnent.
  const recipesById = new Map<string, any>((recipesRows || []).map((r: any) => [String(r.id), r]))
  const usageByGeneric = new Map<string, Map<string, number>>()
  for (const ing of (recipeIngs || []) as any[]) {
    const gid = String(ing.generic_id)
    const base = baseByGenericId.get(gid)
    if (!base || !recipesById.has(String(ing.recipe_id))) continue
    const qty = Number(ing.quantity) || 0
    if (qty <= 0) continue
    const qtyBase = base === 'kg' && ing.qty_unit === 'g' ? qty / 1000 : qty
    const loss = Math.min(99, Math.max(0, Number(ing.loss_pct) || 0))
    const brut = qtyBase / (1 - loss / 100)
    const m = usageByGeneric.get(gid) || new Map<string, number>()
    m.set(String(ing.recipe_id), (m.get(String(ing.recipe_id)) || 0) + brut)
    usageByGeneric.set(gid, m)
  }

  // Mouvements de prix des 30 derniers jours, collectés générique par générique
  // (par réf : deux factures consécutives à prix différent = un mouvement).
  // ANOMALIE : un saut de ±25 % ou plus entre deux factures d'une même réf est
  // marqué « à vérifier » — repère de SIGNALEMENT, pas un verdict (une promo ou
  // un effet de saison existent) ; la page pose la question et ouvre la facture.
  const ANOMALIE_PCT = 25
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
          const pct = prev.price !== 0 ? Math.round(((cur.price - prev.price) / prev.price) * 1000) / 10 : null
          moves.push({
            date: cur.date,
            generic_id: g.id,
            generic_name: g.name,
            base_unit: g.base_unit === 'piece' ? 'piece' : 'kg',
            ref_name: r.name,
            supplier_name: r.supplier_name ?? null,
            old_base: round4(prev.price / conv),
            new_base: round4(cur.price / conv),
            pct,
            invoice_id: cur.invoiceId,
            anomalie: pct !== null && Math.abs(pct) >= ANOMALIE_PCT,
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

    // Fiches utilisatrices, la plus grosse consommatrice d'abord
    const usage = usageByGeneric.get(String(g.id))
    const recipes_used = usage
      ? [...usage.entries()]
          .map(([rid, brut]) => {
            const rec = recipesById.get(rid)
            return {
              id: rid,
              name: String(rec.name),
              qty_brute: Math.round(brut * 1000) / 1000,
              yield_qty: rec.yield_qty !== null && rec.yield_qty !== undefined ? Number(rec.yield_qty) : null,
              yield_unit: rec.yield_unit ?? null,
            }
          })
          .sort((a, b) => b.qty_brute - a.qty_brute)
      : []
    // Prix précédent du générique (celui de sa meilleure réf, converti) — pour
    // chiffrer l'impact du dernier mouvement côté page.
    const bestConv = best && best.conversion_factor !== null && Number(best.conversion_factor) > 0 ? Number(best.conversion_factor) : 1

    // POURQUOI ce générique n'a-t-il pas de prix ? Quatre causes distinctes,
    // qui appelaient chacune une action différente et s'affichaient toutes
    // « pas de prix ». On les nomme.
    const prixEnQuarantaine = refs.reduce((n, r) => n + (quarantaineParArticle.get(String(r.id)) || 0), 0)
    const price_missing_reason: string | null = best && best.price_base !== null
      ? null
      : refs.length === 0
        ? 'aucune_ref'
        : refs.some(r => r.needs_conversion)
          ? 'conversion'
          : prixEnQuarantaine > 0
            ? 'quarantaine'
            : 'jamais_facture'

    return {
      ...g,
      default_loss_pct: Number(g.default_loss_pct) || 0,
      refs_count: refs.length,
      prix_quarantaine: prixEnQuarantaine,
      price_missing_reason,
      price_ht: best ? best.price_base : null,
      price_date: best ? best.last_price_date : null,
      price_supplier: best ? best.supplier_name : null,
      variation_pct: best ? best.variation_pct : null,
      prev_price_ht: best && best.previous_price !== null ? round4(best.previous_price / bestConv) : null,
      history: history.slice(-40),
      points_12m: points.length,
      min_12m: points.length > 0 ? Math.min(...points.map(x => x.p)) : null,
      max_12m: points.length > 0 ? Math.max(...points.map(x => x.p)) : null,
      recipes_count: recipes_used.length,
      recipes_used,
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

  // Les factures jamais lues passent devant : ce sont celles qui apportent des
  // prix neufs. Les relectures (partial, error) suivent, la plus récente d'abord.
  const rang = (s: string | null) => (s === null ? 0 : s === 'error' ? 1 : s === 'no_file' ? 2 : 3)
  const pendingOut = [...(pending || [])].sort((a: any, b: any) =>
    rang(a.lines_status) - rang(b.lines_status)
    || String(b.invoice_date || '').localeCompare(String(a.invoice_date || '')))

  // Factures SANS PDF : elles n'entrent pas dans la file (rien à lire), mais
  // elles pèsent — leurs prix manquent à la mercuriale. Le compte est remonté
  // pour que l'écran propose le rattrapage au lieu de laisser un trou muet.
  const { count: sansPdf } = await service.from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId).eq('is_fixed_charge', false).is('file_path', null)

  // Troncature ANNONCÉE. Les quatre lectures sont désormais paginées jusqu'à
  // épuisement ; si l'une bute quand même sur son plafond de sécurité ou sur une
  // erreur Supabase, l'écran doit le dire — un catalogue amputé en silence se
  // lit exactement comme un catalogue complet.
  const incomplet = [
    refsPage.tronque ? 'les réfs fournisseurs' : null,
    pointsPage.tronque ? 'l’historique des prix' : null,
    quarantainePage.tronque ? 'les prix en quarantaine' : null,
    pendingPage.tronque ? 'la file de lecture' : null,
  ].filter((x): x is string => x !== null)
  const erreurLecture = refsPage.erreur ?? pointsPage.erreur ?? quarantainePage.erreur ?? pendingPage.erreur

  return NextResponse.json({
    generics: genericsOut,
    queue: queueOut,
    pending: pendingOut,
    sans_pdf: sansPdf ?? 0,
    moves: movesOut,
    moves_total: moves.length,
    lecture_incomplete: incomplet.length > 0
      ? `Lecture incomplète : ${incomplet.join(', ')}${erreurLecture ? ` (${erreurLecture})` : ''}. Les chiffres affichés sont donc partiels.`
      : null,
  })
}
