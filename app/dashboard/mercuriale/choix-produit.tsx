'use client'

/**
 * CHOISIR UN PRODUIT DU CATALOGUE — n'importe lequel, en le cherchant.
 *
 * ─── LE DÉFAUT ────────────────────────────────────────────────────────────
 *
 * Associer une réf passait par un `<select>` natif qui listait le catalogue
 * ENTIER, sans recherche. Le champ de recherche de la page, juste au-dessus,
 * ne le touchait pas. À 125 produits on s'en accommode ; à 500, retrouver
 * « Épaule d'agneau » dans un menu déroulant relève de la patience.
 *
 * Et quand rien n'était suggéré, le bouton du groupe ne proposait qu'une seule
 * issue : CRÉER un générique de plus. C'est ainsi qu'un catalogue enfle — non
 * pas parce que le boucher veut deux fiches pour le même produit, mais parce
 * que l'écran ne lui offrait pas de viser celle qui existe déjà.
 *
 * ─── ET UN SECOND, PLUS SOURNOIS ──────────────────────────────────────────
 *
 * Ces menus déroulants étaient dessinés d'avance, en entier, PAR générique et
 * PAR réf dans l'onglet « Organiser ». Avec G produits et R réfs, cela fait de
 * l'ordre de G² + R×G éléments dans la page : à 500 produits et 1 500 réfs,
 * environ un million de nœuds. Le navigateur rendait la page inutilisable
 * BIEN avant que le moindre plafond serveur soit atteint.
 *
 * Ici, rien n'est dessiné tant que la liste est fermée, et une fois ouverte on
 * ne dessine que ce qui correspond à la recherche — en disant combien de
 * produits ne sont pas montrés.
 */

import { useState, useMemo, useRef, useEffect } from 'react'
import { Search, ChevronDown, X, Check } from 'lucide-react'

export type ProduitChoisissable = {
  id: string
  name: string
  base_unit?: string | null
}

/** Nombre de lignes dessinées à la fois. Le reste est ANNONCÉ, pas caché. */
const LIGNES_VISIBLES = 40

/**
 * Normalisation de recherche : sans accents, sans casse, sans ponctuation.
 *
 * Les LIGATURES d'abord. `œ` n'est pas un `o` suivi d'un accent : c'est un
 * caractère à part entière, que `normalize('NFD')` laisse intact. Sans cette
 * ligne, taper « boeuf » ne trouvait pas « Côte de bœuf » — le mot le plus
 * courant du métier, invisible à la recherche la plus naturelle.
 */
