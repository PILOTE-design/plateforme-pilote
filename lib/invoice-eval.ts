// lib/invoice-eval.ts — MESURE de la lecture des factures fournisseurs.
//
// Module PUR : zéro IA, zéro base, testable seul. Il compare deux jeux de lignes
// de facture et compte ce qui coïncide :
//   · ATTENDU = les lignes de référence, celles déjà en base pour une facture
//     dont la lecture est jugée sûre (somme des lignes = total au centime) ;
//   · OBTENU  = la relecture du MÊME texte source par l'extracteur courant.
//
// Pourquoi ce module existe. Le rapport hebdomadaire a son corpus depuis le lot
// V5 : on y REJOUE l'extracteur sur des cas dont on connaît la bonne réponse, et
// un changement de prompt qui fait baisser le taux est refusé avant d'être
// livré. La lecture des FACTURES, elle, n'avait rien : aucun texte source
// archivé, donc aucun moyen de dire si une modification du prompt améliore ou
// dégrade. Toucher au prompt sans ça, c'est espérer, pas vérifier.
//
// Deux chiffres, et ils ne disent pas la même chose :
//   · l'EXACTITUDE — les montants, quantités et prix relus coïncident-ils avec
//     la référence ? C'est le garde-fou anti-régression ;
//   · les PRIX EXPLOITABLES — combien de lignes ressortent avec un prix qui se
//     recoupe, donc publiable dans la mercuriale ? C'est le chiffre à faire
//     monter. Mesuré le 31/07 : 47 prix sur 306 lignes étaient refusés, dont 32
//     sur des factures dont la somme tombait pourtant au centime près.
//
// Un changement réussi fait MONTER le second sans faire baisser le premier.

import { normText } from '@/lib/postes'

/** Tolérances. Les montants se comparent au centime ; les quantités au gramme ;
 *  les prix unitaires au dixième de centime (un prix au kilo a 3 décimales). */
export const EPS_MONTANT = 0.01
export const EPS_QUANTITE = 0.001
export const EPS_PRIX = 0.005

/** Une ligne de facture, réduite à ce qui se compare. */
export type LigneFacture = {
  designation: string
  quantity: number | null
  unit: string | null
  unit_price_ht: number | null
  amount_ht: number
  /** Poids facturé, quand la facture porte une colonne distincte du nombre de
   *  colis. C'est LUI qui porte le prix au kilo. */
  weight_kg?: number | null
}

export type EcartChamp = {
  /** Libellé lisible (ex. « ÉCHINE DE PORC — montant »). */
  champ: string
  attendu: number | null
  /** null = le chiffre attendu n'a pas été retrouvé dans la relecture. */
  obtenu: number | null
  ecart: number
  ok: boolean
}

export type CasFacture = {
  invoice_id: string
  fournisseur: string
  date: string | null
  lignes_attendues: number
  lignes_obtenues: number
  /** Nombre de chiffres comparés / justes. */
  total: number
  exacts: number
  exactitude: number
  /** Lignes de la relecture portant un prix unitaire qui se recoupe avec le
   *  montant : ce sont elles qui alimenteraient la mercuriale. */
  prix_exploitables: number
  /** Prix que la référence n'avait PAS et que la relecture trouve. C'est le but
   *  poursuivi, pas une faute — voir le commentaire de `champ`. */
  prix_gagnes: number
  /** Prix que la référence avait et que la relecture PERD. Régression franche. */
  prix_perdus: number
  divergences: EcartChamp[]
}

export type CorpusFactures = {
  cas: number
  total_chiffres: number
  exacts: number
  exactitude: number
  lignes_attendues: number
  lignes_obtenues: number
  prix_exploitables: number
  prix_gagnes: number
  prix_perdus: number
  par_cas: CasFacture[]
}

function champ(nom: string, attendu: number | null, obtenu: number | null, eps: number): EcartChamp {
  // Un chiffre absent DES DEUX CÔTÉS n'est pas une faute : la facture ne le
  // portait pas. C'est le cas courant d'une remise sans quantité.
  if (attendu === null && obtenu === null) return { champ: nom, attendu: null, obtenu: null, ecart: 0, ok: true }
  if (attendu === null || obtenu === null) {
    return { champ: nom, attendu, obtenu, ecart: Math.abs(attendu ?? obtenu ?? 0), ok: false }
  }
  const ecart = Math.abs(obtenu - attendu)
  return { champ: nom, attendu, obtenu, ecart: +ecart.toFixed(4), ok: ecart <= eps }
}

