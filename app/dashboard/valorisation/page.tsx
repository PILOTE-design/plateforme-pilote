'use client'

import React, { useState, useMemo } from 'react'
import { Calculator, TrendingUp, Package, Info, AlertTriangle, CheckCircle } from 'lucide-react'

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
  marketPrice: number   // prix de marche boucher artisanal France 2025 (euro/kg)
}

interface CutResult {
  cut: Cut
  weight: number
  sellingPrice: number
  revenue: number
}

// ─── Races bovines françaises ─────────────────────────────────────────────────

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

// ─── Tableau de découpe — Prix de marché boucher artisanal France 2025 ────────
//
// Sources : Boucherie Sebiane (Aubrac), La Ferme de la Heraudiere (bio IDF 2025),
//           INSEE series 000442432/000442435, boucheries artisanales en ligne
//
// Prix = milieu de fourchette pour un boucher artisanal standard (hors bio/premium)
// Les pieces "stars" (onglet, hampe, araignee) sont valorisees a leur juste prix
// Les abats sont maintenant correctement differencies (langue >> foie)

const CUTS: Cut[] = [
  // ── 1er choix — ARRIERE ──────────────────────────────────────────────────
  // Filet : 38-55 euro/kg selon qualite. Artisan standard : ~45 euro
  { id: 'filet',            name: 'Filet (tournedos / roti)',   category: 'premier',   yieldPct: 1.8,  marketPrice: 45  },
  // Faux-filet : 26-37 euro/kg. Artisan standard : ~29 euro
  { id: 'faux_filet',       name: 'Faux-filet',                category: 'premier',   yieldPct: 3.0,  marketPrice: 29  },
  // Cote de boeuf / entrecote : 22-30 euro/kg. Artisan : ~26 euro
  { id: 'cote_boeuf',       name: 'Cote de boeuf / Entrecote', category: 'premier',   yieldPct: 7.0,  marketPrice: 26  },
  // Rumsteck : 19-24 euro/kg. Artisan : ~22 euro
  { id: 'rumsteck',         name: 'Rumsteck',                  category: 'premier',   yieldPct: 3.2,  marketPrice: 22  },
  // Bavette d'aloyau : 18-22 euro/kg. Artisan : ~20 euro
  { id: 'bavette_aloyau',   name: "Bavette d'aloyau",          category: 'premier',   yieldPct: 1.3,  marketPrice: 20  },
  // Tende de tranche : 16-21 euro/kg. Artisan : ~18 euro
  { id: 'tende_tranche',    name: 'Tende de tranche',          category: 'premier',   yieldPct: 3.5,  marketPrice: 18  },
  // Tranche grasse : 15-20 euro/kg. Artisan : ~17 euro
  { id: 'tranche_grasse',   name: 'Tranche grasse',            category: 'premier',   yieldPct: 2.5,  marketPrice: 17  },
  // Rond de gite : 16-19 euro/kg. Artisan : ~16 euro
  { id: 'rond_gite',        name: 'Rond de gite',              category: 'premier',   yieldPct: 1.8,  marketPrice: 16  },
  // Gite a la noix : 14-17 euro/kg. Artisan : ~15 euro
  { id: 'gite_noix',        name: 'Gite a la noix',            category: 'premier',   yieldPct: 2.5,  marketPrice: 15  },
  // Araignee : piece rare et recherchee. 28-40 euro/kg. Artisan : ~32 euro
  { id: 'araignee',         name: 'Araignee',                  category: 'premier',   yieldPct: 0.3,  marketPrice: 32  },
  // Hampe : 22-33 euro/kg. Artisan : ~25 euro
  { id: 'hampe',            name: 'Hampe',                     category: 'premier',   yieldPct: 0.5,  marketPrice: 25  },
  // Onglet : tres recherche, 28-40 euro/kg. Artisan : ~32 euro
  { id: 'onglet',           name: 'Onglet',                    category: 'premier',   yieldPct: 0.4,  marketPrice: 32  },

  // ── 2e choix — AVANT ─────────────────────────────────────────────────────
  // Paleron : 13-21 euro/kg selon boucher. Artisan : ~15 euro
  { id: 'paleron',          name: 'Paleron',                   category: 'deuxieme',  yieldPct: 3.5,  marketPrice: 15  },
  // Macreuse a braiser : 13-17 euro/kg. Artisan : ~14 euro
  { id: 'macreuse_braiser', name: 'Macreuse a braiser',        category: 'deuxieme',  yieldPct: 2.5,  marketPrice: 14  },
  // Macreuse a bifteck : 14-19 euro/kg (plus noble). Artisan : ~16 euro
  { id: 'macreuse_bifteck', name: 'Macreuse a bifteck',        category: 'deuxieme',  yieldPct: 1.5,  marketPrice: 16  },
  // Joue de boeuf : valorisee en cuisine, 22-30 euro/kg. Artisan : ~24 euro
  { id: 'joue',             name: 'Joue de boeuf',             category: 'deuxieme',  yieldPct: 1.2,  marketPrice: 24  },
  // Collier : piece economique. 10-14 euro/kg. Artisan : ~12 euro
  { id: 'collier',          name: 'Collier',                   category: 'deuxieme',  yieldPct: 1.8,  marketPrice: 12  },

  // ── 3e choix — DIVERS ────────────────────────────────────────────────────
  // Plat de cotes : 8-11 euro/kg. Artisan : ~9 euro
  { id: 'plat_cotes',       name: 'Plat de cotes',            category: 'troisieme', yieldPct: 4.5,  marketPrice: 9   },
  // Poitrine : 8-11 euro/kg. Artisan : ~9 euro
  { id: 'poitrine',         name: 'Poitrine',                  category: 'troisieme', yieldPct: 3.5,  marketPrice: 9   },
  // Flanchet : 9-12 euro/kg. Artisan : ~10 euro
  { id: 'flanchet',         name: 'Flanchet',                  category: 'troisieme', yieldPct: 1.2,  marketPrice: 10  },
  // Bavette de flanchet : 10-14 euro/kg. Artisan : ~12 euro
  { id: 'bavette_flanchet', name: 'Bavette de flanchet',       category: 'troisieme', yieldPct: 0.8,  marketPrice: 12  },
  // Jarret avant (avec os) : 8-12 euro/kg. Artisan : ~9 euro
  { id: 'jarret_avant',     name: 'Jarret avant',              category: 'troisieme', yieldPct: 2.5,  marketPrice: 9   },
  // Jarret arriere / Gite (avec os) : 8-12 euro/kg. Artisan : ~9 euro
  { id: 'jarret_arriere',   name: 'Jarret arriere / Gite',     category: 'troisieme', yieldPct: 3.0,  marketPrice: 9   },

  // ── Abats ────────────────────────────────────────────────────────────────
  // Foie de boeuf : 4-8 euro/kg. Artisan : ~5 euro (sous-valorise)
  { id: 'foie',             name: 'Foie',                      category: 'abat',      yieldPct: 1.3,  marketPrice: 5   },
  // Coeur : 4-6 euro/kg. Artisan : ~5 euro
  { id: 'coeur',            name: 'Coeur',                     category: 'abat',      yieldPct: 0.4,  marketPrice: 5   },
  // Langue : bien valorisee, 16-22 euro/kg. Artisan : ~18 euro
  { id: 'langue',           name: 'Langue',                    category: 'abat',      yieldPct: 0.5,  marketPrice: 18  },
  // Rognons : 4-7 euro/kg. Artisan : ~5 euro
  { id: 'rognons',          name: 'Rognons',                   category: 'abat',      yieldPct: 0.3,  marketPrice: 5   },
  // Queue : bien valorisee en restauration, 12-16 euro/kg. Artisan : ~13 euro
  { id: 'queue',            name: 'Queue',                     category: 'abat',      yieldPct: 0.7,  marketPrice: 13  },

  // ── Os valorisables ───────────────────────────────────────────────────────
  // Os a moelle : 2-4 euro/kg. Artisan : ~3 euro
  { id: 'os_moelle',        name: 'Os a moelle',               category: 'os',        yieldPct: 4.0,  marketPrice: 3   },
]

