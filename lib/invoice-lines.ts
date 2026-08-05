/**
 * LE VERDICT D'UNE LIGNE DE FACTURE — publier son prix, ou pas.
 *
 * Module PUR, testable hors ligne. C'est le garde-fou le plus important du
 * projet : ce qui sort d'ici devient un prix de mercuriale, donc un coût de
 * revient, donc une marge affichée au boucher.
 *
 * ─── CE QUE DEUX FACTURES ONT APPRIS (04/08/2026) ─────────────────────────
 *
 * Douze factures étaient signalées en échec après le rattrapage. En ouvrant les
 * PDF, le même défaut est apparu chez deux fournisseurs aux formats pourtant
 * très différents :
 *
 *   · DAT-SCHAUB — « LABELMERGUEZ AS/SL OPTIM/133560-SEAU DE 10 KG », prix
 *     unitaire 12,50 €, montant 125,00 €. La lecture avait retenu « 1 seau »
 *     au lieu de « 10 kilos ».
 *   · METRO — « SAN PELL 1L PET », prix unitaire 0,652 €, colonnes « Qté 6 »
 *     et « Colisage 2 », montant 7,82 €. La quantité réelle est le PRODUIT des
 *     deux (12) ; la lecture n'en retenait qu'une.
 *
 * Dans les deux cas le prix unitaire imprimé était JUSTE, et c'est la quantité
 * qui était fausse. Or le contrôle `qté × PU = montant` échouait, et c'est le
 * PRIX qu'on jetait — celui des deux chiffres qui était bon.
 *
 * D'où la règle de ce module : quand le prix et le montant se recoupent sur une
 * quantité PLAUSIBLE, on garde le prix et on répare la quantité. Le prix reste
 * ce qui a été lu ; la quantité, elle, est reconstruite par une division dont
 * le résultat est vérifié.
 *
 * ─── CE QU'ON NE FAIT PAS ─────────────────────────────────────────────────
 *
 * On ne dérive JAMAIS un prix depuis une quantité qui pourrait être un
 * conditionnement. `125 € ÷ 1 seau` aurait publié 125 €/kg là où le vrai prix
 * est 12,50 €/kg — dix fois trop cher, dans la mercuriale et dans toutes les
 * fiches qui utilisent l'article. Un prix manquant est un trou visible ; un
 * prix faux est invisible et se propage.
 */

/** Ce qu'une ligne offre au contrôle. */
export type LigneBrute = {
  /** Libellé lu. Il porte souvent le CONDITIONNEMENT (« … 5L », « SEAU DE
   *  10 KG ») : c'est le seul témoin extérieur au calcul, et le seul moyen de
   *  distinguer un poids d'un prix quand les deux colonnes ont été échangées. */
  designation?: string | null
  /** Quantité lue (nombre de colis, de pièces, de kilos… selon le fournisseur) */
  quantity: number | null
  /** Poids facturé en kilos, quand la ligne en porte un. Assiette SÛRE. */
  weight_kg: number | null
  /** Prix unitaire LU sur la facture. null : la colonne n'a pas été lue. */
  unit_price_ht: number | null
  amount_ht: number
  /** Unité facturée telle qu'écrite (« kg », « seau », « colis »…) */
  unit: string | null
}

export type BaseVerdict =
  | 'poids'              // le prix se recoupe sur le poids facturé
  | 'quantite'           // … sur la quantité lue
  | 'quantite_reparee'   // … sur une quantité reconstruite depuis le prix
  | 'colonnes_inversees' // le « prix » lu était le conditionnement : on rend les deux à leur place
  | 'derive_poids'       // prix absent, déduit du poids (assiette sûre)
  | 'derive_quantite'    // prix absent, déduit de la quantité (unité sûre)
  | 'prix_seul'          // prix lu, rien pour le contredire
  | null

export type VerdictLigne = {
  /** Prix retenu pour la mercuriale. null = quarantaine. */
  prix_retenu: number | null
  /** Prix LU mais écarté — conservé pour le diagnostic, jamais publié. */
  prix_ecarte: number | null
  /** Quantité reconstruite, quand elle a été réparée. null sinon. */
  quantite_reparee: number | null
  /** Poids/volume facturé reconstruit, quand les deux colonnes étaient
   *  échangées. null sinon. */
  poids_repare: number | null
  base: BaseVerdict
  /** Un avoir : montant négatif. Ce n'est PAS un échec de lecture. */
  avoir: boolean
}

