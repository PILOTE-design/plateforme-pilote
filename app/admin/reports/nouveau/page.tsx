'use client'
import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Upload, CheckCircle, Loader2, ArrowLeft, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'
import Link from 'next/link'

const FILE_INPUTS = [
  { key: 'financier_n',  label: 'Releve Financier - Semaine N (actuelle)' },
  { key: 'financier_n1', label: 'Releve Financier - Semaine N-1 (annee passee)' },
  { key: 'ventes_n',     label: 'Ventes par Familles - Semaine N' },
  { key: 'ventes_n1',   label: 'Ventes par Familles - Semaine N-1' },
]

type FileMap = Record<string, File | null>
type Client  = { id: string; name: string; email: string }

function AdminNouveauRapportForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [files, setFiles] = useState<FileMap>({
    financier_n: null, financier_n1: null, ventes_n: null, ventes_n1: null,
  })
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState('')
  const [errorDetail, setErrorDetail] = useState('')
  const [showDetail,  setShowDetail]  = useState(false)
  const [clients,     setClients]     = useState<Client[]>([])
  const [clientId,    setClientId]    = useState(searchParams.get('client') || '')
  // Porte de validation (lot V3) : quand les contrôles ne sont pas au vert, la
  // génération renvoie ici de quoi corriger avant de produire le rapport.
  const [validation,  setValidation]  = useState<any>(null)
  const [edits,       setEdits]       = useState<{ n: Record<string, string>; n1: Record<string, string> }>({ n: {}, n1: {} })

  const allSelected = Object.values(files).every(Boolean)

  useEffect(() => {
    fetch('/api/admin/clients')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setClients(data) })
      .catch(() => {})
  }, [])

  async function handleSubmit() {
    if (!allSelected || loading) return
    setLoading(true)
    setError('')
    setErrorDetail('')
    setShowDetail(false)

    const formData = new FormData()
    for (const key of Object.keys(files)) {
      const f = files[key]
      if (f) formData.append(key, f)
    }
    if (clientId) formData.append('clientId', clientId)

    try {
      const res = await fetch('/api/reports/generate', { method: 'POST', body: formData })
      const rawText = await res.text()

      if (res.ok) {
        let parsed: any = null
        try { parsed = JSON.parse(rawText) } catch {}
        // Contrôles non au vert : on n'a rien généré, on passe en validation.
        if (parsed && parsed.needs_validation) {
          setValidation(parsed)
          setEdits({ n: {}, n1: {} })
          setLoading(false)
          return
        }
        router.push(clientId ? `/admin/clients/${clientId}` : '/admin/clients')
        return
      }

      let mainError = `Erreur HTTP ${res.status}`
      let detail    = rawText

      if (res.status === 504) {
        mainError = 'Timeout (504) — generation depassee (60s max sur Vercel Hobby)'
      } else if (res.status === 403) {
        mainError = 'Non autorise (403) — vous devez etre connecte en tant qu\'admin'
      }

      try {
        const parsed = JSON.parse(rawText)
        if (parsed.error)   mainError = parsed.error
        if (parsed.details) detail    = parsed.details
      } catch {
        const stripped = rawText
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
        detail = stripped.slice(0, 2000)
      }

      setError(mainError)
      setErrorDetail(detail)
    } catch (e) {
      setError(`Erreur reseau — ${e instanceof Error ? e.message : 'connexion impossible'}`)
    } finally {
      setLoading(false)
    }
  }

  async function submitValidation() {
    if (!validation || loading) return
    setLoading(true); setError(''); setErrorDetail('')
    const overrides: { cote: 'n' | 'n1'; nom: string; montant: number }[] = []
    for (const cote of ['n', 'n1'] as const) {
      const src: { nom: string; montant: number }[] = validation[cote === 'n' ? 'familles_n' : 'familles_n1'] || []
      for (const f of src) {
        const raw = edits[cote][f.nom]
        if (raw === undefined || raw === '') continue
        const m = parseFloat(String(raw).replace(',', '.'))
        if (Number.isFinite(m) && Math.abs(m - f.montant) > 0.005) overrides.push({ cote, nom: f.nom, montant: m })
      }
    }
    try {
      const res = await fetch('/api/reports/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extraction_id: validation.extraction_id, overrides }),
      })
      const txt = await res.text()
      if (res.ok) { router.push(clientId ? `/admin/clients/${clientId}` : '/admin/clients'); return }
      let msg = `Erreur HTTP ${res.status}`
      try { const p = JSON.parse(txt); if (p.error) msg = p.error } catch {}
      setError(msg); setLoading(false)
    } catch (e) {
      setError(`Erreur reseau — ${e instanceof Error ? e.message : 'connexion impossible'}`); setLoading(false)
    }
  }

  const sommeCote = (cote: 'n' | 'n1') => {
    const src: { nom: string; montant: number }[] = validation?.[cote === 'n' ? 'familles_n' : 'familles_n1'] || []
    return src.reduce((s, f) => {
      const raw = edits[cote][f.nom]
      const m = raw !== undefined && raw !== '' ? parseFloat(String(raw).replace(',', '.')) : f.montant
      return s + (Number.isFinite(m) ? m : f.montant)
    }, 0)
  }

  return (
    <div className="p-8 max-w-2xl">
      <Link
        href="/admin/clients"
        className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Retour aux clients
      </Link>

      <h1 className="text-2xl font-bold text-gray-900 mb-1">Generer un rapport</h1>
      <p className="text-gray-500 text-sm mb-6">4 fichiers CRISALID requis — generation ~45 secondes</p>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
        {/* Client selector */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Client</label>
          <select
            value={clientId}
            onChange={e => setClientId(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#1E3A5F] outline-none bg-white"
          >
            <option value="">— Selectionner un client —</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.name} ({c.email})</option>
            ))}
          </select>
        </div>

        {/* Fichiers */}
        {FILE_INPUTS.map(({ key, label }) => (
          <div key={key}>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">{label}</label>
            <label className="flex items-center gap-3 px-4 py-3 border-2 border-dashed rounded-xl cursor-pointer hover:border-[#1E3A5F] hover:bg-blue-50/40 border-gray-200 transition-colors">
              {files[key] ? (
                <>
                  <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                  <span className="text-sm text-green-700 truncate">{(files[key] as File).name}</span>
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span className="text-sm text-gray-400">Choisir un PDF...</span>
                </>
              )}
              <input
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => setFiles(prev => ({ ...prev, [key]: e.target.files?.[0] ?? null }))}
              />
            </label>
          </div>
        ))}

        {/* Erreur */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl overflow-hidden">
            <div className="flex items-start gap-2 p-3">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 font-medium flex-1">{error}</p>
              {errorDetail && (
                <button
                  onClick={() => setShowDetail(v => !v)}
                  className="flex items-center gap-1 text-xs text-red-400 hover:text-red-600 flex-shrink-0"
                >
                  {showDetail
                    ? <><ChevronUp className="w-3 h-3" />Masquer</>
                    : <><ChevronDown className="w-3 h-3" />Details</>}
                </button>
              )}
            </div>
            {showDetail && errorDetail && (
              <div className="border-t border-red-200 p-3 bg-red-100/40">
                <pre className="text-[11px] text-red-800 whitespace-pre-wrap break-all font-mono max-h-56 overflow-y-auto">
                  {errorDetail}
                </pre>
              </div>
            )}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={!allSelected || loading || !clientId}
          className="w-full bg-[#1E3A5F] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl hover:bg-[#2a4f7c] transition-colors flex items-center justify-center gap-2"
        >
          {loading
            ? <><Loader2 className="w-4 h-4 animate-spin" />Generation en cours (~45s)...</>
            : 'Generer le rapport'
          }
        </button>
      </div>

      {/* ── Porte de validation (lot V3) : les contrôles ne sont pas au vert ── */}
      {validation && (
        <div className="mt-6 bg-white rounded-2xl border-2 border-amber-200 shadow-sm overflow-hidden">
          <div className={`px-6 py-4 ${validation.status === 'bloque' ? 'bg-red-50 border-b border-red-200' : 'bg-amber-50 border-b border-amber-200'}`}>
            <div className="flex items-center gap-2">
              <AlertCircle className={`w-5 h-5 ${validation.status === 'bloque' ? 'text-red-500' : 'text-amber-500'}`} />
              <h2 className="font-bold text-gray-900">
                {validation.status === 'bloque'
                  ? 'Rapport bloqué — un contrôle critique a échoué'
                  : 'Chiffres à vérifier avant génération'}
              </h2>
            </div>
            <p className="text-sm text-gray-600 mt-1">
              S{validation.week_number} · {validation.period_n} — le rapport n'est pas encore généré.
              {validation.status === 'bloque'
                ? ' Corrigez les fichiers en cause et relancez.'
                : ' Corrigez les montants douteux, puis validez pour générer.'}
            </p>
          </div>

          {/* Contrôles */}
          <div className="px-6 py-4 border-b border-gray-100 space-y-2">
            {(validation.checks || []).slice().sort((a: any, b: any) => (a.passe === b.passe ? 0 : a.passe ? 1 : -1)).map((c: any, i: number) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${c.passe ? 'bg-green-400' : c.severite === 'bloquant' ? 'bg-red-500' : c.severite === 'validation' ? 'bg-amber-500' : 'bg-gray-300'}`} />
                <div>
                  <span className={`font-semibold ${c.passe ? 'text-gray-400' : 'text-gray-900'}`}>{c.label}</span>
                  {!c.passe && <span className="text-gray-600"> — {c.details}</span>}
                </div>
              </div>
            ))}
          </div>

          {/* Familles éditables — uniquement quand une validation (pas un blocage) est possible */}
          {validation.status !== 'bloque' && (['n', 'n1'] as const).map((cote) => {
            const familles: { nom: string; montant: number }[] = validation[cote === 'n' ? 'familles_n' : 'familles_n1'] || []
            const caCible: number = cote === 'n' ? validation.ca_n : validation.ca_n1
            if (familles.length === 0) return null
            const somme = sommeCote(cote)
            const ecart = somme - caCible
            return (
              <div key={cote} className="px-6 py-4 border-b border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Familles {cote === 'n' ? 'semaine N' : 'semaine N-1'}</h3>
                  <span className={`text-xs font-semibold tabular ${Math.abs(ecart) < 0.5 ? 'text-green-600' : 'text-amber-600'}`}>
                    somme {somme.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € · CA {caCible.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € · écart {ecart >= 0 ? '+' : ''}{ecart.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                  </span>
                </div>
                <div className="space-y-1">
                  {familles.map((f) => (
                    <div key={f.nom} className="flex items-center gap-2">
                      <span className="flex-1 text-sm text-gray-700 truncate">{f.nom}</span>
                      <input
                        type="text" inputMode="decimal"
                        value={edits[cote][f.nom] ?? ''}
                        placeholder={f.montant.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        onChange={e => setEdits(prev => ({ ...prev, [cote]: { ...prev[cote], [f.nom]: e.target.value } }))}
                        className="w-32 border border-gray-200 rounded-lg px-2 py-1 text-sm text-right tabular focus:ring-2 focus:ring-[#1E3A5F] outline-none"
                      />
                      <span className="text-xs text-gray-400 w-4">€</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}

          <div className="px-6 py-4 flex items-center gap-3">
            {validation.status !== 'bloque' && (
              <button
                onClick={submitValidation}
                disabled={loading}
                className="bg-[#1E3A5F] disabled:opacity-40 text-white font-semibold px-5 py-2.5 rounded-xl hover:bg-[#2a4f7c] transition-colors flex items-center gap-2"
              >
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Génération...</> : 'Valider et générer le rapport'}
              </button>
            )}
            <button
              onClick={() => { setValidation(null); setError('') }}
              className="text-sm text-gray-500 hover:text-gray-700 font-medium"
            >
              {validation.status === 'bloque' ? 'Recommencer avec les bons fichiers' : 'Annuler'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function AdminNouveauRapportPage() {
  return (
    <Suspense>
      <AdminNouveauRapportForm />
    </Suspense>
  )
}
