// lib/morceaux-orphelins.ts — UN MORCEAU DE DÉCOUPE QUI A SURVÉCU À SA CARCASSE.
// Lot 121. Module PUR, testable hors ligne.
//
// ─── CE QU'ON A VU EN PRODUCTION LE 07/08/2026 ────────────────────────────
//
// Le compte « Bac a sable Theo (dev) » porte **33 morceaux de découpe actifs**
// — Paleron, Faux-filet, Jarret avec os… — et **zéro valorisation**. La
// carcasse de contrôle qui les avait créés le 04/08 a été supprimée depuis ;
// les morceaux, eux, sont restés.
//
// Ils sont comptés dans « 232 produits suivis », ils sortent dans toutes les
// recherches du catalogue, ils n'ont aucun prix et n'en auront jamais. Aucun
// n'est utilisé par une fiche, aucun ne porte de réf fournisseur : rien ne les
// retient, et rien ne les enlève.
//
// Ce n'est pas propre à cette boutique : ça arrivera à chaque fois qu'un
// boucher supprimera une découpe. C'est donc un défaut du PRODUIT, pas une
// donnée à nettoyer à la main — la règle de la maison depuis le lot 75.
//
// ─── LA DISTINCTION QUI FAIT TOUT ─────────────────────────────────────────
//
// `decoupe_sans_carcasse` (lot 71) recouvre DEUX situations que le boucher ne
// vit pas du tout de la même façon :
//
//  1. **Il n'a jamais valorisé cette espèce.** Le morceau attend sa première
//     carcasse. Le message actuel est juste : « son prix arrivera dès que vous
//     aurez enregistré une carcasse de cette espèce ». Il n'y a RIEN à nettoyer,
//     et proposer de le retirer serait absurde — c'est un catalogue qui se
//     remplit, pas un résidu.
//
//  2. **La carcasse qui l'a créé a disparu.** Le morceau ne peut plus rien
//     attendre de personne. C'est un ORPHELIN, et c'est le seul cas où l'on
//     propose de le retirer.
//
// Ce module ne sait faire qu'une chose : séparer les deux. Il lui suffit pour
// ça de la liste des espèces qui ont AU MOINS UNE carcasse enregistrée —
// peu importe qu'elle soit assez pesée pour publier un prix (une carcasse trop
// peu pesée reste une carcasse : le morceau attend une saisie, pas une
// suppression).
//
// ─── CE QU'ON NE FAIT PAS ─────────────────────────────────────────────────
//
// On ne supprime rien tout seul. On ne désactive rien tout seul. Le catalogue
// appartient au boucher, et un morceau retiré d'office le jour où il efface une
// carcasse pour la ressaisir serait une perte de données silencieuse. On COMPTE,
// on ANNONCE, et le geste reste à lui — exactement comme pour le double emploi
// des charges au lot 75.
//
// Et jamais un morceau qui SERT : utilisé dans une fiche recette ou porteur
// d'une réf fournisseur, il reste, même orphelin. C'est vérifié côté serveur
// avant toute écriture, pas seulement ici.

/** Les espèces de la nomenclature. Le préfixe d'un `valorisation_cut_id` les
 *  désigne, sauf pour le bœuf dont les pièces n'en portent pas (`filet_b`,
 *  `b2_paleron`, `capa_hampe`, `gite_noix`…). */
export const ESPECES = ['boeuf', 'veau', 'agneau', 'porc', 'volaille'] as const
export type Espece = (typeof ESPECES)[number]

/**
 * L'espèce d'une pièce, lue de son identifiant.
 *
 * `veau_noix` → veau · `agneau_gigot_entier` → agneau · `porc_poitrine` → porc.
 * Tout le reste est du BŒUF : c'est l'espèce historique de la nomenclature, la
 * seule dont les identifiants n'ont pas été préfixés (`filet_b`, `b2_paleron`,
 * `capa_plat_de_cote`, `tranche_grasse_ronde`…). Ce repli est délibéré et sûr
 * dans un sens seulement : un identifiant inconnu sera rangé en bœuf, donc
 * signalé orphelin uniquement si la boutique n'a AUCUNE carcasse de bœuf. Le
 * risque est de taire un orphelin, jamais d'en inventer un — c'est le bon sens
 * pour une fonction qui propose une suppression.
 */
export function especeDuCut(cutId: string | null | undefined): Espece {
  const id = String(cutId ?? '').trim().toLowerCase()
  if (id.startsWith('veau')) return 'veau'
  if (id.startsWith('agneau')) return 'agneau'
  if (id.startsWith('porc')) return 'porc'
  if (id.startsWith('volaille')) return 'volaille'
  return 'boeuf'
}

/** Un morceau de découpe du catalogue, réduit à ce qui décide. */
export type MorceauCatalogue = {
  id: string
  name: string
  /** L'identifiant de pièce — c'est lui qui fait d'un générique un morceau de
   *  découpe. `null` : ce n'est pas un morceau, il ne nous concerne pas. */
  valorisation_cut_id: string | null
  /** Le morceau a-t-il un prix aujourd'hui ? Un morceau chiffré n'est jamais
   *  orphelin, quoi qu'il arrive. */
  price_ht: number | null
  /** Nombre de fiches recettes qui l'utilisent */
  recipes_count: number
  /** Nombre de réfs fournisseur rattachées */
  refs_count: number
}

