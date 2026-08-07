// Fiche produit de la mercuriale — le DÉTAIL d'achat d'un générique (lot 41,
// modèle Otami) : chaque ligne de facture des 12 derniers mois ramenée à
// l'unité de base, les volumes par mois, la moyenne 3 mois et la dépense
// cumulée facture par facture.
//
// Endpoint SÉPARÉ du GET /api/mercuriale : le catalogue sert tous les
// génériques d'un coup et n'a pas à transporter l'historique facture par
// facture de chacun — la fiche se charge à l'OUVERTURE du produit, pour un
// seul générique à la fois.
//
// Mêmes règles que partout ailleurs dans la mercuriale, et chaque écart est
// COMPTÉ et annoncé, jamais tu :
//   · seuls les prix VÉRIFIÉS participent (une ligne en quarantaine a
//     unit_price_ht NULL — leur nombre est renvoyé, pas leur contenu) ;
//   · une réf facturée dans une unité incompatible avec la base SANS facteur
//     de conversion est écartée (ses lignes sont comptées à part) ;
//   · prix, quantités et montants sont ramenés à l'unité de base par le
//     facteur de la réf : prix_base = prix / conv, qte_base = qte × conv —
//     le montant, lui, vient de la facture (amount_ht), pas d'un recalcul.
import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { unitKind } from '@/lib/mercuriale-auto'
import { fetchAllPages } from '@/lib/fetch-all'
import { sautDePrix, type LecturePrix } from '@/lib/prix-saut'

export const dynamic = 'force-dynamic'

const round2 = (n: number) => Math.round(n * 100) / 100
const round3 = (n: number) => Math.round(n * 1000) / 1000
const round4 = (n: number) => Math.round(n * 10000) / 10000

/** Plafond de lignes renvoyées à l'écran — le TOTAL, lui, est toujours annoncé. */
const PLAFOND_LIGNES = 400

