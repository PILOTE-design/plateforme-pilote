// Lecture des 4 PDF Crisalid et extraction des données (Haiku + garde-fous
// déterministes). `extractJSONObject` est exporté : report-compute s'en sert aussi
// pour lire la réponse des insights.
import Anthropic from '@anthropic-ai/sdk'
import type { Famille, FinancierData, ExtractedData, Produit } from './report-types'

// ─── Data extraction ─────────────────────────────────────────────────────────

export async function parsePDF(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer())
  const _m = await import('pdf-parse') as any
  const fn = typeof _m.default === 'function' ? _m.default : _m
  if (typeof fn !== 'function') throw new Error('pdf-parse not callable')
  const data = await fn(buffer)
  return data.text
}

export function extractJSONObject(text: string): string {
  const start = text.indexOf('{')
  if (start === -1) throw new Error('No JSON object found in response')
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(start, i + 1) }
  }
  throw new Error('Unclosed JSON')
}

// Coercition robuste : l'IA peut renvoyer null/chaines si le mauvais fichier est
// fourni — on ne laisse JAMAIS un null atteindre .toFixed
function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}
function cleanFin(f: any): FinancierData {
  return {
    ca_net: toNum(f?.ca_net),
    nb_tickets: Math.round(toNum(f?.nb_tickets)),
    moyenne_ticket: toNum(f?.moyenne_ticket),
  }
}

async function extractFinancials(fin_n: string, fin_n1: string): Promise<{
  period_n: string; period_n1: string; week_number: number; year: number
  financier_n: FinancierData; financier_n1: FinancierData
}> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })
  const r = await client.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 512,
    messages: [{ role: 'user', content: 'Extrais les donnees financieres CRISALID. Retourne UNIQUEMENT ce JSON:\n{"period_n":"15-21 juin 2026","period_n1":"16-22 juin 2025","week_number":25,"year":2026,"financier_n":{"ca_net":20742.43,"nb_tickets":496,"moyenne_ticket":41.82},"financier_n1":{"ca_net":19316.76,"nb_tickets":453,"moyenne_ticket":42.64}}\n\n=== FINANCIER N ===\n' + fin_n.slice(0, 3000) + '\n=== FINANCIER N-1 ===\n' + fin_n1.slice(0, 3000) }],
  })
  return JSON.parse(extractJSONObject(r.content[0].type === 'text' ? r.content[0].text : ''))
}

// ─── Semaine ISO deterministe ─────────────────────────────────────────────────
// La semaine du rapport est TOUJOURS calculee en code a partir des dates de la
// periode extraite (ex: "29 juin - 5 juillet 2026" => S27), jamais par l'IA.

const MONTHS_FR: Record<string, number> = {
  janvier: 0, fevrier: 1, mars: 2, avril: 3, mai: 4, juin: 5,
  juillet: 6, aout: 7, septembre: 8, octobre: 9, novembre: 10, decembre: 11,
}

function isoWeekOf(d: Date): { week: number; year: number } {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return { week: Math.ceil((((t.getTime() - yearStart.getTime()) / 86400000) + 1) / 7), year: t.getUTCFullYear() }
}

