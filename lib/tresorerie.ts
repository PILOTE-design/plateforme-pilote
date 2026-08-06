// lib/tresorerie.ts — LE SOLDE, JOUR PAR JOUR.
//
// Module PUR, testable hors ligne. Aucun accès base : tout entre par les
// paramètres, comme `computeWeekEconomics` reçoit son CA. C'est ce qui rendra
// remplaçable la source des entrées (relevé de caisse aujourd'hui, caisse
// connectée demain) sans toucher au moindre calcul.
//
// ─── CE QUE CE MOTEUR CALCULE, ET CE QU'IL NE CALCULE PAS ─────────────────
//
// Il calcule : ENCAISSEMENTS − DÉCAISSEMENTS = SOLDE, jour par jour, sur une
// fenêtre choisie, exactement le bas du schéma de Théo.
//
// Il ne calcule PAS un solde de compte bancaire. Trois raisons, et chacune est
// ANNONCÉE dans le bilan plutôt que masquée par un chiffre plausible :
//
//  1. LES SALAIRES N'Y SONT PAS. Décision du client : le planning reste hors
//     trésorerie. C'est une des plus grosses sorties de la semaine, donc le
//     solde est structurellement OPTIMISTE. `reserves.salaires_absents` le
//     porte, et l'écran doit l'écrire à côté du solde. Le jour où on voudra
//     les compter, `lib/payroll` est déjà là et rien d'autre ne bougera.
//  2. PILOTE NE SAIT PAS CE QUI A DÉJÀ ÉTÉ PAYÉ. `invoices.payment_status` ne
//     vaut aujourd'hui que « to_be_processed » ou rien : aucune facture n'est
//     jamais marquée réglée. Une échéance passée est donc une échéance DUE,
//     pas une sortie constatée. Le bilan compte ces retards à part et le dit.
//  3. IL N'Y A PAS DE SOLDE DE DÉPART. Sans relevé bancaire, on ne connaît que
//     les MOUVEMENTS. Le solde rendu est donc une VARIATION cumulée, pas une
//     position de compte — et il part de zéro, ou du solde d'ouverture que
//     l'appelant fournit s'il en connaît un.
//
// ─── POURQUOI LES CHARGES RÉCURRENTES N'ONT PAS DE DATE ───────────────────
//
// Une charge récurrente est une PROVISION : elle dit combien coûte une période,
// pas quel jour l'argent sort. Lui inventer une date de décaissement (le 5 du
// mois, le dernier jour…) fabriquerait un solde faux à quelques jours près sur
// chaque ligne. Elles entrent donc dans le bilan comme un TOTAL PROVISIONNÉ sur
// la fenêtre, à côté du solde, jamais dans la courbe. Ce qui est daté, ce sont
// les FACTURES : elles portent une échéance lue sur le document.

/** Une facture qui attend son règlement. */
export type EcheanceFacture = {
  id: string
  fournisseur: string
  /** TTC : c'est ce qui sort du compte, pas le HT des marges. */
  montantTtc: number
  /** AAAA-MM-JJ, ou null quand le document ne portait pas d'échéance. */
  echeance: string | null
  /** Tel quel en base. */
  statutPaiement: string | null
  /** Date de pointage du règlement, AAAA-MM-JJ. null = non pointée.
   *  Distincte de l'échéance : payer en retard est le cas courant, et confondre
   *  les deux daterait le décaissement du mauvais jour. */
  regleLe?: string | null
  /** Une charge de structure sort du compte comme une autre facture. */
  chargeFixe?: boolean
}

/** Une journée encaissée, telle que le relevé de caisse l'a donnée. */
export type JourneeEncaissee = {
  /** AAAA-MM-JJ */
  jour: string
  /** CA TTC de la journée */
  caTtc: number
  /** Ventilation publiable par mode de règlement, quand elle existe */
  reglements?: Record<string, number> | null
}

export type EntreeTresorerie = {
  jour: string
  montant: number
  /** Ce qui a produit ce montant, pour que l'écran puisse l'expliquer. */
  origine: 'releve_caisse'
}

