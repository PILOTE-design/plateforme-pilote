'use client'

// Valorisation carcasse — les BLOCS D'ÉCRAN, sortis de page.tsx au lot 74 :
// le sélecteur d'espèces, les onglets, le suivi hebdomadaire, le carrousel de
// l'historique, les cartes de résultats, le tableau du détail par pièce et la
// fiche d'un lot enregistré. Aucun état, aucun effet, aucun appel API ici : la
// page garde tout cela et ne passe que des données et des gestes.

import React, { type Dispatch, type SetStateAction } from 'react'
import { TrendingUp, Package, AlertTriangle, CheckCircle, Trash2, Clock, X, Loader2, BarChart2, RotateCcw, ChevronRight, Download, Calculator } from 'lucide-react'
import type { AnimalType, Cut, CutCategory, CoutMorceau, RepartitionCarcasse } from '@/lib/valorisation'
import {
  ANIMALS, ANIMAL_TYPES, CATEGORIES, CATEGORY_LABELS, CATEGORY_COLORS,
  collectLeafCuts, eur, fmtKg, kgStr,
  type AnimalConfig, type CutResult, type CutsByAnimal, type SavedValo,
  type TreeNode, type WeekStats,
} from './donnees'


/** Les cinq familles — l'onglet actif porte le compte des pièces retirées du calcul */
export function SelecteurEspeces({
  animalType, setAnimalType, excludedByAnimal,
}: {
  animalType: AnimalType
  setAnimalType: Dispatch<SetStateAction<AnimalType>>
  excludedByAnimal: CutsByAnimal
}) {
  return (
    <div className="flex gap-2 mb-5 flex-wrap">
      {ANIMAL_TYPES.map(at => {
        const a = ANIMALS[at]
        const isActive = animalType === at
        const excludedCount = (excludedByAnimal[at] ?? []).length
        return (
          <button key={at} onClick={() => setAnimalType(at)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all active:scale-95 ${
              isActive ? 'bg-pilote text-white shadow-card border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:border-pilote-200 hover:shadow-sm'
            }`}>
            <span className="text-base">{a.emoji}</span>
            {a.label}
            {excludedCount > 0 && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/25 text-white' : 'bg-gray-100 text-gray-500'}`} title={`${excludedCount} pièce(s) retirée(s) du calcul`}>
                −{excludedCount}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}


/** Calculateur ou suivi hebdo — l'onglet actif vit dans page.tsx */
export function OngletsVue({
  activeTab, setActiveTab, weekStats,
}: {
  activeTab: 'calc' | 'suivi'
  setActiveTab: Dispatch<SetStateAction<'calc' | 'suivi'>>
  weekStats: WeekStats[]
}) {
  return (
    <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
      <button onClick={() => setActiveTab('calc')}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
          activeTab === 'calc' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
        }`}>
        <Calculator className="w-4 h-4" />Calculateur
      </button>
      <button onClick={() => setActiveTab('suivi')}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
          activeTab === 'suivi' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
        }`}>
        <BarChart2 className="w-4 h-4" />Suivi semaines
        {weekStats.length > 0 && (
          <span className="ml-1 bg-pilote text-white text-xs font-bold px-1.5 py-0.5 rounded-full">{weekStats.length}</span>
        )}
      </button>
    </div>
  )
}


/** Le suivi semaine par semaine : les quatre compteurs puis le tableau détaillé */
export function VueSuiviHebdo({
  weekStats, setActiveTab, totalAnimals, totalCA, avgMarginAll, maxCA,
}: {
  weekStats: WeekStats[]
  setActiveTab: Dispatch<SetStateAction<'calc' | 'suivi'>>
  totalAnimals: number
  totalCA: number
  avgMarginAll: number
  maxCA: number
}) {
  return (
    <div>
      {weekStats.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-16 shadow-card flex flex-col items-center justify-center text-center">
          <BarChart2 className="w-12 h-12 text-gray-200 mb-4" />
          <p className="text-gray-600 font-medium">Aucune donnée pour l&apos;instant</p>
          <p className="text-sm text-gray-400 mt-1">Sauvegardez vos premières valorisations pour voir le suivi</p>
          <button onClick={() => setActiveTab('calc')}
            className="mt-4 px-4 py-2 bg-pilote text-white rounded-xl text-sm font-semibold hover:bg-pilote-hover transition-colors">
            Aller au calculateur
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            {[{ label: 'Semaines enregistrées', value: String(weekStats.length), sub: 'depuis le début' },
              { label: 'Animaux valorisés', value: String(totalAnimals), sub: 'au total' },
              { label: 'CA total estimé', value: eur(totalCA), sub: 'toutes semaines' },
            ].map(k => (
              <div key={k.label} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-card">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">{k.label}</p>
                <p className="text-2xl font-bold text-gray-900">{k.value}</p>
                <p className="text-xs text-gray-400">{k.sub}</p>
              </div>
            ))}
            <div className={`rounded-2xl p-4 shadow-card ${
              avgMarginAll >= 35 ? 'bg-green-600' : avgMarginAll >= 25 ? 'bg-amber-500' : 'bg-red-600'
            } text-white`}>
              <p className="text-[11px] font-semibold uppercase tracking-wider opacity-80 mb-0.5">Marge brute moy.</p>
              <p className="text-2xl font-bold">{avgMarginAll.toFixed(1)}%</p>
              <p className="text-xs opacity-70">{avgMarginAll >= 35 ? 'Bonne performance' : avgMarginAll >= 25 ? 'À surveiller' : 'Sous les seuils'}</p>
            </div>
          </div>
          <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-card">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2"><BarChart2 className="w-4 h-4 text-gray-400" />Détail par semaine</h2>
              <span className="text-xs text-gray-400">Du plus récent au plus ancien</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    {['Semaine','Animaux','Coût total','CA estimé','Marge','vs sem. préc.','Animaux / Races'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weekStats.map((w, i) => {
                    const prev = weekStats[i + 1]
                    const caEvol = prev && prev.totalRevenue > 0 ? ((w.totalRevenue - prev.totalRevenue) / prev.totalRevenue) * 100 : null
                    const marginEvol = prev ? w.marginRate - prev.marginRate : null
                    return (
                      <tr key={w.key} className={`border-t border-gray-50 hover:bg-gray-50 transition-colors ${i === 0 ? 'bg-pilote-50/40' : ''}`}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {i === 0 && <span className="text-[10px] font-bold bg-pilote-100 text-pilote-800 px-1.5 py-0.5 rounded-full">Récent</span>}
                            <span className="font-semibold text-gray-800">{w.label}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-medium">{w.count}</span>
                          {w.lots > 1 && <span className="text-xs text-gray-400 ml-1">({w.lots} lots)</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-gray-500">{eur(w.totalCost)}</td>
                        <td className="px-4 py-3 text-right font-bold">
                          <div className="flex flex-col items-end">
                            <span>{eur(w.totalRevenue)}</span>
                            <div className="mt-1 h-1 bg-gray-100 rounded-full w-20 overflow-hidden">
                              <div className="h-1 bg-pilote rounded-full" style={{ width: `${(w.totalRevenue / maxCA) * 100}%` }} />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col items-end gap-0.5">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                              w.marginRate >= 35 ? 'bg-green-100 text-green-700' : w.marginRate >= 25 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                            }`}>{w.marginRate.toFixed(1)}%</span>
                            {marginEvol !== null && Math.abs(marginEvol) >= 0.5 && (
                              <span className={`text-[10px] font-medium ${marginEvol > 0 ? 'text-green-600' : 'text-red-500'}`}>
                                {marginEvol > 0 ? '+' : ''}{marginEvol.toFixed(1)} pts
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {caEvol !== null ? (
                            <div className="flex items-center gap-1.5">
                              <span className={`text-lg font-bold leading-none ${caEvol > 5 ? 'text-green-500' : caEvol < -5 ? 'text-red-400' : 'text-gray-400'}`}>
                                {caEvol > 5 ? '▲' : caEvol < -5 ? '▼' : '–'}
                              </span>
                              <div>
                                <p className={`text-xs font-bold ${caEvol > 5 ? 'text-green-600' : caEvol < -5 ? 'text-red-500' : 'text-gray-500'}`}>
                                  {caEvol > 0 ? '+' : ''}{caEvol.toFixed(0)}% CA
                                </p>
                                <p className="text-[10px] text-gray-400">vs S{prev!.week}</p>
                              </div>
                            </div>
                          ) : <span className="text-xs text-gray-300">première semaine</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {w.breeds.map(b => (
                              <span key={b} className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-medium">{b}</span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}


/** La bande des valorisations déjà enregistrées — cliquer ouvre la fiche du lot */
export function CarrouselHistorique({
  history, setSelected,
}: {
  history: SavedValo[]
  setSelected: Dispatch<SetStateAction<SavedValo | null>>
}) {
  return (
    <div className="mb-6 bg-white border border-gray-100 rounded-2xl p-5 shadow-card">
      <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
        <Clock className="w-4 h-4 text-gray-400" />Historique des valorisations
      </h2>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {history.map(v => {
          const emoji = ANIMALS[v.animal_type as AnimalType]?.emoji ?? ''
          return (
            <button key={v.id} onClick={() => setSelected(v)}
              className="flex-shrink-0 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl p-3 text-left transition-colors w-56">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-gray-800">{emoji} {v.breed_name}</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  v.margin_rate >= 35 ? 'bg-green-100 text-green-700' : v.margin_rate >= 25 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                }`}>{v.margin_rate.toFixed(1)}%</span>
              </div>
              <p className="text-xs text-gray-500">
                {(v.quantity ?? 1) > 1 ? <span className="font-semibold text-pilote">{v.quantity} animaux · </span> : ''}
                {v.carcass_weight || v.live_weight} kg carc. · {new Date(v.purchase_date).toLocaleDateString('fr-FR')}
              </p>
              <p className="text-sm font-bold text-pilote mt-1">{eur(v.total_revenue)}</p>
              <p className="text-[10px] text-gray-400">CA estim. total · coeff. x{v.coefficient?.toFixed(3)}</p>
            </button>
          )
        })}
      </div>
    </div>
  )
}


/** Récapitulatif du lot, coefficient de valorisation et les quatre KPI de la bête */
export function BlocResultats({
  qty, isHalf, config, totalRevenue1, totalCostLot, totalRevenueLot, actualMargin1,
  coeffStatus, coefficient, targetMargin, totalMarketRevenue1, totalSellable1,
  carcassW1, totalCost1,
}: {
  qty: number
  isHalf: boolean
  config: AnimalConfig
  totalRevenue1: number
  totalCostLot: number
  totalRevenueLot: number
  actualMargin1: number
  coeffStatus: string
  coefficient: number
  targetMargin: number
  totalMarketRevenue1: number
  totalSellable1: number
  carcassW1: number
  totalCost1: number
}) {
  return (
    <>
    {qty > 1 && totalRevenue1 > 0 && (
      <div className="bg-pilote rounded-2xl p-4 text-white shadow-card">
        <p className="text-[11px] font-semibold text-pilote-200 mb-2 uppercase tracking-wider">Récapitulatif lot — {qty} {isHalf ? `demis (${config.label.toLowerCase()})` : `${config.label.toLowerCase()}x`}</p>
        <div className="grid grid-cols-3 gap-4">
          <div><p className="text-xs text-pilote-200">Coût total lot</p><p className="text-xl font-extrabold">{eur(totalCostLot)}</p></div>
          <div><p className="text-xs text-pilote-200">CA estimé total</p><p className="text-xl font-extrabold text-pilote-orange">{eur(totalRevenueLot)}</p></div>
          <div><p className="text-xs text-pilote-200">Marge brute lot</p><p className="text-xl font-extrabold text-green-300">{eur(totalRevenueLot - totalCostLot)}</p><p className="text-xs text-pilote-200">{actualMargin1.toFixed(1)}%</p></div>
        </div>
      </div>
    )}

    {totalRevenue1 > 0 && (
      <div className={`rounded-2xl p-4 border ${
        coeffStatus === 'under' ? 'bg-green-50 border-green-200' : coeffStatus === 'over' ? 'bg-orange-50 border-orange-200' : 'bg-pilote-50 border-pilote-200'
      }`}>
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
            coeffStatus === 'under' ? 'bg-green-100' : coeffStatus === 'over' ? 'bg-orange-100' : 'bg-pilote-100'
          }`}>
            {coeffStatus === 'under' && <CheckCircle className="w-5 h-5 text-green-600" />}
            {coeffStatus === 'over'  && <AlertTriangle className="w-5 h-5 text-orange-600" />}
            {coeffStatus === 'ok'    && <TrendingUp className="w-5 h-5 text-pilote" />}
          </div>
          <div className="flex-1">
            <div className="flex items-baseline gap-2 mb-1">
              <span className={`text-2xl font-bold ${
                coeffStatus === 'under' ? 'text-green-700' : coeffStatus === 'over' ? 'text-orange-700' : 'text-pilote-800'
              }`}>x{coefficient.toFixed(3)}</span>
              <span className="text-sm font-semibold text-gray-700">Coefficient de valorisation</span>
            </div>
            <p className={`text-xs leading-relaxed ${
              coeffStatus === 'under' ? 'text-green-700' : coeffStatus === 'over' ? 'text-orange-700' : 'text-pilote-800'
            }`}>
              {coeffStatus === 'under' && <>Coûts bas : <strong>{((1 - coefficient) * 100).toFixed(1)}% sous le marché</strong> pour {targetMargin}% de marge.</>}
              {coeffStatus === 'over'  && <>Pour {targetMargin}% de marge : <strong>{((coefficient - 1) * 100).toFixed(1)}% au-dessus du marché</strong>. Positionnement premium.</> }
              {coeffStatus === 'ok'    && <>Prix proches du marché ({coefficient > 1 ? '+' : ''}{((coefficient - 1) * 100).toFixed(1)}%). Bon équilibre pour {targetMargin}%.</> }
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-xs text-gray-500">CA marché réf.</p>
            <p className="text-sm font-bold text-gray-800">{eur(totalMarketRevenue1)}</p>
            <p className="text-xs text-gray-500">CA cible/animal</p>
            <p className="text-sm font-bold">{eur(totalRevenue1)}</p>
          </div>
        </div>
      </div>
    )}

    {totalRevenue1 > 0 && (
      <div>
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">{qty > 1 ? (isHalf ? 'Par demi' : 'Par animal') : 'Résultat'}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Poids vendable',  value: kgStr(totalSellable1), sub: `sur ${carcassW1.toFixed(1)} kg carcasse` },
            { label: 'Coût de revient', value: eur(totalCost1),       sub: `${eur(totalCost1 / totalSellable1)}/kg` },
            { label: 'CA conseillé',    value: eur(totalRevenue1),    sub: `coeff. x${coefficient.toFixed(3)}` },
            { label: 'Marge brute',     value: eur(totalRevenue1 - totalCost1), sub: `${actualMargin1.toFixed(1)}% réel`, highlight: true },
          ].map(kpi => (
            <div key={kpi.label} className={`rounded-2xl p-4 border shadow-card transition-all hover:shadow-card-hover hover:-translate-y-0.5 ${'highlight' in kpi && kpi.highlight ? 'bg-pilote border-transparent' : 'bg-white border-gray-100'}`}>
              <p className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${'highlight' in kpi && kpi.highlight ? 'text-white/70' : 'text-gray-400'}`}>{kpi.label}</p>
              <p className={`text-xl font-extrabold leading-tight tabular-nums ${'highlight' in kpi && kpi.highlight ? 'text-white' : 'text-gray-900'}`}>{kpi.value}</p>
              <p className={`text-xs mt-0.5 ${'highlight' in kpi && kpi.highlight ? 'text-white/60' : 'text-gray-400'}`}>{kpi.sub}</p>
            </div>
          ))}
        </div>
      </div>
    )}
    </>
  )
}


/** Le détail par pièce : arborescence dépliable (bœuf) ou regroupement par
 *  catégories, poids et prix éditables, coût de revient réparti, totaux. */
export function TableauMorceaux({
  results, isTree, cutTree, resById, expandedNodes, toggleNode,
  includedCats, excludedCuts, priceOf, cutWeights, setCutWeights,
  cutPrices, setCutPrice, coutParPiece, costOverrides, setCostOverride,
  sellOverrides, setSellOverride, coefficient, toggleCut, repartitionCout,
  qty, isHalf, config, totalSellable1, totalMarketRevenue1, totalRevenue1, totalRevenueLot,
}: {
  results: CutResult[]
  isTree: boolean
  cutTree: TreeNode[]
  resById: Map<string, CutResult>
  expandedNodes: Set<string>
  toggleNode: (path: string) => void
  includedCats: Set<CutCategory>
  excludedCuts: Set<string>
  priceOf: (cut: Cut) => number
  cutWeights: Record<string, string>
  setCutWeights: Dispatch<SetStateAction<Record<string, string>>>
  cutPrices: Record<string, string>
  setCutPrice: (cutId: string, value: string) => void
  coutParPiece: Map<string, CoutMorceau>
  costOverrides: Record<string, string>
  setCostOverride: (cutId: string, value: string) => void
  sellOverrides: Record<string, string>
  setSellOverride: (cutId: string, value: string) => void
  coefficient: number
  toggleCut: (cutId: string) => void
  repartitionCout: RepartitionCarcasse
  qty: number
  isHalf: boolean
  config: AnimalConfig
  totalSellable1: number
  totalMarketRevenue1: number
  totalRevenue1: number
  totalRevenueLot: number
}) {

  /** Ligne d'une pièce (feuille de l'arbre) : nom + poids + prix éditables + prix conseillé + CA. */
  function leafRow(r: CutResult, depth = 0): JSX.Element {
    const isExcluded = excludedCuts.has(r.cut.id)
    const refPrice = priceOf(r.cut)
    const pctDiff = r.sellingPrice > 0 && refPrice > 0 ? ((r.sellingPrice - refPrice) / refPrice) * 100 : 0
    const priceColor = pctDiff < -5 ? 'text-green-600' : pctDiff > 15 ? 'text-orange-600' : 'text-gray-900'
    return (
      <tr key={r.cut.id} className={`group border-t border-gray-50 transition-colors ${r.active ? 'hover:bg-gray-50' : 'opacity-40 bg-gray-50/50'}`}>
        <td className="px-4 py-2.5 font-medium text-gray-800" style={depth ? { paddingLeft: 16 + depth * 18 } : undefined}>
          {r.cut.name}
          {isExcluded && <span className="ml-2 text-[10px] font-semibold text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full">retirée</span>}
        </td>
        <td className="px-4 py-2.5 text-right">
          <div className="flex items-center justify-end gap-1">
            <input type="number" min="0" step="0.1"
              value={cutWeights[r.cut.id] ?? ''}
              onChange={e => setCutWeights(prev => ({ ...prev, [r.cut.id]: e.target.value }))}
              disabled={isExcluded}
              placeholder="0"
              className="w-16 border border-gray-200 rounded-lg px-2 py-1 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-pilote-200 disabled:bg-gray-50 disabled:text-gray-300" />
            <span className="text-xs text-gray-400">kg</span>
          </div>
        </td>
        <td className="px-4 py-2.5 text-right">
          <div className="flex items-center justify-end gap-1">
            <input type="number" min="0" step="0.5"
              value={cutPrices[r.cut.id] ?? ''}
              onChange={e => setCutPrice(r.cut.id, e.target.value)}
              placeholder={String(r.cut.marketPrice)}
              className="w-14 border border-gray-200 rounded-lg px-2 py-1 text-sm text-right tabular-nums text-gray-500 focus:outline-none focus:ring-2 focus:ring-pilote-200" />
            <span className="text-xs text-gray-400">€</span>
          </div>
        </td>
        <td className="px-4 py-2.5 text-right">
          {(() => {
            // Le coût de revient de la pièce. Vide tant que la carcasse n'a pas
            // de coût ou que la pièce n'a ni poids ni prix de référence : un
            // zéro se lirait « gratuit ».
            const m = coutParPiece.get(r.cut.id)
            const cout = m && m.cout_kg_ht !== null ? m.cout_kg_ht : null
            return (
              <div className="flex items-center justify-end gap-1">
                <input type="number" min="0" step="0.1"
                  value={costOverrides[r.cut.id] ?? ''}
                  onChange={e => setCostOverride(r.cut.id, e.target.value)}
                  disabled={isExcluded}
                  placeholder={cout !== null ? String(Math.round(cout * 100) / 100) : '—'}
                  title={m?.force
                    ? 'Coût forcé à la main — il ne suit plus la répartition de la carcasse'
                    : cout !== null
                      ? `Réparti au prorata de la valeur · ×${m?.coef ?? '—'} du kilo commercial`
                      : 'Pas de coût : la pièce n’a pas de poids, ou pas de prix de référence'}
                  className={`w-16 border rounded-lg px-2 py-1 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-pilote-200 disabled:bg-gray-50 disabled:text-gray-300 ${m?.force ? 'border-orange-300 text-orange-700 font-semibold' : 'border-gray-200 text-gray-600'}`} />
                <span className="text-xs text-gray-400">€</span>
              </div>
            )
          })()}
        </td>
        <td className="px-4 py-2.5 text-right">
          <div className="flex items-center justify-end gap-1">
            <input type="number" min="0" step="0.5"
              value={sellOverrides[r.cut.id] ?? ''}
              onChange={e => setSellOverride(r.cut.id, e.target.value)}
              disabled={isExcluded}
              placeholder={r.active ? String(Math.round(priceOf(r.cut) * coefficient * 100) / 100) : '—'}
              className="w-16 border border-gray-200 rounded-lg px-2 py-1 text-sm text-right tabular-nums font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-pilote-200 disabled:bg-gray-50 disabled:text-gray-300" />
            <span className="text-xs text-gray-400">€</span>
            {r.active && Math.abs(pctDiff) > 1 && <span className={`text-[10px] ${priceColor}`}>({pctDiff > 0 ? '+' : ''}{pctDiff.toFixed(0)}%)</span>}
          </div>
        </td>
        <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{r.active ? eur(r.revenue) : '—'}</td>
        <td className="px-2 py-2.5 text-center w-10">
          {isExcluded ? (
            <button onClick={() => toggleCut(r.cut.id)} title="Réintégrer cette pièce" className="p-1.5 rounded-lg text-pilote hover:bg-pilote-50 transition-colors"><RotateCcw className="w-3.5 h-3.5" /></button>
          ) : (
            <button onClick={() => toggleCut(r.cut.id)} title="Retirer cette pièce du calcul" className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"><Trash2 className="w-3.5 h-3.5" /></button>
          )}
        </td>
      </tr>
    )
  }

  /** Rendu récursif : entêtes de pièces dépliables + feuilles (avec poids/prix). */
  function renderTree(nodes: TreeNode[], depth: number): JSX.Element[] {
    const out: JSX.Element[] = []
    for (const node of nodes) {
      if (node.cut) {
        const r = resById.get(node.cut.id)
        if (r) out.push(leafRow(r, depth))
        continue
      }
      const open = expandedNodes.has(node.path)
      const leaves = collectLeafCuts(node)
      let w = 0, rev = 0
      for (const c of leaves) { const rr = resById.get(c.id); if (rr && rr.active) { w += rr.weight; rev += rr.revenue } }
      out.push(
        <tr key={node.path} className="border-t border-gray-100 bg-gray-50/60 hover:bg-gray-100 cursor-pointer transition-colors" onClick={() => toggleNode(node.path)}>
          <td colSpan={6} className="px-4 py-2" style={{ paddingLeft: 12 + depth * 18 }}>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-semibold text-xs uppercase tracking-wide text-gray-700">
                <ChevronRight className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`} />
                {node.name}
                <span className="text-[10px] font-normal text-gray-400 normal-case">({leaves.length})</span>
              </span>
              {w > 0 && <span className="text-xs text-gray-400 tabular-nums">{kgStr(w)} · {eur(rev)}</span>}
            </div>
          </td>
        </tr>
      )
      if (open) out.push(...renderTree(node.children, depth + 1))
    }
    return out
  }

  return (
    <>
    {results.length > 0 ? (
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-card">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Package className="w-4 h-4 text-gray-400" />Détail par pièce {qty > 1 && <span className="text-xs font-normal text-gray-400">{isHalf ? '(par demi)' : '(par animal)'}</span>}
          </h2>
          <span className="text-xs text-gray-400">{isTree ? 'Cliquez une pièce pour la déplier · poids et prix éditables' : 'Prix de référence modifiables · poids saisis'}</span>
        </div>
        {/* ── Ce que dit la colonne « Coût de revient », et ce qu'elle tait ── */}
        {(() => {
          const rep = repartitionCout
          const rien = rep.cout_moyen_kg_ht === null
          return (
            <div className={`px-5 py-3 border-b text-[11px] leading-relaxed ${rep.nb_forces > 0 ? 'border-orange-100 bg-orange-50/50 text-orange-800' : 'border-gray-100 bg-gray-50/60 text-gray-500'}`}>
              {rien ? (
                <>Le coût de revient par pièce apparaîtra dès que la carcasse aura un coût et les pièces un poids.</>
              ) : (
                <>
                  Votre kilo commercial revient à <strong className="tabular-nums">{eur(rep.cout_moyen_kg_ht as number)}</strong>
                  {' '}(achat + frais + main-d&apos;œuvre de découpe, sur {fmtKg(rep.kg_commercial)} vendables).
                  {' '}Chaque pièce en prend sa part au prorata de son prix de référence — le filet coûte plus cher que le collier.
                  {rep.kg_hors_commerce > 0 && (
                    <> {fmtKg(rep.kg_hors_commerce)} sans prix de référence ne portent aucun coût : leur part se reporte sur ce qui se vend.</>
                  )}
                  {rep.nb_forces > 0 && (
                    <> <strong>{rep.nb_forces} coût{rep.nb_forces > 1 ? 's' : ''} forcé{rep.nb_forces > 1 ? 's' : ''} à la main</strong> :
                    la somme des coûts dépasse celui de la carcasse de <strong className="tabular-nums">{eur(rep.ecart_forcage_ht)}</strong>.
                    Les autres pièces n&apos;ont pas bougé — c&apos;est voulu.</>
                  )}
                </>
              )}
            </div>
          )
        })()}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {['Pièce','Poids','Réf. marché/kg','Coût de revient/kg','Prix conseillé/kg','CA pièce',''].map((h, hi) => (
                  <th key={hi} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isTree ? renderTree(cutTree, 0) : CATEGORIES.map(cat => {
                const catResults = results.filter(r => r.cut.category === cat)
                if (catResults.length === 0) return null
                const catActive  = catResults.filter(r => r.active)
                const catRevenue = catActive.reduce((s, r) => s + r.revenue, 0)
                const catWeight  = catActive.reduce((s, r) => s + r.weight, 0)
                const catChecked = includedCats.has(cat)
                return (
                  <React.Fragment key={cat}>
                    <tr className="border-t border-gray-100">
                      <td colSpan={6} className="px-4 py-2">
                        <div className="flex items-center justify-between">
                          <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${CATEGORY_COLORS[cat]}`}>{CATEGORY_LABELS[cat]}</span>
                          {catChecked && catRevenue > 0 && <span className="text-xs text-gray-400">{kgStr(catWeight)} | {eur(catRevenue)}</span>}
                        </div>
                      </td>
                    </tr>
                    {catResults.map(r => {
                      const isExcluded = excludedCuts.has(r.cut.id)
                      const refPrice = priceOf(r.cut)
                      const pctDiff = r.sellingPrice > 0 && refPrice > 0 ? ((r.sellingPrice - refPrice) / refPrice) * 100 : 0
                      const priceColor = pctDiff < -5 ? 'text-green-600' : pctDiff > 15 ? 'text-orange-600' : 'text-gray-900'
                      return (
                        <tr key={r.cut.id} className={`group border-t border-gray-50 transition-colors ${r.active ? 'hover:bg-gray-50' : 'opacity-40 bg-gray-50/50'}`}>
                          <td className="px-4 py-2.5 font-medium text-gray-800">
                            {r.cut.name}
                            {isExcluded && <span className="ml-2 text-[10px] font-semibold text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full">retirée</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <input type="number" min="0" step="0.1"
                                value={cutWeights[r.cut.id] ?? ''}
                                onChange={e => setCutWeights(prev => ({ ...prev, [r.cut.id]: e.target.value }))}
                                disabled={isExcluded}
                                placeholder="0"
                                className="w-16 border border-gray-200 rounded-lg px-2 py-1 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-pilote-200 disabled:bg-gray-50 disabled:text-gray-300" />
                              <span className="text-xs text-gray-400">kg</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <input type="number" min="0" step="0.5"
                                value={cutPrices[r.cut.id] ?? ''}
                                onChange={e => setCutPrice(r.cut.id, e.target.value)}
                                placeholder={String(r.cut.marketPrice)}
                                className="w-14 border border-gray-200 rounded-lg px-2 py-1 text-sm text-right tabular-nums text-gray-500 focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                              <span className="text-xs text-gray-400">€</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <input type="number" min="0" step="0.5"
                                value={sellOverrides[r.cut.id] ?? ''}
                                onChange={e => setSellOverride(r.cut.id, e.target.value)}
                                disabled={isExcluded}
                                placeholder={r.active ? String(Math.round(priceOf(r.cut) * coefficient * 100) / 100) : '—'}
                                className="w-16 border border-gray-200 rounded-lg px-2 py-1 text-sm text-right tabular-nums font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-pilote-200 disabled:bg-gray-50 disabled:text-gray-300" />
                              <span className="text-xs text-gray-400">€</span>
                              {r.active && Math.abs(pctDiff) > 1 && <span className={`text-[10px] ${priceColor}`}>({pctDiff > 0 ? '+' : ''}{pctDiff.toFixed(0)}%)</span>}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{r.active ? eur(r.revenue) : '—'}</td>
                          <td className="px-2 py-2.5 text-center w-10">
                            {isExcluded ? (
                              <button onClick={() => toggleCut(r.cut.id)}
                                title="Réintégrer cette pièce"
                                className="p-1.5 rounded-lg text-pilote hover:bg-pilote-50 transition-colors">
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <button onClick={() => toggleCut(r.cut.id)}
                                title="Retirer cette pièce du calcul"
                                className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </React.Fragment>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-pilote-800 bg-pilote text-white">
                <td className="px-4 py-3 font-bold">TOTAL {qty > 1 ? (isHalf ? '/ demi' : '/ animal') : ''}</td>
                <td className="px-4 py-3 text-right font-bold">{totalSellable1 > 0 ? kgStr(totalSellable1) : '—'}</td>
                <td className="px-4 py-3 text-right text-pilote-200">{totalMarketRevenue1 > 0 ? eur(totalMarketRevenue1) : '—'}</td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3 text-right font-bold text-pilote-orange">{totalRevenue1 > 0 ? eur(totalRevenue1) : '—'}</td>
                <td className="px-4 py-3" />
              </tr>
              {qty > 1 && totalRevenue1 > 0 && (
                <tr className="bg-pilote-800 text-white">
                  <td className="px-4 py-2.5 font-bold text-sm">TOTAL LOT ({qty} {isHalf ? 'demis' : 'animaux'})</td>
                  <td className="px-4 py-2.5 text-right font-bold">{kgStr(totalSellable1 * qty)}</td>
                  <td className="px-4 py-2.5" /><td className="px-4 py-2.5" />
                  <td className="px-4 py-2.5 text-right font-bold text-pilote-orange">{eur(totalRevenueLot)}</td>
                  <td className="px-4 py-2.5" />
                </tr>
              )}
            </tfoot>
          </table>
        </div>
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100">
          <p className="text-xs text-gray-400">
            Coefficient x{coefficient.toFixed(3)} appliqué aux prix de référence.
            <span className="text-green-600 font-medium ml-1">Vert</span> = sous la référence.
            <span className="text-orange-600 font-medium ml-1">Orange</span> = +15% au-dessus.
            <span className="ml-1">Poids et prix de référence sont éditables ; les prix restent mémorisés par famille.</span>
          </p>
        </div>
      </div>
    ) : (
      <div className="bg-gradient-to-b from-pilote-50/40 to-white border border-pilote-100 rounded-2xl p-16 shadow-card flex flex-col items-center justify-center text-center">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-pilote-50 to-pilote-100 ring-1 ring-pilote-200/60 flex items-center justify-center mb-5 shadow-sm">
          <span className="text-4xl">{config.emoji}</span>
        </div>
        <p className="text-lg font-bold text-gray-900">Prêt à valoriser votre carcasse</p>
        <p className="text-sm text-gray-500 mt-1.5 max-w-xs">Renseignez le poids et le prix d'achat à gauche — le détail par pièce et le prix de vente conseillé s'afficheront ici.</p>
      </div>
    )}
    </>
  )
}


/** La fiche d'une valorisation enregistrée : chiffres du lot, PDF, réouverture */
export function ModaleLot({
  selected, setSelected, deleteValo, downloadValoPdf, savedValoPdfPayload, reopenValo, pdfBusy,
}: {
  selected: SavedValo
  setSelected: Dispatch<SetStateAction<SavedValo | null>>
  deleteValo: (id: string) => Promise<void>
  downloadValoPdf: (payload: Record<string, unknown>, filename: string) => Promise<void>
  savedValoPdfPayload: (v: SavedValo & { lot_numbers?: string | null; cut_weights?: Record<string, number> | null }) => Record<string, unknown>
  reopenValo: (v: SavedValo & { cut_weights?: Record<string, number> | null; decoupe_hours?: number | null; lot_numbers?: string | null }) => void
  pdfBusy: boolean
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm p-4" onClick={() => setSelected(null)}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-bold text-gray-900">
              {ANIMALS[selected.animal_type as AnimalType]?.emoji} {selected.breed_name}
              {(selected.quantity ?? 1) > 1 && <span className="ml-2 text-sm font-normal text-pilote">× {selected.quantity}</span>}
            </h2>
            <p className="text-xs text-gray-400">{new Date(selected.purchase_date).toLocaleDateString('fr-FR')} · {selected.carcass_weight || selected.live_weight} kg carcasse/animal</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => deleteValo(selected.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors"><Trash2 className="w-4 h-4" /></button>
            <button onClick={() => setSelected(null)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Coût total lot',  value: eur(selected.total_cost),                         highlight: false },
            { label: 'CA estimé total', value: eur(selected.total_revenue),                       highlight: true  },
            { label: 'Marge brute',     value: eur(selected.total_revenue - selected.total_cost), highlight: false },
            { label: 'Taux de marge',   value: `${selected.margin_rate.toFixed(1)} %`,            highlight: selected.margin_rate >= 35 },
            { label: 'Carcasse/animal', value: `${selected.carcass_weight} kg`,                   highlight: false },
            { label: 'Coefficient',     value: `x${selected.coefficient?.toFixed(3)}`,            highlight: false },
            { label: 'Prix achat/kg',   value: `${selected.purchase_per_kg} €/kg carcasse`,      highlight: false },
            { label: 'Main d\'œuvre',   value: eur(selected.labor_cost),                          highlight: false },
          ].map(kpi => (
            <div key={kpi.label} className={`rounded-xl p-3 ${kpi.highlight ? 'bg-pilote' : 'bg-gray-50'}`}>
              <p className={`text-xs ${kpi.highlight ? 'text-pilote-200' : 'text-gray-400'}`}>{kpi.label}</p>
              <p className={`text-base font-bold ${kpi.highlight ? 'text-white' : 'text-gray-900'}`}>{kpi.value}</p>
            </div>
          ))}
        </div>
        {selected.notes && (
          <div className="mt-3 p-3 bg-pilote-50 border border-pilote-100 rounded-xl">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-pilote-800">Notes</p>
            <p className="text-sm text-gray-700 mt-0.5">{selected.notes}</p>
          </div>
        )}
        <div className="mt-4 flex items-center gap-2">
          <button onClick={() => downloadValoPdf(savedValoPdfPayload(selected as SavedValo & { lot_numbers?: string | null; cut_weights?: Record<string, number> | null }), `valorisation-${selected.breed_name}.pdf`)} disabled={pdfBusy}
            title="Télécharger la fiche de ce lot en PDF"
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-pilote border border-pilote-200 bg-white hover:bg-pilote-50 transition-all disabled:opacity-50">
            {pdfBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}PDF
          </button>
          <button onClick={() => reopenValo(selected as SavedValo & { cut_weights?: Record<string, number> | null; decoupe_hours?: number | null; lot_numbers?: string | null })}
            title="Recharge tous les paramètres et poids par pièce de ce lot dans le calculateur"
            className="flex-1 flex items-center justify-center gap-2 bg-pilote hover:bg-pilote-hover text-white text-sm font-semibold rounded-xl py-2.5 shadow-card active:scale-[0.99] transition-all">
            <RotateCcw className="w-4 h-4" />Rouvrir dans le calculateur
          </button>
        </div>
      </div>
    </div>
  )
}
