'use client'

// La LISTE des fiches recettes, en tableau — le DESSIN seulement.
//
// Depuis le lot 50, une ligne = un FORMAT DE VENTE, pas une fiche. C'est le
// parti pris relevé chez Otami en lecture seule : le nom en gras est le FORMAT
// (« SAUCISSE MONTAGNARDE AU KG »), l'italique en dessous rappelle la RECETTE
// MÈRE. Ses « 409 fiches » sont 409 formats. La raison est concrète : un
// boucher qui vend le même produit à la pièce ET au kilo a deux prix, donc deux
// marges — une liste à une ligne par fiche n'en montrait qu'une, et c'est
// justement cette liste qu'on balaye pour repérer ce qui ne marge pas.
//
// Le reste des partis pris de lecture, déjà en place :
//
//   · la DOUBLE lecture d'une marge — coefficient ET pourcentage, chacun dans
//     sa pastille, avec la CIBLE de la boutique rappelée dans l'en-tête de
//     colonne : on voit si la ligne est au-dessus ou en dessous sans calcul ;
//   · la FLÈCHE de tendance collée au coût — le sens du mouvement se lit avant
//     la valeur, et depuis le lot 67 elle dit aussi DE COMBIEN ;
//   · les CHIPS de catégorie dans leur propre colonne, pas fondues dans le nom ;
//   · des en-têtes TRIABLES dont l'icône de tri est visible en permanence, pas
//     au survol.
//
// Ce qui n'est PAS repris d'Otami : sa palette verte, ses icônes en bout de
// ligne. PILOTE reste navy/orange et révèle ses actions au survol.

import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronRight } from 'lucide-react'
import { venteQty, margeEtCoef } from '@/lib/recipes'
import { moyenneCatalogue, phraseMoyenne } from '@/lib/recettes-catalogue'
import { Absent } from '@/components/ui/da'
import { uniteAuPluriel } from './fiche-ui'

export type ListeCost = {
  matiere_ht: number
  emballage_ht: number
  main_oeuvre_ht: number
  total_ht: number
  par_unite_ht: number | null
  par_unite_vente_ht?: number | null
  prix_manquants: number
  total_minutes: number
  /** Prix de vente HT DU FORMAT de la ligne — tout le reste du coût est celui
   *  du batch, commun à tous les formats de la même fiche. */
  pv_unitaire_ht: number | null
  marge_pct: number | null
  coefficient: number | null
  /** Coût matière du batch relu aux prix des 8 dernières semaines — la tendance */
  matiere_series?: { d: string; v: number }[]
}

/**
 * UNE LIGNE DU TABLEAU = UN FORMAT DE VENTE.
 *
 * Le coût du batch (matière, emballage, main-d'œuvre, minutes, tendance) est le
 * MÊME pour tous les formats d'une fiche : c'est la même fabrication. Ce qui
 * change d'une ligne à l'autre, c'est par combien on divise ce coût (la
 * quantité vendable `sell_qty`) et à quel prix on vend (`selling_price_ttc`).
 * D'où des champs de vente portés par le FORMAT et un rendement porté par la
 * RECETTE — `venteQty` du moteur sait déjà arbitrer entre les deux.
 */