export function weekFromPeriod(period: string): { week: number; year: number } | null {
  try {
    const p = (period || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    const years = p.match(/20\d{2}/g) || []
    const firstYear = years[0]
    if (!firstYear) return null
    let year = parseInt(firstYear)
    const dayMatch = p.match(/(\d{1,2})(?!\d)/)
    if (!dayMatch) return null
    const day = parseInt(dayMatch[1])
    if (day < 1 || day > 31) return null
    // Premier nom de mois present dans la chaine = mois du jour de debut
    let monthIdx: number | null = null
    let firstPos = Infinity
    for (const [name, idx] of Object.entries(MONTHS_FR)) {
      const pos = p.indexOf(name)
      if (pos !== -1 && pos < firstPos) { firstPos = pos; monthIdx = idx }
    }
    if (monthIdx === null) return null
    // Periode dec -> janv ou seule l'annee de fin est affichee
    if (years.length === 1 && monthIdx === 11 && p.includes('janv')) year -= 1
    const start = new Date(Date.UTC(year, monthIdx, day))
    if (isNaN(start.getTime())) return null
    return isoWeekOf(start)
  } catch {
    return null
  }
}

function parseNum(s: string): number {
  return parseFloat(s.trim().replace(/\s/g, '').replace(',', '.')) || 0
}

async function extractVentesData(ventes_text: string): Promise<{ total: number; familles: Famille[]; notes: string[] }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })
  const r = await client.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 1024,
    // Slice 12000 chars pour capturer TOUTES les familles (pas seulement les grandes)
    messages: [{ role: 'user', content: `Extrais les totaux par famille du fichier CRISALID.\nRetourne UNIQUEMENT ces lignes (une par ligne):\nTOTAL|20742.43\nVIANDE DE BOEUF|1|3081.17\nCHARCUTERIE|2|2500.00\n\nFormat: 1ere ligne TOTAL|montant, puis NOM|ID|montant par famille. Point comme separateur decimal. Montant = CA en euros de la PERIODE uniquement (jamais cumul annuel, jamais quantites, jamais code PLU) ; un montant de famille ne depasse jamais le TOTAL.\n\n${ventes_text.slice(0, 12000)}` }],
  })
  const text = r.content[0].type === 'text' ? r.content[0].text.trim() : ''
  const lines = text.split('\n').map((l: string) => l.trim()).filter((l: string) => l)
  let total = 0
  const familles: Famille[] = []
  for (const line of lines) {
    const parts = line.split('|')
    if (parts[0].toUpperCase() === 'TOTAL' && parts[1]) total = parseNum(parts[1])
    else if (parts.length >= 3) {
      const montant = parseNum(parts[2])
      if (montant > 0) familles.push({ id: parts[1]?.trim() || String(familles.length + 1), nom: parts[0].trim(), total_montant: montant, produits: [] })
    }
  }
  // ── Garde-fous deterministes anti-aberrations (ex. epicerie a 6 chiffres sur une petite semaine) ──
  // Un montant de famille ne peut jamais depasser le CA total de la periode. Erreurs classiques
  // d'extraction : virgule decimale perdue (x100), separateur de milliers avale (x1000),
  // colonne cumul annuel ou code PLU pris pour un montant -> corrige ou ecarte.
  // Chaque correction est NOTEE (plus jamais un simple console.warn) : le controle
  // `corrections_extraction` met alors l'extraction en statut « a valider ».
  const cleaned: Famille[] = []
  const notes: string[] = []
  for (const f of familles) {
    let m = f.total_montant
    if (total > 0 && m > total * 1.005) {
      if (m / 100 <= total * 1.005) m = Math.round(m) / 100
      else if (m / 1000 <= total * 1.005) m = Math.round(m) / 1000
      else {
        console.warn('[ventes] famille ecartee (montant aberrant):', f.nom, f.total_montant, '> CA total', total)
        notes.push(`Famille « ${f.nom} » écartée : montant lu ${f.total_montant} supérieur au CA total ${total}.`)
        continue
      }
      console.warn('[ventes] montant corrige (decimale perdue):', f.nom, f.total_montant, '->', m)
      notes.push(`Famille « ${f.nom} » : montant corrigé de ${f.total_montant} à ${m} (décimale perdue présumée).`)
    }
    cleaned.push({ ...f, total_montant: m })
  }
  return { total, familles: cleaned, notes }
}

/** Extrait le CA TOTAL par produit d'un fichier ventes CRISALID.
 *  IMPORTANT : on extrait N et N-1 séparément puis on calcule les écarts en code —
 *  l'IA ne fait AUCUNE comparaison ni aucun calcul.
 *  PERF : plafonne aux ~60 plus gros produits (max_tokens 2200) pour tenir sous les 60s Vercel. */
