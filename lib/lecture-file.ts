/**
 * QUAND CESSE-T-ON D'ESSAYER DE LIRE UN DOCUMENT ?
 *
 * Module PUR, testable hors ligne.
 *
 * ─── POURQUOI ─────────────────────────────────────────────────────────────
 *
 * Chaque lecture passe le document au modèle, parfois trois fois (texte,
 * reprise, image). Certaines factures ne seront JAMAIS lisibles : un scan de
 * travers, une photo prise au téléphone, un document qui n'a pas de lignes.
 * Elles restaient pourtant dans la file « À traiter » indéfiniment, et le
 * bouton « Lire les N factures » les relançait toutes, à chaque clic. Le même
 * document illisible pouvait ainsi être payé dix fois.
 *
 * Rien ne comptait les échecs : `lines_attempts` n'est écrit que sur les
 * lectures qui ABOUTISSENT, et il porte le nombre de passes internes d'une
 * même lecture. Il ne pouvait donc rien arrêter.
 *
 * ─── LES TROIS SORTIES ────────────────────────────────────────────────────
 *
 * 1. LE BOUCHER LE DIT. Bouton « Ne plus essayer » : c'est un abandon assumé,
 *    et il est RÉVERSIBLE d'un clic. C'est la sortie la plus propre, parce que
 *    c'est la seule où quelqu'un a regardé le document.
 * 2. TROIS ÉCHECS. Au troisième, on arrête de proposer. Trois, parce que la
 *    deuxième lecture d'un document a une vraie chance d'aboutir — la lecture
 *    n'est pas déterministe — mais que la quatrième n'en a plus.
 * 3. UNE SEMAINE. Un document en échec dont personne ne s'est occupé depuis
 *    sept jours sort de la file. Il ne disparaît pas : il est rangé ailleurs,
 *    avec son motif, et se réessaie d'un clic.
 *
 * ─── CE QU'ON NE FAIT PAS ─────────────────────────────────────────────────
 *
 * On ne SUPPRIME rien. La facture garde son montant dans les achats, dans la
 * marge et dans le résultat de sa semaine : elle a bien été payée, même si
 * personne n'a pu lire ses lignes. Supprimer le document ferait bouger des
 * chiffres déjà envoyés en rapport — un mal bien pire que le trou de lignes
 * qu'on cherche à traiter.
 *
 * Sortir de la file de LECTURE et sortir des COMPTES sont deux gestes
 * différents, et ce module ne connaît que le premier.
 */

/** Au-delà, on ne propose plus la lecture. */
export const ECHECS_MAX = 3

/** Un document en échec dont personne ne s'occupe sort de la file au bout de
 *  ce délai. */
export const JOURS_AVANT_ABANDON = 7

/** Le statut posé par un abandon assumé. Volontairement une valeur de
 *  `lines_status` et non une colonne de plus : la file se lit déjà sur cette
 *  colonne, et un second drapeau aurait fini par la contredire. */
export const STATUT_ABANDONNE = 'abandonne'

export type FactureLisible = {
  id: string
  lines_status?: string | null
  lines_error?: string | null
  lines_checked_at?: string | null
  lectures_echouees?: number | null
}

export type MotifSortie =
  | 'abandon_boucher'   // « Ne plus essayer »
  | 'trop_d_echecs'     // ECHECS_MAX atteint
  | 'trop_ancienne'     // en échec depuis plus de JOURS_AVANT_ABANDON

export type Sortie = { motif: MotifSortie; phrase: string }

const jours = (depuis: string | null | undefined, maintenant: number): number | null => {
  if (!depuis) return null
  const t = new Date(depuis).getTime()
  if (!Number.isFinite(t)) return null
  return (maintenant - t) / 86400000
}

/**
 * Ce document doit-il quitter la file de lecture, et pourquoi ?
 *
 * `null` : il y reste. `maintenant` est passé en argument — un module pur ne
 * lit pas l'horloge, sinon son test dépend du jour où on le lance.
 */
export function sortieDeFile(f: FactureLisible, maintenant: number): Sortie | null {
  const statut = String(f.lines_status ?? '')
  if (statut === STATUT_ABANDONNE) {
    return {
      motif: 'abandon_boucher',
      phrase: `Lecture abandonnée à votre demande. Le montant de la facture reste compté dans vos achats — seules ses lignes manquent à la mercuriale.`,
    }
  }

  const echecs = Number(f.lectures_echouees) || 0
  if (echecs >= ECHECS_MAX) {
    return {
      motif: 'trop_d_echecs',
      phrase: `${echecs} lectures ont échoué sur ce document : on arrête d'essayer, chaque tentative a un coût. Le montant reste compté dans vos achats. Réessayez si vous avez remplacé le PDF.`,
    }
  }

  // L'ancienneté ne vaut que pour un document DÉJÀ en échec : une facture
  // jamais lue, même vieille, mérite sa première lecture.
  const enEchec = statut === 'error' || statut === 'scan_illisible'
  const age = jours(f.lines_checked_at, maintenant)
  if (enEchec && age !== null && age >= JOURS_AVANT_ABANDON) {
    return {
      motif: 'trop_ancienne',
      phrase: `En échec depuis ${Math.floor(age)} jours sans reprise : sortie de la file. Le montant reste compté dans vos achats. Réessayez d'un clic si le document a changé.`,
    }
  }
  return null
}

/** Le nouveau compteur d'échecs après une lecture. Une lecture qui aboutit
 *  REMET À ZÉRO : le document a fini par être lisible, son passé n'a plus à
 *  peser sur ses relectures futures. */
export function compteurApres(
  echecsAvant: number | null | undefined,
  statut: string,
): number {
  const n = Number(echecsAvant) || 0
  if (statut === 'error' || statut === 'scan_illisible') return n + 1
  return 0
}

/** Le libellé court, pour la pastille de l'écran. */
export function libelleSortie(motif: MotifSortie): string {
  if (motif === 'abandon_boucher') return 'abandonnée'
  if (motif === 'trop_d_echecs') return `${ECHECS_MAX} échecs`
  return 'sans reprise depuis 7 jours'
}
