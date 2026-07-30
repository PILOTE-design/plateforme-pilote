// lib/report-checks.ts — CONTRÔLES DÉTERMINISTES de l'extraction du rapport.
// Module PUR : zéro IA, zéro base de données — exécutable et testable seul.
//
// Chaque seuil vient d'une MESURE sur l'historique réel (weekly_ca, Phase 1 du
// chantier fiabilité, 30/07/2026), pas d'une intuition :
//   · tickets × panier ↔ CA : écart max constaté 0,009 % → un dépassement de
//     0,5 % est matériellement impossible sans erreur de lecture → BLOQUANT ;
//   · somme des familles ↔ CA financier : écarts constatés de 0 à 13,8 %, et le
//     MÊME fichier relu deux fois a donné deux sommes différentes (S29/2026 :
//     19 126 € vs 21 126 €). Au-delà de 2 %, personne ne peut trancher à la
//     place d'un humain → À VALIDER, jamais une bascule silencieuse.
//
// Trois sévérités :
//   'bloquant'   → le rapport ne DOIT pas sortir (fichier faux, lecture cassée) ;
//   'validation' → un humain doit voir le chiffre à côté de sa source avant envoi ;
//   'info'       → contexte affiché, ne bloque pas.

import { normText } from '@/lib/postes'

export type CheckSeverity = 'bloquant' | 'validation' | 'info'

export type CheckResult = {
  code: string
  label: string
  severite: CheckSeverity
  passe: boolean
  details: string
}

export type ExtractionStatus = 'vert' | 'a_valider' | 'bloque'

/** Seuils calibrés sur l'historique réel — les modifier exige une nouvelle mesure. */
export const SEUILS = {
  /** tickets × panier vs CA net (max mesuré : 0,009 %) */
  financier_interne_pct: 0.5,
  /** somme des familles vs CA financier (mesuré : 0 à 13,8 %) */
  familles_vs_financier_pct: 2,
  /** relecture N-1 vs archive de l'an dernier : même document, doit coller */
  n1_vs_archive_pct: 0.5,
  /** plausibilité du CA vs la médiane des dernières semaines (simple info) */
  ca_plausible_facteur: 0.6,
} as const

/** Forme minimale attendue — structurellement compatible avec la
 *  StoredExtraction de report-trace (les checks tournent sur ce qui est stocké,
 *  jamais sur un état intermédiaire différent). */
export type CheckableExtraction = {
  week_number: number
  year: number
  period_n1: string
  financier_n: { ca_net: number; nb_tickets: number; moyenne_ticket: number }
  financier_n1: { ca_net: number; nb_tickets: number; moyenne_ticket: number }
  ventes_n: { total: number; familles: { nom: string; montant: number }[] }
  ventes_n1: { total: number; familles: { nom: string; montant: number }[] }
  /** Corrections appliquées pendant l'extraction (reconcile, décimale perdue…) */
  notes?: string[]
}

export type ChecksContext = {
  /** Empreintes des 4 fichiers uploadés — détecte le même PDF fourni deux fois */
  fileHashes?: Partial<Record<'financier_n' | 'financier_n1' | 'ventes_n' | 'ventes_n1', string>>
  /** Semaine ISO recalculée en code depuis la période N-1 (weekFromPeriod), null si illisible */
  weekN1?: { week: number; year: number } | null
  /** CA des dernières semaines archivées du client (hors semaine en cours) */
  historyCa?: number[]
  /** weekly_ca déjà archivé pour (semaine, année-1) — l'an dernier, le même
   *  document a déjà été lu : les deux lectures doivent coller */
  previousN1?: { ca_total: number } | null
}

const eur = (n: number) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const pctOf = (a: number, b: number) => (b > 0 ? (Math.abs(a - b) / b) * 100 : 0)

function financierCoherent(
  code: string, label: string,
  fin: { ca_net: number; nb_tickets: number; moyenne_ticket: number },
  optionnel: boolean,
): CheckResult {
  if (fin.ca_net <= 0) {
    return optionnel
      ? { code, label, severite: 'bloquant', passe: true, details: 'Aucun CA N-1 (pas d\'historique) — comparatif désactivé.' }
      : { code, label, severite: 'bloquant', passe: false, details: 'Aucun CA lu dans le relevé financier.' }
  }
  const produit = fin.nb_tickets * fin.moyenne_ticket
  const ecart = pctOf(produit, fin.ca_net)
  return {
    code, label, severite: 'bloquant',
    passe: ecart <= SEUILS.financier_interne_pct,
    details: `${fin.nb_tickets} tickets × ${eur(fin.moyenne_ticket)} = ${eur(produit)} pour un CA lu de ${eur(fin.ca_net)} (écart ${ecart.toFixed(3)} %, seuil ${SEUILS.financier_interne_pct} % — max historique mesuré : 0,009 %).`,
  }
}