export type SortieTresorerie = {
  jour: string
  montant: number
  libelle: string
  factureId: string
  chargeFixe: boolean
  /** true quand l'échéance est passée et que rien n'atteste d'un règlement. */
  enRetard: boolean
}

export type JourTresorerie = {
  jour: string
  encaissements: number
  decaissements: number
  /** encaissements − décaissements du jour */
  mouvement: number
  /** cumul depuis le début de la fenêtre (+ solde d'ouverture s'il est fourni) */
  solde: number
  /** true quand aucun relevé de caisse ne couvre ce jour : le zéro d'entrées
   *  n'est pas une journée sans vente, c'est une journée sans information. */
  entreesInconnues: boolean
}

export type MotifNonDate =
  | 'sans_echeance'
  | 'hors_fenetre'

export type SortieNonDatee = {
  factureId: string
  libelle: string
  montant: number
  motif: MotifNonDate
}

export type ReservesTresorerie = {
  /** Toujours vrai tant que le planning est hors trésorerie : le solde est
   *  optimiste du montant de la masse salariale de la période. */
  salairesAbsents: true
  /** Des échéances sont passées SANS avoir été pointées réglées : on ne sait
   *  pas si elles sont payées. Devient faux dès que tout le passé est pointé —
   *  c'est le geste qui transforme le prévisionnel en constat. */
  reglementsInconnus: boolean
  /** Ce qui a été pointé réglé sur la fenêtre, et donc sorti de la courbe des
   *  échéances à venir. Compté et rendu : un montant qui disparaît sans être
   *  nommé est un montant perdu. */
  reglees: { nombre: number; montant: number; lignes: SortieTresorerie[] }
  /** Factures dont l'échéance est passée et qui restent dues. */
  enRetard: { nombre: number; montant: number }
  /** Factures qu'on ne peut pas placer sur un jour, avec leur motif. */
  nonDatees: SortieNonDatee[]
  montantNonDate: number
  /** Journées de la fenêtre sans aucun relevé de caisse. */
  joursSansReleve: string[]
  /** Provision des charges récurrentes sur la fenêtre — à côté du solde, jamais
   *  dedans (une provision n'a pas de date de décaissement). */
  provisionRecurrentes: number
}

export type BilanTresorerie = {
  fenetre: { debut: string; fin: string }
  jours: JourTresorerie[]
  totalEncaissements: number
  totalDecaissements: number
  /** Variation sur la fenêtre : encaissements − décaissements datés. */
  variation: number
  soldeOuverture: number
  soldeCloture: number
  entrees: EntreeTresorerie[]
  sorties: SortieTresorerie[]
  reserves: ReservesTresorerie
}

const round2 = (n: number) => Math.round(n * 100) / 100

const JOUR_MS = 86400000

/** AAAA-MM-JJ valide ? (le format ET la date : 2026-02-31 est refusé) */
export function jourValide(s: string | null | undefined): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(s + 'T00:00:00Z')
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** Tous les jours d'une fenêtre, bornes comprises. */
export function joursDeLaFenetre(debut: string, fin: string): string[] {
  if (!jourValide(debut) || !jourValide(fin)) return []
  const jours: string[] = []
  const fintime = Date.parse(fin + 'T00:00:00Z')
  for (let t = Date.parse(debut + 'T00:00:00Z'); t <= fintime; t += JOUR_MS) {
    jours.push(new Date(t).toISOString().slice(0, 10))
  }
  return jours
}

/**
 * Une facture est-elle réglée ?
 *
 * Aujourd'hui la réponse est TOUJOURS « on ne sait pas », et c'est le point le
 * plus important de ce module : `payment_status` ne porte que
 * « to_be_processed » ou rien. Cette fonction existe pour que le jour où le
 * statut sera renseigné, il n'y ait qu'UN endroit à changer — et pour que
 * personne n'écrive ailleurs une règle de paiement concurrente.
 */
export function estReglee(statut: string | null | undefined): boolean {
  const s = String(statut ?? '').trim().toLowerCase()
  return s === 'paid' || s === 'payee' || s === 'payée' || s === 'regle' || s === 'reglee'
}

/**
 * LE moteur. `aujourdHui` est passé en paramètre (jamais lu de l'horloge) :
 * un moteur qui lit l'heure n'est pas testable, et le retard d'une échéance
 * dépend du jour où on regarde.
 */
