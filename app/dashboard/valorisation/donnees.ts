// Valorisation carcasse — le SOCLE de l'écran : les types manipulés par la page,
// les données de races et d'espèces, et les fonctions pures (formatage, semaine
// ISO, arborescence de découpe, main d'œuvre du planning, préférences locales).
// Sorti de page.tsx au lot 74 pour que la page reste sous le plafond de
// publication : aucun état React ici, rien que des constantes et des calculs.

import {
  BOEUF_ALL_CUTS, VEAU_CUTS, AGNEAU_CUTS, PORC_CUTS,
  type AnimalType, type Cut, type CutCategory,
} from '@/lib/valorisation'

// ─── Types ──────────────────────────────


export interface Breed { id: string; name: string; carcassYield: number; avgWeight: string; origin: string; description: string }
export interface CutResult { cut: Cut; weight: number; sellingPrice: number; revenue: number; active: boolean }
export interface SavedValo {
  id: string; breed_id: string; breed_name: string; live_weight: number; quantity: number
  purchase_per_kg: number; overhead_cost: number; labor_cost: number; target_margin: number
  purchase_date: string; notes?: string; carcass_weight: number; total_cost: number
  total_revenue: number; margin_rate: number; coefficient: number; created_at: string
  animal_type?: string
}
export interface WeekStats {
  key: string; label: string; week: number; year: number
  count: number; lots: number; totalCost: number; totalRevenue: number; marginRate: number; breeds: string[]
}
export interface AnimalConfig {
  label: string; emoji: string; accent: string; breedLabel: string
  breeds: Breed[]; cuts: Cut[]
  defaultWeight: string; defaultPurchaseKg: string; defaultLabor: string
}
export interface WeekLabor { hours: number; cost: number; rate: number; decoupeHours: number; decoupeCost: number; week: number; year: number }

// ─── Données Bœuf ──────────────────────

const BOEUF_BREEDS: Breed[] = [
  { id: 'charolaise',       name: 'Charolaise',         carcassYield: 0.645, avgWeight: '750-950 kg',  origin: 'Bourgogne',        description: 'Race à viande n°1 en France. Masses musculaires très développées. Viande ferme, peu persillée, idéale pour pièces à griller et rôtir.' },
  { id: 'limousine',        name: 'Limousine',          carcassYield: 0.655, avgWeight: '650-850 kg',  origin: 'Limousin',         description: 'Meilleur rendement en muscles nobles toutes races confondues. Grain fin, couleur rouge vif. Conformation E.' },
  { id: 'parthenaise',      name: 'Parthenaise',        carcassYield: 0.650, avgWeight: '650-850 kg',  origin: 'Poitou (Deux-Sèvres)', description: 'Race bouchère d\'exception : rendement carcasse parmi les meilleurs, viande fine à grain serré, tendre et colorée, très faible gras. Label Rouge.' },
  { id: 'blonde_aquitaine', name: "Blonde d'Aquitaine", carcassYield: 0.640, avgWeight: '750-950 kg',  origin: 'Sud-Ouest',        description: 'Viande maigre et tendre, bonne conformation E-U. Rendement élevé en pièces nobles.' },
  { id: 'salers',           name: 'Salers',             carcassYield: 0.600, avgWeight: '600-750 kg',  origin: 'Auvergne',         description: 'Race rustique de montagne. Viande goûteuse et légèrement persillée.' },
  { id: 'aubrac',           name: 'Aubrac',             carcassYield: 0.578, avgWeight: '550-700 kg',  origin: 'Aveyron-Lozère',   description: 'Viande bien persillée, saveur prononcée et fondante. Qualité gustative remarquable.' },
  { id: 'normande',         name: 'Normande',           carcassYield: 0.555, avgWeight: '600-750 kg',  origin: 'Normandie',        description: 'Race mixte lait et viande. Viande marbrée, persillage notable, saveur riche.' },
  { id: 'maine_anjou',      name: 'Maine-Anjou',        carcassYield: 0.625, avgWeight: '800-1000 kg', origin: 'Pays de la Loire', description: 'Grosse race mixte. Viande marbrée et savoureuse, très appréciée pour les grandes pièces.' },
  { id: 'angus',            name: 'Aberdeen Angus',     carcassYield: 0.578, avgWeight: '600-750 kg',  origin: 'Écosse/France',    description: 'Persillage exceptionnel dit marbré, viande fondante et savoureuse. Segment premium.' },
  { id: 'hereford',         name: 'Hereford',           carcassYield: 0.565, avgWeight: '550-700 kg',  origin: 'Angleterre/France', description: 'Viande bien persillée, tendre et goûteuse. Qualité constante, appréciée des bouchers exigeants.' },
]


