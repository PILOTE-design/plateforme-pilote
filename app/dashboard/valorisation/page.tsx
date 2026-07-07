'use client'

import React, { useState, useMemo } from 'react'
import { Calculator, TrendingUp, Package, Info } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

type CutCategory = 'premier' | 'deuxieme' | 'troisieme' | 'abat' | 'os'

interface Breed {
  id: string
  name: string
  carcassYield: number
  avgWeight: string
  origin: string
  description: string
}

interface Cut {
  id: string
  name: string
  category: CutCategory
  yieldPct: number
  priceHint: number
}

interface CutResult {
  cut: Cut
  weight: number
  costPerKg: number
  sellingPrice: number
  revenue: number
}

// ─── Races bovines françaises ─────────────────────────────────────────────────
// Rendements carcasse issus des references INTERBEV / FNB

const BREEDS: Breed[] = [
  {
    id: 'charolaise',
    name: 'Charolaise',
    carcassYield: 0.645,
    avgWeight: '750 - 950 kg',
    origin: 'Bourgogne',
    description: "Race a viande n1 en France. Masses musculaires tres developpees, conformation E-U. Viande ferme, peu persillee, ideale pour les pieces a griller et a rotir.",
  },
  {
    id: 'limousine',
    name: 'Limousine',
    carcassYield: 0.655,
    avgWeight: '650 - 850 kg',
    origin: 'Limousin',
    description: "Meilleur rendement en muscles nobles toutes races confondues. Grain de viande fin, couleur rouge vif, tres faible proportion d'os. Conformation E.",
  },
  {
    id: 'blonde_aquitaine',
    name: "Blonde d'Aquitaine",
    carcassYield: 0.640,
    avgWeight: '750 - 950 kg',
    origin: 'Sud-Ouest',
    description: "Grande race du Sud-Ouest. Viande maigre et tendre, bonne conformation E-U. Rendement eleve en pieces nobles, faible depot de gras sous-cutane.",
  },
  {
    id: 'salers',
    name: 'Salers',
    carcassYield: 0.600,
    avgWeight: '600 - 750 kg',
    origin: 'Auvergne',
    description: "Race rustique d'Auvergne, elevage en montagne. Viande goutteuse et legerement persillee, caractere prononce. Bon compromis rendement / qualite.",
  },
  {
    id: 'aubrac',
    name: 'Aubrac',
    carcassYield: 0.578,
    avgWeight: '550 - 700 kg',
    origin: 'Aveyron - Lozere',
    description: "Race de montagne tres rustique. Viande bien persillee, saveur prononcee et fondante. Rendement carcasse plus faible mais qualite gustative remarquable.",
  },
  {
    id: 'normande',
    name: 'Normande',
    carcassYield: 0.555,
    avgWeight: '600 - 750 kg',
    origin: 'Normandie',
    description: "Race mixte lait et viande. Viande marilee, persillage notable, saveur riche et beurree. Rendement carcasse plus faible que les races a viande pures.",
  },
  {
    id: 'maine_anjou',
    name: 'Maine-Anjou',
    carcassYield: 0.625,
    avgWeight: '800 - 1000 kg',
    origin: 'Pays de la Loire',
    description: "Grosse race mixte. Poids vif eleve, bon rendement carcasse. Viande marbree et savoureuse, tres appreciee pour les grandes pieces a rotir.",
  },
  {
    id: 'parthenaise',
    name: 'Parthenaise',
    carcassYield: 0.630,
    avgWeight: '650 - 800 kg',
    origin: 'Poitou-Charentes',
    description: "Race poitevine a bonnes aptitudes boucheres. Viande tendre et fine, bonne conformation. Tres appreciee des bouchers artisanaux du Grand Ouest.",
  },
  {
    id: 'angus',
    name: 'Aberdeen Angus',
    carcassYield: 0.578,
    avgWeight: '600 - 750 kg',
    origin: 'Ecosse (elevee en France)',
    description: "Race britannique tres repandue en France. Persillage exceptionnel dit marbre, viande fondante et savoureuse. Recherchee pour le segment premium et la restauration.",
  },
  {
    id: 'hereford',
    name: 'Hereford',
    carcassYield: 0.565,
    avgWeight: '550 - 700 kg',
    origin: 'Angleterre (elevee en France)',
    description: "Race britannique rustique. Viande bien persillee, tendre et goutteuse. Rendement modere mais qualite constante, appreciee des bouchers exigeants.",
  },
]

