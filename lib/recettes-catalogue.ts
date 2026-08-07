// lib/recettes-catalogue.ts — DEUX QUESTIONS QUE LA LISTE DES FICHES NE SAVAIT
// PAS ENCORE RÉPONDRE. Lot 116. Module PUR, testable hors ligne.
//
// ─── 1. « OÙ EN EST MON CATALOGUE ? » ─────────────────────────────────────
//
// Relevé chez Otami en lecture seule le 06/08/2026 : l'en-tête de leur colonne
// « Marge » ne porte pas qu'un titre, il porte le coefficient et le taux MOYENS
// du catalogue — « × 2.6 » « 57 % ». Chaque ligne se lit alors PAR RAPPORT à la
// moyenne, sans que l'œil ait à faire la moyenne. Zéro pixel de plus.
//
// PILOTE rappelait déjà la CIBLE dans cet en-tête. Une cible dit où l'on veut
// aller ; elle ne dit pas où l'on est. Les deux ensemble suffisent à savoir s'il
// faut agir, et c'est tout l'intérêt de la ligne.
//
// LÀ OÙ ON FAIT AUTREMENT QU'OTAMI, ET POURQUOI. Chez eux « × 2.6 » et « 57 % »
// se contredisent : 1/(1 − 0,57) = 2,33, pas 2,6. Ce sont deux moyennes
// ARITHMÉTIQUES calculées séparément, et la moyenne arithmétique d'un rapport
// n'est pas le rapport des moyennes. Conséquence concrète : un tout petit
// produit à ×12 tire la moyenne des coefficients vers le haut alors qu'il ne
// pèse presque rien dans la maison.
//
// Ici la moyenne est PONDÉRÉE : on additionne les prix de vente d'un côté, les
// coûts de l'autre, et on divise. C'est la marge qu'on ferait en vendant une
// unité de chaque — donc un chiffre qui a un sens de boucherie, et dont les deux
// écritures sont cohérentes par construction (`coefficient = 1/(1 − marge)`).
// Le libellé le dit à l'écran : « à volumes égaux ». On ne connaît pas encore
// les volumes vendus ; le jour où on les aura, c'est la SEULE fonction à
// changer, et les deux écritures resteront d'accord.
//
// Et comme toujours ici : la moyenne annonce SUR COMBIEN de formats elle porte,
// et combien sont restés dehors. Une moyenne muette sur son assiette est un
// chiffre faux qui s'ignore.
//
// ─── 2. « QU'EST-CE QUE JE FAIS MAINTENANT ? » ────────────────────────────
//
// Une fiche recette se remplit en plusieurs fois, et rien à l'écran ne disait à
// son auteur ce qu'il lui restait à faire ni ce que chaque trou lui coûtait. Un
// boucher qui ouvre sa fiche et n'y voit pas de marge n'a aucun moyen de savoir
// si c'est un prix de vente qui manque, un ingrédient sans prix, ou un rendement
// oublié — trois causes, trois gestes différents, un seul tiret à l'écran.
//
// `manquesDeLaFiche` les nomme, dans l'ordre où ils se règlent, chacun avec
// L'EFFET qu'il produit tant qu'il dure. `prochainGeste` n'en rend qu'UN : celui
// par lequel commencer. Une liste de douze choses à faire ne se lit pas ; une
// seule phrase se lit.

/** Ce qu'il faut d'une ligne pour la faire entrer dans la moyenne. Volontairement
 *  réduit : ni nom, ni catégorie, ni identité — la moyenne ne juge personne. */
export type EntreeMoyenne = {
  /** Prix de vente HT de l'unité de vente du format */
  pv_ht: number | null
  /** Coût de revient de cette même unité, selon l'interrupteur main-d'œuvre */
  cout_unite: number | null
  /** Nombre d'ingrédients sans prix connu de la fiche — > 0 : rien n'est publié */
  prix_manquants: number
}

