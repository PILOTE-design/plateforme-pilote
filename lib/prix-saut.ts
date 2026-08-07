// lib/prix-saut.ts — UN PRIX QUI EST LE MULTIPLE ENTIER DU PRÉCÉDENT N'EST PAS
// UNE HAUSSE. Lot 119. Module PUR, testable hors ligne.
//
// ─── CE QU'ON A MESURÉ EN PRODUCTION LE 07/08/2026 ────────────────────────
//
// Trois articles portent un prix qui vaut EXACTEMENT un multiple entier d'une
// autre lecture du même article :
//
//   CAROTTE MC 10K   22/06 : 2 × 12,90 € = 25,80 €   ·  24/06 : 20 × 1,29 €
//   COUSCOUS 5K      21/07 : 2,2 × 11,00 €           ·  07/07 : 10 × 2,20 €
//   MAUREL HLE 5L    01/08 : 5 × 3,996 € = 19,98 €   ·  17/07 : 1 × 1,998 €
//
// Aucun n'est une hausse. Dans les trois cas, une lecture compte des COLIS et
// l'autre des KILOS (ou des litres) — c'est la même marchandise au même prix,
// exprimée dans deux unités. Et comme la mercuriale retient « le prix de la
// facture la plus récente », le prix d'un article bascule d'un facteur 10 du
// jour au lendemain, EN SILENCE, et sale le coût de revient de toutes les
// fiches qui s'en servent.
//
// ─── POURQUOI LES GARDE-FOUS EXISTANTS NE LE VOIENT PAS ───────────────────
//
// `qté × PU = montant` tombe juste des DEUX côtés : 2 × 12,90 = 25,80 et
// 20 × 1,29 = 25,80. La ligne est parfaitement cohérente avec elle-même. Le
// contrôle par ligne, la cohérence globale, la quarantaine : tout passe.
//
// `colonnesInversees` (lots 68-69) ne s'applique pas non plus — ici rien n'est
// inversé, la quantité est simplement comptée dans une autre unité.
//
// Le seul témoin est le prix PRÉCÉDENT du même article. Aucune ligne prise
// isolément ne peut le dire ; il faut regarder la série.
//
// ─── CE QU'ON FAIT, ET SURTOUT CE QU'ON NE FAIT PAS ───────────────────────
//
// On ne corrige RIEN. On ne devine pas laquelle des deux lectures est la bonne
// — la réponse dépend de ce que la maison achète réellement, et la donnée
// appartient au boucher. Cette leçon a été payée deux fois : le lot 57
// « réparait » des quantités et en a fabriqué 38 fausses sur 52 ; le lot 68
// posait une condition qui était vraie d'avance.
//
// On ANNONCE. Un saut d'un facteur entier part dans « À traiter » avec les deux
// lectures écrites en clair, et le boucher tranche. C'est la règle de la maison :
// jamais un chiffre faux en silence, et un tiret honnête vaut mieux qu'un
// chiffre inventé.
//
// ─── POURQUOI « FACTEUR ENTIER » EST UN SIGNAL SÛR ────────────────────────
//
// Un vrai prix ne double pas au millième près. Pour qu'un doublement réel
// déclenche l'alerte, il faudrait que le nouveau prix tombe sur `2 × l'ancien`
// à 0,1 % — soit une chance sur mille par palier. Un changement d'unité de
// facturation, lui, produit ce rapport EXACTEMENT, parce qu'un conditionnement
// contient un nombre entier d'unités.
//
// La borne de temps (120 jours) écarte le seul faux positif crédible : un prix
// qui a réellement doublé sur deux ans, et dont le hasard voudrait qu'il tombe
// pile sur le double. Sur les trois cas mesurés, l'écart va de 2 à 38 jours.

import { contenanceAnnoncee } from './invoice-lines'

/** Une lecture de prix pour un même article, telle que la facture l'a donnée. */
export type LecturePrix = {
  /** AAAA-MM-JJ */
  date: string
  /** Prix unitaire retenu, dans l'unité de la ligne */
  prix: number
  /** Quantité lue — sert à reconnaître le conditionnement, jamais à corriger */
  quantite: number | null
  /** Montant HT de la ligne, tel qu'imprimé */
  montant: number | null
  /** Libellé de la ligne : c'est lui qui porte « 5L », « 10K », « 3KG » */
  designation: string
  /** Unité de la ligne (kg, l, pièce, colis…) */
  unite: string | null
  /** Numéro de facture, pour que le boucher retrouve le document */
  facture?: string | null
}