// ─── Tableau de découpe (% du poids carcasse) ────────────────────────────────
// Basé sur les references professionnelles de la decoupe bovine française

const CUTS: Cut[] = [
  { id: 'filet',            name: 'Filet',                     category: 'premier',   yieldPct: 1.8,  priceHint: 52 },
  { id: 'faux_filet',       name: 'Faux-filet',                category: 'premier',   yieldPct: 3.0,  priceHint: 32 },
  { id: 'cote_boeuf',       name: 'Cote de boeuf / Entrecote', category: 'premier',   yieldPct: 7.0,  priceHint: 28 },
  { id: 'rumsteck',         name: 'Rumsteck',                  category: 'premier',   yieldPct: 3.2,  priceHint: 25 },
  { id: 'bavette_aloyau',   name: "Bavette d'aloyau",          category: 'premier',   yieldPct: 1.3,  priceHint: 22 },
  { id: 'tende_tranche',    name: 'Tende de tranche',          category: 'premier',   yieldPct: 3.5,  priceHint: 19 },
  { id: 'tranche_grasse',   name: 'Tranche grasse',            category: 'premier',   yieldPct: 2.5,  priceHint: 17 },
  { id: 'rond_gite',        name: 'Rond de gite',              category: 'premier',   yieldPct: 1.8,  priceHint: 17 },
  { id: 'gite_noix',        name: 'Gite a la noix',            category: 'premier',   yieldPct: 2.5,  priceHint: 16 },
  { id: 'araignee',         name: 'Araignee',                  category: 'premier',   yieldPct: 0.3,  priceHint: 24 },
  { id: 'hampe',            name: 'Hampe',                     category: 'premier',   yieldPct: 0.5,  priceHint: 22 },
  { id: 'onglet',           name: 'Onglet',                    category: 'premier',   yieldPct: 0.4,  priceHint: 26 },
  { id: 'paleron',          name: 'Paleron',                   category: 'deuxieme',  yieldPct: 3.5,  priceHint: 14 },
  { id: 'macreuse_braiser', name: 'Macreuse a braiser',        category: 'deuxieme',  yieldPct: 2.5,  priceHint: 13 },
  { id: 'macreuse_bifteck', name: 'Macreuse a bifteck',        category: 'deuxieme',  yieldPct: 1.5,  priceHint: 15 },
  { id: 'joue',             name: 'Joue de boeuf',             category: 'deuxieme',  yieldPct: 1.2,  priceHint: 13 },
  { id: 'collier',          name: 'Collier',                   category: 'deuxieme',  yieldPct: 1.8,  priceHint: 11 },
  { id: 'plat_cotes',       name: 'Plat de cotes',            category: 'troisieme', yieldPct: 4.5,  priceHint: 9  },
  { id: 'poitrine',         name: 'Poitrine',                  category: 'troisieme', yieldPct: 3.5,  priceHint: 9  },
  { id: 'flanchet',         name: 'Flanchet',                  category: 'troisieme', yieldPct: 1.2,  priceHint: 11 },
  { id: 'bavette_flanchet', name: 'Bavette de flanchet',       category: 'troisieme', yieldPct: 0.8,  priceHint: 12 },
  { id: 'jarret_avant',     name: 'Jarret avant',              category: 'troisieme', yieldPct: 2.5,  priceHint: 9  },
  { id: 'jarret_arriere',   name: 'Jarret arriere / Gite',     category: 'troisieme', yieldPct: 3.0,  priceHint: 9  },
  { id: 'foie',             name: 'Foie',                      category: 'abat',      yieldPct: 1.3,  priceHint: 6  },
  { id: 'coeur',            name: 'Coeur',                     category: 'abat',      yieldPct: 0.4,  priceHint: 5  },
  { id: 'langue',           name: 'Langue',                    category: 'abat',      yieldPct: 0.5,  priceHint: 10 },
  { id: 'rognons',          name: 'Rognons',                   category: 'abat',      yieldPct: 0.3,  priceHint: 5  },
  { id: 'queue',            name: 'Queue',                     category: 'abat',      yieldPct: 0.7,  priceHint: 7  },
  { id: 'os_moelle',        name: 'Os a moelle',               category: 'os',        yieldPct: 4.0,  priceHint: 3  },
]

