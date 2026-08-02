'use client'

// app/admin/fiches-sante/page.tsx — TABLEAU DE SANTÉ des fiches (lot 30).
//
// Une carte par boucherie : la couverture de lecture (part des achats de
// matière lue ligne à ligne, en €), ce qui bloque (sans PDF, échecs,
// quarantaine, doutes), le pouls (synchro, dernière lecture) et le coût d'API
// estimé. Les fiches qui réclament un œil arrivent en premier — c'est l'écran
// qu'on ouvre le matin pour savoir OÙ regarder, pas un rapport de plus.

import { useCallback, useEffect, useState } from 'react'
import { Activity, RefreshCw, AlertTriangle, CheckCircle2, Plug, PlugZap } from 'lucide-react'

type Sante = {
  client_id: string
  fiche: string
  integration: { provider: string; active: boolean; derniere_synchro: string | null } | null
  factures: {
    total: number
    total_ht: number
    lues: number
    lues_ht: number
    hors_matiere: number
    hors_matiere_ht: number
    en_erreur: number
    en_erreur_ht: number
    sans_pdf: number
    sans_pdf_ht: number
    jamais_lues: number
    jamais_lues_ht: number
    doutes: number
  }
  couverture_pct: number | null
  prix_publies: number
  prix_quarantaine: number
  refs_associees: number
  refs_libres: number
  derniere_lecture: string | null
  lectures: number
  cout_api_estime: number
  bilan_tronque: boolean
  alertes: string[]
}

const fmtEuro = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €'
const fmtDateHeure = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

