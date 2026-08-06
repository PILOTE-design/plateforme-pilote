// GET /api/tresorerie — LE SOLDE, JOUR PAR JOUR.
//
// Le bas du schéma dessiné par Théo : encaissements − décaissements = solde.
// Toute la règle de calcul vit dans `lib/tresorerie` (module pur, 58
// assertions) ; cette route ne fait que RASSEMBLER les entrées et les lui
// passer, comme une page passe le CA à `computeWeekEconomics`.
//
// Les deux sources :
//   · ENTRÉES — les relevés de caisse d'UNE JOURNÉE (`financier_jours`,
//     nb_jours = 1), reçus par e-mail (lot 103). Un relevé qui couvre
//     plusieurs jours n'est pas réparti : il est compté à part et annoncé.
//   · SORTIES — les échéances de factures (`invoices.due_date`), TTC : c'est
//     ce qui sort du compte, pas le HT des marges.
//
// Les charges récurrentes ne sont PAS datées : une provision dit combien coûte
// une période, pas quel jour l'argent part. Elles sont rendues en TOTAL, à côté
// du solde, jamais dans la courbe.
//
// CE QUE CETTE ROUTE NE SAIT PAS, et qu'elle dit :
//   · les SALAIRES ne sont pas comptés (le planning reste hors trésorerie,
//     décision du client) — le solde est donc optimiste ;
//   · aucune facture n'est jamais marquée réglée en base, donc une échéance
//     passée est une échéance DUE, pas une sortie constatée ;
//   · sans relevé bancaire, il n'y a pas de solde d'ouverture : le chiffre
//     rendu est une VARIATION cumulée, pas une position de compte.
import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { fetchAllPages } from '@/lib/fetch-all'
import { lireFinanciers } from '@/lib/financier-store'
import { costForWindow, type RecurringCharge, type RecurringActual } from '@/lib/recurring-charges'
import {
  calculeTresorerie, phraseReserves, jourValide,
  type EcheanceFacture, type JourneeEncaissee,
} from '@/lib/tresorerie'

export const dynamic = 'force-dynamic'

/** Fenêtre par défaut : la semaine écoulée et les trois à venir. Assez pour
 *  voir arriver une échéance, pas assez pour noyer l'écran. */
const JOURS_AVANT = 7
const JOURS_APRES = 21

const JOUR_MS = 86400000
const isoJour = (t: number) => new Date(t).toISOString().slice(0, 10)
const round2 = (n: number) => Math.round(n * 100) / 100