// ── Arborescence de découpe (dérivée du champ `group`) ──
export interface TreeNode { name: string; path: string; children: TreeNode[]; cut?: Cut }
export function buildCutTree(cuts: Cut[]): TreeNode[] {
  const roots: TreeNode[] = []
  const byPath = new Map<string, TreeNode>()
  for (const cut of cuts) {
    const names = cut.group ?? []
    let list = roots
    let acc = ''
    for (const nm of names) {
      acc = acc ? `${acc} / ${nm}` : nm
      let node = byPath.get(acc)
      if (!node) { node = { name: nm, path: acc, children: [] }; byPath.set(acc, node); list.push(node) }
      list = node.children
    }
    list.push({ name: cut.name, path: `${acc} / ${cut.name}`, children: [], cut })
  }
  return roots
}
export function collectLeafCuts(node: TreeNode): Cut[] {
  return node.cut ? [node.cut] : node.children.flatMap(collectLeafCuts)
}

// ─── Données Veau ───────────────────────

const VEAU_BREEDS: Breed[] = [
  { id: 'veau_lait_limousin', name: 'Veau de lait Limousin',   carcassYield: 0.62, avgWeight: '160-200 kg', origin: 'Limousin',  description: 'Label Rouge. Élevé sous la mère. Chair rose pâle, très tendre et fine. Le standard haut de gamme.' },
  { id: 'veau_grain',         name: 'Veau de grain (breton)',  carcassYield: 0.59, avgWeight: '180-240 kg', origin: 'Bretagne',  description: 'Nourri aux céréales. Viande rosée légèrement plus colorée. Excellent rapport qualité/prix.' },
  { id: 'veau_rose',          name: 'Veau rosé nature',        carcassYield: 0.57, avgWeight: '200-260 kg', origin: 'France',    description: 'Élevé en plein air. Bon équilibre entre tendreté et saveur. Viande rose.' },
  { id: 'veau_lourd',         name: 'Veau lourd finition',     carcassYield: 0.60, avgWeight: '250-300 kg', origin: 'France',    description: 'Animal plus âgé, viande légèrement plus ferme et goûteuse. Fort rendement.' },
  { id: 'veau_blanc_fermier', name: 'Veau blanc fermier IGP',  carcassYield: 0.63, avgWeight: '170-220 kg', origin: 'Aveyron',   description: 'IGP. Élevé sous la mère, lait fermier. Viande très blanche, extrêmement tendre. Produit premium.' },
]

// ─── Données Agneau ───────────────────────

