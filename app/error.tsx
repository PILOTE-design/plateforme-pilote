'use client'

import { AlertTriangle, RotateCcw, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

// Page d'erreur brandée — remplace l'écran Next.js par défaut.
// `reset` relance le rendu du segment qui a échoué.
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-card max-w-md w-full p-8 text-center">
        <p className="text-[15px] font-extrabold tracking-[0.22em] text-pilote select-none mb-6">
          PILOTE<span className="text-pilote-orange">.</span>
        </p>
        <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-6 h-6 text-red-500" />
        </div>
        <h1 className="text-lg font-bold text-gray-900 mb-2">Une erreur est survenue</h1>
        <p className="text-sm text-gray-500 leading-relaxed mb-6">
          L&apos;action n&apos;a pas pu aboutir. Réessayez — si le problème persiste,
          vos données ne sont pas affectées, contactez-nous.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 border border-gray-200 text-gray-700 text-sm font-medium px-4 h-10 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Tableau de bord
          </Link>
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 bg-pilote hover:bg-pilote-hover text-white text-sm font-semibold px-5 h-10 rounded-lg transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Réessayer
          </button>
        </div>
        {error?.digest && (
          <p className="text-[10px] text-gray-300 mt-6">Référence : {error.digest}</p>
        )}
      </div>
    </div>
  )
}