/**
 * Le prix unitaire ne se compare PAS comme un montant, et le premier rejeu l'a
 * démontré : le 01/08, la mesure a rendu 57,5 % d'exactitude alors que le
 * changement testé faisait exactement ce qu'on lui demandait. Sur les 31 écarts
 * comptés, une vingtaine étaient des « attendu — / relu 13,42 » : un prix que
 * l'ancienne lecture avait mis en quarantaine et que la nouvelle retrouve.
 *
 * Compter ça comme une faute revient à faire punir par le garde-fou l'unique
 * amélioration qu'il est chargé de valider — et à rendre le 100 % inatteignable
 * précisément quand on progresse. Trois cas, donc, et un seul est une faute :
 *   · la référence n'avait pas de prix, la relecture en trouve un → GAIN ;
 *   · la référence en avait un, la relecture le perd            → PERTE (faute) ;
 *   · les deux en ont un et ils diffèrent                       → FAUTE.
 *
 * Les montants et les quantités, eux, restent comparés strictement : un montant
 * qui bouge sur une facture dont on sait la somme juste est toujours une
 * régression, jamais un progrès.
 */
function champPrix(nom: string, attendu: number | null, obtenu: number | null): { ecart: EcartChamp | null; gagne: boolean; perdu: boolean } {
  if (attendu === null && obtenu === null) return { ecart: null, gagne: false, perdu: false }
  if (attendu === null && obtenu !== null) return { ecart: null, gagne: true, perdu: false }
  if (attendu !== null && obtenu === null) {
    return { ecart: { champ: `${nom} — prix PERDU`, attendu, obtenu: null, ecart: attendu, ok: false }, gagne: false, perdu: true }
  }
  const ecart = Math.abs((obtenu as number) - (attendu as number))
  return {
    ecart: { champ: `${nom} — prix unitaire`, attendu, obtenu, ecart: +ecart.toFixed(4), ok: ecart <= EPS_PRIX },
    gagne: false, perdu: false,
  }
}

/** Un prix unitaire est EXPLOITABLE quand il se recoupe avec le montant de la
 *  ligne — c'est exactement la règle appliquée à la publication en mercuriale.
 *  Sans quantité ni prix, rien à recouper, donc rien à publier. */
export function prixExploitable(l: LigneFacture): boolean {
  if (l.unit_price_ht === null) return false
  // L'assiette : le POIDS quand la facture en porte un, la quantité sinon.
  // Même règle exactement que la publication en mercuriale.
  const base = l.weight_kg != null && l.weight_kg > 0 ? l.weight_kg
    : (l.quantity !== null && l.quantity !== 0 ? l.quantity : null)
  if (base === null) return false
  return Math.abs(base * l.unit_price_ht - l.amount_ht) <= Math.max(0.05, Math.abs(l.amount_ht) * 0.01)
}

/** Clé d'appariement : le libellé normalisé puis DÉBARRASSÉ de ses espaces.
 *  Deux lectures du même texte coupent parfois un mot à un endroit différent
 *  (« SLIMB FLEUR » / « SLIMBFLEUR », mesuré le 02/08 sur AURIBAULT — seul écart
 *  d'une certification à 94,3 % qui aurait dû dire 100). Un espace interne ne
 *  distingue jamais deux articles ; il ne doit donc jamais séparer deux lignes.
 *  Clé du COMPARATEUR uniquement — l'appariement de production (name_key) a ses
 *  propres règles et n'est pas concerné. */
const cleLigne = (s: string) => normText(s).replace(/\s+/g, '')

/** Deux libellés qui ne divergent que sur une FENÊTRE d'au plus deux caractères
 *  désignent la même ligne quand le montant coïncide déjà au centime. Mesuré le
 *  02/08 sur la même facture AURIBAULT, à la relecture suivante : « AVC RABE » /
 *  « AVC CRABE » — une lettre avalée par la couche texte du PDF, tous les
 *  chiffres identiques. Une divergence au MILIEU d'un mot échappe au test
 *  d'inclusion ; un préfixe et un suffixe communs qui couvrent tout le reste
 *  bornent l'écart à cette fenêtre — c'est suffisant, et ça ne pardonne rien
 *  d'autre. Si l'appariement se trompait malgré tout, les chiffres comparés
 *  ensuite (quantité, prix, montant) trahiraient la confusion : la mesure
 *  reste une mesure de CHIFFRES, jamais une confiance aveugle au libellé. */
const memeLibelleAPeuPres = (a: string, b: string): boolean => {
  const maxLen = Math.max(a.length, b.length)
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  let s = 0
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
  return p + s >= maxLen - 2
}

/** Compare les lignes d'une facture à leur relecture. L'appariement se fait sur
 *  le libellé normalisé ; une ligne oubliée comme une ligne inventée comptent
 *  toutes deux comme des fautes. */
