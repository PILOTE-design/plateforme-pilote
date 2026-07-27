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

// Racines de rattachement du CA aux 4 rayons classiques. Les familles de vente des
// rapports (CRISALID) ne portent JAMAIS le nom du rayon : un boucher vend « VIANDE DE
// BOEUF », « VIANDE DE VOLAILLE », « VIANDE DE PORC »… et jamais « BOUCHERIE ». Sans
// ce vocabulaire, la famille boucherie recevait 0 € de CA alors qu'elle porte le gros
// du chiffre. L'ORDRE COMPTE : la première racine qui reconnaît le libellé l'emporte,
// et « CHARCUTERIE RACHAT » doit rester en charcuterie, pas basculer en boucherie.
export const CLASSIC_CA_STEMS: Record<string, string[]> = {
  charcuterie:       ['charcut', 'salaison', 'saucis', 'jambon', 'terrine', 'rillette', 'boudin', 'andouill'],
  boucherie:         ['bouch', 'viande', 'boeuf', 'veau', 'agneau', 'mouton', 'porc', 'volaille', 'poulet', 'gibier', 'abat', 'triperie'],
  traiteur:          ['traiteur', 'rotisserie', 'snack', 'sandwich', 'plat'],
  fruits_et_legumes: ['fruit', 'legume', 'primeur'],
}

/** Une racine reconnaît-elle ce texte ? Test au MOT, pas en sous-chaîne : « NOUVEAUTÉS »
 *  ne doit pas être rattaché à la boucherie parce qu'il contient « veau ». */
function stemInText(stem: string, normalized: string): boolean {
  return normalized.split(' ').some(w => w.startsWith(stem))
}

/** Rayon classique d'une famille de vente (« VIANDE DE BOEUF » → boucherie), sinon null */
export function classicRayonOfLabel(nom: unknown): string | null {
  const n = normText(nom)
  if (!n) return null
  for (const [rayon, stems] of Object.entries(CLASSIC_CA_STEMS)) {
    if (stems.some(st => stemInText(st, n))) return rayon
  }
  return null
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
  // Racines du rayon classique — mais une famille ne prend un libellé que si AUCUN
  // rayon prioritaire ne le revendique (« CHARCUTERIE RACHAT » reste en charcuterie).
  if (CLASSIC_CA_STEMS[familleKey]) return classicRayonOfLabel(t) === familleKey
  return false
}

// ── Repères de marge matière par famille (boucherie artisanale, source : repères de branche) ──
// Taux de marge matière = (CA − achats) / CA. Un seul tableau pour tout PILOTE :
// page Marges, rapport PDF hebdomadaire, commentaires automatiques.
export const MATIERE_BENCH: Record<string, [number, number]> = {
  boucherie: [35, 45], charcuterie: [40, 55], traiteur: [50, 65], fruits_et_legumes: [20, 35], vente: [20, 35],
}

/** Repère d'une famille — reconnaissance souple sur le libellé (« boucher » ≈ boucherie) */
export function benchOf(key: string, label: string): [number, number] | null {
  const n = (label || key).toLowerCase()
  if (MATIERE_BENCH[key]) return MATIERE_BENCH[key]
  if (n.includes('bouch')) return MATIERE_BENCH.boucherie
  if (n.includes('charcut')) return MATIERE_BENCH.charcuterie
  if (n.includes('traiteur')) return MATIERE_BENCH.traiteur
  return null
}
