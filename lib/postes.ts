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

/** Taux de TVA par défaut — taux réduit alimentaire (boucherie, charcuterie,
 *  traiteur à emporter). Sert à ramener le CA caisse en HT avant tout calcul de
 *  marge : ici plutôt que dans lib/week-economics, pour rester importable depuis un
 *  composant client sans tirer le moteur serveur et ses clients Supabase. */
export const DEFAULT_TVA_RATE = 5.5

/** Le 4e bloc, en face des familles métier : tout ce qui n'est pas fabriqué en atelier */
export const DIVERS_POSTE: Poste = { key: 'divers', label: 'Divers' }

// Racines de rattachement du CA aux métiers. Les familles de vente des rapports
// (CRISALID) ne portent JAMAIS le nom du rayon : un boucher vend « VIANDE DE BOEUF »,
// « VIANDE DE VOLAILLE », « VIANDE DE PORC »… et jamais « BOUCHERIE ». Sans ce
// vocabulaire, la famille boucherie recevait 0 € de CA alors qu'elle porte le gros du
// chiffre. L'ORDRE COMPTE : la première racine qui reconnaît le libellé l'emporte.
export const CLASSIC_CA_STEMS: Record<string, string[]> = {
  charcuterie: ['charcut', 'salaison', 'saucis', 'jambon', 'terrine', 'rillette', 'boudin', 'andouill'],
  boucherie:   ['bouch', 'viande', 'boeuf', 'veau', 'agneau', 'mouton', 'porc', 'volaille', 'poulet', 'gibier', 'abat', 'triperie'],
  traiteur:    ['traiteur', 'rotisserie', 'snack', 'sandwich', 'plat'],
}

/** Vocabulaire de reconnaissance des libellés de vente, par rayon métier. */
export type CaStems = Record<string, string[]>

/** Lit `clients.ca_stems` (jsonb) : le vocabulaire PROPRE au client, quand sa
 *  caisse ne nomme pas ses familles comme la nôtre (« BOEUF » vs « VIANDE DE
 *  BOEUF », « SNACKING » vs « SNACK »…). Seuls les rayons connus sont retenus,
 *  les racines sont normalisées comme celles du code. `null` = rien de valide,
 *  le vocabulaire par défaut s'applique alors intégralement. */
export function parseCaStems(raw: unknown): CaStems | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out: CaStems = {}
  for (const rayon of Object.keys(CLASSIC_CA_STEMS)) {
    const v = (raw as Record<string, unknown>)[rayon]
    if (!Array.isArray(v)) continue
    const stems = [...new Set(v.map(s => normText(s).replace(/ /g, '')).filter(s => s.length >= 2))].slice(0, 40)
    if (stems.length > 0) out[rayon] = stems
  }
  return Object.keys(out).length > 0 ? out : null
}

/** Vocabulaire EFFECTIF d'un client : le sien pour les rayons qu'il a redéfinis,
 *  celui du code pour les autres. Un client sans réglage (cas de toutes les
 *  boutiques existantes) retrouve donc EXACTEMENT le comportement d'origine.
 *  L'ordre des rayons est celui de CLASSIC_CA_STEMS — il compte (première racine
 *  qui reconnaît le libellé), et la fusion par étalement le préserve. */
export function effectiveCaStems(raw: unknown): CaStems {
  const custom = parseCaStems(raw)
  return custom ? { ...CLASSIC_CA_STEMS, ...custom } : CLASSIC_CA_STEMS
}

// RACHAT / REVENTE : produit acheté fini et revendu tel quel. Ce n'est pas le métier —
// ni la matière, ni la main-d'œuvre, ni la marge. Testé AVANT tout le reste, sinon
// « CHARCUTERIE RACHAT » partirait en charcuterie et gonflerait sa marge apparente.
const DIVERS_STEMS = ['rachat', 'revente', 'revendeur', 'revend']

/** Ce libellé est-il un rachat / une revente ? (« CHARCUTERIE RACHAT », « REVENDEUR ») */
export function isDiversLabel(nom: unknown): boolean {
  const n = normText(nom)
  return !!n && DIVERS_STEMS.some(st => stemInText(st, n))
}

