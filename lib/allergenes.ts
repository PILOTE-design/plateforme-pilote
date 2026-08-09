// lib/allergenes.ts — LES QUATORZE ALLERGÈNES À DÉCLARATION OBLIGATOIRE.
// Lot 125. Module PUR, testable hors ligne.
//
// La liste n'est pas à nous : c'est l'annexe II du règlement INCO 1169/2011,
// obligatoire pour la vente en vrac — le comptoir d'une boucherie, donc. Elle
// est FERMÉE : quatorze entrées, ni plus ni moins, pas de saisie libre. Un
// allergène tapé à la main (« lait de vache », « lactose », « laitier ») ne se
// filtrerait plus, ne s'imprimerait plus pareil d'une fiche à l'autre, et
// finirait par en cacher un vrai.
//
// Le champ `recipes.allergens` stocke les IDENTIFIANTS (['gluten','lait']),
// jamais les libellés : un libellé corrigé demain ne doit pas invalider les
// fiches d'hier.
//
// Ce module ne DÉTECTE rien : il ne devine pas les allergènes depuis les
// ingrédients. La détection automatique serait un chiffre faux en puissance —
// une « saucisse » peut porter du lactose ou pas selon la recette de la maison,
// et un allergène manqué par un automatisme engage la responsabilité du
// boucher. C'est lui qui coche, nous qui rangeons et imprimons.

export type AllergeneId =
  | 'gluten' | 'crustaces' | 'oeufs' | 'poissons' | 'arachides' | 'soja'
  | 'lait' | 'fruits_a_coque' | 'celeri' | 'moutarde' | 'sesame'
  | 'sulfites' | 'lupin' | 'mollusques'

export type Allergene = {
  id: AllergeneId
  /** Le libellé réglementaire, tel qu'il s'imprime sur l'étiquette */
  label: string
  /** La précision de l'annexe II, quand elle éclaire (montrée en infobulle) */
  detail: string | null
}

/** L'ordre est celui de l'annexe II du règlement — c'est aussi celui dans
 *  lequel les DDPP ont l'habitude de le lire. On ne le réordonne pas. */
export const ALLERGENES: readonly Allergene[] = [
  { id: 'gluten', label: 'Céréales à gluten', detail: 'blé, seigle, orge, avoine, épeautre, kamut' },
  { id: 'crustaces', label: 'Crustacés', detail: null },
  { id: 'oeufs', label: 'Œufs', detail: null },
  { id: 'poissons', label: 'Poissons', detail: null },
  { id: 'arachides', label: 'Arachides', detail: null },
  { id: 'soja', label: 'Soja', detail: null },
  { id: 'lait', label: 'Lait', detail: 'y compris le lactose' },
  { id: 'fruits_a_coque', label: 'Fruits à coque', detail: 'amandes, noisettes, noix, cajou, pécan, macadamia, pistaches, noix du Brésil' },
  { id: 'celeri', label: 'Céleri', detail: null },
  { id: 'moutarde', label: 'Moutarde', detail: null },
  { id: 'sesame', label: 'Graines de sésame', detail: null },
  { id: 'sulfites', label: 'Sulfites', detail: 'anhydride sulfureux et sulfites > 10 mg/kg' },
  { id: 'lupin', label: 'Lupin', detail: null },
  { id: 'mollusques', label: 'Mollusques', detail: null },
] as const

const PAR_ID: ReadonlyMap<string, Allergene> = new Map(ALLERGENES.map(a => [a.id, a]))

/** Un identifiant est-il l'un des quatorze ? */
export const estAllergene = (v: unknown): v is AllergeneId =>
  typeof v === 'string' && PAR_ID.has(v)

/**
 * Lit le jsonb de la base (ou n'importe quoi reçu d'un formulaire) et rend une
 * liste PROPRE : identifiants connus seulement, dédoublonnés, dans l'ordre de
 * l'annexe II — jamais l'ordre de saisie. Deux fiches qui portent « lait et
 * gluten » et « gluten et lait » doivent s'imprimer PAREIL.
 *
 * Tout le reste est écarté en silence : ce parseur reçoit des données déjà
 * rangées par nous ; un intrus n'est pas une information, c'est un débris.
 */
export function parseAllergenes(brut: unknown): AllergeneId[] {
  if (!Array.isArray(brut)) return []
  const vus = new Set<AllergeneId>()
  for (const v of brut) {
    if (estAllergene(v)) vus.add(v)
  }
  return ALLERGENES.filter(a => vus.has(a.id)).map(a => a.id)
}

/** Le libellé d'un identifiant — jamais l'inverse. */
export const labelAllergene = (id: AllergeneId): string => PAR_ID.get(id)!.label

/**
 * La ligne d'étiquette : « Allergènes : céréales à gluten, lait, moutarde ».
 * Chaîne vide quand il n'y en a aucun — au PDF de décider quoi écrire alors
 * (« aucun allergène déclaré », pas un silence : sur une étiquette, l'absence
 * de mention doit être un choix visible, pas un oubli possible).
 */
export function ligneEtiquette(ids: AllergeneId[]): string {
  const propres = parseAllergenes(ids)
  if (propres.length === 0) return ''
  const libelles = propres.map(id => {
    const l = labelAllergene(id)
    return l.charAt(0).toLowerCase() + l.slice(1)
  })
  return `Allergènes : ${libelles.join(', ')}`
}