export function compareFacture(
  invoiceId: string,
  fournisseur: string,
  date: string | null,
  attendu: LigneFacture[],
  obtenu: LigneFacture[],
): CasFacture {
  const champs: EcartChamp[] = []
  const parCle = new Map<string, LigneFacture[]>()
  for (const l of obtenu) {
    const k = cleLigne(l.designation)
    const arr = parCle.get(k) || []
    arr.push(l)
    parCle.set(k, arr)
  }

  const consommees = new Set<LigneFacture>()
  let prixGagnes = 0, prixPerdus = 0
  for (const a of attendu) {
    const k = cleLigne(a.designation)
    // Un même libellé peut revenir plusieurs fois sur une facture (deux lots du
    // même article) : on apparie celui dont le montant est le plus proche, et on
    // ne le réutilise pas.
    const candidats = (parCle.get(k) || []).filter(c => !consommees.has(c))
    let o = candidats.length === 0 ? null
      : candidats.reduce((best, c) =>
          Math.abs(c.amount_ht - a.amount_ht) < Math.abs(best.amount_ht - a.amount_ht) ? c : best)
    // RATTRAPAGE DE LIBELLÉ. Le même article ne porte pas toujours le même
    // libellé d'une lecture à l'autre, sans qu'aucune ligne ne soit fausse :
    //   · le PDF coupe la désignation en deux (« SALADE PIEMONTAISE JAMBON
    //     SUPERIEUR », puis « 2.8KG » en dessous) et le complément est repris
    //     ou non — le libellé s'allonge par la FIN ;
    //   · le nombre de colis colle au libellé (« 2.0 kg FILET DE POULET
    //     S/ATMO ») — il s'allonge par le DÉBUT.
    // Les deux cas ont été mesurés le 01/08, et chacun transformait une ligne
    // parfaitement relue en « ligne perdue » plus « ligne en trop ».
    //
    // On n'apparie que si le montant coïncide au centime ET qu'un libellé
    // CONTIENT l'autre — deux conditions ensemble, jamais le montant seul, qui
    // confondrait deux articles distincts vendus au même prix. Le libellé le
    // plus court doit rester assez long pour ne pas matcher n'importe quoi.
    if (!o) {
      o = obtenu.find(c => {
        if (consommees.has(c)) return false
        if (Math.abs(c.amount_ht - a.amount_ht) > EPS_MONTANT) return false
        const kc = cleLigne(c.designation)
        if (kc === '' || k === '') return false
        if (Math.min(kc.length, k.length) < 6) return false
        return kc.includes(k) || k.includes(kc) || memeLibelleAPeuPres(k, kc)
      }) ?? null
    }
    if (o) consommees.add(o)
    const nom = a.designation.slice(0, 40)
    champs.push(champ(`${nom} — montant`, a.amount_ht, o ? o.amount_ht : null, EPS_MONTANT))
    // QUANTITÉ : le chiffre attendu peut avoir simplement changé de colonne.
    // Quand le format apprend à lire le poids séparément, un nombre qui était
    // rangé en quantité se retrouve légitimement en poids — ce n'est pas une
    // régression, et le compter comme telle rendrait la mesure inutilisable au
    // moment précis où elle sert. On accepte donc l'une OU l'autre colonne.
    const qObtenue = o
      ? (a.quantity !== null && o.weight_kg != null && Math.abs(o.weight_kg - a.quantity) <= EPS_QUANTITE
          ? o.weight_kg
          : o.quantity)
      : null
    champs.push(champ(`${nom} — quantité`, a.quantity, qObtenue, EPS_QUANTITE))
    const p = champPrix(nom, a.unit_price_ht, o ? o.unit_price_ht : null)
    if (p.ecart) champs.push(p.ecart)
    if (p.gagne) prixGagnes++
    if (p.perdu) prixPerdus++
  }
  // Lignes inventées : présentes à la relecture, absentes de la référence.
  for (const o of obtenu) {
    if (consommees.has(o)) continue
    champs.push({ champ: `${o.designation.slice(0, 40)} — ligne en trop`, attendu: null, obtenu: o.amount_ht, ecart: Math.abs(o.amount_ht), ok: false })
  }

  const exacts = champs.filter(c => c.ok).length
  return {
    invoice_id: invoiceId,
    fournisseur,
    date,
    lignes_attendues: attendu.length,
    lignes_obtenues: obtenu.length,
    total: champs.length,
    exacts,
    exactitude: champs.length ? exacts / champs.length : 1,
    prix_exploitables: obtenu.filter(prixExploitable).length,
    prix_gagnes: prixGagnes,
    prix_perdus: prixPerdus,
    divergences: champs.filter(c => !c.ok),
  }
}

/** Agrège les cas. L'exactitude porte sur le TOTAL des chiffres (une facture
 *  plus riche pèse plus lourd), pas sur la moyenne des taux par facture. */
export function aggregerFactures(cas: CasFacture[]): CorpusFactures {
  const total_chiffres = cas.reduce((s, c) => s + c.total, 0)
  const exacts = cas.reduce((s, c) => s + c.exacts, 0)
  return {
    cas: cas.length,
    total_chiffres,
    exacts,
    exactitude: total_chiffres ? exacts / total_chiffres : 1,
    lignes_attendues: cas.reduce((s, c) => s + c.lignes_attendues, 0),
    lignes_obtenues: cas.reduce((s, c) => s + c.lignes_obtenues, 0),
    prix_exploitables: cas.reduce((s, c) => s + c.prix_exploitables, 0),
    prix_gagnes: cas.reduce((s, c) => s + c.prix_gagnes, 0),
    prix_perdus: cas.reduce((s, c) => s + c.prix_perdus, 0),
    par_cas: cas,
  }
}