// ─── Config UI ───────────────────────────────────────────────────────────────

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

// ─── Composant principal ──────────────────────────────────────────────────────

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

  // ─── Logique de tarification ──────────────────────────────────────────────
  //
  // Methode : "prix de marche proportionnel"
  //
  // 1. Chaque piece a un prix de marche de reference (marketPrice)
  // 2. On calcule le CA total si on vendait tout au prix du marche
  // 3. On calcule le coefficient necessaire pour atteindre la marge cible
  //    coefficient = CA_cible / CA_marche
  //    avec CA_cible = totalCost / (1 - marge%)
  // 4. Prix de vente conseille = marketPrice × coefficient
  //
  // Avantage : le filet reste plus cher que le jarret, les ratios
  // sont respectes, et la marge globale est atteinte.

  const { results, coefficient, totalMarketRevenue } = useMemo(() => {
    if (liveW <= 0 || ppkg <= 0) {
      return { results: [] as CutResult[], coefficient: 1, totalMarketRevenue: 0 }
    }

    const activeCuts = CUTS.filter(c => includedCats.has(c.category))

    // CA total au prix du marche (pieces actives uniquement)
    const mktRevenue = activeCuts.reduce((s, c) => {
      return s + (carcassW * c.yieldPct / 100) * c.marketPrice
    }, 0)

    // CA necessaire pour atteindre la marge cible
    const targetRevenue = targetMargin < 100 && totalCost > 0
      ? totalCost / (1 - targetMargin / 100)
      : mktRevenue

    // Coefficient de valorisation (1.0 = prix marche, 1.1 = 10% au-dessus, etc.)
    const coeff = mktRevenue > 0 ? targetRevenue / mktRevenue : 1

    const res: CutResult[] = CUTS.map(cut => {
      const weight       = carcassW * cut.yieldPct / 100
      const active       = includedCats.has(cut.category)
      const sellingPrice = active ? cut.marketPrice * coeff : 0
      const revenue      = sellingPrice * weight
      return { cut, weight, sellingPrice, revenue }
    })

    return { results: res, coefficient: coeff, totalMarketRevenue: mktRevenue }
  }, [breedId, liveW, ppkg, overhead, labor, targetMargin, includedCats, carcassW, totalCost])

  const activeResults = results.filter(r => includedCats.has(r.cut.category))
  const totalRevenue  = activeResults.reduce((s, r) => s + r.revenue, 0)
  const totalSellable = activeResults.reduce((s, r) => s + r.weight, 0)
  const actualMargin  = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0

  // Statut du coefficient
  const coeffStatus = coefficient < 0.95 ? 'under' : coefficient > 1.15 ? 'over' : 'ok'

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
          <p className="text-sm text-gray-500">Prix de marche reels par piece — coefficent de valorisation pour atteindre votre marge</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* ═══ FORMULAIRE ═════════════════════════════════════════════════════ */}
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
                  <option key={b.id} value={b.id}>{b.name} — rendement {(b.carcassYield * 100).toFixed(1)}%</option>
                ))}
              </select>
              <button
                onClick={() => setShowBreedInfo(v => !v)}
                className="mt-1.5 text-xs text-red-600 hover:text-red-700 flex items-center gap-1"
              >
                <Info className="w-3 h-3" />
                {showBreedInfo ? 'Masquer' : 'Caracteristiques de la race'}
              </button>
              {showBreedInfo && (
                <div className="mt-2 p-3 bg-red-50 rounded-lg border border-red-100 space-y-1">
                  <p className="text-xs font-semibold text-red-800">{breed.name} — {breed.origin}</p>
                  <p className="text-xs text-red-700 leading-relaxed">{breed.description}</p>
                  <p className="text-xs text-red-700 font-medium pt-1">Poids moyen : {breed.avgWeight}</p>
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
                  Carcasse estimee : <strong>{carcassW.toFixed(0)} kg</strong>
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
                <p className="text-xs text-gray-500 mt-1">Total achat : <strong>{eur(purchaseTotal)}</strong></p>
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
            </div>
            {totalCost > 0 && (
              <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-500 mb-0.5">Cout de revient total</p>
                <p className="text-xl font-bold text-gray-900">{eur(totalCost)}</p>
                {totalMarketRevenue > 0 && (
                  <p className="text-xs text-gray-400">
                    Marge aux prix du marche : {(((totalMarketRevenue - totalCost) / totalMarketRevenue) * 100).toFixed(1)}%
                  </p>
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
              <span>10%</span><span>40% (typique)</span><span>70%</span>
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

        {/* ═══ RÉSULTATS ══════════════════════════════════════════════════════ */}
        <div className="xl:col-span-2 space-y-5">

          {/* Coefficient de valorisation — indicateur clé */}
          {totalRevenue > 0 && (
            <div className={`rounded-2xl p-4 border ${
              coeffStatus === 'under'
                ? 'bg-green-50 border-green-200'
                : coeffStatus === 'over'
                  ? 'bg-orange-50 border-orange-200'
                  : 'bg-blue-50 border-blue-200'
            }`}>
              <div className="flex items-start gap-3">
                {coeffStatus === 'under' && <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />}
                {coeffStatus === 'over'  && <AlertTriangle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />}
                {coeffStatus === 'ok'    && <TrendingUp className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />}
                <div className="flex-1">
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className={`text-2xl font-bold ${
                      coeffStatus === 'under' ? 'text-green-700' : coeffStatus === 'over' ? 'text-orange-700' : 'text-blue-700'
                    }`}>
                      x{coefficient.toFixed(3)}
                    </span>
                    <span className="text-sm font-semibold text-gray-700">Coefficient de valorisation</span>
                  </div>
                  <p className={`text-xs leading-relaxed ${
                    coeffStatus === 'under' ? 'text-green-700' : coeffStatus === 'over' ? 'text-orange-700' : 'text-blue-700'
                  }`}>
                    {coeffStatus === 'under' && (
                      <>Vos couts sont bas : vous pouvez pratiquer des prix <strong>{((1 - coefficient) * 100).toFixed(1)}% en dessous du marche</strong> et atteindre votre marge de {targetMargin}%. Avantage concurrentiel possible.</>
                    )}
                    {coeffStatus === 'over' && (
                      <>Pour atteindre {targetMargin}% de marge, vos prix doivent etre <strong>{((coefficient - 1) * 100).toFixed(1)}% au-dessus du marche</strong>. Positionnement premium recommande (race, origine, maturation).</>
                    )}
                    {coeffStatus === 'ok' && (
                      <>Vos prix sont proches du marche ({coefficient > 1 ? '+' : ''}{((coefficient - 1) * 100).toFixed(1)}%). Positionnement equilibre pour atteindre {targetMargin}% de marge.</>
                    )}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-gray-500 mb-0.5">CA marche ref.</p>
                  <p className="text-sm font-bold text-gray-800">{eur(totalMarketRevenue)}</p>
                  <p className="text-xs text-gray-500">CA cible</p>
                  <p className="text-sm font-bold text-red-600">{eur(totalRevenue)}</p>
                </div>
              </div>
            </div>
          )}

          {/* KPIs */}
          {totalRevenue > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Poids vendable',  value: kgStr(totalSellable),          sub: `sur ${carcassW.toFixed(0)} kg carcasse`, highlight: false },
                { label: 'Cout de revient', value: eur(totalCost),                sub: `${eur(totalCost / totalSellable)}/kg`,    highlight: false },
                { label: 'CA conseille',    value: eur(totalRevenue),             sub: `coeff. x${coefficient.toFixed(3)}`,       highlight: false },
                { label: 'Marge brute',     value: eur(totalRevenue - totalCost), sub: `${actualMargin.toFixed(1)}% reel`,         highlight: true  },
              ].map(kpi => (
                <div key={kpi.label} className={`rounded-2xl p-4 border ${kpi.highlight ? 'bg-red-600 border-red-600' : 'bg-white border-gray-200'}`}>
                  <p className={`text-xs mb-1 ${kpi.highlight ? 'text-red-100' : 'text-gray-500'}`}>{kpi.label}</p>
                  <p className={`text-lg font-bold leading-tight ${kpi.highlight ? 'text-white' : 'text-gray-900'}`}>{kpi.value}</p>
                  <p className={`text-xs mt-0.5 ${kpi.highlight ? 'text-red-200' : 'text-gray-400'}`}>{kpi.sub}</p>
                </div>
              ))}
            </div>
          )}

          {/* Table des pièces */}
          {results.length > 0 ? (
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <Package className="w-4 h-4 text-gray-400" />
                  Detail par piece
                </h2>
                <span className="text-xs text-gray-400">
                  Prix de marche boucher artisanal France 2025
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 w-48">Piece</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-600">Poids</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-600">
                        <span className="text-gray-400 font-normal">Ref.</span> marche/kg
                      </th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-600">
                        Prix conseille/kg
                      </th>
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
                            <td colSpan={5} className="px-4 py-2">
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
                          {catResults.map(r => {
                            // Ecart entre prix conseille et prix de marche
                            const pctDiff = r.sellingPrice > 0
                              ? ((r.sellingPrice - r.cut.marketPrice) / r.cut.marketPrice) * 100
                              : 0
                            const priceColor = pctDiff < -5
                              ? 'text-green-600'
                              : pctDiff > 15
                                ? 'text-orange-600'
                                : 'text-gray-900'
                            return (
                              <tr
                                key={r.cut.id}
                                className={`border-t border-gray-50 ${active ? '' : 'opacity-30'}`}
                              >
                                <td className="px-4 py-2.5 font-medium text-gray-800">{r.cut.name}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{kgStr(r.weight)}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums text-gray-400">
                                  {eur(r.cut.marketPrice)}
                                </td>
                                <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                                  {active ? (
                                    <span className={priceColor}>
                                      {eur(r.sellingPrice)}
                                      {Math.abs(pctDiff) > 1 && (
                                        <span className={`ml-1 text-xs font-normal ${priceColor}`}>
                                          ({pctDiff > 0 ? '+' : ''}{pctDiff.toFixed(0)}%)
                                        </span>
                                      )}
                                    </span>
                                  ) : '—'}
                                </td>
                                <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                                  {active ? eur(r.revenue) : '—'}
                                </td>
                              </tr>
                            )
                          })}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 bg-gray-50">
                      <td className="px-4 py-3 font-bold text-gray-900">TOTAL</td>
                      <td className="px-3 py-3 text-right font-bold text-gray-900">
                        {totalSellable > 0 ? kgStr(totalSellable) : '—'}
                      </td>
                      <td className="px-3 py-3 text-right text-gray-400">
                        {totalMarketRevenue > 0 ? eur(totalMarketRevenue) : '—'}
                      </td>
                      <td className="px-3 py-3" />
                      <td className="px-3 py-3 text-right font-bold text-red-600">
                        {totalRevenue > 0 ? eur(totalRevenue) : '—'}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="px-5 py-3 bg-gray-50 border-t border-gray-100">
                <p className="text-xs text-gray-400">
                  Les prix de vente conseilles appliquent un coefficient de valorisation unique (x{coefficient.toFixed(3)}) 
                  aux prix de marche de reference, ce qui maintient les ecarts naturels entre pieces 
                  (le filet reste plus cher que le jarret) tout en atteignant votre marge globale.
                  <span className="text-green-600 font-medium ml-1">Vert</span> = sous le marche.
                  <span className="text-orange-600 font-medium ml-1">Orange</span> = plus 15% au-dessus du marche.
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-2xl p-16 flex flex-col items-center justify-center text-center">
              <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                <Calculator className="w-7 h-7 text-gray-300" />
              </div>
              <p className="text-gray-600 font-medium">Renseignez les informations de l'animal</p>
              <p className="text-sm text-gray-400 mt-1">Le detail par piece apparaitra ici</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
