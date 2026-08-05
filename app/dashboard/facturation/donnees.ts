// Facturation — les DONNÉES DE FORME de l'écran (les types des objets rendus
// par l'API), les constantes et les fonctions pures. Sorti de page.tsx pour que
// la page tienne sous le plafond de publication : elle garde ses états, ses
// appels API et ses gestes, ce fichier ne fait que décrire.

import type { RecurringCharge, Periodicity } from '@/lib/recurring-charges'
import type { DoubleEmploiVu } from '@/lib/charges-doublon'
import { labelsMatch, MATIERE_BENCH } from '@/lib/postes'


/** Une charge récurrente TELLE QUE L'API LA REND : la définition, plus le
 *  contrôle de cohérence avec les achats (cf. lib/charges-doublon). Le champ
 *  est optionnel — un moteur qui ne le calcule pas ne casse rien. */
export type ChargeVue = RecurringCharge & { double_emploi?: DoubleEmploiVu | null }

// ─── Types ──────────────────

export type Invoice = {
  id: string; supplier_name: string; invoice_number?: string; invoice_date: string
  category: string; amount_ht: number; tva_rate: number; amount_ttc: number
  notes?: string; week_number: number; year: number
  is_fixed_charge?: boolean; period_days?: number | null; prorata_ht?: number | null
  /** D'où vient `period_days` : lue sur le document (PERIODE_LUE) ou devinée.
   *  C'est elle qui décide si la charge entre dans le résultat — donc elle
   *  s'affiche (cf. lib/charges-fixes, qui porte la règle). */
  period_source?: string | null
  status?: string | null
  /** Document archivé + issue de sa lecture — pour proposer le téléversement
   *  (lot 31) uniquement quand la facture n'a pas de lecture exploitable. */
  file_path?: string | null
  lines_status?: string | null
}

/** Statuts SANS lecture exploitable : le document peut être (re)fourni. Même
 *  liste que la route de téléversement — les deux doivent dire pareil. */
export const SANS_LECTURE = new Set(['no_file', 'scan_illisible', 'error', 'hors_matiere'])
export const documentRemplacable = (inv: Invoice) => !inv.file_path || SANS_LECTURE.has(String(inv.lines_status ?? ''))

export type WeeklyCA = {
  ca_total: number; ca_boucherie: number; ca_charcuterie: number; ca_traiteur: number
  ca_divers: number; ca_vente: number
  families_detail?: { nom: string; montant: number }[] | null
}

/** Marge d'une famille choisie par le client (clé de poste du planning) */
export type FamilleMargin = {
  key: string; label: string
  ca: number; achats: number; achats_ventiles?: boolean; salaires?: number
  marge: number; taux: number | null
  marge_totale?: number; taux_totale?: number | null
}
export type Summary = {
  achats_ht: number; achats_by_category: Record<string, number>; masse_salariale: number
  salaires_affectes?: number
  salaires_repartis?: number
  salaires_non_affectes?: number
  achats_a_verifier?: number
  charges_fixes?: number
  /** Le DÉTAIL du poste « charges de structure », tel que le moteur le rend
   *  (cf. ChargeFixeLine dans lib/week-economics). Deux origines — la provision
   *  d'une charge récurrente, la part hebdomadaire d'une facture de charge — et
   *  les lignes ÉCARTÉES, `retenue: false`, avec leur motif et leur phrase.
   *  Tout est optionnel ici : un moteur plus ancien ne casse pas l'écran. */
  charges_fixes_lines?: {
    id: string; label: string; category: string; cost: number; hasActual: boolean
    origine?: 'recurrent' | 'facture'
    /** false = ligne affichée mais NON comptée dans `charges_fixes`. */
    retenue?: boolean
    motif?: string | null
    phrase?: string | null
    montant_facture?: number
    jours?: number | null
  }[]
  ca_total: number; ca_ttc?: number; tva_rate?: number; ca_detail: WeeklyCA | null; marge_brute: number
  taux_marge: number | null; resultat_net: number; ratio_ms: number | null
  marge_apres_salaires?: number
  taux_apres_salaires?: number | null
  achats_by_rayon?: Record<string, number>
  achats_non_ventiles?: number
  achats_divers?: number
  familles?: FamilleMargin[]
  /** 4e bloc : rachat, épicerie, boissons, fruits & légumes, prestations… */
  divers?: FamilleMargin
}

