// Calculs métier du rapport : lignes par famille, statut de la semaine, lecture
// de la marge, résumé, et insights Haiku. Tout ce qui est déterministe vit ici et
// n'est jamais délégué au modèle.
import Anthropic from '@anthropic-ai/sdk'
import { benchOf } from '@/lib/postes'
import type { WeekEconomics } from '@/lib/week-economics'
import { eur, eur0, signEur, trunc, sanitize } from './report-format'
import { extractJSONObject } from './report-extract'
import type { ReportData, FamRow, WeekStatus, Insights, Famille } from './report-types'

// ─── Calculs métier ──────────────────────────────────────────────────────────

/** Familles fusionnées N/N-1, triées par CA N desc, plafonnées à 12 lignes (le reste en AUTRES) */
export function buildFamRows(vn: { total: number; familles: Famille[] }, vn1: { total: number; familles: Famille[] }, max = 12): FamRow[] {
  const map1 = new Map<string, number>()
  for (const f of vn1.familles) map1.set(f.nom.toUpperCase(), f.total_montant)
  const rows: FamRow[] = vn.familles
    .map(f => {
      const caN1 = map1.has(f.nom.toUpperCase()) ? map1.get(f.nom.toUpperCase())! : null
      return { nom: f.nom, caN: f.total_montant, caN1, ecart: f.total_montant - (caN1 ?? 0) }
    })
    .sort((a, b) => b.caN - a.caN)
  if (rows.length <= max) return rows
  const head = rows.slice(0, max - 1)
  const tail = rows.slice(max - 1)
  const caN  = tail.reduce((s, r) => s + r.caN, 0)
  const caN1 = tail.reduce((s, r) => s + (r.caN1 ?? 0), 0)
  head.push({ nom: 'AUTRES FAMILLES', caN, caN1: caN1 > 0 ? caN1 : null, ecart: caN - caN1 })
  return head
}

/** Statut de semaine selon les seuils métier boucherie (analyse N vs N-1) */
export function buildStatus(caVar: number): WeekStatus {
  const v = caVar * 100
  if (v > 10)  return { label: 'SEMAINE EN FORTE PROGRESSION', color: '#2E7D32', light: '#E6F4EA', desc: 'Le CA progresse nettement par rapport à la même semaine l\'an dernier. Capitalisez sur cette dynamique : notez ce qui a changé (météo, événements, offres) pour pouvoir le reproduire.' }
  if (v > 0)   return { label: 'SEMAINE EN PROGRESSION', color: '#43A047', light: '#E6F4EA', desc: 'Le CA est en hausse par rapport à la même semaine l\'an dernier. La trajectoire est bonne : surveillez les familles en retrait pour transformer cette progression en tendance.' }
  if (v > -5)  return { label: 'SEMAINE STABLE - À SURVEILLER', color: '#D97706', light: '#FEF3C7', desc: 'Le CA est en léger retrait par rapport à la même semaine l\'an dernier. Rien d\'alarmant, mais identifiez les familles et produits qui décrochent pour réagir vite.' }
  return { label: 'SEMAINE EN RECUL', color: '#C62828', light: '#FCE8E6', desc: 'Le CA recule sensiblement par rapport à la même semaine l\'an dernier. Vérifiez la comparabilité des semaines (jours fériés, fermetures) puis concentrez-vous sur les recommandations page 7.' }
}

// Repères sectoriels de marge MATIÈRE (boucherie artisanale) — mêmes fourchettes
// que la page Facturation, pour que l'écran et le PDF racontent la même histoire.
/** Le rapport a-t-il de quoi parler d'argent ? (sinon la page affiche un mode d'emploi) */
export function hasEconomics(e: WeekEconomics | null): e is WeekEconomics {
  return !!e && (e.achats_ht > 0 || e.masse_salariale > 0 || e.charges_fixes > 0)
}

/**
 * Lecture métier de la marge — règles déterministes, pas d'appel IA : le gérant doit
 * pouvoir régénérer son rapport et retrouver exactement le même commentaire.
 * Seuils CCN/secteur : marge brute > 40 % vert, < 30 % rouge ; masse salariale
 * < 30 % vert, > 40 % rouge. Ton : on confirme et on enrichit, on ne fait pas la leçon.
 */
