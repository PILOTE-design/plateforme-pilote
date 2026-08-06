// lib/financier-jour.ts — LE RELEVÉ FINANCIER, JOUR PAR JOUR.
//
// Module PUR, testable hors ligne. Aucune dépendance, aucun accès base.
//
// ─── POURQUOI CE MODULE ───────────────────────────────────────────────────
//
// Aujourd'hui le chiffre d'affaires n'entre dans PILOTE qu'une fois par
// semaine, quand un relevé financier Crisalid est déposé à la main pour
// fabriquer le rapport. Deux conséquences :
//
//  1. le boucher ne voit son CA qu'une fois la semaine finie — trop tard pour
//     agir dessus ;
//  2. la trésorerie n'a aucune source d'ENCAISSEMENTS. Sans elle, un solde
//     n'est qu'une liste de sorties.
//
// Le relevé financier porte pourtant tout ce qu'il faut, et il est ÉDITABLE
// CHAQUE JOUR par la caisse. Transféré à l'adresse PILOTE de la boutique
// comme l'est déjà une facture, il donne le CA du jour et — c'est là
// l'essentiel pour la trésorerie — sa VENTILATION PAR MODE DE RÈGLEMENT :
// carte, espèces, titres restaurant, chèque. Cette ventilation est ce que
// Théo a dessiné sous « Financier » (« - Carte, - TR ») comme entrée de la
// trésorerie.
//
// ─── DÉTERMINISTE, PAS D'IA ───────────────────────────────────────────────
//
// Troisième principe de la maison : là où le format est fixe, on lit par
// coordonnées et on ne devine pas. Le relevé Crisalid a une mise en page
// fixe ; ses trois marqueurs (« Net … € », « Nb Tickets … », « Moyenne
// Tickets … € ») sont reconnaissables sans modèle. Un document reconnu ici
// n'atteint JAMAIS l'extraction payante de factures — ce qui, au passage,
// ferme un vrai danger : un relevé financier envoyé à l'adresse des factures
// serait aujourd'hui lu COMME une facture et gonflerait les achats du montant
// du CA de la journée.
//
// ─── JAMAIS UN CHIFFRE FAUX EN SILENCE ────────────────────────────────────
//
// Deux refus explicites plutôt qu'un chiffre plausible :
//
//  · les règlements ne sont publiés que si leur somme retombe sur le CA net
//    (tolérance identique au reste du projet : 0,50 €). Sinon la ventilation
//    est mise de côté, comptée, et le motif est nommé — exactement la
//    quarantaine des prix de facture ;
//  · un relevé qui couvre PLUSIEURS jours n'est pas réparti en journées. On
//    n'invente pas la répartition d'une semaine sur sept jours : la période
//    est enregistrée telle quelle, avec son nombre de jours, et l'appelant
//    décide (le suivi quotidien n'accepte qu'une seule journée).

/** Écart maximal toléré entre la somme des règlements et le CA net.
 *  Même tolérance que la lecture déterministe du rapport (TOL_COHERENCE_EUR). */
export const TOL_REGLEMENTS_EUR = 0.5

/** Les modes de règlement d'un commerce de détail alimentaire.
 *  `motifs` est comparé au libellé de la ligne, accents retirés, en minuscules.
 *  L'ordre compte : le premier mode dont un motif correspond gagne, donc les
 *  libellés les plus spécifiques passent avant les plus généraux
 *  (« ticket restaurant » avant « ticket »). */
export type ModeReglement = {
  cle: 'cb' | 'especes' | 'tr' | 'cheque' | 'virement' | 'autre'
  label: string
  motifs: RegExp[]
}

export const MODES_REGLEMENT: ModeReglement[] = [
  {
    cle: 'tr',
    label: 'Titres restaurant',
    // Volontairement AVANT la carte : « carte ticket restaurant » est un TR,
    // pas une carte bancaire.
    motifs: [/\btickets?\s*(-|\s)?\s*restaurants?\b/, /\btitres?\s*(-|\s)?\s*restaurants?\b/, /\bt\.?\s?r\.?\b/, /\bcheques?\s+dejeuner\b/, /\bswile\b/, /\bedenred\b/],
  },
  {
    cle: 'cb',
    label: 'Carte bancaire',
    motifs: [/\bcartes?\s+bancaires?\b/, /\bc\.?\s?b\.?\b/, /\bcarte\b/, /\bbleue\b/, /\bsans\s+contact\b/],
  },
  {
    cle: 'especes',
    label: 'Espèces',
    motifs: [/\bespeces?\b/, /\bnumeraire\b/, /\bliquide\b/, /\besp\.?\b/],
  },
  {
    cle: 'cheque',
    label: 'Chèques',
    motifs: [/\bcheques?\b/, /\bchq\b/],
  },
  {
    cle: 'virement',
    label: 'Virements',
    motifs: [/\bvirements?\b/, /\bprelevements?\b/],
  },
]