const CATEGORY_LABELS: Record<CutCategory, string> = {
  premier:    '1er choix — Arriere',
  deuxieme:   '2e choix — Avant',
  troisieme:  '3e choix — Divers',
  abat:       'Abats',
  os:         'Os valorisables',
}

const CATEGORY_COLORS: Record<CutCategory, string> = {
  premier:    'bg-red-50 text-red-700 border-red-200',
  deuxieme:   'bg-orange-50 text-orange-700 border-orange-200',
  troisieme:  'bg-yellow-50 text-yellow-700 border-yellow-200',
  abat:       'bg-purple-50 text-purple-700 border-purple-200',
  os:         'bg-gray-50 text-gray-600 border-gray-200',
}

const CATEGORIES: CutCategory[] = ['premier', 'deuxieme', 'troisieme', 'abat', 'os']

function eur(n: number): string {
  return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
}

function kgStr(n: number): string {
  return n.toFixed(1) + ' kg'
}

export default function ValorisationPage() {
  const [breedId, setBreedId]             = useState('charolaise')
  const [liveWeight, setLiveWeight]       = useState('800')
  const [purchasePerKg, setPurchasePerKg] = useState('3.80')
  const [overheadCost, setOverheadCost]   = useState('0')
  const [laborCost, setLaborCost]         = useState('150')
  const [targetMargin, setTargetMargin]   = useState(35)
  const [showBreedInfo, setShowBreedInfo] = useState(false)
  const [includedCats, setIncludedCats]   = useState<Set<CutCategory>>(new Set(CATEGORIES))

  const breed         = BREEDS.find(b => b.id === breedId) ?? BREEDS[0]
  const liveW         = parseFloat(liveWeight) || 0
  const ppkg          = parseFloat(purchasePerKg) || 0
  const overhead      = parseFloat(overheadCost) || 0
  const labor         = parseFloat(laborCost) || 0
  const carcassW      = liveW * breed.carcassYield
  const purchaseTotal = liveW * ppkg
  const totalCost     = purchaseTotal + overhead + labor

  const results = useMemo<CutResult[]>(() => {
    if (liveW <= 0 || ppkg <= 0) return []
    const activeCuts     = CUTS.filter(c => includedCats.has(c.category))
    const sellableWeight = activeCuts.reduce((s, c) => s + carcassW * c.yieldPct / 100, 0)
    if (sellableWeight <= 0) return []
    const costPerKgSellable = totalCost / sellableWeight
    return CUTS.map(cut => {
      const weight       = carcassW * cut.yieldPct / 100
      const active       = includedCats.has(cut.category)
      const costPerKg    = active ? costPerKgSellable : 0
      const sellingPrice = active && targetMargin < 100 ? costPerKg / (1 - targetMargin / 100) : 0
      const revenue      = sellingPrice * weight
      return { cut, weight, costPerKg, sellingPrice, revenue }
    })
  }, [breedId, liveW, ppkg, overhead, labor, targetMargin, includedCats, carcassW, totalCost])

  const activeResults = results.filter(r => includedCats.has(r.cut.category))
  const totalRevenue  = activeResults.reduce((s, r) => s + r.revenue, 0)
  const totalSellable = activeResults.reduce((s, r) => s + r.weight, 0)
  const actualMargin  = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0

  function toggleCat(cat: CutCategory) {
    setIncludedCats(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8 flex items-center gap-3">
        <div className="w-10 h-10 bg-red-600 rounded-xl flex items-center justify-center flex-shrink-0">
          <Calculator className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Valorisation Carcasse</h1>
          <p className="text-sm text-gray-500">Calculez la rentabilite de votre animal avant decoupe</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* Formulaire */}
        <div className="xl:col-span-1 space-y-5">

          {/* 1 — Animal */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span className="w-5 h-5 bg-gray-900 text-white text-xs rounded-full flex items-center justify-center font-bold">1</span>
              Animal
            </h2>
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Race bovine</label>
              <select
                value={breedId}
                onChange={e => setBreedId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                {BREEDS.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <button
                onClick={() => setShowBreedInfo(v => !v)}
                className="mt-1.5 text-xs text-red-600 hover:text-red-700 flex items-center gap-1"
              >
                <Info className="w-3 h-3" />
                {showBreedInfo ? 'Masquer les details' : 'Voir les caracteristiques'}
              </button>
              {showBreedInfo && (
                <div className="mt-2 p-3 bg-red-50 rounded-lg border border-red-100 space-y-1">
                  <p className="text-xs font-semibold text-red-800">{breed.name} — {breed.origin}</p>
                  <p className="text-xs text-red-700 leading-relaxed">{breed.description}</p>
                  <div className="flex gap-4 text-xs text-red-700 pt-1 font-medium">
                    <span>Poids moyen : {breed.avgWeight}</span>
                    <span>Rendement : {(breed.carcassYield * 100).toFixed(1)}%</span>
                  </div>
                </div>
              )}
            </div>

            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Poids vif (kg)</label>
              <input
                type="number"
                value={liveWeight}
                onChange={e => setLiveWeight(e.target.value)}
                placeholder="800"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              {liveW > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  Poids carcasse estime : <strong>{carcassW.toFixed(0)} kg</strong>
                  {' '}({(breed.carcassYield * 100).toFixed(1)}% du poids vif)
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Prix achat (euro/kg vif)</label>
              <input
                type="number"
                step="0.01"
                value={purchasePerKg}
                onChange={e => setPurchasePerKg(e.target.value)}
                placeholder="3.80"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              {liveW > 0 && ppkg > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  Achat total : <strong>{eur(purchaseTotal)}</strong>
                </p>
              )}
            </div>
          </div>

          {/* 2 — Charges */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span className="w-5 h-5 bg-gray-900 text-white text-xs rounded-full flex items-center justify-center font-bold">2</span>
              Charges a imputer
            </h2>
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Charges fixes pro-ratees (euro)</label>
              <input
                type="number"
                value={overheadCost}
                onChange={e => setOverheadCost(e.target.value)}
                placeholder="0"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <p className="text-xs text-gray-400 mt-1">Part des charges mensuelles allouees a cet animal</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Main d oeuvre decoupe (euro)</label>
              <input
                type="number"
                value={laborCost}
                onChange={e => setLaborCost(e.target.value)}
                placeholder="150"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <p className="text-xs text-gray-400 mt-1">Temps de decoupe x taux horaire</p>
            </div>
            {totalCost > 0 && (
              <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-500 mb-0.5">Cout de revient total</p>
                <p className="text-xl font-bold text-gray-900">{eur(totalCost)}</p>
                {totalSellable > 0 && (
                  <p className="text-xs text-gray-400">soit {eur(totalCost / totalSellable)}/kg vendable</p>
                )}
              </div>
            )}
          </div>

          {/* 3 — Marge */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span className="w-5 h-5 bg-gray-900 text-white text-xs rounded-full flex items-center justify-center font-bold">3</span>
              Marge souhaitee
            </h2>
            <div className="flex items-center gap-4 mb-2">
              <input
                type="range"
                min={10}
                max={70}
                step={1}
                value={targetMargin}
                onChange={e => setTargetMargin(Number(e.target.value))}
                className="flex-1 accent-red-600"
              />
              <span className="text-2xl font-bold text-red-600 w-14 text-right tabular-nums">{targetMargin}%</span>
            </div>
            <div className="flex justify-between text-xs text-gray-400">
              <span>10%</span>
              <span>40% (typique)</span>
              <span>70%</span>
            </div>
          </div>

          {/* 4 — Pieces incluses */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span className="w-5 h-5 bg-gray-900 text-white text-xs rounded-full flex items-center justify-center font-bold">4</span>
              Pieces a valoriser
            </h2>
            <div className="space-y-2">
              {CATEGORIES.map(cat => (
                <label key={cat} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includedCats.has(cat)}
                    onChange={() => toggleCat(cat)}
                    className="rounded accent-red-600"
                  />
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${CATEGORY_COLORS[cat]}`}>
                    {CATEGORY_LABELS[cat]}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Résultats */}
        <div className="xl:col-span-2 space-y-5">

          {totalRevenue > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Poids vendable',  value: kgStr(totalSellable),          sub: `sur ${carcassW.toFixed(0)} kg carcasse`, highlight: false },
                { label: 'Cout de revient', value: eur(totalCost),                sub: `${eur(totalCost / totalSellable)}/kg`,   highlight: false },
                { label: 'CA projete',      value: eur(totalRevenue),             sub: `${eur(totalRevenue / totalSellable)}/kg`, highlight: false },
                { label: 'Marge brute',     value: eur(totalRevenue - totalCost), sub: `${actualMargin.toFixed(1)}% reel`,        highlight: true  },
              ].map(kpi => (
                <div
                  key={kpi.label}
                  className={`rounded-2xl p-4 border ${kpi.highlight ? 'bg-red-600 border-red-600' : 'bg-white border-gray-200'}`}
                >
                  <p className={`text-xs mb-1 ${kpi.highlight ? 'text-red-100' : 'text-gray-500'}`}>{kpi.label}</p>
                  <p className={`text-lg font-bold leading-tight ${kpi.highlight ? 'text-white' : 'text-gray-900'}`}>{kpi.value}</p>
                  <p className={`text-xs mt-0.5 ${kpi.highlight ? 'text-red-200' : 'text-gray-400'}`}>{kpi.sub}</p>
                </div>
              ))}
            </div>
          )}

          {results.length > 0 ? (
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <Package className="w-4 h-4 text-gray-400" />
                  Detail par piece
                </h2>
                <span className="text-xs text-gray-400">
                  {results.filter(r => includedCats.has(r.cut.category)).length} pieces valorisees
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 w-52">Piece</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-600">Rendement</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-600">Poids</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-600">Cout/kg</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-600">Prix vente/kg</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-600">CA piece</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CATEGORIES.map(cat => {
                      const catResults = results.filter(r => r.cut.category === cat)
                      const catRevenue = catResults.reduce((s, r) => s + r.revenue, 0)
                      const catWeight  = catResults.reduce((s, r) => s + r.weight, 0)
                      const active     = includedCats.has(cat)
                      return (
                        <React.Fragment key={cat}>
                          <tr className="border-t border-gray-100">
                            <td colSpan={6} className="px-4 py-2">
                              <div className="flex items-center justify-between">
                                <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${CATEGORY_COLORS[cat]}`}>
                                  {CATEGORY_LABELS[cat]}
                                </span>
                                {active && catRevenue > 0 && (
                                  <span className="text-xs text-gray-400">{kgStr(catWeight)} | {eur(catRevenue)}</span>
                                )}
                              </div>
                            </td>
                          </tr>
                          {catResults.map(r => (
                            <tr
                              key={r.cut.id}
                              className={`border-t border-gray-50 transition-opacity ${active ? '' : 'opacity-30'}`}
                            >
                              <td className="px-4 py-2.5 font-medium text-gray-800">{r.cut.name}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{r.cut.yieldPct.toFixed(1)}%</td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{kgStr(r.weight)}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">
                                {active ? eur(r.costPerKg) : '—'}
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                                {active ? (
                                  <span className={
                                    r.sellingPrice > r.cut.priceHint * 1.15
                                      ? 'text-orange-600'
                                      : r.sellingPrice < r.cut.priceHint * 0.85
                                        ? 'text-green-600'
                                        : 'text-gray-900'
                                  }>
                                    {eur(r.sellingPrice)}
                                  </span>
                                ) : '—'}
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                                {active ? eur(r.revenue) : '—'}
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 bg-gray-50">
                      <td className="px-4 py-3 font-bold text-gray-900">TOTAL</td>
                      <td className="px-3 py-3 text-right text-xs text-gray-500">
                        {totalSellable > 0 && carcassW > 0 ? `${((totalSellable / carcassW) * 100).toFixed(1)}%` : ''}
                      </td>
                      <td className="px-3 py-3 text-right font-bold text-gray-900">{totalSellable > 0 ? kgStr(totalSellable) : '—'}</td>
                      <td className="px-3 py-3 text-right text-gray-600">{totalCost > 0 && totalSellable > 0 ? eur(totalCost / totalSellable) : '—'}</td>
                      <td />
                      <td className="px-3 py-3 text-right font-bold text-red-600">{totalRevenue > 0 ? eur(totalRevenue) : '—'}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="px-5 py-3 bg-gray-50 border-t border-gray-100">
                <p className="text-xs text-gray-400 flex items-center gap-1.5">
                  <TrendingUp className="w-3 h-3 inline" />
                  Prix en <span className="text-orange-600 font-medium mx-1">orange</span> = au-dessus du marche indicatif de plus 15%.
                  Prix en <span className="text-green-600 font-medium mx-1">vert</span> = marge supplementaire disponible.
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-2xl p-16 flex flex-col items-center justify-center text-center">
              <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                <Calculator className="w-7 h-7 text-gray-300" />
              </div>
              <p className="text-gray-600 font-medium">Renseignez les informations de animal</p>
              <p className="text-sm text-gray-400 mt-1">Le detail par piece apparaitra ici</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
