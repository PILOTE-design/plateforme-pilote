'use client'

import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import VentilationFacture from './ventilation-facture'
import {
  Receipt, ChevronLeft, ChevronRight, Plus, Trash2,
  TrendingUp, TrendingDown, ShoppingCart, Users, Euro,
  Save, X, Settings, Check, Loader2, AlertCircle,
  Link2, Link2Off, RefreshCw, ArrowUpRight, Repeat, PieChart,
  Pencil, CalendarClock, Scale, Mail, Copy
} from 'lucide-react'
import {
  costForWindow, weekRecurringCost, provisionForWindow, enumeratePeriods,
  type RecurringCharge, type RecurringActual, type Periodicity,
} from '@/lib/recurring-charges'
import { labelsMatch, DEFAULT_MARGIN_FAMILIES, DEFAULT_TVA_RATE, MATIERE_BENCH, DIVERS_POSTE, type Poste } from '@/lib/postes'

// ─── Types ──────────────────

type Invoice = {
  id: string; supplier_name: string; invoice_number?: string; invoice_date: string
  category: string; amount_ht: number; tva_rate: number; amount_ttc: number
  notes?: string; week_number: number; year: number
  is_fixed_charge?: boolean; period_days?: number | null; prorata_ht?: number | null
  status?: string | null
  /** Document archivé + issue de sa lecture — pour proposer le téléversement
   *  (lot 31) uniquement quand la facture n'a pas de lecture exploitable. */
  file_path?: string | null
  lines_status?: string | null
}

/** Statuts SANS lecture exploitable : le document peut être (re)fourni. Même
 *  liste que la route de téléversement — les deux doivent dire pareil. */
const SANS_LECTURE = new Set(['no_file', 'scan_illisible', 'error', 'hors_matiere'])
const documentRemplacable = (inv: Invoice) => !inv.file_path || SANS_LECTURE.has(String(inv.lines_status ?? ''))

type WeeklyCA = {
  ca_total: number; ca_boucherie: number; ca_charcuterie: number; ca_traiteur: number
  ca_divers: number; ca_vente: number
  families_detail?: { nom: string; montant: number }[] | null
}

/** Marge d'une famille choisie par le client (clé de poste du planning) */
type FamilleMargin = {
  key: string; label: string
  ca: number; achats: number; achats_ventiles?: boolean; salaires?: number
  marge: number; taux: number | null
  marge_totale?: number; taux_totale?: number | null
}
type Summary = {
  achats_ht: number; achats_by_category: Record<string, number>; masse_salariale: number
  salaires_affectes?: number
  salaires_repartis?: number
  salaires_non_affectes?: number
  achats_a_verifier?: number
  charges_fixes?: number; charges_fixes_lines?: { id: string; label: string; category: string; cost: number; hasActual: boolean }[]
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
type SupplierMemo = { name: string; category: string; tva_rate: number | null }

/** Répartition d'un fournisseur sur les rayons (en %) */
type RayonSplit = { supplier_key: string; supplier_label: string | null; pct_boucherie: number; pct_charcuterie: number; pct_traiteur: number; pct_divers: number }

/** Famille du référentiel margin_families (ventilation par facture + charges) */
type VentFamily = { id: string; parent_id: string | null; name: string; is_rachat: boolean }
// Champs de ventilation d'un fournisseur : les 3 métiers + « divers ». Le divers n'est
// plus redistribué au prorata du CA — il alimente son propre bloc de marge, en face du
// CA de rachat, d'épicerie, de boissons et de fruits & légumes. Code couleur ALIGNÉ sur
// la page Marges : un même métier garde la même couleur partout dans l'application.
const VENT_FIELDS = [
  { key: 'boucherie',   label: 'Boucherie',   dot: '#b91c1c' },
  { key: 'charcuterie', label: 'Charcuterie', dot: '#c2410c' },
  { key: 'traiteur',    label: 'Traiteur',    dot: '#047857' },
  { key: 'divers',      label: 'Divers',      dot: '#9ca3af' },
] as const
type VentKey = typeof VENT_FIELDS[number]['key']
type VentDraft = Record<VentKey, string>
const emptyVent = (): VentDraft => ({ boucherie: '', charcuterie: '', traiteur: '', divers: '' })
const DIVERS_DOT = '#9ca3af'

// Identité visuelle des familles classiques — une famille personnalisée dont le
// libellé ressemble à un métier classique (« boucher » ≈ « boucherie ») hérite de sa
// couleur et de son repère de marge matière (MATIERE_BENCH, table partagée avec la
// page Marges et le rapport PDF) ; sinon point gris ardoise, pas de repère.
const CLASSIC_FAMILLES = [
  { key: 'boucherie',   label: 'Boucherie',   dot: '#b91c1c' },
  { key: 'charcuterie', label: 'Charcuterie', dot: '#c2410c' },
  { key: 'traiteur',    label: 'Traiteur',    dot: '#047857' },
  { key: 'vente',       label: 'Vente',       dot: '#0369a1' },
] as const
function classicFor(key: string, label: string) {
  return CLASSIC_FAMILLES.find(c => c.key === key || labelsMatch(c.label, label)) ?? null
}
function familleDot(key: string, label: string): string {
  return classicFor(key, label)?.dot ?? '#475569'
}
function familleBench(key: string, label: string): [number, number] | null {
  const c = classicFor(key, label)
  return c ? MATIERE_BENCH[c.key] ?? null : null
}
function matiereColorFor(bench: [number, number] | null, taux: number | null): string {
  if (taux === null) return 'text-gray-400'
  if (!bench) return taux >= 40 ? 'text-green-600' : taux >= 30 ? 'text-orange-500' : 'text-red-500'
  if (taux >= bench[0]) return 'text-green-600'
  if (taux >= bench[0] - 5) return 'text-orange-500'
  return 'text-red-500'
}

// Correspondance société → répartition mémorisée (exacte ou par famille de noms).
// Réutilise normSupplier (défini plus bas, hoisté).
// « Facture X - 6109622F… » → « X » : on mémorise par société, pas par n° de facture.
function societeName(raw: string): string {
  let s = String(raw || '').trim()
  s = s.replace(/^factures?\s+/i, '')
  s = s.split(/\s+[-–—]\s+/)[0]
  return s.trim()
}
function sameSupplierFam(a: string, b: string): boolean {
  const na = normSupplier(a), nb = normSupplier(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na]
  return long.startsWith(short) && !/[\p{L}\p{N}]/u.test(long.charAt(short.length))
}
// Rayon dominant de la ventilation → catégorie d'achat (viande / charcuterie / … / autre)
const RAYON_TO_CATEGORY: Record<string, string> = { boucherie: 'boucherie', charcuterie: 'charcuterie', traiteur: 'traiteur', divers: 'frais_divers' }
function categoryFromSplit(sp: Record<string, string>): string | null {
  const entries = VENT_FIELDS.map(f => [f.key, parseFloat((sp as any)[f.key]) || 0] as [string, number])
  const top = entries.slice().sort((a, b) => b[1] - a[1])[0]
  if (!top || top[1] <= 0) return null
  return RAYON_TO_CATEGORY[top[0]] ?? null
}
function matchSplit(name: string, splits: RayonSplit[]): RayonSplit | null {
  const q = normSupplier(societeName(name))
  if (!q) return null
  let best: RayonSplit | null = null
  for (const s of splits) {
    if (s.supplier_key === q) return s
    if (sameSupplierFam(s.supplier_key, q) && (best === null || s.supplier_key.length > best.supplier_key.length)) best = s
  }
  return best
}

type BillingIntegration = {
  provider: string; is_active: boolean; last_sync_at?: string
  last_sync_status?: 'success' | 'error' | 'pending'; invoices_synced?: number; company_id?: string
}

type ProviderMeta = {
  id: string; name: string; logo: string; color: string; tokenLabel: string
  tokenPlaceholder: string; needsCompanyId: boolean; companyIdLabel?: string
  helpUrl: string; description: string
}

// ─── Constantes ──────────────

// Palette catégories : teintes sourdes (fond -50, texte -700), ALIGNÉE sur le code
// couleur des rayons et de la page Marges — boucherie rouge, charcuterie orange,
// traiteur émeraude ; « frais divers » en gris neutre.
const CATEGORIES = [
  { key: 'boucherie',    label: 'Boucherie',    color: 'bg-red-50 text-red-700',         dot: '#b91c1c' },
  { key: 'charcuterie',  label: 'Charcuterie',  color: 'bg-orange-50 text-orange-700',   dot: '#c2410c' },
  { key: 'traiteur',     label: 'Traiteur',     color: 'bg-emerald-50 text-emerald-700', dot: '#047857' },
  { key: 'frais_divers', label: 'Frais divers', color: 'bg-gray-100 text-gray-600',      dot: '#64748b' },
]

const TVA_RATES = [0, 5.5, 10, 20]

// Périodicités des charges récurrentes (montant saisi = montant PAR période)
const PERIODICITY_OPTIONS: { key: Periodicity; label: string; short: string }[] = [
  { key: 'weekly',    label: 'Hebdomadaire', short: '/sem'  },
  { key: 'monthly',   label: 'Mensuel',      short: '/mois' },
  { key: 'quarterly', label: 'Trimestriel',  short: '/trim' },
  { key: 'semester',  label: 'Semestriel',   short: '/sem.' },
  { key: 'annual',    label: 'Annuel',       short: '/an'   },
]
const periodicityLabel = (p: string) => PERIODICITY_OPTIONS.find(o => o.key === p)?.label || p
const periodicityShort = (p: string) => PERIODICITY_OPTIONS.find(o => o.key === p)?.short || ''

const EMPTY_RECURRING = {
  id: '', label: '', category: 'frais_divers', amount_ht: '', tva_rate: '20',
  periodicity: 'monthly' as Periodicity, start_date: '', end_date: '', active: true,
}

const EMPTY_INVOICE = {
  supplier_name: '', invoice_number: '', invoice_date: '',
  category: 'boucherie', amount_ht: '', tva_rate: '20', notes: ''
}

const PROVIDERS_META: ProviderMeta[] = [
  { id: 'pennylane', name: 'Pennylane', logo: 'PL', color: 'bg-blue-600', tokenLabel: 'Token API Pennylane', tokenPlaceholder: 'eyJhbGci...', needsCompanyId: false, helpUrl: 'https://help.pennylane.com/fr/articles/developer-api', description: 'Importation automatique des factures fournisseurs via l\'API Pennylane' },
  { id: 'sage',      name: 'Sage',      logo: 'SG', color: 'bg-green-600', tokenLabel: 'Access Token Sage', tokenPlaceholder: 'Bearer token issu de Sage OAuth2', needsCompanyId: false, helpUrl: 'https://developer.sage.com/accounting/', description: 'Sage Business Cloud Comptabilité — factures achats' },
  { id: 'cegid',     name: 'Cegid',     logo: 'CG', color: 'bg-purple-600', tokenLabel: 'Clé API Cegid', tokenPlaceholder: 'Clé depuis votre espace Cegid', needsCompanyId: true, companyIdLabel: 'ID Entreprise Cegid', helpUrl: 'https://developers.cegid.com', description: 'Cegid Loop — import automatique des factures d\'achat' },
  { id: 'ebp',       name: 'EBP',       logo: 'EBP', color: 'bg-orange-500', tokenLabel: 'Token API EBP en ligne', tokenPlaceholder: 'Token depuis EBP → Paramètres → API', needsCompanyId: true, companyIdLabel: 'Identifiant dossier EBP', helpUrl: 'https://developer.ebp.com', description: 'EBP en ligne — import factures fournisseurs automatique' },
]

// ─── Helpers ────────────────────────────────────────────────────────────────────────────────────────────

function getISOWeek(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return { week: Math.ceil((((d.getTime() - y.getTime()) / 86400000) + 1) / 7), year: d.getUTCFullYear() }
}

function getWeekDates(week: number, year: number): [Date, Date] {
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const dow = jan4.getUTCDay() || 7
  const mon = new Date(jan4)
  mon.setUTCDate(jan4.getUTCDate() - dow + 1 + (week - 1) * 7)
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6)
  return [mon, sun]
}

