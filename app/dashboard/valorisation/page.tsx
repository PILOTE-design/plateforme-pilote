'use client'

import React, { useState, useMemo, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Calculator, TrendingUp, Package, Info, AlertTriangle, CheckCircle, Save, Trash2, Clock, X, Loader2, Users } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

type CutCategory = 'premier' | 'deuxieme' | 'troisieme' | 'abat' | 'os'

interface Breed { id: string; name: string; carcassYield: number; avgWeight: string; origin: string; description: string }
interface Cut { id: string; name: string; category: CutCategory; yieldPct: number; marketPrice: number }
interface CutResult { cut: Cut; weight: number; sellingPrice: number; revenue: number }
interface SavedValo {
  id: string; breed_id: string; breed_name: string; live_weight: number; quantity: number
  purchase_per_kg: number; overhead_cost: number; labor_cost: number; target_margin: number
  purchase_date: string; notes?: string; carcass_weight: number; total_cost: number
  total_revenue: number; margin_rate: number; coefficient: number; created_at: string
}

// ─── Données ─────────────────────────────────────────────────────────────────

const BREEDS: Breed[] = [
  { id: 'charolaise',       name: 'Charolaise',         carcassYield: 0.645, avgWeight: '750-950 kg',  origin: 'Bourgogne',        description: "Race à viande n°1 en France. Masses musculaires très développées. Viande ferme, peu persillée, idéale pour pièces à griller et rôtir." },
  { id: 'limousine',        name: 'Limousine',          carcassYield: 0.655, avgWeight: '650-850 kg',  origin: 'Limousin',         description: "Meilleur rendement en muscles nobles toutes races confondues. Grain fin, couleur rouge vif. Conformation E." },
  { id: 'blonde_aquitaine', name: "Blonde d'Aquitaine", carcassYield: 0.640, avgWeight: '750-950 kg',  origin: 'Sud-Ouest',        description: "Viande maigre et tendre, bonne conformation E-U. Rendement élevé en pièces nobles." },
  { id: 'salers',           name: 'Salers',             carcassYield: 0.600, avgWeight: '600-750 kg',  origin: 'Auvergne',         description: "Race rustique de montagne. Viande goûteuse et légèrement persillée. Bon compromis rendement/qualité." },
  { id: 'aubrac',           name: 'Aubrac',             carcassYield: 0.578, avgWeight: '550-700 kg',  origin: 'Aveyron-Lozère',   description: "Viande bien persillée, saveur prononcée et fondante. Qualité gustative remarquable." },
  { id: 'normande',         name: 'Normande',           carcassYield: 0.555, avgWeight: '600-750 kg',  origin: 'Normandie',        description: "Race mixte lait et viande. Viande marbrée, persillage notable, saveur riche et beurrée." },
  { id: 'maine_anjou',      name: 'Maine-Anjou',        carcassYield: 0.625, avgWeight: '800-1000 kg', origin: 'Pays de la Loire', description: "Grosse race mixte. Viande marbrée et savoureuse, très appréciée pour les grandes pièces." },
  { id: 'parthenaise',      name: 'Parthenaise',        carcassYield: 0.630, avgWeight: '650-800 kg',  origin: 'Poitou-Charentes', description: "Viande tendre et fine, bonne conformation. Très appréciée des bouchers du Grand Ouest." },
  { id: 'angus',            name: 'Aberdeen Angus',     carcassYield: 0.578, avgWeight: '600-750 kg',  origin: 'Écosse/France',    description: "Persillage exceptionnel dit marbré, viande fondante et savoureuse. Segment premium." },
  { id: 'hereford',         name: 'Hereford',           carcassYield: 0.565, avgWeight: '550-700 kg',  origin: 'Angleterre/France', description: "Viande bien persillée, tendre et goûteuse. Qualité constante, appréciée des bouchers exigeants." },
]

