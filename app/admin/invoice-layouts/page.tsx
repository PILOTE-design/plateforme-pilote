'use client'

// app/admin/invoice-layouts/page.tsx — ALIMENTER la bibliothèque de mises en page.
//
// L'administrateur dépose des PDF de factures fournisseurs avec leur total HT ;
// chaque document est lu par la chaîne de production, et n'entre dans la
// bibliothèque que si la somme de ses lignes tombe sur le total AU CENTIME.
// Le total est l'arbitre : sans lui, rien n'entre — un mauvais exemple
// enseignerait activement l'erreur.
//
// Les exemples importés ici sont PARTAGÉS : ils servent toutes les boucheries.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Library, Play, Loader2, CheckCircle2, AlertTriangle, X, FileText, ClipboardPaste } from 'lucide-react'

type Statut = 'attente' | 'encours' | 'appris' | 'resiste'

type Ligne = {
  file: File
  fournisseur: string
  total: string
  statut: Statut
  detail: string
}

type Exemple = {
  id: string
  supplier_key: string
  header_signature: string
  lines_count: number
  total_ht: number | null
  shared: boolean
  updated_at: string
}

/** Fournisseur deviné depuis le nom du fichier — modifiable avant lancement. */
function fournisseurDepuisNom(nom: string): string {
  return nom.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').replace(/\b\d{5,}\b/g, '').replace(/\s+/g, ' ').trim().slice(0, 60)
}

const fmtDate = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR')
}