export type Orphelin = {
  id: string
  name: string
  espece: Espece
  /** `true` quand le morceau sert quelque part : on le signale, mais on ne
   *  propose PAS de le retirer. */
  retenu: boolean
  /** Pourquoi il est retenu — écrit, jamais deviné par l'écran */
  motifRetenu: string | null
}

/**
 * Les morceaux de découpe que plus aucune carcasse ne peut chiffrer.
 *
 * `especesAvecCarcasse` : les espèces dont la boutique a au moins une carcasse
 * enregistrée, quelle que soit sa qualité de saisie.
 */
export function morceauxOrphelins(
  morceaux: MorceauCatalogue[],
  especesAvecCarcasse: Iterable<string>,
): Orphelin[] {
  const vues = new Set<string>()
  for (const e of especesAvecCarcasse) vues.add(String(e ?? '').trim().toLowerCase())

  const out: Orphelin[] = []
  for (const m of morceaux) {
    if (!m.valorisation_cut_id) continue
    // Un morceau qui a un prix n'est orphelin d'aucune façon.
    if (typeof m.price_ht === 'number' && Number.isFinite(m.price_ht) && m.price_ht > 0) continue
    const espece = especeDuCut(m.valorisation_cut_id)
    // L'espèce a une carcasse : le morceau ATTEND, il n'est pas orphelin.
    if (vues.has(espece)) continue

    const sert: string[] = []
    if (m.recipes_count > 0) sert.push(`${m.recipes_count} fiche${m.recipes_count > 1 ? 's' : ''} recette${m.recipes_count > 1 ? 's' : ''}`)
    if (m.refs_count > 0) sert.push(`${m.refs_count} réf${m.refs_count > 1 ? 's' : ''} fournisseur`)

    out.push({
      id: m.id,
      name: m.name,
      espece,
      retenu: sert.length > 0,
      motifRetenu: sert.length > 0 ? `Utilisé par ${sert.join(' et ')} — il reste au catalogue.` : null,
    })
  }
  // Par espèce puis par nom : le boucher lit « tous mes bœufs », pas une liste
  // alphabétique qui mélange les bêtes.
  return out.sort((a, b) => a.espece.localeCompare(b.espece) || a.name.localeCompare(b.name, 'fr'))
}

/** Ceux qu'on peut réellement retirer — les autres servent. */
export const orphelinsRetirables = (o: Orphelin[]) => o.filter(x => !x.retenu)

/** Le libellé français d'une espèce, pour la phrase. */
const ESPECE_FR: Record<Espece, string> = {
  boeuf: 'bœuf', veau: 'veau', agneau: 'agneau', porc: 'porc', volaille: 'volaille',
}

/**
 * Ce qu'on écrit au boucher.
 *
 * Elle dit COMBIEN, de QUELLE bête, POURQUOI c'est arrivé et ce que ça coûte de
 * les laisser. Sans le « pourquoi », un bouton « retirer » sur des produits
 * qu'on n'a pas créés soi-même ne s'actionne pas — on ne supprime pas ce qu'on
 * ne comprend pas.
 */
export function phraseOrphelins(orphelins: Orphelin[]): string {
  const n = orphelins.length
  if (n === 0) return ''
  const retirables = orphelinsRetirables(orphelins).length
  const retenus = n - retirables

  const parEspece = new Map<Espece, number>()
  for (const o of orphelins) parEspece.set(o.espece, (parEspece.get(o.espece) ?? 0) + 1)
  const betes = [...parEspece.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([e, c]) => `${c.toLocaleString('fr-FR')} de ${ESPECE_FR[e]}`)
    .join(', ')

  const debut = `${n.toLocaleString('fr-FR')} morceau${n > 1 ? 'x' : ''} de découpe (${betes}) `
    + `n’${n > 1 ? 'ont' : 'a'} plus aucune carcasse pour ${n > 1 ? 'les' : 'le'} chiffrer`
  const cause = ' — la valorisation qui les avait créés a été supprimée.'
  const cout = ` ${n > 1 ? 'Ils comptent' : 'Il compte'} dans votre catalogue et `
    + `${n > 1 ? 'ressortent' : 'ressort'} dans les recherches, sans prix et sans en attendre.`
  const reserve = retenus > 0
    ? ` ${retenus.toLocaleString('fr-FR')} ${retenus > 1 ? 'sont retenus' : 'est retenu'} : `
      + `${retenus > 1 ? 'ils servent' : 'il sert'} dans une fiche ou ${retenus > 1 ? 'portent' : 'porte'} une réf fournisseur.`
    : ''

  return `${debut}${cause}${cout}${reserve}`
}

/** Le compteur du badge « À traiter » : seulement ce sur quoi un geste est
 *  possible. Un morceau retenu n'attend aucun geste, il ne doit pas gonfler un
 *  chiffre qui sert à décider si la mercuriale a besoin du boucher aujourd'hui. */
export const compteOrphelins = (o: Orphelin[]) => orphelinsRetirables(o).length