export type SautDePrix = {
  /** Le rapport, arrondi à l'entier — 2, 5, 10… */
  facteur: number
  /** La lecture la plus récente (celle qui est publiée aujourd'hui) */
  recente: LecturePrix
  /** Celle à laquelle on la compare */
  precedente: LecturePrix
  /** Nombre de jours entre les deux */
  jours: number
  /** Le conditionnement annoncé par le libellé, quand il l'annonce */
  conditionnement: number | null
  /** `true` quand le libellé corrobore : le facteur OU la quantité lue vaut le
   *  conditionnement annoncé. La présomption est alors bien plus forte, et la
   *  phrase le dit. */
  corrobore: boolean
  /** Ce qu'on montre au boucher, en toutes lettres */
  phrase: string
}

/** Tolérance sur « le rapport est un entier ». 0,1 % : assez serré pour qu'une
 *  hausse réelle n'y tombe pas par hasard, assez lâche pour absorber les
 *  arrondis à quatre décimales de la base. */
export const TOL_ENTIER = 0.001

/** En deçà de ce facteur, ce n'est plus un changement d'unité mais une hausse
 *  possible. Un conditionnement de 1 n'en est pas un. */
export const FACTEUR_MIN = 2

/** Au-delà, on est hors de tout conditionnement d'épicerie plausible, et le
 *  rapport entier devient une coïncidence plus probable qu'un indice. */
export const FACTEUR_MAX = 100

/** Deux lectures plus éloignées que ça peuvent avoir vu un vrai mouvement de
 *  prix. Les trois cas mesurés en production sont à 2, 14 et 38 jours. */
export const JOURS_MAX = 120

const round2 = (n: number) => Math.round(n * 100) / 100
const round4 = (n: number) => Math.round(n * 10000) / 10000

/** Un montant écrit en français. Trois sessions de suite, un `toFixed(2)` a
 *  sorti « 961.40 € » au milieu d'une phrase française. */
export function eur(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

/** Un prix unitaire, qui mérite plus de décimales qu'un montant : 1,998 €/L
 *  arrondi à 2,00 € ferait disparaître ce qu'on essaie justement de montrer. */
export function prixFr(n: number): string {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

/** « 2026-08-01 » → « 1 août 2026 ». Rend la chaîne telle quelle si ce n'est
 *  pas une date : une phrase d'alerte ne doit jamais afficher « Invalid Date ». */
export function jourFr(iso: string): string {
  const brut = String(iso || '')
  const t = brut.slice(0, 10)
  // Ce qui n'est pas une date est rendu ENTIER, jamais tronqué à dix
  // caractères : une phrase d'alerte qui affiche un libellé coupé au milieu
  // est aussi inutilisable qu'une qui affiche « Invalid Date ».
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return brut
  return new Date(t + 'T00:00:00Z').toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}

/** Nombre de jours entre deux dates ISO. `null` si l'une des deux n'en est pas. */
export function joursEntre(a: string, b: string): number | null {
  const ta = Date.parse(String(a || '').slice(0, 10) + 'T00:00:00Z')
  const tb = Date.parse(String(b || '').slice(0, 10) + 'T00:00:00Z')
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null
  return Math.round(Math.abs(tb - ta) / 86400000)
}

/**
 * Le saut de prix d'un article, s'il y en a un.
 *
 * `lectures` = toutes les lignes de facture connues pour CET article. L'ordre
 * n'a pas d'importance : la fonction trie par date et compare la plus récente à
 * celle qui la précède — c'est-à-dire exactement le prix qui est publié
 * aujourd'hui contre celui qu'il a remplacé.
 *
 * Rend `null` quand il n'y a rien à signaler. C'est le cas de loin le plus
 * fréquent, et il ne coûte rien.
 */
export function sautDePrix(lectures: LecturePrix[]): SautDePrix | null {
  const valides = lectures
    .filter(l => Number.isFinite(l.prix) && l.prix > 0 && /^\d{4}-\d{2}-\d{2}/.test(String(l.date || '')))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))

  if (valides.length < 2) return null

  const recente = valides[valides.length - 1]
  const precedente = valides[valides.length - 2]

  // Deux lignes de la MÊME facture au même prix ne disent rien : on remonte
  // jusqu'à une lecture d'un autre prix.
  let i = valides.length - 2
  while (i >= 0 && valides[i].prix === recente.prix) i--
  if (i < 0) return null
  const avant = valides[i]

  const jours = joursEntre(avant.date, recente.date)
  if (jours === null || jours > JOURS_MAX) return null

  // Le rapport, dans le sens qui donne un nombre ≥ 1.
  const haut = Math.max(recente.prix, avant.prix)
  const bas = Math.min(recente.prix, avant.prix)
  if (bas <= 0) return null
  const rapport = haut / bas
  const entier = Math.round(rapport)

  if (entier < FACTEUR_MIN || entier > FACTEUR_MAX) return null
  if (Math.abs(rapport - entier) > TOL_ENTIER * entier) return null

  // Le libellé corrobore-t-il ? Deux façons : le facteur EST le conditionnement
  // (10 kg par box → prix ×10), ou la quantité lue vaut le conditionnement
  // (« 5 » sur une ligne « MAUREL 5L » : on a compté des litres, pas des bidons).
  const conditionnement = contenanceAnnoncee(recente.designation, recente.unite)
  const proche = (a: number | null, b: number | null) =>
    a !== null && b !== null && Math.abs(a - b) <= TOL_ENTIER * Math.max(1, Math.abs(b))
  const corrobore = proche(conditionnement, entier) || proche(recente.quantite, conditionnement)

  const monte = recente.prix > avant.prix
  const phrase = phraseDuSaut({ facteur: entier, recente, precedente: avant, jours, conditionnement, corrobore, monte })

  return { facteur: entier, recente, precedente: avant, jours, conditionnement, corrobore, phrase }
}

