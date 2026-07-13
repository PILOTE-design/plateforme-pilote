'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useToast } from '@/components/ui/toast'

type Client = {
  id: string
  name: string
  email: string
  client_user_id: string | null
  invited_at: string | null
}

export default function ClientsList({ clients: initial }: { clients: Client[] }) {
  const [clients, setClients] = useState(initial)
  const [loading, setLoading] = useState<string | null>(null)
  const { toast } = useToast()

  async function handleInvite(clientId: string) {
    setLoading(clientId)
    try {
      const res = await fetch(`/api/clients/${clientId}/invite`, { method: 'POST' })
      if (res.ok) {
        setClients(prev =>
          prev.map(c => c.id === clientId ? { ...c, invited_at: new Date().toISOString() } : c)
        )
      } else {
        const data = await res.json()
        toast({ variant: 'error', title: "Envoi de l'invitation impossible", description: data.error })
      }
    } finally {
      setLoading(null)
    }
  }

  function getBadge(client: Client) {
    if (client.client_user_id) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
          Inscrit
        </span>
      )
    }
    if (client.invited_at) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
          Invitation envoyée
        </span>
      )
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
        Non inscrit
      </span>
    )
  }

  return (
    <div className="space-y-3">
      {clients.map(client => (
        <div key={client.id} className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-3">
          <div className="flex items-center gap-3">
            <div>
              <p className="text-sm font-medium text-gray-900">{client.name}</p>
              <p className="text-xs text-gray-500">{client.email}</p>
            </div>
            {getBadge(client)}
          </div>
          <div className="flex items-center gap-2">
            {!client.client_user_id && (
              <button
                onClick={() => handleInvite(client.id)}
                disabled={loading === client.id || !!client.invited_at}
                className="text-xs px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading === client.id ? 'Envoi...' : client.invited_at ? 'Invité' : 'Inviter'}
              </button>
            )}
            <Link
              href={`/dashboard/reports/nouveau?client=${client.id}`}
              className="text-xs px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Générer rapport
            </Link>
          </div>
        </div>
      ))}
      {clients.length === 0 && (
        <p className="text-sm text-gray-500 text-center py-8">Aucun client pour l&apos;instant.</p>
      )}
    </div>
  )
}
