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
  Mail, Copy, History} from 'lucide-react'
import {
  weekRecurringCost,
  type RecurringCharge, type RecurringActual,
} from '@/lib/recurring-charges'
import { periodeCouvreSemaine } from '@/lib/charges-fixes'
import { DEFAULT_MARGIN_FAMILIES, DEFAULT_TVA_RATE, DIVERS_POSTE, type Poste } from '@/lib/postes'
import { nomFournisseur } from '@/lib/supplier-name'
import {
  BlocChargesFixesSemaine, BlocChargesRecurrentes, BlocChargesStructure,
  ModaleChargeRecurrente, ModaleReconciliation, ModaleRepartitionRayons,
} from './blocs'
import {
  CATEGORIES, TVA_RATES, EMPTY_RECURRING, EMPTY_INVOICE, PROVIDERS_META,
  emptyVent, ordonnerFamilles, totalVent, fmtPct, partsPayload, draftFromParts,
  familleDot, categoryFromSplit, matchSplit, getISOWeek, getWeekDates,
  fmtDate, fmtEuro, catInfo, initials, matchSupplier, isoWeeksInYear, getLastWeek,
  type BillingIntegration, type ChargeVue, type Invoice, type ProviderMeta,
  type RayonFamille, type RayonSplit, type SupplierMemo, type Summary,
  type VentDraft, type VentFamily,
} from './donnees'


// ─── L'ÉTAT DE LA PAGE FACTURATION ──────────────────────────────────────────
//
// La page pesait 99 948 octets. Au-delà d'environ cent kilo-octets, l'outil de
// publication ne peut plus réémettre un fichier d'un seul tenant : elle était
// devenue impossible à modifier — le lot 87 a dû livrer une correction à moitié
// pour cette seule raison.
//
// Contrairement au planning (lot 85), on ne pouvait pas simplement découper le
// JSX : ses deux grandes régions dépendaient de 107 et 77 variables de la portée
// du composant. Threader deux cents propriétés à la main aurait été long et
// faux. On sort donc L'ÉTAT, pas l'affichage : ce hook porte tout, et les blocs
// d'écran reçoivent UN objet dont le type se déduit tout seul.
//
// Rien n'est réécrit au passage : le corps est celui d'avant, ligne pour ligne.

