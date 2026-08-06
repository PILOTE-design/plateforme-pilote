'use client'

// ─── LE RETOUR AU PLANNING, DEPUIS LA PAIE ──────────────────────────────────
//
// La bascule vit dans la rangée d'onglets de la grille (« Employés · Postes ·
// Préparation des payes ») : c'est là que le boucher regarde déjà, et non dans
// un sélecteur discret posé au-dessus du titre — celui-là, il ne l'a pas vu.
//
// Ce composant est le pendant, côté paie : la même rangée, au même endroit, à
// la même hauteur, avec les mêmes libellés. Un chemin qu'on ne peut pas faire
// dans les deux sens n'est pas un chemin.
//
// Les deux premiers boutons ramènent au planning ; la vue « Postes » s'y
// rouvrira sur les employés, faute de mémoire de la lecture choisie — c'est
// assumé, et c'est pour ça qu'ils partagent un seul libellé de destination.

import Link from 'next/link'
import { CalendarDays, FileSpreadsheet } from 'lucide-react'

export default function OngletsPlanning() {
  return (
    <div className="mb-3 inline-flex items-center gap-1 bg-gray-100 rounded-xl p-1">
      <Link
        href="/dashboard/planning"
        title="Revenir à la grille de la semaine"
        className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 text-gray-500 hover:text-gray-700 transition-colors"
      >
        <CalendarDays className="w-3.5 h-3.5" />
        Planning
      </Link>
      <span className="w-px h-4 bg-gray-300 mx-1" aria-hidden />
      <span
        aria-current="page"
        className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 bg-white text-pilote shadow-card"
      >
        <FileSpreadsheet className="w-3.5 h-3.5" />
        Préparation des payes
      </span>
    </div>
  )
}