function norm(s: unknown): string {
  return String(s ?? '')
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Les produits qui correspondent à la recherche.
 *
 * Tous les mots tapés doivent se retrouver dans le libellé, dans n'importe quel
 * ordre : « agneau epaule » trouve « Épaule d'agneau ». Chercher la chaîne
 * entière obligerait à taper les mots dans l'ordre exact du catalogue, ce que
 * personne ne connaît par cœur.
 */
export function filtrerProduits<T extends ProduitChoisissable>(produits: T[], recherche: string): T[] {
  const mots = norm(recherche).split(' ').filter(Boolean)
  if (mots.length === 0) return produits
  return produits.filter(p => {
    const cible = norm(p.name)
    return mots.every(m => cible.includes(m))
  })
}

type Props = {
  produits: ProduitChoisissable[]
  /** Identifiant choisi, `'new'` pour « créer », `''` pour rien. */
  value: string
  onChange: (v: string) => void
  /** Propose « Créer un nouvel article générique » en tête de liste. */
  creation?: { libelle: string } | null
  placeholder?: string
  /** Libellé de l'unité, pour situer le produit (kg / pièce). Typé LARGE côté
   *  appelant (`unitLabel` ne connaît que 'kg' et 'piece') : ce composant ne
   *  doit pas imposer sa signature aux fonctions d'affichage existantes. */
  unite?: (u: never) => string
  className?: string
}

export default function ChoixProduit({
  produits, value, onChange, creation = null,
  placeholder = 'Chercher un produit…', unite, className = '',
}: Props) {
  const [ouvert, setOuvert] = useState(false)
  const [recherche, setRecherche] = useState('')
  const boite = useRef<HTMLDivElement | null>(null)
  const champ = useRef<HTMLInputElement | null>(null)

  // Fermer au clic ailleurs : une liste ouverte qui reste ouverte cache le
  // reste de l'écran, et sur cette page l'écran EST le travail.
  useEffect(() => {
    if (!ouvert) return
    const dehors = (e: MouseEvent) => {
      if (boite.current && !boite.current.contains(e.target as Node)) setOuvert(false)
    }
    document.addEventListener('mousedown', dehors)
    return () => document.removeEventListener('mousedown', dehors)
  }, [ouvert])

  useEffect(() => { if (ouvert) champ.current?.focus() }, [ouvert])

  const trouves = useMemo(() => filtrerProduits(produits, recherche), [produits, recherche])
  const montres = trouves.slice(0, LIGNES_VISIBLES)
  const caches = trouves.length - montres.length

  const choisi = value === 'new'
    ? (creation?.libelle ?? 'Nouvel article')
    : produits.find(p => p.id === value)?.name ?? ''

  return (
    <div ref={boite} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOuvert(o => !o)}
        className="w-full flex items-center justify-between gap-2 border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white text-left hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-pilote-200"
      >
        <span className={choisi ? 'text-gray-900 truncate' : 'text-gray-400'}>
          {choisi || '— Choisir —'}
        </span>
        <ChevronDown className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${ouvert ? 'rotate-180' : ''}`} />
      </button>

      {ouvert && (
        <div className="absolute z-50 mt-1 w-full bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
            <Search className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
            <input
              ref={champ}
              value={recherche}
              onChange={e => setRecherche(e.target.value)}
              placeholder={placeholder}
              className="flex-1 text-sm bg-transparent focus:outline-none"
            />
            {recherche && (
              <button type="button" onClick={() => setRecherche('')} className="text-gray-300 hover:text-gray-500">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="max-h-64 overflow-y-auto py-1">
            {creation && (
              <button
                type="button"
                onClick={() => { onChange('new'); setOuvert(false) }}
                className={`w-full text-left px-3 py-2 text-sm font-semibold hover:bg-pilote-50 ${value === 'new' ? 'text-pilote bg-pilote-50' : 'text-pilote'}`}
              >
                + {creation.libelle}
              </button>
            )}

            {montres.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => { onChange(p.id); setOuvert(false) }}
                className={`w-full flex items-center justify-between gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50 ${p.id === value ? 'bg-gray-50 font-semibold text-gray-900' : 'text-gray-700'}`}
              >
                <span className="truncate">{p.name}</span>
                <span className="flex items-center gap-1.5 flex-shrink-0">
                  {unite && <span className="text-[11px] text-gray-400">/ {unite(p.base_unit as never)}</span>}
                  {p.id === value && <Check className="w-3.5 h-3.5 text-pilote" />}
                </span>
              </button>
            ))}

            {/* Ce qui n'est pas dessiné se DIT. Une liste tronquée en silence,
                c'est un produit qu'on croit absent du catalogue. */}
            {caches > 0 && (
              <p className="px-3 py-2 text-[11px] text-gray-400 border-t border-gray-50">
                {caches} autre{caches > 1 ? 's' : ''} produit{caches > 1 ? 's' : ''} correspond{caches > 1 ? 'ent' : ''} —
                précisez la recherche pour {caches > 1 ? 'les' : 'le'} voir.
              </p>
            )}

            {trouves.length === 0 && (
              <p className="px-3 py-3 text-sm text-gray-400">
                Aucun produit ne correspond{creation ? ' — vous pouvez en créer un ci-dessus.' : '.'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