export function calculeTresorerie(entree: {
  debut: string
  fin: string
  aujourdHui: string
  factures: EcheanceFacture[]
  journees: JourneeEncaissee[]
  /** Provision des charges récurrentes sur la fenêtre, calculée par
   *  lib/recurring-charges (provisionForWindow). Elle n'est PAS datée. */
  provisionRecurrentes?: number
  /** Solde connu au matin du premier jour, quand l'appelant en a un. */
  soldeOuverture?: number
}): BilanTresorerie {
  const { debut, fin, aujourdHui } = entree
  const jours = joursDeLaFenetre(debut, fin)
  const dansLaFenetre = new Set(jours)

  // ── Entrées ─────────────────────────────────────────────────────────────
  // Une même journée peut être livrée deux fois (relevé corrigé) : on ADDITIONNE
  // par jour plutôt que d'écraser, l'appelant ayant déjà dédoublonné en base.
  const entreesParJour = new Map<string, number>()
  const entrees: EntreeTresorerie[] = []
  const joursCouverts = new Set<string>()

  for (const j of entree.journees) {
    if (!jourValide(j.jour) || !dansLaFenetre.has(j.jour)) continue
    const montant = Number(j.caTtc) || 0
    entreesParJour.set(j.jour, round2((entreesParJour.get(j.jour) ?? 0) + montant))
    joursCouverts.add(j.jour)
    entrees.push({ jour: j.jour, montant: round2(montant), origine: 'releve_caisse' })
  }

  // ── Sorties ─────────────────────────────────────────────────────────────
  const sortiesParJour = new Map<string, number>()
  const sorties: SortieTresorerie[] = []
  const nonDatees: SortieNonDatee[] = []
  let enRetardNb = 0
  let enRetardMontant = 0

  const reglees: SortieTresorerie[] = []
  let regleesMontant = 0

  for (const f of entree.factures) {
    const montant = Number(f.montantTtc) || 0

    // UNE FACTURE POINTÉE RÉGLÉE SORT DE LA COURBE, PAS DES COMPTES.
    // Elle n'est plus une sortie à venir — mais elle est comptée et rendue,
    // pour que l'écran puisse la montrer et la dépointer. Un montant qui
    // disparaît sans être nommé est un montant perdu.
    if (estReglee(f.statutPaiement)) {
      regleesMontant += montant
      reglees.push({
        jour: jourValide(f.regleLe) ? f.regleLe : (jourValide(f.echeance) ? f.echeance : aujourdHui),
        montant: round2(montant),
        libelle: f.fournisseur,
        factureId: f.id,
        chargeFixe: Boolean(f.chargeFixe),
        enRetard: false,
      })
      continue
    }

    if (!jourValide(f.echeance)) {
      nonDatees.push({
        factureId: f.id,
        libelle: f.fournisseur,
        montant: round2(montant),
        motif: 'sans_echeance',
      })
      continue
    }
    if (!dansLaFenetre.has(f.echeance)) {
      // Hors fenêtre : ce n'est pas une anomalie, mais le total de la fenêtre
      // ne doit pas laisser croire qu'il couvre tout ce qui est dû.
      nonDatees.push({
        factureId: f.id,
        libelle: f.fournisseur,
        montant: round2(montant),
        motif: 'hors_fenetre',
      })
      continue
    }

    const enRetard = f.echeance < aujourdHui
    if (enRetard) { enRetardNb++; enRetardMontant += montant }

    sortiesParJour.set(f.echeance, round2((sortiesParJour.get(f.echeance) ?? 0) + montant))
    sorties.push({
      jour: f.echeance,
      montant: round2(montant),
      libelle: f.fournisseur,
      factureId: f.id,
      chargeFixe: Boolean(f.chargeFixe),
      enRetard,
    })
  }

  // ── Le fil des jours ────────────────────────────────────────────────────
  const soldeOuverture = round2(Number(entree.soldeOuverture) || 0)
  let cumul = soldeOuverture
  let totalE = 0
  let totalD = 0
  const lignes: JourTresorerie[] = []

  // La journée en cours n'est pas « sans relevé » : elle n'est pas finie.
  const veille = new Date(Date.parse(aujourdHui + 'T00:00:00Z') - JOUR_MS).toISOString().slice(0, 10)
  const joursSansReleve: string[] = []

  for (const jour of jours) {
    const e = entreesParJour.get(jour) ?? 0
    const d = sortiesParJour.get(jour) ?? 0
    totalE += e
    totalD += d
    cumul = round2(cumul + e - d)
    const inconnu = !joursCouverts.has(jour) && jour <= veille
    if (inconnu) joursSansReleve.push(jour)
    lignes.push({
      jour,
      encaissements: round2(e),
      decaissements: round2(d),
      mouvement: round2(e - d),
      solde: cumul,
      entreesInconnues: inconnu,
    })
  }

  return {
    fenetre: { debut, fin },
    jours: lignes,
    totalEncaissements: round2(totalE),
    totalDecaissements: round2(totalD),
    variation: round2(totalE - totalD),
    soldeOuverture,
    soldeCloture: cumul,
    entrees,
    sorties,
    reserves: {
      salairesAbsents: true,
      // La question ne se pose que pour le PASSÉ : une échéance à venir n'a pas
      // à être pointée. Dès que tout le passé l'est, la réserve tombe — et le
      // solde cesse d'être un prévisionnel sur cette partie-là.
      reglementsInconnus: enRetardNb > 0,
      reglees: { nombre: reglees.length, montant: round2(regleesMontant), lignes: reglees },
      enRetard: { nombre: enRetardNb, montant: round2(enRetardMontant) },
      nonDatees,
      montantNonDate: round2(nonDatees.reduce((s, x) => s + x.montant, 0)),
      joursSansReleve,
      provisionRecurrentes: round2(Number(entree.provisionRecurrentes) || 0),
    },
  }
}

