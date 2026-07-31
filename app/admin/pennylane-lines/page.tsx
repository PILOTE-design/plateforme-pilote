'use client'

// app/admin/pennylane-lines/page.tsx — « Sonde Pennylane : lignes de facture ».
//
// Un bouton, une réponse brute. On répond ici à UNE question, avant d'écrire le
// moindre connecteur : Pennylane expose-t-il, pour chaque facture fournisseur,
// la désignation + la quantité + le prix unitaire de chaque ligne ? Si oui, la
// mercuriale se branche sur des lignes déjà extraites ET validées par le
// comptable, et la lecture IA du PDF passe en repli.
//
// La clé API n'est jamais manipulée ici : elle reste côté serveur.

import { useState } from 'react'
import { Radar, Play, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'

type Sonde = {
  facture_id: string
  fournisseur: string
  date: string | null
  montant_ht: string | number | null
  status: number
  nb_lignes: number
  champs_disponibles: string[]
  premiere_ligne: Record<string, unknown> | null
  reponse_brute?: string
}

type Reponse = {
  boutique: string
  sondes: Sonde[]
  champs_vus: string[]
  verdict: {
    lignes_disponibles: boolean
    champs_designation: string[]
    champs_quantite: string[]
    champs_prix_unitaire: string[]
    champs_montant: string[]
  }
  error?: string
  etape?: string
  reponse?: string
}

export default function PennylaneLinesProbe() {
  const [running, setRunning] = useState(false)
  const [res, setRes] = useState<Reponse | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function lancer() {
    setRunning(true); setErr(null); setRes(null)
    try {
      const r = await fetch('/api/admin/pennylane-lines', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })
      const data = await r.json()
      if (!r.ok) { setErr(data?.error ? `${data.error}${data.reponse ? ` — ${String(data.reponse).slice(0, 300)}` : ''}` : 'Échec de la sonde.'); return }
      setRes(data as Reponse)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erreur réseau.')
    } finally {
      setRunning(false)
    }
  }

  const v = res?.verdict
  const exploitable = Boolean(v?.lignes_disponibles && v.champs_designation.length > 0 && v.champs_quantite.length > 0 && v.champs_prix_unitaire.length > 0)

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <div className="mb-6 flex items-start gap-3">
        <div className="w-12 h-12 bg-gradient-to-br from-pilote to-pilote-hover rounded-2xl flex items-center justify-center flex-shrink-0 shadow-card">
          <Radar className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Sonde Pennylane — lignes de facture</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Appelle <code className="text-[11px] bg-gray-100 rounded px-1 py-0.5">GET /supplier_invoices/&#123;id&#125;/invoice_lines</code> sur trois factures réelles,
            avec la clé déjà enregistrée, et affiche la réponse brute. Objectif : savoir si Pennylane fournit
            déjà désignation, quantité et prix unitaire — auquel cas la mercuriale s&apos;appuie sur des lignes
            validées par le comptable au lieu d&apos;une lecture IA du PDF.
          </p>
        </div>
      </div>

      <button onClick={lancer} disabled={running}
        className="flex items-center gap-2 text-sm font-bold text-white bg-pilote hover:bg-pilote-hover rounded-xl px-4 py-2.5 shadow-card active:scale-[0.98] transition-all disabled:opacity-50">
        {running ? <><Loader2 className="w-4 h-4 animate-spin" />Sonde en cours…</> : <><Play className="w-4 h-4" />Lancer la sonde</>}
      </button>

      {err && (
        <div className="mt-5 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2 text-sm text-red-800">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{err}</span>
        </div>
      )}

      {res && (
        <div className="mt-6 space-y-4">
          <div className={`rounded-2xl border shadow-card p-5 ${exploitable ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
            <div className="flex items-center gap-2 mb-2">
              {exploitable ? <CheckCircle2 className="w-5 h-5 text-green-700" /> : <AlertTriangle className="w-5 h-5 text-amber-700" />}
              <p className={`text-sm font-extrabold ${exploitable ? 'text-green-900' : 'text-amber-900'}`}>
                {exploitable
                  ? 'Exploitable : désignation, quantité et prix unitaire sont présents'
                  : v?.lignes_disponibles
                    ? 'Lignes présentes, mais il manque au moins un champ nécessaire à la mercuriale'
                    : 'Aucune ligne renvoyée par Pennylane sur ces factures'}
              </p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              {([['Désignation', v?.champs_designation], ['Quantité', v?.champs_quantite], ['Prix unitaire', v?.champs_prix_unitaire], ['Montant', v?.champs_montant]] as const).map(([label, champs]) => (
                <div key={label} className="bg-white/70 rounded-xl px-3 py-2">
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">{label}</p>
                  <p className={`font-bold tabular ${champs && champs.length > 0 ? 'text-gray-900' : 'text-red-600'}`}>
                    {champs && champs.length > 0 ? champs.join(', ') : 'absent'}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-gray-500 mt-2">Boutique sondée : <strong>{res.boutique}</strong></p>
          </div>

          {res.sondes.map(s => (
            <div key={s.facture_id} className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50/80 flex items-center gap-3 flex-wrap">
                <p className="text-sm font-bold text-gray-900 flex-1 min-w-[180px]">{s.fournisseur}</p>
                <span className="text-[11px] text-gray-400 tabular">{s.date ?? '—'} · facture {s.facture_id}</span>
                <span className={`text-[11px] font-bold tabular rounded-full px-2 py-0.5 ${s.nb_lignes > 0 ? 'text-green-700 bg-green-50' : 'text-amber-700 bg-amber-50'}`}>
                  HTTP {s.status} · {s.nb_lignes} ligne{s.nb_lignes > 1 ? 's' : ''}
                </span>
              </div>
              <div className="p-4">
                {s.champs_disponibles.length > 0 && (
                  <p className="text-[11px] text-gray-500 mb-2">
                    Champs d&apos;une ligne : <span className="font-mono text-gray-700">{s.champs_disponibles.join(', ')}</span>
                  </p>
                )}
                <pre className="text-[11px] bg-gray-900 text-gray-100 rounded-xl p-3 overflow-x-auto max-h-72">
{JSON.stringify(s.premiere_ligne ?? s.reponse_brute ?? 'aucune ligne', null, 2)}
                </pre>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
