// app/api/admin/fiches-sante/route.ts — TABLEAU DE SANTÉ des fiches (lot 30).
//
// À une boucherie, l'état de la chaîne se vérifie à la main. À dix, personne ne
// pensera à ouvrir dix mercuriales : la plateforme doit dire ELLE-MÊME où elle
// va bien et où elle souffre. Cette route agrège, PAR FICHE, tout ce que les
// écrans de boutique savent déjà — mais côte à côte, avec des alertes :
//
//   · la COUVERTURE : quelle part des achats (en €) a été lue ligne à ligne —
//     c'est le chiffre qui dit si la mercuriale reflète la réalité ;
//   · ce qui BLOQUE : factures sans PDF, lectures en échec, prix en
//     quarantaine, classements à confirmer (file de doute) ;
//   · le POULS : dernière synchronisation, dernière lecture, intégration
//     active ou débranchée ;
//   · le COÛT : lectures effectuées et estimation d'API (~1 ct la lecture) —
//     une estimation, étiquetée comme telle, jamais un chiffre comptable.
//
// Réservé aux administrateurs. Les agrégats se calculent en mémoire sur des
// colonnes minimales, paginées — jamais de troncature muette : si une fiche
// dépasse le plafond de lecture, son bilan le dit.

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/admins'
import { fetchAllPages } from '@/lib/fetch-all'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type SanteFiche = {
  client_id: string
  fiche: string
  integration: { provider: string; active: boolean; derniere_synchro: string | null } | null
  factures: {
    total: number
    total_ht: number
    lues: number
    lues_ht: number
    hors_matiere: number
    hors_matiere_ht: number
    en_erreur: number
    en_erreur_ht: number
    sans_pdf: number
    sans_pdf_ht: number
    jamais_lues: number
    jamais_lues_ht: number
    doutes: number
  }
  couverture_pct: number | null
  prix_publies: number
  prix_quarantaine: number
  refs_associees: number
  refs_libres: number
  derniere_lecture: string | null
  lectures: number
  cout_api_estime: number
  bilan_tronque: boolean
  alertes: string[]
}