const round4 = (n: number) => Math.round(n * 10000) / 10000

/** Unités de MESURE : une quantité exprimée là-dedans est une vraie quantité,
 *  pas un conditionnement. Tout le reste (seau, colis, carton, sac…) est
 *  suspect — c'est exactement là que le prix au kilo devient un prix au colis. */
const UNITES_DE_MESURE = new Set([
  'kg', 'kgs', 'kilo', 'kilos', 'k', 'g', 'gr', 'gramme', 'grammes',
  'l', 'litre', 'litres', 'cl', 'ml',
  'piece', 'pièce', 'pieces', 'pièces', 'pi', 'pce', 'pc', 'u', 'un', 'unite', 'unité', 'unites', 'unités',
])

const norm = (s: string | null | undefined) =>
  String(s ?? '').trim().toLowerCase().replace(/\.$/, '')

/** L'unité désigne-t-elle une mesure, et non un conditionnement ? */
export function uniteDeMesure(unit: string | null | undefined): boolean {
  return UNITES_DE_MESURE.has(norm(unit))
}

/** Tolérance de recoupement d'une ligne : le centime, ou 1 % du montant. */
export const tolerance = (montant: number) => Math.max(0.05, Math.abs(montant) * 0.01)

/**
 * L'assiette sur laquelle `qté × PU = montant` tombe juste.
 *
 * On n'essaie pas de DEVINER laquelle des colonnes porte le prix : on teste le
 * poids puis la quantité, et le recoupement lui-même désigne la bonne. Sur une
 * même facture DAVID MASTER, une ligne se recoupe sur le poids (saucisson au
 * kilo) et la suivante sur les pièces (aspic à la pièce).
 */
export function assietteQuiTombeJuste(l: LigneBrute): { base: 'poids' | 'quantite'; valeur: number } | null {
  if (l.unit_price_ht == null || !Number.isFinite(l.unit_price_ht)) return null
  const tol = tolerance(l.amount_ht)
  const candidats: Array<{ base: 'poids' | 'quantite'; valeur: number | null }> = [
    { base: 'poids', valeur: l.weight_kg },
    { base: 'quantite', valeur: l.quantity },
  ]
  for (const c of candidats) {
    if (c.valeur == null || c.valeur === 0 || !Number.isFinite(c.valeur)) continue
    if (Math.abs(c.valeur * l.unit_price_ht - l.amount_ht) <= tol) return { base: c.base, valeur: c.valeur }
  }
  return null
}

/* ─── LE CONDITIONNEMENT ANNONCÉ PAR LE LIBELLÉ ──────────────────────────────
 *
 * `qté × PU = montant` ne sait pas distinguer un poids d'un prix : la
 * multiplication est commutative. Si l'extraction échange les deux colonnes,
 * le contrôle tombe juste QUAND MÊME, et c'est le conditionnement qui est
 * publié comme prix. Mesuré en production le 05/08 chez METRO :
 *
 *   MAUREL HLE TOURNESOL 5L   « poids » 1,998 · « PU » 5,00 · montant 9,99
 *   MAUREL HLE TOURNESOL 10L  « poids » 1,925 · « PU » 10,00 · montant 19,25
 *
 * Les deux lignes se recoupent parfaitement (1,998 × 5 = 9,99), et les deux
 * publient un prix faux — 5 €/L pour une huile à 1,998 €/L, deux fois et demie
 * trop cher dans toutes les fiches recettes qui l'utilisent. La même huile,
 * bien lue sur une autre facture, est à 1,998 €/L : c'est en comparant les deux
 * lectures du MÊME article qu'on voit le défaut, jamais en relisant le calcul.
 *
 * Il faut donc un témoin EXTÉRIEUR au calcul. Le libellé en est un : « 5L » dit
 * cinq litres, pas cinq euros. */

/** Familles d'unités : deux valeurs ne se comparent que dans la même. */
const FAMILLE: Record<string, { famille: 'poids' | 'volume'; enBase: number }> = {
  kg: { famille: 'poids', enBase: 1 }, kgs: { famille: 'poids', enBase: 1 },
  kilo: { famille: 'poids', enBase: 1 }, kilos: { famille: 'poids', enBase: 1 },
  g: { famille: 'poids', enBase: 0.001 }, gr: { famille: 'poids', enBase: 0.001 },
  gramme: { famille: 'poids', enBase: 0.001 }, grammes: { famille: 'poids', enBase: 0.001 },
  l: { famille: 'volume', enBase: 1 }, lt: { famille: 'volume', enBase: 1 },
  ltr: { famille: 'volume', enBase: 1 }, litre: { famille: 'volume', enBase: 1 },
  litres: { famille: 'volume', enBase: 1 },
  cl: { famille: 'volume', enBase: 0.01 }, ml: { famille: 'volume', enBase: 0.001 },
}