/**
 * Un montant tel qu'on l'écrit partout ailleurs dans PILOTE : espace fine pour
 * les milliers, virgule décimale. `toFixed(2)` donnait « 12689.93 € » à côté
 * de tuiles affichant « 12 689,93 € » — deux écritures du même nombre dans le
 * même écran, à trois centimètres l'une de l'autre. Vu en ouvrant la page.
 */
function montantFr(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

/**
 * La phrase à écrire À CÔTÉ du solde. Calculée ici, pas dans l'écran : le
 * webhook, le PDF et la page doivent dire exactement la même chose, et une
 * réserve recopiée est une réserve qui finit par diverger.
 * Rend null quand il n'y a rien à signaler — ce qui n'arrivera pas tant que
 * les salaires sont hors trésorerie, et c'est voulu.
 */
export function phraseReserves(b: BilanTresorerie): string | null {
  const bouts: string[] = []

  if (b.reserves.salairesAbsents) bouts.push('salaires non comptés')
  // Une seule phrase pour les échéances passées : elles sont dues PARCE QUE
  // personne ne les a pointées. Deux puces séparées disaient deux fois la même
  // chose avec deux formulations, ce qui se lit comme deux problèmes.
  if (b.reserves.enRetard.nombre > 0) {
    const n = b.reserves.enRetard.nombre
    bouts.push(`${n} échéance${n > 1 ? 's' : ''} passée${n > 1 ? 's' : ''} et non pointée${n > 1 ? 's' : ''} réglée${n > 1 ? 's' : ''} (${montantFr(b.reserves.enRetard.montant)})`)
  }
  if (b.reserves.joursSansReleve.length > 0) {
    bouts.push(`${b.reserves.joursSansReleve.length} journée${b.reserves.joursSansReleve.length > 1 ? 's' : ''} sans relevé de caisse`)
  }
  if (b.reserves.montantNonDate > 0) {
    bouts.push(`${montantFr(b.reserves.montantNonDate)} sans échéance exploitable`)
  }
  if (b.reserves.provisionRecurrentes > 0) {
    bouts.push(`charges récurrentes provisionnées à part (${montantFr(b.reserves.provisionRecurrentes)})`)
  }

  if (bouts.length === 0) return null
  return `Ce solde est une variation, pas une position de compte : ${bouts.join(' · ')}.`
}