/** Mémoire fournisseur : dernière catégorie et dernier taux de TVA utilisés */
export type SupplierMemo = { name: string; category: string; tva_rate: number | null }

/** Répartition d'un fournisseur sur les FAMILLES de la boutique (en %) */
export type RayonSplit = {
  supplier_key: string; supplier_label: string | null
  /** { id de famille → % }. Les colonnes pct_* que l'API renvoie encore sont
   *  DÉRIVÉES côté serveur : cet écran ne les lit plus et n'en envoie plus. */
  parts: Record<string, number>
}

/** Famille du référentiel margin_families (ventilation par facture + charges) */
export type VentFamily = { id: string; parent_id: string | null; name: string; is_rachat: boolean }

/** Famille de la boutique, telle que /api/supplier-splits la sert : les MÊMES
 *  que celles sur lesquelles le CA est ventilé. Les achats se répartissent
 *  désormais dessus — dix racines, sous-familles comprises — au lieu de quatre
 *  rayons écrits en dur qui écrasaient tout le reste dans « divers ». */
export type RayonFamille = { id: string; parent_id: string | null; name: string; position: number; is_rachat: boolean }

/** Répartition en cours de saisie : { id de famille → pourcentage tapé } */
export type VentDraft = Record<string, string>
export const emptyVent = (): VentDraft => ({})
export const DIVERS_DOT = '#9ca3af'

/** Les familles dans l'ordre de la boutique : chaque racine à sa position,
 *  immédiatement suivie de ses sous-familles. Une famille orpheline (racine
 *  disparue) reste en fin de liste plutôt que d'être escamotée — une part
 *  posée dessus doit rester visible, donc modifiable. */
export function ordonnerFamilles(list: RayonFamille[]): RayonFamille[] {
  const parPosition = [...list].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const out: RayonFamille[] = []
  for (const r of parPosition) {
    if (r.parent_id) continue
    out.push(r, ...parPosition.filter(f => f.parent_id === r.id))
  }
  const vus = new Set(out.map(f => f.id))
  return [...out, ...parPosition.filter(f => !vus.has(f.id))]
}

/** Le pourcentage tapé dans une case, tel quel — jamais redressé. */
export const pctSaisi = (v: unknown): number => parseFloat(String(v ?? '').replace(',', '.')) || 0
/** Le total d'une répartition. 100 est la cible, rien ne l'impose : une société
 *  répartie à 80 % garde 20 % non attribués, et ça se DIT — ça ne se corrige
 *  pas d'office. */
export const totalVent = (d: VentDraft): number => Object.values(d).reduce((s, v) => s + pctSaisi(v), 0)
export const fmtPct = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })

/** Les parts telles qu'elles partent à l'API : les cases vides disparaissent.
 *  Un objet vide vaut « retirer la règle de cette société » — c'est déjà ce que
 *  l'API en fait, on ne la contrarie pas. */
export function partsPayload(d: VentDraft): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [id, v] of Object.entries(d)) { const n = pctSaisi(v); if (n > 0) out[id] = n }
  return out
}
/** Le brouillon de saisie reconstruit depuis les parts enregistrées. */
export function draftFromParts(parts: Record<string, number> | null | undefined): VentDraft {
  const out: VentDraft = {}
  for (const [id, v] of Object.entries(parts ?? {})) { const n = Number(v) || 0; if (n > 0) out[id] = String(n) }
  return out
}
/** Racine d'une famille : une sous-famille (« Viande de bœuf ») prend la
 *  catégorie d'achat de sa racine (« Boucherie »). */
