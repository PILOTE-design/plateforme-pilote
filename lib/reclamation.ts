// lib/reclamation.ts — LE COURRIER DE RÉCLAMATION FOURNISSEUR. Lot 126.
// Module PUR, testable hors ligne.
//
// C'est la première brique de la chaîne qu'Otami appelle Négociations →
// prix bloqué → Litiges. PILOTE avait déjà les deux premiers maillons : le
// prix bloqué (lot 43) et les écarts comptés dans « À traiter ». Il manquait
// le geste qui les rend utiles — transformer une liste d'écarts en QUELQUE
// CHOSE QU'ON ENVOIE. Un boucher ne « traite » pas un écart dans un logiciel :
// il réclame un avoir à son fournisseur, par écrit.
//
// ─── LA RÈGLE DES ÉCARTS EST CELLE DU LOT 43, À L'IDENTIQUE ───────────────
//
// Une ligne de facture est un écart si — et seulement si :
//   1. elle est datée du jour du verrou ou APRÈS (`blocked_at`) — les factures
//      antérieures ne comptent JAMAIS, c'est la règle la plus importante du
//      lot 43, vérifiée en E2E le 04/08 ;
//   2. son prix ramené à l'unité de base dépasse le prix bloqué de plus du
//      dixième de centime (0,0005 €) ;
//   3. l'écart en euros = (payé − bloqué) × quantité quand la facture porte
//      une quantité lisible ; sinon la ligne est comptée À PART, non chiffrée,
//      et LE COURRIER LE DIT — un total qui tait des lignes se lirait comme
//      complet, et c'est le fournisseur qui le lirait.
//
// Reprendre ces règles à l'identique n'est pas de la redite : le courrier doit
// réclamer EXACTEMENT ce que l'écran « À traiter » affiche. Un courrier qui
// réclamerait un centime de plus que l'écran ferait deux vérités.
//
// ─── CE QUE LE COURRIER N'EST PAS ─────────────────────────────────────────
//
// Il n'accuse pas, il ne menace pas, il ne qualifie rien juridiquement. C'est
// une demande d'avoir, factuelle : le prix convenu, les factures qui le
// dépassent, le total, et la demande. Le ton d'un artisan qui veut continuer à
// travailler avec sa maison — pas celui d'un contentieux.

/** Ce qu'il faut de la réf pour écrire le courrier. */
export type RefBloquee = {
  name: string
  unit: string | null
  /** Prix convenu, par unité de base */
  blocked_price_ht: number
  /** AAAA-MM-JJ — début de validité du prix convenu */
  blocked_at: string | null
  /** Facteur de conversion vers l'unité de base (1 si aucun) */
  conversion_factor: number | null
}

/** Une ligne de facture de cette réf, telle que lue. */
export type LigneFacture = {
  /** AAAA-MM-JJ */
  date: string
  /** Prix unitaire lu, dans l'unité de la ligne — null : prix en quarantaine */
  unit_price_ht: number | null
  quantity: number | null
  invoice_number: string | null
}

export type EcartCourrier = {
  date: string
  invoice_number: string | null
  qte: number | null
  /** Payé, ramené à l'unité de base */
  paye: number
  ecart_ht: number | null
}

export type Reclamation = {
  ecarts: EcartCourrier[]
  /** Somme des écarts CHIFFRÉS seulement */
  total_ht: number
  /** Lignes en écart dont la quantité n'a pas été lue — comptées, jamais tues */
  non_chiffres: number
}

/** Le dixième de centime du lot 43 — même constante, même sens. */
export const TOL_ECART = 0.0005

const round2 = (n: number) => Math.round(n * 100) / 100
const round4 = (n: number) => Math.round(n * 10000) / 10000

/** Un montant en français — « 1 234,56 € ». */
export const eur = (n: number) =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

/** Un prix unitaire, jusqu'à 4 décimales : 1,998 €/L arrondi à 2,00 € ferait
 *  disparaître l'écart qu'on est en train de réclamer. */
export const prixFr = (n: number) =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + ' €'

/** « 2026-08-01 » → « 1 août 2026 ». Tel quel si ce n'est pas une date. */
export function jourFr(iso: string | null | undefined): string {
  const brut = String(iso ?? '')
  const t = brut.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return brut
  return new Date(t + 'T00:00:00Z').toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}

/**
 * Les écarts d'une réf, prêts pour le courrier.
 *
 * Les lignes en quarantaine (`unit_price_ht` null) ne comptent pas : un prix
 * refusé à la lecture ne peut fonder aucune réclamation. Tri chronologique —
 * un courrier se lit dans l'ordre des livraisons.
 */
