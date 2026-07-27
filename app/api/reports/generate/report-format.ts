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

// Nettoie les textes IA : normalise la ponctuation et borne la longueur.
// Le filtre Latin-1 ci-dessous date du contournement Helvetica ; depuis le passage à
// Plus Jakarta Sans, le € est un glyphe valide et doit survivre — sans l'exception
// explicite, « progresse de 1 240 € » s'affichait « progresse de 1 240 » dans le PDF.
export const sanitize = (s: string) => (s || '')
  .replace(/[‘’ʼ]/g, "'")
  .replace(/[“”«»]/g, '"')
  .replace(/[–—]/g, '-')
  .replace(/…/g, '...')
  .replace(/[   ]/g, ' ')
  .replace(/[▲▼→←➡➔]/g, '')
  .replace(/[^\x00-\xFF\u20AC]/g, '')
  .trim()
  .slice(0, 320)