export function buildMargeRead(e: WeekEconomics | null, week: number): { alerts: string[]; action: string | null } {
  if (!hasEconomics(e)) return { alerts: [], action: null }
  const alerts: string[] = []
  let action: string | null = null

  const tm = e.taux_marge
  const ms = e.ratio_ms

  // Anomalie avant tout : un ratio délirant = données partielles, pas un problème de gestion
  if (ms !== null && ms > 50) {
    alerts.push(`Masse salariale à ${ms.toFixed(0)} % du CA : ce niveau traduit presque toujours une semaine incomplète (factures non saisies ou CA partiel) plutôt qu'un vrai sureffectif. Vérifiez la saisie de la semaine ${week} avant d'en tirer une conclusion.`)
  } else if (ms !== null && ms > 40) {
    alerts.push(`Masse salariale à ${ms.toFixed(0)} % du CA, au-dessus du seuil de vigilance de 40 %. Si cela se répète une deuxième semaine, c'est le signe d'un sureffectif ou d'une sous-activité.`)
  }

  if (tm !== null && tm < 30) {
    alerts.push(`Marge brute à ${tm.toFixed(1)} %, sous le plancher sectoriel de 30 %. Regardez d'abord vos prix d'achat de la semaine, puis la valorisation carcasse.`)
  } else if (tm !== null && tm >= 40 && (ms === null || ms <= 40)) {
    alerts.push(`Marge brute à ${tm.toFixed(1)} % et masse salariale maîtrisée : la structure de coûts de la semaine est saine.`)
  }

  // Famille sous son repère métier — on nomme la première concernée, chiffres à l'appui
  for (const f of e.familles) {
    const b = benchOf(f.key, f.label)
    if (b && f.taux !== null && f.ca > 0 && f.taux < b[0]) {
      alerts.push(`${f.label} ressort à ${f.taux.toFixed(1)} % de marge matière, contre ${b[0]}-${b[1]} % attendu sur ce rayon, soit ${(b[0] - f.taux).toFixed(1)} points d'écart.`)
      break
    }
  }

  // Qualité de données : ce qui empêche le calcul d'être juste passe avant le conseil
  if (e.achats_a_verifier > 0) {
    action = `Validez les ${eur0(e.achats_a_verifier)} de factures « à vérifier » dans Facturation : elles ne comptent pas encore dans ces marges.`
  } else if (e.achats_non_ventiles > 0 && e.achats_ht > 0 && e.achats_non_ventiles / e.achats_ht > 0.2) {
    action = `${eur0(e.achats_non_ventiles)} d'achats ne sont rattachés à aucun rayon. Renseignez la répartition de ces fournisseurs pour fiabiliser la marge par famille.`
  } else if (e.salaires_affectes === 0 && e.masse_salariale > 0) {
    action = `Aucune heure n'est pointée sur un poste dans le planning : les marges par famille n'incluent donc aucun salaire. Renseignez le poste sur les journées pour obtenir le taux exact par rayon.`
  } else if (e.salaires_non_affectes > e.salaires_affectes && e.masse_salariale > 0) {
    action = `La majorité des salaires (${eur0(e.salaires_non_affectes)}) n'est rattachée à aucune famille. Précisez les postes du planning pour affiner les taux par rayon.`
  } else {
    const best = [...e.familles].filter(f => f.ca > 0 && f.taux !== null).sort((a, b) => (b.taux! - a.taux!))[0]
    if (best) action = `${best.label} est votre rayon le plus rentable cette semaine (${best.taux!.toFixed(1)} % de marge matière). C'est celui à mettre en avant en vitrine la semaine prochaine.`
  }

  // Pas de sanitize() ici : ces phrases sont écrites en dur, pas générées par l'IA.
  // Le filtre anti-IA supprime tout ce qui dépasse le Latin-1 — donc le « € » (U+20AC)
  // — et remplace les guillemets français par des guillemets droits.
  return { alerts: alerts.slice(0, 3), action }
}

/** Résumé exécutif calculé (independant de l'IA — toujours disponible) */
export function buildExecSummary(data: ReportData, famRows: FamRow[], caVar: number): string {
  const fn = data.financier_n, fn1 = data.financier_n1
  const sorted = [...famRows].sort((a, b) => b.ecart - a.ecart)
  const best = sorted[0], worst = sorted[sorted.length - 1]
  const dTickets = fn.nb_tickets - fn1.nb_tickets
  const panierUp = fn.moyenne_ticket >= fn1.moyenne_ticket
  const p1 = caVar >= 0
    ? `CA de ${eur0(fn.ca_net)} sur la semaine ${data.week_number}, en progression de ${(caVar * 100).toFixed(1)}% par rapport à la même semaine ${data.year - 1}.`
    : `CA de ${eur0(fn.ca_net)} sur la semaine ${data.week_number}, en retrait de ${Math.abs(caVar * 100).toFixed(1)}% par rapport à la même semaine ${data.year - 1}.`
  const p2 = `${dTickets >= 0 ? dTickets + ' tickets de plus' : Math.abs(dTickets) + ' tickets de moins'} qu'en ${data.year - 1}, avec un panier moyen ${panierUp ? 'en hausse' : 'en baisse'} à ${eur(fn.moyenne_ticket)}.`
  const p3 = best && worst && best !== worst
    ? `${trunc(best.nom, 24)} tire la performance (${signEur(best.ecart)}) tandis que ${trunc(worst.nom, 24)} recule (${signEur(worst.ecart)}).`
    : ''
  return sanitize(`${p1} ${p2} ${p3}`.trim())
}