const UNITES_LIBELLE = 'kgs|kg|kilos|kilo|grammes|gramme|gr|g|litres|litre|ltr|lt|cl|ml|l'
const RE_CONTENANCE = new RegExp(
  `(?<![A-Za-z0-9.,])(\\d+(?:[.,]\\d+)?)\\s*(${UNITES_LIBELLE})(?![A-Za-z])`,
  'gi',
)

/**
 * Le conditionnement annoncé par le libellé, exprimé dans l'unité de la ligne.
 *
 * Rendu SEULEMENT s'il est sans ambiguïté : une seule valeur, dans la même
 * famille que l'unité facturée. « 2X5L » ou « 5L 1L » ne donnent rien — deux
 * lectures possibles ne valent pas mieux qu'aucune.
 */
export function contenanceAnnoncee(
  designation: string | null | undefined,
  unit: string | null | undefined,
): number | null {
  const uniteLigne = FAMILLE[norm(unit)]
  if (!uniteLigne) return null
  const texte = String(designation ?? '')
  if (!texte) return null

  // Boucle `exec` plutôt que `matchAll` : ce module est le garde-fou le plus
  // sensible du projet, il ne doit dépendre d'aucun réglage de compilation.
  const valeurs: number[] = []
  RE_CONTENANCE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = RE_CONTENANCE.exec(texte)) !== null) {
    const brut = Number(String(m[1]).replace(',', '.'))
    const u = FAMILLE[norm(m[2])]
    if (!u || u.famille !== uniteLigne.famille) continue
    if (!Number.isFinite(brut) || brut <= 0) continue
    // Ramené à l'unité de la LIGNE : « 500 G » sur une ligne au kilo vaut 0,5.
    const v = round4((brut * u.enBase) / uniteLigne.enBase)
    if (valeurs.indexOf(v) === -1) valeurs.push(v)
  }
  if (valeurs.length !== 1) return null
  return valeurs[0] > 0 ? valeurs[0] : null
}

/**
 * LES DEUX COLONNES ONT-ELLES ÉTÉ ÉCHANGÉES ?
 *
 * Trois conditions, toutes nécessaires — la troisième est celle qui rend la
 * règle sûre :
 *
 *  1. le libellé annonce un conditionnement C, sans ambiguïté ;
 *  2. le « prix unitaire » lu VAUT ce conditionnement (5L → « PU » 5,00) ;
 *  3. et la colonne poids porte, elle, EXACTEMENT le prix qu'on recalcule
 *     depuis le montant. C'est la signature d'un échange, et non d'une
 *     coïncidence : les deux nombres se retrouvent chacun à la place de
 *     l'autre.
 *
 * Sans la condition 3, une huile facturée pour de vrai 5 € le litre en
 * bidon de 5 L serait « corrigée » sur une simple ressemblance. Avec elle, ce
 * cas-là donne de toute façon le même prix — la règle ne peut pas rendre un
 * résultat différent de la lecture quand la lecture est juste.
 *
 * On ne dérive rien ici : le prix rendu est le nombre qui était DÉJÀ sur la
 * ligne, remis dans la bonne colonne.
 */
export function colonnesInversees(l: LigneBrute): { prix: number; assiette: number } | null {
  const pu = l.unit_price_ht
  if (pu == null || !Number.isFinite(pu) || pu <= 0) return null
  if (!Number.isFinite(l.amount_ht) || l.amount_ht <= 0) return null

  const c = contenanceAnnoncee(l.designation, l.unit)
  if (c == null) return null
  // 2. le « prix » lu est le conditionnement.
  if (Math.abs(pu - c) > 0.005) return null

  const q = l.quantity != null && Number.isFinite(l.quantity) ? Math.abs(l.quantity) : null
  if (q == null || q <= 0) return null
  // Le vrai poids/volume facturé : le conditionnement, autant de fois qu'il y
  // a d'unités. 2 bidons de 5 L font 10 L.
  const assiette = round4(c * q)
  if (assiette <= 0) return null
  const prix = l.amount_ht / assiette
  if (!Number.isFinite(prix) || prix <= 0) return null

  // 3. LA CONFIRMATION. La colonne poids doit porter ce prix-là.
  const autre = l.weight_kg
  if (autre == null || !Number.isFinite(autre)) return null
  if (Math.abs(autre - prix) > Math.max(0.005, prix * 0.005)) return null

  return { prix: round4(prix), assiette }
}

