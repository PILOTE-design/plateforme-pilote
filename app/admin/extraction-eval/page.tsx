'use client'

// app/admin/extraction-eval/page.tsx — Écran « Fiabilité de l'extraction » (lot V5).
// Rejoue l'extracteur courant sur le corpus de référence et affiche l'exactitude
// mesurée, chiffre par chiffre. C'est ici qu'on prouve — ou qu'on réfute — la
// promesse de fiabilité, avant et après tout changement de prompt ou de modèle.

import { useState } from 'react'
import { Gauge, Play, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'

type ChampEcart = { champ: string; attendu: number; obtenu: number | null; ecart: number; ok: boolean }
type CasEval = { extraction_id: string; semaine: number; annee: number; total: number; exacts: number; exactitude: number; divergences: ChampEcart[] }
type EvalResponse = {
  exactitude: number; exacts: number; total_chiffres: number
  cas_evalues: number; corpus_total: number; restants: number
  model_courant: string; prompt_version_courant: string; reference: string
  par_cas: CasEval[]
  erreurs: { id: string; semaine: number; annee: number; erreur: string }[]
}

const pct = (x: number) => `${(x * 100).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`
const eur = (x: number | null) => x === null ? '—' : `${x.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

export default function ExtractionEvalPage() {
  const [running, setRunning] = useState(false)
  const [res, setRes] = useState<EvalResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [includePending, setIncludePending] = useState(false)

  async function lancer() {
    setRunning(true); setErr(null); setRes(null)
    try {
      const r = await fetch('/api/admin/extraction-eval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 3, include_pending: includePending }),
      })
      const data = await r.json()
      if (!r.ok) { setErr(data?.error || 'Échec de l\'évaluation.'); return }
      setRes(data as EvalResponse)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erreur réseau.')
    } finally {
      setRunning(false)
    }
  }

  const parfait = res && res.cas_evalues > 0 && res.exactitude >= 0.999999

  return (
    <div className="max-w-5xl mx-auto p-8">
      <div className="flex items-start gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-pilote-50 flex items-center justify-center flex-shrink-0">
          <Gauge className="w-5 h-5 text-pilote" />
        </div>
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-gray-900">Fiabilité de l'extraction</h1>
          <p className="text-sm text-gray-500 mt-0.5">Le score n'est pas proclamé, il est mesuré : l'extracteur courant rejoue les rapports de référence, chiffre contre chiffre.</p>
        </div>
      </div>

      <div className="bg-pilote-50 rounded-2xl p-5 mb-6 mt-4">
        <p className="text-[13px] leading-relaxed text-gray-700">
          Chaque rapport <span className="font-semibold text-pilote">validé</span> (confirmé par un humain, ou passé tous contrôles au vert) devient un cas de référence : son texte source est archivé, ses chiffres sont sûrs.
          Lancer l'évaluation <span className="font-semibold text-pilote">rejoue l'extracteur</span> sur ces textes et compte les chiffres justes. Un changement de prompt ou de modèle qui fait baisser ce taux est une régression — à voir <span className="font-semibold text-pilote">avant</span> de livrer.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4 mb-8">
        <button
          onClick={lancer}
          disabled={running}
          className="inline-flex items-center gap-2 bg-pilote hover:bg-pilote-hover text-white rounded-xl px-5 py-2.5 text-sm font-semibold shadow-card active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {running ? 'Évaluation en cours…' : 'Lancer l\'évaluation'}
        </button>
        <label className="inline-flex items-center gap-2 text-sm text-gray-600 select-none cursor-pointer">
          <input type="checkbox" checked={includePending} onChange={e => setIncludePending(e.target.checked)}
            className="rounded border-gray-300 text-pilote focus:ring-pilote-200" />
          Inclure les extractions en attente de validation
        </label>
        <span className="text-[11px] text-gray-400">Lot borné à 3 cas · le replay appelle l'IA (~15 s/cas)</span>
      </div>

      {running && (
        <div className="rounded-2xl border border-gray-100 shadow-card p-8 text-center">
          <Loader2 className="w-6 h-6 text-pilote animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">L'extracteur rejoue le corpus (plusieurs appels IA). Cela peut prendre jusqu'à une minute.</p>
        </div>
      )}

      {err && (
        <div className="rounded-2xl border border-red-100 bg-red-50 p-5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{err}</p>
        </div>
      )}

      {res && !running && (
        <div className="space-y-6">
          {res.cas_evalues === 0 ? (
            <div className="rounded-2xl border border-gray-100 shadow-card p-8 text-center">
              <p className="text-sm text-gray-600 font-medium">Aucun cas de référence à évaluer pour l'instant.</p>
              <p className="text-[13px] text-gray-400 mt-2 max-w-lg mx-auto">
                Le corpus se remplit tout seul : dès qu'un rapport est validé (ou généré tous contrôles au vert), il rejoint la référence.
                {res.corpus_total > 0 ? ' Des extractions existent mais aucune n\'est validée — cochez « inclure les extractions en attente » pour exercer l\'outil dès maintenant.' : ''}
              </p>
            </div>
          ) : (
            <>
              {/* KPI héros : l'exactitude mesurée */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className={`rounded-2xl p-5 shadow-card ${parfait ? 'bg-pilote' : 'bg-white border border-gray-100'}`}>
                  <p className={`text-[11px] font-semibold uppercase tracking-wider ${parfait ? 'text-pilote-200' : 'text-gray-400'}`}>Exactitude mesurée</p>
                  <p className={`text-4xl font-extrabold tracking-tight tabular mt-1 ${parfait ? 'text-white' : 'text-gray-900'}`}>{pct(res.exactitude)}</p>
                  <p className={`text-xs mt-1 ${parfait ? 'text-pilote-200' : 'text-gray-400'}`}>{res.exacts} / {res.total_chiffres} chiffres justes</p>
                </div>
                <div className="rounded-2xl p-5 shadow-card bg-white border border-gray-100">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Cas évalués</p>
                  <p className="text-4xl font-extrabold tracking-tight tabular mt-1 text-gray-900">{res.cas_evalues}</p>
                  <p className="text-xs mt-1 text-gray-400">sur {res.corpus_total} en référence{res.restants > 0 ? ` · ${res.restants} à relancer` : ''}</p>
                </div>
                <div className="rounded-2xl p-5 shadow-card bg-white border border-gray-100">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Extracteur testé</p>
                  <p className="text-sm font-bold text-gray-900 mt-2 break-all">{res.model_courant}</p>
                  <p className="text-xs mt-1 text-gray-400">prompts v{res.prompt_version_courant}</p>
                </div>
              </div>

              {res.restants > 0 && (
                <p className="text-[13px] text-gray-500">{res.restants} cas de référence n'ont pas été rejoués dans ce lot (borne des 60 s). Relancez pour les couvrir.</p>
              )}

              {/* Détail par cas */}
              <div className="space-y-4">
                {res.par_cas.map(c => {
                  const casParfait = c.exactitude >= 0.999999
                  return (
                    <div key={c.extraction_id} className="rounded-2xl border border-gray-100 shadow-card overflow-hidden">
                      <div className="flex items-center justify-between px-5 py-4 bg-gray-50 border-b border-gray-100">
                        <div className="flex items-center gap-2.5">
                          {casParfait
                            ? <CheckCircle2 className="w-4 h-4 text-green-600" />
                            : <AlertTriangle className="w-4 h-4 text-amber-500" />}
                          <span className="text-sm font-bold text-gray-900">Semaine {c.semaine} · {c.annee}</span>
                        </div>
                        <span className={`text-sm font-bold tabular ${casParfait ? 'text-green-600' : 'text-amber-600'}`}>{pct(c.exactitude)} · {c.exacts}/{c.total}</span>
                      </div>
                      {c.divergences.length === 0 ? (
                        <p className="px-5 py-4 text-[13px] text-gray-500">Tous les chiffres du rapport de référence sont reproduits à l'identique.</p>
                      ) : (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-white text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                              <th className="text-left px-5 py-2">Chiffre en écart</th>
                              <th className="text-right px-5 py-2">Référence</th>
                              <th className="text-right px-5 py-2">Ré-extrait</th>
                              <th className="text-right px-5 py-2">Écart</th>
                            </tr>
                          </thead>
                          <tbody>
                            {c.divergences.map((d, i) => (
                              <tr key={i} className="border-t border-gray-100">
                                <td className="px-5 py-2 text-gray-700">{d.champ}</td>
                                <td className="px-5 py-2 text-right tabular font-semibold text-gray-900">{eur(d.attendu)}</td>
                                <td className="px-5 py-2 text-right tabular text-gray-500">{eur(d.obtenu)}</td>
                                <td className="px-5 py-2 text-right tabular font-semibold text-red-500">{eur(d.ecart)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )
                })}
              </div>

              {res.erreurs.length > 0 && (
                <div className="rounded-2xl border border-amber-100 bg-amber-50 p-5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-600 mb-2">Cas non évalués</p>
                  <ul className="space-y-1">
                    {res.erreurs.map((e, i) => (
                      <li key={i} className="text-[13px] text-amber-800">Semaine {e.semaine} · {e.annee} — {e.erreur}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