function fmtDate(d: Date) { return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' }) }
function fmtEuro(n: number) { return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €' }
function catInfo(key: string) { return CATEGORIES.find(c => c.key === key) ?? CATEGORIES[CATEGORIES.length - 1] }

/** Initiales du fournisseur pour la pastille d'avatar (2 lettres max) */
function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '·'
}

/** Normalise un nom fournisseur pour comparaison : casse, espaces superflus */
function normSupplier(name: string): string {
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
function matchSupplier(input: string, memos: SupplierMemo[]): SupplierMemo | null {
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
function isoWeeksInYear(y: number): number {
  return getISOWeek(new Date(y, 11, 28)).week
}

/** Semaine écoulée (ISO) : celle que le gérant doit voir en arrivant le lundi */
function getLastWeek() {
  const ref = new Date()
  ref.setDate(ref.getDate() - 7)
  return getISOWeek(ref)
}

// ─── Composant principal ────────────────────────────────────────

export default function FacturationPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { confirm: confirmAction } = useConfirm()
  const lastWeek = getLastWeek()
  const [week, setWeek] = useState(lastWeek.week)
  const [year, setYear] = useState(lastWeek.year)
  const [invoices,  setInvoices]  = useState<Invoice[]>([])
  // Charges récurrentes (définition/provision) + réels (réconciliation)
  const [recurringCharges, setRecurringCharges] = useState<RecurringCharge[]>([])
  const [recurringActuals, setRecurringActuals] = useState<RecurringActual[]>([])
  const [showRecurring, setShowRecurring] = useState(false)          // modale édition d'une charge
  const [recForm, setRecForm] = useState<typeof EMPTY_RECURRING>(EMPTY_RECURRING)
  const [recSaving, setRecSaving] = useState(false)
  const [showReconcile, setShowReconcile] = useState(false)          // modale réconciliation
  const [reconChargeId, setReconChargeId] = useState<string>('')
  const [reconYear, setReconYear] = useState<number>(year)
  const [actualDraft, setActualDraft] = useState<Record<string, string>>({})  // key période → montant réel saisi
  const [summary,   setSummary]   = useState<Summary | null>(null)
  const [loading,   setLoading]   = useState(false)
  const [showAdd,   setShowAdd]   = useState(false)
  const [showCA,    setShowCA]    = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showProviders, setShowProviders] = useState(false)
  const [showSplits,     setShowSplits]     = useState(false)
  // Ventilation PAR FACTURE (référentiel de familles/sous-familles) + familles de charges
  const [ventFamilies,   setVentFamilies]   = useState<VentFamily[]>([])
  const [chargeFamilies, setChargeFamilies] = useState<VentFamily[]>([])
  const [invSplits,      setInvSplits]      = useState<Record<string, { family_id: string; pct: number }[]>>({})
  const [ventInvoice,    setVentInvoice]    = useState<Invoice | null>(null)
  const [splits,         setSplits]         = useState<RayonSplit[]>([])
  const [splitSuppliers, setSplitSuppliers] = useState<{ key: string; name: string }[]>([])
  const [splitDraft,     setSplitDraft]     = useState<Record<string, VentDraft & { label: string }>>({})
  const [splitSaving,    setSplitSaving]    = useState(false)
  // Onglet actif de la modale : « à répartir » (sociétés sans ventilation) ou « toutes »
  const [splitsTab,      setSplitsTab]      = useState<'todo' | 'all'>('todo')
  // Répartition saisie sur la facture en cours (mémorisée par société)
  const [newSplit,       setNewSplit]       = useState<VentDraft>(emptyVent())
  const [splitTouched,   setSplitTouched]   = useState(false)
  const [categoryTouched, setCategoryTouched] = useState(false)
  const [newInvoice, setNewInvoice] = useState<any>(EMPTY_INVOICE)
  const [saving,    setSaving]    = useState(false)
  // Tri de la liste d'achats : par catégorie (sous-totaux par poste) ou à plat par date
  const [invoiceView, setInvoiceView] = useState<'categorie' | 'date'>('categorie')
  // Choix des 3 familles de marge (postes du planning, personnalisés compris)
  const [showFamilles,  setShowFamilles]  = useState(false)
  const [postesList,    setPostesList]    = useState<Poste[]>([])
  const [familleDraft,  setFamilleDraft]  = useState<string[]>([...DEFAULT_MARGIN_FAMILIES])
  const [famSaving,     setFamSaving]     = useState(false)
  // Mémoire fournisseur (pré-remplissage auto catégorie + TVA à la saisie d'un achat)
  const [suppliersMemo, setSuppliersMemo] = useState<SupplierMemo[]>([])
  // Le boucher a choisi catégorie ou TVA à la main → la mémoire ne l'écrase plus
  const [memoTouched, setMemoTouched] = useState(false)
  const [caForm,    setCaForm]    = useState({ ca_total: '', ca_boucherie: '', ca_charcuterie: '', ca_traiteur: '', ca_divers: '' })
  const [settForm,  setSettForm]  = useState({ company_name: '', siret: '' })
  // Connecteur EMAIL : pour les maisons sans logiciel de facturation. L'adresse
  // de transfert n'existe qu'une fois l'email du gérant vérifié par code.
  const [mail, setMail] = useState<{ forward_id: string | null; verified: boolean; email: string | null }>({ forward_id: null, verified: false, email: null })
  const [mailStep, setMailStep] = useState<'idle' | 'code'>('idle')
  const [mailAddr, setMailAddr] = useState('')
  const [mailCode, setMailCode] = useState('')
  const [mailBusy, setMailBusy] = useState(false)
  const [mailMsg, setMailMsg] = useState<{ ok: boolean; texte: string } | null>(null)
  const [mailCopie, setMailCopie] = useState(false)
  // Taux de TVA : saisi ici mais porte par `clients` (API /api/postes), pas par
  // billing-settings — c'est une donnee de CALCUL, pas une mention legale.
  const [tvaDraft,  setTvaDraft]  = useState('')

  const [integrations,     setIntegrations]     = useState<BillingIntegration[]>([])
  const [showConnect,      setShowConnect]      = useState(false)
  const [connectProvider,  setConnectProvider]  = useState<ProviderMeta | null>(null)
  const [connectToken,     setConnectToken]     = useState('')
  const [connectCompanyId, setConnectCompanyId] = useState('')
  const [connecting,       setConnecting]       = useState(false)
  const [connectError,     setConnectError]     = useState('')
  const [syncing,          setSyncing]          = useState<string | null>(null)

  // Garde anti-réponses obsolètes : si l'utilisateur change de semaine pendant qu'un
  // chargement est en cours, la réponse de l'ancienne semaine ne doit PAS écraser l'affichage
  const reqIdRef = useRef(0)

  const [mon, sun] = getWeekDates(week, year)
  const monISO = mon.toISOString().slice(0, 10)
  const sunISO = sun.toISOString().slice(0, 10)
  const { week: cw, year: cy } = getISOWeek(new Date())
  const isCurrentWeek = week === cw && year === cy
  const isLastWeek    = week === lastWeek.week && year === lastWeek.year

  const load = useCallback(async () => {
    const reqId = ++reqIdRef.current
    setLoading(true)
    const noStore: RequestInit = { cache: 'no-store' }
    const [invRes, recRes, sumRes, caRes, settRes, ventRes] = await Promise.all([
      fetch(`/api/invoices?week=${week}&year=${year}`, noStore).then(r => r.json()).catch(() => []),
      fetch(`/api/recurring-charges`, noStore).then(r => r.json()).catch(() => ({ charges: [], actuals: [] })),
      fetch(`/api/facturation/summary?week=${week}&year=${year}`, noStore).then(r => r.json()).catch(() => null),
      fetch(`/api/weekly-ca?week=${week}&year=${year}`, noStore).then(r => r.json()).catch(() => null),
      fetch('/api/billing-settings', noStore).then(r => r.json()).catch(() => ({})),
      fetch(`/api/invoice-splits?week=${week}&year=${year}`, noStore).then(r => r.json()).catch(() => null),
    ])
    if (reqId !== reqIdRef.current) return // une navigation plus récente a eu lieu — on jette cette réponse
    setInvoices(Array.isArray(invRes) ? invRes : [])
    if (ventRes && !ventRes.error) {
      setVentFamilies(Array.isArray(ventRes.families) ? ventRes.families : [])
      setChargeFamilies(Array.isArray(ventRes.chargeFamilies) ? ventRes.chargeFamilies : [])
      const bySplit: Record<string, { family_id: string; pct: number }[]> = {}
      for (const s of (Array.isArray(ventRes.splits) ? ventRes.splits : []) as { invoice_id: string; family_id: string; pct: number }[]) {
        (bySplit[s.invoice_id] ||= []).push({ family_id: s.family_id, pct: Number(s.pct) || 0 })
      }
      setInvSplits(bySplit)
    }
    setRecurringCharges(Array.isArray(recRes?.charges) ? recRes.charges : [])
    setRecurringActuals(Array.isArray(recRes?.actuals) ? recRes.actuals : [])
    setSummary(sumRes)
    const s = settRes || {}
    setSettForm({ company_name: s.company_name || '', siret: s.siret || '' })
    setMail({ forward_id: s.billing_forward_id || null, verified: Boolean(s.billing_email_verified), email: s.billing_email || null })
    if (s.billing_email && !mailAddr) setMailAddr(String(s.billing_email))
    if (caRes && !caRes.error) setCaForm({ ca_total: String(caRes.ca_total || ''), ca_boucherie: String(caRes.ca_boucherie || ''), ca_charcuterie: String(caRes.ca_charcuterie || ''), ca_traiteur: String(caRes.ca_traiteur || ''), ca_divers: String(caRes.ca_divers || '') })
    else setCaForm({ ca_total: '', ca_boucherie: '', ca_charcuterie: '', ca_traiteur: '', ca_divers: '' })
    setLoading(false)
  }, [week, year])

  /** Envoie le code de validation à l'adresse du gérant (l'adresse de transfert
   *  n'est activée qu'après vérification — sans quoi n'importe qui pourrait
   *  déposer des factures dans une boucherie qui n'est pas la sienne). */
  async function envoyerCodeMail() {
    const addr = mailAddr.trim()
    if (!addr.includes('@')) { setMailMsg({ ok: false, texte: 'Adresse email invalide.' }); return }
    setMailBusy(true); setMailMsg(null)
    const r = await fetch('/api/billing-settings/send-code', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ billing_email: addr }),
    }).catch(() => null)
    const d = r ? await r.json().catch(() => null) : null
    setMailBusy(false)
    if (r?.ok) { setMailStep('code'); setMailMsg({ ok: true, texte: `Code envoyé à ${addr} — il expire dans 15 minutes.` }) }
    else setMailMsg({ ok: false, texte: d?.error || 'Envoi impossible.' })
  }

  async function validerCodeMail() {
    const code = mailCode.trim()
    if (code.length !== 6) { setMailMsg({ ok: false, texte: 'Le code fait 6 chiffres.' }); return }
    setMailBusy(true); setMailMsg(null)
    const r = await fetch('/api/billing-settings/verify-code', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
    }).catch(() => null)
    const d = r ? await r.json().catch(() => null) : null
    setMailBusy(false)
    if (r?.ok) { setMailStep('idle'); setMailCode(''); setMailMsg({ ok: true, texte: 'Adresse vérifiée — vous pouvez transférer vos factures.' }); load() }
    else setMailMsg({ ok: false, texte: d?.error || 'Code refusé.' })
  }

  const loadIntegrations = useCallback(async () => {
    const res = await fetch('/api/billing-integrations', { cache: 'no-store' }).catch(() => null)
    if (res?.ok) { const data = await res.json(); setIntegrations(Array.isArray(data) ? data : []) }
  }, [])

  const loadSplits = useCallback(async () => {
    const res = await fetch('/api/supplier-splits', { cache: 'no-store' }).catch(() => null)
    if (!res?.ok) return
    const data = await res.json().catch(() => null)
    if (!data) return
    setSplits(Array.isArray(data.splits) ? data.splits : [])
    setSplitSuppliers(Array.isArray(data.suppliers) ? data.suppliers : [])
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadIntegrations() }, [loadIntegrations])
  useEffect(() => { loadSplits() }, [loadSplits, invoices.length])

  // Charge la mémoire fournisseur (catégorie + TVA les plus récentes par fournisseur)
  useEffect(() => {
    fetch('/api/invoices?suppliers=1', { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        if (!Array.isArray(data)) return
        const list: SupplierMemo[] = []
        for (const s of data) {
          const name = String(s?.supplier_name || '').trim()
          if (!name || !s?.category) continue
          const tva = s.tva_rate === null || s.tva_rate === undefined ? null : parseFloat(String(s.tva_rate))
          list.push({ name, category: s.category, tva_rate: Number.isFinite(tva) ? tva : null })
        }
        list.sort((a, b) => a.name.localeCompare(b.name, 'fr'))
        setSuppliersMemo(list)
      })
      .catch(() => {})
  }, [invoices.length])

  /** Ouvre le formulaire d'ajout sur un état vierge (mémoire fournisseur réarmée) */
  function openAdd() {
    setNewInvoice(EMPTY_INVOICE)
    setMemoTouched(false)
    setNewSplit(emptyVent())
    setSplitTouched(false)
    setCategoryTouched(false)
    setShowAdd(true)
  }

  // La catégorie d'achat suit le rayon dominant de la ventilation (sauf choix manuel)
  useEffect(() => {
    if (!showAdd || categoryTouched) return
    const cat = categoryFromSplit(newSplit)
    if (cat) setNewInvoice((p: any) => (p.category === cat ? p : { ...p, category: cat }))
  }, [newSplit, showAdd, categoryTouched])

  // Pré-remplit la répartition depuis la mémoire de la société saisie (tant qu'on n'y a pas touché)
  useEffect(() => {
    if (!showAdd || splitTouched) return
    const m = matchSplit(newInvoice.supplier_name || '', splits)
    setNewSplit(m
      ? {
          boucherie:   m.pct_boucherie   ? String(m.pct_boucherie)   : '',
          charcuterie: m.pct_charcuterie ? String(m.pct_charcuterie) : '',
          traiteur:    m.pct_traiteur    ? String(m.pct_traiteur)    : '',
          divers:            m.pct_divers            ? String(m.pct_divers)            : '',
        }
      : emptyVent())
  }, [newInvoice.supplier_name, splits, showAdd, splitTouched])

  /** Construit le brouillon d'édition en fusionnant fournisseurs connus + règles enregistrées */
  function buildSplitDraft(
    suppliers: { key: string; name: string }[],
    splitList: RayonSplit[],
  ) {
    const draft: Record<string, VentDraft & { label: string }> = {}
    for (const s of suppliers) {
      draft[s.key] = { label: s.name || s.key, ...emptyVent() }
    }
    for (const sp of splitList) {
      draft[sp.supplier_key] = {
        label: sp.supplier_label || draft[sp.supplier_key]?.label || sp.supplier_key,
        boucherie:   sp.pct_boucherie   ? String(sp.pct_boucherie)   : '',
        charcuterie: sp.pct_charcuterie ? String(sp.pct_charcuterie) : '',
        traiteur:    sp.pct_traiteur    ? String(sp.pct_traiteur)    : '',
        divers:            sp.pct_divers            ? String(sp.pct_divers)            : '',
      }
    }
    return draft
  }

  /** Ouvre la répartition par rayon sur l'onglet « à répartir » */
  function openSplits() {
    setSplitDraft(buildSplitDraft(splitSuppliers, splits))
    setSplitsTab('todo')
    setShowSplits(true)
  }

  async function saveSplits() {
    setSplitSaving(true)
    try {
      const rows = Object.entries(splitDraft).map(([key, v]) => ({
        supplier_key: key,
        supplier_label: v.label,
        pct_boucherie:   parseFloat(v.boucherie)   || 0,
        pct_charcuterie: parseFloat(v.charcuterie) || 0,
        pct_traiteur:    parseFloat(v.traiteur)    || 0,
        pct_divers:            parseFloat(v.divers)            || 0,
      }))
      const res = await fetch('/api/supplier-splits', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ splits: rows }),
      })
      if (!res.ok) { toast({ variant: 'error', title: 'Enregistrement impossible', description: `Erreur ${res.status}` }); return }
      toast({ variant: 'success', title: 'Répartition enregistrée' })
      // On garde la modale ouverte et on rafraîchit : les sociétés tout juste réparties
      // quittent « à répartir » et rejoignent « toutes mes répartitions ».
      const fresh = await fetch('/api/supplier-splits', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null)
      if (fresh) {
        const nextSplits = Array.isArray(fresh.splits) ? fresh.splits : []
        const nextSuppliers = Array.isArray(fresh.suppliers) ? fresh.suppliers : []
        setSplits(nextSplits)
        setSplitSuppliers(nextSuppliers)
        setSplitDraft(buildSplitDraft(nextSuppliers, nextSplits))
      } else {
        await loadSplits()
      }
      await load()
    } catch {
      toast({ variant: 'error', title: 'Erreur réseau', description: "La répartition n'a pas été enregistrée." })
    } finally {
      setSplitSaving(false)
    }
  }

  function prevWeek() { if (week === 1) { setYear(y => y - 1); setWeek(isoWeeksInYear(year - 1)) } else setWeek(w => w - 1) }
  function nextWeek() { if (week >= isoWeeksInYear(year)) { setYear(y => y + 1); setWeek(1) } else setWeek(w => w + 1) }

  async function addInvoice() {
    if (!newInvoice.supplier_name || !newInvoice.invoice_date || !newInvoice.amount_ht) return
    setSaving(true)
    const res = await fetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newInvoice, week_number: week, year }) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({} as any)) : ({} as any)
    if (!res?.ok || !data.id) {
      toast({ variant: 'error', title: 'Facture non enregistrée', description: data.error || 'Vérifiez les champs et réessayez.' })
      setSaving(false)
      return
    }
    if (data.id) {
      // Mémorise la répartition par rayon de cette société — ré-appliquée à ses prochaines factures
      const pcts = {
        pct_boucherie:   parseFloat(newSplit.boucherie)   || 0,
        pct_charcuterie: parseFloat(newSplit.charcuterie) || 0,
        pct_traiteur:    parseFloat(newSplit.traiteur)    || 0,
        pct_divers:            parseFloat(newSplit.divers)            || 0,
      }
      if (pcts.pct_boucherie || pcts.pct_charcuterie || pcts.pct_traiteur || pcts.pct_divers) {
        await fetch('/api/supplier-splits', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ split: { supplier_key: newInvoice.supplier_name, supplier_label: newInvoice.supplier_name, ...pcts } }),
        }).catch(() => {})
        loadSplits()
      }
      setShowAdd(false); setNewInvoice(EMPTY_INVOICE); setMemoTouched(false); setSplitTouched(false); setCategoryTouched(false); load()
    }
    setSaving(false)
  }

  async function deleteInvoice(id: string) {
    const ok = await confirmAction({
      title: 'Supprimer cette facture ?',
      description: 'La facture sera définitivement retirée de la semaine et des totaux.',
      confirmLabel: 'Supprimer',
      variant: 'danger',
    })
    if (!ok) return
    await fetch(`/api/invoices/${id}`, { method: 'DELETE' })
    setInvoices(prev => prev.filter(i => i.id !== id))
    toast({ variant: 'success', title: 'Facture supprimée' })
    load()
  }

  /** Valide une facture « à vérifier » — seules les validées entrent dans le calcul des marges */
  async function validateInvoice(inv: Invoice) {
    setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, status: 'validee' } : i))
    const res = await fetch(`/api/invoices/${inv.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'validee' }) })
    if (res.ok) { toast({ variant: 'success', title: 'Facture validée' }); load() }
    else { toast({ variant: 'error', title: 'Erreur', description: 'La validation a échoué.' }); load() }
  }

  /** Déplace une facture vers les charges fixes : elle sort des achats matière
   *  (marges) et rejoint le bloc « En charges fixes » ci-dessous, où on lui
   *  choisit sa famille de charge. Réversible. */
  async function moveToFixed(inv: Invoice) {
    const res = await fetch(`/api/invoices/${inv.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_fixed_charge: true }) }).catch(() => null)
    if (res?.ok) { toast({ variant: 'success', title: `« ${inv.supplier_name} » déplacée en charges fixes`, description: 'Elle ne pèse plus sur les marges matière. Choisissez sa famille de charge ci-dessous.' }); load() }
    else toast({ variant: 'error', title: 'Déplacement impossible' })
  }

  async function moveBackToVariable(inv: Invoice) {
    const res = await fetch(`/api/invoices/${inv.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_fixed_charge: false, charge_family_id: null }) }).catch(() => null)
    if (res?.ok) { toast({ variant: 'success', title: `« ${inv.supplier_name} » repassée en achats` }); load() }
    else toast({ variant: 'error', title: 'Opération impossible' })
  }

  // ── Téléversement du document d'une charge (lot 31) ──
  // Une facture mal transmise arrive en charges structurelles SANS document :
  // le boucher fournit le PDF, la lecture juge sur pièce — si c'est de la
  // matière, l'étiquette tombe toute seule et elle repasse en achats.
  const [televersant, setTeleversant] = useState<string | null>(null)
  async function televerserDocument(inv: Invoice, fichier: File | null) {
    if (!fichier || televersant) return
    setTeleversant(inv.id)
    const form = new FormData()
    form.append('file', fichier)
    const res = await fetch(`/api/invoices/${inv.id}/document`, { method: 'POST', body: form }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    if (!res?.ok) {
      setTeleversant(null)
      toast({ variant: 'error', title: `${inv.supplier_name} : téléversement refusé`, description: data?.error || 'Réessayez.' })
      return
    }
    toast({ variant: 'info', title: `${inv.supplier_name} : document reçu`, description: 'Lecture en cours — elle décide de la nature de la facture.' })
    // La lecture juge le document (relire saute la mémoire fournisseur : c'est
    // une nouvelle pièce, elle mérite sa propre audience).
    const rl = await fetch('/api/invoices/extract-lines', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoice_id: inv.id, relire: true }),
    }).catch(() => null)
    const rd = rl ? await rl.json().catch(() => null) : null
    setTeleversant(null)
    if (rl?.ok && (rd?.status === 'done' || rd?.status === 'partial')) {
      toast({
        variant: 'success',
        title: `${inv.supplier_name} : reclassée en achats de la semaine`,
        description: `Le document porte de la matière — ${rd?.prix_promus ?? 0} prix retenu${(rd?.prix_promus ?? 0) > 1 ? 's' : ''} pour la mercuriale.`,
      })
    } else if (rl?.ok && rd?.status === 'hors_matiere') {
      toast({ variant: 'info', title: `${inv.supplier_name} : le document confirme une charge`, description: 'Elle reste en charges structurelles — rien d\'anormal si c\'est un loyer, un abonnement, une assurance…' })
    } else {
      toast({ variant: 'error', title: `${inv.supplier_name} : lecture du document en échec`, description: rd?.error || 'Le document est archivé — relancez la lecture depuis la mercuriale.' })
    }
    load()
  }

  async function setChargeFam(inv: Invoice, familyId: string) {
    const res = await fetch(`/api/invoices/${inv.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ charge_family_id: familyId || null }) }).catch(() => null)
    if (res?.ok) load()
    else toast({ variant: 'error', title: 'Enregistrement impossible' })
  }

  /** Valide d'un coup toutes les factures « à vérifier » */
  async function validateAllPending() {
    const pending = [...new Map(invoices.filter(i => i.status === 'a_verifier').map(i => [i.id, i])).values()]
    if (pending.length === 0) return
    setInvoices(prev => prev.map(i => i.status === 'a_verifier' ? { ...i, status: 'validee' } : i))
    await Promise.all(pending.map(i => fetch(`/api/invoices/${i.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'validee' }) })))
    toast({ variant: 'success', title: `${pending.length} facture${pending.length > 1 ? 's' : ''} validée${pending.length > 1 ? 's' : ''}` })
    load()
  }

  /** Recharge uniquement les charges récurrentes + réels (sans recharger toute la semaine) */
  async function loadRecurring() {
    const data = await fetch('/api/recurring-charges', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null)
    if (!data) return
    setRecurringCharges(Array.isArray(data.charges) ? data.charges : [])
    setRecurringActuals(Array.isArray(data.actuals) ? data.actuals : [])
  }

  function openNewRecurring() {
    setRecForm({ ...EMPTY_RECURRING, start_date: monISO })
    setShowRecurring(true)
  }
  function openEditRecurring(c: RecurringCharge) {
    setRecForm({
      id: c.id, label: c.label, category: c.category,
      amount_ht: String(c.amount_ht ?? ''), tva_rate: String(c.tva_rate ?? '20'),
      periodicity: c.periodicity, start_date: c.start_date, end_date: c.end_date || '', active: c.active,
    })
    setShowRecurring(true)
  }

  /** Crée ou met à jour une charge récurrente */
  async function saveRecurring() {
    const label = recForm.label.trim()
    if (!label) { toast({ variant: 'error', title: 'Libellé requis' }); return }
    if (!recForm.start_date) { toast({ variant: 'error', title: 'Date de début requise' }); return }
    const amount = parseFloat(recForm.amount_ht)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ variant: 'error', title: 'Montant invalide', description: 'Saisissez le montant HT d\'une période (strictement positif).' })
      return
    }
    if (recForm.end_date && recForm.end_date < recForm.start_date) {
      toast({ variant: 'error', title: 'Dates incohérentes', description: 'La date de fin est antérieure à la date de début.' })
      return
    }
    setRecSaving(true)
    try {
      const payload = {
        id: recForm.id || undefined,
        label,
        category: recForm.category,
        amount_ht: amount,
        tva_rate: parseFloat(recForm.tva_rate) || 0,
        periodicity: recForm.periodicity,
        start_date: recForm.start_date,
        end_date: recForm.end_date || null,
        active: recForm.active,
      }
      const res = await fetch('/api/recurring-charges', {
        method: recForm.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { toast({ variant: 'error', title: 'Enregistrement impossible', description: `Erreur ${res.status}` }); return }
      toast({ variant: 'success', title: recForm.id ? 'Charge mise à jour' : 'Charge ajoutée' })
      setShowRecurring(false)
      await loadRecurring()
      await load()
    } catch {
      toast({ variant: 'error', title: 'Erreur réseau' })
    } finally {
      setRecSaving(false)
    }
  }

  async function deleteRecurring(c: RecurringCharge) {
    const ok = await confirmAction({ title: 'Supprimer cette charge ?', description: `« ${c.label} » et ses réels de réconciliation seront supprimés.`, confirmLabel: 'Supprimer', variant: 'danger' })
    if (!ok) return
    setRecurringCharges(prev => prev.filter(x => x.id !== c.id))
    await fetch(`/api/recurring-charges?id=${c.id}`, { method: 'DELETE' })
    await load()
  }

  /** Enregistre un réel pour une période (remplace la provision sur sa fenêtre) */
  async function saveActual(chargeId: string, period_start: string, period_end: string, amount: number) {
    const res = await fetch('/api/recurring-actuals', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recurring_charge_id: chargeId, period_start, period_end, amount_ht: amount }),
    })
    if (!res.ok) { toast({ variant: 'error', title: 'Réel non enregistré', description: `Erreur ${res.status}` }); return }
    toast({ variant: 'success', title: 'Réel enregistré' })
    await loadRecurring()
    await load()
  }
  async function deleteActual(id: string) {
    setRecurringActuals(prev => prev.filter(a => a.id !== id))
    await fetch(`/api/recurring-actuals?id=${id}`, { method: 'DELETE' })
    await load()
  }

  async function saveCA() {
    const total  = parseFloat(caForm.ca_total)
    const rayons = {
      ca_boucherie:   parseFloat(caForm.ca_boucherie)   || 0,
      ca_charcuterie: parseFloat(caForm.ca_charcuterie) || 0,
      ca_traiteur:    parseFloat(caForm.ca_traiteur)    || 0,
      ca_divers:      parseFloat(caForm.ca_divers)      || 0,
    }
    if (!caForm.ca_total.trim() || isNaN(total) || total <= 0) {
      toast({ variant: 'error', title: 'CA total invalide', description: 'Saisissez un chiffre d\'affaires total strictement positif.' })
      return
    }
    if (Object.values(rayons).some(v => v < 0)) {
      toast({ variant: 'error', title: 'Montant négatif', description: 'Le détail par rayon ne peut pas contenir de valeur négative.' })
      return
    }
    const sumRayons = rayons.ca_boucherie + rayons.ca_charcuterie + rayons.ca_traiteur + rayons.ca_divers
    if (sumRayons > total + 0.01) {
      toast({ variant: 'error', title: 'Détail incohérent', description: `La somme des rayons (${fmtEuro(sumRayons)}) dépasse le CA total (${fmtEuro(total)}).` })
      return
    }
    setSaving(true)
    const body = { week_number: week, year, ca_total: total, ...rayons }
    const res = await fetch('/api/weekly-ca', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (res.ok) { setShowCA(false); toast({ variant: 'success', title: 'CA enregistré' }); load() }
    else toast({ variant: 'error', title: 'Erreur', description: 'Le CA n\'a pas pu être enregistré.' })
    setSaving(false)
  }

  async function saveSettings() {
    setSaving(true)
    const tva = parseFloat(tvaDraft.replace(',', '.'))
    if (!Number.isFinite(tva) || tva <= 0 || tva > 20) {
      setSaving(false)
      toast({ variant: 'error', title: 'Taux de TVA invalide', description: 'Saisissez un taux entre 0 et 20 % (5,5 % pour l\'alimentaire à emporter).' })
      return
    }
    const [res, tvaRes] = await Promise.all([
      fetch('/api/billing-settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settForm) }).catch(() => null),
      fetch('/api/postes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tva_rate: tva }) }).catch(() => null),
    ])
    setSaving(false)
    if (res?.ok && tvaRes?.ok) { setShowSettings(false); toast({ variant: 'success', title: 'Paramètres enregistrés' }); load() }
    else toast({ variant: 'error', title: 'Erreur', description: 'Les paramètres n\'ont pas été enregistrés.' })
  }

  async function connectIntegration() {
    if (!connectProvider || !connectToken) return
    setConnecting(true); setConnectError('')
    const res = await fetch('/api/billing-integrations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: connectProvider.id, api_token: connectToken, company_id: connectCompanyId || undefined }) })
    const data = await res.json()
    if (!res.ok) { setConnectError(data.error || 'Erreur de connexion'); setConnecting(false); return }
    setShowConnect(false); setConnectToken(''); setConnectCompanyId(''); setConnectProvider(null); setConnecting(false); setShowProviders(false); loadIntegrations()
  }

  async function disconnectIntegration(provider: string) {
    const ok = await confirmAction({
      title: `Déconnecter ${provider} ?`,
      description: 'La synchronisation automatique des factures sera arrêtée. Vous pourrez reconnecter le logiciel à tout moment.',
      confirmLabel: 'Déconnecter',
      variant: 'danger',
    })
    if (!ok) return
    await fetch(`/api/billing-integrations/${provider}`, { method: 'DELETE' }); loadIntegrations()
    toast({ variant: 'info', title: `${provider} déconnecté` })
  }

  async function syncNow(provider: string) {
    setSyncing(provider)
    const res = await fetch('/api/billing-integrations/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, week, year }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => ({} as any)) : ({} as any)
    setSyncing(null); loadIntegrations(); load()
    const r = data?.results?.[provider]
    if (res?.ok && r?.success) {
      const n = typeof r.imported === 'number' ? r.imported : 0
      toast({
        variant: 'success', title: 'Synchronisation terminée',
        description: n > 0 ? `${n} facture${n > 1 ? 's' : ''} importée${n > 1 ? 's' : ''} sur la semaine ${week}.` : `Aucune nouvelle facture sur la semaine ${week}.`,
      })
    } else {
      toast({ variant: 'error', title: 'Synchronisation échouée', description: r?.error || data?.error || 'Vérifiez la connexion au logiciel comptable.' })
    }
  }

  /** Ouvre le choix des 3 familles — la liste des postes vient du planning (intégrés + personnalisés) */
  async function openFamilles() {
    setFamilleDraft(summary?.familles?.length === 3 ? summary.familles.map(f => f.key) : [...DEFAULT_MARGIN_FAMILIES])
    setShowFamilles(true)
    const data = await fetch('/api/postes', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null)
    if (data) {
      setPostesList([...(Array.isArray(data.builtin) ? data.builtin : []), ...(Array.isArray(data.custom) ? data.custom : [])])
      if (Array.isArray(data.margin_families) && data.margin_families.length === 3) setFamilleDraft(data.margin_families.map(String))
    }
  }

  async function saveFamilles() {
    if (new Set(familleDraft).size !== 3) {
      toast({ variant: 'error', title: 'Trois familles distinctes requises' })
      return
    }
    setFamSaving(true)
    const res = await fetch('/api/postes', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ margin_families: familleDraft }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => ({} as any)) : ({} as any)
    setFamSaving(false)
    if (res?.ok) {
      setShowFamilles(false)
      toast({ variant: 'success', title: 'Familles de marge enregistrées' })
      load()
    } else {
      toast({ variant: 'error', title: 'Enregistrement impossible', description: data?.error || 'Réessayez.' })
    }
  }

  function openValorisation(inv: Invoice) {
    const qs = new URLSearchParams({
      date:      inv.invoice_date,
      supplier:  inv.supplier_name,
      amount_ht: String(inv.amount_ht),
    })
    router.push(`/dashboard/valorisation?${qs.toString()}`)
  }

  const ttcAmount = parseFloat(newInvoice.amount_ht || '0') * (1 + parseFloat(newInvoice.tva_rate || '20') / 100)
  // Fournisseur reconnu par la mémoire (exact, famille ou préfixe unique) — null si choix manuel en cours
  const supplierMatch = memoTouched ? null : matchSupplier(newInvoice.supplier_name || '', suppliersMemo)
  const matchHasTva = supplierMatch !== null && supplierMatch.tva_rate !== null && TVA_RATES.includes(supplierMatch.tva_rate)

  // ── Achats variables de la semaine ──
  const variableInvoices = invoices.filter(i => !i.is_fixed_charge)
  // Tri par date (puis montant) — base des deux vues ; en vue « par catégorie »,
  // les factures sont regroupées par poste avec sous-total, triées par date à l'intérieur.
  const sortedVariable   = [...variableInvoices].sort(
    (a, b) => (b.invoice_date || '').localeCompare(a.invoice_date || '') || b.amount_ht - a.amount_ht,
  )
  // Groupes par catégorie (catégorie inconnue → « Frais divers », via catInfo)
  const invoiceGroups = CATEGORIES
    .map(cat => ({ cat, rows: sortedVariable.filter(i => catInfo(i.category).key === cat.key) }))
    .filter(g => g.rows.length > 0)
  const pendingCount = new Set(invoices.filter(i => i.status === 'a_verifier').map(i => i.id)).size
  const pendingHt = variableInvoices.filter(i => i.status === 'a_verifier').reduce((s, i) => s + i.amount_ht, 0)

  // Répartition — partition des sociétés selon l'état ENREGISTRÉ (splits), pas le brouillon en cours,
  // pour qu'une ligne ne saute pas d'onglet pendant la saisie (elle bascule à l'enregistrement).
  const repartiKeys = new Set(splits.map(s => s.supplier_key))
  const splitEntries = Object.entries(splitDraft).sort((a, b) => a[1].label.localeCompare(b[1].label, 'fr'))
  const splitsTodo = splitEntries.filter(([key]) => !repartiKeys.has(key))
  const splitsDone = splitEntries.filter(([key]) => repartiKeys.has(key))
  const variableTotalHt  = variableInvoices.reduce((s, i) => s + i.amount_ht, 0)
  const variableTotalTtc = variableInvoices.reduce((s, i) => s + i.amount_ttc, 0)

  // ── Charges récurrentes : provision de CETTE semaine, au jour près (le réel remplace la provision) ──
  const recurWeek = weekRecurringCost(recurringCharges, recurringActuals, monISO, sunISO)
  const recurringWeekly = recurWeek.total
  const chargeHasActualThisWeek: Record<string, boolean> = {}
  for (const l of recurWeek.lines) chargeHasActualThisWeek[l.id] = l.hasActual
  const activeRecurring = [...recurringCharges].sort((a, b) => a.label.localeCompare(b.label, 'fr'))

  /** Ligne du tableau d'achats — partagée entre la vue « par date » et la vue « par catégorie » */
  const renderInvoiceRow = (inv: Invoice) => {
    const cat = catInfo(inv.category)
    const sp = matchSplit(inv.supplier_name, splits)
    const ventil = sp ? VENT_FIELDS.map(r => ({ label: r.label, dot: r.dot, pct: Number((sp as any)[`pct_${r.key}`]) || 0 })).filter(p => p.pct > 0) : []
    const ownSplits = invSplits[inv.id] ?? []
    return (
      <tr key={inv.id} className="border-t border-gray-50 hover:bg-gray-50 group transition-colors">
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-pilote-50 text-pilote flex items-center justify-center text-[11px] font-extrabold flex-shrink-0">{initials(inv.supplier_name)}</div>
            <div>
              <div className="font-semibold text-sm text-gray-900">{inv.supplier_name}</div>
              {inv.invoice_number && <div className="text-xs text-gray-400">{inv.invoice_number}</div>}
              {inv.status === 'a_verifier' && (
                <button onClick={() => validateInvoice(inv)} title="Importée automatiquement — cliquer pour valider (elle comptera dans les marges)"
                  className="mt-0.5 inline-flex items-center gap-1 text-[9px] font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 px-1.5 py-0.5 rounded-full transition-colors">
                  à vérifier · valider
                </button>
              )}
            </div>
          </div>
        </td>
        <td className="px-4 py-2.5">
          {ownSplits.length > 0 ? (
            // Ventilation PROPRE À CETTE FACTURE (référentiel) — prime sur celle du fournisseur
            <button onClick={() => setVentInvoice(inv)} title="Ventilation propre à cette facture — cliquer pour modifier"
              className="flex flex-wrap items-center gap-1 text-left">
              {ownSplits.map(s => {
                const fam = ventFamilies.find(f => f.id === s.family_id)
                return (
                  <span key={s.family_id} className="inline-flex items-center gap-1 text-[11px] font-semibold text-pilote bg-pilote-50 ring-1 ring-pilote-100 rounded-full px-2 py-0.5">
                    {fam?.name ?? '?'} {Math.round(s.pct)} %
                  </span>
                )
              })}
            </button>
          ) : ventil.length === 0 ? (
            <div className="flex items-center gap-1.5">
              <button onClick={openSplits} title="Définir la répartition par rayon de cette société"
                className="text-xs text-gray-400 hover:text-pilote hover:underline">Non réparti</button>
              <button onClick={() => setVentInvoice(inv)} title="Ventiler uniquement cette facture (familles et sous-familles)"
                className="text-[10px] text-gray-300 hover:text-pilote hover:underline">· cette facture</button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1">
              {ventil.map(p => (
                <span key={p.label} className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-700 bg-gray-50 rounded-full px-2 py-0.5">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: p.dot }} />
                  {p.label} {Math.round(p.pct)} %
                </span>
              ))}
              <button onClick={() => setVentInvoice(inv)} title="Ventiler uniquement cette facture, sans toucher les autres factures de ce fournisseur"
                className="p-1 rounded text-gray-300 hover:text-pilote hover:bg-pilote-50 transition-colors opacity-0 group-hover:opacity-100">
                <PieChart className="w-3 h-3" />
              </button>
            </div>
          )}
        </td>
        <td className="px-4 py-2.5 text-sm text-gray-600">{new Date(inv.invoice_date).toLocaleDateString('fr-FR')}</td>
        <td className={`px-4 py-2.5 text-right font-semibold text-sm ${inv.amount_ht < 0 ? 'text-green-600' : 'text-gray-900'}`}>{fmtEuro(inv.amount_ht)}</td>
        <td className="px-4 py-2.5 text-right text-xs text-gray-400">{inv.tva_rate} %</td>
        <td className="px-4 py-2.5 text-right text-sm text-gray-600">{fmtEuro(inv.amount_ttc)}</td>
        <td className="px-4 py-2.5 text-center">
          <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
            <button onClick={() => moveToFixed(inv)} className="p-1.5 rounded hover:bg-pilote-50 text-gray-300 hover:text-pilote transition-colors" title="Déplacer vers les charges fixes (sort des achats matière)">
              <Repeat className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => deleteInvoice(inv.id)} className="p-1.5 rounded hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors" title="Supprimer">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* Header héro */}
      <div className="bg-white border-b border-gray-100 px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-pilote to-pilote-hover rounded-lg flex items-center justify-center flex-shrink-0 shadow-card">
            <Receipt className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Facturation &amp; Achats</h1>
            <p className="text-sm text-gray-500">Achats de la semaine · Charges structurelles · CA &amp; marge</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowCA(true)} variant="outline" className="h-9 text-sm px-3.5 rounded-xl border-pilote text-pilote hover:bg-pilote-50 transition-colors">
            <Euro className="w-3.5 h-3.5 mr-1.5" />Saisir le CA
          </Button>
          <Button onClick={openAdd} className="bg-pilote hover:bg-pilote-hover text-white h-9 text-sm px-3.5 rounded-xl shadow-card active:scale-95 transition-all">
            <Plus className="w-3.5 h-3.5 mr-1.5" />Ajouter une facture
          </Button>
          <button onClick={openSplits} title="Répartir les achats par rayon, fournisseur par fournisseur"
            className="h-9 text-sm px-3 rounded-xl border border-gray-100 text-gray-600 shadow-card hover:text-pilote transition-colors flex items-center gap-1.5">
            <PieChart className="w-3.5 h-3.5" />Répartition
          </button>
          <button onClick={openFamilles} title="Choisir les 3 familles de marge"
            className="h-9 text-sm px-3 rounded-xl border border-gray-100 text-gray-600 shadow-card hover:text-pilote transition-colors">
            Familles
          </button>
          <button onClick={() => { setTvaDraft(String(summary?.tva_rate ?? DEFAULT_TVA_RATE).replace('.', ',')); setShowSettings(true) }} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors">
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Week nav */}
      <div className="bg-white border-b border-gray-100 px-6 py-2.5 flex items-center gap-2">
        <div className="flex items-center gap-1 bg-gray-50 border border-gray-100 rounded-lg px-1 py-0.5">
          <button onClick={prevWeek} className="p-1.5 rounded-xl hover:bg-white hover:shadow-sm transition-all"><ChevronLeft className="w-4 h-4 text-gray-500" /></button>
          <div className="flex items-center gap-2 px-2">
            <span className="font-bold text-gray-900 text-sm">Semaine {week}</span>
            <span className="text-gray-300 text-sm">·</span>
            <span className="text-xs text-gray-500 tabular">{fmtDate(mon)} – {fmtDate(sun)}</span>
            {isCurrentWeek && <span className="text-[10px] bg-pilote text-white px-1.5 py-0.5 rounded-lg font-semibold">En cours</span>}
            {isLastWeek && !isCurrentWeek && <span className="text-[10px] bg-amber-500 text-white px-1.5 py-0.5 rounded-lg font-semibold">Semaine écoulée</span>}
          </div>
          <button onClick={nextWeek} className="p-1.5 rounded-xl hover:bg-white hover:shadow-sm transition-all"><ChevronRight className="w-4 h-4 text-gray-500" /></button>
        </div>
        {!isLastWeek && <button onClick={() => { setWeek(lastWeek.week); setYear(lastWeek.year) }} className="text-xs text-pilote font-medium hover:underline">← Semaine écoulée</button>}
        {!isCurrentWeek && <button onClick={() => { setWeek(cw); setYear(cy) }} className="text-xs text-gray-400 hover:text-gray-600 hover:underline transition-colors">Semaine en cours →</button>}

        {/* Intégrations compactes */}
        <div className="ml-auto flex items-center gap-2">
          {integrations.map(integ => {
            const meta = PROVIDERS_META.find(p => p.id === integ.provider)
            if (!meta) return null
            const isSyncing = syncing === integ.provider
            return (
              <div key={integ.provider} className="flex items-center gap-1.5 bg-green-50 border border-green-200 rounded-lg pl-2 pr-1 py-1">
                <div className={`w-5 h-5 rounded ${meta.color} flex items-center justify-center text-white text-[8px] font-extrabold`}>{meta.logo}</div>
                <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                {integ.last_sync_status === 'error' && <span className="text-[9px] text-red-500 font-semibold">erreur</span>}
                <button onClick={() => syncNow(integ.provider)} disabled={isSyncing}
                  className="flex items-center gap-1 text-[11px] font-semibold text-green-800 hover:text-green-900 px-1.5 py-0.5 rounded hover:bg-green-100 transition-colors disabled:opacity-50"
                  title={`Synchroniser la semaine ${week}`}>
                  <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />{isSyncing ? '...' : `Sync S${week}`}
                </button>
                <button onClick={() => disconnectIntegration(integ.provider)} className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors" title="Déconnecter">
                  <Link2Off className="w-3 h-3" />
                </button>
              </div>
            )
          })}
          <button onClick={() => setShowProviders(v => !v)}
            className="flex items-center gap-1 text-xs font-semibold text-pilote border border-dashed border-gray-300 rounded-xl px-2.5 py-1.5 hover:border-pilote transition-colors">
            <Link2 className="w-3 h-3" />{integrations.length === 0 ? 'Connecter un logiciel' : 'Ajouter'}
          </button>
        </div>
      </div>

      {/* Panneau intégrations (replié par défaut) */}
      {showProviders && (
        <div className="bg-white border-b border-gray-100 px-6 py-4 space-y-4">
          {/* ── Sans logiciel de facturation : l'adresse de transfert ── */}
          <div className="rounded-2xl border border-pilote-100 bg-pilote-50/40 p-4">
            <div className="flex items-start gap-3 flex-wrap">
              <div className="w-8 h-8 rounded-lg bg-pilote flex items-center justify-center flex-shrink-0">
                <Mail className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1 min-w-[240px]">
                <p className="font-bold text-sm text-gray-900">Pas de logiciel de facturation ? Transférez vos factures par email</p>
                <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
                  Vous transférez la facture reçue de votre fournisseur à votre adresse PILOTE ; la pièce jointe PDF est
                  archivée et lue exactement comme une facture synchronisée — lignes, mercuriale, prix du jour.
                  Elle arrive « à vérifier » et n&apos;entre dans vos marges qu&apos;après votre validation.
                </p>
              </div>
            </div>

            {mail.verified && mail.forward_id ? (
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <code className="text-xs font-semibold text-pilote-800 bg-white ring-1 ring-pilote-100 rounded-lg px-3 py-2 tabular">
                  factures-{mail.forward_id}@getpilote.app
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(`factures-${mail.forward_id}@getpilote.app`)
                      .then(() => { setMailCopie(true); setTimeout(() => setMailCopie(false), 2000) })
                      .catch(() => setMailMsg({ ok: false, texte: 'Copie impossible — sélectionnez l\'adresse à la main.' }))
                  }}
                  className="flex items-center gap-1.5 text-xs font-semibold text-pilote border border-pilote-200 bg-white rounded-lg px-2.5 py-2 hover:bg-pilote-50 transition-colors">
                  {mailCopie ? <><Check className="w-3.5 h-3.5" />Copiée</> : <><Copy className="w-3.5 h-3.5" />Copier</>}
                </button>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-700 bg-green-50 rounded-full px-2 py-1">
                  <Check className="w-3 h-3" />Adresse active{mail.email ? ` · vérifiée sur ${mail.email}` : ''}
                </span>
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {mailStep === 'idle' ? (
                  <>
                    <Input value={mailAddr} onChange={e => setMailAddr(e.target.value)} placeholder="votre@email.fr"
                      className="h-9 text-sm max-w-[240px]" />
                    <Button onClick={envoyerCodeMail} disabled={mailBusy}
                      className="h-9 bg-pilote hover:bg-pilote-hover text-white text-xs">
                      {mailBusy ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Envoi…</> : 'Recevoir le code'}
                    </Button>
                    <span className="text-[11px] text-gray-400">Une seule fois : on vérifie que l&apos;adresse est bien la vôtre.</span>
                  </>
                ) : (
                  <>
                    <Input value={mailCode} onChange={e => setMailCode(e.target.value)} placeholder="123456" inputMode="numeric"
                      className="h-9 text-sm max-w-[120px] tabular" />
                    <Button onClick={validerCodeMail} disabled={mailBusy}
                      className="h-9 bg-pilote hover:bg-pilote-hover text-white text-xs">
                      {mailBusy ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Validation…</> : 'Valider'}
                    </Button>
                    <button onClick={() => { setMailStep('idle'); setMailMsg(null) }}
                      className="text-[11px] font-semibold text-gray-500 hover:text-gray-700">Changer d&apos;adresse</button>
                  </>
                )}
              </div>
            )}
            {mailMsg && (
              <p className={`text-[11px] mt-2 font-medium ${mailMsg.ok ? 'text-green-700' : 'text-red-600'}`}>{mailMsg.texte}</p>
            )}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {PROVIDERS_META.filter(p => !integrations.find(i => i.provider === p.id)).map(prov => (
              <div key={prov.id} className="rounded-lg border-2 border-dashed border-gray-200 hover:border-gray-300 bg-gray-50/30 p-4 transition-all">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-8 h-8 rounded-lg ${prov.color} flex items-center justify-center text-white text-[10px] font-extrabold flex-shrink-0`}>{prov.logo}</div>
                  <span className="font-bold text-sm text-gray-900">{prov.name}</span>
                </div>
                <p className="text-[10px] text-gray-400 mb-3 leading-relaxed">{prov.description}</p>
                <button onClick={() => { setConnectProvider(prov); setConnectToken(''); setConnectCompanyId(''); setConnectError(''); setShowConnect(true) }}
                  className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold bg-pilote text-white rounded-xl py-1.5 hover:bg-pilote-hover transition-colors">
                  <Link2 className="w-3 h-3" />Connecter
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 px-6 py-6 space-y-6">

        {/* Factures à vérifier — importées automatiquement, exclues des marges tant que non validées */}
        {pendingCount > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <p className="text-sm text-amber-800"><strong>{pendingCount} facture{pendingCount > 1 ? 's' : ''} à vérifier</strong> — importée{pendingCount > 1 ? 's' : ''} automatiquement, exclue{pendingCount > 1 ? 's' : ''} du calcul des marges tant que non validée{pendingCount > 1 ? 's' : ''}.</p>
            <button onClick={validateAllPending} className="ml-auto text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl px-3 py-1.5 transition-colors flex-shrink-0">Tout valider</button>
          </div>
        )}

        {/* ── Achats de la semaine — triables par catégorie (sous-totaux) ou par date ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold text-gray-900">Achats de la semaine {week}</h2>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-0.5 bg-gray-50 border border-gray-100 rounded-lg p-0.5">
                {([['categorie', 'Par catégorie'], ['date', 'Par date']] as const).map(([key, label]) => (
                  <button key={key} onClick={() => setInvoiceView(key)}
                    className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all ${invoiceView === key ? 'bg-white text-pilote shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <span className="text-xs text-gray-400 tabular">{variableInvoices.length} facture{variableInvoices.length > 1 ? 's' : ''} · {fmtEuro(variableTotalHt)} HT</span>
            </div>
          </div>
          {loading ? (
            <div className="p-6 animate-pulse space-y-3">
              <div className="h-10 bg-gray-100 rounded-lg" />
              <div className="h-10 bg-gray-100 rounded-lg" />
              <div className="h-10 bg-gray-100 rounded-lg" />
            </div>
          ) : variableInvoices.length === 0 ? (
            <div className="py-14 flex flex-col items-center justify-center text-center bg-gradient-to-b from-pilote-50/30 to-white">
              <div className="w-14 h-14 rounded-lg bg-gradient-to-br from-pilote-50 to-pilote-100 ring-1 ring-pilote-200/60 flex items-center justify-center mb-4 shadow-sm">
                <ShoppingCart className="w-6 h-6 text-pilote" />
              </div>
              <p className="text-sm font-bold text-gray-900">Aucun achat sur la semaine {week}</p>
              <p className="text-xs text-gray-400 mt-1 max-w-xs">Lancez un sync pour importer les factures, ou ajoutez-les à la main.</p>
              <button onClick={openAdd} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-pilote hover:bg-pilote-hover rounded-xl px-4 py-2 shadow-card active:scale-95 transition-all">
                <Plus className="w-3.5 h-3.5" />Ajouter une facture
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full tabular min-w-[720px]">
                <thead>
                  <tr className="bg-gray-50 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                    <th className="px-4 py-2.5 text-left">Fournisseur</th>
                    <th className="px-4 py-2.5 text-left">Ventilation</th>
                    <th className="px-4 py-2.5 text-left">Date</th>
                    <th className="px-4 py-2.5 text-right">HT</th>
                    <th className="px-4 py-2.5 text-right">TVA</th>
                    <th className="px-4 py-2.5 text-right">TTC</th>
                    <th className="px-4 py-2.5 text-center w-24"></th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceView === 'date'
                    ? sortedVariable.map(renderInvoiceRow)
                    : invoiceGroups.map(g => (
                        <Fragment key={g.cat.key}>
                          <tr className="border-t border-gray-100 bg-gray-50/80">
                            <td colSpan={3} className="px-4 py-2">
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-500">
                                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: g.cat.dot }} />
                                {g.cat.label}
                                <span className="font-semibold normal-case tracking-normal text-gray-400">· {g.rows.length} facture{g.rows.length > 1 ? 's' : ''}</span>
                              </span>
                            </td>
                            <td className="px-4 py-2 text-right text-xs font-bold text-gray-700 tabular">{fmtEuro(g.rows.reduce((s, i) => s + i.amount_ht, 0))}</td>
                            <td></td>
                            <td className="px-4 py-2 text-right text-xs font-semibold text-gray-500 tabular">{fmtEuro(g.rows.reduce((s, i) => s + i.amount_ttc, 0))}</td>
                            <td></td>
                          </tr>
                          {g.rows.map(renderInvoiceRow)}
                        </Fragment>
                      ))}
                </tbody>
                <tfoot>
                  <tr className="bg-pilote text-white">
                    <td colSpan={3} className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white/60">
                      Total achats variables
                      {pendingHt > 0 && <span className="normal-case tracking-normal font-semibold text-white/50"> · dont {fmtEuro(pendingHt)} à vérifier</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold">{fmtEuro(variableTotalHt)}</td>
                    <td className="px-4 py-2.5"></td>
                    <td className="px-4 py-2.5 text-right font-bold text-orange-300">{fmtEuro(variableTotalTtc)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* ── Factures déplacées en charges fixes cette semaine : hors marges
            matière, classées dans une famille de charge PERSONNALISABLE ── */}
        {invoices.filter(i => i.is_fixed_charge).length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-2">
              <div>
                <h2 className="font-bold text-gray-900 text-sm">En charges fixes cette semaine</h2>
                <p className="text-[11px] text-gray-400">Sorties des achats matière — elles ne pèsent sur aucune marge. Classez-les dans une famille de charge.</p>
              </div>
            </div>
            <div className="divide-y divide-gray-50">
              {invoices.filter(i => i.is_fixed_charge).map(inv => (
                <div key={inv.id} className="px-5 py-2.5 flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-[180px]">
                    <p className="text-sm font-semibold text-gray-900">{inv.supplier_name}</p>
                    <p className="text-[11px] text-gray-400 tabular">{new Date(inv.invoice_date).toLocaleDateString('fr-FR')}{inv.invoice_number ? ` · ${inv.invoice_number}` : ''}</p>
                  </div>
                  <span className="text-sm font-semibold text-gray-700 tabular">{fmtEuro(inv.amount_ht)}</span>
                  <select value={(inv as any).charge_family_id ?? ''} onChange={e => setChargeFam(inv, e.target.value)}
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200">
                    <option value="">Famille de charge…</option>
                    {chargeFamilies.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                  {/* Facture mal transmise ? Le boucher fournit le document, la
                      lecture juge sur pièce : matière → retour en achats tout
                      seul ; charge → elle reste ici, confirmée. (lot 31) */}
                  {documentRemplacable(inv) && (
                    <label className={`text-[11px] font-bold rounded-lg px-2.5 py-1.5 cursor-pointer transition-colors ${televersant === inv.id ? 'text-gray-400 bg-gray-100' : 'text-white bg-pilote hover:bg-pilote-hover shadow-card'}`}
                      title="Joindre le PDF de cette facture : sa lecture décidera si c'est de la matière (retour en achats) ou bien une charge">
                      {televersant === inv.id ? 'Lecture…' : 'Téléverser la facture'}
                      <input type="file" accept="application/pdf,.pdf" className="hidden" disabled={televersant !== null}
                        onChange={e => { const f = e.target.files?.[0] ?? null; e.target.value = ''; televerserDocument(inv, f) }} />
                    </label>
                  )}
                  <button onClick={() => moveBackToVariable(inv)}
                    className="text-[11px] font-semibold text-gray-400 hover:text-pilote hover:underline">Repasser en achats</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Charges fixes & récurrentes (provision au jour près) ── */}
        <div className="bg-white rounded-2xl border border-pilote-100 shadow-card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-pilote-100 bg-pilote-50/60 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-white ring-1 ring-pilote-200/60 flex items-center justify-center flex-shrink-0"><Repeat className="w-4 h-4 text-pilote" /></div>
              <div className="min-w-0">
                <h2 className="font-bold text-gray-900">Charges fixes &amp; récurrentes</h2>
                <p className="text-[11px] text-gray-400">Loyer, énergie, assurance, crédit… étalées au jour près sur chaque semaine. Le réel remplace la provision sur sa période.</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="text-right mr-1 hidden sm:block">
                <p className="text-sm font-bold text-pilote tabular">≈ {fmtEuro(recurringWeekly)}/sem</p>
                <p className="text-[10px] text-gray-400">semaine {week}</p>
              </div>
              <button onClick={() => { setReconYear(year); setReconChargeId(activeRecurring[0]?.id || ''); setActualDraft({}); setShowReconcile(true) }}
                disabled={activeRecurring.length === 0}
                className="inline-flex items-center gap-1.5 rounded-xl border border-pilote-200 text-pilote bg-white hover:bg-pilote-50 px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40">
                <Scale className="w-3.5 h-3.5" />Réconcilier
              </button>
              <button onClick={openNewRecurring}
                className="inline-flex items-center gap-1.5 rounded-xl bg-pilote hover:bg-pilote-hover text-white px-3 py-1.5 text-xs font-semibold shadow-card active:scale-[0.98] transition-all">
                <Plus className="w-3.5 h-3.5" />Ajouter
              </button>
            </div>
          </div>
          {loading ? (
            <div className="p-6 animate-pulse"><div className="h-10 bg-gray-100 rounded-lg" /></div>
          ) : activeRecurring.length === 0 ? (
            <div className="py-10 flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 rounded-lg bg-gray-50 ring-1 ring-gray-200/70 flex items-center justify-center mb-3">
                <Repeat className="w-5 h-5 text-gray-300" />
              </div>
              <p className="text-sm font-semibold text-gray-700">Aucune charge récurrente</p>
              <p className="text-xs text-gray-400 mt-1 max-w-sm">Ajoutez vos charges fixes (loyer, énergie, assurance, crédit, abonnements). Elles pèseront automatiquement, au jour près, sur chaque semaine.</p>
              <button onClick={openNewRecurring} className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-pilote hover:bg-pilote-hover text-white px-3.5 py-2 text-xs font-semibold shadow-card active:scale-[0.98] transition-all"><Plus className="w-3.5 h-3.5" />Ajouter une charge</button>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full tabular min-w-[720px]">
              <thead>
                <tr className="bg-gray-50 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  <th className="px-4 py-2.5 text-left">Charge</th>
                  <th className="px-4 py-2.5 text-left">Catégorie</th>
                  <th className="px-4 py-2.5 text-right">Montant</th>
                  <th className="px-4 py-2.5 text-center">Périodicité</th>
                  <th className="px-4 py-2.5 text-left">Période active</th>
                  <th className="px-4 py-2.5 text-right">Provision hebdo</th>
                  <th className="px-4 py-2.5 text-center w-24"></th>
                </tr>
              </thead>
              <tbody>
                {activeRecurring.map((c, i) => {
                  const wk = costForWindow(c, recurringActuals, monISO, sunISO)
                  const hasAct = chargeHasActualThisWeek[c.id]
                  const ended = !!c.end_date && c.end_date < monISO
                  const notStarted = c.start_date > sunISO
                  return (
                    <tr key={c.id} className={`border-t border-gray-100 hover:bg-pilote-50/40 group transition-colors ${i % 2 === 0 ? '' : 'bg-gray-50/50'} ${c.active ? '' : 'opacity-60'}`}>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center flex-shrink-0"><CalendarClock className="w-4 h-4" /></div>
                          <div>
                            <div className="font-semibold text-sm text-gray-900">{c.label}</div>
                            {!c.active && <div className="text-[10px] font-semibold text-gray-400">clôturée</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-xs font-semibold rounded-full px-2.5 py-0.5 ${catInfo(c.category).color}`}>{catInfo(c.category).label}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="font-semibold text-sm text-gray-900">{fmtEuro(c.amount_ht)}</span>
                        <span className="text-[10px] text-gray-400"> {periodicityShort(c.periodicity)}</span>
                      </td>
                      <td className="px-4 py-2.5 text-center text-xs text-gray-600">{periodicityLabel(c.periodicity)}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                        {new Date(c.start_date).toLocaleDateString('fr-FR')} → {c.end_date ? new Date(c.end_date).toLocaleDateString('fr-FR') : '…'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {wk > 0 ? (
                          <>
                            <span className="font-bold text-sm text-pilote tabular">≈ {fmtEuro(wk)}</span>
                            {hasAct && <span className="ml-1 text-[9px] font-bold text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full align-middle">réel</span>}
                          </>
                        ) : (
                          <span className="text-xs text-gray-300">{notStarted ? 'à venir' : ended ? 'terminée' : '—'}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <div className="flex items-center justify-center gap-1 md:opacity-0 md:group-hover:opacity-100 transition-all">
                          <button onClick={() => { setReconYear(year); setReconChargeId(c.id); setActualDraft({}); setShowReconcile(true) }} className="p-1.5 rounded hover:bg-pilote-50 text-gray-300 hover:text-pilote transition-colors" title="Réconcilier (saisir le réel par période)"><Scale className="w-3.5 h-3.5" /></button>
                          <button onClick={() => openEditRecurring(c)} className="p-1.5 rounded hover:bg-gray-100 text-gray-300 hover:text-gray-600 transition-colors" title="Modifier"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => deleteRecurring(c)} className="p-1.5 rounded hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors" title="Supprimer"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-pilote text-white">
                  <td colSpan={5} className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white/60">Provision de la semaine {week}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-orange-300">≈ {fmtEuro(recurringWeekly)}/sem</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
            </div>
          )}
        </div>
      </div>

      {/* Modal : Charge récurrente (création / édition) */}
      {showRecurring && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm p-4" onClick={() => setShowRecurring(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="text-base font-bold text-gray-900">{recForm.id ? 'Modifier la charge' : 'Nouvelle charge récurrente'}</h2>
              <button onClick={() => setShowRecurring(false)} className="p-1.5 rounded-xl hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Libellé</label>
                <Input value={recForm.label} onChange={e => setRecForm(p => ({ ...p, label: e.target.value }))} placeholder="Loyer, EDF, assurance…" autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Montant HT (€)</label>
                  <Input type="number" step="0.01" min="0" value={recForm.amount_ht} onChange={e => setRecForm(p => ({ ...p, amount_ht: e.target.value }))} placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Périodicité</label>
                  <select value={recForm.periodicity} onChange={e => setRecForm(p => ({ ...p, periodicity: e.target.value as Periodicity }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200">
                    {PERIODICITY_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Catégorie</label>
                  <select value={recForm.category} onChange={e => setRecForm(p => ({ ...p, category: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200">
                    {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">TVA (%)</label>
                  <select value={recForm.tva_rate} onChange={e => setRecForm(p => ({ ...p, tva_rate: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200">
                    {TVA_RATES.map(t => <option key={t} value={String(t)}>{t} %</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Début</label>
                  <Input type="date" value={recForm.start_date} onChange={e => setRecForm(p => ({ ...p, start_date: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Fin <span className="text-gray-400 font-normal">(optionnel)</span></label>
                  <Input type="date" value={recForm.end_date} onChange={e => setRecForm(p => ({ ...p, end_date: e.target.value }))} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={recForm.active} onChange={e => setRecForm(p => ({ ...p, active: e.target.checked }))} className="rounded border-gray-300 text-pilote focus:ring-pilote-200" />
                Charge active (décochez pour la geler sans la supprimer)
              </label>
              <p className="text-[11px] text-gray-400">Le montant saisi est celui d&apos;UNE période ({periodicityLabel(recForm.periodicity).toLowerCase()}). Il est réparti au jour près sur les semaines couvertes.</p>
            </div>
            <div className="flex gap-2 p-5 border-t border-gray-100">
              <Button variant="outline" className="flex-1" onClick={() => setShowRecurring(false)}>Annuler</Button>
              <Button onClick={saveRecurring} disabled={recSaving} className="flex-1 bg-pilote hover:bg-pilote-hover text-white">
                {recSaving ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Enregistrement...</> : <><Save className="w-4 h-4 mr-1.5" />Enregistrer</>}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal : Réconciliation provisionné vs réel */}
      {showReconcile && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm p-4" onClick={() => setShowReconcile(false)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between p-5 border-b border-gray-100">
              <div>
                <h2 className="text-base font-bold text-gray-900">Réconciliation — provisionné vs réel</h2>
                <p className="text-xs text-gray-500 mt-0.5 max-w-md">Saisissez le montant réel facturé pour une période. Il remplace la provision sur sa fenêtre — le résultat net des semaines concernées est recalculé.</p>
              </div>
              <button onClick={() => setShowReconcile(false)} className="p-1.5 rounded-xl hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="flex items-center gap-2 px-5 pt-3">
              <select value={reconChargeId} onChange={e => { setReconChargeId(e.target.value); setActualDraft({}) }} className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200">
                {activeRecurring.map(c => <option key={c.id} value={c.id}>{c.label} · {periodicityLabel(c.periodicity)}</option>)}
              </select>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => setReconYear(y => y - 1)} className="p-1.5 rounded-xl hover:bg-gray-100"><ChevronLeft className="w-4 h-4 text-gray-500" /></button>
                <span className="text-sm font-bold text-gray-900 tabular w-12 text-center">{reconYear}</span>
                <button onClick={() => setReconYear(y => y + 1)} className="p-1.5 rounded-xl hover:bg-gray-100"><ChevronRight className="w-4 h-4 text-gray-500" /></button>
              </div>
            </div>
            <div className="p-5 pt-3 overflow-y-auto">
              {(() => {
                const c = recurringCharges.find(x => x.id === reconChargeId)
                if (!c) return <p className="text-sm text-gray-400 py-8 text-center">Sélectionnez une charge.</p>
                const periods = enumeratePeriods(c, `${reconYear}-01-01`, `${reconYear}-12-31`)
                if (periods.length === 0) return <p className="text-sm text-gray-400 py-8 text-center">Aucune période active en {reconYear}.</p>
                return (
                  <>
                    <div className="hidden md:flex items-center gap-2 px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                      <span className="w-28">Période</span>
                      <span className="flex-1 text-right">Provisionné</span>
                      <span className="flex-1 text-right">Réel</span>
                      <span className="flex-1 text-right">Écart</span>
                      <span className="w-24" />
                    </div>
                    <div className="space-y-1.5">
                      {periods.map(occ => {
                        const sISO = occ.start.toISOString().slice(0, 10)
                        const eISO = occ.end.toISOString().slice(0, 10)
                        const prov = provisionForWindow(c, sISO, eISO)
                        const act = recurringActuals.find(a => a.recurring_charge_id === c.id && a.period_start <= eISO && a.period_end >= sISO)
                        const draft = actualDraft[occ.key] ?? ''
                        const ecart = act ? Number(act.amount_ht) - prov : 0
                        return (
                          <div key={occ.key} className="flex flex-col md:flex-row md:items-center gap-2 p-2 rounded-lg hover:bg-gray-50">
                            <span className="w-28 text-sm font-semibold text-gray-800">{occ.label}</span>
                            <span className="flex-1 text-right text-sm text-gray-600 tabular">{fmtEuro(prov)}</span>
                            {act ? (
                              <>
                                <span className="flex-1 text-right text-sm font-semibold text-gray-900 tabular">{fmtEuro(Number(act.amount_ht))}</span>
                                <span className={`flex-1 text-right text-sm font-bold tabular ${ecart > 0 ? 'text-red-500' : ecart < 0 ? 'text-green-600' : 'text-gray-400'}`}>{ecart > 0 ? '+' : ''}{fmtEuro(ecart)}</span>
                                <span className="w-24 flex justify-end"><button onClick={() => deleteActual(act.id)} className="text-xs font-medium text-gray-400 hover:text-red-500">Retirer</button></span>
                              </>
                            ) : (
                              <>
                                <div className="flex-1 flex justify-end">
                                  <input type="number" step="0.01" min="0" value={draft} onChange={e => setActualDraft(p => ({ ...p, [occ.key]: e.target.value }))} placeholder="réel €" className="w-24 border border-gray-300 rounded-lg px-2 py-1 text-sm text-right tabular focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                                </div>
                                <span className="flex-1 text-right text-xs text-gray-300">—</span>
                                <span className="w-24 flex justify-end">
                                  <button disabled={!draft} onClick={() => { saveActual(c.id, sISO, eISO, parseFloat(draft) || 0); setActualDraft(p => { const n = { ...p }; delete n[occ.key]; return n }) }} className="text-xs font-semibold text-pilote hover:underline disabled:opacity-40">Enregistrer</button>
                                </span>
                              </>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </>
                )
              })()}
              <p className="text-[11px] text-gray-400 mt-3">Écart = réel − provisionné. Un écart positif (rouge) = la charge réelle a dépassé la provision ; les semaines de la période sont recalculées avec le réel.</p>
            </div>
            <div className="flex gap-2 p-5 border-t border-gray-100">
              <Button variant="outline" className="flex-1" onClick={() => setShowReconcile(false)}>Fermer</Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal : Connecter intégration */}
      {showConnect && connectProvider && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm" onClick={() => setShowConnect(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg ${connectProvider.color} flex items-center justify-center text-white text-xs font-extrabold`}>{connectProvider.logo}</div>
                <div><h2 className="text-base font-bold text-gray-900">Connecter {connectProvider.name}</h2><p className="text-xs text-gray-400">{connectProvider.description}</p></div>
              </div>
              <button onClick={() => setShowConnect(false)} className="p-1.5 rounded-xl hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">{connectProvider.tokenLabel} *</label>
                <Input value={connectToken} onChange={e => setConnectToken(e.target.value)} placeholder={connectProvider.tokenPlaceholder} type="password" autoFocus />
              </div>
              {connectProvider.needsCompanyId && (
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">{connectProvider.companyIdLabel} *</label>
                  <Input value={connectCompanyId} onChange={e => setConnectCompanyId(e.target.value)} placeholder="Identifiant de votre entreprise" />
                </div>
              )}
              <p className="text-[10px] text-gray-400">Votre token est chiffré et stocké de manière sécurisée. <a href={connectProvider.helpUrl} target="_blank" rel="noreferrer" className="text-pilote underline">Comment trouver mon token ?</a></p>
              {connectError && <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />{connectError}</div>}
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setShowConnect(false)}>Annuler</Button>
                <Button className="flex-1 bg-pilote hover:bg-pilote-hover text-white" onClick={connectIntegration} disabled={!connectToken || connecting || (connectProvider.needsCompanyId && !connectCompanyId)}>
                  {connecting ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Test en cours...</> : <><Link2 className="w-4 h-4 mr-1.5" />Connecter</>}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal : Ajouter facture */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm p-4" onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-gray-900">Nouvelle facture</h2>
              <button onClick={() => setShowAdd(false)} className="p-1.5 rounded-xl hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="space-y-4">
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-gray-600 mb-1">Fournisseur *</label>
                <Input list="suppliers-memo" value={newInvoice.supplier_name} onChange={e => {
                  const supplier_name = e.target.value
                  const m = memoTouched ? null : matchSupplier(supplier_name, suppliersMemo)
                  setNewInvoice((p: any) => ({
                    ...p, supplier_name,
                    ...(m ? { category: m.category } : {}),
                    ...(m && m.tva_rate !== null && TVA_RATES.includes(m.tva_rate) ? { tva_rate: String(m.tva_rate) } : {}),
                  }))
                }} placeholder="Bigard, Maison Dupont..." autoFocus />
                <datalist id="suppliers-memo">
                  {suppliersMemo.map(m => <option key={m.name.toLowerCase()} value={m.name} />)}
                </datalist>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">N° facture</label>
                  <Input value={newInvoice.invoice_number} onChange={e => setNewInvoice((p: any) => ({ ...p, invoice_number: e.target.value }))} placeholder="F-2024-001" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Date *</label>
                  <Input type="date" value={newInvoice.invoice_date} onChange={e => setNewInvoice((p: any) => ({ ...p, invoice_date: e.target.value }))} />
                </div>
              </div>
              {newInvoice.invoice_date && (newInvoice.invoice_date < monISO || newInvoice.invoice_date > sunISO) && (
                <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 -mt-1.5">
                  Cette date est hors de la semaine {week} affichée — la facture sera tout de même comptée sur la semaine {week}.
                </p>
              )}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Catégorie</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {CATEGORIES.map(cat => (
                    <button key={cat.key} onClick={() => { setMemoTouched(true); setCategoryTouched(true); setNewInvoice((p: any) => ({ ...p, category: cat.key })) }}
                      className={`py-1.5 px-2 rounded-xl text-xs font-semibold border-2 transition-all ${
                        newInvoice.category === cat.key ? 'border-pilote bg-pilote text-white' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}>{cat.label}
                    </button>
                  ))}
                </div>
                {supplierMatch && (
                  <p className="text-[11px] text-pilote mt-1.5">
                    {matchHasTva ? 'Catégorie et TVA pré-remplies' : 'Catégorie pré-remplie'} d'après vos achats chez {supplierMatch.name} — modifiable.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Montant HT *</label>
                  <Input type="number" step="0.01" value={newInvoice.amount_ht} onChange={e => setNewInvoice((p: any) => ({ ...p, amount_ht: e.target.value }))} placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Taux TVA (%)</label>
                  <select value={newInvoice.tva_rate} onChange={e => { setMemoTouched(true); setNewInvoice((p: any) => ({ ...p, tva_rate: e.target.value })) }} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-pilote">
                    {TVA_RATES.map(r => <option key={r} value={r}>{r === 0 ? '0 % (exonéré)' : `${r} %`}</option>)}
                  </select>
                </div>
              </div>
              {newInvoice.amount_ht && <div className="bg-gray-50 rounded-lg px-3 py-2 flex items-center justify-between"><span className="text-xs text-gray-500">Montant TTC calculé</span><span className="font-bold text-gray-900">{fmtEuro(ttcAmount)}</span></div>}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Notes</label>
                <Input value={newInvoice.notes} onChange={e => setNewInvoice((p: any) => ({ ...p, notes: e.target.value }))} placeholder="Livraison lundi matin..." />
              </div>
              <div className="border-t border-gray-100 pt-3">
                <label className="block text-xs font-semibold text-gray-600 mb-0.5">Répartition par rayon (%)</label>
                <p className="text-[11px] text-gray-400 mb-2">Mémorisée pour <span className="font-semibold text-gray-600">{newInvoice.supplier_name || 'cette société'}</span> — ré-appliquée automatiquement à ses prochaines factures.</p>
                <div className="grid grid-cols-3 gap-2">
                  {VENT_FIELDS.map(r => (
                    <div key={r.key}>
                      <span className="flex items-center gap-1 text-[10px] text-gray-400 mb-0.5"><span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: r.dot }} />{r.label}</span>
                      <Input type="number" min="0" max="100" value={(newSplit as any)[r.key]}
                        onChange={e => { setSplitTouched(true); setNewSplit((p) => ({ ...p, [r.key]: e.target.value })) }}
                        placeholder="0" />
                    </div>
                  ))}
                </div>
                {(() => {
                  const t = VENT_FIELDS.reduce((s, f) => s + (parseFloat((newSplit as any)[f.key]) || 0), 0)
                  if (!t) return null
                  const ok = Math.abs(t - 100) < 0.5
                  return <p className={`text-[11px] mt-1.5 ${ok ? 'text-gray-400' : 'text-orange-500'}`}>Total {Math.round(t)} %{ok ? '' : ' — devrait faire 100 %'} · le « divers » alimente son propre bloc de marge</p>
                })()}
              </div>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setShowAdd(false)}>Annuler</Button>
                <Button className="flex-1 bg-pilote hover:bg-pilote-hover text-white" onClick={addInvoice} disabled={!newInvoice.supplier_name || !newInvoice.invoice_date || !newInvoice.amount_ht || saving}>
                  {saving ? 'Enregistrement...' : 'Enregistrer'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal : CA */}
      {/* Modal : Répartition des achats par rayon (par fournisseur) */}
      {showSplits && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm p-4" onClick={() => setShowSplits(false)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between p-5 pb-3 border-b border-gray-100">
              <div>
                <h2 className="text-base font-bold text-gray-900">Répartition des achats par rayon</h2>
                <p className="text-xs text-gray-500 mt-0.5 max-w-md">Pour chaque société, indiquez la part (%) de ses achats affectée à chaque rayon. Appliqué automatiquement à toutes ses factures.</p>
              </div>
              <button onClick={() => setShowSplits(false)} className="p-1.5 rounded-xl hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            {/* Onglets : à répartir (sociétés sans ventilation) / toutes les répartitions déjà faites */}
            <div className="flex items-center gap-1.5 px-5 pt-3 pb-1">
              <button onClick={() => setSplitsTab('todo')}
                className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all ${splitsTab === 'todo' ? 'bg-pilote text-white shadow-card' : 'text-gray-500 hover:bg-gray-100'}`}>
                À répartir
                <span className={`rounded-full px-1.5 text-[10px] tabular ${splitsTab === 'todo' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`}>{splitsTodo.length}</span>
              </button>
              <button onClick={() => setSplitsTab('all')}
                className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all ${splitsTab === 'all' ? 'bg-pilote text-white shadow-card' : 'text-gray-500 hover:bg-gray-100'}`}>
                Toutes mes répartitions
                <span className={`rounded-full px-1.5 text-[10px] tabular ${splitsTab === 'all' ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'}`}>{splitsDone.length}</span>
              </button>
            </div>
            <div className="p-5 pt-2 overflow-y-auto">
              {(() => {
                const list = splitsTab === 'todo' ? splitsTodo : splitsDone
                if (list.length === 0) {
                  return splitsTab === 'todo' ? (
                    <div className="text-center py-12">
                      <div className="w-11 h-11 rounded-lg bg-pilote-50 flex items-center justify-center mx-auto mb-3"><Check className="w-5 h-5 text-pilote" /></div>
                      <p className="text-sm font-semibold text-gray-700">Tout est réparti</p>
                      <p className="text-xs text-gray-400 mt-1">{splitSuppliers.length === 0 ? "Ajoutez des factures d'achat pour commencer." : 'Chaque société connue a sa ventilation.'}</p>
                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <div className="w-11 h-11 rounded-lg bg-gray-50 flex items-center justify-center mx-auto mb-3"><PieChart className="w-5 h-5 text-gray-300" /></div>
                      <p className="text-sm font-semibold text-gray-700">Aucune répartition enregistrée</p>
                      <p className="text-xs text-gray-400 mt-1">Renseignez une société dans « À répartir » pour la retrouver ici.</p>
                    </div>
                  )
                }
                return (
                  <>
                    <div className="hidden md:flex items-center gap-2 px-2 pb-2 text-[10px] font-semibold leading-tight text-gray-400">
                      <span className="flex-1">Société</span>
                      <span className="w-16 text-center">Boucherie</span>
                      <span className="w-16 text-center">Charcuterie</span>
                      <span className="w-16 text-center">Traiteur</span>
                      <span className="w-16 text-center">Fruits &amp; légumes</span>
                      <span className="w-16 text-center">Divers</span>
                      <span className="w-16 text-center">Total</span>
                      <span className="w-8 flex-shrink-0" />
                    </div>
                    <div className="space-y-1.5">
                      {list.map(([key, v]) => {
                        const tot = VENT_FIELDS.reduce((s, f) => s + (parseFloat((v as any)[f.key]) || 0), 0)
                        const totOk = tot === 0 || Math.abs(tot - 100) < 0.5
                        const upd = (field: string, val: string) =>
                          setSplitDraft(prev => ({ ...prev, [key]: { ...prev[key], [field]: val } }))
                        const clearRow = () =>
                          setSplitDraft(prev => ({ ...prev, [key]: { ...prev[key], ...emptyVent() } }))
                        return (
                          <div key={key} className="group flex flex-col md:flex-row md:items-center gap-2 p-2 rounded-lg hover:bg-gray-50">
                            <span className="flex-1 text-sm font-medium text-gray-800 truncate" title={v.label}>{v.label}</span>
                            <div className="flex items-center gap-2">
                              {VENT_FIELDS.map(f => (
                                <input key={f.key} type="number" min="0" max="100" value={(v as any)[f.key]} onChange={e => upd(f.key, e.target.value)}
                                  placeholder="0" className="w-16 border border-gray-200 rounded-lg px-1.5 py-1 text-sm text-right tabular focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                              ))}
                              <span className={`w-16 text-center text-xs font-bold tabular ${totOk ? 'text-gray-400' : 'text-orange-500'}`}>{tot ? `${Math.round(tot)}%` : '—'}</span>
                            </div>
                            <div className="w-8 flex-shrink-0 flex justify-center self-end md:self-auto">
                              {splitsTab === 'all' && (
                                <button onClick={clearRow} title="Retirer cette répartition"
                                  className="md:opacity-0 md:group-hover:opacity-100 transition-all p-1.5 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )
              })()}
              <p className="text-[11px] text-gray-400 mt-3">Le total par société devrait faire 100 %. Une société laissée à 0 reste « non répartie » et n&apos;entre pas dans la marge par rayon. Retirer une répartition la renvoie dans « À répartir » après enregistrement.</p>
            </div>
            <div className="flex gap-2 p-5 border-t border-gray-100">
              <Button variant="outline" className="flex-1" onClick={() => setShowSplits(false)}>Fermer</Button>
              <Button onClick={saveSplits} disabled={splitSaving} className="flex-1 bg-pilote hover:bg-pilote-hover text-white">
                {splitSaving ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Enregistrement...</> : <><Save className="w-4 h-4 mr-1.5" />Enregistrer</>}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal : Choix des 3 familles de marge (liste = postes du planning) */}
      {showFamilles && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm p-4" onClick={() => setShowFamilles(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1.5">
              <h2 className="text-base font-bold text-gray-900">Mes 3 familles de marge</h2>
              <button onClick={() => setShowFamilles(false)} className="p-1.5 rounded-xl hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <p className="text-xs text-gray-500 mb-4">La liste vient des postes du planning. Les heures pointées sur un poste, le CA et les achats qui lui ressemblent (« boucher » ≈ « boucherie ») alimentent automatiquement sa marge.</p>
            <div className="space-y-3">
              {[0, 1, 2].map(i => (
                <div key={i}>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Famille {i + 1}</label>
                  <select value={familleDraft[i] ?? ''} onChange={e => setFamilleDraft(prev => { const n = [...prev]; n[i] = e.target.value; return n })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200">
                    {postesList.length === 0 && <option value={familleDraft[i] ?? ''}>{familleDraft[i] ?? ''}</option>}
                    {postesList.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                  </select>
                </div>
              ))}
              {new Set(familleDraft).size !== 3 && (
                <p className="text-[11px] text-amber-600">Choisissez trois familles différentes.</p>
              )}
              <p className="text-[11px] text-gray-400">Il manque un poste (ex. « Prestation ») ? Ajoutez-le depuis le <Link href="/dashboard/planning" className="text-pilote hover:underline">planning</Link>, bouton « Postes » — il apparaîtra ici.</p>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setShowFamilles(false)}>Annuler</Button>
                <Button className="flex-1 bg-pilote hover:bg-pilote-hover text-white" onClick={saveFamilles} disabled={famSaving || new Set(familleDraft).size !== 3}>
                  {famSaving ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Enregistrement...</> : <><Save className="w-4 h-4 mr-1.5" />Enregistrer</>}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ventilation propre à UNE facture (référentiel familles/sous-familles) */}
      {ventInvoice && (
        <VentilationFacture
          invoice={{ id: ventInvoice.id, supplier_name: ventInvoice.supplier_name, amount_ht: ventInvoice.amount_ht }}
          families={ventFamilies}
          current={invSplits[ventInvoice.id] ?? []}
          onClose={() => setVentInvoice(null)}
          onSaved={() => { setVentInvoice(null); load() }}
        />
      )}

      {showCA && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm" onClick={() => setShowCA(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div><h2 className="text-base font-bold text-gray-900">CA de la semaine {week}</h2><p className="text-xs text-gray-400 mt-0.5">{fmtDate(mon)} – {fmtDate(sun)}</p></div>
              <button onClick={() => setShowCA(false)} className="p-1.5 rounded-xl hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">CA Total (€)</label>
                <Input type="number" step="0.01" min="0" value={caForm.ca_total} onChange={e => setCaForm(p => ({ ...p, ca_total: e.target.value }))} placeholder="0.00" className="text-lg font-bold" autoFocus />
              </div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider pt-1">Détail par rayon (optionnel)</p>
              {Array.isArray(summary?.ca_detail?.families_detail) && summary!.ca_detail!.families_detail!.length > 0 && (
                <p className="text-[11px] text-pilote bg-pilote-50 rounded-lg px-2.5 py-1.5">
                  Le détail par rayon est lu automatiquement depuis votre rapport hebdo — cette saisie ne sert que de secours.
                </p>
              )}
              {[{ key: 'ca_boucherie', label: 'Boucherie' }, { key: 'ca_charcuterie', label: 'Charcuterie' }, { key: 'ca_traiteur', label: 'Traiteur' }, { key: 'ca_divers', label: 'Divers' }].map(({ key, label }) => (
                <div key={key} className="flex items-center gap-2">
                  <label className="text-xs text-gray-500 w-28 flex-shrink-0">{label}</label>
                  <Input type="number" step="0.01" min="0" value={(caForm as any)[key]} onChange={e => setCaForm(p => ({ ...p, [key]: e.target.value }))} placeholder="0.00" />
                </div>
              ))}
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowCA(false)}>Annuler</Button>
                <Button className="flex-1 bg-pilote hover:bg-pilote-hover text-white" onClick={saveCA} disabled={saving}>
                  <Check className="w-4 h-4 mr-1.5" />{saving ? 'Enregistrement...' : 'Enregistrer'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal : Paramètres */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm" onClick={() => setShowSettings(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-gray-900">Paramètres entreprise</h2>
              <button onClick={() => setShowSettings(false)} className="p-1.5 rounded-xl hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Nom de l&apos;entreprise</label>
                <Input value={settForm.company_name} onChange={e => setSettForm(p => ({ ...p, company_name: e.target.value }))} placeholder="Boucherie Dupont" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">SIRET</label>
                <Input value={settForm.siret} onChange={e => setSettForm(p => ({ ...p, siret: e.target.value }))} placeholder="123 456 789 00012" />
              </div>
              <div>
                <label htmlFor="tva-rate" className="block text-xs font-semibold text-gray-700 mb-1">Taux de TVA sur le CA</label>
                <Input id="tva-rate" inputMode="decimal" value={tvaDraft} onChange={e => setTvaDraft(e.target.value)} placeholder="5,5" />
                <p className="text-[11px] text-gray-500 mt-1 leading-snug">
                  Sert à ramener votre CA de caisse en HT avant le calcul des marges — vos achats et vos salaires sont HT.
                  5,5 % pour la vente à emporter, 10 % si vous servez sur place.
                </p>
              </div>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setShowSettings(false)}>Annuler</Button>
                <Button className="flex-1 bg-pilote hover:bg-pilote-hover text-white" onClick={saveSettings} disabled={saving}>
                  <Save className="w-4 h-4 mr-1.5" />{saving ? 'Enregistrement...' : 'Sauvegarder'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