/**
 * La quantité RÉPARÉE : `montant ÷ prix unitaire`, quand le prix est lu mais
 * qu'aucune assiette ne tombe juste.
 *
 * Le résultat n'est accepté que s'il est PLAUSIBLE. Sans ces bornes, une erreur
 * de lecture du prix fabriquerait une quantité absurde qu'on écrirait en base :
 *
 *  · quantité strictement positive et finie ;
 *  · et surtout — c'est LA borne, apprise en production le 04/08 — le rapport
 *    entre la quantité réparée et la quantité lue doit être un ENTIER.
 *
 * Cette dernière règle a été ajoutée après une régression réelle. La première
 * version se contentait d'exiger « plus grande que la quantité lue », et une
 * relecture en production a produit :
 *
 *   MPRO 25 BTE PLATEAU  qté lue 3, « PU » lu 1,00 €, montant 44,13 €
 *                        → quantité réparée 44,13, prix publié 1,00 €/pièce
 *                        alors que le vrai prix est 14,71 €/pièce.
 *
 * L'extraction avait pris pour prix unitaire une valeur qui n'en était pas, et
 * la réparation a fabriqué une quantité absurde pour la faire coller. Sur 52
 * lignes réparées, 38 étaient fausses.
 *
 * Le rapport ENTIER les sépare exactement : un conditionnement contient un
 * nombre ENTIER d'unités (1 seau → 10 kg, 6 × colisage 2 → 12 pièces), jamais
 * 14,71. Vérifié sur les cas réels : LABELMERGUEZ 10/1 = 10 ✓, SAN PELL
 * 12/2 = 6 ✓, MPRO 44,13/3 = 14,71 ✗, MAUREL 3,996/2 = 1,998 ✗.
 *
 * Le signe est repris de la quantité lue : sur un avoir, une quantité négative
 * doit le rester.
 */
export function quantiteReparee(l: LigneBrute): number | null {
  const pu = l.unit_price_ht
  if (pu == null || !Number.isFinite(pu) || pu === 0) return null
  if (!Number.isFinite(l.amount_ht) || l.amount_ht === 0) return null
  const q = Math.abs(l.amount_ht / pu)
  if (!Number.isFinite(q) || q <= 0) return null
  const lue = l.quantity != null && Number.isFinite(l.quantity) ? Math.abs(l.quantity) : null
  // Sans quantité lue, il n'y a rien à « réparer » — la ligne relève du cas
  // « prix seul », déjà accepté ailleurs.
  if (lue === null || lue === 0) return null

  // LE RAPPORT DOIT ÊTRE UN ENTIER. Un conditionnement contient un nombre
  // entier d'unités ; 44,13 pièces pour 3 colis n'est pas un conditionnement,
  // c'est un prix mal lu. Sans cette borne, on publie 1,00 €/pièce là où le
  // prix est 14,71 € — mesuré en production, 38 lignes fausses sur 52.
  const rapport = q / lue
  const entier = Math.round(rapport)
  // Au moins 2 : à 1, les deux quantités disent la même chose et le
  // recoupement aurait déjà réussi. Au plus 10 000 : au-delà, c'est le prix
  // qui a été mal lu, pas le colis qui est grand.
  if (entier < 2 || entier > 10000) return null
  // ET LA QUANTITÉ RECONSTRUITE DOIT REDONNER LE MONTANT, au demi-centime.
  // Tester le rapport seul ne suffit pas : « 3,996 / 2 = 1,998 » frôle 2 par
  // coïncidence, et l'accepter publiait 5 €/L pour une huile à 1,998 €/L.
  // Vérifier le montant, c'est vérifier la chose qu'on affirme — la tolérance
  // reste au niveau de l'arrondi comptable, jamais à celui d'une erreur.
  const reconstruit = lue * entier * Math.abs(pu)
  const tol = Math.max(0.005, Math.abs(l.amount_ht) * 0.0005)
  if (Math.abs(reconstruit - Math.abs(l.amount_ht)) > tol) return null

  const signe = (l.quantity as number) < 0 ? -1 : 1
  // On rend la quantité EXACTE du conditionnement (lue × entier), et non le
  // quotient brut : « 11,9937 sachets » n'existe pas, 12 oui.
  return round4(lue * entier * signe)
}