export default function FichesSantePage() {
  const [fiches, setFiches] = useState<Sante[] | null>(null)
  const [genereLe, setGenereLe] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const charger = useCallback(async () => {
    setLoading(true)
    const r = await fetch('/api/admin/fiches-sante', { cache: 'no-store' }).then(x => x.ok ? x.json() : null).catch(() => null)
    if (r) {
      setFiches(Array.isArray(r.fiches) ? r.fiches : [])
      setGenereLe(typeof r.genere_le === 'string' ? r.genere_le : null)
    }
    setLoading(false)
  }, [])
  useEffect(() => { charger() }, [charger])

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 bg-gray-900 rounded-2xl flex items-center justify-center flex-shrink-0">
            <Activity className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Santé des fiches</h1>
            <p className="text-sm text-gray-500 mt-1">
              Couverture de lecture, blocages et pouls de chaque boucherie — les fiches qui réclament un œil d&apos;abord.
              {genereLe ? <span className="text-gray-400"> Calculé à {fmtDateHeure(genereLe)}.</span> : null}
            </p>
          </div>
        </div>
        <button onClick={charger} disabled={loading}
          className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 border border-gray-200 bg-white rounded-xl px-3 py-2 hover:bg-gray-100 transition-colors disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />Actualiser
        </button>
      </div>

      {loading && fiches === null ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-36 bg-gray-100 rounded-2xl animate-pulse" />)}</div>
      ) : !fiches || fiches.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-gray-200 py-16 text-center">
          <p className="text-sm font-medium text-gray-500">Aucune fiche avec des factures ou une intégration.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {fiches.map(s => {
            const enForme = s.alertes.length === 0
            return (
              <div key={s.client_id} className={`bg-white rounded-2xl border shadow-card overflow-hidden ${enForme ? 'border-gray-100' : 'border-amber-200'}`}>
                {/* En-tête : la fiche, son intégration, son pouls */}
                <div className="px-5 py-3 flex items-center gap-3 flex-wrap border-b border-gray-100">
                  <p className="text-base font-extrabold text-gray-900 flex-1 min-w-[180px]">{s.fiche}</p>
                  {s.integration ? (
                    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-full px-2.5 py-1 ${s.integration.active ? 'text-green-700 bg-green-50 ring-1 ring-green-200' : 'text-gray-500 bg-gray-100'}`}>
                      {s.integration.active ? <PlugZap className="w-3 h-3" /> : <Plug className="w-3 h-3" />}
                      {s.integration.provider}{s.integration.active ? '' : ' (débranchée)'}
                    </span>
                  ) : (
                    <span className="text-[11px] font-semibold text-gray-400 bg-gray-100 rounded-full px-2.5 py-1">sans intégration</span>
                  )}
                  <span className="text-[11px] text-gray-400 tabular">
                    synchro {fmtDateHeure(s.integration?.derniere_synchro ?? null)} · lecture {fmtDateHeure(s.derniere_lecture)}
                  </span>
                </div>

                {/* Couverture : LA jauge — part des achats de matière lue en € */}
                <div className="px-5 pt-4">
                  <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1.5">
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Couverture de lecture (achats de matière, en €)</p>
                    <p className="text-sm font-extrabold tabular text-gray-900">
                      {s.couverture_pct !== null ? `${s.couverture_pct.toLocaleString('fr-FR')} %` : '—'}
                      <span className="text-[11px] font-semibold text-gray-400"> · {fmtEuro(s.factures.lues_ht)} lus sur {fmtEuro(s.factures.total_ht - s.factures.hors_matiere_ht)}</span>
                    </p>
                  </div>
                  <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${s.couverture_pct !== null && s.couverture_pct >= 70 ? 'bg-green-500' : s.couverture_pct !== null && s.couverture_pct >= 40 ? 'bg-amber-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.max(2, Math.min(100, s.couverture_pct ?? 0))}%` }}
                    />
                  </div>
                </div>

                {/* Les chiffres qui comptent, côte à côte */}
                <div className="px-5 py-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-x-6 gap-y-3">
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Factures</p>
                    <p className="text-sm font-bold text-gray-900 tabular">{s.factures.total}<span className="text-[11px] font-semibold text-gray-400"> · {fmtEuro(s.factures.total_ht)}</span></p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Lues</p>
                    <p className="text-sm font-bold text-gray-900 tabular">{s.factures.lues}<span className="text-[11px] font-semibold text-gray-400"> · charges {s.factures.hors_matiere}</span></p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Prix publiés</p>
                    <p className="text-sm font-bold text-gray-900 tabular">{s.prix_publies}
                      {s.prix_quarantaine > 0 && <span className="text-[11px] font-semibold text-amber-600"> · {s.prix_quarantaine} en quarantaine</span>}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Réfs associées</p>
                    <p className="text-sm font-bold text-gray-900 tabular">{s.refs_associees}
                      {s.refs_libres > 0 && <span className="text-[11px] font-semibold text-gray-400"> · {s.refs_libres} libres</span>}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">À lire / en échec</p>
                    <p className="text-sm font-bold text-gray-900 tabular">{s.factures.jamais_lues}
                      {s.factures.en_erreur > 0 && <span className="text-[11px] font-semibold text-red-600"> · {s.factures.en_erreur} échecs</span>}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Coût API (est.)</p>
                    <p className="text-sm font-bold text-gray-900 tabular">{s.cout_api_estime.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €
                      <span className="text-[11px] font-semibold text-gray-400"> · {s.lectures} lectures</span>
                    </p>
                  </div>
                </div>

                {/* Alertes : chaque signal nomme son chiffre */}
                <div className={`px-5 py-3 border-t ${enForme ? 'border-gray-50 bg-gray-50/50' : 'border-amber-100 bg-amber-50/60'}`}>
                  {enForme ? (
                    <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-700">
                      <CheckCircle2 className="w-3.5 h-3.5" />Rien à signaler — la chaîne tourne toute seule.
                    </p>
                  ) : (
                    <div className="flex items-start gap-2 flex-wrap">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div className="flex flex-wrap gap-1.5">
                        {s.alertes.map((a, i) => (
                          <span key={i} className="text-[11px] font-semibold text-amber-800 bg-white ring-1 ring-amber-200 rounded-full px-2.5 py-0.5">{a}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <p className="mt-5 text-[11px] text-gray-400 leading-snug">
        La couverture est la part des achats de MATIÈRE (charges reconnues exclues de l&apos;assiette) dont les lignes ont été
        lues et vérifiées. Le coût d&apos;API est une estimation d&apos;ordre de grandeur (~1 ct par lecture, secours compris) —
        pour surveiller la dépense, pas pour la comptabilité. La lecture de nuit passe derrière chaque fiche active à 04:30.
      </p>
    </div>
  )
}
