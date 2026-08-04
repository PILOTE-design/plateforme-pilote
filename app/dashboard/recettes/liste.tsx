'use client'

// La LISTE des fiches recettes, en tableau — le DESSIN seulement.
//
// Même partage des rôles que la mercuriale (page.tsx garde la logique, ce
// fichier garde le dessin), et mêmes partis pris de lecture qu'Otami, relevés
// en lecture seule sur sa page « Recettes (Coûts de revient) » :
//
//   · la DOUBLE lecture d'une marge — coefficient ET pourcentage, chacun dans
//     sa pastille, avec la CIBLE de la boutique rappelée dans l'en-tête de
//     colonne : on voit si la ligne est au-dessus ou en dessous sans calcul ;
//   · la FLÈCHE de tendance collée au coût — le sens du mouvement se lit avant
//     la valeur ;
//   · les CHIPS de catégorie dans leur propre colonne, pas fondues dans le nom ;
//   · le SOUS-TITRE en italique sous le nom ;
//   · des en-têtes TRIABLES dont l'icône de tri est visible en permanence, pas
//     au survol.
//
// Ce qui n'est PAS repris d'Otami : sa palette verte, ses icônes en bout de
// ligne. PILOTE reste navy/orange et révèle ses actions au survol.

import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight } from 'lucide-react'
import { venteQty, margeEtCoef } from '@/lib/recipes'

export type ListeCost = {
  matiere_ht: number
  emballage_ht: number
  main_oeuvre_ht: number
  total_ht: number
  par_unite_ht: number | null
  par_unite_vente_ht?: number | null
  prix_manquants: number
  total_minutes: number
  pv_unitaire_ht: number | null
  marge_pct: number | null
  coefficient: number | null
  /** Coût matière du batch relu aux prix des 8 dernières semaines — la tendance */
  matiere_series?: { d: string; v: number }[]
}

export type ListeRecipe = {
  id: string
  name: string
  category: string | null
  yield_qty: number | null
  yield_unit: string | null
  sell_unit?: string | null
  sell_qty?: number | null
  selling_price_ttc: number | null
  labor_minutes: number
  cost: ListeCost
}

export type SortKey = 'nom' | 'cout' | 'marge' | 'pv' | 'temps'
export type SortState = { key: SortKey; dir: 'asc' | 'desc' }

const round2 = (n: number) => Math.round(n * 100) / 100
const fmtEuro = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const fmtQty = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 3 })

/** 45 → « 45 min » ; 90 → « 1 h 30 » */
export function fmtMin(m: number): string {
  const r = Math.round(m)
  if (r <= 0) return '—'
  if (r < 60) return `${r.toLocaleString('fr-FR')} min`
  return `${Math.floor(r / 60)} h ${String(r % 60).padStart(2, '0')}`
}

/** L'unité dans laquelle la fiche se VEND (celle que regarde le prix de vente) */
export const uniteVente = (r: ListeRecipe) => r.sell_unit || r.yield_unit || 'unité'

/**
 * Le coût de revient AFFICHÉ, par unité de vente, selon l'interrupteur
 * « main-d'œuvre ».
 *
 * L'interrupteur est le geste le plus fort repris d'Otami : le même écran
 * répond à deux questions différentes. Main-d'œuvre COMPRISE, on lit ce que le
 * produit coûte VRAIMENT à la maison — c'est le chiffre qui décide d'un prix de
 * vente. Main-d'œuvre EXCLUE, on lit le coût matière seul — c'est le chiffre
 * qu'on compare à un tarif de grossiste, ou à ce que coûterait le même produit
 * acheté tout fait.
 *
 * La base (quantité vendable du batch) et le verdict (marge, coefficient) sont
 * relus du moteur — `venteQty` et `margeEtCoef` de lib/recipes — pour que le
 * chiffre hors MO se calcule EXACTEMENT comme celui du moteur, à la seule
 * différence de la main-d'œuvre retirée.
 */
export function coutUniteAffiche(r: ListeRecipe, avecMainOeuvre: boolean): number | null {
  const batch = avecMainOeuvre ? r.cost.total_ht : round2(r.cost.matiere_ht + r.cost.emballage_ht)
  const q = venteQty(r)
  // Sans rendement ni quantité vendable, le prix de vente se compare au batch
  // entier — exactement le repli du moteur.
  return q > 0 ? round2(batch / q) : batch
}

/** Marge et coefficient AFFICHÉS — même fonction que le moteur, appliquée au
 *  coût de l'interrupteur. Restent à null tant qu'il manque un prix. */
export function verdictAffiche(r: ListeRecipe, avecMainOeuvre: boolean) {
  return margeEtCoef(r.cost.pv_unitaire_ht, coutUniteAffiche(r, avecMainOeuvre), r.cost.prix_manquants)
}

/** Sens du coût matière sur les 8 dernières semaines. null : pas de courbe
 *  traçable — on n'affiche alors AUCUNE flèche (une flèche « stable » se
 *  lirait « je sais que ça n'a pas bougé », ce qui est faux). */