function famillesVsFinancier(
  code: string, label: string,
  ventes: { familles: { nom: string; montant: number }[] },
  caNet: number,
): CheckResult {
  if (caNet <= 0) {
    return { code, label, severite: 'validation', passe: true, details: 'Aucun CA de référence — contrôle sans objet.' }
  }
  const somme = ventes.familles.reduce((s, f) => s + f.montant, 0)
  const ecart = pctOf(somme, caNet)
  return {
    code, label, severite: 'validation',
    passe: ecart <= SEUILS.familles_vs_financier_pct,
    details: `Somme des familles ${eur(somme)} vs CA financier ${eur(caNet)} (écart ${ecart.toFixed(2)} %, seuil ${SEUILS.familles_vs_financier_pct} %).`,
  }
}

function famillesSansDoublon(code: string, label: string, familles: { nom: string }[]): CheckResult {
  const vus = new Map<string, string>()
  const doublons: string[] = []
  for (const f of familles) {
    const k = normText(f.nom)
    if (!k) continue
    if (vus.has(k) && vus.get(k) !== f.nom) doublons.push(`« ${vus.get(k)} » / « ${f.nom} »`)
    else if (vus.has(k)) doublons.push(`« ${f.nom} » en double`)
    else vus.set(k, f.nom)
  }
  return {
    code, label, severite: 'validation',
    passe: doublons.length === 0,
    details: doublons.length === 0
      ? `${familles.length} familles, aucun doublon.`
      : `Familles en doublon après normalisation : ${doublons.join(', ')} — leur CA est probablement compté deux fois.`,
  }
}