const r2 = (n: number) => Math.round(n * 100) / 100

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  if (!isAdminEmail(user.email)) return NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 })

  const service = createServiceClient()

  const [{ data: clients }, { data: integs }] = await Promise.all([
    service.from('clients').select('id, name').order('name'),
    service.from('billing_integrations')
      .select('client_id, provider, is_active, last_sync_at')
      .order('last_sync_at', { ascending: false }),
  ])

  // Une intégration par fiche : la plus récemment synchronisée. Une fiche
  // active ET une débranchée (bac à sable) → l'active gagne.
  const integParClient = new Map<string, { provider: string; active: boolean; derniere_synchro: string | null }>()
  for (const i of integs || []) {
    const k = String(i.client_id)
    const exist = integParClient.get(k)
    if (!exist || (!exist.active && i.is_active === true)) {
      integParClient.set(k, {
        provider: String(i.provider ?? ''),
        active: i.is_active === true,
        derniere_synchro: (i.last_sync_at as string) ?? null,
      })
    }
  }

  const maintenant = Date.now()
  const fiches: SanteFiche[] = []

  for (const c of clients || []) {
    const clientId = String(c.id)

    // Colonnes minimales de TOUTES les factures de la fiche, paginées.
    const facturesPage = await fetchAllPages<any>(apres => {
      let q = service.from('invoices')
        .select('id, amount_ht, lines_status, file_path, is_fixed_charge, nature_doute, lines_checked_at, lines_attempts')
        .eq('client_id', clientId)
      if (apres) q = q.gt('id', apres)
      return q.order('id', { ascending: true })
    }, { max: 10000 })
    const invoices = facturesPage.rows

    // Une fiche sans la moindre facture ni intégration n'a pas de santé à
    // surveiller — elle n'encombre pas le tableau.
    const integration = integParClient.get(clientId) ?? null
    if (invoices.length === 0 && !integration) continue

    const f = {
      total: 0, total_ht: 0,
      lues: 0, lues_ht: 0,
      hors_matiere: 0, hors_matiere_ht: 0,
      en_erreur: 0, en_erreur_ht: 0,
      sans_pdf: 0, sans_pdf_ht: 0,
      jamais_lues: 0, jamais_lues_ht: 0,
      doutes: 0,
    }
    let derniereLecture: string | null = null
    let lectures = 0
    for (const inv of invoices as Record<string, unknown>[]) {
      const ht = Math.abs(parseFloat(String(inv.amount_ht ?? 0)) || 0)
      const statut = (inv.lines_status as string) ?? null
      f.total++; f.total_ht += ht
      if (statut === 'done' || statut === 'partial') { f.lues++; f.lues_ht += ht }
      else if (statut === 'hors_matiere') { f.hors_matiere++; f.hors_matiere_ht += ht }
      else if (statut === 'error' || statut === 'scan_illisible') { f.en_erreur++; f.en_erreur_ht += ht }
      if (!inv.file_path && inv.is_fixed_charge !== true) { f.sans_pdf++; f.sans_pdf_ht += ht }
      if (inv.file_path && statut === null) { f.jamais_lues++; f.jamais_lues_ht += ht }
      if (inv.nature_doute === true) f.doutes++
      const lc = (inv.lines_checked_at as string) ?? null
      if (lc && (!derniereLecture || lc > derniereLecture)) derniereLecture = lc
      lectures += Number(inv.lines_attempts) || 0
    }

    // Prix publiés / en quarantaine, réfs associées / libres : des COMPTES,
    // jamais les lignes elles-mêmes.
    const [prixPublies, prixQuarantaine, refsAssociees, refsLibres] = await Promise.all([
      service.from('invoice_lines').select('id', { count: 'exact', head: true })
        .eq('client_id', clientId).not('unit_price_ht', 'is', null),
      service.from('invoice_lines').select('id', { count: 'exact', head: true })
        .eq('client_id', clientId).is('unit_price_ht', null).not('article_id', 'is', null),
      service.from('articles').select('id', { count: 'exact', head: true })
        .eq('client_id', clientId).not('generic_id', 'is', null),
      service.from('articles').select('id', { count: 'exact', head: true })
        .eq('client_id', clientId).is('generic_id', null).eq('ignored', false),
    ])

    // COUVERTURE : part des achats de MATIÈRE (en €) lue ligne à ligne. Les
    // charges reconnues sortent de l'assiette — elles n'ont pas de lignes à
    // donner, les compter en « non lu » punirait le tri d'avoir bien trié.
    const assiette = f.total_ht - f.hors_matiere_ht
    const couverture = assiette > 0 ? Math.round((f.lues_ht / assiette) * 1000) / 10 : null

    // ALERTES : chaque signal nomme son chiffre — un tableau de santé qui dit
    // « attention » sans dire à quoi ne sert à rien.
    const alertes: string[] = []
    if (!integration) alertes.push('aucune intégration comptable')
    else if (!integration.active) alertes.push('intégration débranchée')
    else if (integration.derniere_synchro) {
      const jours = Math.floor((maintenant - new Date(integration.derniere_synchro).getTime()) / 86400000)
      if (jours > 8) alertes.push(`pas de synchronisation depuis ${jours} j`)
    }
    if (f.sans_pdf > 0) alertes.push(`${f.sans_pdf} facture${f.sans_pdf > 1 ? 's' : ''} sans PDF (${r2(f.sans_pdf_ht).toLocaleString('fr-FR')} €)`)
    if (f.en_erreur > 0) alertes.push(`${f.en_erreur} lecture${f.en_erreur > 1 ? 's' : ''} en échec`)
    if (f.doutes > 0) alertes.push(`${f.doutes} classement${f.doutes > 1 ? 's' : ''} à confirmer`)
    if ((prixQuarantaine.count ?? 0) > 0) alertes.push(`${prixQuarantaine.count} prix en quarantaine`)
    if (f.jamais_lues > 0) alertes.push(`${f.jamais_lues} facture${f.jamais_lues > 1 ? 's' : ''} en attente de lecture`)
    if (couverture !== null && couverture < 70) alertes.push(`couverture faible (${couverture.toLocaleString('fr-FR')} % des achats lus)`)
    if (facturesPage.tronque) alertes.push('bilan TRONQUÉ : plafond de lecture atteint, chiffres partiels')

    fiches.push({
      client_id: clientId,
      fiche: String(c.name ?? clientId.slice(0, 8)),
      integration,
      factures: {
        total: f.total, total_ht: r2(f.total_ht),
        lues: f.lues, lues_ht: r2(f.lues_ht),
        hors_matiere: f.hors_matiere, hors_matiere_ht: r2(f.hors_matiere_ht),
        en_erreur: f.en_erreur, en_erreur_ht: r2(f.en_erreur_ht),
        sans_pdf: f.sans_pdf, sans_pdf_ht: r2(f.sans_pdf_ht),
        jamais_lues: f.jamais_lues, jamais_lues_ht: r2(f.jamais_lues_ht),
        doutes: f.doutes,
      },
      couverture_pct: couverture,
      prix_publies: prixPublies.count ?? 0,
      prix_quarantaine: prixQuarantaine.count ?? 0,
      refs_associees: refsAssociees.count ?? 0,
      refs_libres: refsLibres.count ?? 0,
      derniere_lecture: derniereLecture,
      lectures,
      // ~1 centime la lecture (Haiku, texte + secours compris) — une ESTIMATION
      // d'ordre de grandeur pour surveiller la dépense, pas une facture.
      cout_api_estime: r2(lectures * 0.01),
      bilan_tronque: facturesPage.tronque === true,
      alertes,
    })
  }

  // Les fiches qui réclament un œil d'abord — à alerte égale, la plus grosse.
  fiches.sort((a, b) => b.alertes.length - a.alertes.length || b.factures.total_ht - a.factures.total_ht)

  return NextResponse.json({ ok: true, fiches, genere_le: new Date().toISOString() })
}
