/**
 * LE RAPPORT COMPTABLE — les heures d'un mois, telles qu'on les transmet.
 *
 * Module PUR, testable hors ligne.
 *
 * ─── CE QUE CE RAPPORT EST, ET CE QU'IL N'EST PAS ─────────────────────────
 *
 * Il donne des HEURES. Rien d'autre.
 *
 * Pas de brut, pas de net, pas de bulletin. PILOTE ne connaît ni les primes,
 * ni la mutuelle, ni l'ancienneté conventionnelle, ni les absences que
 * personne n'a pointées. Publier un « salaire brut » à partir de ce qu'il sait
 * serait un chiffre faux présenté comme une paie — exactement ce que ce projet
 * refuse de faire. Le comptable a le contrat et le logiciel de paie ; ce qui
 * lui manque, ce sont les heures. C'est ce qu'on lui donne.
 *
 * ─── LE MOIS ET LA SEMAINE NE SE SUPERPOSENT PAS ──────────────────────────
 *
 * La paie se fait au mois civil. Le planning se tient à la semaine ISO. Une
 * semaine sur quatre chevauche deux mois, et c'est là que les rapports se
 * mettent à mentir.
 *
 * Deux grandeurs, deux règles — et les deux sont dites à l'écran :
 *
 *  1. LES HEURES sont ventilées JOUR PAR JOUR. Chaque colonne du planning
 *     (`lundi`… `dimanche`) correspond à une date précise : on sait donc à
 *     quel mois chaque heure appartient. Aucune approximation, aucun prorata.
 *
 *  2. LES HEURES SUPPLÉMENTAIRES ne se ventilent pas. Le seuil est
 *     hebdomadaire : « au-delà de 35 h dans la semaine ». Découper une semaine
 *     en deux morceaux de mois donnerait deux moitiés dont aucune ne dépasse
 *     le seuil — on ferait disparaître des heures majorées. Elles sont donc
 *     calculées sur la SEMAINE ENTIÈRE, puis rattachées au mois qui contient
 *     la MAJORITÉ de ses jours. Sept jours : la majorité existe toujours, il
 *     n'y a jamais d'égalité à départager.
 *
 * Les semaines à cheval sont listées telles quelles, avec le mois auquel elles
 * sont rattachées. Le comptable voit la règle s'appliquer, il ne la subit pas.
 *
 * ─── LES HEURES MANQUANTES ────────────────────────────────────────────────
 *
 * Jusqu'ici la plateforme ne regardait que dans un sens : au-dessus du contrat,
 * elle comptait des heures supplémentaires ; en dessous, elle ne disait rien.
 *
 * En dessous, il se passe pourtant quelque chose. Un salarié à 35 h planifié
 * 30 h est payé 35 h — c'est son contrat. Soit il manque une absence au
 * pointage, soit l'employeur doit cinq heures. Dans les deux cas quelqu'un doit
 * trancher, et ce quelqu'un n'est pas nous : on affiche l'écart, signé, et on
 * dit qu'il reste à arbitrer.
 *
 * ─── UNE BASE QUI BOUGE N'EST PAS UNE BASE ────────────────────────────────
 *
 * Le rapport dit quelles semaines de la période sont FIGÉES (lot 83). Une
 * semaine libre peut être corrigée après l'envoi : le comptable travaillerait
 * alors sur des heures que la plateforme n'a plus. On le signale avant l'envoi,
 * pas après.
 */

import { entryHours, getWeekDates, weekHolidayFlags, JOURS, type PayrollEmployee, type PayrollEntry } from '@/lib/payroll'
import { estFigee, type VerrouSemaine } from '@/lib/planning-lock'
import { libelleContrat } from '@/lib/contrat'

const MOIS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

/** « Août 2026 ». `mois` est un mois civil, de 1 à 12. */
export function libelleMois(mois: number, annee: number): string {
  const i = Math.round(Number(mois)) - 1
  return `${MOIS_FR[i] ?? '?'} ${annee}`
}

