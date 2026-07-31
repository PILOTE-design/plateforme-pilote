'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Eye, EyeOff } from 'lucide-react'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [ready, setReady] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const supabase = createClient()

    async function init() {
      const tokenHash = new URLSearchParams(window.location.search).get('token_hash')

      // Nouveau flux « maison » : le lien reçu par email porte un token_hash de
      // récupération. On l'échange contre une session ICI (verifyOtp), sans jamais
      // dépendre du redirect_to / de la Site URL de Supabase.
      if (tokenHash) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
        if (!error) {
          setReady(true)
          setChecking(false)
          return
        }
        // Jeton déjà consommé (rafraîchissement de la page) mais session encore
        // active → on laisse continuer plutôt que d'afficher « lien expiré » à tort.
        const { data } = await supabase.auth.getSession()
        setReady(!!data.session)
        setChecking(false)
        return
      }

      // Repli : ancien lien passé par /auth/callback (session déjà posée).
      const { data } = await supabase.auth.getSession()
      setReady(!!data.session)
      setChecking(false)
    }

    init()
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setReady(true)
        setChecking(false)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères.')
      return
    }
    if (password !== confirm) {
      setError('Les deux mots de passe ne correspondent pas.')
      return
    }

    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setError("Impossible de mettre à jour le mot de passe. Le lien a peut-être expiré.")
      setLoading(false)
      return
    }

    await supabase.auth.signOut()
    router.push('/login?message=Mot+de+passe+mis+à+jour,+vous+pouvez+vous+connecter')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="text-2xl font-bold text-blue-600">PILOTE</Link>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Nouveau mot de passe</CardTitle>
            <CardDescription>Choisissez un nouveau mot de passe pour votre compte.</CardDescription>
          </CardHeader>
          <CardContent>
            {checking ? (
              <p className="text-sm text-gray-500 py-4 text-center">Vérification du lien...</p>
            ) : !ready ? (
              <div className="py-4 text-center">
                <p className="text-sm text-red-600 mb-3">
                  Lien invalide ou expiré. Ouvrez le lien depuis l&apos;email le plus récent, ou refaites une demande.
                </p>
                <Link href="/forgot-password" className="text-sm text-blue-600 hover:underline">
                  Refaire une demande
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">Nouveau mot de passe</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="8 caractères minimum"
                      required
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm">Confirmer le mot de passe</Label>
                  <Input
                    id="confirm"
                    type={showPassword ? 'text' : 'password'}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                  />
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Mise à jour...' : 'Mettre à jour le mot de passe'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
