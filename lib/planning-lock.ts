/**
 * FIGER UNE SEMAINE DE PLANNING.
 *
 * Module PUR, testable hors ligne.
 *
 * ─── POURQUOI ─────────────────────────────────────────────────────────────
 *
 * Une semaine passée reste modifiable indéfiniment. Ça paraît anodin, ça ne
 * l'est pas :
 *
 *  · ses heures alimentent la MASSE SALARIALE du rapport hebdomadaire
 *    (`lib/week-economics`). Le PDF part chez le boucher avec un chiffre ;
 *    quelqu'un corrige un créneau le lendemain ; le rapport déjà envoyé dit
 *    désormais autre chose que la plateforme, et rien ne signale l'écart ;
 *  · le planning individuel est ENVOYÉ aux employés le dimanche soir. Le
 *    modifier après coup, c'est faire travailler quelqu'un sur un horaire
 *    qu'il n'a pas reçu ;
 *  · c'est la base des heures qu'on transmettra au comptable. Une base qui
 *    bouge après transmission n'est pas une base.
 *
 * Skello fait exactement ça — un cadenas par semaine et par jour, réservé à
 * un rôle. PILOTE n'a pas de rôles (un compte par boutique), donc pas de
 * permission à gérer : le gérant verrouille, le gérant déverrouille.
 *
 * ─── CE QU'ON FIGE, ET CE QU'ON NE FIGE PAS ───────────────────────────────
 *
 * Le verrou porte sur LA SEMAINE ENTIÈRE d'une boutique. Pas sur la ligne
 * d'un employé : une moitié figée et une moitié libre donneraient un total
 * hebdomadaire qui n'a jamais existé — précisément le genre de chiffre que ce
 * projet refuse de produire.
 *
 * Il porte sur l'ÉCRITURE, jamais sur la lecture ni sur le calcul. Une
 * semaine figée s'affiche, s'imprime, se compte dans les marges et part au
 * rapport exactement comme avant.
 *
 * ─── RÉVERSIBLE, ET TRACÉ ─────────────────────────────────────────────────
 *
 * On déverrouille d'un geste. Un verrou qu'on ne peut pas défaire n'est pas
 * un garde-fou, c'est un piège : le boucher qui découvre une erreur réelle
 * dans une semaine figée doit pouvoir la corriger — en sachant qu'il le fait,
 * et en laissant une trace.
 */

export type VerrouSemaine = {
  week_number: number
  year: number
  locked_at?: string | null
  locked_by?: string | null
  note?: string | null
}

/** La clé d'une semaine. Deux entiers, comme partout ailleurs dans le
 *  planning (`planning_entries` est unique sur `employee_id, week_number,
 *  year`) — surtout pas une date, qui rouvrirait la question du fuseau. */
export const cleSemaine = (week: number, year: number) => `${year}-${week}`

/** L'ensemble des semaines figées, prêt à interroger. */
export function semainesFigees(verrous: VerrouSemaine[] | null | undefined): Set<string> {
  const out = new Set<string>()
  for (const v of verrous ?? []) {
    const w = Number(v?.week_number)
    const y = Number(v?.year)
    if (!Number.isInteger(w) || !Number.isInteger(y)) continue
    if (w < 1 || w > 53) continue
    out.add(cleSemaine(w, y))
  }
  return out
}

/** Cette semaine est-elle figée ? */
export function estFigee(
  verrous: VerrouSemaine[] | Set<string> | null | undefined,
  week: number,
  year: number,
): boolean {
  const set = verrous instanceof Set ? verrous : semainesFigees(verrous)
  return set.has(cleSemaine(Number(week), Number(year)))
}

const JOUR_FR = (iso: string | null | undefined): string | null => {
  const s = String(iso ?? '')
  if (!s) return null
  const d = new Date(s)
  if (!Number.isFinite(d.getTime())) return null
  const j = String(d.getUTCDate()).padStart(2, '0')
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${j}/${m}/${d.getUTCFullYear()}`
}

/**
 * Le refus, en français, tel qu'il s'affichera au boucher.
 *
 * Il dit trois choses, dans cet ordre : ce qui est refusé, POURQUOI la
 * semaine est figée, et comment revenir en arrière. Un refus qui ne dit pas
 * comment le lever est une porte fermée à clé sans serrure.
 */
export function motifRefus(v: VerrouSemaine): string {
  const quand = JOUR_FR(v.locked_at)
  const note = String(v.note ?? '').trim()
  return `La semaine ${v.week_number} de ${v.year} est figée${quand ? ` depuis le ${quand}` : ''} :`
    + ` ses heures ont servi de base, elles ne changent plus toutes seules.`
    + (note ? ` Motif noté : « ${note} ».` : '')
    + ` Pour la corriger, déverrouillez-la d'abord — le déverrouillage est tracé.`
}

/** La phrase du bandeau, quand l'écran affiche une semaine figée. */
export function bandeauFigee(v: VerrouSemaine): string {
  const quand = JOUR_FR(v.locked_at)
  const note = String(v.note ?? '').trim()
  return `Semaine figée${quand ? ` le ${quand}` : ''} — lecture seule.`
    + (note ? ` ${note}` : '')
}

/**
 * Peut-on figer cette semaine ?
 *
 * Une semaine qui n'a pas encore commencé n'a rien à figer : son planning est
 * un projet, pas un relevé. La figer reviendrait à s'interdire de le
 * construire. `semaineCourante` est passée en argument — un module pur ne lit
 * pas l'horloge, sinon son test dépend du jour où on le lance.
 */
export function peutFiger(
  cible: { week: number; year: number },
  semaineCourante: { week: number; year: number },
): { ok: true } | { ok: false; motif: string } {
  const rangCible = cible.year * 100 + cible.week
  const rangCourant = semaineCourante.year * 100 + semaineCourante.week
  if (rangCible > rangCourant) {
    return {
      ok: false,
      motif: `La semaine ${cible.week} de ${cible.year} n'a pas encore commencé : il n'y a rien à figer.`
        + ` Un planning à venir se construit, il ne se relève pas.`,
    }
  }
  return { ok: true }
}
