/**
 * LA RÉPARTITION DES ACHATS D'UNE SOCIÉTÉ, PAR FAMILLE DE LA BOUTIQUE.
 *
 * Module PUR, testable hors ligne.
 *
 * ─── LE DÉFAUT ────────────────────────────────────────────────────────────
 *
 * Le CA se ventile sur les familles DE LA BOUTIQUE — celles que l'extraction
 * des ventes fait apparaître, que le boucher renomme et complète à sa guise
 * (`margin_families`, `kind = 'vente'`). Les ACHATS, eux, se ventilaient sur
 * quatre rayons écrits en dur dans une page : boucherie, charcuterie,
 * traiteur, divers.
 *
 * Les deux côtés de la marge ne parlaient donc pas la même langue. Une
 * boutique qui vend des fromages, des fruits et légumes, de l'alcool ou de la
 * prestation voyait ses ventes réparties sur dix familles et ses achats
 * écrasés sur quatre — tout ce qui n'était ni boucherie, ni charcuterie, ni
 * traiteur tombait dans « divers ». La marge par famille n'existait que pour
 * les trois familles historiques ; ailleurs, elle comparait un CA précis à un
 * achat forfaitaire.
 *
 * ─── CE QU'ON CHANGE, ET CE QU'ON NE CHANGE PAS ───────────────────────────
 *
 * La répartition est désormais saisie et stockée PAR FAMILLE (colonne `parts`,
 * un objet { id de famille → pourcentage }).
 *
 * Mais les quatre colonnes historiques (`pct_boucherie`, `pct_charcuterie`,
 * `pct_traiteur`, `pct_divers`) restent ÉCRITES, recalculées depuis les parts.
 * Deux lecteurs vivent encore dessus — le moteur hebdomadaire et l'écran des
 * marges — et ils alimentent des chiffres que le boucher voit tous les jours.
 * On ne bascule pas un moteur d'argent et un écran de saisie dans le même
 * geste : d'abord on capte l'information fine sans rien casser, ensuite on
 * apprend aux lecteurs à la lire.
 *
 * Conséquence voulue : ce module, seul, ne change AUCUN chiffre affiché.
 */

import type { MarginFamily } from '@/lib/margin-families'

/** { id de famille → pourcentage } */
export type PartsParFamille = Record<string, number>

/** Les quatre colonnes historiques, telles que la table les porte. */
export type ColonnesRayon = {
  pct_boucherie: number
  pct_charcuterie: number
  pct_traiteur: number
  pct_fruits_et_legumes: number
  pct_divers: number
}

const pourcentage = (v: unknown): number => {
  const n = parseFloat(String(v))
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, Math.round(n * 100) / 100))
}

/** La famille RACINE d'une famille : une sous-famille (« Viande de bœuf »)
 *  compte dans le seau de sa racine (« Boucherie ») pour les colonnes
 *  historiques. */
function racineDe(f: MarginFamily, parIds: Map<string, MarginFamily>): MarginFamily {
  let cur = f
  // Borne dure : une hiérarchie de familles n'a que deux niveaux, mais une
  // donnée abîmée ne doit pas faire tourner une boucle sans fin.
  for (let i = 0; i < 8 && cur.parent_id; i++) {
    const p = parIds.get(cur.parent_id)
    if (!p) break
    cur = p
  }
  return cur
}

/** Le seau historique d'une famille, d'après le nom de sa RACINE. C'est un
 *  repli, pas une vérité : il ne sert qu'à garder les anciens lecteurs
 *  debout le temps qu'ils apprennent à lire `parts`. */
function seauHistorique(nameKey: string): keyof ColonnesRayon {
  const k = String(nameKey || '').toLowerCase()
  if (k.startsWith('boucherie')) return 'pct_boucherie'
  if (k.startsWith('charcuterie')) return 'pct_charcuterie'
  if (k.startsWith('traiteur')) return 'pct_traiteur'
  return 'pct_divers'
}

/**
 * Des parts propres : seules les familles QUI EXISTENT chez cette boutique,
 * chacune entre 0 et 100, les zéros retirés.
 *
 * Une part posée sur une famille supprimée depuis est écartée en silence — la
 * garder afficherait un pourcentage sans nom en face, et fausserait le total.
 */
export function partsNormalisees(
  brut: unknown,
  familles: MarginFamily[] | null | undefined,
): PartsParFamille {
  const connues = new Set((familles ?? []).map(f => String(f.id)))
  const out: PartsParFamille = {}
  if (!brut || typeof brut !== 'object') return out
  for (const [id, v] of Object.entries(brut as Record<string, unknown>)) {
    if (!connues.has(String(id))) continue
    const p = pourcentage(v)
    if (p > 0) out[String(id)] = p
  }
  return out
}

