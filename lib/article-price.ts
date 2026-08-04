/**
 * LE DERNIER PRIX D'UN ARTICLE — recalculé, jamais accumulé.
 *
 * Module PUR, testable hors ligne.
 *
 * ─── LE DÉFAUT QU'IL CORRIGE (04/08/2026) ─────────────────────────────────
 *
 * `articles.last_price_ht` est une donnée DÉRIVÉE : le dernier point de prix
 * publié, qui vit dans `invoice_lines`. Elle était pourtant écrite en
 * ACCUMULANT — chaque ligne promue poussait son prix dans l'article, et une
 * ligne qui cessait d'être promue ne reprenait jamais le sien.
 *
 * Conséquence mesurée en production : après le correctif du lot 60, les lignes
 * fausses ont bien été écartées de `invoice_lines`, mais **la mercuriale a
 * continué d'afficher leurs prix** — « MPRO 25 BTE PLATEAU » à 1,00 € au lieu
 * de 14,71 €. Le prix ne pouvait plus être expliqué par aucune ligne de
 * facture existante : 86 articles étaient dans ce cas, dont 55 chez une
 * boucherie réelle.
 *
 * Une relecture, une suppression de facture, une requalification en charge :
 * chacune retirait des points de prix sans jamais défaire ce qu'ils avaient
 * écrit. Le dernier prix survivait à sa propre source.
 *
 * ─── LA RÈGLE ─────────────────────────────────────────────────────────────
 *
 * Le dernier prix d'un article, c'est le point de prix le plus récent parmi
 * ses lignes de facture PUBLIÉES — celles qui portent un `unit_price_ht`. Rien
 * d'autre. On le RECALCULE depuis les lignes après chaque écriture, au lieu de
 * l'incrémenter : un prix qui n'a plus de ligne pour le porter disparaît.
 *
 * Un article sans aucune ligne publiée n'a PAS de prix — `null`, pas le
 * dernier connu. C'est un trou visible, et la mercuriale sait déjà l'afficher
 * comme tel. Un prix faux, lui, est invisible et se propage dans toutes les
 * fiches qui utilisent l'article.
 *
 * Ce module ne touche ni `blocked_price_ht` (prix bloqué à la main par le
 * boucher, qui prime à l'affichage) ni `no_auto` (association aux produits
 * génériques) : ce sont des décisions humaines, pas des données dérivées.
 */

/** Un point de prix : une ligne de facture qui a publié un prix. */
export type PointDePrix = {
  /** Prix unitaire PUBLIÉ. Une ligne en quarantaine ne compte pas : elle vaut null. */
  unit_price_ht: number | string | null
  /** Date de la FACTURE — c'est elle qui ordonne, pas la date de lecture. */
  invoice_date: string | null
  /** Date d'écriture de la ligne, pour départager deux factures du même jour. */
  created_at?: string | null
}

export type PrixArticle = {
  last_price_ht: number | null
  last_price_date: string | null
  /** Nombre de points de prix publiés — ce que le compteur a toujours voulu dire. */
  price_count: number
}

const AUCUN: PrixArticle = { last_price_ht: null, last_price_date: null, price_count: 0 }

const nombre = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Le dernier prix publié d'un article, depuis TOUTES ses lignes de facture.
 *
 * L'ordre est celui de la FACTURE, pas celui de la lecture : relire aujourd'hui
 * une facture de juin ne doit pas faire remonter un prix de juin devant un prix
 * de juillet. À date de facture égale, la ligne écrite en dernier gagne — c'est
 * la règle qui existait déjà, on ne la change pas.
 */
export function dernierPrix(points: PointDePrix[] | null | undefined): PrixArticle {
  const publies = (points ?? []).filter(p => p && nombre(p.unit_price_ht) !== null)
  if (publies.length === 0) return AUCUN

  let gagnant = publies[0]
  for (const p of publies.slice(1)) {
    const dp = String(p.invoice_date ?? '')
    const dg = String(gagnant.invoice_date ?? '')
    // Une ligne sans date de facture ne peut pas prétendre au titre de « dernier »
    // face à une ligne datée : elle ne gagne que faute d'adversaire daté.
    if (dp > dg) { gagnant = p; continue }
    if (dp < dg) continue
    if (String(p.created_at ?? '') >= String(gagnant.created_at ?? '')) gagnant = p
  }

  return {
    last_price_ht: nombre(gagnant.unit_price_ht),
    last_price_date: gagnant.invoice_date ?? null,
    price_count: publies.length,
  }
}

/** Le prix d'un article a-t-il changé ? Évite d'écrire pour rien — et donc de
 *  faire bouger `updated_at`, que la mercuriale montre au boucher. */
export function memePrix(a: PrixArticle, b: {
  last_price_ht: number | string | null
  last_price_date: string | null
  price_count: number | null
}): boolean {
  return nombre(a.last_price_ht) === nombre(b.last_price_ht)
    && (a.last_price_date ?? null) === (b.last_price_date ?? null)
    && a.price_count === (b.price_count ?? 0)
}