const nb = (v: unknown): number => {
  const n = parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

/** Arrondi au centième — les heures se saisissent au quart d'heure, pas au millionième. */
const r2 = (n: number): number => Math.round(n * 100) / 100

const iso = (d: Date): string => d.toISOString().slice(0, 10)

// ─── Les semaines d'un mois ───────────────────────────────────────────────

export type SemaineDuMois = {
  week: number
  year: number
  /** Dates ISO des 7 jours, du lundi au dimanche. */
  dates: string[]
  /** Combien de ses 7 jours tombent dans le mois demandé. */
  joursDansLeMois: number
  /** Elle chevauche deux mois. */
  aCheval: boolean
  /** Ses heures supplémentaires comptent dans le mois demandé (majorité de ses jours). */
  rattachee: boolean
}

/**
 * Toutes les semaines ISO qui touchent le mois, ne serait-ce que d'un jour.
 *
 * On balaie de la semaine du 1er à celle du dernier jour. Le numéro de semaine
 * est relu sur le jeudi de chaque semaine — c'est la définition ISO, et c'est
 * elle qui donne le bon numéro ET la bonne année aux semaines de bascule
 * (le 31 décembre peut appartenir à la semaine 1 de l'année suivante).
 */
export function semainesDuMois(mois: number, annee: number): SemaineDuMois[] {
  const m = Math.round(Number(mois))
  const y = Math.round(Number(annee))
  if (!Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(y)) return []

  const premier = new Date(Date.UTC(y, m - 1, 1))
  const dernier = new Date(Date.UTC(y, m, 0))

  // Le lundi de la semaine du 1er du mois.
  const lundi = new Date(premier)
  lundi.setUTCDate(premier.getUTCDate() - ((premier.getUTCDay() || 7) - 1))

  const out: SemaineDuMois[] = []
  for (let curseur = new Date(lundi); curseur <= dernier; curseur.setUTCDate(curseur.getUTCDate() + 7)) {
    const debut = new Date(curseur)
    const dates: string[] = []
    let joursDansLeMois = 0
    for (let i = 0; i < 7; i++) {
      const d = new Date(debut)
      d.setUTCDate(debut.getUTCDate() + i)
      dates.push(iso(d))
      if (d.getUTCFullYear() === y && d.getUTCMonth() === m - 1) joursDansLeMois++
    }
    // Le jeudi porte le numéro ISO de la semaine.
    const jeudi = new Date(debut)
    jeudi.setUTCDate(debut.getUTCDate() + 3)
    const { week, year } = numeroIso(jeudi)
    out.push({
      week, year, dates, joursDansLeMois,
      aCheval: joursDansLeMois < 7,
      rattachee: joursDansLeMois >= 4,
    })
  }
  return out
}

/** Numéro et année ISO d'une date. */
function numeroIso(d: Date): { week: number; year: number } {
  const jeudi = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  jeudi.setUTCDate(jeudi.getUTCDate() + 3 - ((jeudi.getUTCDay() + 6) % 7))
  const year = jeudi.getUTCFullYear()
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const week = 1 + Math.round(((jeudi.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7)
  return { week, year }
}

// ─── Le rapport ───────────────────────────────────────────────────────────

export type LigneSemaine = {
  week: number
  year: number
  aCheval: boolean
  /** Ses heures supplémentaires comptent dans ce mois-ci. */
  rattachee: boolean
  figee: boolean
  /** Semaine ENTIÈRE — l'unité de calcul des heures supplémentaires. */
  heures_travaillees: number
  heures_cp: number
  heures_payees: number
  contractuel: number
  /** Signé : positif = heures supplémentaires, négatif = heures manquantes. */
  ecart: number
  hs25: number
  hs50: number
}

export type LigneEmploye = {
  employee_id: string
  nom: string
  contrat: string
  contractuel_hebdo: number

  // ── Ventilation jour par jour dans le mois civil — exacte ──
  heures_travaillees: number
  jours_travailles: number
  jours_cp: number
  heures_cp: number
  jours_maladie: number
  jours_dimanche: number
  heures_dimanche: number
  jours_ferie: number
  heures_ferie: number
  /** Heures payées du mois : travaillées + congés payés valorisés. */
  heures_payees: number

  // ── Volet hebdomadaire — l'unité légale ──
  semaines: LigneSemaine[]
  hs25: number
  hs50: number
  /** Total des manques hebdomadaires, en positif. 0 quand il n'y en a pas. */
  heures_manquantes: number

  /** Semaines rattachées à ce mois qui ne sont pas encore figées. */
  semaines_non_figees: number
  /** Aucune ligne de planning sur tout le mois. */
  sans_planning: boolean
}

export type RapportComptable = {
  mois: number
  annee: number
  libelle: string
  /** Premier et dernier jour du mois, en ISO. */
  debut: string
  fin: string
  employes: LigneEmploye[]
  /** Les semaines touchées par le mois, AVEC leur état de verrou : le bandeau
   *  de réserves et le bouton « figer la période » doivent compter la même
   *  chose. Filtrer côté écran sur « une semaine où quelqu'un a du planning »
   *  donnait un bouton qui proposait d'en figer une pendant que le bandeau en
   *  annonçait cinq. */
  semaines: (SemaineDuMois & { figee: boolean })[]
  /** Ce que le rapport ne peut pas garantir. Jamais tu, jamais résumé. */
  avertissements: string[]
}

const heure = (n: number): string =>
  (Math.round(n * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' h'

/**
 * Le rapport d'un mois.
 *
 * `entriesParSemaine` : les lignes de planning, groupées par clé `année-semaine`
 * (la même clé que `cleSemaine` du verrou). On les reçoit déjà chargées : ce
 * module ne parle à aucune base.
 */
export function rapportDuMois(
  mois: number,
  annee: number,
  employes: PayrollEmployee[] | null | undefined,
  entriesParSemaine: Map<string, PayrollEntry[]> | null | undefined,
  verrous: VerrouSemaine[] | null | undefined,
): RapportComptable {
  const m = Math.round(Number(mois))
  const y = Math.round(Number(annee))
  const semaines = semainesDuMois(m, y)
  const debut = iso(new Date(Date.UTC(y, m - 1, 1)))
  const fin = iso(new Date(Date.UTC(y, m, 0)))

  // Les drapeaux « férié » et les dates, une fois par semaine, pas une fois par employé.
  const contexte = semaines.map(s => ({
    s,
    feries: weekHolidayFlags(s.week, s.year),
    dansLeMois: getWeekDates(s.week, s.year).map(
      d => d.getUTCFullYear() === y && d.getUTCMonth() === m - 1,
    ),
    figee: estFigee(verrous, s.week, s.year),
  }))

  const lignes: LigneEmploye[] = []

  for (const emp of employes ?? []) {
    const ch = nb(emp.contract_hours) || 35
    const gerant = emp.is_gerant === true

    const l: LigneEmploye = {
      employee_id: String(emp.id),
      nom: String(emp.name ?? '').trim() || 'Sans nom',
      contrat: libelleContrat((emp as { contract_type?: string }).contract_type),
      contractuel_hebdo: ch,
      heures_travaillees: 0, jours_travailles: 0,
      jours_cp: 0, heures_cp: 0, jours_maladie: 0,
      jours_dimanche: 0, heures_dimanche: 0,
      jours_ferie: 0, heures_ferie: 0,
      heures_payees: 0,
      semaines: [], hs25: 0, hs50: 0, heures_manquantes: 0,
      semaines_non_figees: 0, sans_planning: true,
    }

    for (const { s, feries, dansLeMois, figee } of contexte) {
      const entries = entriesParSemaine?.get(`${s.year}-${s.week}`) ?? []
      const entry = entries.find(e => String(e.employee_id) === l.employee_id)
      if (!entry) continue
      l.sans_planning = false

      // ── 1. Ventilation jour par jour : seuls les jours DU MOIS comptent ──
      JOURS.forEach((j, idx) => {
        if (!dansLeMois[idx]) return
        const type = String(entry[`${j}_type`] ?? 'travail') || 'travail'
        const h = nb(entry[j])
        if (type === 'travail' && h > 0) {
          l.heures_travaillees += h
          l.jours_travailles++
          if (feries[idx]) { l.jours_ferie++; l.heures_ferie += h }
          else if (idx === 6) { l.jours_dimanche++; l.heures_dimanche += h }
        } else if (type === 'conges') {
          l.jours_cp++
          l.heures_cp += ch / 5
        } else if (type === 'maladie') {
          l.jours_maladie++
        }
      })

      // ── 2. La semaine ENTIÈRE : c'est là que se lisent les heures sup ──
      const w = entryHours(entry, ch, feries)
      const ecart = r2(w.workedH - ch)
      // Le gérant n'est pas salarié : ni heures supplémentaires, ni majorations.
      const sup = gerant ? 0 : Math.max(0, w.workedH - ch)
      const hs25 = r2(Math.min(sup, 8))
      const hs50 = r2(Math.max(0, sup - 8))

      l.semaines.push({
        week: s.week, year: s.year,
        aCheval: s.aCheval, rattachee: s.rattachee, figee,
        heures_travaillees: r2(w.workedH),
        heures_cp: r2(w.cpH),
        heures_payees: r2(w.totalH),
        contractuel: ch,
        ecart, hs25, hs50,
      })

      // Rattachées seulement : une semaine majoritairement dans le mois voisin
      // portera ses heures supplémentaires là-bas, pas ici.
      if (s.rattachee) {
        l.hs25 += hs25
        l.hs50 += hs50
        if (!gerant && ecart < 0) l.heures_manquantes += -ecart
        if (!figee) l.semaines_non_figees++
      }
    }

    l.heures_travaillees = r2(l.heures_travaillees)
    l.heures_cp = r2(l.heures_cp)
    l.heures_dimanche = r2(l.heures_dimanche)
    l.heures_ferie = r2(l.heures_ferie)
    l.heures_payees = r2(l.heures_travaillees + l.heures_cp)
    l.hs25 = r2(l.hs25)
    l.hs50 = r2(l.hs50)
    l.heures_manquantes = r2(l.heures_manquantes)

    lignes.push(l)
  }

  lignes.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))

  return {
    mois: m, annee: y, libelle: libelleMois(m, y), debut, fin,
    employes: lignes,
    semaines: contexte.map(c => ({ ...c.s, figee: c.figee })),
    avertissements: avertissements(lignes, contexte.map(c => ({ ...c.s, figee: c.figee })), m, y),
  }
}

/**
 * Ce que le rapport ne garantit pas.
 *
 * Chaque phrase nomme le fait, sa conséquence, et ce qu'il reste à faire. Une
 * réserve qu'on n'affiche pas est une réserve qui n'existe pas.
 */
function avertissements(
  lignes: LigneEmploye[],
  semaines: (SemaineDuMois & { figee: boolean })[],
  mois: number,
  annee: number,
): string[] {
  const out: string[] = []

  const libres = semaines.filter(s => s.rattachee && !s.figee)
  if (libres.length > 0) {
    out.push(
      `${libres.length === 1 ? 'Une semaine' : `${libres.length} semaines`} de cette période`
      + ` ${libres.length === 1 ? "n'est" : 'ne sont'} pas figée${libres.length === 1 ? '' : 's'}`
      + ` (${libres.map(s => `S${s.week}`).join(', ')}) : ${libres.length === 1 ? 'ses' : 'leurs'} heures`
      + ` peuvent encore changer après l'envoi. Figez-les pour que ce rapport reste vrai.`,
    )
  }

  const cheval = semaines.filter(s => s.aCheval)
  for (const s of cheval) {
    const ou = s.rattachee
      ? `ses heures supplémentaires comptent dans ${libelleMois(mois, annee)}`
      : `ses heures supplémentaires comptent dans le mois voisin, pas ici`
    out.push(
      `La semaine ${s.week} est à cheval sur deux mois (${s.joursDansLeMois} jour${s.joursDansLeMois > 1 ? 's' : ''}`
      + ` dans ${libelleMois(mois, annee)}). Ses heures sont ventilées au jour le jour, mais`
      + ` un seuil hebdomadaire ne se découpe pas : ${ou}.`,
    )
  }

  const manquants = lignes.filter(l => l.heures_manquantes > 0)
  for (const l of manquants) {
    out.push(
      `${l.nom} : ${heure(l.heures_manquantes)} sous le contrat de ${l.contractuel_hebdo} h`
      + ` sur le mois. Soit une absence n'a pas été pointée, soit ces heures sont dues.`
      + ` La plateforme ne tranche pas — le bulletin, si.`,
    )
  }

  const vides = lignes.filter(l => l.sans_planning)
  if (vides.length > 0) {
    out.push(
      `Aucun planning saisi sur ce mois pour ${vides.map(l => l.nom).join(', ')} :`
      + ` ${vides.length === 1 ? 'cette ligne est à zéro' : 'ces lignes sont à zéro'}, ce qui n'est pas la même chose`
      + ` que zéro heure travaillée.`,
    )
  }

  return out
}

// ─── L'export ─────────────────────────────────────────────────────────────

/**
 * Le rapport en lignes de tableau, prêt pour un CSV.
 *
 * Construit ici, dans le module pur, pour que le contenu de l'export soit
 * testé — et pas seulement l'écran. Un export qui diverge de l'écran est un
 * troisième chiffre.
 */
export function lignesTableau(r: RapportComptable): string[][] {
  const n = (x: number) => String(r2(x)).replace('.', ',')
  const rows: string[][] = []

  rows.push([`Rapport comptable — ${r.libelle}`])
  rows.push([`Période du ${r.debut} au ${r.fin}`])
  rows.push([`Heures uniquement — ce document n'est pas un bulletin de paie.`])
  rows.push([])

  rows.push([
    'Salarié', 'Contrat', 'Contractuel hebdo (h)',
    'Heures travaillées', 'Jours travaillés',
    'Jours CP', 'Heures CP', 'Jours maladie',
    'Heures payées',
    'HS +25 %', 'HS +50 %', 'Heures manquantes',
    'Dimanches travaillés (j)', 'Heures dimanche',
    'Fériés travaillés (j)', 'Heures férié',
  ])

  for (const l of r.employes) {
    rows.push([
      l.nom, l.contrat, n(l.contractuel_hebdo),
      n(l.heures_travaillees), String(l.jours_travailles),
      String(l.jours_cp), n(l.heures_cp), String(l.jours_maladie),
      n(l.heures_payees),
      n(l.hs25), n(l.hs50), n(l.heures_manquantes),
      String(l.jours_dimanche), n(l.heures_dimanche),
      String(l.jours_ferie), n(l.heures_ferie),
    ])
  }

  rows.push([])
  rows.push(['Détail par semaine (semaine entière — unité de calcul des heures supplémentaires)'])
  rows.push([
    'Salarié', 'Semaine', 'À cheval', 'Rattachée à ce mois', 'Figée',
    'Heures travaillées', 'Heures CP', 'Contractuel', 'Écart', 'HS +25 %', 'HS +50 %',
  ])
  for (const l of r.employes) {
    for (const s of l.semaines) {
      rows.push([
        l.nom, `S${s.week} ${s.year}`,
        s.aCheval ? 'oui' : 'non',
        s.rattachee ? 'oui' : 'non',
        s.figee ? 'oui' : 'non',
        n(s.heures_travaillees), n(s.heures_cp), n(s.contractuel),
        n(s.ecart), n(s.hs25), n(s.hs50),
      ])
    }
  }

  if (r.avertissements.length > 0) {
    rows.push([])
    rows.push(['Réserves'])
    for (const a of r.avertissements) rows.push([a])
  }

  return rows
}

/**
 * Le CSV, tel qu'Excel français l'ouvre sans rien demander.
 *
 * Séparateur point-virgule (la virgule est le séparateur décimal en français)
 * et BOM UTF-8 en tête, sans quoi Excel lit les accents de travers. Ce sont
 * deux détails, et ce sont exactement les deux qui font qu'un export « marche »
 * ou qu'on le reçoit illisible.
 */
export function versCsv(r: RapportComptable): string {
  const echappe = (c: string): string => {
    const s = String(c ?? '')
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const corps = lignesTableau(r).map(ligne => ligne.map(echappe).join(';')).join('\r\n')
  return '﻿' + corps + '\r\n'
}

/** Le nom du fichier téléchargé. */
export function nomFichier(r: RapportComptable): string {
  return `heures-${String(r.mois).padStart(2, '0')}-${r.annee}.csv`
}
