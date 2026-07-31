// lib/fetch-all.ts — lecture COMPLÈTE d'une table Supabase, par pages.
//
// PostgREST plafonne chaque réponse (1000 lignes par défaut) et `.limit(n)`
// coupe en silence : la requête réussit, la liste est incomplète, et rien dans
// la réponse ne le dit. C'est le pire des trois cas — une erreur se voit, une
// troncature annoncée se gère, une troncature muette se lit comme un total.
//
// Trois plafonds de ce genre vivaient dans la mercuriale (réfs, points de prix,
// quarantaine) et un dans les fiches recettes. Aucun n'était atteint au 31/07 —
// mais la boutique lit 93 lignes de facture par semaine : le plafond de 2000
// points tombe vers la mi-décembre, AVANT que la fenêtre de 12 mois qu'il sert
// soit seulement remplie. L'historique et les min/max seraient devenus faux
// sans une ligne de message.
//
// Ici : on pagine jusqu'à épuisement, et s'il reste un plafond dur (garde-fou
// mémoire), il est ANNONCÉ. La règle du projet, appliquée aux lectures : mieux
// vaut un trou signalé qu'un total qui a l'air complet.

/** Ce qu'il faut savoir faire pour être paginé : accepter un `.range()`.
 *  Typé ici plutôt qu'importé de supabase-js — le module reste pur et testable. */
type Rangeable<T> = {
  range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
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
 * Lit toutes les lignes d'une requête, page par page.
 *
 * @param build  FABRIQUE de requête, appelée à chaque page. Indispensable : un
 *               builder PostgREST ne se rejoue pas, il faut le reconstruire.
 * @param max    plafond dur (garde-fou mémoire). L'atteindre pose `tronque`.
 *
 * L'ORDRE de la requête doit être déterministe (une colonne unique en dernier
 * critère), sinon deux pages peuvent se recouvrir ou s'omettre entre elles.
 */
export async function fetchAllPages<T>(
  build: () => Rangeable<T>,
  opts?: { max?: number; taillePage?: number },
): Promise<PageResult<T>> {
  const taille = Math.max(1, opts?.taillePage ?? TAILLE_PAGE)
  const max = Math.max(taille, opts?.max ?? 50000)
  const rows: T[] = []

  for (let from = 0; from < max; from += taille) {
    const to = Math.min(from + taille, max) - 1
    const { data, error } = await build().range(from, to)
    // supabase-js ne lève jamais : sans ce test, une panne réseau se lisait
    // comme « il n'y a plus rien », donc comme une liste complète.
    if (error) return { rows, tronque: true, erreur: error.message }
    const lot = data || []
    rows.push(...lot)
    // Page incomplète = fin des données. C'est la seule sortie « propre ».
    if (lot.length < to - from + 1) return { rows, tronque: false, erreur: null }
  }

  return { rows, tronque: true, erreur: null }
}