export function useFacturation() {
  const router = useRouter()
  const { toast } = useToast()
  const { confirm: confirmAction } = useConfirm()
  const lastWeek = getLastWeek()
  const [week, setWeek] = useState(lastWeek.week)
  const [year, setYear] = useState(lastWeek.year)
  const [invoices,  setInvoices]  = useState<Invoice[]>([])
  // Les factures étiquetées CHARGE FIXE, toutes semaines confondues (?fixed=all).
  // Liste distincte, jamais fondue dans `invoices` : les achats variables ne
  // doivent gagner aucune charge fixe. Une charge structurelle vit au-delà de sa
  // date de facture — c'est la PÉRIODE, pas la semaine de facturation, qui dit
  // si elle concerne la semaine affichée.
  const [fixedInvoices, setFixedInvoices] = useState<Invoice[]>([])
  // Le pli « N charge(s) non comptée(s) » du bloc « Charges de structure »
  const [ecarteesOuvertes, setEcarteesOuvertes] = useState(false)
  // Charges récurrentes (définition/provision) + réels (réconciliation)
  const [recurringCharges, setRecurringCharges] = useState<ChargeVue[]>([])
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
  // Les familles de la boutique sur lesquelles les achats se répartissent
  const [splitFamilles,  setSplitFamilles]  = useState<RayonFamille[]>([])
  const [splitDraft,     setSplitDraft]     = useState<Record<string, { label: string; parts: VentDraft }>>({})
  const [splitSaving,    setSplitSaving]    = useState(false)
  // Onglet actif de la modale : « à répartir » (sociétés sans ventilation) ou « toutes »
  const [splitsTab,      setSplitsTab]      = useState<'todo' | 'all'>('todo')
  // Filtre par nom + carte dépliée (une seule à la fois : quinze familles par
  // société feraient un mur si tout s'ouvrait ensemble)
  const [splitSearch,    setSplitSearch]    = useState('')
  const [splitOpen,      setSplitOpen]      = useState<string | null>(null)
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
  // `confirmation` : le code que GMAIL envoie à l'adresse PILOTE quand le
  // boucher met en place le transfert automatique — relayé ici (lot 34).
  type ConfirmationTransfert = { code?: string | null; lien?: string | null; recu_le?: string } | null
  const [mail, setMail] = useState<{ forward_id: string | null; verified: boolean; email: string | null; confirmation: ConfirmationTransfert }>({ forward_id: null, verified: false, email: null, confirmation: null })
  const [mailStep, setMailStep] = useState<'idle' | 'code'>('idle')
  const [mailAddr, setMailAddr] = useState('')
  const [mailCode, setMailCode] = useState('')
  const [mailBusy, setMailBusy] = useState(false)
  const [mailMsg, setMailMsg] = useState<{ ok: boolean; texte: string } | null>(null)
  const [mailCopie, setMailCopie] = useState(false)
  // Changement d'adresse APRÈS vérification : l'adresse de facturation n'est
  // pas toujours celle du compte (la boîte qui reçoit les factures est souvent
  // une autre). Ce mode ré-ouvre la saisie ; l'adresse PILOTE ne change pas.
  const [mailEdition, setMailEdition] = useState(false)
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
  const [rattrapage,       setRattrapage]       = useState(false)

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
    const [invRes, fixRes, recRes, sumRes, caRes, settRes, ventRes] = await Promise.all([
      fetch(`/api/invoices?week=${week}&year=${year}`, noStore).then(r => r.json()).catch(() => []),
      // Second appel, EN PARALLÈLE : la branche par défaut ci-dessus force
      // `is_fixed_charge = false` — sans celui-ci le bloc des charges fixes
      // filtre une liste qui n'en contient aucune.
      fetch(`/api/invoices?fixed=all`, noStore).then(r => r.json()).catch(() => []),
      fetch(`/api/recurring-charges`, noStore).then(r => r.json()).catch(() => ({ charges: [], actuals: [] })),
      fetch(`/api/facturation/summary?week=${week}&year=${year}`, noStore).then(r => r.json()).catch(() => null),
      fetch(`/api/weekly-ca?week=${week}&year=${year}`, noStore).then(r => r.json()).catch(() => null),
      fetch('/api/billing-settings', noStore).then(r => r.json()).catch(() => ({})),
      fetch(`/api/invoice-splits?week=${week}&year=${year}`, noStore).then(r => r.json()).catch(() => null),
    ])
    if (reqId !== reqIdRef.current) return // une navigation plus récente a eu lieu — on jette cette réponse
    setInvoices(Array.isArray(invRes) ? invRes : [])
    setFixedInvoices(Array.isArray(fixRes) ? fixRes : [])
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
    setMail({ forward_id: s.billing_forward_id || null, verified: Boolean(s.billing_email_verified), email: s.billing_email || null, confirmation: s.billing_forward_confirmation ?? null })
    if (s.billing_email && !mailAddr) setMailAddr(String(s.billing_email))
    if (caRes && !caRes.error) setCaForm({ ca_total: String(caRes.ca_total || ''), ca_boucherie: String(caRes.ca_boucherie || ''), ca_charcuterie: String(caRes.ca_charcuterie || ''), ca_traiteur: String(caRes.ca_traiteur || ''), ca_divers: String(caRes.ca_divers || '') })
    else setCaForm({ ca_total: '', ca_boucherie: '', ca_charcuterie: '', ca_traiteur: '', ca_divers: '' })
    setLoading(false)
  }, [week, year])

  /** Envoie le code de validation à l'adresse du gérant (l'adresse de transfert
   *  n'est activée qu'une fois vérifiée — sans quoi n'importe qui pourrait
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
    if (r?.ok) { setMailStep('idle'); setMailCode(''); setMailEdition(false); setMailMsg({ ok: true, texte: 'Adresse vérifiée — vous pouvez transférer vos factures.' }); load() }
    else setMailMsg({ ok: false, texte: d?.error || 'Code refusé.' })
  }

  /** Va chercher le code de confirmation que Gmail a envoyé à l'adresse
   *  PILOTE (transfert automatique) — il arrive en quelques secondes après la
   *  demande côté Gmail ; ce bouton le relève sans recharger toute la page. */
  async function verifierCodeTransfert() {
    setMailBusy(true)
    const s = await fetch('/api/billing-settings', { cache: 'no-store' }).then(r => r.json()).catch(() => null)
    setMailBusy(false)
    if (s && !s.error) {
      setMail({ forward_id: s.billing_forward_id || null, verified: Boolean(s.billing_email_verified), email: s.billing_email || null, confirmation: s.billing_forward_confirmation ?? null })
      if (s.billing_forward_confirmation) { setMailMsg(null); return }
    }
    setMailMsg({ ok: false, texte: 'Pas encore de code reçu — demandez d\'abord l\'ajout de l\'adresse dans Gmail (étapes 1-2), puis re-cliquez.' })
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
    setSplitFamilles(Array.isArray(data.familles) ? data.familles : [])
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

  // La catégorie d'achat suit la famille dominante de la ventilation (sauf choix manuel)
  useEffect(() => {
    if (!showAdd || categoryTouched) return
    const cat = categoryFromSplit(newSplit, splitFamilles)
    if (cat) setNewInvoice((p: any) => (p.category === cat ? p : { ...p, category: cat }))
  }, [newSplit, splitFamilles, showAdd, categoryTouched])

  // Pré-remplit la répartition depuis la mémoire de la société saisie (tant qu'on n'y a pas touché)
  useEffect(() => {
    if (!showAdd || splitTouched) return
    const m = matchSplit(newInvoice.supplier_name || '', splits)
    setNewSplit(m ? draftFromParts(m.parts) : emptyVent())
  }, [newInvoice.supplier_name, splits, showAdd, splitTouched])

  /** Construit le brouillon d'édition en fusionnant fournisseurs connus + règles enregistrées */
  function buildSplitDraft(
    suppliers: { key: string; name: string }[],
    splitList: RayonSplit[],
  ) {
    const draft: Record<string, { label: string; parts: VentDraft }> = {}
    for (const s of suppliers) {
      draft[s.key] = { label: s.name || s.key, parts: emptyVent() }
    }
    for (const sp of splitList) {
      draft[sp.supplier_key] = {
        label: sp.supplier_label || draft[sp.supplier_key]?.label || sp.supplier_key,
        parts: draftFromParts(sp.parts),
      }
    }
    return draft
  }

  /** Ouvre la répartition, filtrée sur les sociétés non réparties */
  function openSplits() {
    setSplitDraft(buildSplitDraft(splitSuppliers, splits))
    setSplitsTab('todo')
    setSplitSearch('')
    setSplitOpen(null)
    setShowSplits(true)
  }

  async function saveSplits() {
    setSplitSaving(true)
    try {
      // Les colonnes pct_* ne partent plus : elles sont dérivées côté serveur.
      // Une société dont toutes les cases sont vides part avec des parts vides —
      // l'API y lit « retirer la règle », ce qui la renvoie dans « à répartir ».
      const rows = Object.entries(splitDraft).map(([key, v]) => ({
        supplier_key: key,
        supplier_label: v.label,
        parts: partsPayload(v.parts),
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
      // Mémorise la répartition par famille de cette société — ré-appliquée à ses prochaines factures
      const parts = partsPayload(newSplit)
      if (Object.keys(parts).length > 0) {
        await fetch('/api/supplier-splits', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ split: { supplier_key: newInvoice.supplier_name, supplier_label: newInvoice.supplier_name, parts } }),
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
    if (res?.ok) { toast({ variant: 'success', title: `« ${nomFournisseur(inv.supplier_name) || inv.supplier_name} » déplacée en charges fixes`, description: 'Elle ne pèse plus sur les marges matière. Choisissez sa famille de charge ci-dessous.' }); load() }
    else toast({ variant: 'error', title: 'Déplacement impossible' })
  }

  async function moveBackToVariable(inv: Invoice) {
    const res = await fetch(`/api/invoices/${inv.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_fixed_charge: false, charge_family_id: null }) }).catch(() => null)
    if (res?.ok) { toast({ variant: 'success', title: `« ${nomFournisseur(inv.supplier_name) || inv.supplier_name} » repassée en achats` }); load() }
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
      toast({ variant: 'error', title: `${nomFournisseur(inv.supplier_name) || inv.supplier_name} : téléversement refusé`, description: data?.error || 'Réessayez.' })
      return
    }
    toast({ variant: 'info', title: `${nomFournisseur(inv.supplier_name) || inv.supplier_name} : document reçu`, description: 'Lecture en cours — elle décide de la nature de la facture.' })
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
        title: `${nomFournisseur(inv.supplier_name) || inv.supplier_name} : reclassée en achats de la semaine`,
        description: `Le document porte de la matière — ${rd?.prix_promus ?? 0} prix retenu${(rd?.prix_promus ?? 0) > 1 ? 's' : ''} pour la mercuriale.`,
      })
    } else if (rl?.ok && rd?.status === 'hors_matiere') {
      toast({ variant: 'info', title: `${nomFournisseur(inv.supplier_name) || inv.supplier_name} : le document confirme une charge`, description: 'Elle reste en charges structurelles — rien d\'anormal si c\'est un loyer, un abonnement, une assurance…' })
    } else {
      toast({ variant: 'error', title: `${nomFournisseur(inv.supplier_name) || inv.supplier_name} : lecture du document en échec`, description: rd?.error || 'Le document est archivé — relancez la lecture depuis la mercuriale.' })
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
    if (!res.ok) {
      // Le serveur explique POURQUOI il refuse — un relevé qui en recoupe un
      // autre, en le nommant. Afficher « Erreur 409 » à la place, c'était jeter
      // la seule phrase utile de l'échange. Le lot 87 n'a pas pu le corriger :
      // ce fichier n'était alors plus republiable.
      const d = await res.json().catch(() => null) as { error?: string } | null
      toast({
        variant: 'error',
        title: 'Relevé non enregistré',
        description: d?.error || `La plateforme a refusé l'enregistrement (erreur ${res.status}).`,
      })
      return
    }
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

  /**
   * Rattrapage initial : les 2 derniers mois en un appel, UNE seule fois.
   *
   * La synchro ordinaire travaille semaine par semaine — remonter deux mois
   * demandait neuf clics. Le verrou vit côté serveur (un bouton caché n'est pas
   * une garantie) ; ici on se contente de ne plus le proposer.
   */
  async function lancerRattrapage() {
    const ok = await confirmAction({
      title: 'Récupérer vos 2 derniers mois de factures ?',
      description: 'Pennylane sera interrogé une seule fois. Les factures arriveront « à vérifier » : elles n’entreront dans vos marges qu’après votre validation. Cette récupération n’est pas rejouable.',
      confirmLabel: 'Récupérer',
    })
    if (!ok) return
    setRattrapage(true)
    const res = await fetch('/api/billing-integrations/rattrapage', { method: 'POST' }).catch(() => null)
    const data = res ? await res.json().catch(() => ({} as any)) : ({} as any)
    setRattrapage(false)
    loadIntegrations(); load()
    if (res?.ok && data?.success) {
      const n = Number(data.imported) || 0
      // La troncature est ANNONCÉE : un appel Pennylane rend 100 factures au
      // maximum, et le connecteur ne dit pas combien il en restait. Taire ce
      // plafond ferait lire « tout est là » à un import incomplet.
      const bouts = [
        n > 0 ? `${n} facture${n > 1 ? 's' : ''} récupérée${n > 1 ? 's' : ''}` : 'Aucune facture sur la période',
        data.tronque ? '100 est le maximum d’un appel : il en reste peut-être' : null,
        data.pdf || null,
      ].filter(Boolean)
      toast({ variant: n > 0 ? 'success' : 'info', title: 'Rattrapage terminé', description: bouts.join(' · ') + '.' })
    } else {
      toast({
        variant: 'error',
        title: data?.error || 'Rattrapage impossible',
        description: data?.detail || 'Réessayez dans un instant.',
      })
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
  // Les familles de la boutique, racines à leur position et sous-familles juste après
  const famillesOrdonnees = ordonnerFamilles(splitFamilles)
  const variableTotalHt  = variableInvoices.reduce((s, i) => s + i.amount_ht, 0)
  const variableTotalTtc = variableInvoices.reduce((s, i) => s + i.amount_ttc, 0)

  // ── Charges récurrentes : provision de CETTE semaine, au jour près (le réel remplace la provision) ──
  const recurWeek = weekRecurringCost(recurringCharges, recurringActuals, monISO, sunISO)
  const recurringWeekly = recurWeek.total
  const chargeHasActualThisWeek: Record<string, boolean> = {}
  for (const l of recurWeek.lines) chargeHasActualThisWeek[l.id] = l.hasActual
  const activeRecurring = [...recurringCharges].sort((a, b) => a.label.localeCompare(b.label, 'fr'))

  // ── Les FACTURES de charge qui concernent la semaine affichée ──
  // Le critère n'est pas la semaine de facturation mais le CHEVAUCHEMENT de la
  // période : un loyer facturé le 28 court sur les semaines suivantes. La règle
  // vit dans lib/charges-fixes et n'est pas recopiée ici — l'écran et le calcul
  // tranchent avec la même fonction.
  const fixedThisWeek = fixedInvoices
    .filter(i => periodeCouvreSemaine(i.invoice_date, i.period_days, monISO, sunISO))
    .sort((a, b) => (b.invoice_date || '').localeCompare(a.invoice_date || '') || b.amount_ht - a.amount_ht)

  // ── Le DÉTAIL du poste « charges de structure », tel que le moteur le rend ──
  // Aucun chiffre n'est reconstruit ici : le total qui fait foi est
  // `charges_fixes` du résumé. On additionne les lignes retenues uniquement pour
  // VÉRIFIER qu'elles tombent dessus — et on affiche l'écart s'il y en a un.
  const structureLines    = summary?.charges_fixes_lines ?? []
  const structureRetenues = structureLines.filter(l => l.retenue !== false)
  const structureEcartees = structureLines.filter(l => l.retenue === false)
  const structureGroupes  = [
    { key: 'recurrent' as const, titre: 'Provisions récurrentes', lignes: structureRetenues.filter(l => l.origine !== 'facture') },
    { key: 'facture'   as const, titre: 'Factures de charge',     lignes: structureRetenues.filter(l => l.origine === 'facture') },
  ].filter(g => g.lignes.length > 0)
  const structureTotal  = summary?.charges_fixes ?? 0
  const structureSomme  = Math.round(structureRetenues.reduce((s, l) => s + (Number(l.cost) || 0), 0) * 100) / 100
  const structureEcart  = Math.round((structureSomme - structureTotal) * 100) / 100
  const ecarteesPieces  = Math.round(structureEcartees.reduce((s, l) => s + (Number(l.montant_facture) || 0), 0) * 100) / 100

  /** Ligne du tableau d'achats — partagée entre la vue « par date » et la vue « par catégorie » */
  const renderInvoiceRow = (inv: Invoice) => {
    const cat = catInfo(inv.category)
    const sp = matchSplit(inv.supplier_name, splits)
    const ventil = sp
      ? famillesOrdonnees
          .map(f => ({ label: f.name, dot: familleDot('', f.name), pct: Number(sp.parts?.[f.id]) || 0 }))
          .filter(p => p.pct > 0)
      : []
    const ownSplits = invSplits[inv.id] ?? []
    return (
      <tr key={inv.id} className="border-t border-gray-50 hover:bg-gray-50 group transition-colors">
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-pilote-50 text-pilote flex items-center justify-center text-[11px] font-extrabold flex-shrink-0">{initials(nomFournisseur(inv.supplier_name) || inv.supplier_name)}</div>
            <div>
              <div className="font-semibold text-sm text-gray-900">{nomFournisseur(inv.supplier_name) || inv.supplier_name}</div>
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


  // Tout ce que les blocs d'écran peuvent lire. Le type se déduit de cet objet :
  // aucune liste de propriétés à maintenir en double, et une variable oubliée
  // devient une erreur de compilation, pas un écran vide.
  return {
    router, toast, confirmAction, lastWeek, week, setWeek,
    year, setYear, invoices, setInvoices, fixedInvoices, setFixedInvoices,
    ecarteesOuvertes, setEcarteesOuvertes, recurringCharges, setRecurringCharges, recurringActuals, setRecurringActuals,
    showRecurring, setShowRecurring, recForm, setRecForm, recSaving, setRecSaving,
    showReconcile, setShowReconcile, reconChargeId, setReconChargeId, reconYear, setReconYear,
    actualDraft, setActualDraft, summary, setSummary, loading, setLoading,
    showAdd, setShowAdd, showCA, setShowCA, showSettings, setShowSettings,
    showProviders, setShowProviders, showSplits, setShowSplits, ventFamilies, setVentFamilies,
    chargeFamilies, setChargeFamilies, invSplits, setInvSplits, ventInvoice, setVentInvoice,
    splits, setSplits, splitSuppliers, setSplitSuppliers, splitFamilles, setSplitFamilles,
    splitDraft, setSplitDraft, splitSaving, setSplitSaving, splitsTab, setSplitsTab,
    splitSearch, setSplitSearch, splitOpen, setSplitOpen, newSplit, setNewSplit,
    splitTouched, setSplitTouched, categoryTouched, setCategoryTouched, newInvoice, setNewInvoice,
    saving, setSaving, invoiceView, setInvoiceView, showFamilles, setShowFamilles,
    postesList, setPostesList, familleDraft, setFamilleDraft, famSaving, setFamSaving,
    suppliersMemo, setSuppliersMemo, memoTouched, setMemoTouched, caForm, setCaForm,
    settForm, setSettForm, mail, setMail, mailStep, setMailStep,
    mailAddr, setMailAddr, mailCode, setMailCode, mailBusy, setMailBusy,
    mailMsg, setMailMsg, mailCopie, setMailCopie, mailEdition, setMailEdition,
    tvaDraft, setTvaDraft, integrations, setIntegrations, showConnect, setShowConnect,
    connectProvider, setConnectProvider, connectToken, setConnectToken, connectCompanyId, setConnectCompanyId,
    connecting, setConnecting, connectError, setConnectError, syncing, setSyncing,
    rattrapage, setRattrapage, reqIdRef, mon, sun, monISO,
    sunISO, cw, cy, isCurrentWeek, isLastWeek, load,
    envoyerCodeMail, validerCodeMail, verifierCodeTransfert, loadIntegrations, loadSplits, openAdd,
    buildSplitDraft, openSplits, saveSplits, prevWeek, nextWeek, addInvoice,
    deleteInvoice, validateInvoice, moveToFixed, moveBackToVariable, televersant, setTeleversant,
    televerserDocument, setChargeFam, validateAllPending, loadRecurring, openNewRecurring, openEditRecurring,
    saveRecurring, deleteRecurring, saveActual, deleteActual, saveCA, saveSettings,
    connectIntegration, disconnectIntegration, syncNow, lancerRattrapage, openFamilles, saveFamilles,
    openValorisation, ttcAmount, supplierMatch, matchHasTva, variableInvoices, sortedVariable,
    invoiceGroups, pendingCount, pendingHt, repartiKeys, splitEntries, splitsTodo,
    splitsDone, famillesOrdonnees, variableTotalHt, variableTotalTtc, recurWeek, recurringWeekly,
    chargeHasActualThisWeek, activeRecurring, fixedThisWeek, structureLines, structureRetenues, structureEcartees,
    structureGroupes, structureTotal, structureSomme, structureEcart, ecarteesPieces, renderInvoiceRow,
  }
}

export type Facturation = ReturnType<typeof useFacturation>