export type ListeLigne = {
  /** Identité de la ligne — « recette:format », unique dans tout le tableau */
  key: string
  recipeId: string
  /** null quand la fiche n'a aucun format (ne devrait plus exister) */
  formatId: string | null
  /** Le nom en GRAS : celui du FORMAT */
  nom: string
  /** L'italique : la RECETTE MÈRE (tue quand elle porte le même nom) */
  recetteNom: string
  category: string | null
  /** Rendement de la recette mère — second segment du sous-titre */
  yield_qty: number | null
  yield_unit: string | null
  /** Unité et quantité vendables DU FORMAT */
  sell_unit?: string | null
  sell_qty?: number | null
  /** PV TTC DU FORMAT */
  selling_price_ttc: number | null
  /** Format relu et validé par le boucher (coche verte, comme chez Otami) */
  validated: boolean
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

/** L'unité dans laquelle la LIGNE se vend (celle que regarde son prix) */
export const uniteVente = (l: ListeLigne) => l.sell_unit || l.yield_unit || 'unité'

/**
 * Le coût de revient AFFICHÉ pour cette ligne, par unité de vente DU FORMAT,
 * selon l'interrupteur « main-d'œuvre ».
 *
 * L'interrupteur est le geste le plus fort repris d'Otami : le même écran
 * répond à deux questions différentes. Main-d'œuvre COMPRISE, on lit ce que le
 * produit coûte VRAIMENT à la maison — c'est le chiffre qui décide d'un prix de
 * vente. Main-d'œuvre EXCLUE, on lit le coût matière seul — c'est le chiffre
 * qu'on compare à un tarif de grossiste, ou à ce que coûterait le même produit
 * acheté tout fait.
 *
 * La base (quantité vendable du format) et le verdict (marge, coefficient) sont
 * relus du moteur — `venteQty` et `margeEtCoef` de lib/recipes — pour que le
 * chiffre hors MO se calcule EXACTEMENT comme celui du moteur, à la seule
 * différence de la main-d'œuvre retirée.
 */
export function coutUniteAffiche(l: ListeLigne, avecMainOeuvre: boolean): number | null {
  const batch = avecMainOeuvre ? l.cost.total_ht : round2(l.cost.matiere_ht + l.cost.emballage_ht)
  const q = venteQty(l)
  // Sans rendement ni quantité vendable, le prix de vente se compare au batch
  // entier — exactement le repli du moteur.
  return q > 0 ? round2(batch / q) : batch
}

/** Marge et coefficient AFFICHÉS — même fonction que le moteur, appliquée au
 *  coût de l'interrupteur. Restent à null tant qu'il manque un prix. */
export function verdictAffiche(l: ListeLigne, avecMainOeuvre: boolean) {
  return margeEtCoef(l.cost.pv_unitaire_ht, coutUniteAffiche(l, avecMainOeuvre), l.cost.prix_manquants)
}

/** Le mouvement du coût matière sur les 8 dernières semaines — son SENS, et de
 *  COMBIEN.
 *
 *  La flèche seule répondait « ça monte » ; elle laissait le boucher devant la
 *  seule question qui compte ensuite : de beaucoup ? Un coût matière qui gagne
 *  0,3 % ne se traite pas comme un qui gagne 9 %, et rien à l'écran ne les
 *  distinguait. Relevé chez Otami le 04/08/2026 : leur tableau des mouvements
 *  de prix montre toujours l'ancien ET le nouveau prix, jamais une flèche nue.
 *
 *  Le POURCENTAGE est ce qui s'affiche : il se lit pareil que la fiche soit
 *  chiffrée au batch ou à l'unité, alors que l'écart en euros porte, lui, sur
 *  le batch — il reste donc dans l'infobulle, avec sa date de départ, où il ne
 *  peut pas être pris pour un écart à l'unité.
 *
 *  null : pas de courbe traçable, ou mouvement sous le demi-centime — on
 *  n'affiche alors AUCUNE flèche (une flèche « stable » se lirait « je sais que
 *  ça n'a pas bougé », ce qui est faux).
 *
 *  La série est celle du BATCH : deux formats d'une même fiche portent donc la
 *  même tendance, et c'est juste — c'est la même matière qui bouge. */
export type Mouvement = {
  sens: 'hausse' | 'baisse'
  /** Écart en % entre le premier et le dernier point de la fenêtre */
  pct: number | null
  /** Écart en euros SUR LE BATCH */
  ecart_batch: number
  /** Date du premier point — « depuis le … » */
  depuis: string
}

export function tendance(l: ListeLigne): Mouvement | null {
  const s = l.cost.matiere_series
  if (!Array.isArray(s) || s.length < 2) return null
  const depart = s[0]
  const arrivee = s[s.length - 1]
  const delta = arrivee.v - depart.v
  if (Math.abs(delta) < 0.005) return null
  // Un départ à zéro ne donne pas de pourcentage : on montre la flèche et
  // l'écart en euros, sans inventer un « +∞ % ».
  const pct = depart.v > 0 ? Math.round((delta / depart.v) * 1000) / 10 : null
  return { sens: delta > 0 ? 'hausse' : 'baisse', pct, ecart_batch: delta, depuis: depart.d }
}

/** « 2026-06-09 » → « 9 juin ». Rend la chaîne telle quelle si elle n'est pas
 *  une date — l'infobulle ne doit jamais afficher « Invalid Date ». */
function jourCourt(iso: string): string {
  const t = String(iso || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const d = new Date(t + 'T00:00:00Z')
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' })
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

/**
 * POURQUOI CETTE LIGNE N'A PAS DE MARGE — et donc quoi faire.
 *
 * Les conditions sont celles de `margeEtCoef` (lib/recipes), reprises dans le
 * MÊME ordre : c'est ce qui garantit que la raison affichée est bien celle qui a
 * fait renoncer le moteur, et pas une seconde explication qui divergerait de la
 * première. L'ordre compte aussi pour le boucher : un prix de vente posé sur une
 * fiche dont un ingrédient n'a pas de prix ne produirait toujours rien.
 */
function raisonSansMarge(l: ListeLigne): { raison: string; explication: string } {
  if (l.cost.prix_manquants > 0) {
    return {
      raison: 'prix à compléter',
      explication: `${l.cost.prix_manquants} ingrédient${l.cost.prix_manquants > 1 ? 's' : ''} sans prix connu : `
        + 'aucune marge n’est publiée tant qu’il en manque un, car elle serait trop belle.',
    }
  }
  if (l.cost.pv_unitaire_ht === null || l.cost.pv_unitaire_ht <= 0) {
    return {
      raison: 'pas de prix de vente',
      explication: 'Posez le prix de vente de ce format : la marge et le coefficient suivront tout seuls.',
    }
  }
  return {
    raison: 'pas encore de coût',
    explication: 'Cette fiche n’a pas d’ingrédient chiffré : ajoutez-en pour qu’un coût de revient existe.',
  }
}

/** Le coefficient qu'il faut atteindre pour tenir une marge donnée —
 *  PV/coût = 1/(1 − marge). Otami rappelle les deux dans son en-tête ; un
 *  boucher raisonne en coefficient, un tableur en pourcentage. */
export const coefCible = (margePct: number) => (margePct >= 100 ? null : round2(1 / (1 - margePct / 100)))

/** Le sous-titre italique : la RECETTE MÈRE, puis ce que le batch produit.
 *
 *  La recette mère n'est rappelée que si le format porte un AUTRE nom qu'elle —
 *  toute fiche naît avec un format à son propre nom, et écrire deux fois la
 *  même chose sur deux lignes n'apprend rien. */
function sousTitre(l: ListeLigne): string {
  const bouts: string[] = []
  const memeNom = l.recetteNom.trim().toLowerCase() === l.nom.trim().toLowerCase()
  if (!memeNom && l.recetteNom.trim()) bouts.push(l.recetteNom)
  if (l.yield_qty && l.yield_qty > 0) bouts.push(`${fmtQty(l.yield_qty)} ${l.yield_unit || 'unités'} par batch`)
  else bouts.push('rendement non renseigné')
  if (l.sell_unit && Number(l.sell_qty) > 0) bouts.push(`vendu en ${l.sell_unit} (${fmtQty(Number(l.sell_qty))} ${uniteAuPluriel(Number(l.sell_qty), l.sell_unit)} par batch)`)
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
    // `whitespace-nowrap` : trois défauts de la session du 06/08 étaient des mots
    // repliés, et l'écran ouvert le 07/08 en montrait encore quatre — « COÛT
    // (HT) » coupé après « COÛT », « / unité de vente » sur trois lignes, « PRIX
    // (TTC) » sur deux. Un en-tête de colonne est un libellé court : il ne se
    // replie jamais, c'est la table qui défile (elle a déjà son overflow-x).
    <th className={`px-3.5 py-2.5 ${align === 'left' ? 'text-left' : 'text-right'} align-bottom whitespace-nowrap`}>
      <button type="button" onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-pilote-200 rounded ${actif ? 'text-pilote' : 'text-gray-500 hover:text-gray-700'}`}>
        {align === 'right' && <Icone className={`w-3 h-3 ${actif ? 'text-pilote' : 'text-gray-400'}`} />}
        {label}
        {align === 'left' && <Icone className={`w-3 h-3 ${actif ? 'text-pilote' : 'text-gray-400'}`} />}
      </button>
      {children}
    </th>
  )
}

/**
 * LE RÉCAPITULATIF DE L'EN-TÊTE — « où en est ce que je regarde ? »
 *
 * L'idée vient d'Otami, relevée en lecture seule : leur en-tête de colonne
 * « Marge » porte le coefficient et le taux MOYENS, si bien que chaque ligne se
 * juge par rapport à la moyenne sans que l'œil ait à la faire.
 *
 * PILOTE y écrivait déjà la CIBLE. En ouvrant l'écran le 07/08, le manque était
 * flagrant : sur les quatre sections, deux affichaient « pas de cible posée » —
 * donc un ×4,98 / 80 % en vert et un ×1,78 / 44 % en rouge sans que rien à
 * l'écran ne dise par rapport à quoi. Une cible dit où l'on veut aller ; elle ne
 * dit pas où l'on est, et quand elle manque il ne reste rien.
 *
 * Les deux repères ne se ressemblent pas, et c'est voulu : la CIBLE est en
 * pastilles pleines (un objectif, posé par le boucher), la MOYENNE en chiffres
 * nus (une mesure, constatée). Deux lignes grises identiques se seraient
 * confondues.
 */
function RecapMarge({ cible, cibleCoef, cibleTexte, moyenne }: {
  cible: number | null
  cibleCoef: number | null
  cibleTexte: string | null
  moyenne: ReturnType<typeof moyenneCatalogue> | null
}) {
  const nb = (n: number) => n.toLocaleString('fr-FR')
  return (
    <div className="mt-1 flex flex-col items-end gap-0.5">
      <p className="flex items-center gap-1 whitespace-nowrap">
        {cibleTexte ? (
          <span className="text-[11px] font-normal normal-case tracking-normal text-gray-500">{cibleTexte}</span>
        ) : cible !== null ? (
          <>
            <span className="text-[11px] font-normal normal-case tracking-normal text-gray-500">cible</span>
            {cibleCoef !== null && (
              <span className="text-[11px] font-bold tabular text-gray-600 bg-gray-100 rounded-full px-1.5 py-0.5">×{nb(cibleCoef)}</span>
            )}
            <span className="text-[11px] font-bold tabular text-gray-600 bg-gray-100 rounded-full px-1.5 py-0.5">{nb(cible)} %</span>
          </>
        ) : (
          <span className="text-[11px] font-normal normal-case tracking-normal text-gray-500">pas de cible posée</span>
        )}
      </p>

      {/* La MESURE. Absente sur un extrait biaisé (« À retravailler » ne montre
          que les lignes sous leur cible : en moyenner la marge dirait une
          contre-vérité sur la boutique). */}
      {moyenne !== null && (
        moyenne.coefficient !== null && moyenne.marge_pct !== null ? (
          <p className="flex items-center gap-1 whitespace-nowrap" title={phraseMoyenne(moyenne)}>
            <span className="text-[11px] font-normal normal-case tracking-normal text-gray-500">moyenne</span>
            <span className="text-[11px] font-bold tabular text-gray-700">×{nb(moyenne.coefficient)}</span>
            <span className="text-[11px] font-bold tabular text-gray-700">{nb(Math.round(moyenne.marge_pct))} %</span>
            {/* Toute exclusion s'annonce : une moyenne muette sur son assiette
                est un chiffre faux qui s'ignore. */}
            {moyenne.ignores > 0 && (
              <span className="text-[11px] font-normal normal-case tracking-normal text-gray-500">
                sur {nb(moyenne.comptes)}
              </span>
            )}
          </p>
        ) : (
          <p className="text-[11px] font-normal normal-case tracking-normal text-gray-500 whitespace-nowrap"
            title={phraseMoyenne(moyenne)}>
            moyenne non calculable
          </p>
        )
      )}
    </div>
  )
}

export default function ListeFiches({
  lignes, target, targetFor, cibleTexte = null, sort, onSort, avecMainOeuvre, sousRecetteIds, onOpen, openKey,
}: {
  /** Une entrée par FORMAT DE VENTE — voir ListeLigne */
  lignes: ListeLigne[]
  /** Cible de marge de la catégorie affichée — null : aucune posée */
  target: number | null
  /** Cible propre à CHAQUE ligne (sections qui mélangent les catégories).
   *  Absent : toutes les lignes se jugent contre `target`. */
  targetFor?: (l: ListeLigne) => number | null
  /** Remplace les pastilles de cible dans l'en-tête, quand une seule cible ne
   *  peut pas décrire la colonne (ex. « À retravailler », toutes catégories). */
  cibleTexte?: string | null
  sort: SortState
  onSort: (k: SortKey) => void
  /** Interrupteur global : le coût affiché inclut-il la main-d'œuvre ? */
  avecMainOeuvre: boolean
  /** Fiches qui entrent dans une AUTRE fiche — la chip « Sous-recette ».
   *  Indexé par RECETTE : c'est la fabrication qui est réutilisée, pas un format. */
  sousRecetteIds: Set<string>
  onOpen: (l: ListeLigne) => void
  /** Ligne actuellement dépliée en encadré — elle reste marquée */
  openKey: string | null
}) {
  const cibleCoef = target !== null ? coefCible(target) : null

  // La moyenne de ce que le tableau AFFICHE, calculée sur les mêmes entrées que
  // les pastilles des lignes (`pv_unitaire_ht`, `coutUniteAffiche`,
  // `prix_manquants`) : aucune ligne rendue « — » ne peut donc se retrouver
  // fondue dans la moyenne du haut. Elle suit l'interrupteur main-d'œuvre comme
  // tout le reste de l'écran — une moyenne MO comprise au-dessus de coûts hors
  // MO donnerait deux verdicts contradictoires sur la même page.
  //
  // `cibleTexte` n'est passé que par la section « À retravailler », qui ne
  // contient QUE les lignes sous leur cible : un extrait choisi pour être
  // mauvais n'a pas de moyenne à publier.
  const moyenne = cibleTexte ? null : moyenneCatalogue(lignes.map(l => ({
    pv_ht: l.cost.pv_unitaire_ht,
    cout_unite: coutUniteAffiche(l, avecMainOeuvre),
    prix_manquants: l.cost.prix_manquants,
  })))

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px]">
          <thead>
            <tr className="bg-gray-50">
              <ThTri label="Format de vente" sortKey="nom" sort={sort} onSort={onSort} align="left" />
              <th className="px-3.5 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider align-bottom whitespace-nowrap">Catégories</th>
              <ThTri label={avecMainOeuvre ? 'Coût (HT)' : 'Coût matière (HT)'} sortKey="cout" sort={sort} onSort={onSort}>
                <p className="text-[11px] font-normal normal-case tracking-normal text-gray-500 mt-0.5 whitespace-nowrap">
                  / {'unité de vente'}{avecMainOeuvre ? '' : ' — hors MO'}
                </p>
              </ThTri>
              <ThTri label="Marge" sortKey="marge" sort={sort} onSort={onSort}>
                <RecapMarge cible={target} cibleCoef={cibleCoef} cibleTexte={cibleTexte} moyenne={moyenne} />
              </ThTri>
              <ThTri label="Prix (TTC)" sortKey="pv" sort={sort} onSort={onSort} />
              <ThTri label="Temps" sortKey="temps" sort={sort} onSort={onSort} />
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lignes.map(l => {
              const cout = coutUniteAffiche(l, avecMainOeuvre)
              const verdict = verdictAffiche(l, avecMainOeuvre)
              const cible = targetFor ? targetFor(l) : target
              const t = tendance(l)
              const ouverte = openKey === l.key
              return (
                <tr key={l.key} role="button" tabIndex={0}
                  onClick={() => onOpen(l)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(l) } }}
                  className={`group border-t border-gray-100 cursor-pointer transition-colors focus:outline-none focus:bg-pilote-50/60 ${ouverte ? 'bg-pilote-50/60' : 'hover:bg-gray-50'}`}>
                  <td className="px-3.5 py-3 max-w-[22rem]">
                    {/* `title` : le nom est tronqué faute de place, et sans lui
                        il n'existe aucun moyen de lire un nom long — c'est le
                        défaut relevé chez Otami (« SAUCISSE MONTAGNA… », rien au
                        survol), qu'on ne va pas reproduire. */}
                    <p className="text-sm font-bold text-gray-900 leading-snug truncate" title={l.nom}>
                      {/* La coche verte des formats relus, comme chez Otami —
                          discrète, devant le nom, sans mot en plus. */}
                      {l.validated && (
                        <Check className="w-3.5 h-3.5 text-green-600 inline-block mr-1 -mt-0.5" aria-label="Format validé" />
                      )}
                      {l.nom}
                    </p>
                    <p className="text-[11px] italic text-gray-500 truncate" title={sousTitre(l)}>{sousTitre(l)}</p>
                  </td>

                  <td className="px-3.5 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 bg-gray-100 rounded-full px-2 py-0.5 whitespace-nowrap">
                        {sousRecetteIds.has(l.recipeId) ? 'Sous-recette' : 'Produit fini'}
                      </span>
                      {l.category && l.category.trim() && (
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-pilote bg-pilote-50 ring-1 ring-pilote-100 rounded-full px-2 py-0.5 max-w-[11rem] truncate">
                          {l.category}
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="px-3.5 py-3 text-right whitespace-nowrap">
                    <span className="inline-flex items-center justify-end gap-1.5">
                      <span className="text-sm font-extrabold text-gray-900 tabular">{cout !== null ? fmtEuro(cout) : '—'}</span>
                      {/* Le sens du mouvement avant la valeur — pastille ronde,
                          hausse en rouge, baisse en vert (langage de la mercuriale). */}
                      {t !== null && (
                        <span
                          title={`Coût matière en ${t.sens} depuis le ${jourCourt(t.depuis)}`
                            + ` : ${t.ecart_batch > 0 ? '+' : '−'}${fmtEuro(Math.abs(t.ecart_batch))} sur le batch`
                            + (t.pct !== null ? ` (${t.pct > 0 ? '+' : '−'}${Math.abs(t.pct).toLocaleString('fr-FR')} %)` : '')}
                          className={`inline-flex items-center gap-0.5 rounded-full pl-0.5 pr-1.5 py-0.5 flex-shrink-0 ${t.sens === 'hausse' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                          {t.sens === 'hausse' ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />}
                          {/* DE COMBIEN — en pourcentage, seule écriture qui se
                              lise pareil au batch et à l'unité. */}
                          {t.pct !== null && (
                            <span className="text-[10px] font-bold tabular">{Math.abs(t.pct).toLocaleString('fr-FR')} %</span>
                          )}
                        </span>
                      )}
                    </span>
                    {l.cost.prix_manquants > 0 && (
                      <p className="text-[10px] font-semibold text-amber-600">
                        {l.cost.prix_manquants} prix manquant{l.cost.prix_manquants > 1 ? 's' : ''} — sous-estimé
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
                      /* Le tiret gris était le trou le plus coûteux de l'écran :
                         il ne disait pas laquelle des trois causes s'appliquait,
                         alors que chacune appelle un geste différent — compléter
                         un prix d'ingrédient, poser un prix de vente, ou saisir
                         des ingrédients. Trois causes, un seul tiret : le
                         créateur restait devant sans savoir quoi faire. */
                      <Absent {...raisonSansMarge(l)} />
                    )}
                  </td>

                  {/* `whitespace-nowrap` : sur l'écran ouvert le 07/08, « 5,28 €
                      HT / kg » se repliait sur TROIS lignes dans une section
                      étroite, et « 19,00 € » se retrouvait séparé de son unité.
                      Un montant coupé de son unité est un montant qu'on lit de
                      travers. */}
                  <td className="px-3.5 py-3 text-right whitespace-nowrap">
                    <p className="text-sm font-semibold text-gray-900 tabular">
                      {l.selling_price_ttc != null ? fmtEuro(l.selling_price_ttc) : '—'}
                    </p>
                    <p className="text-[11px] text-gray-500 tabular">
                      {l.cost.pv_unitaire_ht !== null ? `${fmtEuro(l.cost.pv_unitaire_ht)} HT / ${uniteVente(l)}` : `/ ${uniteVente(l)}`}
                    </p>
                  </td>

                  <td className="px-3.5 py-3 text-right text-sm text-gray-600 tabular whitespace-nowrap">
                    {fmtMin(l.cost.total_minutes ?? l.labor_minutes)}
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
