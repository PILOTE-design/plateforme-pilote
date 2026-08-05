/**
 * LA CLÉ D'UN CODE FOURNISSEUR — deux écritures, un seul article.
 *
 * Le rattachement d'une ligne de facture à son article se fait d'abord par le
 * code fournisseur, parce qu'il est stable là où le libellé bouge. Il l'est
 * moins qu'on ne croit : le MÊME produit, chez le MÊME fournisseur, arrive
 * écrit de deux façons d'une facture à l'autre. Relevé en production le
 * 05/08 chez la Boucherie du val des bois :
 *
 *   FILET CD 380 GRS S/V GAST   « 3180 »  puis « 003180 »
 *   FILET DE POULET GASTRON     « 27001 » puis « 027001 »
 *   JAMBON 3D ARD               « 5056 »  puis « 005056 »
 *   SUPREME PINTADE 180/220 S/V « 3610 »  puis « 003610 »
 *   TARTE 8/10                  « 8/10 P 17/06 » puis « 8/10 p 17/06 »
 *
 * Chaque variante d'écriture crée un SECOND article. Le premier garde son
 * historique et perd son prix ; le second repart à zéro. Le boucher voit deux
 * lignes pour un seul produit, dont une sans prix, et sa courbe de prix est
 * coupée en deux au milieu.
 *
 * ─── CE QU'ON NORMALISE, ET RIEN DE PLUS ──────────────────────────────────
 *
 * Deux gestes seulement, tous deux réversibles de tête :
 *  · la casse et les espaces (« 8/10 P » = « 8/10 p ») ;
 *  · les zéros de tête (« 003180 » = « 3180 »).
 *
 * On NE touche PAS aux lettres de préfixe. Chez AURIBAULT, « 50782 » et
 * « S50782 » sont bien le même œuf — mais « S41412 » et « 414112 » ne sont pas
 * le même produit, et aucune règle sur le S ne sait les distinguer. Fusionner
 * à tort deux articles mélange deux historiques de prix : c'est plus grave
 * qu'un doublon, qui se voit à l'écran.
 *
 * Le code d'origine est CONSERVÉ tel quel en base : cette clé ne sert qu'à
 * comparer.
 */

/** La clé de comparaison d'un code fournisseur. `null` si le code est vide. */
export function cleCodeArticle(code: string | null | undefined): string | null {
  const brut = String(code ?? '').trim()
  if (!brut) return null
  // Casse et espaces d'abord : « 8/10 P 17/06 » et « 8/10  p 17/06 » sont le
  // même code écrit deux fois à la main.
  const propre = brut.toUpperCase().replace(/\s+/g, ' ')
  // Puis les zéros de tête, et SEULEMENT devant un chiffre significatif :
  // « 003180 » devient « 3180 », mais « 00A12 » reste entier — des zéros
  // suivis d'une lettre font partie du code, ils ne le rembourrent pas. Un
  // code entièrement fait de zéros reste tel quel : jamais de clé vide, qui
  // se confondrait avec « pas de code ».
  return propre.replace(/^0+(?=[1-9])/, '')
}

/** Deux codes désignent-ils le même article ? */
export function memeCodeArticle(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = cleCodeArticle(a)
  const kb = cleCodeArticle(b)
  return ka !== null && kb !== null && ka === kb
}
