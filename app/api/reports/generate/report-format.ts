// Formatage des nombres et du texte du PDF — fonctions pures, aucune dépendance.
// ─── Formatters ────────────────────────────────────────────────────────────
// NE PAS utiliser toLocaleString('fr-FR') — produit U+202F (espace fine insécable),
// on garde un formatage manuel avec espace simple pour un rendu stable
export const eur = (n: number) => {
  const abs = Math.abs(n)
  const [int, dec] = abs.toFixed(2).split('.')
  const intFmt = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return (n < 0 ? '-' : '') + intFmt + ',' + dec + ' €'
}
export const eur0 = (n: number) => {
  const abs = Math.abs(n)
  const intFmt = Math.round(abs).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return (n < 0 ? '-' : '') + intFmt + ' €'
}
export const signEur = (n: number) => (n >= 0 ? '+' : '') + eur(n)
export const signPct = (n: number) => (n >= 0 ? '+' : '') + (n * 100).toFixed(1) + '%'
export const pctStr = (n: number) => (n * 100).toFixed(1) + '%'
export const trunc = (s: string, len: number) => (s.length > len ? s.slice(0, len - 1) + '...' : s)

/** Coupe un texte a `max` sans trancher au milieu d'un mot.
 *  On recule jusqu'a la derniere fin de phrase, et a defaut jusqu'au dernier espace.
 *  Sans ca, la synthese de la derniere page se terminait litteralement par
 *  « ... la Cote (-2080 EUR) qui demande i » — coupee en plein mot dans un document
 *  envoye au client. */
function couperNet(t: string, max: number): string {
  if (t.length <= max) return t
  const tronque = t.slice(0, max)
  const finPhrase = Math.max(tronque.lastIndexOf('. '), tronque.lastIndexOf('! '), tronque.lastIndexOf('? '))
  if (finPhrase >= max * 0.6) return tronque.slice(0, finPhrase + 1)
  const dernierEspace = tronque.lastIndexOf(' ')
  return (dernierEspace > 0 ? tronque.slice(0, dernierEspace) : tronque).replace(/[,;:]$/, '') + '...'
}

// Nettoie les textes IA : normalise la ponctuation et borne la longueur.
// Le filtre Latin-1 ci-dessous date du contournement Helvetica ; depuis le passage à
// Plus Jakarta Sans, le € est un glyphe valide et doit survivre — sans l'exception
// explicite, « progresse de 1 240 € » s'affichait « progresse de 1 240 » dans le PDF.
export const sanitize = (s: string) => couperNet((s || '')
  .replace(/[‘’ʼ]/g, "'")
  .replace(/[“”«»]/g, '"')
  .replace(/[–—]/g, '-')
  .replace(/…/g, '...')
  .replace(/[   ]/g, ' ')
  .replace(/[▲▼→←➡➔]/g, '')
  .replace(/[^BACKSLASH1x00-BACKSLASH2xFFBACKSLASH3BACKSLASH4u20AC]/g, '')
  .trim(), 320)