export function ecartsDeLaRef(ref: RefBloquee, lignes: LigneFacture[]): Reclamation {
  const bloque = Number(ref.blocked_price_ht)
  const depuis = ref.blocked_at ? String(ref.blocked_at).slice(0, 10) : null
  const conv = ref.conversion_factor !== null && Number(ref.conversion_factor) > 0
    ? Number(ref.conversion_factor) : 1

  const ecarts: EcartCourrier[] = []
  let total = 0
  let nonChiffres = 0

  for (const l of lignes) {
    if (l.unit_price_ht === null || !Number.isFinite(Number(l.unit_price_ht))) continue
    const date = String(l.date ?? '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    // Les factures ANTÉRIEURES au verrou ne comptent jamais (lot 43).
    if (depuis && date < depuis) continue
    const paye = round4(Number(l.unit_price_ht) / conv)
    if (!(paye > bloque + TOL_ECART)) continue

    const qte = l.quantity !== null && Number.isFinite(Number(l.quantity)) && Number(l.quantity) > 0
      ? round4(Number(l.quantity) * conv) : null
    const ecart = qte !== null ? round2((paye - bloque) * qte) : null
    if (ecart !== null) total = round2(total + ecart)
    else nonChiffres++

    ecarts.push({ date, invoice_number: l.invoice_number ?? null, qte, paye, ecart_ht: ecart })
  }

  ecarts.sort((a, b) => a.date.localeCompare(b.date) || String(a.invoice_number ?? '').localeCompare(String(b.invoice_number ?? '')))
  return { ecarts, total_ht: total, non_chiffres: nonChiffres }
}

/** L'unité, au singulier lisible — « kg », « L », « pièce ». */
const uniteFr = (u: string | null) => {
  const t = String(u ?? '').trim().toLowerCase()
  if (t === '' || t === 'piece' || t === 'pièce' || t === 'pi') return 'pièce'
  if (t === 'l') return 'L'
  return t
}

/**
 * Les paragraphes du courrier — le PDF ne fait que les poser sur la page.
 *
 * Tout ce qui est affirmé est porté par les données : le prix convenu, sa date,
 * les factures listées. Aucune formule accusatoire — une demande d'avoir
 * factuelle, de la part d'un client qui compte rester client.
 */
export function corpsCourrier(args: {
  boutique: string
  fournisseur: string
  ref: RefBloquee
  reclamation: Reclamation
  /** AAAA-MM-JJ — date d'écriture du courrier, fournie par l'appelant (jamais
   *  calculée ici : un module pur ne lit pas l'horloge) */
  date: string
}): { objet: string; paragraphes: string[]; demande: string; reserve: string | null } {
  const { ref, reclamation } = args
  const u = uniteFr(ref.unit)
  const n = reclamation.ecarts.length

  const objet = `Écarts de facturation sur « ${ref.name} » — demande d’avoir`

  const paragraphes: string[] = []
  paragraphes.push(
    `Madame, Monsieur,`,
  )
  paragraphes.push(
    `Nous avons convenu ensemble d’un prix de ${prixFr(ref.blocked_price_ht)} par ${u} pour la référence « ${ref.name} »`
    + (ref.blocked_at ? `, en vigueur depuis le ${jourFr(ref.blocked_at)}.` : `.`),
  )
  paragraphes.push(
    n === 1
      ? `Or, la facture ci-dessous fait apparaître un prix supérieur à ce tarif convenu :`
      : `Or, les ${n.toLocaleString('fr-FR')} factures ci-dessous font apparaître des prix supérieurs à ce tarif convenu :`,
  )

  const demande = reclamation.total_ht > 0
    ? `L’écart total s’élève à ${eur(reclamation.total_ht)} HT. Nous vous remercions de bien vouloir nous adresser un avoir de ce montant, ou, le cas échéant, de nous préciser ce qui justifie ces écarts. Dans l’attente de votre retour, nous poursuivons naturellement nos commandes aux conditions convenues.`
    : `Nous vous remercions de bien vouloir nous confirmer le tarif appliqué et, le cas échéant, de nous adresser l’avoir correspondant. Dans l’attente de votre retour, nous poursuivons naturellement nos commandes aux conditions convenues.`

  const reserve = reclamation.non_chiffres > 0
    ? (reclamation.non_chiffres === 1
      ? `Une ligne supplémentaire dépasse également le prix convenu mais n’est pas chiffrée ci-dessus, la quantité n’étant pas lisible sur la facture.`
      : `${reclamation.non_chiffres.toLocaleString('fr-FR')} lignes supplémentaires dépassent également le prix convenu mais ne sont pas chiffrées ci-dessus, leurs quantités n’étant pas lisibles sur les factures.`)
    : null

  return { objet, paragraphes, demande, reserve }
}