export function tendance(r: ListeRecipe): 'hausse' | 'baisse' | null {
  const s = r.cost.matiere_series
  if (!Array.isArray(s) || s.length < 2) return null
  const delta = s[s.length - 1].v - s[0].v
  if (Math.abs(delta) < 0.005) return null
  return delta > 0 ? 'hausse' : 'baisse'
}

/** Couleur d'une marge : jugée contre la CIBLE de sa catégorie quand elle
 *  existe (vert ≥ cible, orange à moins de 10 pts sous la cible, rouge sinon),
 *  sinon contre les repères historiques 50/30. */
export function margeTon(marge: number, target: number | null): string {
  if (target !== null) {
    return marge >= target ? 'bg-green-50 text-green-700' : marge >= target - 10 ? 'bg-orange-50 text-orange-600' : 'bg-red-50 text-red-600'
  }
  return marge >= 50 ? 'bg-green-50 text-green-700' : marge >= 30 ? 'bg-orange-50 text-orange-600' : 'bg-red-50 text-red-600'
}

/** Le coefficient qu'il faut atteindre pour tenir une marge donnée —
 *  PV/coût = 1/(1 − marge). Otami rappelle les deux dans son en-tête ; un
 *  boucher raisonne en coefficient, un tableur en pourcentage. */
export const coefCible = (margePct: number) => (margePct >= 100 ? null : round2(1 / (1 - margePct / 100)))

/** Ce que la fiche produit, en une ligne — le sous-titre italique sous le nom */
function sousTitre(r: ListeRecipe): string {
  const bouts: string[] = []
  if (r.yield_qty && r.yield_qty > 0) bouts.push(`${fmtQty(r.yield_qty)} ${r.yield_unit || 'unités'} par batch`)
  else bouts.push('rendement non renseigné')
  if (r.sell_unit && Number(r.sell_qty) > 0) bouts.push(`vendu en ${r.sell_unit} (${fmtQty(Number(r.sell_qty))} par batch)`)
  return bouts.join(' · ')
}

/** En-tête de colonne triable — l'icône de tri est TOUJOURS visible (chez
 *  Otami aussi) : un tri qui ne se découvre qu'au survol ne se découvre pas. */