/** Tous les contrôles, dans l'ordre d'affichage. */
export function runExtractionChecks(d: CheckableExtraction, ctx: ChecksContext = {}): CheckResult[] {
  const checks: CheckResult[] = []

  // 1-2. Cohérence interne des relevés financiers (invariant de caisse)
  checks.push(financierCoherent('financier_n_coherent', 'Relevé financier N cohérent (tickets × panier = CA)', d.financier_n, false))
  checks.push(financierCoherent('financier_n1_coherent', 'Relevé financier N-1 cohérent (tickets × panier = CA)', d.financier_n1, true))

  // 3. Le fichier N-1 concerne bien la même semaine, un an plus tôt
  if (ctx.weekN1 === undefined) {
    checks.push({ code: 'semaine_n1_concordante', label: 'Le fichier N-1 est la bonne semaine', severite: 'validation', passe: true, details: 'Non calculé.' })
  } else if (ctx.weekN1 === null) {
    checks.push({
      code: 'semaine_n1_concordante', label: 'Le fichier N-1 est la bonne semaine', severite: 'validation', passe: false,
      details: `Période N-1 illisible (« ${d.period_n1} ») — impossible de confirmer que le fichier est celui de la semaine ${d.week_number}/${d.year - 1}.`,
    })
  } else {
    const ok = ctx.weekN1.week === d.week_number && ctx.weekN1.year === d.year - 1
    checks.push({
      code: 'semaine_n1_concordante', label: 'Le fichier N-1 est la bonne semaine', severite: 'bloquant', passe: ok,
      details: ok
        ? `Période N-1 = S${ctx.weekN1.week}/${ctx.weekN1.year}, attendu S${d.week_number}/${d.year - 1}.`
        : `Le fichier N-1 couvre S${ctx.weekN1.week}/${ctx.weekN1.year} au lieu de S${d.week_number}/${d.year - 1} — mauvais fichier uploadé.`,
    })
  }

  // 4. Quatre fichiers distincts (le même PDF fourni deux fois = comparaison N vs N fausse)
  if (ctx.fileHashes) {
    const entries = Object.entries(ctx.fileHashes).filter(([, h]) => !!h)
    const parHash = new Map<string, string[]>()
    for (const [kind, hash] of entries) {
      parHash.set(hash as string, [...(parHash.get(hash as string) || []), kind])
    }
    const dupes = [...parHash.values()].filter(kinds => kinds.length > 1)
    checks.push({
      code: 'fichiers_distincts', label: 'Les 4 fichiers sont distincts', severite: 'bloquant',
      passe: dupes.length === 0,
      details: dupes.length === 0
        ? `${entries.length} fichiers, empreintes toutes différentes.`
        : `Fichiers identiques détectés : ${dupes.map(k => k.join(' = ')).join(' ; ')} — le même PDF a été fourni plusieurs fois.`,
    })
  }

  // 5-6. Somme des familles vs CA financier (l'écart mesuré qui motive tout le chantier)
  checks.push(famillesVsFinancier('familles_n_vs_financier', 'Familles N ↔ CA financier N', d.ventes_n, d.financier_n.ca_net))
  checks.push(famillesVsFinancier('familles_n1_vs_financier', 'Familles N-1 ↔ CA financier N-1', d.ventes_n1, d.financier_n1.ca_net))

  // 7-8. Doublons de familles
  checks.push(famillesSansDoublon('familles_n_sans_doublon', 'Familles N sans doublon', d.ventes_n.familles))
  checks.push(famillesSansDoublon('familles_n1_sans_doublon', 'Familles N-1 sans doublon', d.ventes_n1.familles))

  // 9. Corrections appliquées en cours d'extraction — plus jamais silencieuses
  const notes = d.notes ?? []
  checks.push({
    code: 'corrections_extraction', label: 'Aucune correction automatique pendant l\'extraction', severite: 'validation',
    passe: notes.length === 0,
    details: notes.length === 0 ? 'Aucune valeur corrigée ou écartée.' : notes.join(' · '),
  })

  // 10. Relecture N-1 vs archive : l'an dernier, le même document a déjà été lu
  if (ctx.previousN1 === undefined) {
    checks.push({ code: 'n1_vs_archive', label: 'N-1 identique à l\'archive de l\'an dernier', severite: 'validation', passe: true, details: 'Non calculé.' })
  } else if (ctx.previousN1 === null) {
    checks.push({ code: 'n1_vs_archive', label: 'N-1 identique à l\'archive de l\'an dernier', severite: 'validation', passe: true, details: 'Première lecture de cette semaine — aucune archive à comparer.' })
  } else {
    const archive = ctx.previousN1.ca_total
    const frais = d.financier_n1.ca_net
    const ecart = pctOf(frais, archive)
    checks.push({
      code: 'n1_vs_archive', label: 'N-1 identique à l\'archive de l\'an dernier', severite: 'validation',
      passe: ecart <= SEUILS.n1_vs_archive_pct,
      details: ecart <= SEUILS.n1_vs_archive_pct
        ? `CA N-1 lu ${eur(frais)} = archive ${eur(archive)} (écart ${ecart.toFixed(2)} %).`
        : `CA N-1 lu ${eur(frais)} mais ${eur(archive)} archivé l'an dernier pour la même semaine (écart ${ecart.toFixed(2)} %) — l'une des deux lectures est fausse, elle ne sera pas écrasée sans validation.`,
    })
  }

  // 11. Plausibilité du CA vs l'historique du client (info : une semaine
  // exceptionnelle est possible — fêtes, fermeture — on signale, on ne bloque pas)
  if (ctx.historyCa && ctx.historyCa.length >= 3 && d.financier_n.ca_net > 0) {
    const sorted = [...ctx.historyCa].sort((a, b) => a - b)
    const mediane = sorted[Math.floor(sorted.length / 2)]
    const lo = mediane * (1 - SEUILS.ca_plausible_facteur)
    const hi = mediane * (1 + SEUILS.ca_plausible_facteur)
    const dedans = d.financier_n.ca_net >= lo && d.financier_n.ca_net <= hi
    checks.push({
      code: 'ca_plausible', label: 'CA de la semaine plausible vs l\'historique', severite: 'info',
      passe: dedans,
      details: dedans
        ? `CA ${eur(d.financier_n.ca_net)} dans la fourchette habituelle (médiane ${eur(mediane)} sur ${ctx.historyCa.length} semaines).`
        : `CA ${eur(d.financier_n.ca_net)} hors de la fourchette habituelle [${eur(lo)} – ${eur(hi)}] (médiane ${eur(mediane)}) — semaine exceptionnelle ou erreur de lecture.`,
    })
  }

  return checks
}

/** Statut global : le pire contrôle en échec l'emporte ; 'info' ne gate jamais. */
export function statusFromChecks(checks: CheckResult[]): ExtractionStatus {
  if (checks.some(c => !c.passe && c.severite === 'bloquant')) return 'bloque'
  if (checks.some(c => !c.passe && c.severite === 'validation')) return 'a_valider'
  return 'vert'
}

/** Résumé lisible des contrôles en échec, pour les messages d'erreur. */
export function failedChecksSummary(checks: CheckResult[]): string {
  return checks.filter(c => !c.passe && c.severite !== 'info')
    .map(c => `${c.label} : ${c.details}`).join(' — ')
}