const AGNEAU_BREEDS: Breed[] = [
  { id: 'berrichon',         name: 'Berrichon du Cher',          carcassYield: 0.50, avgWeight: '35-45 kg', origin: 'Centre-Val de Loire', description: 'Race bouchère par excellence. Gigot charnu, viande tendre et rosée. Label Rouge Agneau du Berry.' },
  { id: 'ile_france_agneau', name: 'Île-de-France',              carcassYield: 0.48, avgWeight: '35-50 kg', origin: 'Bassin parisien',     description: 'Très bonne conformation. Viande fine et savoureuse, légèrement persillée.' },
  { id: 'suffolk',           name: 'Suffolk',                    carcassYield: 0.52, avgWeight: '40-55 kg', origin: 'Grande-Bretagne',     description: 'Excellente conformation bouchère. Viande ferme et goûteuse, bon rendement.' },
  { id: 'charollais_agneau', name: 'Charollais',                 carcassYield: 0.50, avgWeight: '38-48 kg', origin: 'Bourgogne',           description: 'Excellent qualité bouchère. Masse musculaire développée, viande tendre.' },
  { id: 'texel',             name: 'Texel',                      carcassYield: 0.53, avgWeight: '40-55 kg', origin: 'Pays-Bas/France',     description: 'Meilleur rendement en viande maigre. Pièces bien conformées.' },
  { id: 'lacaune',           name: 'Lacaune',                    carcassYield: 0.45, avgWeight: '30-40 kg', origin: 'Tarn-Aveyron',        description: 'Race mixte lait/viande. Viande plus maigre, qualité régulière.' },
  { id: 'agneau_lait',       name: 'Agneau de lait Pyrénées',    carcassYield: 0.56, avgWeight: '12-18 kg', origin: 'Pyrénées',            description: 'Très jeune animal, viande blanche rosée, texture fondante. Produit de fête, prix premium.' },
]

// ─── Données Porc ─────────────────────────

const PORC_BREEDS: Breed[] = [
  { id: 'large_white',       name: 'Large White',          carcassYield: 0.77, avgWeight: '100-120 kg', origin: 'Bretagne/National', description: 'Race dominante en France. Très bon rendement. Viande maigre et tendre, idéale pour jambons et filets.' },
  { id: 'pietrain',          name: 'Piétrain',             carcassYield: 0.79, avgWeight: '95-115 kg',  origin: 'Belgique/France',  description: 'Rendement exceptionnel en longe et jambon. Viande très maigre, légèrement plus ferme.' },
  { id: 'duroc_porc',        name: 'Duroc',                carcassYield: 0.74, avgWeight: '100-125 kg', origin: 'USA/France',        description: 'Viande bien persillée et savoureuse. Couleur plus rosée. Appréciée pour la charcuterie artisanale.' },
  { id: 'cul_noir_limousin', name: 'Cul Noir du Limousin', carcassYield: 0.72, avgWeight: '90-120 kg',  origin: 'Limousin',         description: 'Race rustique. Viande très marbrée, saveur exceptionnelle. Idéal pour charcuteries fines.' },
  { id: 'noir_bigorre',      name: 'Noir de Bigorre AOP',  carcassYield: 0.72, avgWeight: '110-140 kg', origin: 'Pyrénées',         description: 'AOP. Élevage 12 mois min. Viande persillée, jambon sec exceptionnel. Haut de gamme.' },
  { id: 'cochon_bayeux',     name: 'Cochon de Bayeux',     carcassYield: 0.71, avgWeight: '100-130 kg', origin: 'Normandie',        description: 'Ancienne race normande. Lard abondant, viande goûteuse. Parfait pour rillettes et jambon braisé.' },
]

// (La volaille a quitté la valorisation le 10/08/2026 — un boucher ne découpe
//  pas de carcasse de volaille ; elle se vend prête, via mercuriale et rayons.)

// ─── Config espèces ─── poids et prix par défaut exprimés en CARCASSE ───────────