export async function GET(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const genericId = new URL(req.url).searchParams.get('generic')
  if (!genericId) return NextResponse.json({ error: 'Paramètre generic manquant' }, { status: 400 })

  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Aucune boutique' }, { status: 404 })

  const { data: generic } = await service.from('generic_articles')
    .select('id, name, base_unit')
    .eq('client_id', clientId).eq('id', genericId)
    .maybeSingle()
  if (!generic) return NextResponse.json({ error: 'Article introuvable' }, { status: 404 })
  const base: 'kg' | 'piece' = generic.base_unit === 'piece' ? 'piece' : 'kg'

  // Paginée : un générique très fréquenté peut porter des centaines de réfs.
  const refsPage = await fetchAllPages<any>(apres => {
    let q = service.from('articles')
      .select('id, name, unit, conversion_factor')
      .eq('client_id', clientId).eq('generic_id', genericId)
    if (apres) q = q.gt('id', apres)
    return q.order('id', { ascending: true })
  })
  const refs = refsPage.rows

  // Par réf : le facteur de conversion vers l'unité de base, et le marqueur
  // « écartée » (unité incompatible sans facteur) — même règle que le prix du
  // jour et l'historique du catalogue, rien d'inventé.
  const parRef = new Map<string, { name: string; conv: number; ecartee: boolean; unit: string | null }>()
  for (const r of (refs || []) as any[]) {
    const hasConv = r.conversion_factor !== null && Number(r.conversion_factor) > 0
    const kind = unitKind(r.unit)
    const ecartee = kind !== null && kind !== base && !hasConv
    // L'unité de la réf voyage avec elle : `sautDePrix` en a besoin pour lire
    // le conditionnement du libellé dans la bonne famille (un « 5L » sur une
    // ligne au kilo ne dit pas la même chose qu'un « 5KG »).
    parRef.set(String(r.id), { name: String(r.name), conv: hasConv ? Number(r.conversion_factor) : 1, ecartee, unit: r.unit ?? null })
  }
  const ids = [...parRef.keys()]

  // Fenêtres : lignes sur 365 jours ; moyenne « 3 mois » sur 90 jours ; la
  // grille mensuelle couvre les 12 mois CALENDAIRES finissant ce mois-ci (les
  // quelques jours du 13e mois entamé restent dans les totaux, hors du dessin).
  const cutoff12m = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)
  const cutoff3m = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
  const moisCles: string[] = []
  {
    const d = new Date()
    d.setUTCDate(1)
    d.setUTCMonth(d.getUTCMonth() - 11)
    for (let i = 0; i < 12; i++) {
      moisCles.push(d.toISOString().slice(0, 7))
      d.setUTCMonth(d.getUTCMonth() + 1)
    }
  }

  const lignesPage = ids.length === 0
    ? { rows: [] as any[], tronque: false, erreur: null as string | null }
    : await fetchAllPages<any>(apres => {
        let q = service.from('invoice_lines')
          .select('id, article_id, quantity, unit_price_ht, amount_ht, invoice_id, invoices!inner(invoice_date, supplier_name, invoice_number)')
          .eq('client_id', clientId)
          .in('article_id', ids)
          .not('unit_price_ht', 'is', null)
          .gte('invoices.invoice_date', cutoff12m)
        if (apres) q = q.gt('id', apres)
        return q.order('id', { ascending: true })
      }, { max: 5000 })

  // Prix refusés à la lecture sur la fenêtre : comptés pour être DITS — un
  // historique qui tait ses trous se lit comme un historique complet.
  let quarantaine12m = 0
  if (ids.length > 0) {
    const { count } = await service.from('invoice_lines')
      .select('id, invoices!inner(invoice_date)', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .in('article_id', ids)
      .is('unit_price_ht', null)
      .gte('invoices.invoice_date', cutoff12m)
    quarantaine12m = count ?? 0
  }

  type LigneBrute = {
    id: string; d: string; fournisseur: string | null; numero: string | null
    invoice_id: string | null; ref: string; qte: number | null; pu: number; montant: number | null
    /** Unité de la RÉF facturée. Elle ne sort pas vers l'écran (l'historique
     *  affiche tout dans l'unité de base) : elle sert au seul `sautDePrix`, qui
     *  en a besoin pour lire le conditionnement du libellé dans la bonne
     *  famille — un « 5L » sur une ligne au kilo ne dit pas la même chose. */
    unit: string | null
  }
  const brutes: LigneBrute[] = []
  let ecartees = 0
  for (const l of lignesPage.rows) {
    const r = parRef.get(String(l.article_id))
    if (!r) continue
    if (r.ecartee) { ecartees++; continue }
    const d = l.invoices?.invoice_date
    const pu = parseFloat(l.unit_price_ht)
    if (!d || !Number.isFinite(pu)) continue
    const qty = l.quantity !== null && l.quantity !== undefined ? Number(l.quantity) : null
    const qte = qty !== null && Number.isFinite(qty) ? round3(qty * r.conv) : null
    const montantBrut = l.amount_ht !== null && l.amount_ht !== undefined
      ? Number(l.amount_ht)
      : (qty !== null ? qty * pu : null)
    brutes.push({
      id: String(l.id),
      d: String(d),
      fournisseur: l.invoices?.supplier_name ?? null,
      numero: l.invoices?.invoice_number ?? null,
      invoice_id: l.invoice_id ? String(l.invoice_id) : null,
      ref: r.name,
      qte,
      unit: r.unit,
      pu: round4(pu / r.conv),
      montant: montantBrut !== null && Number.isFinite(montantBrut) ? round2(montantBrut) : null,
    })
  }

  // Cumul CHRONOLOGIQUE (du plus ancien au plus récent) : la dernière ligne
  // porte la dépense 12 mois entière. L'écran affiche du plus récent au plus
  // ancien — chaque ligne garde le cumul atteint à sa date.
  brutes.sort((a, b) => a.d.localeCompare(b.d) || a.id.localeCompare(b.id))
  let cumul = 0
  const lignesAsc = brutes.map(l => {
    cumul = round2(cumul + (l.montant ?? 0))
    return { ...l, cumul }
  })

  // Grille mensuelle : quantités, montants, nombre d'achats et prix moyen payé
  // le mois (moyenne simple des prix relevés — même famille que min/max 12 mois).
  const mois = moisCles.map(m => ({ m, qte: 0, montant: 0, nb: 0, prix_moyen: null as number | null }))
  const parMois = new Map(mois.map(x => [x.m, x] as const))
  const sommePrix = new Map<string, { s: number; n: number }>()
  for (const l of lignesAsc) {
    const b = parMois.get(l.d.slice(0, 7))
    if (!b) continue
    b.nb += 1
    if (l.qte !== null) b.qte = round3(b.qte + l.qte)
    if (l.montant !== null) b.montant = round2(b.montant + l.montant)
    const sp = sommePrix.get(b.m) || { s: 0, n: 0 }
    sp.s += l.pu
    sp.n += 1
    sommePrix.set(b.m, sp)
  }
  for (const b of mois) {
    const sp = sommePrix.get(b.m)
    if (sp && sp.n > 0) b.prix_moyen = round4(sp.s / sp.n)
  }

  const moyenne = (a: number[]) => (a.length > 0 ? round4(a.reduce((s, x) => s + x, 0) / a.length) : null)
  const lignes = lignesAsc.slice().reverse()

  // UN PRIX QUI EST LE MULTIPLE ENTIER DU PRÉCÉDENT N'EST PAS UNE HAUSSE.
  //
  // Mesuré en production le 07/08/2026 : trois articles portent un prix valant
  // exactement un multiple entier d'une autre lecture du même article — une
  // lecture comptait les colis, l'autre les kilos. Les deux lignes sont
  // pourtant cohérentes avec elles-mêmes (`qté × PU = montant` tombe juste des
  // deux côtés), donc aucun garde-fou existant ne les voit. Seule la SÉRIE le
  // dit, et c'est ici qu'on l'a sous la main.
  //
  // On n'affiche RIEN de corrigé : on nomme les deux lectures et on laisse le
  // boucher trancher. Le lot 57 a fabriqué 38 quantités fausses sur 52 en
  // voulant réparer ce genre de chose.
  const saut = sautDePrix(lignesAsc.map<LecturePrix>(l => ({
    date: l.d,
    prix: l.pu,
    quantite: l.qte,
    montant: l.montant,
    designation: l.ref,
    unite: l.unit ?? null,
    facture: l.numero,
  })))

  return NextResponse.json({
    generic: { id: generic.id, name: generic.name, base_unit: base },
    moy_3m: moyenne(lignesAsc.filter(l => l.d >= cutoff3m).map(l => l.pu)),
    moy_12m: moyenne(lignesAsc.map(l => l.pu)),
    total_12m: round2(lignesAsc.reduce((s, l) => s + (l.montant ?? 0), 0)),
    qte_12m: round3(lignesAsc.reduce((s, l) => s + (l.qte ?? 0), 0)),
    mois,
    lignes: lignes.slice(0, PLAFOND_LIGNES),
    lignes_total: lignes.length,
    lignes_ecartees: ecartees,
    quarantaine_12m: quarantaine12m,
    saut_de_prix: saut,
    lecture_incomplete: lignesPage.tronque
      ? `Historique incomplet${lignesPage.erreur ? ` (${lignesPage.erreur})` : ''} — les chiffres affichés sont partiels.`
      : null,
  })
}