async function extractProductAmounts(text: string): Promise<{ amounts: Map<string, number>; familles: Map<string, string> }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })
  const r = await client.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 2600,
    messages: [{ role: 'user', content: `Extrais du fichier de ventes CRISALID, pour CHAQUE produit de la semaine : sa FAMILLE (rayon) et son CA TOTAL.\n` +
      `ATTENTION CRITIQUE : le montant a extraire est le MONTANT TOTAL en euros des ventes du produit (colonne montant/total/CA), JAMAIS le prix unitaire, JAMAIS le prix au kilo, JAMAIS la quantite.\n` +
      `La FAMILLE est le rayon/la categorie sous laquelle le produit est regroupe dans le fichier (ex : BOUCHERIE, CHARCUTERIE, VOLAILLE, TRAITEUR, PLATS CUISINES...). Reprends le nom de famille exact du fichier.\n` +
      `Un produit courant fait typiquement des dizaines a des centaines d'euros de CA hebdomadaire.\n` +
      `Ignore les lignes de famille/sous-total/total general : uniquement les produits individuels.\n` +
      `Limite-toi aux 60 produits au plus gros CA (ignore les tout petits montants).\n` +
      `Retourne UNIQUEMENT des lignes au format NOM|FAMILLE|MONTANT (point decimal, une ligne par produit, aucun autre texte) :\n` +
      `STEAK HACHE|BOUCHERIE|412.35\nROTI DE PORC|BOUCHERIE|187.20\nSAUCISSON SEC|CHARCUTERIE|96.40\n\n${text.slice(0, 12000)}` }],
  })
  const amounts = new Map<string, number>()
  const familles = new Map<string, string>()
  const raw = r.content[0].type === 'text' ? r.content[0].text : ''
  for (const line of raw.split('\n')) {
    const parts = line.trim().split('|')
    if (parts.length < 2) continue
    const name = parts[0].trim().toUpperCase()
    // Format NOM|FAMILLE|MONTANT ; repli sur l'ancien NOM|MONTANT si 2 colonnes
    const famille = parts.length >= 3 ? parts[1].trim().toUpperCase() : ''
    const amount = parseNum(parts.length >= 3 ? parts[2] : parts[1])
    if (name && name !== 'TOTAL' && amount > 0) {
      amounts.set(name, (amounts.get(name) ?? 0) + amount)
      if (famille && !familles.has(name)) familles.set(name, famille)
    }
  }
  return { amounts, familles }
}

/** Calcule les tops/flops en code a partir des CA produits N et N-1 (zero IA, zero erreur de calcul) */
/** Un produit absent d'une des deux listes vaut-il vraiment zéro, ou n'a-t-il simplement
 *  pas été lu ? L'extraction produit est plafonnée (slice + max_tokens) : sur un fichier
 *  fourni, les produits de fin de liste tombent hors champ. Traiter cette absence comme
 *  un zéro fabrique de fausses progressions à +100 % et de fausses baisses — et l'analyse
 *  IA, qui lit ces classements, part alors enquêter sur un problème inexistant.
 *
 *  Règle : une extraction est jugée COMPLÈTE si la somme des produits lus couvre au moins
 *  70 % du CA de la période. En dessous, on sait qu'on n'a pas tout vu, et le classement se
 *  limite aux produits présents des DEUX côtés — comparables à coup sûr. */
const COUVERTURE_MIN = 0.7

function couvertureOk(prod: Map<string, number>, caPeriode: number): boolean {
  if (caPeriode <= 0) return true
  let somme = 0
  for (const v of prod.values()) somme += v
  return somme >= caPeriode * COUVERTURE_MIN
}

function computeTopFlop(
  prodN: Map<string, number>,
  prodN1: Map<string, number>,
  caN = 0,
  caN1 = 0,
): {
  tops: { designation: string; n: number; ecart: number }[]
  flops: { designation: string; n: number; ecart: number }[]
} {
  // Les nouveautés et les arrêts ne sont crédibles que si les deux listes sont complètes.
  const completeN = couvertureOk(prodN, caN)
  const completeN1 = couvertureOk(prodN1, caN1)
  if (!completeN || !completeN1) {
    console.warn('[topflop] extraction produit partielle (N complet:', completeN, ', N-1 complet:', completeN1,
      ') - classement limite aux produits presents des deux cotes')
  }
  const names = new Set<string>([...prodN.keys(), ...prodN1.keys()])
  const diffs: { designation: string; n: number; ecart: number }[] = []
  for (const name of names) {
    const vuN = prodN.has(name), vuN1 = prodN1.has(name)
    if (!vuN && !completeN) continue    // absent côté N, mais N est tronqué -> indécidable
    if (!vuN1 && !completeN1) continue  // absent côté N-1, mais N-1 est tronqué -> indécidable
    const n  = prodN.get(name)  ?? 0
    const n1 = prodN1.get(name) ?? 0
    diffs.push({ designation: name, n, ecart: +(n - n1).toFixed(2) })
  }
  const tops  = diffs.filter(d => d.ecart > 0).sort((a, b) => b.ecart - a.ecart).slice(0, 10)
  const flops = diffs.filter(d => d.ecart < 0).sort((a, b) => a.ecart - b.ecart).slice(0, 10)
  return { tops, flops }
}