const CUTS: Cut[] = [
  { id: 'filet',            name: 'Filet (tournedos/rôti)',  category: 'premier',   yieldPct: 1.8,  marketPrice: 45 },
  { id: 'faux_filet',       name: 'Faux-filet',              category: 'premier',   yieldPct: 3.0,  marketPrice: 29 },
  { id: 'cote_boeuf',       name: 'Côte de bœuf/Entrecôte', category: 'premier',   yieldPct: 7.0,  marketPrice: 26 },
  { id: 'rumsteck',         name: 'Rumsteck',                category: 'premier',   yieldPct: 3.2,  marketPrice: 22 },
  { id: 'bavette_aloyau',   name: "Bavette d'aloyau",        category: 'premier',   yieldPct: 1.3,  marketPrice: 20 },
  { id: 'tende_tranche',    name: 'Tende de tranche',        category: 'premier',   yieldPct: 3.5,  marketPrice: 18 },
  { id: 'tranche_grasse',   name: 'Tranche grasse',          category: 'premier',   yieldPct: 2.5,  marketPrice: 17 },
  { id: 'rond_gite',        name: 'Rond de gîte',            category: 'premier',   yieldPct: 1.8,  marketPrice: 16 },
  { id: 'gite_noix',        name: 'Gîte à la noix',          category: 'premier',   yieldPct: 2.5,  marketPrice: 15 },
  { id: 'araignee',         name: 'Araignée',                category: 'premier',   yieldPct: 0.3,  marketPrice: 32 },
  { id: 'hampe',            name: 'Hampe',                   category: 'premier',   yieldPct: 0.5,  marketPrice: 25 },
  { id: 'onglet',           name: 'Onglet',                  category: 'premier',   yieldPct: 0.4,  marketPrice: 32 },
  { id: 'paleron',          name: 'Paleron',                 category: 'deuxieme',  yieldPct: 3.5,  marketPrice: 15 },
  { id: 'macreuse_braiser', name: 'Macreuse à braiser',      category: 'deuxieme',  yieldPct: 2.5,  marketPrice: 14 },
  { id: 'macreuse_bifteck', name: 'Macreuse à bifteck',      category: 'deuxieme',  yieldPct: 1.5,  marketPrice: 16 },
  { id: 'joue',             name: 'Joue de bœuf',            category: 'deuxieme',  yieldPct: 1.2,  marketPrice: 24 },
  { id: 'collier',          name: 'Collier',                 category: 'deuxieme',  yieldPct: 1.8,  marketPrice: 12 },
  { id: 'plat_cotes',       name: 'Plat de côtes',           category: 'troisieme', yieldPct: 4.5,  marketPrice: 9  },
  { id: 'poitrine',         name: 'Poitrine',                category: 'troisieme', yieldPct: 3.5,  marketPrice: 9  },
  { id: 'flanchet',         name: 'Flanchet',                category: 'troisieme', yieldPct: 1.2,  marketPrice: 10 },
  { id: 'bavette_flanchet', name: 'Bavette de flanchet',     category: 'troisieme', yieldPct: 0.8,  marketPrice: 12 },
  { id: 'jarret_avant',     name: 'Jarret avant',            category: 'troisieme', yieldPct: 2.5,  marketPrice: 9  },
  { id: 'jarret_arriere',   name: 'Jarret arrière/Gîte',    category: 'troisieme', yieldPct: 3.0,  marketPrice: 9  },
  { id: 'foie',             name: 'Foie',                    category: 'abat',      yieldPct: 1.3,  marketPrice: 5  },
  { id: 'coeur',            name: 'Cœur',                    category: 'abat',      yieldPct: 0.4,  marketPrice: 5  },
  { id: 'langue',           name: 'Langue',                  category: 'abat',      yieldPct: 0.5,  marketPrice: 18 },
  { id: 'rognons',          name: 'Rognons',                 category: 'abat',      yieldPct: 0.3,  marketPrice: 5  },
  { id: 'queue',            name: 'Queue',                   category: 'abat',      yieldPct: 0.7,  marketPrice: 13 },
  { id: 'os_moelle',        name: 'Os à moelle',             category: 'os',        yieldPct: 4.0,  marketPrice: 3  },
]

const CATEGORY_LABELS: Record<CutCategory, string> = {
  premier: '1er choix — Arrière', deuxieme: '2e choix — Avant',
  troisieme: '3e choix — Divers', abat: 'Abats', os: 'Os valorisables',
}
const CATEGORY_COLORS: Record<CutCategory, string> = {
  premier: 'bg-red-50 text-red-700 border-red-200', deuxieme: 'bg-orange-50 text-orange-700 border-orange-200',
  troisieme: 'bg-yellow-50 text-yellow-700 border-yellow-200', abat: 'bg-purple-50 text-purple-700 border-purple-200', os: 'bg-gray-50 text-gray-600 border-gray-200',
}
const CATEGORIES: CutCategory[] = ['premier', 'deuxieme', 'troisieme', 'abat', 'os']