export type CleMode = ModeReglement['cle']

/** Montants par mode, en euros TTC. Un mode absent du relevé est absent de
 *  l'objet — jamais posé à zéro : « pas de ligne chèque » et « zéro chèque »
 *  ne sont pas la même information. */
export type Reglements = Partial<Record<CleMode, number>>

export type LectureFinancier = {
  /** true quand le document est bien un relevé financier de caisse */
  estFinancier: boolean
  /** CA net TTC de la période, tel qu'imprimé */
  caTtc: number | null
  nbTickets: number | null
  panierMoyen: number | null
  /** Bornes de la période, en AAAA-MM-JJ */
  debut: string | null
  fin: string | null
  /** Nombre de jours couverts, bornes comprises (1 = relevé d'une journée) */
  nbJours: number | null
  /** Ventilation publiable — null si absente ou incohérente */
  reglements: Reglements | null
  /** Ventilation LUE, même quand elle n'est pas publiable (pour l'expliquer) */
  reglementsLus: Reglements | null
  /** Écart entre la somme des règlements lus et le CA net, quand les deux existent */
  ecartReglements: number | null
  /** Ce qui empêche de publier la ventilation, en clair. null = rien à signaler. */
  motifReglements: string | null
}

// ─── Nombres et texte ─────────────────────────────────────────────────────

/** « 1 234,56 » / « 1234.56 » / « 1 234.56 € » → 1234.56. NaN si illisible. */
export function nombre(s: string): number {
  const nettoye = String(s)
    .replace(/[\s  ]/g, '')
    .replace(/€/g, '')
    .replace(',', '.')
  const n = parseFloat(nettoye)
  return Number.isFinite(n) ? n : NaN
}

/**
 * PREMIER entier d'une suite de chiffres et d'espaces, en respectant l'espace
 * comme séparateur de milliers.
 *
 * POURQUOI : le relevé imprime DEUX colonnes, « Chiffre d'Affaires » et
 * « Hors CA ». La ligne des tickets se lit donc « Nb Tickets 82 0 ». Retirer
 * toutes les espaces donnerait 820 — dix fois trop, en silence, sur un chiffre
 * qu'on ne recoupe nulle part. Un groupe n'est recollé au précédent que s'il
 * fait EXACTEMENT trois chiffres (« 1 234 » = mille deux cent trente-quatre,
 * « 82 0 » = quatre-vingt-deux puis la colonne d'à côté).
 */
export function premierEntier(s: string): number {
  const groupes = String(s).trim().split(/[\s ]+/).filter(Boolean)
  if (groupes.length === 0 || !/^\d+$/.test(groupes[0])) return NaN
  let texte = groupes[0]
  for (let i = 1; i < groupes.length; i++) {
    if (!/^\d{3}$/.test(groupes[i])) break
    texte += groupes[i]
  }
  const n = parseInt(texte, 10)
  return Number.isFinite(n) ? n : NaN
}

/** Minuscules, sans accents. La ligature « œ » est remplacée AVANT le
 *  normalize : NFD ne la décompose pas (leçon du lot 95, « boeuf » ≠ « bœuf »). */