export async function extractData(texts: { fin_n: string; fin_n1: string; ventes_n: string; ventes_n1: string }): Promise<ExtractedData> {
  const [financials, ventes_n, ventes_n1, prodRes, prodRes1] = await Promise.all([
    extractFinancials(texts.fin_n, texts.fin_n1),
    extractVentesData(texts.ventes_n),
    extractVentesData(texts.ventes_n1),
    extractProductAmounts(texts.ventes_n),
    extractProductAmounts(texts.ventes_n1),
  ])
  const prodN = prodRes.amounts, prodN1 = prodRes1.amounts
  const prodFamN = prodRes.familles, prodFamN1 = prodRes1.familles

  // Le CA d'une semaine est lu DEUX fois, dans deux fichiers différents : `ca_net` dans
  // le relevé financier, `total` dans les ventes par familles. Ce sont censément le même
  // chiffre, et ils étaient affichés côte à côte sur la page 2 sans jamais être recoupés.
  // Sur un rapport réel : KPI « CA N-1 : 15 843 € » et « TOTAL GENERAL : 11 584 € » —
  // 4 259 € d'écart, sous les yeux du client, avec deux variations contradictoires.
  //
  // Le relevé financier fait foi (c'est la caisse). Le total du fichier ventes n'est
  // gardé que s'il concorde ; sinon on recalcule la somme des familles réellement lues,
  // et à défaut on reprend le CA caisse. Aucune de ces valeurs n'est inventée.
  // La bascule n'est plus silencieuse : elle est notee et fera passer
  // l'extraction en statut « a valider » (controle corrections_extraction).
  const notes: string[] = [...ventes_n.notes, ...ventes_n1.notes]
  const reconcile = (v: { total: number; familles: Famille[] }, caCaisse: number, label: string) => {
    if (!(caCaisse > 0)) return v
    const ecart = Math.abs(v.total - caCaisse) / caCaisse
    if (ecart <= 0.02) return v
    const sommeFamilles = v.familles.reduce((s, f) => s + f.total_montant, 0)
    const ecartSomme = Math.abs(sommeFamilles - caCaisse) / caCaisse
    const retenu = ecartSomme < ecart ? sommeFamilles : caCaisse
    console.warn(`[ventes ${label}] total extrait ${v.total} incoherent avec le CA caisse ${caCaisse}`
      + ` (somme des familles ${sommeFamilles.toFixed(2)}) -> total retenu ${retenu.toFixed(2)}`)
    notes.push(`Total ventes ${label} : ${v.total.toFixed(2)} incohérent avec le CA caisse ${caCaisse.toFixed(2)} (somme des familles ${sommeFamilles.toFixed(2)}) — total retenu ${retenu.toFixed(2)}.`)
    return { ...v, total: retenu }
  }
  const finN = cleanFin(financials.financier_n)
  const finN1 = cleanFin(financials.financier_n1)
  const ventesN = reconcile(ventes_n, finN.ca_net, 'N')
  const ventesN1 = reconcile(ventes_n1, finN1.ca_net, 'N-1')

  const topFlop = computeTopFlop(prodN, prodN1, ventesN.total, ventesN1.total)
  // Semaine ISO recalculee en code depuis les dates de la periode
  const isoFixed = weekFromPeriod(String(financials.period_n || ''))
  return {
    period_n: String(financials.period_n || ''), period_n1: String(financials.period_n1 || ''),
    week_number: isoFixed?.week ?? toNum(financials.week_number),
    year: isoFixed?.year ?? toNum(financials.year),
    financier_n: finN, financier_n1: finN1,
    ventes_n: { total: ventesN.total, familles: ventesN.familles },
    ventes_n1: { total: ventesN1.total, familles: ventesN1.familles },
    tops: topFlop.tops, flops: topFlop.flops,
    prodN, prodN1, prodFamN, prodFamN1,
    notes,
  }
}
