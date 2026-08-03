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
import { appliquerDictionnaire } from '@/lib/association-dictionary'
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

  // DICTIONNAIRE PLATEFORME (lot 28) d'abord : les associations décidées sur
  // une boucherie profitent aux suivantes — libellés et facteurs, jamais de
  // prix. Puis l'association automatique des réfs sans ressemblance. L'ordre
  // compte : le jugement humain hérité passe avant la mécanique, et une réf
  // que le dictionnaire vient d'associer n'est plus libre pour la suite.
  await appliquerDictionnaire(service, clientId)
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
    fetchAllPages<any>(apres => {
      let q = service.from('articles')
        .select('id, name, unit, supplier_name, article_code, last_price_ht, last_price_date, price_count, generic_id, conversion_factor, ignored, updated_at')
        .eq('client_id', clientId)
      if (apres) q = q.gt('id', apres)
      return q.order('id', { ascending: true })
    }),
    // Points de prix sur 12 mois (variation, historique, mouvements) — la date
    // vient de la facture ; un prix en quarantaine (unit_price_ht NULL) est absent
    // Les lignes SANS prix (quarantaine) sont lues elles aussi : sans elles, on
    // ne peut pas dire à quel article il manque un prix À CAUSE d'un refus de
    // lecture — l'écran affichait « pas de prix » pour quatre causes opposées.
    fetchAllPages<any>(apres => {
      let q = service.from('invoice_lines')
        .select('id, article_id, unit_price_ht, invoice_id, invoices!inner(invoice_date)')
        .eq('client_id', clientId)
        .not('article_id', 'is', null)
        .not('unit_price_ht', 'is', null)
        .gte('invoices.invoice_date', cutoff12m)
      if (apres) q = q.gt('id', apres)
      return q.order('id', { ascending: true })
    }),
    // File d'attente d'extraction : PDF présent, lignes jamais lues (ou échec à
    // retenter). Les CHARGES FIXES sont exclues d'office ; le reste passe par la
    // reconnaissance de nature à l'extraction — la CATÉGORIE n'est pas fiable.
    // File de lecture (lot 1, 31/07) : jusqu'ici seules les factures JAMAIS
    // tentées ou en erreur y entraient. Une facture lue PARTIELLEMENT — 17 en
    // prod, 41 prix en quarantaine — n'était donc jamais relue : corriger le
    // prompt ou le seuil ne débloquait rien, la facture restait figée. Idem
    // pour un `no_file` à qui on vient de poser un PDF. Les quatre états
    // relisables sont maintenant dans la file, les jamais-lues d'abord.
    fetchAllPages<any>(apres => {
      let q = service.from('invoices')
        .select('id, supplier_name, invoice_date, amount_ht, lines_status, lines_error, lines_checked_at')
        .eq('client_id', clientId)
        .eq('is_fixed_charge', false)
        .not('file_path', 'is', null)
        .or('lines_status.is.null,lines_status.eq.error,lines_status.eq.no_file,lines_status.eq.partial')
      if (apres) q = q.gt('id', apres)
      return q.order('id', { ascending: true })
    }, { max: 5000 }),
  ])
  // La pagination se fait par identifiant (seul tri stable). L'ordre d'affichage
  // — la réf touchée le plus récemment d'abord — est rétabli ici, en mémoire.
  const articles = refsPage.rows
    .slice()
    .sort((a: any, b: any) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
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
  const quarantainePage = await fetchAllPages<any>(apres => {
    let q = service.from('invoice_lines')
      .select('id, article_id')
      .eq('client_id', clientId)
      .is('unit_price_ht', null)
      .not('article_id', 'is', null)
    if (apres) q = q.gt('id', apres)
    return q.order('id', { ascending: true })
  })
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
    // La FACTURE d'où vient le dernier prix : sans elle, impossible de trancher
    // « est-ce le même produit ? » depuis la file de rapprochement — alors que
    // les lignes de mouvement ouvrent la facture depuis #154.
    return {
      ...a,
      last_price_ht: last,
      previous_price, variation_pct, price_base, needs_conversion,
      last_invoice_id: pts[0]?.invoiceId ?? null,
      last_seen: pts[0]?.date ?? a.last_price_date ?? null,
    }
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
    // Le FOURNISSEUR voyage avec chaque point : c'est lui qui permet de dire
    // « 12,40 € chez Aubret → 13,90 € chez Metro » plutôt qu'un écart anonyme.
    const points: { d: string; p: number; s: string | null }[] = []
    for (const r of refs) {
      if (r.needs_conversion) continue
      const conv = r.conversion_factor !== null && Number(r.conversion_factor) > 0 ? Number(r.conversion_factor) : 1
      const rpts = (pointsByArticle.get(r.id) || []).slice().sort((a, b) => a.date.localeCompare(b.date))
      for (const pt of rpts) points.push({ d: pt.date, p: round4(pt.price / conv), s: r.supplier_name ?? null })
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
    // sont regroupés. Les points voyagent AVEC leur date — la page les place
    // désormais sur un axe de temps, plus sur leur rang (M11).
    const history: { d: string; p: number }[] = []
    for (const pt of points) {
      if (history.length === 0 || history[history.length - 1].p !== pt.p) history.push({ d: pt.d, p: pt.p })
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
    // Prix PRÉCÉDENT DU GÉNÉRIQUE — toutes réfs confondues (M10).
    //
    // C'était jusqu'ici le prix précédent de la seule MEILLEURE RÉF. Quand le
    // dernier achat change de fournisseur, le prix du jour saute mais le prix
    // « précédent » restait celui du nouveau fournisseur — souvent identique.
    // Le bloc « impact sur les fiches recettes » annonçait alors zéro impact
    // PRÉCISÉMENT quand le coût venait de bouger, et le KPI « prix en hausse »
    // ratait le mouvement. On lit maintenant la série du générique : le dernier
    // prix payé AVANT celui du jour et DIFFÉRENT de lui, quel que soit le
    // fournisseur — avec son nom, pour que l'écran puisse dire chez qui.
    // Le prix du jour est ARRONDI comme les points de la série avant toute
    // comparaison. Sans cet arrondi, une réf à facteur de conversion faisait
    // échouer l'égalité stricte — 23,168 ÷ 1,5 vaut 15,445333333333332 côté prix
    // du jour et 15,4453 côté série : la boucle retenait alors le point du jour
    // LUI-MÊME comme « précédent » et annonçait 0 % de variation. Mesuré sur
    // l'Andouille : −46 % réels affichés en « aucun mouvement ». (lot 10)
    const prixJour = best && best.price_base !== null ? round4(best.price_base) : null
    // Date de référence : celle du prix affiché, ou à défaut celle du dernier
    // point connu — sinon un générique sans last_price_date n'aurait jamais de
    // précédent.
    const dateJour = (best && String(best.last_price_date || ''))
      || (points.length > 0 ? points[points.length - 1].d : '')
    let prevPoint: { d: string; p: number; s: string | null } | null = null
    if (prixJour !== null && dateJour) {
      for (let i = points.length - 1; i >= 0; i--) {
        const pt = points[i]
        // STRICTEMENT antérieur : deux fournisseurs livrés le MÊME jour ne sont
        // pas un mouvement de prix, c'est un choix d'achat. Le tolérer inventait
        // une hausse (ou une baisse, selon lequel des deux passait en tête) sur
        // un générique dont aucun prix n'avait bougé. (lot 10)
        if (pt.d >= dateJour) continue
        // Écart sous le dixième de centime : c'est le même prix.
        if (Math.abs(pt.p - prixJour) < 0.00005) continue
        prevPoint = pt
        break
      }
    }
    // Variation DU GÉNÉRIQUE (et non de sa meilleure réf) : c'est elle qui
    // alimente le KPI « prix en hausse » et le filtre du catalogue.
    const variationGenerique = prixJour !== null && prevPoint !== null && prevPoint.p !== 0
      ? Math.round(((prixJour - prevPoint.p) / prevPoint.p) * 1000) / 10
      : null

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
      price_ht: prixJour,
      price_date: best ? best.last_price_date : null,
      price_supplier: best ? best.supplier_name : null,
      variation_pct: variationGenerique,
      /** Variation de la seule meilleure réf — conservée pour le détail par réf */
      variation_ref_pct: best ? best.variation_pct : null,
      prev_price_ht: prevPoint ? prevPoint.p : null,
      prev_price_supplier: prevPoint ? prevPoint.s : null,
      prev_price_date: prevPoint ? prevPoint.d : null,
      history: history.slice(-40),
      /** Nombre de points écartés par le plafond d'affichage de la courbe :
       *  sans lui, le « Min 12 mois » pouvait porter sur un prix absent du
       *  dessin, sans que rien ne le signale (M11). */
      history_tronque: Math.max(0, history.length - 40),
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

  // FILE DE DOUTE (lot 29) : les classements matière/charge fragiles, à
  // trancher d'un clic. Le motif dit pourquoi le tri a douté ; le statut dit
  // dans quel sens il avait penché.
  const { data: doutes } = await service.from('invoices')
    .select('id, supplier_name, invoice_date, amount_ht, lines_status, lines_error')
    .eq('client_id', clientId).eq('nature_doute', true)
    .order('invoice_date', { ascending: false })
    .limit(100)

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

  // ── VUE PAR FOURNISSEUR (lot 40, modèle Otami) : la dépense réelle chez
  // chaque maison sur 12 mois — factures matière uniquement (jamais les charges
  // fixes). Les réfs, dates de dernier achat et tendances viennent des réfs déjà
  // renvoyées ; ici, seulement ce que les réfs ne savent pas dire : l'argent.
  // Les libellés partent BRUTS — la page les nettoie (nomFournisseur) et
  // fusionne les variantes d'un même nom.
  const cutoffFournisseurs = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)
  const { data: factures12m } = await service.from('invoices')
    .select('supplier_name, amount_ht, invoice_date')
    .eq('client_id', clientId).eq('is_fixed_charge', false)
    .gte('invoice_date', cutoffFournisseurs)
    .limit(5000)
  const depenseParFournisseur = new Map<string, { depense: number; factures: number; derniere: string | null }>()
  for (const f of factures12m || []) {
    const nom = String(f.supplier_name || '').trim()
    if (!nom) continue
    const cur = depenseParFournisseur.get(nom) || { depense: 0, factures: 0, derniere: null }
    cur.depense += Number(f.amount_ht) || 0
    cur.factures += 1
    const d = String(f.invoice_date || '')
    if (d && (!cur.derniere || d > cur.derniere)) cur.derniere = d
    depenseParFournisseur.set(nom, cur)
  }
  const fournisseursOut = [...depenseParFournisseur.entries()]
    .map(([nom, v]) => ({
      nom,
      depense_12m: Math.round(v.depense * 100) / 100,
      factures_12m: v.factures,
      derniere_facture: v.derniere,
    }))
    .sort((a, b) => b.depense_12m - a.depense_12m)

  return NextResponse.json({
    generics: genericsOut,
    queue: queueOut,
    pending: pendingOut,
    fournisseurs: fournisseursOut,
    doutes: doutes || [],
    sans_pdf: sansPdf ?? 0,
    moves: movesOut,
    moves_total: moves.length,
    lecture_incomplete: incomplet.length > 0
      ? `Lecture incomplète : ${incomplet.join(', ')}${erreurLecture ? ` (${erreurLecture})` : ''}. Les chiffres affichés sont donc partiels.`
      : null,
  })
}
