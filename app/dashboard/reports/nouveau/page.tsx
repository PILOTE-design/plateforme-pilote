'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Upload, CheckCircle, Loader2 } from 'lucide-react'

const FILE_INPUTS = [
  { key: 'financier_n',  label: 'Releve Financier - Semaine N (actuelle)' },
  { key: 'financier_n1', label: 'Releve Financier - Semaine N-1 (meme semaine an passe)' },
  { key: 'ventes_n',     label: 'Ventes par Familles - Semaine N' },
  { key: 'ventes_n1',    label: 'Ventes par Familles - Semaine N-1' },
]

type FileMap = Record<string, File | null>

export default function NouveauRapportPage() {
  const router = useRouter()
  const [files, setFiles] = useState<FileMap>({ financier_n: null, financier_n1: null, ventes_n: null, ventes_n1: null })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const allSelected = Object.values(files).every(Boolean)

  async function handleSubmit() {
    if (!allSelected || loading) return
    setLoading(true); setError('')
    const formData = new FormData()
    for (const key of Object.keys(files)) {
      const f = files[key]
      if (f) formData.append(key, f)
    }
    try {
      const res = await fetch('/api/reports/generate', { method: 'POST', body: formData })
      const data = await res.json()
      if (res.ok) router.push('/dashboard/reports')
      else { setError(data.error || 'Erreur'); setLoading(false) }
    } catch { setError('Erreur reseau.'); setLoading(false) }
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Nouveau rapport</h1>
        <p className="text-gray-500 mt-1">Deposez les 4 fichiers CRISALID pour generer votre analyse</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Fichiers CRISALID</CardTitle><CardDescription>Format PDF uniquement</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {FILE_INPUTS.map(({ key, label }) => (
            <div key={key}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
              <label className="flex items-center gap-3 px-4 py-3 border-2 border-dashed rounded-lg cursor-pointer hover:border-blue-400 hover:bg-blue-50 border-gray-200">
                {files[key] ? (
                  <><CheckCircle className="w-4 h-4 text-green-500" /><span className="text-sm text-green-700">{(files[key] as File).name}</span></>
                ) : (
                  <><Upload className="w-4 h-4 text-gray-400" /><span className="text-sm text-gray-400">Choisir un PDF...</span></>
                )}
                <input type="file" accept=".pdf" className="hidden"
                  onChange={(e) => setFiles(prev => ({ ...prev, [key]: e.target.files?.[0] ?? null }))} />
              </label>
            </div>
          ))}
          {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</p>}
          <Button onClick={handleSubmit} disabled={!allSelected || loading} className="w-full mt-2">
            {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generation en cours (~45s)...</> : 'Generer le rapport'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