export const ANIMALS: Record<AnimalType, AnimalConfig> = {
  boeuf:    { label: 'Bœuf',    emoji: '🐄', accent: 'red',    breedLabel: 'Race bovine',   breeds: BOEUF_BREEDS,    cuts: BOEUF_ALL_CUTS, defaultWeight: '520', defaultPurchaseKg: '6.00',  defaultLabor: '150' },
  veau:     { label: 'Veau',    emoji: '🐮', accent: 'pink',   breedLabel: 'Type de veau',  breeds: VEAU_BREEDS,     cuts: VEAU_CUTS,     defaultWeight: '125', defaultPurchaseKg: '9.00',  defaultLabor: '80'  },
  agneau:   { label: 'Agneau',  emoji: '🐑', accent: 'green',  breedLabel: 'Race ovine',    breeds: AGNEAU_BREEDS,   cuts: AGNEAU_CUTS,   defaultWeight: '20',  defaultPurchaseKg: '10.00', defaultLabor: '30'  },
  porc:     { label: 'Porc',    emoji: '🐖', accent: 'orange', breedLabel: 'Race porcine',  breeds: PORC_BREEDS,     cuts: PORC_CUTS,     defaultWeight: '85',  defaultPurchaseKg: '2.90',  defaultLabor: '60'  },
}

export const ANIMAL_TYPES: AnimalType[] = ['boeuf', 'veau', 'agneau', 'porc']

// ─── Catégories ────────────────────────

export const CATEGORY_LABELS: Record<CutCategory, string> = {
  premier: '1er choix', deuxieme: '2e choix',
  troisieme: 'Divers', abat: 'Abats', os: 'Os valorisables',
}
export const CATEGORY_COLORS: Record<CutCategory, string> = {
  premier: 'bg-pilote text-white border-transparent', deuxieme: 'bg-pilote-100 text-pilote-800 border-pilote-200',
  troisieme: 'bg-pilote-50 text-pilote-800 border-pilote-200', abat: 'bg-orange-50 text-orange-700 border-orange-200', os: 'bg-gray-100 text-gray-600 border-gray-200',
}
export const CATEGORIES: CutCategory[] = ['premier', 'deuxieme', 'troisieme', 'abat', 'os']
const MONTHS_FR = ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Aoû','Sep','Oct','Nov','Déc']

/** Un poids en kilos, lisible : « 133 kg », « 2,4 kg ». */
export function fmtKg(n: number) { return `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} kg` }

export function eur(n: number) { return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }) }
export function kgStr(n: number) { return n.toFixed(1) + ' kg' }

export function getISOWeek(dateStr: string): { week: number; year: number } {
  const d = new Date(dateStr)
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return { week: weekNo, year: date.getUTCFullYear() }
}

export function makeWeekLabel(week: number, year: number): string {
  const jan4 = new Date(year, 0, 4)
  const dayOfWeek = jan4.getDay() || 7
  const weekStart = new Date(jan4.getTime() - (dayOfWeek - 1) * 86400000 + (week - 1) * 7 * 86400000)
  return `S${week} ${year}  ·  ${weekStart.getDate()} ${MONTHS_FR[weekStart.getMonth()]}`
}

// ─── Main d'œuvre boucherie depuis le planning ─────────────

const JOURS_PLANNING = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']

function timeToHours(t?: string): number | null {
  if (!t) return null
  const trimmed = String(t).trim()
  const hIdx = trimmed.indexOf('h')
  if (hIdx === -1) {
    const n = parseFloat(trimmed)
    return isNaN(n) ? null : n
  }
  const h = parseInt(trimmed.slice(0, hIdx)) || 0
  const mStr = trimmed.slice(hIdx + 1)
  const m = mStr ? parseInt(mStr) || 0 : 0
  return h + m / 60
}

function slotHours(debut?: string, fin?: string): number {
  const s = timeToHours(debut)
  const e = timeToHours(fin)
  if (s === null || e === null || e <= s) return 0
  return e - s
}

/** Heures et coût CHARGÉ de la main d'œuvre "boucherie" du planning de la semaine.
 *  `decoupeHours` / `decoupeCost` : uniquement le temps de découpe saisi dans le planning
 *  (champ « Découpe » du poste boucherie) — c'est ce qui est imputé à la valorisation. */
