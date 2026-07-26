// lib/postes.ts — postes de travail (planning) et familles de marge (facturation).
//
// Les 6 postes intégrés existent pour tous les clients ; chaque client peut y
// ajouter ses propres postes (clients.custom_postes, ex. « Prestation ») et
// choisir ses 3 familles de marge (clients.margin_families — des clés de poste).
//
// La RECONNAISSANCE FLOUE (`labelsMatch`) rattache entre eux des libellés
// voisins : « boucher » ≈ « boucherie », « charcutier » ≈ « charcuterie »,
// « BOUCHERIE TRAD » ≈ « boucherie ». Règle : comparaison mot à mot après
// normalisation (minuscules, accents retirés), deux mots concordent si leur
// préfixe commun couvre ≥ 4 caractères, ≥ 60 % du mot le plus long et n'est
// pas à plus de 3 caractères de la fin du mot le plus court — assez souple
// pour les familles de mots, assez strict pour séparer « vente » de
// « ventilation ». Module PUR : importable côté serveur ET côté client.

export type Poste = { key: string; label: string }

/** Postes intégrés — mêmes clés que le planning (schedule_details.categorie*) */
export const BUILTIN_POSTES: Poste[] = [
  { key: 'boucherie',     label: 'Boucherie' },
  { key: 'charcuterie',   label: 'Charcuterie' },
  { key: 'traiteur',      label: 'Traiteur' },
  { key: 'vente',         label: 'Vente' },
  { key: 'administratif', label: 'Administratif' },
  { key: 'livraison',     label: 'Livraison' },
]

export const DEFAULT_MARGIN_FAMILIES = ['boucherie', 'charcuterie', 'traiteur']

/** Racines historiques de rattachement du CA (familles de vente des rapports) */
export const CLASSIC_CA_STEMS: Record<string, string[]> = {
  boucherie:         ['bouch'],
  charcuterie:       ['charcut'],
  traiteur:          ['traiteur'],
  fruits_et_legumes: ['fruit', 'legume', 'primeur'],
}

/** minuscules + accents retirés + caractères non alphanumériques → espaces */
export function normText(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Deux MOTS concordent-ils par leur racine ? (boucher ≈ boucherie) */
function stemMatch(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  const maxLen = Math.max(a.length, b.length)
  const minLen = Math.min(a.length, b.length)
  return p >= 4 && p >= Math.ceil(maxLen * 0.6) && p >= minLen - 3
}

/** Deux LIBELLÉS concordent-ils ? (au moins un couple de mots à racine commune) */
export function labelsMatch(a: unknown, b: unknown): boolean {
  const wa = normText(a).split(' ').filter(Boolean)
  const wb = normText(b).split(' ').filter(Boolean)
  if (wa.length === 0 || wb.length === 0) return false
  return wa.some(x => wb.some(y => stemMatch(x, y)))
}

/** Libellé d'une clé de poste (intégré, personnalisé, sinon la clé elle-même) */
export function posteLabel(key: string, customs: Poste[]): string {
  return BUILTIN_POSTES.find(p => p.key === key)?.label
    ?? customs.find(p => p.key === key)?.label
    ?? key
}

/** Clé normalisée d'un poste personnalisé (« Prestation » → prestation) */
export function slugifyPoste(label: string): string {
  return normText(label).replace(/ /g, '_').slice(0, 40)
}

/** Liste custom_postes brute (jsonb) → tableau propre de postes */
export function parseCustomPostes(raw: unknown): Poste[] {
  if (!Array.isArray(raw)) return []
  const out: Poste[] = []
  for (const p of raw) {
    const label = String((p as any)?.label ?? '').trim()
    const key = String((p as any)?.key ?? '') || slugifyPoste(label)
    if (label && key && !out.some(x => x.key === key)) out.push({ key, label })
  }
  return out
}

/** margin_families brute (jsonb) → 3 clés valides, sinon défaut */
export function parseMarginFamilies(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_MARGIN_FAMILIES]
  const keys = raw.map(k => String(k)).filter(Boolean)
  const distinct = [...new Set(keys)]
  return distinct.length === 3 ? distinct : [...DEFAULT_MARGIN_FAMILIES]
}

/** Une famille (clé + libellé) reconnaît-elle ce texte (poste, famille de CA, rayon) ?
 *  Clé identique, libellés à racine commune, ou racine historique des 4 rayons classiques. */
export function familleMatchesText(familleKey: string, familleLabel: string, textKey: string, textLabel?: string): boolean {
  if (familleKey === textKey) return true
  const t = textLabel ?? textKey
  if (labelsMatch(familleLabel, t)) return true
  const stems = CLASSIC_CA_STEMS[familleKey]
  if (stems) { const n = normText(t); if (stems.some(st => n.includes(st))) return true }
  return false
}
