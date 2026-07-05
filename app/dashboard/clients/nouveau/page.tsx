'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function NouveauClientPage() {
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
      if (!res.ok) throw new Error(data.error)
      router.push('/dashboard/clients')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
    } finally { setLoading(false) }
  }

  const inputClass = "w-full border border-gray-400 bg-slate-50 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-[#1E3A5F]/20 focus:border-[#1E3A5F] outline-none transition-colors"

  return (
    <div className="p-8 max-w-lg mx-auto">
      <Link href="/dashboard/clients" className="text-sm text-gray-400 hover:text-gray-600 mb-6 inline-block">← Retour aux clients</Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Nouveau client</h1>
      <p className="text-gray-500 mb-8 text-sm">Les rapports seront envoyés à l&apos;email renseigné.</p>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Nom du commerce *</label>
          <input type="text" required value={form.name} onChange={set('name')} className={inputClass} placeholder="Boucherie Martin" /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
          <input type="email" required value={form.email} onChange={set('email')} className={inputClass} placeholder="contact@boucherie-martin.fr" /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Téléphone</label>
          <input type="tel" value={form.phone} onChange={set('phone')} className={inputClass} placeholder="06 12 34 56 78" /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">SIRET</label>
          <input type="text" value={form.siret} onChange={set('siret')} className={inputClass} placeholder="12345678901234" /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Adresse</label>
          <textarea value={form.address} onChange={set('address')} className={inputClass} rows={2} placeholder="12 rue de la Paix, 75001 Paris" /></div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={() => router.back()} className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm hover:bg-gray-50">Annuler</button>
          <button type="submit" disabled={loading} className="flex-1 bg-[#1E3A5F] text-white py-2 rounded-lg text-sm font-medium hover:bg-[#2a4f7c] disabled:opacity-50">
            {loading ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </div>
  )
}
