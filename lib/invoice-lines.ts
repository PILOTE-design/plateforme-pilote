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

/**
 * La quantité RÉPARÉE : `montant ÷ prix unitaire`, quand le prix est lu mais
 * qu'aucune assiette ne tombe juste.
 *
 * Le résultat n'est accepté que s'il est PLAUSIBLE. Sans ces bornes, une erreur
 * de lecture du prix fabriquerait une quantité absurde qu'on écrirait en base :
 *
 *  · quantité strictement positive et finie ;
 *  · pas plus de 100 000 (au-delà, c'est le prix qui a été mal lu, pas la
 *    quantité qui est grande) ;
 *  · et surtout, elle doit être PLUS GRANDE que la quantité lue — c'est le
 *    sens même du défaut observé : un conditionnement contient plusieurs
 *    unités (1 seau → 10 kg, « 6 × colisage 2 » → 12). Une quantité réparée
 *    plus PETITE que celle lue signalerait autre chose, qu'on ne comprend pas
 *    encore : on s'abstient.
 *
 * Le signe est repris de la quantité lue : sur un avoir, une quantité négative
 * doit le rester.
 */
export function quantiteReparee(l: LigneBrute): number | null {
  const pu = l.unit_price_ht
  if (pu == null || !Number.isFinite(pu) || pu === 0) return null
  if (!Number.isFinite(l.amount_ht) || l.amount_ht === 0) return null
  const q = Math.abs(l.amount_ht / pu)
  if (!Number.isFinite(q) || q <= 0 || q > 100000) return null
  const lue = l.quantity != null && Number.isFinite(l.quantity) ? Math.abs(l.quantity) : null
  // Sans quantité lue, il n'y a rien à « réparer » — la ligne relève du cas
  // « prix seul », déjà accepté ailleurs.
  if (lue === null || lue === 0) return null
  // Tolérance de forme : q doit dépasser la quantité lue d'au moins un demi
  // pour cent, sinon les deux disent la même chose et le recoupement aurait
  // déjà réussi.
  if (q <= lue * 1.005) return null
  const signe = (l.quantity as number) < 0 ? -1 : 1
  return round4(q * signe)
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
  const vide: VerdictLigne = { prix_retenu: null, prix_ecarte: null, quantite_reparee: null, base: null, avoir }

  // UN AVOIR NE DONNE JAMAIS DE PRIX — et ce n'est pas un échec.
  // Le prix qui y figure est celui d'un achat passé, souvent ancien : le
  // publier comme « dernier prix » ferait remonter dans la mercuriale un tarif
  // que le fournisseur ne pratique plus. On l'écarte, sans le compter comme un
  // défaut de lecture, parce que c'est le comportement voulu.
  if (avoir) return vide

  const pu = l.unit_price_ht

  if (pu != null && Number.isFinite(pu) && pu !== 0) {
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
