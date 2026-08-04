/**
 * LE PLANNING LU PAR POSTE — et non plus seulement par employé.
 *
 * Module PUR, testable hors ligne. Il ne dessine rien : il retourne le même
 * planning, rangé par POSTE au lieu d'être rangé par personne.
 *
 * ─── POURQUOI ────────────────────────────────────────────────────────────
 *
 * Relevé chez Skello le 04/08/2026, sur le planning réel de la boucherie : leur
 * page a deux onglets, « Employés » et « Postes », qui rejouent la même semaine.
 * En vue Postes, une ligne par rayon et le NOM dans la cellule — et sous chaque
 * jour, la couverture (« 1 pers. · 7h00 »).
 *
 * La différence n'est pas cosmétique : elle change la question à laquelle
 * l'écran répond. « Qui travaille jeudi ? » se lit par employé ; « mon rayon
 * charcuterie est-il couvert samedi ? » ne se lit QUE par poste. Un boucher se
 * pose les deux, et la seconde est celle qui fait perdre une vente.
 *
 * C'est le même geste que l'interrupteur « Main-d'œuvre » des fiches recettes :
 * un seul écran, deux lectures, aucune donnée nouvelle.
 *
 * ─── LE PARTAGE DES HEURES ───────────────────────────────────────────────
 *
 * Un créneau peut porter PLUSIEURS postes (`postes_matin`, `postes_apmidi`) :
 * le boucher fait de la découpe puis passe en vente sur la même matinée. La
 * règle du projet est déjà posée — les heures du créneau se partagent à parts
 * ÉGALES entre ses postes — et ce module l'applique sans la réinventer.
 *
 * Conséquence assumée : la somme des heures de tous les postes égale exactement
 * le total travaillé. Aucune heure n'est comptée deux fois, aucune ne disparaît.
 * C'est l'invariant que les tests vérifient.
 */

export const JOURS_DB = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const
export type JourPlanning = typeof JOURS_DB[number]

/** Le détail d'une journée, tel que `planning_entries.schedule_details` le porte. */
export type DetailJour = {
  matin_debut?: string
  matin_fin?: string
  apmidi_debut?: string
  apmidi_fin?: string
  /** Poste de toute la journée — forme héritée, encore présente en base */
  categorie?: string
  categorie_matin?: string
  categorie_apmidi?: string
  postes_matin?: string[]
  postes_apmidi?: string[]
}

export type EntreePlanning = {
  employee_id: string
  schedule_details?: Partial<Record<JourPlanning, DetailJour>> | null
} & Partial<Record<JourPlanning, number>> & Partial<Record<`${JourPlanning}_type`, string>>

export type EmployePlanning = { id: string; name: string }

/** Un créneau, vu depuis le poste qu'il sert. */
export type CreneauPoste = {
  employe_id: string
  employe_nom: string
  debut: string | null
  fin: string | null
  /** Heures imputées À CE POSTE (déjà divisées si le créneau en sert plusieurs) */
  heures: number
  moment: 'matin' | 'apmidi' | 'journee'
  /** Le créneau sert plusieurs postes : ses heures sont partagées */
  partage: boolean
}

export type JourPoste = {
  jour: JourPlanning
  creneaux: CreneauPoste[]
  heures: number
  /** Nombre de personnes DISTINCTES sur ce poste ce jour-là */
  personnes: number
}

