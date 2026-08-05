/**
 * LES TYPES DE CONTRAT — une seule liste.
 *
 * Module PUR, testable hors ligne.
 *
 * Avant ce fichier, la même liste existait en trois exemplaires qui ne
 * disaient pas la même chose :
 *
 *  · `app/dashboard/planning/page.tsx` — 4 valeurs (les CDI/CDD 35 et 39) ;
 *  · `components/EmployeeProfileModal.tsx` — 6 valeurs, avec APPRENTI et
 *    INTERIM que le planning ignorait ;
 *  · `app/admin/clients/[id]/page.tsx` — une table de 4 clés vers des heures.
 *
 * Conséquence concrète : on pouvait enregistrer un salarié en « Apprenti »
 * depuis sa fiche, puis le retrouver sans libellé dans le planning et sans
 * heures contractuelles côté admin. Le type existait à un endroit et pas à
 * l'autre.
 *
 * ─── LES HEURES SONT UNE VALEUR PAR DÉFAUT, PAS UNE RÈGLE ─────────────────
 *
 * `heures` amorce `employees.contract_hours` quand on choisit un type ; c'est
 * ensuite ce champ, et lui seul, que lit le moteur de paie. Un apprenti à
 * 30 h ou un intérimaire à 39 h restent donc possibles : on propose, on
 * n'impose pas.
 *
 * L'ancienne déduction — « le libellé contient 39 ? alors 39 h » — donnait
 * silencieusement 35 h à APPRENTI et INTERIM, parce que leur nom ne contient
 * aucun chiffre. Deviner l'horaire d'un contrat à partir de l'orthographe de
 * son intitulé n'est pas une règle, c'est une coïncidence.
 */

export type TypeContrat = {
  key: string
  /** Ce qu'on écrit en toutes lettres — sur la fiche, dans le rapport comptable. */
  label: string
  /** La version courte, pour les cases étroites du planning. */
  short: string
  /** Heures hebdomadaires proposées à la sélection. */
  heures: number
}

export const TYPES_CONTRAT: TypeContrat[] = [
  { key: 'CDI_35',   label: 'CDI · 35h',  short: 'CDI 35h',  heures: 35 },
  { key: 'CDI_39',   label: 'CDI · 39h',  short: 'CDI 39h',  heures: 39 },
  { key: 'CDD_35',   label: 'CDD · 35h',  short: 'CDD 35h',  heures: 35 },
  { key: 'CDD_39',   label: 'CDD · 39h',  short: 'CDD 39h',  heures: 39 },
  { key: 'APPRENTI', label: 'Apprenti',   short: 'Apprenti', heures: 35 },
  { key: 'INTERIM',  label: 'Intérim',    short: 'Intérim',  heures: 35 },
]

const PAR_CLE = new Map(TYPES_CONTRAT.map(t => [t.key, t]))

/** Le type de contrat, ou `null` si la valeur enregistrée n'est plus proposée. */
export function typeContrat(key: unknown): TypeContrat | null {
  return PAR_CLE.get(String(key ?? '').trim()) ?? null
}

/**
 * Le libellé lisible d'un contrat.
 *
 * Une clé inconnue est rendue TELLE QUELLE, jamais remplacée par un type
 * plausible : si la base contient `CDI_TEMPS_PARTIEL`, il faut le voir, pas
 * lire « CDI · 35h » à la place. Une valeur vide donne un tiret.
 */
export function libelleContrat(key: unknown): string {
  const brut = String(key ?? '').trim()
  if (!brut) return '—'
  return PAR_CLE.get(brut)?.label ?? brut
}

/** Idem, en version courte. */
export function libelleContratCourt(key: unknown): string {
  const brut = String(key ?? '').trim()
  if (!brut) return '—'
  return PAR_CLE.get(brut)?.short ?? brut
}

/**
 * Les heures hebdomadaires à proposer pour ce type.
 *
 * `null` pour une clé inconnue — l'appelant garde alors les heures déjà
 * enregistrées plutôt que d'en inventer.
 */
export function heuresContrat(key: unknown): number | null {
  return PAR_CLE.get(String(key ?? '').trim())?.heures ?? null
}

/** Ce contrat porte-t-il une date de fin ? (CDD, intérim) */
export function contratADuree(key: unknown): boolean {
  const brut = String(key ?? '').trim()
  return brut.startsWith('CDD') || brut === 'INTERIM'
}
