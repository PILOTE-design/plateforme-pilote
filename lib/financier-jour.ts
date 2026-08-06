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

/** Écart maximal entre la somme des lignes lues et le total imprimé par le
 *  relevé. Un centime, pas cinquante : on compare deux impressions du MÊME
 *  document, pas deux sources différentes. Toute tolérance plus large
 *  laisserait passer une ligne manquée. */
export const TOL_TOTAL_EUR = 0.01

/** Les modes de règlement d'un commerce de détail alimentaire.
 *  `motifs` est comparé au libellé de la ligne, accents retirés, en minuscules.
 *  L'ordre compte : le premier mode dont un motif correspond gagne, donc les
 *  libellés les plus spécifiques passent avant les plus généraux
 *  (« ticket restaurant » avant « ticket »). */
export type ModeReglement = {
  cle: 'cb' | 'especes' | 'tr' | 'cheque' | 'virement' | 'bon_achat' | 'autre'
  label: string
  motifs: RegExp[]
}

export const MODES_REGLEMENT: ModeReglement[] = [
  {
    cle: 'tr',
    label: 'Titres restaurant',
    // Volontairement AVANT la carte. Deux raisons : « carte ticket restaurant »
    // contient « carte », et la caisse écrit « CARTE_TR » — un titre restaurant
    // encaissé sur le terminal carte, qui n'est pas un encaissement carte.
    // (Le tiret bas est un caractère de mot : \bcarte\b ne matche pas
    // « carte_tr ». La ceinture ET les bretelles.)
    motifs: [
      /\btrestau\b/, /\bcarte_tr\b/, /\bcb_tr\b/,
      /\btickets?\s*(-|_|\s)?\s*restaurants?\b/, /\btitres?\s*(-|_|\s)?\s*restaurants?\b/,
      /\bt\.?\s?r\.?\b/, /\bcheques?\s+dejeuner\b/, /\bswile\b/, /\bedenred\b/,
    ],
  },
  {
    cle: 'cb',
    label: 'Carte bancaire',
    motifs: [/\bcartes?\s+bancaires?\b/, /\bc\.?\s?b\.?\b/, /\bcartes?\b/, /\bbleue\b/, /\bsans\s+contact\b/],
  },
  {
    cle: 'especes',
    label: 'Espèces',
    motifs: [/\besp[eè]ces?\b/, /\bnumeraire\b/, /\bliquide\b/, /\besp\.?\b/],
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
  {
    cle: 'bon_achat',
    label: 'Bons d’achat',
    // Un bon d'achat encaissé est bien de l'argent qui solde un ticket : il
    // entre dans le total des encaissements de la caisse. Il n'entre PAS dans
    // la trésorerie bancaire — c'est un avoir consommé, pas un flux. La
    // distinction appartient à l'écran, pas à la lecture.
    motifs: [/\bbon\.?\s?achats?\b/, /\bbons?\s+d’?\s?achats?\b/, /\bavoirs?\b/],
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
  /** Ventilation publiable — null tant que le total du document ne la confirme pas */
  reglements: Reglements | null
  /** Ventilation LUE, même quand elle n'est pas publiable (pour l'expliquer) */
  reglementsLus: Reglements | null
  /** CE QUI EST RENTRÉ EN CAISSE, publiable. C'est le chiffre de la TRÉSORERIE
   *  — distinct du CA : la marchandise portée en compte client est vendue mais
   *  pas encaissée. null tant que la ventilation n'est pas confirmée. */
  encaisseTtc: number | null
  /** Nombre d'encaissements, quand la caisse imprime ses compteurs */
  nbEncaissements: number | null
  /** CA net − encaissé : les comptes clients, en clair. Information, jamais
   *  motif de refus. */
  ecartCaEncaisse: number | null
  /** Le bloc complet, pour l'écran (libellés de caisse, compteurs, doublons) */
  bloc: BlocReglements | null
  /** Ce qui empêche de publier la ventilation, en clair. null = rien à signaler. */
  motifReglements: string | null
}

// ─── Nombres et texte ─────────────────────────────────────────────────────

/** « 1 234,56 » / « 1234.56 » / « 1 234.56 € » → 1234.56. NaN si illisible.
 *
 *  `\s` suffit : en JavaScript il couvre DÉJÀ l'espace insécable (U+00A0) et
 *  l'espace fine insécable (U+202F), les deux séparateurs de milliers qu'un PDF
 *  français imprime. Les écrire en clair dans la classe serait redondant — et
 *  surtout fragile : un caractère invisible ne survit pas à toutes les chaînes
 *  d'outils, et sa disparition passerait inaperçue à la relecture. */
export function nombre(s: string): number {
  const nettoye = String(s)
    .replace(/\s/g, '')
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
  const groupes = String(s).trim().split(/\s+/).filter(Boolean)
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
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

// ─── Reconnaissance du document ───────────────────────────────────────────

const RE_NET = /^net\s+([\d\s.,]+?)\s*€/i
const RE_TICKETS = /^nb\s+tickets\s+(\d[\d\s]*)/i
const RE_MOYENNE = /^moyenne\s+tickets\s+([\d\s.,]+?)\s*€/i

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
//
// RECALÉ SUR UN VRAI RELEVÉ (lot 105). La première version raisonnait sur un
// format supposé et sortait 74 976 942,99 € de règlements sur le relevé S31 de
// la Boucherie du Val des Bois. La quarantaine a tenu — rien n'a été publié —
// mais rien n'était lu non plus. Trois défauts, tous visibles sur le document
// et invisibles sans lui :
//
//  1. UN COMPTEUR PRÉCÈDE LE MONTANT. La ligne se lit « CARTE 372 13980.83 € » :
//     372 est le nombre d'encaissements, pas un séparateur de milliers. Coller
//     les deux donnait 37 213 980,83 €.
//  2. LE BLOC EST IMPRIMÉ DEUX FOIS. La mise en page du relevé le répète en
//     deux colonnes ; les lignes tombent donc deux fois dans la lecture par
//     coordonnées. Additionner sans réfléchir DOUBLE tous les encaissements —
//     et un doublement exact ne se voit pas à l'œil sur un total.
//  3. LES LIBELLÉS SONT CEUX DE LA CAISSE : CARTE, CARTE_TR, TRESTAU,
//     BON.ACHAT, ESPECES, CHEQUE, VIREMENT. Pas « Carte bancaire », pas
//     « Titres restaurant ».
//
// ─── COMMENT ON SE PROTÈGE, ET POURQUOI PAS AVEC LE CA ────────────────────
//
// La première version exigeait que la somme des règlements retombe sur le CA
// net. C'est FAUX par construction : le relevé S31 donne 17 456,55 €
// d'encaissements pour 18 347,75 € de CA. Les 891,20 € d'écart sont les
// COMPTES CLIENTS — la marchandise est vendue, l'argent n'est pas encore
// rentré. Une boucherie qui livre des restaurants en aura toujours.
//
// Et c'est une bonne nouvelle : pour la trésorerie, ce qui compte est
// justement ce qui RENTRE, pas ce qui est vendu. L'écart CA − encaissé est
// donc conservé et rendu (`ecartCaEncaisse`), comme information, jamais comme
// motif de refus.
//
// Le vrai garde-fou est DANS le document : le bloc porte son propre total, et
// ce total porte un COMPTEUR — « Total 463 17456.55 € ». On ne cherche pas ce
// total par sa position ni par un titre de section (les colonnes s'entremêlent) :
// on le reconnaît à l'ARITHMÉTIQUE. Le bon total est celui dont le compteur ET
// le montant retombent tous les deux sur la somme des lignes dédoublonnées.
// Deux vérifications indépendantes ; deux coïncidences simultanées sur un
// document réel, ça n'arrive pas.
//
// Sans total confirmé, on ne publie pas. Un encaissement faux fabrique un
// solde de trésorerie faux, et un solde faux est pire que pas de solde.

/** Une ligne d'encaissement telle qu'imprimée. */
export type LigneReglement = {
  /** Le libellé de la caisse, tel quel (« CARTE_TR ») */
  libelle: string
  mode: CleMode
  /** Nombre d'encaissements de ce mode. null quand le relevé ne le donne pas. */
  compteur: number | null
  montant: number
}

export type BlocReglements = {
  /** Montants par mode, dédoublonnés */
  modes: Reglements
  /** Compteurs par mode, quand le relevé les imprime */
  compteurs: Partial<Record<CleMode, number>>
  lignes: LigneReglement[]
  total: number
  /** Somme des compteurs, null si le relevé n'en imprime aucun */
  nbEncaissements: number | null
  /** true quand un « Total <n> <montant> € » du document retombe sur les deux */
  totalConfirme: boolean
  /** Nombre de lignes écartées parce qu'identiques à une déjà lue */
  doublonsEcartes: number
}

/** Un libellé de caisse : lettres, chiffres, point, tiret bas, apostrophe.
 *  Volontairement large — c'est le dictionnaire des modes qui tranche ensuite,
 *  pas cette expression. */
const RE_LIGNE_REGLEMENT = /^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9_.'’ -]{0,40}?)\s+([\d\s.,]+?)\s*€/

const RE_TOTAL_COMPTE = /^total\s+(\d+)\s+([\d\s.,]+?)\s*€/i

/**
 * Sépare « 372 13980.83 » en compteur 372 et montant 13980.83.
 *
 * DEUX LECTURES POSSIBLES, ET ON NE DEVINE PAS LAQUELLE :
 *   · `millesRecolles = false` — le dernier groupe est le montant, tout ce qui
 *     précède est le compteur. C'est la lecture du relevé Crisalid observé :
 *     « CHEQUE 1 984.70 € » = un chèque de 984,70 €.
 *   · `millesRecolles = true` — les groupes de trois chiffres sont recollés au
 *     précédent : « CARTE 372 13 980.83 € » = 372 encaissements pour
 *     13 980,83 €. C'est la lecture d'un relevé qui sépare ses milliers.
 *
 * Les deux sont vraies, sur des documents différents, et AUCUN indice local ne
 * les départage : « 1 984.70 » vaut 1 984,70 € ou bien 1 fois 984,70 €, et
 * seule la ligne ne le dira jamais. C'est pourquoi `parseReglements` essaie les
 * deux et laisse le TOTAL DU DOCUMENT arbitrer — l'arithmétique tranche, pas
 * une préférence de l'auteur. Une première version recollait toujours les
 * milliers et transformait « TRESTAU 20 181.00 € » en 20 181 € : vingt fois
 * trop, sur un document réel.
 */
export function compteurEtMontant(
  texte: string,
  options?: { millesRecolles?: boolean },
): { compteur: number | null; montant: number } {
  const groupes = String(texte).trim().split(/\s+/).filter(Boolean)
  if (groupes.length === 0) return { compteur: null, montant: NaN }
  if (groupes.length === 1) return { compteur: null, montant: nombre(groupes[0]) }

  let i = groupes.length - 1
  let montantTexte = groupes[i]

  if (options?.millesRecolles) {
    while (i > 0 && /^\d{3}(?:[.,]\d+)?$/.test(montantTexte) && /^\d{1,3}$/.test(groupes[i - 1])) {
      montantTexte = groupes[i - 1] + montantTexte
      i--
    }
  }

  const compteur = i > 0 ? premierEntier(groupes.slice(0, i).join(' ')) : null
  return {
    compteur: Number.isFinite(compteur as number) ? (compteur as number) : null,
    montant: nombre(montantTexte),
  }
}

export function modeDuLibelle(libelle: string): CleMode | null {
  const l = sansAccents(libelle).trim()
  for (const mode of MODES_REGLEMENT) {
    if (mode.motifs.some(m => m.test(l))) return mode.cle
  }
  return null
}

/**
 * Lit le bloc des encaissements. Renvoie null quand aucune ligne n'est
 * reconnue — tous les relevés n'impriment pas ce bloc, et ce n'est pas une
 * anomalie.
 *
 * DÉDOUBLONNAGE : deux lignes de même libellé, même compteur et même montant
 * sont la MÊME ligne imprimée deux fois par la mise en page. Deux
 * encaissements réellement distincts du même mode seraient agrégés par la
 * caisse dans une seule ligne avec son compteur — la caisse ne sort pas deux
 * lignes « CARTE » pour la même période.
 */
export function parseReglements(lignes: string[]): BlocReglements | null {
  // Les deux lectures possibles d'un « compteur montant », dans l'ordre où on
  // les essaie. Celle qui retombe sur le total imprimé gagne ; si aucune ne
  // retombe, on rend la première (avec totalConfirme à false) pour que l'écran
  // puisse montrer ce qui a été lu et pourquoi ce n'est pas publié.
  const essais = [false, true].map(millesRecolles => lireBloc(lignes, millesRecolles))
  const confirme = essais.find(b => b && b.totalConfirme)
  return confirme ?? essais[0]
}

function lireBloc(lignes: string[], millesRecolles: boolean): BlocReglements | null {
  const vues = new Set<string>()
  const retenues: LigneReglement[] = []
  let doublons = 0

  for (const brute of lignes) {
    const ligne = brute.trim()
    const m = ligne.match(RE_LIGNE_REGLEMENT)
    if (!m) continue

    const libelle = m[1].trim()
    const mode = modeDuLibelle(libelle)
    if (!mode) continue

    const { compteur, montant } = compteurEtMontant(m[2], { millesRecolles })
    if (!Number.isFinite(montant)) continue

    const cle = `${sansAccents(libelle)}|${compteur ?? '-'}|${montant.toFixed(2)}`
    if (vues.has(cle)) { doublons++; continue }
    vues.add(cle)
    retenues.push({ libelle, mode, compteur, montant })
  }

  if (retenues.length === 0) return null

  const modes: Reglements = {}
  const compteurs: Partial<Record<CleMode, number>> = {}
  let total = 0
  let nb = 0
  let auMoinsUnCompteur = false

  for (const r of retenues) {
    modes[r.mode] = Math.round(((modes[r.mode] ?? 0) + r.montant) * 100) / 100
    total = Math.round((total + r.montant) * 100) / 100
    if (r.compteur !== null) {
      compteurs[r.mode] = (compteurs[r.mode] ?? 0) + r.compteur
      nb += r.compteur
      auMoinsUnCompteur = true
    }
  }

  const nbEncaissements = auMoinsUnCompteur ? nb : null

  // INVARIANT DE BON SENS : un mode encaissé N fois ne peut pas totaliser 0 €.
  // C'est la signature exacte d'une mauvaise lecture du couple compteur/montant
  // (« 12 000.00 » lu comme « 000.00 »), et elle se repère AVANT toute
  // comparaison de totaux.
  const lectureAbsurde = retenues.some(r => r.compteur !== null && r.compteur > 0 && !(r.montant > 0))

  // Le total du document, reconnu par l'ARITHMÉTIQUE et non par sa position :
  // les colonnes du relevé s'entremêlent, un total voisin n'est pas forcément
  // celui du bloc. Le bon total est celui dont le compteur ET le montant
  // retombent tous les deux sur les lignes lues.
  let totalConfirme = false
  for (const brute of lectureAbsurde ? [] : lignes) {
    const m = brute.trim().match(RE_TOTAL_COMPTE)
    if (!m) continue
    const compteurAnnonce = parseInt(m[1], 10)
    const { montant: montantAnnonce } = compteurEtMontant(m[2], { millesRecolles })
    if (!Number.isFinite(montantAnnonce)) continue
    // Le total doit être POSITIF des deux côtés. Sans cette borne, une lecture
    // dégénérée se confirme elle-même : sur « CARTE 90 12 000.00 € », la lecture
    // qui ne recolle pas les milliers lit « 000.00 » = 0 €, et le total lu de la
    // même façon vaut 0 aussi. Zéro égale zéro, le compteur tombe juste, et une
    // lecture entièrement fausse passait pour confirmée.
    if (!(montantAnnonce > 0) || !(total > 0)) continue
    const memeMontant = Math.abs(montantAnnonce - total) <= TOL_TOTAL_EUR
    const memeCompteur = nbEncaissements === null || compteurAnnonce === nbEncaissements
    if (memeMontant && memeCompteur) { totalConfirme = true; break }
  }

  return { modes, compteurs, lignes: retenues, total, nbEncaissements, totalConfirme, doublonsEcartes: doublons }
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
    encaisseTtc: null, nbEncaissements: null,
    ecartCaEncaisse: null, bloc: null, motifReglements: null,
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
  const bloc = parseReglements(lignes)

  // PUBLICATION DE LA VENTILATION — arbitrée par l'arithmétique du document,
  // jamais par une comparaison au CA (cf. le long commentaire plus haut : les
  // comptes clients font que l'encaissé est légitimement inférieur au CA).
  let reglements: Reglements | null = null
  let encaisse: number | null = null
  let motif: string | null = null

  if (!bloc) {
    motif = 'ce relevé n’imprime pas le détail par mode de règlement'
  } else if (!bloc.totalConfirme) {
    const attendu = bloc.nbEncaissements === null
      ? `${bloc.total.toFixed(2)} €`
      : `${bloc.nbEncaissements} encaissements pour ${bloc.total.toFixed(2)} €`
    motif = `aucun total du relevé ne retombe sur les lignes lues (${attendu}) : la ventilation n’est pas publiée`
  } else {
    reglements = bloc.modes
    encaisse = bloc.total
  }

  const ecartCaEncaisse = (encaisse !== null && ca > 0)
    ? Math.round((ca - encaisse) * 100) / 100
    : null

  return {
    estFinancier: true,
    caTtc: ca > 0 ? ca : null,
    nbTickets: Number.isFinite(tickets) ? tickets : null,
    panierMoyen: Number.isFinite(panier) ? panier : null,
    debut: periode.debut,
    fin: periode.fin,
    nbJours: periode.nbJours,
    reglements,
    reglementsLus: bloc ? bloc.modes : null,
    encaisseTtc: encaisse,
    nbEncaissements: bloc ? bloc.nbEncaissements : null,
    ecartCaEncaisse,
    bloc,
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
