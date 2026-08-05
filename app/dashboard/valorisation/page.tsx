'use client'

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { Calculator, Info, AlertTriangle, CheckCircle, Save, Loader2, Users, RotateCcw, Download } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import {
  repartitionCarcasse,
  type AnimalType, type Cut, type CutCategory,
} from '@/lib/valorisation'
import {
  ANIMALS, CATEGORIES, CATEGORY_LABELS, CATEGORY_COLORS,
  buildCutTree, computeBoucherieLabor, eur, getISOWeek, makeWeekLabel,
  DEFAULT_CATS, DEFAULT_EXCLUDED, DEFAULT_PRICES, loadPref, loadDraft, normalizeValo,
  type CatsByAnimal, type CutsByAnimal, type CutResult, type PricesByAnimal,
  type SavedValo, type WeekLabor, type WeekStats,
} from './donnees'
import {
  SelecteurEspeces, OngletsVue, VueSuiviHebdo, CarrouselHistorique,
  BlocResultats, TableauMorceaux, ModaleLot,
} from './blocs'

// ─── Page ───────────────────────────

export default function ValorisationPage() {
  const params = useSearchParams()
  const { toast } = useToast()
  const { confirm: confirmAction } = useConfirm()

  // Brouillon : la saisie en cours est enregistrée automatiquement et restaurée au retour sur la page
  const [draft] = useState<Record<string, any>>(loadDraft)
  const [animalType,    setAnimalType]    = useState<AnimalType>(draft.animalType ?? 'boeuf')
  const [activeTab,     setActiveTab]     = useState<'calc' | 'suivi'>('calc')
  const [breedId,       setBreedId]       = useState(draft.breedId ?? 'charolaise')
  // Poids CARCASSE par animal (kg) — le boucher achète au kg de carcasse
  const [carcassWeight, setCarcassWeight] = useState(draft.carcassWeight ?? '520')
  const [quantity,      setQuantity]      = useState(draft.quantity ?? '1')
  // Prix d'achat en €/kg de CARCASSE
  const [purchasePerKg, setPurchasePerKg] = useState(draft.purchasePerKg ?? '6.00')
  const [overheadCost,  setOverheadCost]  = useState(draft.overheadCost ?? '0')
  const [laborCost,     setLaborCost]     = useState(draft.laborCost ?? '150')
  const [decoupeHours,  setDecoupeHours]  = useState(draft.decoupeHours ?? '')
  const [weekLabor,     setWeekLabor]     = useState<WeekLabor | null>(null)
  const [targetMargin,  setTargetMargin]  = useState(draft.targetMargin ?? 35)
  const [showBreedInfo, setShowBreedInfo] = useState(false)
  const [catsByAnimal,     setCatsByAnimal]     = useState<CatsByAnimal>(() => loadPref('valo_cats_v1', DEFAULT_CATS()))
  const [excludedByAnimal, setExcludedByAnimal] = useState<CutsByAnimal>(() => loadPref('valo_excluded_v1', DEFAULT_EXCLUDED()))
  const [cutPricesByAnimal, setCutPricesByAnimal] = useState<PricesByAnimal>(() => loadPref('valo_prices_v1', DEFAULT_PRICES()))
  // Prix conseillé/kg saisi manuellement par pièce (surcharge le prix auto = réf × coefficient)
  const [sellOverridesByAnimal, setSellOverridesByAnimal] = useState<PricesByAnimal>(() => loadPref('valo_sell_v1', DEFAULT_PRICES()))
  // COÛTS de revient forcés à la main (lot 56). Jumeau de sellOverrides, mais de
  // l'autre côté du miroir : ce qu'on paie, pas ce qu'on vend.
  const [costOverridesByAnimal, setCostOverridesByAnimal] = useState<PricesByAnimal>(() => loadPref('valo_cost_v1', DEFAULT_PRICES()))
  const [purchaseDate,  setPurchaseDate]  = useState(draft.purchaseDate ?? new Date().toISOString().split('T')[0])
  const [notes,         setNotes]         = useState(draft.notes ?? '')
  const [history,       setHistory]       = useState<SavedValo[]>([])
  const [historyError,  setHistoryError]  = useState<string | null>(null)
  const [saving,        setSaving]        = useState(false)
  const [saved,         setSaved]         = useState(false)
  const [pdfBusy,       setPdfBusy]       = useState(false)
  const [selected,      setSelected]      = useState<SavedValo | null>(null)
  // Poids saisis manuellement par le boucher, pièce par pièce (clé = id de la pièce)
  const [cutWeights,    setCutWeights]    = useState<Record<string, string>>(draft.cutWeights ?? {})
  // Nœuds dépliés de l'arborescence de découpe (par chemin)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  // N° de lot de la bête / du lot valorisé, saisi par le gérant
  const [lotNumber,     setLotNumber]     = useState<string>(draft.lotNumber ?? '')

  const config = ANIMALS[animalType]
  const breeds = config.breeds
  // Bœuf : un seul arbre — ART8 (arrière) et AVANTCAPA (avant) en catégories principales dépliables
  const cuts   = config.cuts
  // Bœuf et veau s'achètent en demi-carcasse : le poids saisi est celui d'un demi, la quantité un nombre de demis
  const isHalf = animalType === 'boeuf' || animalType === 'veau' || animalType === 'porc'
  // Prix de référence par pièce : valeur saisie si présente, sinon prix indicatif de la pièce
  const cutPrices = cutPricesByAnimal[animalType] ?? {}
  const priceOf = (cut: Cut) => { const v = parseFloat(cutPrices[cut.id] ?? ''); return isNaN(v) ? cut.marketPrice : v }
  function setCutPrice(cutId: string, value: string) {
    setCutPricesByAnimal(prev => ({ ...prev, [animalType]: { ...(prev[animalType] ?? {}), [cutId]: value } }))
  }
  // Prix conseillé/kg : surcharge manuelle si saisie, sinon le prix auto (réf × coefficient)
  const sellOverrides = sellOverridesByAnimal[animalType] ?? {}
  const sellOverrideOf = (cutId: string): number | null => { const v = parseFloat(sellOverrides[cutId] ?? ''); return isNaN(v) ? null : v }
  const costOverrides = costOverridesByAnimal[animalType] ?? {}
  function setCostOverride(cutId: string, value: string) {
    setCostOverridesByAnimal(prev => ({ ...prev, [animalType]: { ...(prev[animalType] ?? {}), [cutId]: value } }))
  }
  function setSellOverride(cutId: string, value: string) {
    setSellOverridesByAnimal(prev => ({ ...prev, [animalType]: { ...(prev[animalType] ?? {}), [cutId]: value } }))
  }

  // Préférences par famille — persistées
  useEffect(() => {
    try { window.localStorage.setItem('valo_cats_v1', JSON.stringify(catsByAnimal)) } catch {}
  }, [catsByAnimal])
  useEffect(() => {
    try { window.localStorage.setItem('valo_excluded_v1', JSON.stringify(excludedByAnimal)) } catch {}
  }, [excludedByAnimal])
  // Prix personnalisés — cache local instantané + persistance en base (débounced)
  const priceSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipPriceSave  = useRef(true)
  useEffect(() => {
    try { window.localStorage.setItem('valo_prices_v1', JSON.stringify(cutPricesByAnimal)) } catch {}
    try { window.localStorage.setItem('valo_sell_v1', JSON.stringify(sellOverridesByAnimal)) } catch {}
    try { window.localStorage.setItem('valo_cost_v1', JSON.stringify(costOverridesByAnimal)) } catch {}
    if (skipPriceSave.current) { skipPriceSave.current = false; return }
    if (priceSaveTimer.current) clearTimeout(priceSaveTimer.current)
    priceSaveTimer.current = setTimeout(() => {
      fetch('/api/valorisation-prices', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prices: cutPricesByAnimal, sellOverrides: sellOverridesByAnimal, costOverrides: costOverridesByAnimal }),
      }).catch(() => {})
    }, 700)
  }, [cutPricesByAnimal, sellOverridesByAnimal, costOverridesByAnimal])

  // Au montage : charge les prix persistés en base (source de vérité), fusionnés au cache local
  useEffect(() => {
    let cancelled = false
    fetch('/api/valorisation-prices')
      .then(r => r.ok ? r.json() : null)
      .then((payload: { prices?: Partial<PricesByAnimal>; sellOverrides?: Partial<PricesByAnimal>; costOverrides?: Partial<PricesByAnimal> } | null) => {
        if (cancelled || !payload) return
        const mergeInto = (dbVal?: Partial<PricesByAnimal>) => (prev: PricesByAnimal) => {
          if (!dbVal) return prev
          const merged: PricesByAnimal = { ...prev }
          for (const a of Object.keys(dbVal) as AnimalType[]) {
            merged[a] = { ...(prev[a] ?? {}), ...(dbVal[a] ?? {}) }
          }
          return merged
        }
        skipPriceSave.current = true
        if (payload.prices) setCutPricesByAnimal(mergeInto(payload.prices))
        if (payload.sellOverrides) setSellOverridesByAnimal(mergeInto(payload.sellOverrides))
        if (payload.costOverrides) setCostOverridesByAnimal(mergeInto(payload.costOverrides))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Brouillon enregistré automatiquement : la valorisation en cours survit si on quitte la page
  useEffect(() => {
    try {
      window.localStorage.setItem('valo_draft_v1', JSON.stringify({
        animalType, breedId, carcassWeight, quantity, purchasePerKg, overheadCost, laborCost, decoupeHours, targetMargin, purchaseDate, notes, cutWeights, lotNumber,
      }))
    } catch {}
  }, [animalType, breedId, carcassWeight, quantity, purchasePerKg, overheadCost, laborCost, decoupeHours, targetMargin, purchaseDate, notes, cutWeights, lotNumber])

  const includedCats = useMemo(() => new Set<CutCategory>(catsByAnimal[animalType] ?? CATEGORIES), [catsByAnimal, animalType])
  const excludedCuts = useMemo(() => new Set<string>(excludedByAnimal[animalType] ?? []), [excludedByAnimal, animalType])

  // Reset quand on change d'espèce (les catégories/pièces de chaque famille sont conservées).
  // Ignoré au premier rendu (brouillon restauré) et lors d'une réouverture depuis l'historique.
  const firstMount = useRef(true)
  const skipNextAnimalReset = useRef(false)
  useEffect(() => {
    if (firstMount.current) { firstMount.current = false; return }
    if (skipNextAnimalReset.current) { skipNextAnimalReset.current = false; return }
    setBreedId(config.breeds[0].id)
    setCarcassWeight(config.defaultWeight)
    setPurchasePerKg(config.defaultPurchaseKg)
    setLaborCost(config.defaultLabor)
    setDecoupeHours('')
    setCutWeights({})
    setLotNumber('')
    setExpandedNodes(new Set())
    setShowBreedInfo(false)
  }, [animalType]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pré-remplissage depuis la facturation
  useEffect(() => {
    const date     = params.get('date')
    const supplier = params.get('supplier')
    if (date)     setPurchaseDate(date)
    if (supplier) setNotes(`Facture ${supplier}`)
  }, [params])

  // Main d'œuvre boucherie réelle de la semaine d'achat (depuis le planning)
  useEffect(() => {
    const { week: w, year: y } = getISOWeek(purchaseDate)
    if (!w || !y || isNaN(w)) { setWeekLabor(null); return }
    Promise.all([
      fetch(`/api/planning?week=${w}&year=${y}`).then(r => r.json()).catch(() => []),
      fetch('/api/employees').then(r => r.json()).catch(() => []),
    ]).then(([entries, emps]) => {
      if (!Array.isArray(entries) || !Array.isArray(emps)) { setWeekLabor(null); return }
      const { hours, cost, decoupeHours: dH, decoupeCost: dC } = computeBoucherieLabor(entries, emps)
      setWeekLabor({ hours, cost, rate: hours > 0 ? cost / hours : 0, decoupeHours: dH, decoupeCost: dC, week: w, year: y })
      // Le temps de découpe du planning devient la main d'œuvre imputée à la valorisation
      if (dH > 0) {
        setDecoupeHours(String(Math.round(dH)))
        setLaborCost(String(Math.round(dC * 100) / 100))
      }
    }).catch(() => setWeekLabor(null))
  }, [purchaseDate])

  /** Saisie du temps de découpe : impute automatiquement la main d'œuvre au taux réel du planning */
  function setDecoupe(min: string) {
    setDecoupeHours(min)
    const minutes = parseFloat(min) || 0
    if (weekLabor && weekLabor.rate > 0 && minutes > 0) {
      setLaborCost(String(Math.round((minutes / 60) * weekLabor.rate * 100) / 100))
    }
  }

  const breed    = breeds.find(b => b.id === breedId) ?? breeds[0]
  const carcW    = parseFloat(carcassWeight) || 0
  const qty      = Math.max(1, parseInt(quantity) || 1)
  const ppkg     = parseFloat(purchasePerKg)  || 0
  const overhead = parseFloat(overheadCost)   || 0
  const labor    = parseFloat(laborCost)      || 0

  // Le poids saisi EST le poids carcasse ; le poids vif est estimé via le rendement (indicatif)
  const carcassW1       = carcW
  const liveEstimate    = breed.carcassYield > 0 ? carcW / breed.carcassYield : carcW
  const purchaseTotal1  = carcW * ppkg
  const totalCost1      = purchaseTotal1 + overhead + labor
  const purchaseTotalLot = purchaseTotal1 * qty
  const totalCostLot    = totalCost1 * qty

  const { results, coefficient, totalMarketRevenue1 } = useMemo(() => {
    if (carcW <= 0 || ppkg <= 0) return { results: [] as CutResult[], coefficient: 1, totalMarketRevenue1: 0 }
    const isActive    = (c: Cut) => includedCats.has(c.category) && !excludedCuts.has(c.id)
    // Poids saisi manuellement par pièce (0 tant que le boucher n'a rien renseigné)
    const cutWeight   = (c: Cut) => parseFloat(cutWeights[c.id] || '') || 0
    const activeCuts  = cuts.filter(isActive)
    const mktRevenue  = activeCuts.reduce((s, c) => s + cutWeight(c) * priceOf(c), 0)
    const targetRev   = targetMargin < 100 && totalCost1 > 0 ? totalCost1 / (1 - targetMargin / 100) : mktRevenue
    const coeff       = mktRevenue > 0 ? targetRev / mktRevenue : 1
    const res: CutResult[] = cuts.map(cut => {
      const weight       = cutWeight(cut)
      const active       = isActive(cut)
      const override     = sellOverrideOf(cut.id)
      const sellingPrice = active ? (override !== null ? override : priceOf(cut) * coeff) : 0
      return { cut, weight, sellingPrice, revenue: sellingPrice * weight, active }
    })
    return { results: res, coefficient: coeff, totalMarketRevenue1: mktRevenue }
  }, [animalType, breedId, carcW, ppkg, overhead, labor, targetMargin, includedCats, excludedCuts, totalCost1, cuts, cutWeights, cutPrices, sellOverrides])

  const activeResults   = results.filter(r => r.active)
  const totalRevenue1   = activeResults.reduce((s, r) => s + r.revenue, 0)
  /**
   * LE COÛT DE REVIENT PAR MORCEAU — le moteur partagé du lot 52, celui-là même
   * que lisent la mercuriale et les fiches recettes. On ne recalcule rien ici :
   * afficher un coût à l'écran qui diffère de celui qui part dans les fiches
   * serait le pire des deux mondes.
   *
   * À ne pas confondre avec le `coefficient` du dessus : celui-ci porte la MARGE
   * cible et sert au prix de VENTE conseillé. Le coût, lui, répartit la dépense
   * réelle — achat + frais + main-d'œuvre de découpe — au prorata de la valeur.
   */
  const repartitionCout = useMemo(() => repartitionCarcasse({
    cuts,
    poids: Object.fromEntries(Object.entries(cutWeights).map(([k, v]) => [k, parseFloat(v) || 0])),
    coutTotalHT: totalCost1,
    prixRef: cutPrices,
    coutsForces: costOverrides,
  }), [cuts, cutWeights, totalCost1, cutPrices, costOverrides])

  const coutParPiece = useMemo(
    () => new Map(repartitionCout.morceaux.map(m => [m.cut_id, m])),
    [repartitionCout],
  )

  const totalSellable1  = activeResults.reduce((s, r) => s + r.weight, 0)
  const actualMargin1   = totalRevenue1 > 0 ? ((totalRevenue1 - totalCost1) / totalRevenue1) * 100 : 0
  const totalRevenueLot = totalRevenue1 * qty
  const coeffStatus     = coefficient < 0.95 ? 'under' : coefficient > 1.15 ? 'over' : 'ok'

  // Arborescence de découpe (uniquement pour les espèces dont les pièces ont un `group`, ex. bœuf)
  const cutTree = useMemo(() => buildCutTree(cuts), [cuts])
  const isTree  = cuts.some(c => c.group && c.group.length > 0)
  const resById = new Map(results.map(r => [r.cut.id, r]))

  function toggleNode(path: string) {
    setExpandedNodes(prev => { const n = new Set(prev); if (n.has(path)) n.delete(path); else n.add(path); return n })
  }

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/valorisations')
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        setHistoryError(err?.error || `Erreur ${res.status} au chargement de l'historique`)
        return
      }
      const raw = await res.json()
      if (!Array.isArray(raw)) { setHistoryError('Réponse inattendue du serveur'); return }
      setHistory(raw.map(normalizeValo))
      setHistoryError(null)
    } catch {
      setHistoryError('Erreur réseau au chargement de l\'historique')
    }
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  function toggleCat(cat: CutCategory) {
    setCatsByAnimal(prev => {
      const cur = new Set(prev[animalType] ?? CATEGORIES)
      if (cur.has(cat)) cur.delete(cat); else cur.add(cat)
      return { ...prev, [animalType]: Array.from(cur) }
    })
  }

  /** Retire ou réintègre une pièce individuelle du calcul (mémorisé par famille) */
  function toggleCut(cutId: string) {
    setExcludedByAnimal(prev => {
      const cur = new Set(prev[animalType] ?? [])
      if (cur.has(cutId)) cur.delete(cutId); else cur.add(cutId)
      return { ...prev, [animalType]: Array.from(cur) }
    })
  }

  function restoreAllCuts() {
    setExcludedByAnimal(prev => ({ ...prev, [animalType]: [] }))
  }

  async function saveValo() {
    if (!carcW || !ppkg) return
    setSaving(true)
    try {
      const res = await fetch('/api/valorisations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          animal_type: animalType,
          breed_id: breed.id, breed_name: breed.name,
          live_weight: Math.round(liveEstimate * 10) / 10,
          quantity: qty,
          purchase_per_kg: ppkg, overhead_cost: overhead, labor_cost: labor,
          target_margin: targetMargin, purchase_date: purchaseDate,
          notes: notes || null,
          carcass_weight: Math.round(carcassW1 * 10) / 10,
          total_cost: Math.round(totalCostLot * 100) / 100,
          total_revenue: Math.round(totalRevenueLot * 100) / 100,
          margin_rate: Math.round(actualMargin1 * 100) / 100,
          coefficient: Math.round(coefficient * 10000) / 10000,
          decoupe_hours: parseFloat(decoupeHours) || 0,
          cut_weights: activeResults.reduce((acc, r) => { acc[r.cut.id] = Math.round(r.weight * 100) / 100; return acc }, {} as Record<string, number>),
          lot_numbers: lotNumber.trim() || null,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        toast({ variant: 'error', title: 'Enregistrement impossible', description: err?.error || `Erreur ${res.status}` })
        return
      }
      // LA CARCASSE DEVIENT DES INGRÉDIENTS — et personne ne le disait.
      //
      // Depuis le lot 63, enregistrer une découpe crée les articles génériques
      // de ses morceaux : le boucher peut les poser dans une fiche recette avec
      // leur coût au kilo. L'écran, lui, se contentait d'une coche verte
      // « enregistré ». Rien n'indiquait que quelque chose venait d'entrer dans
      // la mercuriale, donc rien n'invitait à aller s'en servir — le lien entre
      // les deux écrans n'existait que dans le code.
      const cree = await res.json().catch(() => null) as { morceaux_crees?: number } | null
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      const n = Number(cree?.morceaux_crees) || 0
      toast({
        variant: 'success',
        title: 'Découpe enregistrée',
        description: n > 0
          ? `${n} morceau${n > 1 ? 'x' : ''} ${n > 1 ? 'entrent' : 'entre'} dans votre mercuriale : posez-${n > 1 ? 'les' : 'le'} comme ingrédient${n > 1 ? 's' : ''} dans une fiche recette, ${n > 1 ? 'ils portent' : 'il porte'} le coût au kilo de cette carcasse.`
          : `Les morceaux pesés portent maintenant le coût au kilo de cette carcasse : retrouvez-les comme ingrédients dans vos fiches recettes.`,
      })
      loadHistory()
    } catch {
      toast({ variant: 'error', title: 'Erreur réseau', description: "La valorisation n'a pas été enregistrée." })
    } finally {
      setSaving(false)
    }
  }

  // ── Export PDF (fiche de valorisation synthétique, 1 page) ──
  async function downloadValoPdf(payload: Record<string, unknown>, filename: string) {
    setPdfBusy(true)
    try {
      const res = await fetch('/api/valorisations/pdf', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { toast({ variant: 'error', title: 'PDF indisponible', description: `Erreur ${res.status}` }); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      toast({ variant: 'error', title: 'Erreur réseau', description: "Le PDF n'a pas pu être généré." })
    } finally {
      setPdfBusy(false)
    }
  }
  function liveValoPdfPayload() {
    return {
      animalLabel: config.label,
      breedName: breed.name,
      purchaseDate,
      lotNumber: lotNumber.trim() || null,
      quantity: qty,
      isHalf,
      carcassWeight: Math.round(carcassW1 * 10) / 10,
      purchasePerKg: ppkg,
      costPerBete: Math.round(totalCost1 * 100) / 100,
      revenuePerBete: Math.round(totalRevenue1 * 100) / 100,
      marginPct: actualMargin1,
      coefficient,
      notes: notes || null,
      pieces: activeResults.map(r => ({
        name: r.cut.name,
        category: r.cut.category,
        weight: Math.round(r.weight * 100) / 100,
        price: Math.round(r.sellingPrice * 100) / 100,
        revenue: Math.round(r.revenue * 100) / 100,
      })),
      generatedAt: new Date().toISOString(),
    }
  }
  function savedValoPdfPayload(v: SavedValo & { lot_numbers?: string | null; cut_weights?: Record<string, number> | null }) {
    const at = v.animal_type as AnimalType
    const qtyS = v.quantity ?? 1
    const coef = Number(v.coefficient) || 1
    const cutDefs = new Map((ANIMALS[at]?.cuts ?? []).map(c => [c.id, c]))
    const prices = cutPricesByAnimal[at] ?? {}
    const cw = v.cut_weights || {}
    const pieces = Object.entries(cw).map(([id, w]) => {
      const cut = cutDefs.get(id)
      const weight = Number(w) || 0
      if (!cut || weight <= 0) return null
      const base = parseFloat(prices[id] ?? '')
      const ref = isNaN(base) ? cut.marketPrice : base
      const price = ref * coef
      return { name: cut.name, category: cut.category, weight: Math.round(weight * 100) / 100, price: Math.round(price * 100) / 100, revenue: Math.round(price * weight * 100) / 100 }
    }).filter((x): x is { name: string; category: CutCategory; weight: number; price: number; revenue: number } => x !== null)
    return {
      animalLabel: ANIMALS[at]?.label,
      breedName: v.breed_name,
      purchaseDate: v.purchase_date,
      lotNumber: v.lot_numbers ?? null,
      quantity: qtyS,
      isHalf: at === 'boeuf' || at === 'veau' || at === 'porc',
      carcassWeight: v.carcass_weight,
      purchasePerKg: v.purchase_per_kg,
      costPerBete: Math.round(((Number(v.total_cost) || 0) / qtyS) * 100) / 100,
      revenuePerBete: Math.round(((Number(v.total_revenue) || 0) / qtyS) * 100) / 100,
      marginPct: v.margin_rate,
      coefficient: coef,
      notes: v.notes ?? null,
      pieces,
      generatedAt: new Date().toISOString(),
    }
  }

  /** Vide le brouillon et remet le formulaire à zéro */
  function resetDraft() {
    try { window.localStorage.removeItem('valo_draft_v1') } catch {}
    setBreedId(config.breeds[0].id)
    setCarcassWeight(config.defaultWeight)
    setPurchasePerKg(config.defaultPurchaseKg)
    setLaborCost(config.defaultLabor)
    setOverheadCost('0')
    setDecoupeHours('')
    setCutWeights({})
    setLotNumber('')
    setExpandedNodes(new Set())
    setNotes('')
    setQuantity('1')
    setTargetMargin(35)
    setPurchaseDate(new Date().toISOString().split('T')[0])
    toast({ variant: 'success', title: 'Saisie réinitialisée' })
  }

  /** Recharge une valorisation sauvegardée dans le calculateur — poids par pièce inclus.
   *  Sauvegarder ensuite crée un NOUVEAU lot (l'original reste dans l'historique). */
  function reopenValo(v: SavedValo & { cut_weights?: Record<string, number> | null; decoupe_hours?: number | null; lot_numbers?: string | null }) {
    const at = (v.animal_type as AnimalType) || 'boeuf'
    if (at !== animalType) skipNextAnimalReset.current = true
    setAnimalType(at)
    setBreedId(v.breed_id)
    setCarcassWeight(String(v.carcass_weight || v.live_weight || ''))
    setQuantity(String(v.quantity ?? 1))
    setPurchasePerKg(String(v.purchase_per_kg ?? ''))
    setOverheadCost(String(v.overhead_cost ?? 0))
    setLaborCost(String(v.labor_cost ?? 0))
    setDecoupeHours(v.decoupe_hours ? String(v.decoupe_hours) : '')
    setTargetMargin(Number(v.target_margin) || 35)
    setPurchaseDate(v.purchase_date)
    setNotes(v.notes ?? '')
    const w: Record<string, string> = {}
    if (v.cut_weights && typeof v.cut_weights === 'object') {
      for (const [k, val] of Object.entries(v.cut_weights)) { const n = Number(val); if (n > 0) w[k] = String(n) }
    }
    setCutWeights(w)
    setLotNumber(typeof v.lot_numbers === 'string' ? v.lot_numbers : '')
    setExpandedNodes(new Set())
    setSelected(null)
    setActiveTab('calc')
    toast({ variant: 'success', title: 'Valorisation rechargée', description: `${v.breed_name} du ${new Date(v.purchase_date).toLocaleDateString('fr-FR')} — modifiez puis « Sauvegarder » pour créer un nouveau lot.` })
  }

  async function deleteValo(id: string) {
    const ok = await confirmAction({
      title: 'Supprimer cette valorisation ?',
      description: 'Elle sera retirée de l’historique et du suivi hebdomadaire. Cette action est définitive.',
      confirmLabel: 'Supprimer',
      variant: 'danger',
    })
    if (!ok) return
    await fetch(`/api/valorisations/${id}`, { method: 'DELETE' })
    setSelected(null); loadHistory()
    toast({ variant: 'success', title: 'Valorisation supprimée' })
  }

  const fromInvoice = params.get('supplier')

  const weekStats: WeekStats[] = useMemo(() => {
    const map = new Map<string, { week: number; year: number; count: number; lots: number; totalCost: number; totalRevenue: number; breeds: Set<string> }>()
    for (const v of history) {
      if (!v.purchase_date) continue
      const { week, year } = getISOWeek(v.purchase_date)
      if (!week || !year || isNaN(week)) continue
      const key = `${year}-W${String(week).padStart(2, '0')}`
      const q = v.quantity ?? 1
      if (!map.has(key)) map.set(key, { week, year, count: 0, lots: 0, totalCost: 0, totalRevenue: 0, breeds: new Set() })
      const entry = map.get(key)!
      entry.count += q; entry.lots += 1
      entry.totalCost += v.total_cost; entry.totalRevenue += v.total_revenue
      entry.breeds.add(`${ANIMALS[v.animal_type as AnimalType]?.emoji ?? ''}${v.breed_name}`)
    }
    return Array.from(map.entries())
      .map(([key, v]) => ({
        key, label: makeWeekLabel(v.week, v.year), week: v.week, year: v.year,
        count: v.count, lots: v.lots, totalCost: v.totalCost, totalRevenue: v.totalRevenue,
        marginRate: v.totalRevenue > 0 ? ((v.totalRevenue - v.totalCost) / v.totalRevenue) * 100 : 0,
        breeds: Array.from(v.breeds),
      }))
      .sort((a, b) => b.year !== a.year ? b.year - a.year : b.week - a.week)
  }, [history])

  const totalAnimals = weekStats.reduce((s, w) => s + w.count, 0)
  const totalCA      = weekStats.reduce((s, w) => s + w.totalRevenue, 0)
  const totalCostAll = weekStats.reduce((s, w) => s + w.totalCost, 0)
  const avgMarginAll = totalCA > 0 ? ((totalCA - totalCostAll) / totalCA) * 100 : 0
  const maxCA        = weekStats.length > 0 ? Math.max(...weekStats.map(w => w.totalRevenue)) : 1

  return (
    <div className="p-6 max-w-7xl mx-auto">

      {/* Bandeau invoice */}
      {fromInvoice && (
        <div className="mb-4 flex items-center gap-2 bg-pilote-50 border border-pilote-200 rounded-xl px-4 py-2.5 text-sm text-pilote-800">
          <CheckCircle className="w-4 h-4 text-pilote flex-shrink-0" />
          Pré-rempli depuis la facture <strong>{fromInvoice}</strong> — ajoutez le poids carcasse pour calculer.
        </div>
      )}

      {historyError && (
        <div className="mb-4 flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
          {historyError}
          <button onClick={loadHistory} className="ml-auto text-xs font-semibold underline hover:no-underline">Réessayer</button>
        </div>
      )}

      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-pilote to-pilote-hover rounded-2xl flex items-center justify-center flex-shrink-0 shadow-card">
            <Calculator className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">Valorisation Carcasse</h1>
            <p className="text-sm text-gray-500">Achat au kg de carcasse · Main d'œuvre réelle du planning · Coefficient · Suivi hebdo</p>
          </div>
        </div>
        {activeTab === 'calc' && (
          <div className="flex items-center gap-3">
            <span className="hidden sm:flex items-center gap-1 text-[11px] text-gray-400"
              title="La saisie en cours est conservée automatiquement — vous pouvez quitter la page et revenir">
              <CheckCircle className="w-3 h-3 text-green-500" />Enregistré
            </span>
            <button onClick={resetDraft} title="Vider la saisie en cours et repartir de zéro"
              className="text-xs text-gray-400 hover:text-red-500 hover:underline transition-colors">
              Réinitialiser
            </button>
            {totalRevenue1 > 0 && (
              <>
                <button onClick={() => downloadValoPdf(liveValoPdfPayload(), `valorisation-${breed.name}.pdf`)} disabled={pdfBusy}
                  title="Télécharger la fiche de valorisation en PDF"
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold text-pilote border border-pilote-200 bg-white hover:bg-pilote-50 transition-all disabled:opacity-50">
                  {pdfBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}PDF
                </button>
                <button onClick={saveValo} disabled={saving || saved}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-card transition-all ${
                    saved ? 'bg-green-600' : 'bg-pilote hover:bg-pilote-hover'
                  }`}>
                  {saving ? <><Loader2 className="w-4 h-4 animate-spin" />Enregistrement...</>
                    : saved ? <><CheckCircle className="w-4 h-4" />Sauvegardé !</>
                    : <><Save className="w-4 h-4" />Sauvegarder le lot</>}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Sélecteur d'espèces ── */}
      <SelecteurEspeces animalType={animalType} setAnimalType={setAnimalType} excludedByAnimal={excludedByAnimal} />

      {/* ── Onglets Calculateur / Suivi ── */}
      <OngletsVue activeTab={activeTab} setActiveTab={setActiveTab} weekStats={weekStats} />

      {/* ══ SUIVI HEBDO ══ */}
      {activeTab === 'suivi' && (
        <VueSuiviHebdo
          weekStats={weekStats} setActiveTab={setActiveTab} totalAnimals={totalAnimals}
          totalCA={totalCA} avgMarginAll={avgMarginAll} maxCA={maxCA} />
      )}

      {/* ══ CALCULATEUR ══ */}
      {activeTab === 'calc' && (
        <>
          {/* Historique */}
          {history.length > 0 && (
            <CarrouselHistorique history={history} setSelected={setSelected} />
          )}

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

            {/* ── FORMULAIRE ── */}
            <div className="xl:col-span-1 space-y-5">

              {/* 1 — Animal */}
              <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-card">
                <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <span className="w-5 h-5 bg-pilote text-white text-xs rounded-full flex items-center justify-center font-bold">1</span>
                  {config.label} {config.emoji}
                </h2>
                <div className="mb-4">
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">{config.breedLabel}</label>
                  <select value={breedId} onChange={e => setBreedId(e.target.value)}
                    className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200`}>
                    {breeds.map(b => <option key={b.id} value={b.id}>{b.name} — rendement {(b.carcassYield * 100).toFixed(1)}%</option>)}
                  </select>
                  <button onClick={() => setShowBreedInfo(v => !v)} className="mt-1.5 text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
                    <Info className="w-3 h-3" />{showBreedInfo ? 'Masquer' : 'Caractéristiques'}
                  </button>
                  {showBreedInfo && (
                    <div className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-100">
                      <p className="text-xs font-semibold text-gray-800">{breed.name} — {breed.origin}</p>
                      <p className="text-xs text-gray-600 leading-relaxed mt-1">{breed.description}</p>
                      <p className="text-xs text-gray-600 font-medium pt-1">Poids vif moyen : {breed.avgWeight}</p>
                    </div>
                  )}
                </div>

                {/* Quantité */}
                <div className="mb-4 p-3 bg-pilote-50 border border-pilote-100 rounded-xl">
                  <label className="block text-xs font-semibold text-pilote-800 mb-1.5 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" />{isHalf ? 'Nombre de demis' : "Nombre d'animaux dans le lot"}
                  </label>
                  <div className="flex items-center gap-3">
                    <button onClick={() => setQuantity(q => String(Math.max(1, parseInt(q) - 1)))}
                      className="w-8 h-8 rounded-lg bg-white border border-pilote-200 text-pilote font-bold text-lg flex items-center justify-center hover:bg-pilote-100 transition-colors">−</button>
                    <span className="text-2xl font-extrabold text-pilote-800 w-8 text-center tabular-nums">{qty}</span>
                    <button onClick={() => setQuantity(q => String(parseInt(q) + 1))}
                      className="w-8 h-8 rounded-lg bg-white border border-pilote-200 text-pilote font-bold text-lg flex items-center justify-center hover:bg-pilote-100 transition-colors">+</button>
                    {qty > 1 && <span className="text-xs text-pilote font-medium">{isHalf ? 'Résultats par demi + total lot' : 'Résultats par animal + total lot'}</span>}
                  </div>
                </div>

                <div className="mb-4">
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">{isHalf ? "Poids d'un demi-carcasse (kg)" : 'Poids carcasse par animal (kg)'}</label>
                  <input type="number" value={carcassWeight} onChange={e => setCarcassWeight(e.target.value)}
                    className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200`} />
                  {carcW > 0 && !isHalf && <p className="text-xs text-gray-500 mt-1">Poids vif estimé : <strong>{liveEstimate.toFixed(0)} kg</strong> (rendement {(breed.carcassYield * 100).toFixed(1)}%)</p>}
                </div>
                <div className="mb-4">
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Prix achat (€/kg carcasse)</label>
                  <input type="number" step="0.01" value={purchasePerKg} onChange={e => setPurchasePerKg(e.target.value)}
                    className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200`} />
                  {carcW > 0 && ppkg > 0 && (
                    <p className="text-xs text-gray-500 mt-1">
                      {qty > 1 ? <><strong>{eur(purchaseTotal1)}/animal</strong> · lot : <strong className="text-pilote-800">{eur(purchaseTotalLot)}</strong></> : <strong>{eur(purchaseTotal1)}</strong>}
                    </p>
                  )}
                </div>
                <div className="mb-4">
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Date d&apos;achat</label>
                  <input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)}
                    className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200`} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">N° de lot <span className="text-gray-400 font-normal">— traçabilité, saisi par le gérant</span></label>
                  <input type="text" value={lotNumber} onChange={e => setLotNumber(e.target.value)}
                    placeholder="ex : n° de lot abattoir"
                    className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200`} />
                </div>
              </div>

              {/* 2 — Charges */}
              <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-card">
                <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <span className="w-5 h-5 bg-pilote text-white text-xs rounded-full flex items-center justify-center font-bold">2</span>
                  Charges <span className="text-xs font-normal text-gray-400">{isHalf ? '(par demi)' : '(par animal)'}</span>
                </h2>
                <div className="mb-4">
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Charges fixes pro-ratées (€)</label>
                  <input type="number" value={overheadCost} onChange={e => setOverheadCost(e.target.value)}
                    className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200`} />
                </div>

                {/* Main d'œuvre = temps de découpe saisi dans le planning */}
                {weekLabor && weekLabor.decoupeHours > 0 ? (
                  <div className="mb-3 p-2.5 bg-pilote-50 border border-pilote-100 rounded-lg">
                    <p className="text-[11px] font-semibold text-pilote-800">
                      Découpe S{weekLabor.week} (planning) : {weekLabor.decoupeHours.toFixed(0)} min · {eur(weekLabor.decoupeCost)} chargé
                    </p>
                    <p className="text-[10px] text-pilote-800/70 mt-0.5">
                      Imputé automatiquement à la main d'œuvre ci-dessous — taux réel {eur(weekLabor.rate)}/h. Modifiable.
                    </p>
                  </div>
                ) : (
                  <p className="mb-3 text-[10px] text-gray-400">
                    Astuce : renseignez le <strong>temps de découpe</strong> dans les postes « Boucherie » du planning de la semaine — il s'impute ici automatiquement au taux réel.
                  </p>
                )}
                <div className="mb-4">
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Temps de découpe (min) <span className="text-gray-400 font-normal">— depuis le planning, modifiable</span></label>
                  <input type="number" step="1" min="0" value={decoupeHours} onChange={e => setDecoupe(e.target.value)}
                    placeholder="ex : 120"
                    className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200`} />
                  {decoupeHours && weekLabor && weekLabor.rate > 0 && (
                    <p className="text-xs text-pilote mt-1 font-medium">= {eur(((parseFloat(decoupeHours) || 0) / 60) * weekLabor.rate)} imputés au taux réel du planning</p>
                  )}
                </div>
                <div className="mb-4">
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Main d'œuvre découpe (€) <span className="text-gray-400 font-normal">— auto, modifiable</span></label>
                  <input type="number" value={laborCost} onChange={e => setLaborCost(e.target.value)}
                    className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200`} />
                </div>
                {totalCost1 > 0 && (
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-500">Coût de revient {qty > 1 ? (isHalf ? 'par demi' : 'par animal') : 'total'}</p>
                    <p className="text-xl font-bold text-gray-900">{eur(totalCost1)}</p>
                    {qty > 1 && <p className="text-xs font-bold text-pilote-800 mt-0.5">Lot ({qty} {isHalf ? 'demis' : 'animaux'}) : {eur(totalCostLot)}</p>}
                  </div>
                )}
              </div>

              {/* 3 — Marge */}
              <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-card">
                <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <span className="w-5 h-5 bg-pilote text-white text-xs rounded-full flex items-center justify-center font-bold">3</span>
                  Marge souhaitée
                </h2>
                <div className="flex items-center gap-4 mb-2">
                  <input type="range" min={10} max={70} step={1} value={targetMargin} onChange={e => setTargetMargin(Number(e.target.value))}
                    className="flex-1 accent-pilote" />
                  <span className="text-2xl font-bold text-gray-800 w-14 text-right tabular-nums">{targetMargin}%</span>
                </div>
                <div className="flex justify-between text-xs text-gray-400"><span>10%</span><span>40% (typique)</span><span>70%</span></div>
              </div>

              {/* 4 — Pièces (catégories) — masqué pour le bœuf, remplacé par l'arborescence dépliable */}
              {!isTree && (
              <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-card">
                <h2 className="text-sm font-semibold text-gray-900 mb-1 flex items-center gap-2">
                  <span className="w-5 h-5 bg-pilote text-white text-xs rounded-full flex items-center justify-center font-bold">4</span>
                  Pièces à valoriser
                </h2>
                <p className="text-[11px] text-gray-400 mb-3">Choix mémorisés pour {config.label.toLowerCase()} · retirez une pièce précise dans le tableau</p>
                <div className="space-y-2">
                  {CATEGORIES.map(cat => (
                    <label key={cat} className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={includedCats.has(cat)} onChange={() => toggleCat(cat)} className="rounded" />
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${CATEGORY_COLORS[cat]}`}>{CATEGORY_LABELS[cat]}</span>
                    </label>
                  ))}
                </div>
                {excludedCuts.size > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
                    <span className="text-xs text-gray-500">{excludedCuts.size} pièce{excludedCuts.size > 1 ? 's' : ''} retirée{excludedCuts.size > 1 ? 's' : ''} du calcul</span>
                    <button onClick={restoreAllCuts} className="flex items-center gap-1 text-xs text-pilote font-medium hover:underline">
                      <RotateCcw className="w-3 h-3" />Tout réactiver
                    </button>
                  </div>
                )}
              </div>
              )}

              {totalRevenue1 > 0 && (
                <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-card">
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">Notes</label>
                  <textarea value={notes} onChange={e => setNotes(e.target.value)}
                    placeholder="Qualité, conditions d'achat, fournisseur..."
                    rows={2} className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200 resize-none`} />
                </div>
              )}
            </div>

            {/* ── RÉSULTATS ── */}
            <div className="xl:col-span-2 space-y-5">

              <BlocResultats
                qty={qty} isHalf={isHalf} config={config} totalRevenue1={totalRevenue1}
                totalCostLot={totalCostLot} totalRevenueLot={totalRevenueLot} actualMargin1={actualMargin1}
                coeffStatus={coeffStatus} coefficient={coefficient} targetMargin={targetMargin}
                totalMarketRevenue1={totalMarketRevenue1} totalSellable1={totalSellable1}
                carcassW1={carcassW1} totalCost1={totalCost1} />

              <TableauMorceaux
                results={results} isTree={isTree} cutTree={cutTree} resById={resById}
                expandedNodes={expandedNodes} toggleNode={toggleNode}
                includedCats={includedCats} excludedCuts={excludedCuts} priceOf={priceOf}
                cutWeights={cutWeights} setCutWeights={setCutWeights}
                cutPrices={cutPrices} setCutPrice={setCutPrice}
                coutParPiece={coutParPiece} costOverrides={costOverrides} setCostOverride={setCostOverride}
                sellOverrides={sellOverrides} setSellOverride={setSellOverride}
                coefficient={coefficient} toggleCut={toggleCut} repartitionCout={repartitionCout}
                qty={qty} isHalf={isHalf} config={config} totalSellable1={totalSellable1}
                totalMarketRevenue1={totalMarketRevenue1} totalRevenue1={totalRevenue1}
                totalRevenueLot={totalRevenueLot} />
            </div>
          </div>
        </>
      )}

      {/* Modal historique */}
      {selected && (
        <ModaleLot
          selected={selected} setSelected={setSelected} deleteValo={deleteValo}
          downloadValoPdf={downloadValoPdf} savedValoPdfPayload={savedValoPdfPayload}
          reopenValo={reopenValo} pdfBusy={pdfBusy} />
      )}
    </div>
  )
}