/**
 * La phrase montrée au boucher.
 *
 * Elle dit TROIS choses, et pas une de plus : ce qui a changé, pourquoi c'est
 * douteux, et ce qu'il peut faire. Elle n'affirme jamais quel prix est le bon —
 * on ne le sait pas, et prétendre le savoir a déjà coûté 38 lignes fausses.
 */
export function phraseDuSaut(s: {
  facteur: number
  recente: LecturePrix
  precedente: LecturePrix
  jours: number
  conditionnement: number | null
  corrobore: boolean
  monte: boolean
}): string {
  const sens = s.monte ? 'multiplié' : 'divisé'
  const debut = `Le prix retenu est ${sens} par ${s.facteur.toLocaleString('fr-FR')} `
    + `par rapport à la lecture précédente : ${prixFr(s.recente.prix)} € le ${jourFr(s.recente.date)}, `
    + `contre ${prixFr(s.precedente.prix)} € le ${jourFr(s.precedente.date)}`
  const ecart = s.jours <= 1 ? '' : ` (${s.jours.toLocaleString('fr-FR')} jours d’écart)`

  const cause = s.corrobore && s.conditionnement !== null
    ? ` Le libellé annonce un conditionnement de ${prixFr(s.conditionnement)} : une lecture a probablement compté les colis, l’autre les unités.`
    : ' Un facteur entier exact est la signature d’un changement d’unité de facturation, pas d’une hausse.'

  return `${debut}${ecart}.${cause} Vérifiez la facture : c’est ce prix qui sert de base au coût de revient des fiches.`
}

/**
 * Passe un catalogue entier en revue.
 *
 * `parArticle` : les lectures groupées par identifiant d'article. Rend un saut
 * par article concerné, les plus gros facteurs d'abord — c'est là que le coût
 * de revient est le plus faussé.
 */
export function sautsDuCatalogue(
  parArticle: Map<string, LecturePrix[]>,
): Array<{ articleId: string; saut: SautDePrix }> {
  const out: Array<{ articleId: string; saut: SautDePrix }> = []
  parArticle.forEach((lectures, articleId) => {
    const s = sautDePrix(lectures)
    if (s) out.push({ articleId, saut: s })
  })
  return out.sort((a, b) =>
    b.saut.facteur - a.saut.facteur
    || String(b.saut.recente.date).localeCompare(String(a.saut.recente.date)))
}

/** Le compteur du badge « À traiter ». Séparé de la liste pour que l'écran
 *  puisse compter sans construire les phrases. */
export const compteSauts = (sauts: Array<{ saut: SautDePrix }>) => sauts.length

export { round2, round4 }