/** Une racine reconnaît-elle ce texte ? Test au MOT, pas en sous-chaîne : « NOUVEAUTÉS »
 *  ne doit pas être rattaché à la boucherie parce qu'il contient « veau ». */
function stemInText(stem: string, normalized: string): boolean {
  return normalized.split(' ').some(w => w.startsWith(stem))
}

/** Rayon métier d'une famille de vente (« VIANDE DE BOEUF » → boucherie).
 *  « divers » pour un rachat, `null` pour tout ce qui n'est reconnu par personne —
 *  les deux finissent dans le bloc Divers, mais seul le rachat est un choix explicite. */
export function classicRayonOfLabel(nom: unknown, stems: CaStems = CLASSIC_CA_STEMS): string | null {
  const n = normText(nom)
  if (!n) return null
  if (DIVERS_STEMS.some(st => stemInText(st, n))) return DIVERS_POSTE.key
  for (const [rayon, list] of Object.entries(stems)) {
    if (list.some(st => stemInText(st, n))) return rayon
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
export function familleMatchesText(
  familleKey: string,
  familleLabel: string,
  textKey: string,
  textLabel?: string,
  stems: CaStems = CLASSIC_CA_STEMS,
): boolean {
  const t = textLabel ?? textKey
  // BARRIÈRE PRIORITAIRE : un rachat n'appartient à aucun métier, même quand son nom
  // en porte le mot. Sans elle, « CHARCUTERIE RACHAT » ressemble trop à « Charcuterie »
  // pour être écarté par la reconnaissance floue, et gonflerait sa marge.
  if (familleKey !== DIVERS_POSTE.key && isDiversLabel(t)) return false
  if (familleKey === textKey) return true
  if (labelsMatch(familleLabel, t)) return true
  if (stems[familleKey]) return classicRayonOfLabel(t, stems) === familleKey
  return false
}

// ── Repères de marge matière par famille (boucherie artisanale, source : repères de branche) ──
// Taux de marge matière = (CA − achats) / CA. Un seul tableau pour tout PILOTE :
// page Marges, rapport PDF hebdomadaire, commentaires automatiques.
export const MATIERE_BENCH: Record<string, [number, number]> = {
  boucherie: [35, 45], charcuterie: [40, 55], traiteur: [50, 65], vente: [20, 35],
}

// ── Fiabilité d'un taux de marge ─────────────────────────────────────────────
// Un taux de marge matière ne se lit pas seul : sans achats saisis il vaut
// mécaniquement 100 %, ce qui n'est pas une performance mais une donnée
// manquante. Ce garde-fou existait UNIQUEMENT dans le rapport PDF ; il vit ici
// pour que le tableau de bord, la page Marges et le PDF disent la même chose.
// Principe du projet : on affiche le trou, on n'invente pas un chiffre plausible.

/** Au-delà de ce taux, la marge matière ne peut pas être réelle en boucherie
 *  artisanale (repère de branche 35-45 %) : il manque des factures d'achat. */
export const MARGE_MAX_PLAUSIBLE = 55

export type MargeFiabilite = {
  /** false = le taux affiché est surévalué, il ne faut pas le présenter comme un résultat */
  fiable: boolean
  raison: 'aucun_achat' | 'taux_impossible' | null
  /** Message prêt à afficher, ou null si le taux est exploitable */
  message: string | null
}

/** Le taux de marge de cette période est-il exploitable ?
 *  `caHT` et `achatsHT` sont HT (sorties de lib/week-economics). */
export function margeFiabilite(caHT: number, achatsHT: number, taux: number | null): MargeFiabilite {
  if (caHT > 0 && achatsHT <= 0) {
    return {
      fiable: false,
      raison: 'aucun_achat',
      message: "Aucune facture d'achat sur la période : la marge affichée n'a aucun sens tant que les achats manquent.",
    }
  }
  if (taux !== null && taux > MARGE_MAX_PLAUSIBLE) {
    return {
      fiable: false,
      raison: 'taux_impossible',
      message: `Marge à ${taux.toFixed(1)} % : ce niveau n'existe pas en boucherie artisanale (repère 35-45 %) et signale des factures d'achat non saisies.`,
    }
  }
  return { fiable: true, raison: null, message: null }
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