function ThTri({ label, sortKey, sort, onSort, align = 'right', children }: {
  label: string
  sortKey: SortKey
  sort: SortState
  onSort: (k: SortKey) => void
  align?: 'left' | 'right'
  children?: React.ReactNode
}) {
  const actif = sort.key === sortKey
  const Icone = !actif ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th className={`px-3.5 py-2.5 ${align === 'left' ? 'text-left' : 'text-right'} align-bottom`}>
      <button type="button" onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider transition-colors ${actif ? 'text-pilote' : 'text-gray-400 hover:text-gray-600'}`}>
        {align === 'right' && <Icone className={`w-3 h-3 ${actif ? 'text-pilote' : 'text-gray-300'}`} />}
        {label}
        {align === 'left' && <Icone className={`w-3 h-3 ${actif ? 'text-pilote' : 'text-gray-300'}`} />}
      </button>
      {children}
    </th>
  )
}

export default function ListeFiches({
  fiches, target, targetFor, cibleTexte = null, sort, onSort, avecMainOeuvre, sousRecetteIds, onOpen, openId,
}: {
  fiches: ListeRecipe[]
  /** Cible de marge de la catégorie affichée — null : aucune posée */
  target: number | null
  /** Cible propre à CHAQUE ligne (sections qui mélangent les catégories).
   *  Absent : toutes les lignes se jugent contre `target`. */
  targetFor?: (r: ListeRecipe) => number | null
  /** Remplace les pastilles de cible dans l'en-tête, quand une seule cible ne
   *  peut pas décrire la colonne (ex. « À retravailler », toutes catégories). */
  cibleTexte?: string | null
  sort: SortState
  onSort: (k: SortKey) => void
  /** Interrupteur global : le coût affiché inclut-il la main-d'œuvre ? */
  avecMainOeuvre: boolean
  /** Fiches qui entrent dans une AUTRE fiche — la chip « Sous-recette » */
  sousRecetteIds: Set<string>
  onOpen: (id: string) => void
  /** Fiche actuellement dépliée en encadré — sa ligne reste marquée */
  openId: string | null
}) {
  const cibleCoef = target !== null ? coefCible(target) : null

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px]">
          <thead>
            <tr className="bg-gray-50">
              <ThTri label="Nom" sortKey="nom" sort={sort} onSort={onSort} align="left" />
              <th className="px-3.5 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider align-bottom">Catégories</th>
              <ThTri label={avecMainOeuvre ? 'Coût (HT)' : 'Coût matière (HT)'} sortKey="cout" sort={sort} onSort={onSort}>
                <p className="text-[10px] font-normal normal-case tracking-normal text-gray-300 mt-0.5">
                  / {'unité de vente'}{avecMainOeuvre ? '' : ' — hors MO'}
                </p>
              </ThTri>
              <ThTri label="Marge" sortKey="marge" sort={sort} onSort={onSort}>
                {/* La CIBLE de la boutique, rappelée là où se lisent les valeurs.
                    Volontairement en gris : c'est un repère, pas une valeur. */}
                <p className="mt-1 flex items-center justify-end gap-1">
                  {cibleTexte ? (
                    <span className="text-[10px] font-normal normal-case tracking-normal text-gray-400">{cibleTexte}</span>
                  ) : target !== null ? (
                    <>
                      <span className="text-[10px] font-normal normal-case tracking-normal text-gray-400">cible</span>
                      {cibleCoef !== null && (
                        <span className="text-[10px] font-bold tabular text-gray-500 bg-gray-100 rounded-full px-1.5 py-0.5">×{cibleCoef.toLocaleString('fr-FR')}</span>
                      )}
                      <span className="text-[10px] font-bold tabular text-gray-500 bg-gray-100 rounded-full px-1.5 py-0.5">{target.toLocaleString('fr-FR')} %</span>
                    </>
                  ) : (
                    <span className="text-[10px] font-normal normal-case tracking-normal text-gray-300">pas de cible posée</span>
                  )}
                </p>
              </ThTri>
              <ThTri label="Prix (TTC)" sortKey="pv" sort={sort} onSort={onSort} />
              <ThTri label="Temps" sortKey="temps" sort={sort} onSort={onSort} />
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {fiches.map(r => {
              const cout = coutUniteAffiche(r, avecMainOeuvre)
              const verdict = verdictAffiche(r, avecMainOeuvre)
              const cible = targetFor ? targetFor(r) : target
              const t = tendance(r)
              const ouverte = openId === r.id
              return (
                <tr key={r.id} role="button" tabIndex={0}
                  onClick={() => onOpen(r.id)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(r.id) } }}
                  className={`group border-t border-gray-100 cursor-pointer transition-colors focus:outline-none focus:bg-pilote-50/60 ${ouverte ? 'bg-pilote-50/60' : 'hover:bg-gray-50'}`}>
                  <td className="px-3.5 py-3 max-w-[22rem]">
                    <p className="text-sm font-bold text-gray-900 leading-snug truncate">{r.name}</p>
                    <p className="text-[11px] italic text-gray-400 truncate">{sousTitre(r)}</p>
                  </td>

                  <td className="px-3.5 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 bg-gray-100 rounded-full px-2 py-0.5 whitespace-nowrap">
                        {sousRecetteIds.has(r.id) ? 'Sous-recette' : 'Produit fini'}
                      </span>
                      {r.category && r.category.trim() && (
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-pilote bg-pilote-50 ring-1 ring-pilote-100 rounded-full px-2 py-0.5 max-w-[11rem] truncate">
                          {r.category}
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="px-3.5 py-3 text-right">
                    <span className="inline-flex items-center justify-end gap-1.5">
                      <span className="text-sm font-extrabold text-gray-900 tabular">{cout !== null ? fmtEuro(cout) : '—'}</span>
                      {/* Le sens du mouvement avant la valeur — pastille ronde,
                          hausse en rouge, baisse en vert (langage de la mercuriale). */}
                      {t !== null && (
                        <span
                          title={t === 'hausse'
                            ? 'Coût matière en hausse sur les 8 dernières semaines'
                            : 'Coût matière en baisse sur les 8 dernières semaines'}
                          className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${t === 'hausse' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                          {t === 'hausse' ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />}
                        </span>
                      )}
                    </span>
                    {r.cost.prix_manquants > 0 && (
                      <p className="text-[10px] font-semibold text-amber-600">
                        {r.cost.prix_manquants} prix manquant{r.cost.prix_manquants > 1 ? 's' : ''} — sous-estimé
                      </p>
                    )}
                  </td>

                  <td className="px-3.5 py-3 text-right whitespace-nowrap">
                    {verdict.marge_pct !== null && verdict.coefficient !== null ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="text-[11px] font-bold tabular text-pilote bg-pilote-50 ring-1 ring-pilote-100 rounded-full px-2 py-0.5">
                          ×{verdict.coefficient.toLocaleString('fr-FR')}
                        </span>
                        <span className={`text-[11px] font-bold tabular rounded-full px-2 py-0.5 ${margeTon(verdict.marge_pct, cible)}`}>
                          {Math.round(verdict.marge_pct).toLocaleString('fr-FR')} %
                        </span>
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>

                  <td className="px-3.5 py-3 text-right">
                    <p className="text-sm font-semibold text-gray-900 tabular">
                      {r.selling_price_ttc != null ? fmtEuro(r.selling_price_ttc) : '—'}
                    </p>
                    <p className="text-[11px] text-gray-400 tabular">
                      {r.cost.pv_unitaire_ht !== null ? `${fmtEuro(r.cost.pv_unitaire_ht)} HT / ${uniteVente(r)}` : `/ ${uniteVente(r)}`}
                    </p>
                  </td>

                  <td className="px-3.5 py-3 text-right text-sm text-gray-600 tabular">
                    {fmtMin(r.cost.total_minutes ?? r.labor_minutes)}
                  </td>

                  <td className="pr-2 text-right">
                    <ChevronRight className={`w-4 h-4 text-gray-300 inline-block transition-all ${ouverte ? 'rotate-90 text-pilote' : 'opacity-0 group-hover:opacity-100'}`} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