export function racineFamille(f: RayonFamille, parId: Map<string, RayonFamille>): RayonFamille {
  let cur = f
  for (let i = 0; i < 8 && cur.parent_id; i++) {
    const p = parId.get(cur.parent_id)
    if (!p) break
    cur = p
  }
  return cur
}
/** La famille qui pèse le plus lourd dans une répartition — l'ordre des
 *  familles tranche en cas d'égalité, jamais l'ordre d'un objet. */
export function familleDominante(d: VentDraft, familles: RayonFamille[]): RayonFamille | null {
  let best: RayonFamille | null = null
  let max = 0
  for (const f of familles) { const p = pctSaisi(d[f.id]); if (p > max) { max = p; best = f } }
  return best
}

// Identité visuelle des familles classiques — une famille personnalisée dont le
// libellé ressemble à un métier classique (« boucher » ≈ « boucherie ») hérite de sa
// couleur et de son repère de marge matière (MATIERE_BENCH, table partagée avec la
// page Marges et le rapport PDF) ; sinon point gris ardoise, pas de repère.
export const CLASSIC_FAMILLES = [
  { key: 'boucherie',   label: 'Boucherie',   dot: '#b91c1c' },
  { key: 'charcuterie', label: 'Charcuterie', dot: '#c2410c' },
  { key: 'traiteur',    label: 'Traiteur',    dot: '#047857' },
  { key: 'vente',       label: 'Vente',       dot: '#0369a1' },
] as const
export function classicFor(key: string, label: string) {
  return CLASSIC_FAMILLES.find(c => c.key === key || labelsMatch(c.label, label)) ?? null
}
export function familleDot(key: string, label: string): string {
  return classicFor(key, label)?.dot ?? '#475569'
}
export function familleBench(key: string, label: string): [number, number] | null {
  const c = classicFor(key, label)
  return c ? MATIERE_BENCH[c.key] ?? null : null
}
export function matiereColorFor(bench: [number, number] | null, taux: number | null): string {
  if (taux === null) return 'text-gray-400'
  if (!bench) return taux >= 40 ? 'text-green-600' : taux >= 30 ? 'text-orange-500' : 'text-red-500'
  if (taux >= bench[0]) return 'text-green-600'
  if (taux >= bench[0] - 5) return 'text-orange-500'
  return 'text-red-500'
}

// Correspondance société → répartition mémorisée (exacte ou par famille de noms).
// Réutilise normSupplier (défini plus bas, hoisté).
// « Facture X - 6109622F… » → « X » : on mémorise par société, pas par n° de facture.
export function societeName(raw: string): string {
  let s = String(raw || '').trim()
  s = s.replace(/^factures?\s+/i, '')
  s = s.split(/\s+[-–—]\s+/)[0]
  return s.trim()
}
export function sameSupplierFam(a: string, b: string): boolean {
  const na = normSupplier(a), nb = normSupplier(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na]
  return long.startsWith(short) && !/[\p{L}\p{N}]/u.test(long.charAt(short.length))
}
// Famille dominante de la ventilation → catégorie d'achat de la facture. Les
// catégories, elles, restent au nombre de quatre : c'est le plan comptable de
// cet écran, un autre axe. Une famille qui n'est ni boucherie, ni charcuterie,
// ni traiteur donne « frais divers » — même règle que l'API, qui recatégorise.
export const RAYON_TO_CATEGORY: Record<string, string> = { boucherie: 'boucherie', charcuterie: 'charcuterie', traiteur: 'traiteur', divers: 'frais_divers' }
export function categoryFromSplit(d: VentDraft, familles: RayonFamille[]): string | null {
  const dom = familleDominante(d, familles)
  if (!dom) return null
  const racine = racineFamille(dom, new Map(familles.map(f => [f.id, f])))
  const c = classicFor('', racine.name)
  return (c ? RAYON_TO_CATEGORY[c.key] : null) ?? RAYON_TO_CATEGORY.divers
}
export function matchSplit(name: string, splits: RayonSplit[]): RayonSplit | null {
  const q = normSupplier(societeName(name))
  if (!q) return null
  let best: RayonSplit | null = null
  for (const s of splits) {
    if (s.supplier_key === q) return s
    if (sameSupplierFam(s.supplier_key, q) && (best === null || s.supplier_key.length > best.supplier_key.length)) best = s
  }
  return best
}

