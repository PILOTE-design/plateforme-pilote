'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CheckCircle } from 'lucide-react'

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    businessName: '',
    city: '',
    deliveryEmail: '',
    googleDriveFolder: '',
  })

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const res = await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })

    if (!res.ok) {
      const data = await res.json()
      setError(data.error || 'Une erreur est survenue.')
      setLoading(false)
      return
    }

    setStep(3)
  }

  if (step === 3) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-3">Tout est prêt !</h1>
          <p className="text-gray-500 mb-8">
            Votre espace est configuré. Vous recevrez votre première analyse la semaine prochaine.
            Un email de confirmation vient d&apos;être envoyé à <strong>{form.deliveryEmail}</strong>.
          </p>
          <Button onClick={() => router.push('/dashboard')} size="lg">
            Accéder à mon espace
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <span className="text-2xl font-bold text-blue-600">PILOTE</span>
          <div className="flex items-center justify-center gap-2 mt-4">
            <div className={`h-2 w-16 rounded-full ${step >= 1 ? 'bg-blue-600' : 'bg-gray-200'}`} />
            <div className={`h-2 w-16 rounded-full ${step >= 2 ? 'bg-blue-600' : 'bg-gray-200'}`} />
          </div>
          <p className="text-sm text-gray-500 mt-2">Étape {step} sur 2</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              {step === 1 ? 'Votre commerce' : 'Livraison des rapports'}
            </CardTitle>
            <CardDescription>
              {step === 1
                ? 'Quelques informations sur votre activité'
                : 'Où souhaitez-vous recevoir vos analyses ?'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={step === 1 ? (e) => { e.preventDefault(); setStep(2) } : handleSubmit} className="space-y-4">
              {step === 1 && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="businessName">Nom de votre commerce *</Label>
                    <Input
                      id="businessName"
                      value={form.businessName}
                      onChange={(e) => update('businessName', e.target.value)}
                      placeholder="Boucherie Dupont"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="city">Ville *</Label>
                    <Input
                      id="city"
                      value={form.city}
                      onChange={(e) => update('city', e.target.value)}
                      placeholder="Lyon"
                      required
                    />
                  </div>
                </>
              )}

              {step === 2 && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="deliveryEmail">Email de livraison des rapports *</Label>
                    <Input
                      id="deliveryEmail"
                      type="email"
                      value={form.deliveryEmail}
                      onChange={(e) => update('deliveryEmail', e.target.value)}
                      placeholder="vous@exemple.fr"
                      required
                    />
                    <p className="text-xs text-gray-400">Les rapports seront envoyés à cette adresse chaque semaine</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="googleDriveFolder">Dossier Google Drive (optionnel)</Label>
                    <Input
                      id="googleDriveFolder"
                      value={form.googleDriveFolder}
                      onChange={(e) => update('googleDriveFolder', e.target.value)}
                      placeholder="https://drive.google.com/drive/folders/..."
                    />
                    <p className="text-xs text-gray-400">Si renseigné, les rapports seront aussi déposés dans ce dossier</p>
                  </div>
                </>
              )}

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex gap-3">
                {step === 2 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep(1)}
                    className="flex-1"
                  >
                    Retour
                  </Button>
                )}
                <Button type="submit" className="flex-1" disabled={loading}>
                  {step === 1 ? 'Continuer' : loading ? 'Enregistrement...' : 'Terminer'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
