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

/** Semaine d'imputation d'une facture : livraison si présente, sinon date de
 *  facture. Renvoie null si aucune date exploitable — l'appelant choisit alors
 *  un repli (fenêtre de synchro, semaine courante…) plutôt qu'une date inventée. */
export function weekForInvoice(
  deliveryDate?: string | null,
  invoiceDate?: string | null,
): { week: number; year: number } | null {
  const raw = (deliveryDate && String(deliveryDate).trim()) || (invoiceDate && String(invoiceDate).trim()) || null
  return raw ? isoWeekOf(raw) : null
}