export type BillingIntegration = {
  provider: string; is_active: boolean; last_sync_at?: string
  last_sync_status?: 'success' | 'error' | 'pending'; invoices_synced?: number; company_id?: string
  /** Rattrapage initial des 2 derniers mois — une DATE, pas un drapeau : quand
   *  le bouton n'est plus là, l'écran peut dire quand il a servi. */
  backfill_at?: string | null
  backfill_imported?: number | null
  backfill_tronque?: boolean | null
}

export type ProviderMeta = {
  id: string; name: string; logo: string; color: string; tokenLabel: string
  tokenPlaceholder: string; needsCompanyId: boolean; companyIdLabel?: string
  helpUrl: string; description: string
}

// ─── Constantes ──────────────

// Palette catégories : teintes sourdes (fond -50, texte -700), ALIGNÉE sur le code
// couleur des rayons et de la page Marges — boucherie rouge, charcuterie orange,
// traiteur émeraude ; « frais divers » en gris neutre.
export const CATEGORIES = [
  { key: 'boucherie',    label: 'Boucherie',    color: 'bg-red-50 text-red-700',         dot: '#b91c1c' },
  { key: 'charcuterie',  label: 'Charcuterie',  color: 'bg-orange-50 text-orange-700',   dot: '#c2410c' },
  { key: 'traiteur',     label: 'Traiteur',     color: 'bg-emerald-50 text-emerald-700', dot: '#047857' },
  { key: 'frais_divers', label: 'Frais divers', color: 'bg-gray-100 text-gray-600',      dot: '#64748b' },
]

export const TVA_RATES = [0, 5.5, 10, 20]

// Périodicités des charges récurrentes (montant saisi = montant PAR période)
export const PERIODICITY_OPTIONS: { key: Periodicity; label: string; short: string }[] = [
  { key: 'weekly',    label: 'Hebdomadaire', short: '/sem'  },
  { key: 'monthly',   label: 'Mensuel',      short: '/mois' },
  { key: 'quarterly', label: 'Trimestriel',  short: '/trim' },
  { key: 'semester',  label: 'Semestriel',   short: '/sem.' },
  { key: 'annual',    label: 'Annuel',       short: '/an'   },
]
export const periodicityLabel = (p: string) => PERIODICITY_OPTIONS.find(o => o.key === p)?.label || p
export const periodicityShort = (p: string) => PERIODICITY_OPTIONS.find(o => o.key === p)?.short || ''

export const EMPTY_RECURRING = {
  id: '', label: '', category: 'frais_divers', amount_ht: '', tva_rate: '20',
  periodicity: 'monthly' as Periodicity, start_date: '', end_date: '', active: true,
}

export const EMPTY_INVOICE = {
  supplier_name: '', invoice_number: '', invoice_date: '',
  category: 'boucherie', amount_ht: '', tva_rate: '20', notes: ''
}

export const PROVIDERS_META: ProviderMeta[] = [
  { id: 'pennylane', name: 'Pennylane', logo: 'PL', color: 'bg-blue-600', tokenLabel: 'Token API Pennylane', tokenPlaceholder: 'eyJhbGci...', needsCompanyId: false, helpUrl: 'https://help.pennylane.com/fr/articles/developer-api', description: 'Importation automatique des factures fournisseurs via l\'API Pennylane' },
  { id: 'sage',      name: 'Sage',      logo: 'SG', color: 'bg-green-600', tokenLabel: 'Access Token Sage', tokenPlaceholder: 'Bearer token issu de Sage OAuth2', needsCompanyId: false, helpUrl: 'https://developer.sage.com/accounting/', description: 'Sage Business Cloud Comptabilité — factures achats' },
  { id: 'cegid',     name: 'Cegid',     logo: 'CG', color: 'bg-purple-600', tokenLabel: 'Clé API Cegid', tokenPlaceholder: 'Clé depuis votre espace Cegid', needsCompanyId: true, companyIdLabel: 'ID Entreprise Cegid', helpUrl: 'https://developers.cegid.com', description: 'Cegid Loop — import automatique des factures d\'achat' },
  { id: 'ebp',       name: 'EBP',       logo: 'EBP', color: 'bg-orange-500', tokenLabel: 'Token API EBP en ligne', tokenPlaceholder: 'Token depuis EBP → Paramètres → API', needsCompanyId: true, companyIdLabel: 'Identifiant dossier EBP', helpUrl: 'https://developer.ebp.com', description: 'EBP en ligne — import factures fournisseurs automatique' },
]