export default function InvoiceLayoutsPage() {
  const [lignes, setLignes] = useState<Ligne[]>([])
  const [totauxColles, setTotauxColles] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const stopRef = useRef(false)
  const [inventaire, setInventaire] = useState<{ total: number; partages: number; exemples: Exemple[] } | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const chargerInventaire = useCallback(async () => {
    const r = await fetch('/api/admin/invoice-layouts', { cache: 'no-store' }).then(x => x.ok ? x.json() : null).catch(() => null)
    if (r) setInventaire({ total: Number(r.total) || 0, partages: Number(r.partages) || 0, exemples: Array.isArray(r.exemples) ? r.exemples : [] })
  }, [])
  useEffect(() => { chargerInventaire() }, [chargerInventaire])

  function ajouterFichiers(list: FileList | null) {
    if (!list) return
    const nouveaux: Ligne[] = []
    for (const f of Array.from(list)) {
      if (!/\.pdf$/i.test(f.name)) continue
      nouveaux.push({ file: f, fournisseur: fournisseurDepuisNom(f.name), total: '', statut: 'attente', detail: '' })
    }
    // Un même fichier redéposé remplace sa ligne, il ne s'empile pas.
    setLignes(prev => [...prev.filter(l => !nouveaux.some(n => n.file.name === l.file.name)), ...nouveaux])
  }

  /** Colle « nom_de_fichier ; total » (une ligne par facture) : le dernier nombre
   *  de chaque ligne est pris pour total, et rapproché du fichier par son nom. */
  function appliquerTotaux() {
    const entrees = totauxColles.split('\n').map(l => l.trim()).filter(Boolean)
    if (entrees.length === 0) return
    setLignes(prev => prev.map(l => {
      const fichier = l.file.name.toLowerCase().replace(/\.pdf$/i, '')
      for (const e of entrees) {
        const m = e.match(/(-?\d+(?:[ .]\d{3})*(?:[.,]\d+)?)\s*€?\s*$/)
        if (!m || m.index === undefined) continue
        const nom = e.slice(0, m.index).replace(/[;,\t]+\s*$/, '').trim().toLowerCase().replace(/\.pdf$/i, '')
        if (!nom) continue
        if (fichier.includes(nom) || nom.includes(fichier)) {
          return { ...l, total: m[1].replace(/[ .](?=\d{3})/g, '').replace('.', ',') }
        }
      }
      return l
    }))
  }

  async function lancer() {
    if (running) return
    const aTraiter = lignes.filter(l => l.statut !== 'appris')
    if (aTraiter.length === 0) return
    setRunning(true)
    stopRef.current = false
    setProgress({ done: 0, total: aTraiter.length })
    let done = 0
    for (const l of aTraiter) {
      if (stopRef.current) break
      const total = parseFloat(l.total.replace(/\s/g, '').replace(',', '.'))
      if (!Number.isFinite(total) || total === 0) {
        setLignes(prev => prev.map(x => x.file.name === l.file.name
          ? { ...x, statut: 'resiste', detail: 'Total HT non renseigné — sans arbitre, rien ne peut entrer.' } : x))
        setProgress({ done: ++done, total: aTraiter.length })
        continue
      }
      setLignes(prev => prev.map(x => x.file.name === l.file.name ? { ...x, statut: 'encours', detail: '' } : x))
      const fd = new FormData()
      fd.append('file', l.file)
      fd.append('total', l.total)
      fd.append('fournisseur', l.fournisseur)
      const res = await fetch('/api/admin/invoice-layouts', { method: 'POST', body: fd }).catch(() => null)
      const data = res ? await res.json().catch(() => null) : null
      setLignes(prev => prev.map(x => {
        if (x.file.name !== l.file.name) return x
        if (res?.ok && data?.appris) {
          return {
            ...x, statut: 'appris',
            detail: `${data.lignes} lignes · ${data.prix} prix · somme ${Number(data.somme).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € = total${data.tentatives > 1 ? ` · ${data.tentatives} passes (${data.passe === 'vision' ? 'lecture image' : 'reprise'})` : ''}`,
          }
        }
        return { ...x, statut: 'resiste', detail: data?.motif || data?.error || 'Le serveur n’a pas répondu.' }
      }))
      setProgress({ done: ++done, total: aTraiter.length })
    }
    setRunning(false)
    chargerInventaire()
  }

  const appris = lignes.filter(l => l.statut === 'appris').length
  const resistes = lignes.filter(l => l.statut === 'resiste').length

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <div className="mb-6 flex items-start gap-3">
        <div className="w-12 h-12 bg-gradient-to-br from-pilote to-pilote-hover rounded-2xl flex items-center justify-center flex-shrink-0 shadow-card">
          <Library className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Bibliothèque de factures</h1>
          <p className="text-sm text-gray-500 mt-1">
            Déposez des PDF de factures fournisseurs avec leur <strong>total HT</strong>. Chaque document est lu par la
            chaîne de production et n&apos;entre dans la bibliothèque que si sa lecture boucle au centime — le total est
            l&apos;arbitre. Les exemples importés servent <strong>toutes</strong> les boucheries.
          </p>
        </div>
      </div>

      {/* Dépôt */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 text-sm font-bold text-pilote border border-pilote-200 rounded-xl px-4 py-2.5 hover:bg-pilote-50 transition-colors">
            <FileText className="w-4 h-4" />Choisir des PDF
          </button>
          <input ref={fileInputRef} type="file" accept="application/pdf" multiple className="hidden"
            onChange={e => { ajouterFichiers(e.target.files); e.target.value = '' }} />
          <p className="text-[11px] text-gray-400">
            PDF avec texte uniquement (pas de scans) · ≤ 4 Mo par fichier · le total HT figure sur la facture, recopiez-le tel quel.
          </p>
        </div>

        {lignes.length > 1 && (
          <div className="mt-4">
            <p className="text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1.5">
              <ClipboardPaste className="w-3.5 h-3.5 text-gray-400" />
              Collez vos totaux d&apos;un coup <span className="font-normal text-gray-400">— une ligne par facture : « nom du fichier ; total », le rapprochement se fait sur le nom</span>
            </p>
            <div className="flex gap-2">
              <textarea value={totauxColles} onChange={e => setTotauxColles(e.target.value)} rows={3}
                placeholder={'6110795F.pdf ; 366,36\nfacture-david-master.pdf ; 398,69'}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-pilote-200" />
              <button onClick={appliquerTotaux}
                className="self-start text-xs font-bold text-pilote border border-pilote-200 rounded-lg px-3 py-2 hover:bg-pilote-50 transition-colors">
                Remplir
              </button>
            </div>
          </div>
        )}

        {lignes.length > 0 && (
          <div className="mt-4 divide-y divide-gray-50">
            {lignes.map(l => (
              <div key={l.file.name} className="py-2 flex items-center gap-3 flex-wrap">
                {l.statut === 'appris' ? <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                  : l.statut === 'resiste' ? <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
                  : l.statut === 'encours' ? <Loader2 className="w-4 h-4 text-pilote animate-spin flex-shrink-0" />
                  : <FileText className="w-4 h-4 text-gray-300 flex-shrink-0" />}
                <p className="text-sm font-semibold text-gray-900 min-w-[160px] max-w-[240px] truncate" title={l.file.name}>{l.file.name}</p>
                <input value={l.fournisseur} disabled={running}
                  onChange={e => setLignes(prev => prev.map(x => x.file.name === l.file.name ? { ...x, fournisseur: e.target.value } : x))}
                  placeholder="Fournisseur"
                  className="w-44 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-pilote-200 disabled:opacity-50" />
                <div className="relative">
                  <input value={l.total} disabled={running} inputMode="decimal"
                    onChange={e => setLignes(prev => prev.map(x => x.file.name === l.file.name ? { ...x, total: e.target.value } : x))}
                    placeholder="Total HT"
                    className={`w-28 border rounded-lg pl-2 pr-6 py-1.5 text-xs text-right tabular focus:outline-none focus:ring-2 focus:ring-pilote-200 disabled:opacity-50 ${l.statut === 'resiste' && !l.total ? 'border-red-200 bg-red-50/40' : 'border-gray-200'}`} />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">€</span>
                </div>
                <p className={`flex-1 min-w-[200px] text-[11px] ${l.statut === 'appris' ? 'text-green-700' : l.statut === 'resiste' ? 'text-red-700' : 'text-gray-400'}`}>
                  {l.detail}
                </p>
                {!running && (
                  <button onClick={() => setLignes(prev => prev.filter(x => x.file.name !== l.file.name))}
                    className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
                )}
              </div>
            ))}
          </div>
        )}

        {lignes.length > 0 && (
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            {running ? (
              <button onClick={() => { stopRef.current = true }}
                className="flex items-center gap-2 text-sm font-bold text-white bg-pilote rounded-xl px-4 py-2.5 shadow-card">
                <Loader2 className="w-4 h-4 animate-spin" />{progress.done} / {progress.total} — Arrêter après ce fichier
              </button>
            ) : (
              <button onClick={lancer}
                className="flex items-center gap-2 text-sm font-bold text-white bg-pilote hover:bg-pilote-hover rounded-xl px-4 py-2.5 shadow-card active:scale-[0.98] transition-all">
                <Play className="w-4 h-4" />Lancer l&apos;apprentissage
              </button>
            )}
            {(appris > 0 || resistes > 0) && (
              <p className="text-xs text-gray-500 tabular">
                <span className="font-bold text-green-600">{appris} appris</span>
                {resistes > 0 && <> · <span className="font-bold text-red-600">{resistes} résisté{resistes > 1 ? 's' : ''}</span></>}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Inventaire */}
      <div className="mt-6">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h2 className="text-sm font-extrabold text-gray-900">Ce que la bibliothèque sait</h2>
          {inventaire && (
            <p className="text-[11px] text-gray-500 tabular">
              {inventaire.total} mise{inventaire.total > 1 ? 's' : ''} en page · {inventaire.partages} partagée{inventaire.partages > 1 ? 's' : ''} avec toutes les boucheries
            </p>
          )}
        </div>
        {inventaire && inventaire.exemples.length === 0 && (
          <p className="mt-2 text-xs text-gray-400">
            Vide pour l&apos;instant — elle se remplit à chaque facture bien lue en production, et par cet écran.
          </p>
        )}
        {inventaire && inventaire.exemples.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {inventaire.exemples.map(e => (
              <div key={e.id} className="bg-white rounded-2xl border border-gray-100 shadow-card px-4 py-2 flex items-center gap-3 flex-wrap">
                <p className="text-sm font-bold text-gray-900 min-w-[140px]">{e.supplier_key || '—'}</p>
                {e.shared && (
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-pilote bg-pilote-50 rounded px-1.5 py-0.5">partagé</span>
                )}
                <span className="text-xs text-gray-500 tabular">{e.lines_count} lignes{e.total_ht != null ? ` · ${Number(e.total_ht).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €` : ''}</span>
                <span className="flex-1 min-w-[160px] text-[11px] text-gray-400 truncate" title={e.header_signature}>{e.header_signature || 'sans en-tête reconnu'}</span>
                <span className="text-[11px] text-gray-400 tabular">{fmtDate(e.updated_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