function eur(n: number) { return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }) }
function kgStr(n: number) { return n.toFixed(1) + ' kg' }

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ValorisationPage() {
  const params = useSearchParams()

  const [breedId, setBreedId]             = useState('charolaise')
  const [liveWeight, setLiveWeight]       = useState('800')
  const [quantity, setQuantity]           = useState('1')
  const [purchasePerKg, setPurchasePerKg] = useState('3.80')
  const [overheadCost, setOverheadCost]   = useState('0')
  const [laborCost, setLaborCost]         = useState('150')
  const [targetMargin, setTargetMargin]   = useState(35)
  const [showBreedInfo, setShowBreedInfo] = useState(false)
  const [includedCats, setIncludedCats]   = useState<Set<CutCategory>>(new Set(CATEGORIES))
  const [purchaseDate, setPurchaseDate]   = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes]                 = useState('')
  const [history, setHistory]             = useState<SavedValo[]>([])
  const [saving, setSaving]               = useState(false)
  const [saved, setSaved]                 = useState(false)
  const [selected, setSelected]           = useState<SavedValo | null>(null)

  // Pré-remplissage depuis la facturation (?date=...&supplier=...&amount_ht=...)
  useEffect(() => {
    const date     = params.get('date')
    const supplier = params.get('supplier')
    const amount   = params.get('amount_ht')
    if (date)     setPurchaseDate(date)
    if (supplier) setNotes(`Facture ${supplier}`)
    if (amount)   setOverheadCost('0') // Le montant de la facture sera mis en note
  }, [params])

  const breed    = BREEDS.find(b => b.id === breedId) ?? BREEDS[0]
  const liveW    = parseFloat(liveWeight)  || 0
  const qty      = Math.max(1, parseInt(quantity) || 1)
  const ppkg     = parseFloat(purchasePerKg)  || 0
  const overhead = parseFloat(overheadCost)   || 0
  const labor    = parseFloat(laborCost)      || 0

  // Calculs PAR ANIMAL
  const carcassW1      = liveW * breed.carcassYield
  const purchaseTotal1 = liveW * ppkg
  const totalCost1     = purchaseTotal1 + overhead + labor

  // Calculs TOTAL LOT
  const carcassWTotal   = carcassW1 * qty
  const purchaseTotalLot = purchaseTotal1 * qty
  const totalCostLot    = totalCost1 * qty

  const { results, coefficient, totalMarketRevenue1 } = useMemo(() => {
    if (liveW <= 0 || ppkg <= 0) return { results: [] as CutResult[], coefficient: 1, totalMarketRevenue1: 0 }
    const activeCuts   = CUTS.filter(c => includedCats.has(c.category))
    const mktRevenue   = activeCuts.reduce((s, c) => s + (carcassW1 * c.yieldPct / 100) * c.marketPrice, 0)
    const targetRev    = targetMargin < 100 && totalCost1 > 0 ? totalCost1 / (1 - targetMargin / 100) : mktRevenue
    const coeff        = mktRevenue > 0 ? targetRev / mktRevenue : 1
    const res: CutResult[] = CUTS.map(cut => {
      const weight       = carcassW1 * cut.yieldPct / 100
      const active       = includedCats.has(cut.category)
      const sellingPrice = active ? cut.marketPrice * coeff : 0
      return { cut, weight, sellingPrice, revenue: sellingPrice * weight }
    })
    return { results: res, coefficient: coeff, totalMarketRevenue1: mktRevenue }
  }, [breedId, liveW, ppkg, overhead, labor, targetMargin, includedCats, carcassW1, totalCost1])

  const activeResults   = results.filter(r => includedCats.has(r.cut.category))
  const totalRevenue1   = activeResults.reduce((s, r) => s + r.revenue, 0)
  const totalSellable1  = activeResults.reduce((s, r) => s + r.weight, 0)
  const actualMargin1   = totalRevenue1 > 0 ? ((totalRevenue1 - totalCost1) / totalRevenue1) * 100 : 0
  const totalRevenueLot = totalRevenue1 * qty
  const coeffStatus     = coefficient < 0.95 ? 'under' : coefficient > 1.15 ? 'over' : 'ok'

  const loadHistory = useCallback(async () => {
    const res = await fetch('/api/valorisations').catch(() => null)
    if (res?.ok) setHistory(await res.json())
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  function toggleCat(cat: CutCategory) {
    setIncludedCats(prev => { const n = new Set(prev); n.has(cat) ? n.delete(cat) : n.add(cat); return n })
  }

  async function saveValo() {
    if (!liveW || !ppkg) return
    setSaving(true)
    await fetch('/api/valorisations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        breed_id: breed.id, breed_name: breed.name,
        live_weight: liveW, quantity: qty,
        purchase_per_kg: ppkg, overhead_cost: overhead, labor_cost: labor,
        target_margin: targetMargin, purchase_date: purchaseDate,
        notes: notes || null,
        carcass_weight: Math.round(carcassW1 * 10) / 10,
        total_cost: Math.round(totalCostLot * 100) / 100,
        total_revenue: Math.round(totalRevenueLot * 100) / 100,
        margin_rate: Math.round(actualMargin1 * 100) / 100,
        coefficient: Math.round(coefficient * 10000) / 10000,
      }),
    })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    loadHistory()
  }

  async function deleteValo(id: string) {
    if (!confirm('Supprimer cette valorisation ?')) return
    await fetch(`/api/valorisations/${id}`, { method: 'DELETE' })
    setSelected(null); loadHistory()
  }

  const fromInvoice = params.get('supplier')

  return (
    <div className="p-6 max-w-7xl mx-auto">

      {/* Bandeau "importé depuis facture" */}
      {fromInvoice && (
        <div className="mb-4 flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 text-sm text-blue-800">
          <CheckCircle className="w-4 h-4 text-blue-500 flex-shrink-0" />
          Pré-rempli depuis la facture <strong>{fromInvoice}</strong> — ajoutez le poids vif et la race pour calculer.
        </div>
      )}

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-red-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <Calculator className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Valorisation Carcasse</h1>
            <p className="text-sm text-gray-500">Prix de marché réels · Coefficient · Multi-animaux · Historique</p>
          </div>
        </div>
        {totalRevenue1 > 0 && (
          <button onClick={saveValo} disabled={saving || saved}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
              saved ? 'bg-green-600 text-white' : 'bg-[#1E3A5F] hover:bg-[#2a4f7c] text-white'
            }`}>
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" />Enregistrement...</>
              : saved ? <><CheckCircle className="w-4 h-4" />Sauvegardé !</>
              : <><Save className="w-4 h-4" />Sauvegarder le lot</>}
          </button>
        )}
      </div>

      {/* Historique */}
      {history.length > 0 && (
        <div className="mb-6 bg-white border border-gray-200 rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-400" />Historique des valorisations
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {history.map(v => (
              <button key={v.id} onClick={() => setSelected(v)}
                className="flex-shrink-0 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl p-3 text-left transition-colors w-56">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-gray-800">{v.breed_name}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    v.margin_rate >= 35 ? 'bg-green-100 text-green-700' : v.margin_rate >= 25 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
                  }`}>{v.margin_rate.toFixed(1)}%</span>
                </div>
                <p className="text-xs text-gray-500">
                  {(v.quantity ?? 1) > 1 ? <span className="font-semibold text-blue-600">{v.quantity} animaux · </span> : ''}
                  {v.live_weight} kg · {new Date(v.purchase_date).toLocaleDateString('fr-FR')}
                </p>
                <p className="text-sm font-bold text-[#1E3A5F] mt-1">{eur(v.total_revenue)}</p>
                <p className="text-[10px] text-gray-400">CA estim. total · coeff. x{v.coefficient?.toFixed(3)}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* ══ FORMULAIRE ══ */}
        <div className="xl:col-span-1 space-y-5">

          {/* 1 — Animal */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span className="w-5 h-5 bg-gray-900 text-white text-xs rounded-full flex items-center justify-center font-bold">1</span>Animal
            </h2>
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Race bovine</label>
              <select value={breedId} onChange={e => setBreedId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500">
                {BREEDS.map(b => <option key={b.id} value={b.id}>{b.name} — rendement {(b.carcassYield * 100).toFixed(1)}%</option>)}
              </select>
              <button onClick={() => setShowBreedInfo(v => !v)} className="mt-1.5 text-xs text-red-600 hover:text-red-700 flex items-center gap-1">
                <Info className="w-3 h-3" />{showBreedInfo ? 'Masquer' : 'Caractéristiques de la race'}
              </button>
              {showBreedInfo && (
                <div className="mt-2 p-3 bg-red-50 rounded-lg border border-red-100">
                  <p className="text-xs font-semibold text-red-800">{breed.name} — {breed.origin}</p>
                  <p className="text-xs text-red-700 leading-relaxed mt-1">{breed.description}</p>
                  <p className="text-xs text-red-700 font-medium pt-1">Poids moyen : {breed.avgWeight}</p>
                </div>
              )}
            </div>

            {/* Nombre d'animaux */}
            <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-xl">
              <label className="block text-xs font-semibold text-blue-800 mb-1.5 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />Nombre d&apos;animaux dans le lot
              </label>
              <div className="flex items-center gap-3">
                <button onClick={() => setQuantity(q => String(Math.max(1, parseInt(q) - 1)))}
                  className="w-8 h-8 rounded-lg bg-white border border-blue-200 text-blue-700 font-bold text-lg flex items-center justify-center hover:bg-blue-100">
                  −
                </button>
                <span className="text-2xl font-extrabold text-blue-800 w-8 text-center tabular-nums">{qty}</span>
                <button onClick={() => setQuantity(q => String(parseInt(q) + 1))}
                  className="w-8 h-8 rounded-lg bg-white border border-blue-200 text-blue-700 font-bold text-lg flex items-center justify-center hover:bg-blue-100">
                  +
                </button>
                {qty > 1 && <span className="text-xs text-blue-600 font-medium">Les résultats affichent « par animal » et le total du lot</span>}
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Poids vif par animal (kg)</label>
              <input type="number" value={liveWeight} onChange={e => setLiveWeight(e.target.value)} placeholder="800"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
              {liveW > 0 && <p className="text-xs text-gray-500 mt-1">Carcasse estimée : <strong>{carcassW1.toFixed(0)} kg/animal</strong> ({(breed.carcassYield * 100).toFixed(1)}%)</p>}
            </div>
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Prix achat (€/kg vif)</label>
              <input type="number" step="0.01" value={purchasePerKg} onChange={e => setPurchasePerKg(e.target.value)} placeholder="3.80"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
              {liveW > 0 && ppkg > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  {qty > 1 ? <><strong>{eur(purchaseTotal1)}/animal</strong> · total lot : <strong className="text-blue-700">{eur(purchaseTotalLot)}</strong></> : <strong>{eur(purchaseTotal1)}</strong>}
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Date d&apos;achat</label>
              <input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
            </div>
          </div>

          {/* 2 — Charges */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span className="w-5 h-5 bg-gray-900 text-white text-xs rounded-full flex items-center justify-center font-bold">2</span>Charges à imputer
              <span className="text-xs font-normal text-gray-400">(par animal)</span>
            </h2>
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Charges fixes pro-ratées (€)</label>
              <input type="number" value={overheadCost} onChange={e => setOverheadCost(e.target.value)} placeholder="0"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
            </div>
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Main d&apos;œuvre découpe (€)</label>
              <input type="number" value={laborCost} onChange={e => setLaborCost(e.target.value)} placeholder="150"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
            </div>
            {totalCost1 > 0 && (
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-500">Coût de revient {qty > 1 ? 'par animal' : 'total'}</p>
                <p className="text-xl font-bold text-gray-900">{eur(totalCost1)}</p>
                {qty > 1 && <p className="text-xs font-bold text-blue-700 mt-0.5">Lot ({qty} animaux) : {eur(totalCostLot)}</p>}
                {totalMarketRevenue1 > 0 && <p className="text-xs text-gray-400 mt-1">Marge aux prix du marché : {(((totalMarketRevenue1 - totalCost1) / totalMarketRevenue1) * 100).toFixed(1)}%</p>}
              </div>
            )}
          </div>

          {/* 3 — Marge */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span className="w-5 h-5 bg-gray-900 text-white text-xs rounded-full flex items-center justify-center font-bold">3</span>Marge souhaitée
            </h2>
            <div className="flex items-center gap-4 mb-2">
              <input type="range" min={10} max={70} step={1} value={targetMargin} onChange={e => setTargetMargin(Number(e.target.value))} className="flex-1 accent-red-600" />
              <span className="text-2xl font-bold text-red-600 w-14 text-right tabular-nums">{targetMargin}%</span>
            </div>
            <div className="flex justify-between text-xs text-gray-400"><span>10%</span><span>40% (typique)</span><span>70%</span></div>
          </div>

          {/* 4 — Pièces */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span className="w-5 h-5 bg-gray-900 text-white text-xs rounded-full flex items-center justify-center font-bold">4</span>Pièces à valoriser
            </h2>
            <div className="space-y-2">
              {CATEGORIES.map(cat => (
                <label key={cat} className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={includedCats.has(cat)} onChange={() => toggleCat(cat)} className="rounded accent-red-600" />
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${CATEGORY_COLORS[cat]}`}>{CATEGORY_LABELS[cat]}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Notes */}
          {totalRevenue1 > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Notes</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Qualité, conditions d'achat, fournisseur..."
                rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none" />
            </div>
          )}
        </div>

        {/* ══ RÉSULTATS ══ */}
        <div className="xl:col-span-2 space-y-5">

          {/* Bandeau lot si qty > 1 */}
          {qty > 1 && totalRevenue1 > 0 && (
            <div className="bg-blue-700 rounded-2xl p-4 text-white">
              <p className="text-xs font-semibold text-blue-200 mb-2 uppercase tracking-wide">Récapitulatif lot — {qty} animaux</p>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-blue-300">Coût total lot</p>
                  <p className="text-xl font-extrabold">{eur(totalCostLot)}</p>
                </div>
                <div>
                  <p className="text-xs text-blue-300">CA estimé total</p>
                  <p className="text-xl font-extrabold text-yellow-300">{eur(totalRevenueLot)}</p>
                </div>
                <div>
                  <p className="text-xs text-blue-300">Marge brute lot</p>
                  <p className="text-xl font-extrabold text-green-300">{eur(totalRevenueLot - totalCostLot)}</p>
                  <p className="text-xs text-blue-300">{actualMargin1.toFixed(1)}% de marge</p>
                </div>
              </div>
            </div>
          )}

          {/* Coefficient */}
          {totalRevenue1 > 0 && (
            <div className={`rounded-2xl p-4 border ${
              coeffStatus === 'under' ? 'bg-green-50 border-green-200' : coeffStatus === 'over' ? 'bg-orange-50 border-orange-200' : 'bg-blue-50 border-blue-200'
            }`}>
              <div className="flex items-start gap-3">
                {coeffStatus === 'under' && <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />}
                {coeffStatus === 'over'  && <AlertTriangle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />}
                {coeffStatus === 'ok'    && <TrendingUp className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />}
                <div className="flex-1">
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className={`text-2xl font-bold ${
                      coeffStatus === 'under' ? 'text-green-700' : coeffStatus === 'over' ? 'text-orange-700' : 'text-blue-700'
                    }`}>x{coefficient.toFixed(3)}</span>
                    <span className="text-sm font-semibold text-gray-700">Coefficient de valorisation</span>
                  </div>
                  <p className={`text-xs leading-relaxed ${
                    coeffStatus === 'under' ? 'text-green-700' : coeffStatus === 'over' ? 'text-orange-700' : 'text-blue-700'
                  }`}>
                    {coeffStatus === 'under' && <>Vos coûts sont bas : vous pouvez être <strong>{((1-coefficient)*100).toFixed(1)}% sous le marché</strong> et atteindre {targetMargin}% de marge.</> }
                    {coeffStatus === 'over'  && <>Pour {targetMargin}% de marge, vos prix doivent être <strong>{((coefficient-1)*100).toFixed(1)}% au-dessus du marché</strong>. Positionnement premium recommandé.</> }
                    {coeffStatus === 'ok'    && <>Vos prix sont proches du marché ({coefficient > 1 ? '+' : ''}{((coefficient-1)*100).toFixed(1)}%). Positionnement équilibré pour {targetMargin}% de marge.</> }
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-gray-500">CA marché réf.</p>
                  <p className="text-sm font-bold text-gray-800">{eur(totalMarketRevenue1)}</p>
                  <p className="text-xs text-gray-500">CA cible/animal</p>
                  <p className="text-sm font-bold text-red-600">{eur(totalRevenue1)}</p>
                </div>
              </div>
            </div>
          )}

          {/* KPIs par animal */}
          {totalRevenue1 > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{qty > 1 ? 'Par animal' : 'Résultat'}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: 'Poids vendable',  value: kgStr(totalSellable1), sub: `sur ${carcassW1.toFixed(0)} kg carcasse` },
                  { label: 'Coût de revient', value: eur(totalCost1),       sub: `${eur(totalCost1 / totalSellable1)}/kg` },
                  { label: 'CA conseillé',    value: eur(totalRevenue1),    sub: `coeff. x${coefficient.toFixed(3)}` },
                  { label: 'Marge brute',     value: eur(totalRevenue1 - totalCost1), sub: `${actualMargin1.toFixed(1)}% réel`, highlight: true },
                ].map(kpi => (
                  <div key={kpi.label} className={`rounded-2xl p-4 border ${'highlight' in kpi && kpi.highlight ? 'bg-red-600 border-red-600' : 'bg-white border-gray-200'}`}>
                    <p className={`text-xs mb-1 ${'highlight' in kpi && kpi.highlight ? 'text-red-100' : 'text-gray-500'}`}>{kpi.label}</p>
                    <p className={`text-lg font-bold leading-tight ${'highlight' in kpi && kpi.highlight ? 'text-white' : 'text-gray-900'}`}>{kpi.value}</p>
                    <p className={`text-xs mt-0.5 ${'highlight' in kpi && kpi.highlight ? 'text-red-200' : 'text-gray-400'}`}>{kpi.sub}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tableau pièces */}
          {results.length > 0 ? (
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2"><Package className="w-4 h-4 text-gray-400" />Détail par pièce {qty > 1 && <span className="text-xs font-normal text-gray-400">(par animal — ×{qty} pour le lot)</span>}</h2>
                <span className="text-xs text-gray-400">Prix de marché France 2025</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 w-48">Pièce</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-600">Poids</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-600">Réf. marché/kg</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-600">Prix conseillé/kg</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-600">CA pièce</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CATEGORIES.map(cat => {
                      const catResults = results.filter(r => r.cut.category === cat)
                      const catRevenue = catResults.reduce((s, r) => s + r.revenue, 0)
                      const catWeight  = catResults.reduce((s, r) => s + r.weight, 0)
                      const active = includedCats.has(cat)
                      return (
                        <React.Fragment key={cat}>
                          <tr className="border-t border-gray-100">
                            <td colSpan={5} className="px-4 py-2">
                              <div className="flex items-center justify-between">
                                <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${CATEGORY_COLORS[cat]}`}>{CATEGORY_LABELS[cat]}</span>
                                {active && catRevenue > 0 && <span className="text-xs text-gray-400">{kgStr(catWeight)} | {eur(catRevenue)}</span>}
                              </div>
                            </td>
                          </tr>
                          {catResults.map(r => {
                            const pctDiff = r.sellingPrice > 0 ? ((r.sellingPrice - r.cut.marketPrice) / r.cut.marketPrice) * 100 : 0
                            const priceColor = pctDiff < -5 ? 'text-green-600' : pctDiff > 15 ? 'text-orange-600' : 'text-gray-900'
                            return (
                              <tr key={r.cut.id} className={`border-t border-gray-50 ${active ? '' : 'opacity-30'}`}>
                                <td className="px-4 py-2.5 font-medium text-gray-800">{r.cut.name}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{kgStr(r.weight)}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums text-gray-400">{eur(r.cut.marketPrice)}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                                  {active ? <span className={priceColor}>{eur(r.sellingPrice)}{Math.abs(pctDiff) > 1 && <span className={`ml-1 text-xs font-normal ${priceColor}`}>({pctDiff > 0 ? '+' : ''}{pctDiff.toFixed(0)}%)</span>}</span> : '—'}
                                </td>
                                <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{active ? eur(r.revenue) : '—'}</td>
                              </tr>
                            )
                          })}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 bg-gray-900 text-white">
                      <td className="px-4 py-3 font-bold">TOTAL {qty > 1 ? '/ animal' : ''}</td>
                      <td className="px-3 py-3 text-right font-bold">{totalSellable1 > 0 ? kgStr(totalSellable1) : '—'}</td>
                      <td className="px-3 py-3 text-right text-gray-400">{totalMarketRevenue1 > 0 ? eur(totalMarketRevenue1) : '—'}</td>
                      <td className="px-3 py-3" />
                      <td className="px-3 py-3 text-right font-bold text-orange-300">{totalRevenue1 > 0 ? eur(totalRevenue1) : '—'}</td>
                    </tr>
                    {qty > 1 && totalRevenue1 > 0 && (
                      <tr className="bg-blue-700 text-white">
                        <td className="px-4 py-2.5 font-bold text-sm">TOTAL LOT ({qty} animaux)</td>
                        <td className="px-3 py-2.5 text-right font-bold">{kgStr(totalSellable1 * qty)}</td>
                        <td className="px-3 py-2.5" />
                        <td className="px-3 py-2.5" />
                        <td className="px-3 py-2.5 text-right font-bold text-yellow-300">{eur(totalRevenueLot)}</td>
                      </tr>
                    )}
                  </tfoot>
                </table>
              </div>
              <div className="px-5 py-3 bg-gray-50 border-t border-gray-100">
                <p className="text-xs text-gray-400">
                  Coefficient x{coefficient.toFixed(3)} appliqué aux prix de marché de référence.
                  <span className="text-green-600 font-medium ml-1">Vert</span> = sous le marché.
                  <span className="text-orange-600 font-medium ml-1">Orange</span> = +15% au-dessus.
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-2xl p-16 flex flex-col items-center justify-center text-center">
              <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                <Calculator className="w-7 h-7 text-gray-300" />
              </div>
              <p className="text-gray-600 font-medium">Renseignez les informations de l&apos;animal</p>
              <p className="text-sm text-gray-400 mt-1">Le détail par pièce apparaîtra ici</p>
            </div>
          )}
        </div>
      </div>

      {/* Modal historique */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="font-bold text-gray-900">{selected.breed_name}{(selected.quantity ?? 1) > 1 && <span className="ml-2 text-sm font-normal text-blue-600">× {selected.quantity} animaux</span>}</h2>
                <p className="text-xs text-gray-400">{new Date(selected.purchase_date).toLocaleDateString('fr-FR')} · {selected.live_weight} kg vif/animal</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => deleteValo(selected.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors"><Trash2 className="w-4 h-4" /></button>
                <button onClick={() => setSelected(null)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Coût total lot',  value: eur(selected.total_cost), highlight: false },
                { label: 'CA estimé total', value: eur(selected.total_revenue), highlight: true },
                { label: 'Marge brute',     value: eur(selected.total_revenue - selected.total_cost), highlight: false },
                { label: 'Taux de marge',   value: `${selected.margin_rate.toFixed(1)} %`, highlight: selected.margin_rate >= 35 },
                { label: 'Carcasse/animal', value: `${selected.carcass_weight} kg`, highlight: false },
                { label: 'Coefficient',     value: `x${selected.coefficient?.toFixed(3)}`, highlight: false },
                { label: 'Prix achat/kg',   value: `${selected.purchase_per_kg} €/kg vif`, highlight: false },
                { label: 'Nb animaux',      value: `${selected.quantity ?? 1}`, highlight: false },
              ].map(kpi => (
                <div key={kpi.label} className={`rounded-xl p-3 ${kpi.highlight ? 'bg-[#1E3A5F]' : 'bg-gray-50'}`}>
                  <p className={`text-xs ${kpi.highlight ? 'text-blue-200' : 'text-gray-400'}`}>{kpi.label}</p>
                  <p className={`text-base font-bold ${kpi.highlight ? 'text-white' : 'text-gray-900'}`}>{kpi.value}</p>
                </div>
              ))}
            </div>
            {selected.notes && (
              <div className="mt-3 p-3 bg-amber-50 border border-amber-100 rounded-xl">
                <p className="text-xs text-amber-700 font-medium">Notes</p>
                <p className="text-sm text-amber-900 mt-0.5">{selected.notes}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
