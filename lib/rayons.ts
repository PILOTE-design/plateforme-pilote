/**
 * LES RAYONS — une seule définition de leurs couleurs.
 *
 * Module PUR, testable hors ligne.
 *
 * ─── LE DÉFAUT ────────────────────────────────────────────────────────────
 *
 * La couleur d'un rayon était définie DEUX fois, avec deux valeurs :
 *
 *   `app/dashboard/planning/donnees.ts`     boucherie → bg-red-100 text-red-700
 *   `app/dashboard/facturation/donnees.ts`  boucherie → bg-red-50  text-red-700
 *                                                       + point #b91c1c
 *
 * Le même mot changeait donc d'apparence selon l'écran, et les Marges — l'écran
 * où le rayon compte le plus — n'en portaient aucune. Une couleur qui ne veut
 * pas dire la même chose partout ne veut rien dire.
 *
 * ─── LA RÈGLE ─────────────────────────────────────────────────────────────
 *
 * Un rayon, une teinte, partout : écrans, pastilles, graphiques, PDF. D'où les
 * deux formes exportées ensemble — les classes Tailwind pour le navigateur, le
 * `hex` pour le PDF et les graphiques, qui ne savent pas lire une classe.
 *
 * Les classes sont écrites EN TOUTES LETTRES : Tailwind ne compile que ce qu'il
 * voit dans le source, une classe fabriquée par gabarit ne sortirait pas.
 *
 * Toutes les teintes dépassent 4,5:1 sur blanc — ce sont des couleurs qui
 * portent du texte, pas seulement des pastilles.
 */

export type CleRayon =
  | 'boucherie' | 'charcuterie' | 'traiteur'
  | 'vente' | 'administratif' | 'livraison' | 'divers'

export type Rayon = {
  cle: CleRayon
  label: string
  /** Version courte, pour les cases étroites du planning. */
  abrege: string
  /** Pour le PDF et les graphiques, qui ne lisent pas une classe Tailwind. */
  hex: string
  /** Le texte, sur fond clair. */
  texte: string
  /** Le fond d'une pastille, avec son texte. */
  pastille: string
  /** Un aplat de couleur pleine — barre, point, filet. */
  aplat: string
  /** Contraste mesuré sur blanc. Documenté ici pour qu'il ne se perde pas. */
  contraste: number
}

export const RAYONS: Rayon[] = [
  { cle: 'boucherie', label: 'Boucherie', abrege: 'Bouch.', hex: '#B3123B', contraste: 6.85,
    texte: 'text-rayon-boucherie', pastille: 'bg-rayon-boucherie/10 text-rayon-boucherie', aplat: 'bg-rayon-boucherie' },
  { cle: 'charcuterie', label: 'Charcuterie', abrege: 'Charc.', hex: '#C2410C', contraste: 5.18,
    texte: 'text-rayon-charcuterie', pastille: 'bg-rayon-charcuterie/10 text-rayon-charcuterie', aplat: 'bg-rayon-charcuterie' },
  { cle: 'traiteur', label: 'Traiteur', abrege: 'Trait.', hex: '#0F766E', contraste: 5.47,
    texte: 'text-rayon-traiteur', pastille: 'bg-rayon-traiteur/10 text-rayon-traiteur', aplat: 'bg-rayon-traiteur' },
  { cle: 'vente', label: 'Vente', abrege: 'Vente', hex: '#0369A1', contraste: 5.93,
    texte: 'text-rayon-vente', pastille: 'bg-rayon-vente/10 text-rayon-vente', aplat: 'bg-rayon-vente' },
  { cle: 'administratif', label: 'Administratif', abrege: 'Admin.', hex: '#475569', contraste: 7.58,
    texte: 'text-rayon-administratif', pastille: 'bg-rayon-administratif/10 text-rayon-administratif', aplat: 'bg-rayon-administratif' },
  { cle: 'livraison', label: 'Livraison', abrege: 'Livr.', hex: '#4338CA', contraste: 7.90,
    texte: 'text-rayon-livraison', pastille: 'bg-rayon-livraison/10 text-rayon-livraison', aplat: 'bg-rayon-livraison' },
  { cle: 'divers', label: 'Divers', abrege: 'Divers', hex: '#6D28D9', contraste: 7.10,
    texte: 'text-rayon-divers', pastille: 'bg-rayon-divers/10 text-rayon-divers', aplat: 'bg-rayon-divers' },
]

const PAR_CLE = new Map<string, Rayon>(RAYONS.map(r => [r.cle, r]))

/** Le rayon « divers » — le repli, et un vrai rayon par lui-même. */
export const RAYON_DIVERS = PAR_CLE.get('divers') as Rayon

/**
 * Le rayon d'une clé, ou `null` si elle n'en désigne aucun.
 *
 * `null` plutôt qu'un repli silencieux : un poste personnalisé (« Volaille »,
 * « Rôtisserie ») n'est pas du divers, il n'a simplement pas encore de couleur
 * de métier. L'appelant décide — la fonction ne décide pas à sa place.
 */
export function rayon(cle: unknown): Rayon | null {
  const k = String(cle ?? '').trim().toLowerCase()
  if (!k) return null
  // `frais_divers` est le nom qu'emploie la facturation pour le même rayon.
  if (k === 'frais_divers') return RAYON_DIVERS
  return PAR_CLE.get(k) ?? null
}

/** Les classes d'une pastille de rayon, repli neutre compris. */
export function pastilleRayon(cle: unknown): string {
  return rayon(cle)?.pastille ?? 'bg-gray-100 text-encre-doux'
}

/**
 * La teinte d'un rayon pour un PDF ou un graphique.
 *
 * Le repli est un GRIS NEUTRE, et surtout pas la teinte d'un rayon existant :
 * la première version repliait sur `#475569`, qui est celle d'« Administratif ».
 * Un poste personnalisé se serait donc affiché, dans le PDF, exactement de la
 * couleur d'un autre rayon — deux choses différentes, une seule couleur.
 */
export function hexRayon(cle: unknown): string {
  return rayon(cle)?.hex ?? '#6b7280'
}

/**
 * Les couleurs des postes PERSONNALISÉS, attribuées par index.
 *
 * Un client qui crée « Rôtisserie » n'a aucune teinte de métier : plutôt que de
 * tout peindre en gris — ce qui reviendrait à dire que ses postes comptent
 * moins —, on pioche dans une roue stable. Stable est le mot : l'index vient de
 * l'ordre de création, donc la couleur d'un poste ne change jamais.
 */
export const TEINTES_PERSONNALISEES = [
  // Toutes vérifiées au-dessus de 4,5:1. Le teal de Tailwind (#0D9488) tombait
  // à 3,74:1 : un libellé de poste illisible, précisément pour les clients qui
  // ont pris la peine de créer leurs propres postes.
  { hex: '#0F766E', pastille: 'bg-teal-50 text-teal-800' },
  { hex: '#BE185D', pastille: 'bg-pink-50 text-pink-800' },
  { hex: '#6D28D9', pastille: 'bg-violet-50 text-violet-800' },
  { hex: '#0E7490', pastille: 'bg-cyan-50 text-cyan-800' },
  { hex: '#4D7C0F', pastille: 'bg-lime-50 text-lime-800' },
  { hex: '#A21CAF', pastille: 'bg-fuchsia-50 text-fuchsia-800' },
]

export function teintePersonnalisee(index: number) {
  const i = Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0
  return TEINTES_PERSONNALISEES[i % TEINTES_PERSONNALISEES.length]
}