/**
 * Les parts DÉDUITES des quatre colonnes historiques, pour une société dont la
 * répartition a été saisie avant ce lot.
 *
 * Chaque seau historique est posé sur la famille racine qui porte son nom.
 * Sans famille correspondante — une boutique qui aurait renommé « Traiteur »
 * — la part est perdue plutôt que devinée : mieux vaut une case vide, que le
 * boucher voit et remplit, qu'un pourcentage posé sur la mauvaise famille.
 */
export function partsDepuisColonnes(
  c: Partial<ColonnesRayon> | null | undefined,
  familles: MarginFamily[] | null | undefined,
): PartsParFamille {
  const out: PartsParFamille = {}
  if (!c) return out
  const racines = (familles ?? []).filter(f => !f.parent_id)
  const parSeau = new Map<keyof ColonnesRayon, MarginFamily>()
  for (const f of racines) {
    const seau = seauHistorique(f.name_key)
    // La PREMIÈRE racine qui tombe dans un seau le prend : les familles
    // arrivent dans l'ordre de position, donc « Charcuterie » passe avant
    // « Charcuterie rachat ».
    if (!parSeau.has(seau)) parSeau.set(seau, f)
  }
  // « Divers » est le seau fourre-tout : la première racine venue y tombe
  // (« Fruits & légumes » dans la nomenclature par défaut), ce qui poserait
  // l'ancien divers sur une famille qui a un sens précis. Si une famille dit
  // « divers » dans son nom, c'est elle qui l'accueille.
  const versDivers = racines.find(f => String(f.name_key || '').toLowerCase().startsWith('divers'))
  if (versDivers) parSeau.set('pct_divers', versDivers)
  const poser = (seau: keyof ColonnesRayon, valeur: unknown) => {
    const p = pourcentage(valeur)
    if (p <= 0) return
    const f = parSeau.get(seau)
    if (!f) return
    out[String(f.id)] = (out[String(f.id)] ?? 0) + p
  }
  poser('pct_boucherie', c.pct_boucherie)
  poser('pct_charcuterie', c.pct_charcuterie)
  poser('pct_traiteur', c.pct_traiteur)
  // La colonne fruits & légumes n'est plus saisie depuis longtemps ; son
  // reliquat suit « divers », comme le faisait déjà la lecture.
  poser('pct_divers', pourcentage(c.pct_divers) + pourcentage(c.pct_fruits_et_legumes))
  return out
}

/**
 * Les quatre colonnes historiques RECALCULÉES depuis les parts.
 *
 * Une sous-famille compte dans le seau de sa racine. Tout ce qui n'est ni
 * boucherie, ni charcuterie, ni traiteur tombe dans « divers » — exactement ce
 * que faisait la saisie à quatre cases, mais à partir d'une information plus
 * fine, qui reste disponible pour qui saura la lire.
 */
export function colonnesDepuisParts(
  parts: PartsParFamille | null | undefined,
  familles: MarginFamily[] | null | undefined,
): ColonnesRayon {
  const out: ColonnesRayon = {
    pct_boucherie: 0, pct_charcuterie: 0, pct_traiteur: 0,
    pct_fruits_et_legumes: 0, pct_divers: 0,
  }
  const parIds = new Map((familles ?? []).map(f => [String(f.id), f]))
  for (const [id, v] of Object.entries(parts ?? {})) {
    const f = parIds.get(String(id))
    if (!f) continue
    const seau = seauHistorique(racineDe(f, parIds).name_key)
    out[seau] = Math.round((out[seau] + pourcentage(v)) * 100) / 100
  }
  return out
}

/** Le total des parts. 100 est la cible, mais rien ne l'impose : une société
 *  dont on n'a réparti que 80 % garde 20 % non attribués, et c'est une
 *  information — pas une erreur à corriger d'office. */
export function totalParts(parts: PartsParFamille | null | undefined): number {
  let t = 0
  for (const v of Object.values(parts ?? {})) t += pourcentage(v)
  return Math.round(t * 100) / 100
}

/** La famille qui pèse le plus lourd, celle qui donne sa catégorie d'achat aux
 *  factures de la société. `null` si rien n'est réparti. En cas d'égalité
 *  parfaite, l'ordre des familles tranche — jamais l'ordre d'un objet, qui ne
 *  se garantit pas. */
export function familleDominante(
  parts: PartsParFamille | null | undefined,
  familles: MarginFamily[] | null | undefined,
): MarginFamily | null {
  const parIds = new Map((familles ?? []).map(f => [String(f.id), f]))
  let gagnante: MarginFamily | null = null
  let meilleur = 0
  for (const f of familles ?? []) {
    const p = pourcentage((parts ?? {})[String(f.id)])
    if (p > meilleur) { meilleur = p; gagnante = f }
  }
  return meilleur > 0 ? gagnante : null
}
