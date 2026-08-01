'use client'

// app/admin/invoice-eval/page.tsx — « Exactitude de la lecture des factures ».
//
// Un bouton, deux chiffres. L'extracteur courant est rejoué sur les textes de
// factures archivés et comparé, chiffre par chiffre, à ce qui est en base.
//
// L'EXACTITUDE est le garde-fou : elle ne doit pas baisser d'une version de
// prompt à la suivante. Les PRIX EXPLOITABLES sont l'objectif : ce sont les
// lignes dont le prix se recoupe avec le montant, donc publiables dans la
// mercuriale. Un bon changement fait monter le second sans faire baisser le
// premier — et c'est vérifiable AVANT de livrer, pas découvert en production.

import { useState } from 'react'
import { Gauge, Play, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react'

type Cas = {
  fournisseur: string
  date: string | null
  exactitude: number
  lignes: string
  prix_exploitables: number
  prix_gagnes: number
  prix_perdus: number
  divergences: { champ: string; attendu: number | null; obtenu: number | null; ecart: number }[]
}

/** Facture dont les lignes NE bouclaient PAS sur le total : pas de référence
 *  ligne à ligne possible, mais une vérité solide — le total, qui vient de la
 *  comptabilité. La question posée est simple : la nouvelle lecture boucle-t-elle ? */
type Bouclage = {
  fournisseur: string
  date: string | null
  total: number
  somme_avant: number
  somme_apres: number
  ecart: number
  boucle: boolean
  lignes: number
  prix: number
}

type Reponse = {
  ok?: boolean
  prompt_version_courante?: string
  versions_du_corpus?: string[]
  corpus_disponible?: number
  cas_eligibles?: number
  cas_rejoues?: number
  cas_restants?: number
  non_rejouables_lecture_image?: number
  exactitude?: number
  chiffres_compares?: number
  chiffres_justes?: number
  lignes_attendues?: number
  lignes_obtenues?: number
  prix_exploitables_rejeu?: number
  prix_exploitables_reference?: number
  prix_gagnes?: number
  prix_perdus?: number
  bouclage?: Bouclage[]
  bouclage_reparees?: number
  bouclage_total?: number
  echecs?: { facture: string; motif: string }[]
  par_cas?: Cas[]
  message?: string
  error?: string
}

const pct = (n: number | undefined) => (n === undefined ? '—' : `${n.toLocaleString('fr-FR')} %`)

export default function InvoiceEvalPage() {
  const [running, setRunning] = useState(false)
  const [res, setRes] = useState<Reponse | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function lancer() {
    setRunning(true); setErr(null)
    try {
      const r = await fetch('/api/admin/invoice-eval', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lot: 6 }),
      })
      const data = await r.json()
      if (!r.ok) { setErr(data?.error || 'Échec de la mesure.'); return }
      setRes(data)
    } catch {
      setErr('Le serveur n’a pas répondu.')
    } finally {
      setRunning(false)
    }
  }

  const gagne = res && res.prix_exploitables_rejeu !== undefined && res.prix_exploitables_reference !== undefined
    ? res.prix_exploitables_rejeu - res.prix_exploitables_reference
    : null

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <div className="mb-6 flex items-start gap-3">
        <div className="w-12 h-12 bg-gradient-to-br from-pilote to-pilote-hover rounded-2xl flex items-center justify-center flex-shrink-0 shadow-card">
          <Gauge className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Exactitude de la lecture des factures</h1>
          <p className="text-sm text-gray-500 mt-1">
            L&apos;extracteur courant est rejoué sur les textes archivés, puis comparé à ce qui est en base.
            L&apos;exactitude ne doit pas baisser ; les prix exploitables doivent monter.
          </p>
        </div>
      </div>

      <button onClick={lancer} disabled={running}
        className="flex items-center gap-2 text-sm font-bold text-white bg-pilote hover:bg-pilote-hover rounded-xl px-4 py-2.5 shadow-card active:scale-[0.98] transition-all disabled:opacity-50">
        {running ? <><Loader2 className="w-4 h-4 animate-spin" />Rejeu en cours…</> : <><Play className="w-4 h-4" />Lancer la mesure</>}
      </button>

      {err && (
        <div className="mt-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2 text-sm text-red-900">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />{err}
        </div>
      )}

      {res && res.cas_rejoues === 0 && (
        <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-900">
          {res.message || 'Aucun cas rejouable pour l’instant.'}
        </div>
      )}

      {res && (res.cas_rejoues ?? 0) > 0 && (
        <>
          <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-2xl bg-pilote p-4 shadow-card">
              <p className="text-[10px] font-semibold text-pilote-200 uppercase tracking-wider">Fidélité</p>
              <p className="text-2xl font-extrabold tracking-tight text-white tabular mt-1">{pct(res.exactitude)}</p>
              <p className="text-[11px] text-pilote-200 mt-0.5 tabular">
                {res.chiffres_justes} / {res.chiffres_compares} chiffres
                {res.prix_perdus ? ` · ${res.prix_perdus} prix perdu${res.prix_perdus > 1 ? 's' : ''}` : ''}
              </p>
            </div>
            <div className="rounded-2xl bg-white border border-gray-100 shadow-card p-4">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Prix exploitables</p>
              <p className="text-2xl font-extrabold tracking-tight text-gray-900 tabular mt-1">{res.prix_exploitables_rejeu}</p>
              <p className={`text-[11px] mt-0.5 tabular font-semibold ${gagne === null || gagne === 0 ? 'text-gray-400' : gagne > 0 ? 'text-green-600' : 'text-red-600'}`}>
                {gagne === null ? '' : gagne === 0 ? 'identique à la référence' : `${gagne > 0 ? '+' : '−'}${Math.abs(gagne)} vs référence (${res.prix_exploitables_reference})`}
              </p>
              {(res.prix_gagnes || res.prix_perdus) ? (
                <p className="text-[11px] text-gray-400 mt-0.5 tabular">
                  {res.prix_gagnes ? `${res.prix_gagnes} retrouvé${res.prix_gagnes > 1 ? 's' : ''}` : ''}
                  {res.prix_gagnes && res.prix_perdus ? ' · ' : ''}
                  {res.prix_perdus ? <span className="text-red-600 font-semibold">{res.prix_perdus} perdu{res.prix_perdus > 1 ? 's' : ''}</span> : null}
                </p>
              ) : null}
            </div>
            <div className="rounded-2xl bg-white border border-gray-100 shadow-card p-4">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Lignes relues</p>
              <p className="text-2xl font-extrabold tracking-tight text-gray-900 tabular mt-1">{res.lignes_obtenues}</p>
              <p className="text-[11px] text-gray-400 mt-0.5 tabular">pour {res.lignes_attendues} attendues</p>
            </div>
            <div className="rounded-2xl bg-white border border-gray-100 shadow-card p-4">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Corpus</p>
              <p className="text-2xl font-extrabold tracking-tight text-gray-900 tabular mt-1">{res.cas_eligibles}</p>
              <p className="text-[11px] text-gray-400 mt-0.5 tabular">cas sûrs sur {res.corpus_disponible} archivés</p>
            </div>
          </div>

          <p className="mt-3 text-[11px] text-gray-500">
            Prompt courant <strong>{res.prompt_version_courante}</strong>
            {res.versions_du_corpus && res.versions_du_corpus.length > 0 ? <> · corpus produit par {res.versions_du_corpus.join(', ')}</> : null}
            {res.non_rejouables_lecture_image ? <> · {res.non_rejouables_lecture_image} facture(s) lue(s) en image, non rejouables depuis un texte</> : null}
            {res.cas_restants ? <> · {res.cas_restants} cas restants, relancez pour continuer</> : null}
          </p>

          {res.echecs && res.echecs.length > 0 && (
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-900">
              {res.echecs.length} rejeu(x) en échec : {res.echecs.map(e => `${e.facture} (${e.motif})`).join(' · ')}
            </div>
          )}

          {res.bouclage && res.bouclage.length > 0 && (
            <div className="mt-6">
              <div className="flex items-baseline gap-2 flex-wrap">
                <h2 className="text-sm font-extrabold text-gray-900">Factures qui ne bouclaient pas</h2>
                <p className="text-[11px] text-gray-500">
                  Pas de référence ligne à ligne — mais leur <strong>total</strong> vient de la comptabilité.
                  La nouvelle lecture les fait-elle boucler ?
                </p>
                <span className={`ml-auto text-sm font-extrabold tabular ${res.bouclage_reparees === res.bouclage_total ? 'text-green-600' : (res.bouclage_reparees ?? 0) > 0 ? 'text-orange-500' : 'text-red-600'}`}>
                  {res.bouclage_reparees} / {res.bouclage_total} réparées
                </span>
              </div>
              <div className="mt-2 space-y-2">
                {res.bouclage.map((b, i) => (
                  <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-card px-4 py-2.5 flex items-center gap-3 flex-wrap">
                    {b.boucle
                      ? <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                      : <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />}
                    <p className="text-sm font-bold text-gray-900 flex-1 min-w-[180px]">{b.fournisseur}</p>
                    <span className="text-xs text-gray-400 tabular">{b.date ?? '—'}</span>
                    <span className="text-xs text-gray-500 tabular">{b.lignes} lignes · {b.prix} prix</span>
                    <span className="text-xs text-gray-400 tabular">total {b.total.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</span>
                    <span className={`text-xs tabular ${Math.abs(b.somme_avant - b.total) <= 0.02 ? 'text-gray-400' : 'text-gray-400 line-through'}`}>
                      {b.somme_avant.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €
                    </span>
                    <span className={`text-sm font-extrabold tabular ${b.boucle ? 'text-green-600' : 'text-red-600'}`}>
                      {b.somme_apres.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €
                      {!b.boucle && <span className="font-semibold"> ({b.ecart > 0 ? '+' : '−'}{Math.abs(b.ecart).toLocaleString('fr-FR', { minimumFractionDigits: 2 })})</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-5 space-y-2">
            {(res.par_cas || []).map((c, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
                <div className="px-4 py-2.5 bg-gray-50/80 flex items-center gap-3 flex-wrap">
                  {c.exactitude === 100
                    ? <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                    : <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />}
                  <p className="text-sm font-bold text-gray-900 flex-1 min-w-[180px]">{c.fournisseur}</p>
                  <span className="text-xs text-gray-400 tabular">{c.date ?? '—'}</span>
                  <span className="text-xs text-gray-500 tabular">
                    {c.lignes} lignes · {c.prix_exploitables} prix
                    {c.prix_gagnes ? <span className="text-green-600 font-semibold"> · +{c.prix_gagnes} retrouvé{c.prix_gagnes > 1 ? 's' : ''}</span> : null}
                    {c.prix_perdus ? <span className="text-red-600 font-semibold"> · −{c.prix_perdus} perdu{c.prix_perdus > 1 ? 's' : ''}</span> : null}
                  </span>
                  <span className={`text-sm font-extrabold tabular ${c.exactitude === 100 ? 'text-green-600' : c.exactitude >= 90 ? 'text-orange-500' : 'text-red-600'}`}>
                    {c.exactitude.toLocaleString('fr-FR')} %
                  </span>
                </div>
                {c.divergences.length > 0 && (
                  <div className="divide-y divide-gray-50">
                    {c.divergences.map((d, j) => (
                      <div key={j} className="px-4 py-1.5 flex items-center gap-3 text-[11px]">
                        <span className="flex-1 text-gray-700">{d.champ}</span>
                        <span className="text-gray-400 tabular">attendu {d.attendu ?? '—'}</span>
                        <span className="text-gray-400 tabular">relu {d.obtenu ?? '—'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
