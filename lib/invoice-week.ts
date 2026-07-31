// lib/invoice-week.ts — Semaine ISO d'imputation d'une facture (règle UNIQUE).
//
// Une facture doit tomber dans LA bonne semaine, de façon déterministe quel que
// soit le canal (saisie, synchro connecteur, email). La règle : la date de
// LIVRAISON prime — une facture matière concerne la semaine où la marchandise
// est livrée/consommée, pas forcément celle de son émission — sinon la date de
// facture. Jusqu'ici chaque canal appliquait sa propre logique (la synchro
// estampillait TOUTES les factures sur la fenêtre de synchro, l'email retombait
// sur « aujourd'hui »), ce qui rangeait des factures dans la mauvaise semaine et
// faussait la marge de deux semaines à la fois.

/** Semaine ISO d'une date (formule identique aux getISOWeek historiques). */
function isoWeek(date: Date): { week: number; year: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return {
    week: Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7),
    year: d.getUTCFullYear(),
  }
}

/** Semaine ISO à partir d'une Date ou d'une chaîne 'YYYY-MM-DD'. null si illisible. */
export function isoWeekOf(input: Date | string | null | undefined): { week: number; year: number } | null {
  if (input == null) return null
  const d = input instanceof Date ? input : new Date(String(input))
  if (isNaN(d.getTime())) return null
  return isoWeek(d)
}

/** Fenêtre de plausibilité d'une date de livraison autour de la date de facture :
 *  une livraison facturée arrive dans les ~6 semaines qui précèdent l'émission
 *  (facture récapitulative mensuelle comprise) et jamais plus d'une semaine
 *  après (fournisseur qui facture au départ, livraison le lendemain). */
const LIVRAISON_AVANT_MAX_J = 45
const LIVRAISON_APRES_MAX_J = 7

/** Garde-fou sur la date de LIVRAISON lue par l'IA sur le PDF (31/07).
 *
 *  Mesuré en production : 10 dates de livraison sur 61 étaient fausses, dont 8
 *  EXACTEMENT égales à l'échéance de paiement — l'IA lisait « à régler avant le
 *  10/08 » comme une date de livraison. Comme la livraison PRIME sur la date de
 *  facture pour l'imputation, une facture partait dans la mauvaise semaine et
 *  faussait deux semaines de marge à la fois.
 *
 *  Une date de livraison n'est retenue que si elle est lisible, DIFFÉRENTE de
 *  l'échéance de paiement, et dans la fenêtre de plausibilité. Sinon : null —
 *  on retombe sur la date de facture (déterministe, venue du connecteur), au
 *  lieu de propager une date inventée. */
export function plausibleDelivery(
  deliveryDate?: string | null,
  invoiceDate?: string | null,
  dueDate?: string | null,
): string | null {
  const d = (deliveryDate && String(deliveryDate).trim()) || null
  if (!d || isoWeekOf(d) === null) return null
  // Confusion la plus fréquente : la date lue EST l'échéance de paiement
  const due = (dueDate && String(dueDate).trim()) || null
  if (due && d.slice(0, 10) === due.slice(0, 10)) return null
  const inv = (invoiceDate && String(invoiceDate).trim()) || null
  if (!inv) return d // sans date de facture, rien à quoi confronter la livraison
  const dMs = new Date(d).getTime()
  const iMs = new Date(inv).getTime()
  if (isNaN(dMs) || isNaN(iMs)) return null
  const ecartJ = (dMs - iMs) / 86400000
  if (ecartJ > LIVRAISON_APRES_MAX_J || ecartJ < -LIVRAISON_AVANT_MAX_J) return null
  return d
}

/** Semaine d'imputation d'une facture : livraison PLAUSIBLE si présente, sinon
 *  date de facture. Renvoie null si aucune date exploitable — l'appelant choisit
 *  alors un repli (fenêtre de synchro, semaine courante…) plutôt qu'une date
 *  inventée. L'échéance de paiement n'impute JAMAIS une facture : elle dit quand
 *  l'argent sort, pas quand la marchandise entre. */
export function weekForInvoice(
  deliveryDate?: string | null,
  invoiceDate?: string | null,
  dueDate?: string | null,
): { week: number; year: number } | null {
  const livraison = plausibleDelivery(deliveryDate, invoiceDate, dueDate)
  const raw = livraison || (invoiceDate && String(invoiceDate).trim()) || null
  return raw ? isoWeekOf(raw) : null
}
