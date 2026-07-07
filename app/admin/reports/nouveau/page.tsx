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
