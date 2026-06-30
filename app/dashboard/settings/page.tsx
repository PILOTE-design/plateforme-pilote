'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ExternalLink } from 'lucide-react'
import type { Profile } from '@/types'

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [form, setForm] = useState({ businessName: '', city: '', deliveryEmail: '', googleDriveFolder: '' })
  const [saving, setSaving] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (data) {
        setProfile(data)
        setForm({
          businessName: data.business_name || '',
          city: data.city || '',
          deliveryEmail: data.delivery_email || '',
          googleDriveFolder: data.google_drive_folder || '',
        })
      }
    }
    load()
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage('')

    const res = await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })

    setSaving(false)
    if (res.ok) {
      setMessage('Informations mises à jour avec succès.')
    } else {
      setMessage('Erreur lors de la sauvegarde.')
    }
  }

  async function handlePortal() {
    setPortalLoading(true)
    const res = await fetch('/api/stripe/portal', { method: 'POST' })
    const data = await res.json()
    if (data.url) window.location.href = data.url
    else setPortalLoading(false)
  }

  return (
    <div className="p-8 max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Paramètres</h1>
        <p className="text-gray-500 mt-1">Gérez votre compte et votre abonnement</p>
      </div>

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle>Informations du commerce</CardTitle>
          <CardDescription>Ces informations apparaissent sur vos rapports</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="businessName">Nom du commerce</Label>
              <Input
                id="businessName"
                value={form.businessName}
                onChange={(e) => setForm({ ...form, businessName: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">Ville</Label>
              <Input
                id="city"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="deliveryEmail">Email de livraison</Label>
              <Input
                id="deliveryEmail"
                type="email"
                value={form.deliveryEmail}
                onChange={(e) => setForm({ ...form, deliveryEmail: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="googleDriveFolder">Dossier Google Drive (optionnel)</Label>
              <Input
                id="googleDriveFolder"
                value={form.googleDriveFolder}
                onChange={(e) => setForm({ ...form, googleDriveFolder: e.target.value })}
                placeholder="https://drive.google.com/drive/folders/..."
              />
            </div>
            {message && (
              <p className={`text-sm ${message.includes('Erreur') ? 'text-red-600' : 'text-green-600'}`}>
                {message}
              </p>
            )}
            <Button type="submit" disabled={saving}>
              {saving ? 'Enregistrement...' : 'Sauvegarder les modifications'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Subscription */}
      <Card>
        <CardHeader>
          <CardTitle>Abonnement</CardTitle>
          <CardDescription>Gérez votre abonnement PILOTE</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700">Statut</span>
            {profile?.subscription_status === 'active' ? (
              <Badge variant="success">Actif</Badge>
            ) : profile?.subscription_status === 'canceled' ? (
              <Badge variant="destructive">Résilié</Badge>
            ) : profile?.subscription_status ? (
              <Badge variant="warning">{profile.subscription_status}</Badge>
            ) : (
              <Badge variant="secondary">Non activé</Badge>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700">Montant</span>
            <span className="text-sm font-medium">149€/mois HT</span>
          </div>
          <Button
            variant="outline"
            onClick={handlePortal}
            disabled={portalLoading || !profile?.stripe_customer_id}
            className="w-full"
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            {portalLoading ? 'Redirection...' : 'Gérer mon abonnement (facturation, résiliation)'}
          </Button>
          <p className="text-xs text-gray-400 text-center">
            Vous serez redirigé vers le portail Stripe sécurisé. Résiliation sans engagement possible.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