/**
 * Le verdict complet d'une ligne.
 *
 * `factureSuspecte` : la somme des lignes ne boucle pas sur le total de la
 * facture. Dans ce cas RIEN n'est publié — un document globalement faux ne
 * produit pas de prix, même sur ses lignes qui se recoupent.
 */
export function verdictLigne(l: LigneBrute, factureSuspecte = false): VerdictLigne {
  const avoir = Number.isFinite(l.amount_ht) && l.amount_ht < 0
  const vide: VerdictLigne = { prix_retenu: null, prix_ecarte: null, quantite_reparee: null, poids_repare: null, base: null, avoir }

  // UN AVOIR NE DONNE JAMAIS DE PRIX — et ce n'est pas un échec.
  // Le prix qui y figure est celui d'un achat passé, souvent ancien : le
  // publier comme « dernier prix » ferait remonter dans la mercuriale un tarif
  // que le fournisseur ne pratique plus. On l'écarte, sans le compter comme un
  // défaut de lecture, parce que c'est le comportement voulu.
  if (avoir) return vide

  const pu = l.unit_price_ht

  if (pu != null && Number.isFinite(pu) && pu !== 0) {
    // D'ABORD l'échange de colonnes — AVANT le recoupement, parce que le
    // recoupement tombe juste sur une ligne échangée et publierait le
    // conditionnement en guise de prix. C'est le seul cas où `qté × PU =
    // montant` a raison sur le calcul et tort sur le sens.
    const inverse = colonnesInversees(l)
    if (inverse) {
      return factureSuspecte
        ? { ...vide, prix_ecarte: round4(pu) }
        : { ...vide, prix_retenu: inverse.prix, poids_repare: inverse.assiette, base: 'colonnes_inversees' }
    }

    const assiette = assietteQuiTombeJuste(l)
    if (assiette) {
      return factureSuspecte
        ? { ...vide, prix_ecarte: round4(pu) }
        : { ...vide, prix_retenu: round4(pu), base: assiette.base }
    }
    // Aucune assiette ne tombe juste : le PRIX est-il sauvable en réparant la
    // quantité ? C'est le cas DAT-SCHAUB et METRO.
    const reparee = quantiteReparee(l)
    if (reparee !== null) {
      return factureSuspecte
        ? { ...vide, prix_ecarte: round4(pu) }
        : { ...vide, prix_retenu: round4(pu), quantite_reparee: reparee, base: 'quantite_reparee' }
    }
    // Ni poids, ni quantité, ni réparation : le prix est seul face au montant.
    const aUneAssiette = (l.weight_kg != null && l.weight_kg !== 0) || (l.quantity != null && l.quantity !== 0)
    if (!aUneAssiette) {
      return factureSuspecte
        ? { ...vide, prix_ecarte: round4(pu) }
        : { ...vide, prix_retenu: round4(pu), base: 'prix_seul' }
    }
    // Une assiette existe et rien ne tombe juste : quarantaine, prix CONSERVÉ
    // pour le diagnostic — c'est ce chiffre-là qu'on jetait jusqu'ici.
    return { ...vide, prix_ecarte: round4(pu) }
  }

  // ── Prix ABSENT : on le dérive, mais seulement sur une assiette sûre ──
  if (factureSuspecte) return vide

  // Le poids est en kilos par définition : le prix qu'on en tire est un prix
  // au kilo, quelle que soit l'unité écrite sur la ligne.
  if (l.weight_kg != null && l.weight_kg > 0 && Number.isFinite(l.weight_kg)) {
    return { ...vide, prix_retenu: round4(l.amount_ht / l.weight_kg), base: 'derive_poids' }
  }
  // La quantité, elle, ne vaut que si l'unité est une MESURE. « 3 pièces » oui,
  // « 1 seau » non : c'est là que se joue le facteur dix.
  if (l.quantity != null && l.quantity > 0 && Number.isFinite(l.quantity) && uniteDeMesure(l.unit)) {
    return { ...vide, prix_retenu: round4(l.amount_ht / l.quantity), base: 'derive_quantite' }
  }
  return vide
}