export function sansAccents(s: string): string {
  return String(s)
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

// ─── Reconnaissance du document ───────────────────────────────────────────

const RE_NET = /^net\s+([\d\s., ]+?)\s*€/i
const RE_TICKETS = /^nb\s+tickets\s+(\d[\d\s ]*)/i
const RE_MOYENNE = /^moyenne\s+tickets\s+([\d\s., ]+?)\s*€/i

/** Trois marqueurs de l'en-tête d'un relevé financier Crisalid. On en exige
 *  DEUX : un seul (« Net … € ») se rencontre sur une facture, les trois
 *  ensemble ne se rencontrent que sur un relevé de caisse. */
export function marqueursFinancier(lignes: string[]): number {
  let n = 0
  if (lignes.some(l => RE_NET.test(l.trim()))) n++
  if (lignes.some(l => RE_TICKETS.test(l.trim()))) n++
  if (lignes.some(l => RE_MOYENNE.test(l.trim()))) n++
  return n
}

export function estReleveFinancier(lignes: string[]): boolean {
  return marqueursFinancier(lignes) >= 2
}

// ─── Dates ────────────────────────────────────────────────────────────────

const MOIS: Record<string, number> = {
  janv: 0, fevr: 1, mars: 2, avr: 3, mai: 4, juin: 5,
  juil: 6, aout: 7, sept: 8, oct: 9, nov: 10, dec: 11,
}

function moisDepuis(label: string): number | null {
  const k = sansAccents(label).replace(/[^a-z]/g, '')
  for (const [abbr, idx] of Object.entries(MOIS)) {
    if (k.startsWith(abbr) || abbr.startsWith(k.slice(0, 4))) return idx
  }
  return null
}

function jourIso(annee: number, mois: number, jour: number): string | null {
  const d = new Date(Date.UTC(annee, mois, jour))
  if (d.getUTCFullYear() !== annee || d.getUTCMonth() !== mois || d.getUTCDate() !== jour) return null
  return d.toISOString().slice(0, 10)
}

/** Toutes les dates d'une ligne, dans les deux graphies du relevé :
 *  « 21 juil. 2026 » et « 21/07/2026 ». */
function datesDeLaLigne(ligne: string): string[] {
  const trouvees: string[] = []
  for (const m of ligne.matchAll(/(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\.?\s+(20\d{2})/g)) {
    const mois = moisDepuis(m[2])
    if (mois === null) continue
    const iso = jourIso(parseInt(m[3], 10), mois, parseInt(m[1], 10))
    if (iso) trouvees.push(iso)
  }
  for (const m of ligne.matchAll(/(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2})/g)) {
    const iso = jourIso(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10))
    if (iso) trouvees.push(iso)
  }
  return trouvees
}

export type Periode = { debut: string | null; fin: string | null; nbJours: number | null }

/** Période couverte par le relevé. La ligne « du … au … » fait foi ; à défaut,
 *  la première date trouvée dans les vingt premières lignes vaut journée unique.
 *  Aucune date → aucune période : l'appelant refusera, plutôt que de dater le
 *  document du jour de sa réception (un relevé transféré le lundi porte sur le
 *  dimanche). */
export function parsePeriode(lignes: string[]): Periode {
  const vide: Periode = { debut: null, fin: null, nbJours: null }

  const ligneDuAu = lignes.find(l => /^\s*du\s+/i.test(l) && /\bau\b/i.test(l))
  let dates = ligneDuAu ? datesDeLaLigne(ligneDuAu) : []

  if (dates.length === 0) {
    for (const l of lignes.slice(0, 20)) {
      const d = datesDeLaLigne(l)
      if (d.length) { dates = d; break }
    }
  }
  if (dates.length === 0) return vide

  const triees = [...dates].sort()
  const debut = triees[0]
  const fin = triees[triees.length - 1]
  const jours = Math.round(
    (Date.parse(fin + 'T00:00:00Z') - Date.parse(debut + 'T00:00:00Z')) / 86400000,
  ) + 1
  return { debut, fin, nbJours: jours }
}

// ─── Règlements ───────────────────────────────────────────────────────────

/** Une ligne de règlement : un libellé, puis un montant en euros.
 *  Le montant est le DERNIER nombre suivi d'un € sur la ligne — le relevé
 *  aligne parfois un compteur (« Carte bancaire 42 1 000,00 € ») : c'est le
 *  montant qui porte la devise, jamais le compteur. */
const RE_LIGNE_REGLEMENT = /^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'’/-]{1,40}?)\s+([\d\s., ]+)\s*€\s*$/

export function modeDuLibelle(libelle: string): CleMode | null {
  const l = sansAccents(libelle).trim()
  for (const mode of MODES_REGLEMENT) {
    if (mode.motifs.some(m => m.test(l))) return mode.cle
  }
  return null
}

/** Lit la ventilation par mode de règlement. Renvoie null si aucune ligne de
 *  règlement n'est reconnue — beaucoup de relevés n'impriment pas ce bloc, et
 *  ce n'est pas une anomalie. Les montants d'un même mode s'ADDITIONNENT :
 *  « Carte bancaire » et « CB sans contact » sont deux lignes du même mode. */
export function parseReglements(lignes: string[]): Reglements | null {
  const trouve: Reglements = {}
  let uneAuMoins = false

  for (const brute of lignes) {
    const ligne = brute.trim()
    const m = ligne.match(RE_LIGNE_REGLEMENT)
    if (!m) continue

    const cle = modeDuLibelle(m[1])
    if (!cle) continue

    const montant = nombre(m[2])
    if (!Number.isFinite(montant)) continue

    trouve[cle] = Math.round(((trouve[cle] ?? 0) + montant) * 100) / 100
    uneAuMoins = true
  }

  return uneAuMoins ? trouve : null
}