export type MoyenneCatalogue = {
  /** Coefficient moyen pondéré — null si aucun format n'est chiffrable */
  coefficient: number | null
  /** Taux de marge moyen pondéré, en % — cohérent avec le coefficient */
  marge_pct: number | null
  /** Nombre de formats qui composent la moyenne */
  comptes: number
  /** Nombre de formats laissés dehors faute de marge calculable — annoncé à
   *  l'écran, jamais tu : une moyenne muette sur son assiette est un chiffre
   *  faux qui s'ignore. */
  ignores: number
  /** Total des prix de vente retenus — sert à expliquer la pondération */
  pv_total: number
  /** Total des coûts retenus */
  cout_total: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * La moyenne du catalogue, pondérée par le prix.
 *
 * Un format n'entre que s'il est PUBLIABLE, c'est-à-dire exactement aux mêmes
 * conditions que `margeEtCoef` de `lib/recipes` : un prix de vente strictement
 * positif, un coût strictement positif, et aucun ingrédient sans prix. Reprendre
 * ces conditions à l'identique n'est pas de la redite : c'est ce qui garantit
 * qu'aucune ligne affichée « — » ne se retrouve fondue dans la moyenne du haut.
 *
 * Un coût NUL sort aussi, et c'est important : une fiche sans le moindre
 * ingrédient coûte zéro, donc marge 100 % et coefficient infini. La laisser
 * entrer ferait monter la moyenne du catalogue à chaque fiche VIDE créée.
 */
export function moyenneCatalogue(entrees: EntreeMoyenne[]): MoyenneCatalogue {
  let pv = 0
  let cout = 0
  let comptes = 0
  let ignores = 0

  for (const e of entrees) {
    const pvOk = typeof e.pv_ht === 'number' && Number.isFinite(e.pv_ht) && e.pv_ht > 0
    const coutOk = typeof e.cout_unite === 'number' && Number.isFinite(e.cout_unite) && e.cout_unite > 0
    if (!pvOk || !coutOk || e.prix_manquants > 0) { ignores++; continue }
    pv += e.pv_ht as number
    cout += e.cout_unite as number
    comptes++
  }

  if (comptes === 0 || cout <= 0) {
    return { coefficient: null, marge_pct: null, comptes: 0, ignores, pv_total: 0, cout_total: 0 }
  }

  return {
    coefficient: round2(pv / cout),
    marge_pct: round2(((pv - cout) / pv) * 100),
    comptes,
    ignores,
    pv_total: round2(pv),
    cout_total: round2(cout),
  }
}

/** Une phrase pour l'infobulle de la moyenne — dit son assiette, et ce qui est
 *  resté dehors. Jamais de moyenne sans son assiette. */
export function phraseMoyenne(m: MoyenneCatalogue): string {
  if (m.comptes === 0) {
    return m.ignores > 0
      ? `Aucune moyenne : les ${m.ignores} formats affichés n’ont pas encore de marge calculable.`
      : 'Aucune moyenne : aucun format affiché.'
  }
  const base = `Moyenne à volumes égaux sur ${m.comptes} format${m.comptes > 1 ? 's' : ''}`
  return m.ignores > 0
    ? `${base} — ${m.ignores} sans marge calculable ${m.ignores > 1 ? 'sont restés' : 'est resté'} dehors.`
    : `${base}.`
}

// ─────────────────────────────────────────────────────────────────────────────
// CE QU'IL RESTE À FAIRE SUR UNE FICHE
// ─────────────────────────────────────────────────────────────────────────────

/** Gravité d'un manque — l'ordre du type EST l'ordre de traitement.
 *
 *  `bloquant` : sans ça, la fiche ne produit AUCUN chiffre.
 *  `fausse`   : la fiche produit un chiffre, et il est SOUS-ESTIMÉ. Le pire des
 *               trois : elle a l'air de marcher.
 *  `confort`  : la fiche est juste, il lui manque un réglage.
 */
export type Gravite = 'bloquant' | 'fausse' | 'confort'

export type Manque = {
  cle: 'ingredients' | 'prix_ingredient' | 'rendement' | 'prix_vente' | 'temps' | 'categorie' | 'validation'
  gravite: Gravite
  /** Ce qui manque, à la première personne du métier */
  titre: string
  /** CE QUE ÇA EMPÊCHE — la moitié utile. Un manque sans conséquence énoncée
   *  ressemble à une brimade de formulaire. */
  effet: string
}

/** L'état d'une fiche, vu du créateur. Les champs sont ceux que la liste et la
 *  fiche portent déjà : rien de nouveau n'est demandé au serveur. */
export type FichePourEtat = {
  /** Nombre de lignes d'ingrédients */
  ingredients: number
  /** Nombre d'ingrédients dont le prix est inconnu */
  prix_manquants: number
  /** Quantité vendable (rendement ou quantité de vente du format) */
  vente_qty: number
  /** Prix de vente TTC du format */
  selling_price_ttc: number | null
  /** Minutes de fabrication relevées (étapes chronométrées comprises) */
  minutes: number
  category: string | null
  /** Le format a été relu et validé par quelqu'un */
  validated: boolean
}

/**
 * Tout ce qu'il reste à faire sur une fiche, dans l'ordre où ça se règle.
 *
 * L'ordre n'est pas cosmétique : chaque manque de la liste rend le suivant
 * inutile à traiter tout de suite. Poser un prix de vente sur une fiche qui n'a
 * aucun ingrédient donne une marge de 100 % — un chiffre faux, obtenu en
 * répondant trop tôt à la mauvaise question.
 */
export function manquesDeLaFiche(f: FichePourEtat): Manque[] {
  const out: Manque[] = []

  if (f.ingredients <= 0) {
    out.push({
      cle: 'ingredients', gravite: 'bloquant',
      titre: 'Aucun ingrédient',
      effet: 'La fiche ne coûte rien tant qu’elle est vide — aucun coût, aucune marge.',
    })
  } else if (f.prix_manquants > 0) {
    // Ce cas est le plus traître du lot : la fiche AFFICHE un coût, et ce coût
    // est faux par le bas. On ne publie ni marge ni coefficient dans ce cas
    // (règle du moteur), mais le coût, lui, se voit — d'où « sous-estimé ».
    out.push({
      cle: 'prix_ingredient', gravite: 'fausse',
      titre: `${f.prix_manquants} ingrédient${f.prix_manquants > 1 ? 's' : ''} sans prix connu`,
      effet: 'Le coût affiché est sous-estimé et aucune marge n’est publiée tant qu’il en manque un.',
    })
  }

  if (!(f.vente_qty > 0)) {
    out.push({
      cle: 'rendement', gravite: 'bloquant',
      titre: 'Rendement non renseigné',
      effet: 'Sans savoir ce que le batch produit, le coût reste celui du batch entier au lieu de l’unité vendue.',
    })
  }

  if (!(typeof f.selling_price_ttc === 'number' && f.selling_price_ttc > 0)) {
    out.push({
      cle: 'prix_vente', gravite: 'bloquant',
      titre: 'Pas de prix de vente',
      effet: 'Sans prix, ni marge ni coefficient — la fiche dit ce qu’elle coûte, pas ce qu’elle rapporte.',
    })
  }

  if (!(f.minutes > 0)) {
    out.push({
      cle: 'temps', gravite: 'fausse',
      titre: 'Aucun temps de fabrication',
      effet: 'La main-d’œuvre compte pour zéro : le coût complet est sous-estimé, et la marge trop belle.',
    })
  }

  if (!(f.category && f.category.trim())) {
    out.push({
      cle: 'categorie', gravite: 'confort',
      titre: 'Pas de catégorie',
      effet: 'La fiche échappe à la cible de marge de son rayon : sa marge n’est comparée à rien.',
    })
  }

  if (!f.validated) {
    out.push({
      cle: 'validation', gravite: 'confort',
      titre: 'Format jamais relu',
      effet: 'Personne n’a encore confirmé ce format : il n’a pas sa coche verte dans la liste.',
    })
  }

  return out
}

/** Le poids d'une gravité : plus il est bas, plus le manque passe devant.
 *  `bloquant` d'abord (aucun chiffre), puis `fausse` (un chiffre, sous-estimé),
 *  `confort` en dernier (la fiche est juste, il lui manque un réglage). */
const RANG: Record<Gravite, number> = { bloquant: 0, fausse: 1, confort: 2 }

/**
 * LE geste suivant — un seul.
 *
 * On prend le plus grave, et à gravité égale le premier dans l'ordre de la
 * liste (qui est l'ordre de fabrication d'une fiche). `null` quand il n'y a plus
 * rien à faire : c'est une information à part entière, et l'écran l'affiche
 * comme telle plutôt que de masquer silencieusement le bloc.
 */
export function prochainGeste(manques: Manque[]): Manque | null {
  if (manques.length === 0) return null
  let meilleur = manques[0]
  for (const m of manques) {
    if (RANG[m.gravite] < RANG[meilleur.gravite]) meilleur = m
  }
  return meilleur
}

/** Combien d'étapes sont faites sur les sept possibles. Sert la barre de
 *  progression, et RIEN d'autre : ce n'est pas une note, c'est un repère. */
export function progressionFiche(manques: Manque[]): { faites: number; total: number; pct: number } {
  const total = 7
  const faites = Math.max(0, total - manques.length)
  return { faites, total, pct: Math.round((faites / total) * 100) }
}

/** Une fiche est EXPLOITABLE quand plus rien ne la bloque ni ne la fausse — les
 *  manques de confort ne l'empêchent pas de servir. */
export function ficheExploitable(manques: Manque[]): boolean {
  return !manques.some(m => m.gravite === 'bloquant' || m.gravite === 'fausse')
}
