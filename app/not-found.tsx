import Link from 'next/link'
import { Compass, ArrowLeft } from 'lucide-react'

// Page 404 brandée
export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-card max-w-md w-full p-8 text-center">
        <p className="text-[15px] font-extrabold tracking-[0.22em] text-pilote select-none mb-6">
          PILOTE<span className="text-pilote-orange">.</span>
        </p>
        <div className="w-12 h-12 rounded-xl bg-pilote-50 flex items-center justify-center mx-auto mb-4">
          <Compass className="w-6 h-6 text-pilote" />
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Erreur 404</p>
        <h1 className="text-lg font-bold text-gray-900 mb-2">Cette page n&apos;existe pas</h1>
        <p className="text-sm text-gray-500 leading-relaxed mb-6">
          Le lien est peut-être périmé, ou la page a été déplacée.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 border border-gray-200 text-gray-700 text-sm font-medium px-4 h-10 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Accueil
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 bg-pilote hover:bg-pilote-hover text-white text-sm font-semibold px-5 h-10 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Tableau de bord
          </Link>
        </div>
      </div>
    </div>
  )
}
