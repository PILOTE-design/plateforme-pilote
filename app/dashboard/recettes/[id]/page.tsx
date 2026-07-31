'use client'

// Fiche recette en pleine page (lien direct /dashboard/recettes/<id>) — le
// CONTENU vit dans le composant partagé FichePanel, aussi affiché en encadré
// directement sur la liste (navigation instantanée). Ici, « Modifier la
// fiche » renvoie vers la liste avec ?edit=<id> (modale complète).

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChefHat, ArrowLeft } from 'lucide-react'
import FichePanel, { type FicheRecipe, type FicheEmployee, type FicheGeneric } from '../fiche-panel'

export default function FicheRecettePage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const [recipe, setRecipe] = useState<FicheRecipe | null>(null)
  const [employees, setEmployees] = useState<FicheEmployee[]>([])
  const [generics, setGenerics] = useState<FicheGeneric[]>([])
  const [target, setTarget] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  // UNE fiche, une route dédiée. Avant : on demandait la LISTE puis on y
  // cherchait la sienne — ce qui faisait calculer le coût de toutes les fiches
  // et relire le coût matière de chacune à neuf jalons, à chaque ouverture ET
  // après chaque étape, palier ou ingrédient enregistré depuis le panneau.
  const load = useCallback(async () => {
    const data = await fetch(`/api/recipes/${params.id}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null)
    setRecipe((data?.recipe ?? null) as FicheRecipe | null)
    setEmployees(Array.isArray(data?.employees) ? data.employees : [])
    setGenerics(Array.isArray(data?.generics) ? data.generics : [])
    setTarget(data?.target != null ? Number(data.target) : null)
    setLoading(false)
  }, [params.id])
  useEffect(() => { load() }, [load])

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      <div className="mb-4">
        <Link href="/dashboard/recettes" className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-pilote transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" />Toutes les fiches recettes
        </Link>
      </div>
      {loading ? (
        <div className="h-96 bg-gray-100 rounded-2xl animate-pulse" />
      ) : !recipe ? (
        <div className="bg-white rounded-2xl border border-dashed border-gray-200 py-16 text-center">
          <ChefHat className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-500 mb-3">Fiche introuvable</p>
          <Link href="/dashboard/recettes" className="text-sm text-pilote font-semibold hover:underline">← Retour aux fiches recettes</Link>
        </div>
      ) : (
        <FichePanel
          key={recipe.id}
          recipe={recipe}
          employees={employees}
          generics={generics}
          target={target}
          onEditFull={() => router.push(`/dashboard/recettes?edit=${recipe.id}`)}
          onSaved={load}
        />
      )}
    </div>
  )
}