/** Insights via Haiku (rapide) — Sonnet depassait le budget 60s de Vercel Hobby */
export async function generateInsights(data: ReportData, famRows: FamRow[]): Promise<Insights> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })
  const fn = data.financier_n, fn1 = data.financier_n1
  const caVar = fn1.ca_net ? ((fn.ca_net - fn1.ca_net) / fn1.ca_net * 100).toFixed(1) : '0'
  const famSummary = famRows.map(f => {
    const pctCA = data.ventes_n.total ? (f.caN / data.ventes_n.total * 100).toFixed(1) : '0'
    return `${f.nom} : ${f.caN.toFixed(0)} EUR (${pctCA}% du CA), ecart N-1 : ${f.ecart >= 0 ? '+' : ''}${f.ecart.toFixed(0)} EUR`
  }).join('\n')
  const topsStr  = data.tops.slice(0, 5).map(t => `${t.designation} (+${Math.abs(t.ecart).toFixed(0)} EUR)`).join(', ')
  const flopsStr = data.flops.slice(0, 5).map(f => `${f.designation} (${f.ecart.toFixed(0)} EUR)`).join(', ')
  const r = await client.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 900,
    messages: [{ role: 'user', content: `Tu es expert en analyse de ventes pour une boucherie artisanale francaise. Ton : positif d'abord, chiffre et concret, actionnable, respectueux du metier (le boucher connait son metier, tu confirmes et enrichis).\n\nDONNEES SEMAINE ${data.week_number} (${data.period_n}) :\nCA N : ${fn.ca_net.toFixed(2)} EUR | CA N-1 : ${fn1.ca_net.toFixed(2)} EUR | Variation : ${caVar}%\nTickets N : ${fn.nb_tickets} (N-1 : ${fn1.nb_tickets}) | Panier moyen N : ${fn.moyenne_ticket.toFixed(2)} EUR (N-1 : ${fn1.moyenne_ticket.toFixed(2)} EUR)\n\nVENTES PAR FAMILLE :\n${famSummary}\n\nTOP PRODUITS EN PROGRESSION : ${topsStr || 'n/a'}\nPRODUITS EN BAISSE : ${flopsStr || 'n/a'}\n\nRappels metier : une semaine avec jour ferie fait mecaniquement -15 a -20% de CA ; saisonnalite boucherie (pic Paques S15-16, ete, fetes S50-51, creux janvier-fevrier) ; le traiteur a la meilleure marge (50-65%) ; variation > +-25% sans explication saisonniere = a investiguer.\n\nRetourne UNIQUEMENT ce JSON :\n{"resume":"2 phrases max qui resument la semaine","insights":["insight 1","insight 2","insight 3","insight 4","insight 5"],"vigilance":["point de vigilance 1","point de vigilance 2"],"recommendations":["reco 1","reco 2","reco 3"]}\n\nInsights : faits precis avec chiffres (une phrase chacun). Vigilance : risques ou anomalies a surveiller (2 max, une phrase). Recommandations : actions concretes de boucherie pour la semaine prochaine, la premiere etant LA priorite. Tout en francais.` }],
  })
  try {
    const parsed = JSON.parse(extractJSONObject(r.content[0].type === 'text' ? r.content[0].text : ''))
    return {
      resume:          sanitize(parsed.resume || ''),
      insights:        (parsed.insights || []).slice(0, 5).map(sanitize).filter(Boolean),
      vigilance:       (parsed.vigilance || []).slice(0, 2).map(sanitize).filter(Boolean),
      recommendations: (parsed.recommendations || []).slice(0, 3).map(sanitize).filter(Boolean),
    }
  } catch {
    return {
      resume: 'Analyse indisponible cette semaine.',
      insights: ['Analyse non disponible.'],
      vigilance: [],
      recommendations: ['Contactez votre conseiller PILOTE.'],
    }
  }
}