export type LignePoste = {
  poste: string
  jours: JourPoste[]
  heures_semaine: number
  /** Le poste n'est couvert aucun jour de la semaine */
  vide: boolean
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** « 8h30 » → 8.5 ; « 8:30 » → 8.5 ; « 8.5 » → 8.5. null si illisible. */
export function heuresDepuisTexte(t: string | null | undefined): number | null {
  const s = String(t ?? '').trim()
  if (!s) return null
  const sep = s.search(/[h:]/i)
  if (sep === -1) {
    const n = parseFloat(s.replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  const h = parseInt(s.slice(0, sep), 10)
  if (!Number.isFinite(h)) return null
  const reste = s.slice(sep + 1).trim()
  const m = reste ? parseInt(reste, 10) : 0
  return h + (Number.isFinite(m) ? m : 0) / 60
}

/** Durée d'un créneau, ou null s'il n'en est pas un (fin avant début comprise). */
export function dureeCreneau(debut: string | null | undefined, fin: string | null | undefined): number | null {
  const d = heuresDepuisTexte(debut)
  const f = heuresDepuisTexte(fin)
  if (d === null || f === null || f <= d) return null
  return f - d
}

/** Les postes servis par un créneau, dédoublonnés et dans l'ordre.
 *  Trois formes coexistent en base — le multi-postes, le poste principal, et la
 *  forme héritée « une catégorie pour toute la journée ». On les lit toutes. */
export function postesDuCreneau(sd: DetailJour, moment: 'matin' | 'apmidi'): string[] {
  const multi = moment === 'matin' ? sd.postes_matin : sd.postes_apmidi
  const principal = moment === 'matin' ? sd.categorie_matin : sd.categorie_apmidi
  const liste = Array.isArray(multi) && multi.length > 0
    ? multi
    : principal
      ? [principal]
      : sd.categorie
        ? [sd.categorie]
        : []
  const vus = new Set<string>()
  const out: string[] = []
  for (const p of liste) {
    const k = String(p ?? '').trim()
    if (!k || vus.has(k)) continue
    vus.add(k)
    out.push(k)
  }
  return out
}

/**
 * La ligne des créneaux TRAVAILLÉS qui ne servent aucun rayon.
 *
 * Elle n'est PAS un poste : c'est le reste, et il porte une clé réservée qu'un
 * poste réel ne peut pas prendre. La vue la reconnaît à cette clé pour
 * l'afficher à part, en ambre, sous le nom « Sans poste ».
 */
export const SANS_POSTE = '__sans_poste__'

/**
 * Le planning rangé par POSTE.
 *
 * `postes` fixe l'ordre des lignes et garantit qu'un poste JAMAIS planifié
 * apparaisse quand même — à 00h00. C'est le point : un rayon non couvert doit
 * se voir sans qu'on ait à le chercher. Le taire reviendrait à afficher un
 * planning complet là où il manque quelqu'un.
 *
 * Seules les journées de type « travail » comptent : un congé payé n'occupe
 * aucun poste, même si son détail en porte un.
 *
 * ─── LE RESTE, ET POURQUOI IL EST RENDU ICI ──────────────────────────────
 *
 * Un créneau dont le poste n'est pas renseigné n'est imputé à AUCUN rayon : le
 * ranger d'office dans le premier de la liste inventerait une couverture. Mais
 * tant que ces heures n'étaient rendues NULLE PART, elles disparaissaient du
 * tableau — le pied de la vue Postes annonçait 160h00 là où la semaine en
 * comptait 167h48 (vu en production le 04/08/2026 : un créneau sans poste).
 * Un écart de 7h48 que rien n'expliquait à l'écran.
 *
 * D'où le contrat, volontairement explicite : cette fonction rend une ligne par
 * poste demandé, PUIS — seulement s'il reste des heures travaillées sans rayon
 * — une dernière ligne de clé SANS_POSTE. Un planning entièrement renseigné n'a
 * donc jamais cette ligne, et `postes.length` reste la longueur du résultat.
 *
 * Conséquence, et c'est le but : la somme des lignes rendues égale TOUJOURS le
 * total des heures travaillées. Aucune heure ne peut plus se perdre en silence.
 */
export function couvertureParPoste(args: {
  employes: EmployePlanning[]
  entrees: Record<string, EntreePlanning> | EntreePlanning[]
  postes: string[]
}): LignePoste[] {
  const acc = rangerCreneaux(args.employes, args.entrees)
  const lignes = construireLignes(acc, args.postes.filter(p => p !== SANS_POSTE))
  const reste = construireLignes(acc, [SANS_POSTE])[0]
  return reste.vide ? lignes : [...lignes, reste]
}

/** Le parcours du planning, écrit UNE fois : les deux lectures ci-dessus en
 *  dépendent, donc elles ne peuvent pas diverger. */
function rangerCreneaux(
  employes: EmployePlanning[],
  entreesBrutes: Record<string, EntreePlanning> | EntreePlanning[],
): Map<string, Map<JourPlanning, CreneauPoste[]>> {
  const nomDe = new Map(employes.map(e => [String(e.id), e.name]))
  const entrees = Array.isArray(entreesBrutes) ? entreesBrutes : Object.values(entreesBrutes ?? {})

  // Accumulateur : poste → jour → créneaux
  const acc = new Map<string, Map<JourPlanning, CreneauPoste[]>>()
  const pousser = (poste: string, jour: JourPlanning, c: CreneauPoste) => {
    let parJour = acc.get(poste)
    if (!parJour) { parJour = new Map(); acc.set(poste, parJour) }
    const arr = parJour.get(jour) ?? []
    arr.push(c)
    parJour.set(jour, arr)
  }

  for (const e of entrees) {
    if (!e || !e.employee_id) continue
    const nom = nomDe.get(String(e.employee_id))
    // Un employé retiré du planning laisse parfois ses lignes : sans nom, on
    // ne saurait pas quoi afficher dans la cellule.
    if (!nom) continue
    const details = e.schedule_details ?? {}

    for (const jour of JOURS_DB) {
      const type = String((e as Record<string, unknown>)[`${jour}_type`] ?? 'travail')
      if (type !== 'travail') continue
      const sd = details[jour]
      if (!sd) continue

      const moments: Array<{ moment: 'matin' | 'apmidi'; debut?: string; fin?: string }> = [
        { moment: 'matin', debut: sd.matin_debut, fin: sd.matin_fin },
        { moment: 'apmidi', debut: sd.apmidi_debut, fin: sd.apmidi_fin },
      ]
      for (const m of moments) {
        const duree = dureeCreneau(m.debut, m.fin)
        if (duree === null) continue
        const lus = postesDuCreneau(sd, m.moment)
        // Un créneau sans poste renseigné n'est imputé à AUCUN rayon. On ne le
        // range pas d'office dans le premier de la liste : ce serait inventer
        // une couverture. Il va dans SANS_POSTE, pour que ses heures restent
        // comptées quelque part au lieu de disparaître du total.
        const cibles = lus.length > 0 ? lus : [SANS_POSTE]
        const part = round2(duree / cibles.length)
        for (const poste of cibles) {
          pousser(poste, jour, {
            employe_id: String(e.employee_id),
            employe_nom: nom,
            debut: m.debut ?? null,
            fin: m.fin ?? null,
            heures: part,
            moment: m.moment,
            partage: cibles.length > 1,
          })
        }
      }
    }
  }

  return acc
}

/** Les lignes demandées, dans l'ordre demandé — y compris celles à 00h00. */
function construireLignes(
  acc: Map<string, Map<JourPlanning, CreneauPoste[]>>,
  postes: string[],
): LignePoste[] {
  return postes.map(poste => {
    const parJour = acc.get(poste)
    const jours: JourPoste[] = JOURS_DB.map(jour => {
      const creneaux = (parJour?.get(jour) ?? []).slice().sort((a, b) =>
        (a.debut ?? '').localeCompare(b.debut ?? '') || a.employe_nom.localeCompare(b.employe_nom, 'fr'))
      const heures = round2(creneaux.reduce((s, c) => s + c.heures, 0))
      const personnes = new Set(creneaux.map(c => c.employe_id)).size
      return { jour, creneaux, heures, personnes }
    })
    const heures_semaine = round2(jours.reduce((s, j) => s + j.heures, 0))
    return { poste, jours, heures_semaine, vide: heures_semaine === 0 }
  })
}

/** Total des heures planifiées, tous postes confondus. Doit égaler le total
 *  travaillé de la vue par employé — c'est ce que les tests vérifient. */
export function totalHeures(lignes: LignePoste[]): number {
  return round2(lignes.reduce((s, l) => s + l.heures_semaine, 0))
}
