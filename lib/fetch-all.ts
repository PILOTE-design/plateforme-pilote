// lib/fetch-all.ts — lecture COMPLÈTE d'une table Supabase, page par page.
//
// PostgREST plafonne chaque réponse et `.limit(n)` coupe en silence : la requête
// réussit, la liste est incomplète, et rien dans la réponse ne le dit. C'est le
// pire des trois cas — une erreur se voit, une troncature annoncée se gère, une
// troncature muette se lit comme un total.
//
// Trois plafonds de ce genre vivaient dans la mercuriale (réfs, points de prix,
// quarantaine) et un dans les fiches recettes. Aucun n'était atteint au 31/07 —
// mais la boutique lit 93 lignes de facture par semaine : le plafond de 2000
// points tombait vers la mi-décembre, AVANT que la fenêtre de 12 mois qu'il sert
// soit seulement remplie.
//
// PAGINATION PAR CURSEUR (et non par `offset`), corrigée au lot 10 après revue.
// Deux défauts de la première version, tous deux silencieux :
//
//   1. elle concluait « fin des données » dès qu'une page revenait plus courte
//      que demandée. Or PostgREST rabote `limit` sur le réglage « Max rows » du
//      projet : si ce plafond passait un jour sous la taille de page, la lecture
//      s'arrêtait au premier lot en se déclarant COMPLÈTE — exactement la
//      troncature muette que ce module existe pour empêcher ;
//   2. `offset` sur un tri par `updated_at` n'est pas stable : qu'une facture
//      soit lue pendant la pagination (un co-admin, le bouton « Lire la file »)
//      et la réf touchée remonte en tête, décalant tout d'un rang — la ligne
//      frontière n'est alors jamais renvoyée.
//
// Le curseur sur la clé primaire règle les deux : chaque page reprend APRÈS le
// dernier identifiant lu, un identifiant ne change jamais, et la seule sortie
// propre est une page VIDE.

/** Ce qu'il faut savoir faire pour être paginé : accepter un `.limit()`.
 *  Typé ici plutôt qu'importé de supabase-js — le module reste pur et testable. */
type Interrogeable<T> = {
  limit: (n: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
}

export type PageResult<T> = {
  rows: T[]
  /** true = la lecture s'est arrêtée avant la fin (plafond atteint ou erreur) */
  tronque: boolean
  /** message d'erreur Supabase si la pagination s'est interrompue */
  erreur: string | null
}

/** Taille d'une page. 1000 = le maximum que PostgREST renvoie d'un coup. */
export const TAILLE_PAGE = 1000

/**
 * Lit toutes les lignes d'une requête, page par page, par CURSEUR sur `id`.
 *
 * @param build  FABRIQUE de requête, appelée à chaque page avec l'identifiant de
 *               la dernière ligne lue (null à la première). Elle DOIT appliquer
 *               `.gt('id', apresId)` quand il n'est pas null, et trier par `id`
 *               ascendant — sans quoi le curseur ne délimite rien. Une fabrique
 *               est indispensable : un builder PostgREST ne se rejoue pas.
 * @param max    plafond dur (garde-fou mémoire). L'atteindre pose `tronque`.
 *
 * Les lignes doivent porter leur `id` (pensez à le demander dans le `select`).
 */
export async function fetchAllPages<T extends { id?: unknown }>(
  build: (apresId: string | null) => Interrogeable<T>,
  opts?: { max?: number; taillePage?: number },
): Promise<PageResult<T>> {
  const taille = Math.max(1, opts?.taillePage ?? TAILLE_PAGE)
  const max = Math.max(taille, opts?.max ?? 50000)
  const rows: T[] = []
  let curseur: string | null = null

  while (rows.length < max) {
    // Type ANNOTÉ explicitement : sans lui, TypeScript boucle (le curseur de la
    // page suivante se déduit des lignes de celle-ci, qui se déduisent du
    // curseur) et retombe silencieusement sur `any` — TS7022.
    const page: { data: T[] | null; error: { message: string } | null } = await build(curseur).limit(taille)
    const { data, error } = page
    // supabase-js ne lève JAMAIS : sans ce test, une panne réseau se lirait
    // comme « il n'y a plus rien », donc comme une liste complète.
    if (error) return { rows, tronque: true, erreur: error.message }

    const lot = data || []
    // Page VIDE : la seule sortie propre. Une page courte ne prouve rien — le
    // serveur a pu rendre moins que demandé (réglage « Max rows » du projet).
    if (lot.length === 0) return { rows, tronque: false, erreur: null }

    rows.push(...lot)

    const dernier = lot[lot.length - 1]
    const id = dernier == null ? null : (dernier as { id?: unknown }).id
    // Sans identifiant exploitable, impossible d'avancer : mieux vaut rendre ce
    // qu'on a EN LE DISANT que boucler sur la même page jusqu'au plafond.
    if (id === null || id === undefined || id === '') {
      return { rows, tronque: true, erreur: 'pagination impossible : les lignes lues n’ont pas d’identifiant' }
    }
    curseur = String(id)
  }

  return { rows, tronque: true, erreur: null }
}