/** Somme d'une ventilation. */
export function totalReglements(r: Reglements | null): number {
  if (!r) return 0
  return Math.round(
    Object.values(r).reduce((s, v) => s + (Number.isFinite(v) ? (v as number) : 0), 0) * 100,
  ) / 100
}

// ─── La lecture complète ──────────────────────────────────────────────────

/**
 * LE lecteur d'un relevé financier. Prend les lignes du PDF (lues par
 * coordonnées, comme partout ailleurs) et rend tout ce qu'on peut en tirer,
 * avec ce qui manque nommé.
 *
 * `estFinancier: false` veut dire « ce document n'est pas un relevé de
 * caisse » — l'appelant reprend son chemin normal, il ne s'est rien passé.
 */
export function lireFinancier(lignes: string[]): LectureFinancier {
  const vide: LectureFinancier = {
    estFinancier: false,
    caTtc: null, nbTickets: null, panierMoyen: null,
    debut: null, fin: null, nbJours: null,
    reglements: null, reglementsLus: null,
    ecartReglements: null, motifReglements: null,
  }

  if (!estReleveFinancier(lignes)) return vide

  let ca = NaN, tickets = NaN, panier = NaN
  for (const brute of lignes) {
    const ligne = brute.trim()
    if (Number.isNaN(ca)) {
      const m = ligne.match(RE_NET)
      if (m) ca = nombre(m[1])
    }
    if (Number.isNaN(tickets)) {
      const m = ligne.match(RE_TICKETS)
      if (m) tickets = premierEntier(m[1])
    }
    if (Number.isNaN(panier)) {
      const m = ligne.match(RE_MOYENNE)
      if (m) panier = nombre(m[1])
    }
  }

  const periode = parsePeriode(lignes)
  const lus = parseReglements(lignes)

  // Publication de la ventilation : elle doit retomber sur le CA net. Sinon
  // c'est qu'une ligne a été manquée ou qu'un libellé a été pris pour un mode
  // de règlement — dans les deux cas la répartition serait fausse, et une
  // répartition fausse fabrique un solde de trésorerie faux.
  let reglements: Reglements | null = null
  let ecart: number | null = null
  let motif: string | null = null

  if (!lus) {
    motif = 'ce relevé n’imprime pas le détail par mode de règlement'
  } else if (!(ca > 0)) {
    motif = 'CA net illisible : la ventilation ne peut pas être recoupée'
  } else {
    ecart = Math.round((totalReglements(lus) - ca) * 100) / 100
    if (Math.abs(ecart) <= TOL_REGLEMENTS_EUR) {
      reglements = lus
    } else {
      motif = `la somme des règlements (${totalReglements(lus).toFixed(2)} €) ne retombe pas sur le CA net (${ca.toFixed(2)} €), écart ${ecart.toFixed(2)} €`
    }
  }

  return {
    estFinancier: true,
    caTtc: ca > 0 ? ca : null,
    nbTickets: Number.isFinite(tickets) ? tickets : null,
    panierMoyen: Number.isFinite(panier) ? panier : null,
    debut: periode.debut,
    fin: periode.fin,
    nbJours: periode.nbJours,
    reglements,
    reglementsLus: lus,
    ecartReglements: ecart,
    motifReglements: motif,
  }
}

/** Ce qu'on peut faire d'une lecture, en un mot — pour que l'appelant n'ait
 *  pas à réinventer la règle, et que l'écran et le webhook disent la même
 *  chose. */
export type VerdictEnregistrement =
  | { enregistrable: true; jourUnique: boolean }
  | { enregistrable: false; motif: string }

export function verdictEnregistrement(l: LectureFinancier): VerdictEnregistrement {
  if (!l.estFinancier) return { enregistrable: false, motif: 'document non reconnu comme relevé financier' }
  if (!(l.caTtc && l.caTtc > 0)) return { enregistrable: false, motif: 'CA net absent ou illisible' }
  if (!l.debut || !l.fin || !l.nbJours) {
    // Dater le relevé du jour de sa réception serait une invention : un relevé
    // transféré le lundi matin porte sur le dimanche.
    return { enregistrable: false, motif: 'aucune date lisible sur le relevé' }
  }
  if (l.nbJours > 31) return { enregistrable: false, motif: `période de ${l.nbJours} jours : trop large pour un relevé de caisse` }
  return { enregistrable: true, jourUnique: l.nbJours === 1 }
}
