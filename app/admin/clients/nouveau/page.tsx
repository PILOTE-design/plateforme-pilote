'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default function AdminNouveauClientPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', email: '', phone: '', siret: '', address: '' })

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/clients', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur lors de la création')
      router.push('/admin/clients')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
      setLoading(false)
    }
  }

  const inputClass = "w-full border border-gray-200 bg-white rounded-xl px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-pilote focus:border-pilote outline-none transition-colors"

  return (
    <div className="p-8 max-w-lg">
      <Link
        href="/admin/clients"
        className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Retour aux clients
      </Link>

      <h1 className="text-2xl font-bold text-gray-900 mb-1">Nouveau client</h1>
      <p className="text-gray-500 text-sm mb-6">Les rapports seront envoyés à l&apos;email renseigné.</p>

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Nom du commerce *</label>
          <input type="text" required value={form.name} onChange={set('name')} className={inputClass} placeholder="Boucherie Martin" />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Email *</label>
          <input type="email" required value={form.email} onChange={set('email')} className={inputClass} placeholder="contact@boucherie-martin.fr" />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Téléphone</label>
          <input type="tel" value={form.phone} onChange={set('phone')} className={inputClass} placeholder="06 12 34 56 78" />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">SIRET</label>
          <input type="text" value={form.siret} onChange={set('siret')} className={inputClass} placeholder="12345678901234" />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Adresse</label>
          <textarea value={form.address} onChange={set('address')} className={inputClass} rows={2} placeholder="12 rue de la Paix, 75001 Paris" />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={() => router.push('/admin/clients')}
            className="flex-1 border border-gray-200 text-gray-700 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 bg-pilote text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-pilote-hover transition-colors disabled:opacity-50"
          >
            {loading ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </div>
  )
}
