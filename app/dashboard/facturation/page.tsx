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

// ─── Composant principal ────────────────────────────────────────

export default function FacturationPage() {
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
          {/* ── Rattrapage initial : les 2 derniers mois, une seule fois ── */}
          {(() => {
            const pl = integrations.find(i => i.provider === 'pennylane')
            if (!pl) return null
            const fait = Boolean(pl.backfill_at)
            return (
              <div className={`rounded-2xl border p-4 ${fait ? 'border-gray-100 bg-gray-50/60' : 'border-pilote-100 bg-white'}`}>
                <div className="flex items-start gap-3 flex-wrap">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${fait ? 'bg-gray-300' : 'bg-pilote'}`}>
                    <History className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-[240px]">
                    <p className="font-bold text-sm text-gray-900">
                      {fait ? 'Vos 2 derniers mois ont déjà été récupérés' : 'Récupérer vos 2 derniers mois de factures'}
                    </p>
                    {fait ? (
                      <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
                        Fait le {new Date(String(pl.backfill_at)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                        {typeof pl.backfill_imported === 'number' ? ` · ${pl.backfill_imported} facture${pl.backfill_imported > 1 ? 's' : ''} récupérée${pl.backfill_imported > 1 ? 's' : ''}` : ''}
                        {pl.backfill_tronque ? ' · le plafond de 100 factures par appel avait été atteint : il en manque peut-être' : ''}.
                        {' '}Cette récupération ne se rejoue pas — les factures qui arrivent depuis sont prises par la synchronisation hebdomadaire.
                      </p>
                    ) : (
                      <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
                        La synchronisation travaille semaine par semaine : pour démarrer avec un historique, il faudrait
                        la lancer neuf fois. Ce bouton interroge Pennylane <strong>une seule fois</strong> sur les deux
                        derniers mois. Les factures arrivent « à vérifier » et n&apos;entrent dans vos marges
                        qu&apos;après votre validation. À utiliser une fois, à la mise en service.
                      </p>
                    )}
                  </div>
                  {!fait && (
                    <button onClick={lancerRattrapage} disabled={rattrapage}
                      className="flex items-center gap-1.5 bg-pilote hover:bg-pilote-hover text-white text-xs font-semibold rounded-xl px-3.5 py-2 transition-colors disabled:opacity-50 flex-shrink-0">
                      <History className={`w-3.5 h-3.5 ${rattrapage ? 'animate-spin' : ''}`} />
                      {rattrapage ? 'Récupération…' : 'Récupérer 2 mois'}
                    </button>
                  )}
                </div>
              </div>
            )
          })()}

          {/* ── Sans logiciel de facturation : l'adresse de transfert ── */}
          <div className="rounded-2xl border border-pilote-100 bg-pilote-50/40 p-4">
            <div className="flex items-start gap-3 flex-wrap">
              <div className="w-8 h-8 rounded-lg bg-pilote flex items-center justify-center flex-shrink-0">
                <Mail className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1 min-w-[240px]">
                <p className="font-bold text-sm text-gray-900">Pas de logiciel de facturation ? Vos factures arrivent par email, toutes seules</p>
                <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
                  Mettez en place le transfert automatique UNE fois (guide ci-dessous), ou donnez simplement cette adresse
                  à vos fournisseurs : chaque facture qui arrive dans votre boîte file ici sans aucun geste. La pièce
                  jointe PDF est archivée et lue exactement comme une facture synchronisée — lignes, mercuriale, prix du
                  jour. Elle arrive « à vérifier » et n&apos;entre dans vos marges qu&apos;après votre validation.
                </p>
              </div>
            </div>

            {mail.verified && mail.forward_id && !mailEdition ? (
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
                <button onClick={() => { setMailEdition(true); setMailAddr(mail.email ?? ''); setMailStep('idle'); setMailMsg(null) }}
                  title="L'adresse de facturation n'est pas forcément celle du compte — changez-la ici (nouveau code de vérification)"
                  className="text-[11px] font-semibold text-gray-500 hover:text-pilote hover:underline">
                  Changer l&apos;adresse
                </button>

                {/* Le code que Gmail a envoyé pour valider le transfert automatique —
                    capté par PILOTE et relayé ici, sinon la mise en place mourrait
                    à cette étape (le code part à l'adresse PILOTE, pas au boucher). */}
                {mail.confirmation && (
                  <div className="w-full mt-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                    <p className="text-xs font-bold text-amber-800">Gmail demande une confirmation — la voici :</p>
                    {mail.confirmation.code && (
                      <p className="mt-1 text-lg font-extrabold tracking-widest text-gray-900 tabular">{mail.confirmation.code}</p>
                    )}
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      Saisissez ce code dans la fenêtre Gmail « Ajouter une adresse de transfert »
                      {mail.confirmation.lien ? <> — ou <a href={mail.confirmation.lien} target="_blank" rel="noreferrer" className="font-semibold underline">confirmez en un clic</a>, puis activez le transfert dans Gmail.</> : ', puis activez le transfert.'}
                    </p>
                  </div>
                )}

                {/* Mise en place du transfert AUTOMATIQUE : configurée une fois,
                    plus aucun geste — facture reçue = facture arrivée ici. */}
                <details className="w-full mt-1">
                  <summary className="cursor-pointer text-xs font-semibold text-pilote hover:underline">
                    Mettre en place le transfert automatique (une fois, 2 minutes)
                  </summary>
                  <div className="mt-2 grid md:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-gray-100 bg-white p-3">
                      <p className="text-xs font-bold text-gray-900 mb-1.5">Sur Gmail</p>
                      <ol className="text-[11px] text-gray-600 space-y-1 list-decimal list-inside leading-relaxed">
                        <li>Roue dentée → « Voir tous les paramètres » → onglet <span className="font-semibold">Transfert et POP/IMAP</span></li>
                        <li>« Ajouter une adresse de transfert » → collez votre adresse PILOTE ci-dessus</li>
                        <li>Gmail envoie un code de confirmation : <span className="font-semibold">il s&apos;affiche ici</span> — cliquez « Relever le code Gmail »</li>
                        <li>Choisissez « Transférer une copie » : vos mails restent aussi dans votre boîte</li>
                      </ol>
                    </div>
                    <div className="rounded-xl border border-gray-100 bg-white p-3">
                      <p className="text-xs font-bold text-gray-900 mb-1.5">Sur Outlook</p>
                      <ol className="text-[11px] text-gray-600 space-y-1 list-decimal list-inside leading-relaxed">
                        <li>Roue dentée → « Courrier » → <span className="font-semibold">Transfert</span></li>
                        <li>« Activer le transfert » → collez votre adresse PILOTE → cochez « Conserver une copie »</li>
                        <li>Aucun code demandé — c&apos;est terminé</li>
                      </ol>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <button onClick={verifierCodeTransfert} disabled={mailBusy}
                      className="text-xs font-semibold text-pilote border border-pilote-200 bg-white rounded-lg px-2.5 py-1.5 hover:bg-pilote-50 transition-colors disabled:opacity-50">
                      {mailBusy ? 'Vérification…' : 'Relever le code Gmail'}
                    </button>
                    <span className="text-[10px] text-gray-400">Une fois le transfert actif : plus aucun geste, chaque facture reçue arrive ici et la lecture se fait la nuit.</span>
                  </div>
                </details>
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {/* Changement d'une adresse DÉJÀ vérifiée : dire clairement ce qui
                    se passe — suspension le temps du nouveau code, adresse PILOTE
                    inchangée (les transferts déjà en place restent bons). */}
                {mail.verified && mailEdition && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                    Changement d&apos;adresse : la réception est suspendue dès l&apos;envoi du code, jusqu&apos;à la vérification de la
                    nouvelle adresse. Votre adresse PILOTE (factures-…) ne change pas — les transferts déjà en place restent bons.
                  </p>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  {mailStep === 'idle' ? (
                    <>
                      <Input value={mailAddr} onChange={e => setMailAddr(e.target.value)} placeholder="votre@email.fr"
                        className="h-9 text-sm max-w-[240px]" />
                      <Button onClick={envoyerCodeMail} disabled={mailBusy}
                        className="h-9 bg-pilote hover:bg-pilote-hover text-white text-xs">
                        {mailBusy ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Envoi…</> : 'Recevoir le code'}
                      </Button>
                      {mail.verified && mailEdition ? (
                        <button onClick={() => { setMailEdition(false); setMailMsg(null) }}
                          className="text-[11px] font-semibold text-gray-500 hover:text-gray-700">Annuler</button>
                      ) : (
                        <span className="text-[11px] text-gray-400">Une seule fois : on vérifie que l&apos;adresse est bien la vôtre — mettez celle qui REÇOIT vos factures fournisseurs.</span>
                      )}
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

        <BlocChargesFixesSemaine
          fixedThisWeek={fixedThisWeek} week={week} chargeFamilies={chargeFamilies} televersant={televersant}
          setChargeFam={setChargeFam} moveBackToVariable={moveBackToVariable} televerserDocument={televerserDocument} />

        <BlocChargesRecurrentes
          loading={loading} activeRecurring={activeRecurring} recurringActuals={recurringActuals}
          recurringWeekly={recurringWeekly} chargeHasActualThisWeek={chargeHasActualThisWeek}
          monISO={monISO} sunISO={sunISO} week={week} year={year}
          openNewRecurring={openNewRecurring} openEditRecurring={openEditRecurring} deleteRecurring={deleteRecurring}
          setReconYear={setReconYear} setReconChargeId={setReconChargeId}
          setActualDraft={setActualDraft} setShowReconcile={setShowReconcile} />

        <BlocChargesStructure
          structureLines={structureLines} structureGroupes={structureGroupes} structureEcartees={structureEcartees}
          structureTotal={structureTotal} structureSomme={structureSomme} structureEcart={structureEcart}
          ecarteesPieces={ecarteesPieces} ecarteesOuvertes={ecarteesOuvertes} setEcarteesOuvertes={setEcarteesOuvertes}
          week={week} />
      </div>

      <ModaleChargeRecurrente
        showRecurring={showRecurring} setShowRecurring={setShowRecurring}
        recForm={recForm} setRecForm={setRecForm} recSaving={recSaving} saveRecurring={saveRecurring} />

      <ModaleReconciliation
        showReconcile={showReconcile} setShowReconcile={setShowReconcile}
        reconChargeId={reconChargeId} setReconChargeId={setReconChargeId}
        reconYear={reconYear} setReconYear={setReconYear}
        actualDraft={actualDraft} setActualDraft={setActualDraft}
        recurringCharges={recurringCharges} recurringActuals={recurringActuals} activeRecurring={activeRecurring}
        saveActual={saveActual} deleteActual={deleteActual} />

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
                <label className="block text-xs font-semibold text-gray-600 mb-0.5">Répartition par famille (%)</label>
                <p className="text-[11px] text-gray-400 mb-2">Mémorisée pour <span className="font-semibold text-gray-600">{newInvoice.supplier_name || 'cette société'}</span> — ré-appliquée automatiquement à ses prochaines factures.</p>
                {famillesOrdonnees.length === 0 ? (
                  <p className="text-[11px] text-gray-400">Aucune famille de vente pour l&apos;instant — la répartition s&apos;ouvrira dès que vos familles seront créées.</p>
                ) : (
                  <>
                    <div className="max-h-56 overflow-y-auto pr-1">
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                        {famillesOrdonnees.map(f => {
                          const sousFamille = f.parent_id !== null
                          return (
                            <div key={f.id} className={`flex items-center gap-1.5 ${sousFamille ? 'pl-3' : ''}`}>
                              <span className={`flex-1 min-w-0 truncate ${sousFamille ? 'text-[11px] text-gray-500' : 'text-[11px] font-semibold text-gray-700'}`} title={f.name}>
                                {sousFamille ? `› ${f.name}` : f.name}
                              </span>
                              <input type="number" min="0" max="100" value={newSplit[f.id] ?? ''}
                                onChange={e => { setSplitTouched(true); setNewSplit(p => ({ ...p, [f.id]: e.target.value })) }}
                                placeholder="0"
                                className="w-12 flex-shrink-0 border border-gray-200 rounded-lg px-1.5 py-1 text-xs text-right tabular focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                              <span className="text-[10px] text-gray-400 flex-shrink-0">%</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                    {(() => {
                      const t = totalVent(newSplit)
                      if (!t) return null
                      const ok = t >= 99.5 && t <= 100.5
                      return (
                        <p className={`text-[11px] mt-2 ${ok ? 'text-gray-400' : 'text-amber-600'}`}>
                          Total réparti {fmtPct(t)} %{ok ? '' : t < 100 ? ` — il reste ${fmtPct(100 - t)} %` : ` — ${fmtPct(t - 100)} % de trop`}
                        </p>
                      )
                    })()}
                  </>
                )}
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
      <ModaleRepartitionRayons
        showSplits={showSplits} setShowSplits={setShowSplits}
        splitSearch={splitSearch} setSplitSearch={setSplitSearch}
        splitsTab={splitsTab} setSplitsTab={setSplitsTab}
        splitOpen={splitOpen} setSplitOpen={setSplitOpen}
        splitEntries={splitEntries} splitsTodo={splitsTodo} splitsDone={splitsDone}
        splitSuppliers={splitSuppliers} famillesOrdonnees={famillesOrdonnees}
        setSplitDraft={setSplitDraft} splitSaving={splitSaving} saveSplits={saveSplits} />

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
