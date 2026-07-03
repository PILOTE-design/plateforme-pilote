'use client'
import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Upload, CheckCircle, Loader2, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

const FILE_INPUTS = [
  { key: 'financier_n', label: 'Relevé Financier — Semaine N (actuelle)' },
  { key: 'financier_n1', label: 'Relevé Financier — Semaine N-1 (même semaine année passée)' },
  { key: 'ventes_n', label: 'Ventes par Familles — Semaine N' },
  { key: 'ventes_n1', label: 'Ventes par Familles — Semaine N-1' },
]

type FileMap = Record<string, File | null>
type Client = { id: string; name: string; email: string }

function AdminNouveauRapportForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [files, setFiles] = useState<FileMap>({ financier_n: null, financier_n1: null, ventes_n: null, ventes_n1: null })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [clients, setClients] = useState<Client[]>([])
  const [clientId, setClientId] = useState(searchParams.get('client') || '')
  const allSelected = Object.values(files).every(Boolean)

  useEffect(() => {
    fetch('/api/clients').then(r => r.json()).then(data => {
      if (Array.isArray(data)) setClients(data)
    })
  }, [])

  async function handleSubmit() {
    if (!allSelected || loading) return
    setLoading(true); setError('')
    const formData = new FormData()
    for (const key of Object.keys(files)) {
      const f = files[key]
      if (f) formData.append(key, f)
    }
    if (clientId) formData.append('clientId', clientId)
    try {
      const res = await fetch('/api/reports/generate', { method: 'POST', body: formData })
      const data = await res.json()
      if (res.ok) {
        // Redirect to client detail page if a client was selected
        if (clientId) router.push(`/admin/clients/${clientId}`)
        else router.push('/admin/clients')
      } else {
        setError(data.error || 'Erreur lors de la génération')
        setLoading(false)
      }
    } catch {
      setError('Erreur réseau.')
      setLoading(false)
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <Link href="/admin/clients" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 mb-5 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Retour aux clients
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Générer un rapport</h1>
        <p className="text-gray-500 mt-1">Déposez les 4 fichiers CRISALID pour générer l'analyse</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Fichiers CRISALID</CardTitle>
          <CardDescription>Format PDF uniquement · Génération ~45 secondes</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Client selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Client</label>
            <select
              value={clientId}
              onChange={e => setClientId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
            >
              <option value="">— Sélectionner un client —</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.email})</option>
              ))}
            </select>
          </div>

          {/* File uploads */}
          {FILE_INPUTS.map(({ key, label }) => (
            <div key={key}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
              <label className="flex items-center gap-3 px-4 py-3 border-2 border-dashed rounded-lg cursor-pointer hover:border-blue-400 hover:bg-blue-50 border-gray-200 transition-colors">
                {files[key] ? (
                  <><CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" /><span className="text-sm text-green-700">{(files[key] as File).name}</span></>
                ) : (
                  <><Upload className="w-4 h-4 text-gray-400 flex-shrink-0" /><span className="text-sm text-gray-400">Choisir un PDF...</span></>
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

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 p-3 rounded-lg">
              {error}
            </div>
          )}

          <Button
            onClick={handleSubmit}
            disabled={!allSelected || loading}
            className="w-full mt-2"
          >
            {loading
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Génération en cours (~45s)...</>
              : 'Générer le rapport'
            }
          </Button>
        </CardContent>
      </Card>
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