export async function GET(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Aucune boutique' }, { status: 404 })

  const params = new URL(req.url).searchParams
  const aujourdHui = isoJour(Date.now())
  const p0 = params.get('debut')
  const p1 = params.get('fin')
  const debut = jourValide(p0) ? p0 : isoJour(Date.now() - JOURS_AVANT * JOUR_MS)
  const fin = jourValide(p1) ? p1 : isoJour(Date.now() + JOURS_APRES * JOUR_MS)
  if (debut > fin) {
    return NextResponse.json({ error: 'Fenêtre inversée : début postérieur à fin' }, { status: 400 })
  }

  // ── Les échéances de factures ───────────────────────────────────────────
  // Les factures POINTÉES RÉGLÉES sont lues comme les autres : c'est le moteur
  // qui les met à part (`reserves.reglees`), pas la requête. Les écarter ici
  // les ferait disparaître de l'écran sans que personne ne puisse les
  // dépointer.
  // Paginée : une boutique accumule des centaines de factures par an, et
  // PostgREST s'arrête silencieusement à 1000 lignes.
  const facturesPage = await fetchAllPages<any>(apres => {
    let q = service.from('invoices')
      .select('id, supplier_name, amount_ttc, amount_ht, due_date, payment_status, is_fixed_charge, paid_at')
      .eq('client_id', clientId)
      .not('due_date', 'is', null)
      .gte('due_date', debut)
      .lte('due_date', fin)
    if (apres) q = q.gt('id', apres)
    return q.order('id', { ascending: true })
  })

  // Les factures SANS échéance sont lues à part : le moteur doit pouvoir les
  // compter et les nommer, sinon leur montant disparaîtrait du tableau sans
  // que personne ne s'en aperçoive.
  const sansEcheancePage = await fetchAllPages<any>(apres => {
    let q = service.from('invoices')
      .select('id, supplier_name, amount_ttc, amount_ht, due_date, payment_status, is_fixed_charge, paid_at')
      .eq('client_id', clientId)
      .is('due_date', null)
      .gte('invoice_date', debut)
      .lte('invoice_date', fin)
    if (apres) q = q.gt('id', apres)
    return q.order('id', { ascending: true })
  })

  const versEcheance = (r: any): EcheanceFacture => ({
    id: String(r.id),
    fournisseur: String(r.supplier_name ?? 'Fournisseur inconnu'),
    // TTC quand il est là ; sinon le HT, et l'écart est assumé plutôt que
    // d'inventer un taux de TVA facture par facture.
    montantTtc: Number(r.amount_ttc ?? r.amount_ht ?? 0) || 0,
    echeance: typeof r.due_date === 'string' ? r.due_date : null,
    statutPaiement: (r.payment_status as string | null) ?? null,
    // La date de pointage, ramenée au jour : le moteur raisonne en journées.
    regleLe: typeof r.paid_at === 'string' ? r.paid_at.slice(0, 10) : null,
    chargeFixe: Boolean(r.is_fixed_charge),
  })

  const factures = [...facturesPage.rows, ...sansEcheancePage.rows].map(versEcheance)

  // ── Les journées encaissées ─────────────────────────────────────────────
  const { lignes: releves, erreur: erreurReleves } = await lireFinanciers(service, clientId, debut, fin)
  // L'ENCAISSÉ D'ABORD, LE CA SEULEMENT À DÉFAUT.
  //
  // Les deux diffèrent des comptes clients : sur le relevé S31 de la boucherie,
  // 18 347,75 € de CA pour 17 456,55 € encaissés — 891,20 € vendus mais pas
  // rentrés. Compter le CA dans une trésorerie ferait entrer un argent qui
  // n'est pas là.
  //
  // Quand l'encaissé n'a pas pu être confirmé (ventilation non recoupée par le
  // total du relevé), on retombe sur le CA plutôt que de perdre la journée —
  // mais on COMPTE ces journées et on le dit : c'est une surestimation connue,
  // pas une équivalence.
  // LES BONS D'ACHAT SORTENT DU SOLDE. Un bon d'achat consommé solde bien un
  // ticket — il figure donc dans le total encaissé que la caisse imprime — mais
  // aucun euro n'arrive sur le compte : c'est un avoir émis autrefois qu'on
  // reprend aujourd'hui. Le compter en trésorerie ferait entrer deux fois le
  // même argent, à l'émission du bon puis à son utilisation.
  //
  // Ils ne sont pas effacés pour autant : leur total est rendu et écrit à
  // l'écran. Une exclusion muette se lit comme une erreur de caisse.
  let journeesAuCa = 0
  let bonsAchatExclus = 0
  const journees: JourneeEncaissee[] = releves
    .filter(r => r.nb_jours === 1)
    .map(r => {
      const encaisse = r.encaisse_ttc === null || r.encaisse_ttc === undefined
        ? null
        : Number(r.encaisse_ttc)
      const confirme = encaisse !== null && Number.isFinite(encaisse)
      if (!confirme) journeesAuCa++

      // Le retrait ne vaut que sur un encaissé CONFIRMÉ : sur un repli au CA,
      // la ventilation n'est pas publiable, donc on ne sait pas ce qu'elle
      // contient et on ne retire rien à l'aveugle.
      const bons = confirme ? Number(r.reglements?.bon_achat ?? 0) || 0 : 0
      bonsAchatExclus += bons

      return {
        jour: r.date_debut,
        caTtc: confirme ? round2((encaisse as number) - bons) : (Number(r.ca_ttc) || 0),
        reglements: r.reglements,
      }
    })

  // Un relevé multi-jours ne se répartit pas : on le compte à part, on le dit.
  const relevesMultiJours = releves.filter(r => r.nb_jours > 1)
  const caMultiJours = round2(relevesMultiJours.reduce((s, r) => s + (Number(r.ca_ttc) || 0), 0))

  // ── La provision des charges récurrentes ────────────────────────────────
  const { data: chargesData } = await service
    .from('recurring_charges')
    .select('id, label, category, amount_ht, tva_rate, periodicity, start_date, end_date, active')
    .eq('client_id', clientId)
    .eq('active', true)

  const charges = (chargesData ?? []) as unknown as RecurringCharge[]

  const { data: reelsData } = await service
    .from('recurring_actuals')
    .select('id, recurring_charge_id, period_start, period_end, amount_ht, created_at')
    .eq('client_id', clientId)

  const reels = (reelsData ?? []) as unknown as RecurringActual[]

  // Le coût d'une charge sur la fenêtre est HT ; ce qui sort du compte est TTC.
  let provisionRecurrentes = 0
  for (const c of charges) {
    const reelsDeLaCharge = reels.filter(r => r.recurring_charge_id === c.id)
    const ht = costForWindow(c, reelsDeLaCharge, debut, fin)
    const taux = Number(c.tva_rate)
    provisionRecurrentes += Number.isFinite(taux) && taux > 0 ? ht * (1 + taux / 100) : ht
  }

  const bilan = calculeTresorerie({
    debut, fin, aujourdHui,
    factures,
    journees,
    provisionRecurrentes: round2(provisionRecurrentes),
  })

  return NextResponse.json({
    ...bilan,
    phrase_reserves: phraseReserves(bilan),
    // Les lectures incomplètes remontent jusqu'à l'écran : un total sur une
    // lecture tronquée n'est pas un total.
    lecture_incomplete: facturesPage.tronque || sansEcheancePage.tronque || Boolean(erreurReleves),
    releves_multi_jours: { nombre: relevesMultiJours.length, ca_ttc: caMultiJours },
    // Journées comptées au CA faute d'encaissé confirmé : leur montant est
    // SURESTIMÉ de ce qui est parti en compte client.
    journees_au_ca: journeesAuCa,
    // Retirés du solde parce qu'aucun euro n'arrive en banque — et annoncés,
    // parce qu'une exclusion muette se lit comme une erreur de caisse.
    bons_achat_exclus: round2(bonsAchatExclus),
  })
}