export function computeBoucherieLabor(entries: any[], emps: any[]): { hours: number; cost: number; decoupeHours: number; decoupeCost: number } {
  const empMap = new Map(emps.map((e: any) => [e.id, e]))
  let hours = 0, cost = 0, decoupeHours = 0, decoupeCost = 0
  for (const en of entries) {
    const emp: any = empMap.get(en.employee_id)
    if (!emp) continue
    const rate = (Number(emp.hourly_rate) || 0) * (1 + (Number(emp.charges_patronales ?? 45) / 100))
    const sds = en.schedule_details || {}
    for (const j of JOURS_PLANNING) {
      const t = en[`${j}_type`] || 'travail'
      if (t !== 'travail') continue
      const sd = sds[j] || {}
      const catM = sd.categorie_matin || sd.categorie
      const catA = sd.categorie_apmidi || sd.categorie
      const isBoucherie = catM === 'boucherie' || catA === 'boucherie' || sd.categorie === 'boucherie'
      const m = slotHours(sd.matin_debut, sd.matin_fin)
      const a = slotHours(sd.apmidi_debut, sd.apmidi_fin)
      let h = 0
      if (catM === 'boucherie') h += m
      if (catA === 'boucherie') h += a
      // Poste boucherie sur la journée sans horaires détaillés : on prend les heures du jour
      if (h === 0 && m === 0 && a === 0 && sd.categorie === 'boucherie') h = Number(en[j]) || 0
      hours += h
      cost  += h * rate
      // Temps de découpe explicite en MINUTES (champ dédié du planning)
      const dMin = isBoucherie ? (parseFloat(sd.decoupe) || 0) : 0
      decoupeHours += dMin
      decoupeCost  += (dMin / 60) * rate
    }
  }
  return { hours, cost, decoupeHours, decoupeCost }
}

// ─── Préférences par famille (catégories cochées + pièces retirées), persistées en localStorage ─

export type CatsByAnimal = Record<AnimalType, CutCategory[]>
export type CutsByAnimal = Record<AnimalType, string[]>

export const DEFAULT_CATS = (): CatsByAnimal => ({
  boeuf: [...CATEGORIES], veau: [...CATEGORIES], agneau: [...CATEGORIES], porc: [...CATEGORIES],
})
export const DEFAULT_EXCLUDED = (): CutsByAnimal => ({
  boeuf: [], veau: [], agneau: [], porc: [],
})
// Prix de référence personnalisés par pièce (surcharge le prix indicatif), mémorisés par famille
// (Un localStorage d'avant le 10/08/2026 peut porter une clé `volaille` en trop :
//  le spread de `loadPref` la laisse passer, elle est morte et sans effet.)
export type PricesByAnimal = Record<AnimalType, Record<string, string>>
export const DEFAULT_PRICES = (): PricesByAnimal => ({
  boeuf: {}, veau: {}, agneau: {}, porc: {},
})

export function loadPref<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    return { ...fallback, ...JSON.parse(raw) }
  } catch { return fallback }
}

/** Supabase renvoie les colonnes numeric en chaînes — normalise une valorisation en nombres */
export function normalizeValo(v: any): SavedValo {
  return {
    ...v,
    live_weight:     Number(v.live_weight)     || 0,
    quantity:        Number(v.quantity)        || 1,
    purchase_per_kg: Number(v.purchase_per_kg) || 0,
    overhead_cost:   Number(v.overhead_cost)   || 0,
    labor_cost:      Number(v.labor_cost)      || 0,
    target_margin:   Number(v.target_margin)   || 0,
    carcass_weight:  Number(v.carcass_weight)  || 0,
    total_cost:      Number(v.total_cost)      || 0,
    total_revenue:   Number(v.total_revenue)   || 0,
    margin_rate:     Number(v.margin_rate)     || 0,
    coefficient:     Number(v.coefficient)     || 1,
  }
}

/** Brouillon de saisie : la valorisation en cours survit à la navigation (localStorage) */
export function loadDraft(): Record<string, any> {
  if (typeof window === 'undefined') return {}
  try { return JSON.parse(window.localStorage.getItem('valo_draft_v1') || '{}') || {} } catch { return {} }
}
