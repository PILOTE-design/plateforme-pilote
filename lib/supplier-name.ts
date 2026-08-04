/**
 * Le nom d'une MAISON, lisible, à partir du libellé brut d'une facture.
 *
 * Vit dans lib/ et non dans un écran, parce que deux modules l'affichent
 * désormais : la mercuriale (partout où un fournisseur est nommé) et les
 * FICHES RECETTES, qui montrent sous chaque ingrédient la dernière réf
 * facturée et sa maison depuis le lot 44. Un nettoyage fait à un seul endroit
 * aurait produit « CHARCUTERIE DU VAL » d'un côté et « Facture CHARCUTERIE DU
 * VAL - 608488 » de l'autre, pour la même maison.
 *
 * Ce qu'on retire, et pourquoi :
 *  · « Facture » / « Avoir » en tête — c'est la nature de la pièce, pas le
 *    fournisseur ; le connecteur les colle systématiquement.
 *  · « (label généré) » en fin — une marque du connecteur, pas un nom.
 *  · un tiret d'ouverture — les libellés du genre « – 608488/491 » ne sont
 *    qu'un numéro de pièce que la lecture a pris pour un nom.
 *  · le numéro de pièce en fin de libellé — mais SEULEMENT précédé d'un
 *    espace et contenant un chiffre, sinon « SOCIETE JEAN-CHARLES » perdrait
 *    son Charles.
 *
 * Et surtout : ce qui ne contient AUCUNE lettre n'est pas un nom de maison.
 * On rend alors la chaîne vide, et l'écran affiche son tiret honnête — plutôt
 * que « – 608488/491 » présenté au boucher comme un fournisseur. Même règle de
 * maison que partout ailleurs : un trou visible vaut mieux qu'un faux nom.
 */
export const nomFournisseur = (s: string | null | undefined): string => {
  const t = String(s ?? '').trim()
  if (!t) return ''
  const nettoye = t
    .replace(/^(facture|avoir)\s+/i, '')
    .replace(/\s*\(label\s+g[ée]n[ée]r[ée]\)\s*$/i, '')
    // Tiret (ou demi-cadratin) d'ouverture : « – 608488/491 »
    .replace(/^[\s–—-]+/, '')
    // Numéro de pièce en fin de libellé : EXIGE un espace avant le tiret et au
    // moins un chiffre — sinon « SOCIETE JEAN-CHARLES » perdrait son Charles.
    //
    // Les PARENTHÈSES font partie du numéro chez METRO, dont les pièces
    // s'écrivent « 0/0(070)0052/0054612 ». Sans elles dans la classe, le
    // libellé restait affiché en entier au boucher — vérifié en production le
    // 04/08/2026. Le reste de la garde ne bouge pas : pas d'espace admis dans
    // le numéro, donc « BOUCHERIE DUPONT - SARL (2) » garde son SARL.
    .replace(/\s+-\s*(?=[A-Za-z0-9/()-]*\d)[A-Za-z0-9/()-]{4,}$/, '')
    .trim()
  // Volontairement sans \p{L} : le typecheck du projet cible ES2017, où les
  // classes Unicode nommées ne compilent pas.
  if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(nettoye)) return ''
  return nettoye || t
}
