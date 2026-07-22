'use client'

import { Fragment, useMemo, useState } from 'react'

const fmt  = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })
const fmt2 = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export type ProdRow = { name: string; famille: string | null; vals: number[]; last: number; prevDelta: number }

const NON_CLASSE = 'Non classé'

function MiniSpark({ vals }: { vals: number[] }) {
  const max = Math.max(...vals, 1)
  return (
    <div className="flex items-end gap-0.5 h-6">
      {vals.map((v, i) => (
        <div key={i}
          className={`w-1.5 rounded-sm ${i === vals.length - 1 ? 'bg-pilote' : 'bg-pilote-100'}`}
          style={{ height: `${Math.max(8, (v / max) * 100)}%` }} />
      ))}
    </div>
  )
}

export default function ProduitsParFamille({
  products, lastLabel, prevLabel, hasComparison,
}: {
  products: ProdRow[]
  lastLabel: string
  prevLabel: string
  hasComparison: boolean
}) {
  // Familles présentes, triées par CA décroissant
  const familles = useMemo(() => {
    const tot = new Map<string, number>()
    for (const p of products) {
      const f = p.famille || NON_CLASSE
      tot.set(f, (tot.get(f) ?? 0) + p.last)
    }
    return [...tot.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f)
  }, [products])

  const hasFamilles = familles.some(f => f !== NON_CLASSE)
  const [selected, setSelected] = useState<string>(() => familles[0] ?? NON_CLASSE)
  const active = familles.includes(selected) ? selected : (familles[0] ?? NON_CLASSE)

  // Produits de la famille choisie, tri CA décroissant + cumul 20/80 (sur le CA DE LA FAMILLE)
  const { rows, famTotal, vitalCount, vitalShare } = useMemo(() => {
    const inFam = products
      .filter(p => (p.famille || NON_CLASSE) === active)
      .sort((a, b) => b.last - a.last)
    const total = inFam.reduce((s, p) => s + p.last, 0)
    let cum = 0
    let vc = 0
    if (total > 0) {
      for (let i = 0; i < inFam.length; i++) {
        cum += inFam[i].last
        vc = i + 1
        if (cum / total >= 0.8) break
      }
    }
    const vitalSum = inFam.slice(0, vc).reduce((s, p) => s + p.last, 0)
    return { rows: inFam, famTotal: total, vitalCount: vc, vitalShare: total > 0 ? (vitalSum / total) * 100 : 0 }
  }, [products, active])

  return (
    <div>
      <div className="px-5 pt-4 pb-3 border-b border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-bold text-gray-900">Produits par famille</h2>
            <p className="text-xs text-gray-400 mt-0.5">Analyse 20/80 sur le CA de la famille sélectionnée · CA {lastLabel}</p>
          </div>
        </div>
        {!hasFamilles ? (
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Les produits ne sont pas encore rattachés à leur famille. Ce détail se remplira à la prochaine génération (ou régénération) de vos rapports hebdomadaires.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {familles.map(f => (
              <button key={f} onClick={() => setSelected(f)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                  active === f ? 'bg-pilote text-white border-pilote' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}>
                {f}
              </button>
            ))}
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">Aucun produit dans cette famille</p>
      ) : (
        <>
          {famTotal > 0 && (
            <div className="px-5 py-3 bg-pilote-50/60 border-b border-pilote-100 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
              <span className="text-gray-600">CA famille <strong className="text-gray-900 tabular">{fmt(famTotal)} €</strong></span>
              <span className="text-gray-600">
                <strong className="text-pilote">{vitalCount}</strong> produit{vitalCount > 1 ? 's' : ''} font <strong className="text-pilote">{vitalShare.toFixed(0)} %</strong> du CA
              </span>
              <span className="text-gray-400">({rows.length} produits au total dans « {active} »)</span>
            </div>
          )}
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                <th className="px-4 py-2.5 text-left w-8">#</th>
                <th className="px-4 py-2.5 text-left">Produit</th>
                <th className="px-4 py-2.5 text-center">Évolution</th>
                <th className="px-4 py-2.5 text-right">CA {lastLabel}</th>
                <th className="px-4 py-2.5 text-right">Part fam.</th>
                {hasComparison && <th className="px-4 py-2.5 text-right">vs {prevLabel}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => {
                const vital = i < vitalCount
                const share = famTotal > 0 ? (p.last / famTotal) * 100 : 0
                const showCut = i === vitalCount && vitalCount > 0 && vitalCount < rows.length
                return (
                  <Fragment key={p.name}>
                    {showCut && (
                      <tr>
                        <td colSpan={hasComparison ? 6 : 5} className="px-4 py-1.5 bg-pilote-50/40">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-pilote-800">— 80 % du CA de « {active} » —</span>
                        </td>
                      </tr>
                    )}
                    <tr className={`border-t border-gray-100 hover:bg-gray-50 transition-colors ${vital ? '' : 'opacity-60'}`}>
                      <td className="px-4 py-2 text-xs text-gray-400 tabular">{i + 1}</td>
                      <td className="px-4 py-2 text-sm font-medium text-gray-900">
                        {p.name}
                        {vital && <span className="ml-2 text-[9px] font-bold text-pilote bg-pilote-50 px-1.5 py-0.5 rounded-full align-middle">20/80</span>}
                      </td>
                      <td className="px-4 py-2"><div className="flex justify-center"><MiniSpark vals={p.vals} /></div></td>
                      <td className="px-4 py-2 text-right text-sm font-semibold text-gray-900 tabular">{fmt2(p.last)} €</td>
                      <td className="px-4 py-2 text-right text-xs text-gray-500 tabular">{share.toFixed(1)} %</td>
                      {hasComparison && (
                        <td className={`px-4 py-2 text-right text-xs font-bold tabular ${p.prevDelta >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                          {p.prevDelta >= 0 ? '+' : ''}{fmt(p.prevDelta)} €
                        </td>
                      )}
                    </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