// ─── Helpers ────────────────────────────────────────────────────────────────────────────────────────────

export function getISOWeek(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return { week: Math.ceil((((d.getTime() - y.getTime()) / 86400000) + 1) / 7), year: d.getUTCFullYear() }
}

export function getWeekDates(week: number, year: number): [Date, Date] {
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const dow = jan4.getUTCDay() || 7
  const mon = new Date(jan4)
  mon.setUTCDate(jan4.getUTCDate() - dow + 1 + (week - 1) * 7)
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6)
  return [mon, sun]
}

export function fmtDate(d: Date) { return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' }) }
export function fmtEuro(n: number) { return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €' }
export function catInfo(key: string) { return CATEGORIES.find(c => c.key === key) ?? CATEGORIES[CATEGORIES.length - 1] }

/** Ton de la pastille d'un motif d'écart. PRÉSENTATION seulement — le motif et
 *  son libellé viennent de lib/charges-fixes. Ambre = le boucher peut agir
 *  (indiquer la période) ; gris = rien à corriger, c'est un simple constat. */
export function motifTon(motif: string | null | undefined): string {
  return motif === 'periode_devinee' || motif === 'periode_absente'
    ? 'text-amber-700 bg-amber-50 ring-amber-200'
    : 'text-gray-500 bg-gray-100 ring-gray-200'
}

/** Initiales du fournisseur pour la pastille d'avatar (2 lettres max) */
export function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '·'
}

/** Normalise un nom fournisseur pour comparaison : casse, espaces superflus */
export function normSupplier(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Retrouve le fournisseur mémorisé correspondant à la saisie :
 * 1. correspondance exacte (insensible à la casse) ;
 * 2. FAMILLE de noms : un fournisseur connu est le début de la saisie sur une
 *    limite de mot — « DAVID MASTER SAS » retrouve « DAVID MASTER » (le connu
 *    le plus long l'emporte) ;
 * 3. préfixe UNIQUE à partir de 3 caractères — « Big » suffit pour Bigard.
 */
export function matchSupplier(input: string, memos: SupplierMemo[]): SupplierMemo | null {
  const q = normSupplier(input)
  if (!q) return null
  const exact = memos.find(m => normSupplier(m.name) === q)
  if (exact) return exact
  let fam: SupplierMemo | null = null
  let famLen = 0
  for (const m of memos) {
    const n = normSupplier(m.name)
    if (n.length < q.length && q.startsWith(n) && !/[\p{L}\p{N}]/u.test(q.charAt(n.length)) && n.length > famLen) {
      fam = m; famLen = n.length
    }
  }
  if (fam) return fam
  if (q.length < 3) return null
  const byPrefix = memos.filter(m => normSupplier(m.name).startsWith(q))
  return byPrefix.length === 1 ? byPrefix[0] : null
}

/** Nombre de semaines ISO de l'année (52 ou 53) — le 28 décembre est toujours dans la dernière */
export function isoWeeksInYear(y: number): number {
  return getISOWeek(new Date(y, 11, 28)).week
}

/** Semaine écoulée (ISO) : celle que le gérant doit voir en arrivant le lundi */
export function getLastWeek() {
  const ref = new Date()
  ref.setDate(ref.getDate() - 7)
  return getISOWeek(ref)
}
