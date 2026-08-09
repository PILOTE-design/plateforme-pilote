'use client'

// Les TYPES, les FORMATEURS et les BLOCS DE DESSIN de la fiche recette.
//
// Même partage des rôles que la mercuriale (`page.tsx` garde la logique,
// `ui.tsx` garde le dessin) et que la liste des fiches (`liste.tsx`) :
// `fiche-panel.tsx` garde l'état, les handlers et l'enchaînement ; ce fichier
// garde ce qui se contente d'AFFICHER. Objectif immédiat : que le panneau
// puisse accueillir ses sous-onglets sans grossir davantage — il pesait 76 Ko
// avant cette extraction, et le plafond pratique d'un push est ~155 Ko.
//
// Rien ne change de comportement ici : les fonctions et le tableau
// d'ingrédients sont déplacés tels quels.

import Link from 'next/link'
import { X } from 'lucide-react'
import { nomFournisseur } from '@/lib/supplier-name'

export type FicheIngredient = {
  generic_id: string | null; article_id: string | null; label: string
  /** Sous-recette : la ligne vise une autre fiche (unités de son rendement) */
  sub_recipe_id?: string | null
  sub_incomplete?: boolean
  quantity: number; qty_unit: string | null; unit: string | null; loss_pct: number | null
  manual_price_ht?: number | null
  unit_price_ht: number | null; price_source: string; categorie: 'ingredient' | 'emballage'
  /** Date de la facture d'où vient le prix mercuriale — l'âge du chiffre */
  price_date?: string | null
  /** Réf fournisseur facturée d'où sort le prix, et sa maison — la PROVENANCE
   *  du chiffre, affichée sous le nom de l'ingrédient. */
  price_ref_name?: string | null
  price_ref_supplier?: string | null
  qty_base: number; qty_brute: number; line_total_ht: number
}

/** Article générique de la mercuriale, tel que renvoyé par GET /api/recipes —
 *  nécessaire pour AJOUTER un ingrédient directement depuis la fiche. */
export type FicheGeneric = {
  id: string; name: string
  base_unit: 'kg' | 'piece'
  category: 'ingredient' | 'emballage'
  default_loss_pct: number
  price_ht: number | null
}

export type FicheCost = {
  matiere_ht: number
  /** Surcoût de la PERTE DE FABRICATION sur la matière — affiché à part,
   *  jamais fondu dans `matiere_ht` : c'est un chiffre sur lequel le boucher
   *  peut agir (revoir une cuisson, une découpe). */
  perte_ht?: number
  perte_pct?: number
  emballage_ht: number; main_oeuvre_ht: number; total_ht: number
  par_unite_ht: number | null
  /** Coût par unité de VENTE — la base du PV, de la marge et du coefficient */
  par_unite_vente_ht?: number | null
  prix_manquants: number; labor_rate_ht: number | null
  total_minutes: number
  pv_unitaire_ht: number | null; marge_pct: number | null; coefficient: number | null
  /** Coût matière (+ emballage) du batch relu aux prix mercuriale de chaque
   *  jalon (8 lundis ISO + aujourd'hui) — jalons incomplets absents */
  matiere_series?: { d: string; v: number }[]
  /** Pourquoi la courbe n'est pas traçable — null quand elle l'est */
  matiere_series_motif?: string | null
}

/** Un FORMAT DE VENTE de la fiche — même fabrication, autre conditionnement.
 *  Les quatre derniers champs sont DÉRIVÉS (calculés par le serveur à chaque
 *  lecture, jamais stockés) : le coût du batch est le même pour tous les
 *  formats, seule la division par la quantité vendable et le prix changent. */
export type FicheFormat = {
  id: string
  name: string
  sell_unit: string | null
  sell_qty: number | null
  selling_price_ttc: number | null
  tva_rate: number
  validated: boolean
  position: number
  vente_qty: number
  cout_unite_ht: number | null
  pv_unitaire_ht: number | null
  marge_pct: number | null
  coefficient: number | null
}

export type FicheRecipe = {
  id: string; name: string; category: string | null
  yield_qty: number | null; yield_unit: string | null
  /** Vendu dans une AUTRE unité que la production (pièces fabriquées, kg vendus) */
  sell_unit?: string | null; sell_qty?: number | null
  labor_minutes: number; selling_price_ttc: number | null; tva_rate: number; notes: string | null
  /** Perte de FABRICATION de la fiche, en % (l'atelier — pas le parage d'une ligne) */
  loss_pct?: number | null
  employee_id: string | null
  /** Conservation (lot 125) — les deux seuls champs Infos réellement remplis
   *  chez Otami. null : non renseigné, et l'écran le dit. */
  storage_temp_c?: number | null
  storage_days?: number | null
  /** Identifiants d'allergènes (annexe II INCO) — jamais des libellés */
  allergens?: unknown
  fabrication_steps?: unknown
  time_tiers?: unknown
  /** Formats de vente — au moins un depuis la reprise du lot 46 */
  formats?: FicheFormat[]
  ingredients: FicheIngredient[]
  cost: FicheCost
}

export type FicheEmployee = { id: string; name: string; loaded_rate: number | null }

export const fmtEuro = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
export const fmtQty = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 3 })
export const unitFr = (u: string | null) => (u === 'piece' ? 'pièce' : u || 'u')
export const num = (s: string) => parseFloat(s.replace(',', '.')) || 0
export const round2 = (n: number) => Math.round(n * 100) / 100

/** 45 → « 45 min » ; 90 → « 1 h 30 » */
export function fmtMin(m: number): string {
  const r = Math.round(m)
  if (r < 60) return `${(Math.round(m * 10) / 10).toLocaleString('fr-FR')} min`
  return `${Math.floor(r / 60)} h ${String(r % 60).padStart(2, '0')}`
}

export const fmtDateFr = (s: string) => new Date(s + 'T00:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** Unités de VENTE proposées à la création d'un format — mêmes valeurs que la
 *  modale de la fiche (page.tsx) : un produit fabriqué à la pièce peut se
 *  vendre au kilo, et c'est l'unité de VENTE qui porte le prix et la marge. */
export const UNITES_VENTE = [
  { value: 'kg', label: 'au kg' },
  { value: '100 g', label: 'aux 100 g' },
  { value: 'pièce', label: 'à la pièce' },
  { value: 'portion', label: 'à la portion' },
  { value: 'litre', label: 'au litre' },
]

/** Unités de MESURE — elles ne prennent pas la marque du pluriel derrière un
 *  nombre (« 10 kg », « 2 g », « 3 cl »). Le litre, lui, en prend une. */
const UNITES_INVARIABLES = new Set(['kg', 'g', 'mg', '100 g', 'cl', 'ml', 'l'])

/**
 * L'unité de vente accordée avec la quantité : « 10 portions », « 1 pièce »,
 * « 10 kg ».
 *
 * Écrit « le batch fait 10 portion vendables » pendant six lots. Ce n'est pas
 * qu'une coquille : la fiche est le document que le boucher imprime, montre à
 * son équipe et relit devant un client. Une faute d'accord dans la phrase qui
 * porte le chiffre le plus important de l'écran abîme la confiance dans le
 * chiffre lui-même.
 *
 * Une unité écrite au pluriel par le client (« portions ») est laissée telle
 * quelle, et une unité inconnue reçoit un « s » — c'est la règle par défaut du
 * français, et le champ est libre.
 */
export function uniteAuPluriel(qty: number, unite: string): string {
  const u = (unite || '').trim()
  if (!u) return ''
  if (Math.abs(qty) < 2) return u
  if (UNITES_INVARIABLES.has(u.toLowerCase())) return u
  if (/s$|x$|z$/i.test(u)) return u
  return `${u}s`
}

/** « kg » → « au kg », « pièce » → « à la pièce »… pour les phrases de la fiche */
export const venteEnClair = (u: string) =>
  u === 'kg' ? 'au kg'
  : u === 'pièce' ? 'à la pièce'
  : u === '100 g' ? 'aux 100 g'
  : u === 'portion' ? 'à la portion'
  : u === 'litre' ? 'au litre'
  : `en ${u}`

/** Un pourcentage en entier — sauf entre 0 et 0,5 %, où « 0 % » se lirait
 *  « rien », alors que la ligne pèse quelque chose. Le poivre d'une terrine
 *  n'est pas nul : il est petit. */
export const pctFmt = (p: number) => (p > 0 && p < 0.5 ? '< 1 %' : `${Math.round(p)} %`)

/** Poids d'une ligne, en kg, NET et BRUT — null quand la ligne n'a pas de poids
 *  connu (comptée à la pièce, ou unité héritée illisible).
 *
 *  Une pièce n'a pas de masse tant que personne n'a dit ce qu'elle pèse : la
 *  compter pour 0 g gonflerait la part de toutes les autres, lui inventer un
 *  poids serait pire. Elle sort donc de l'assiette du « % de poids » — et le
 *  tableau ANNONCE combien de lignes en sortent, plutôt que de publier des
 *  pourcentages qui ne totalisent rien.
 *
 *  Même règle que le pied de tableau : les deux lisent cette fonction, pour que
 *  la part d'une ligne et le total ne puissent pas diverger. */
export function ligneKg(i: FicheIngredient): { net: number; brut: number } | null {
  if (i.generic_id) {
    if (i.qty_unit !== 'kg' && i.qty_unit !== 'g') return null
    return { net: Number(i.qty_base) || 0, brut: Number(i.qty_brute) || 0 }
  }
  if ((i.unit || '').toLowerCase().includes('kg')) {
    const q = Number(i.quantity) || 0
    return { net: q, brut: Number(i.qty_brute) || q }
  }
  return null
}

/** Âge d'une date de prix, en jours pleins. null si la date est illisible. */
export function ageJours(d: string | null | undefined): number | null {
  if (!d) return null
  const t = new Date(String(d).slice(0, 10) + 'T00:00:00Z').getTime()
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.floor((Date.now() - t) / 86400000))
}

/** Mini-courbe du coût matière : x = jalon hebdomadaire, y = coût du batch.
 *  Trait navy, dernier point orange — même langage que la mercuriale. */
export function TrendSpark({ points }: { points: { d: string; v: number }[] }) {
  const W = 160, H = 36, PAD = 4
  const vs = points.map(x => x.v)
  const min = Math.min(...vs), max = Math.max(...vs)
  const span = max - min
  const X = (i: number) => (points.length < 2 ? W / 2 : PAD + (i / (points.length - 1)) * (W - PAD * 2))
  const Y = (v: number) => (span === 0 ? H / 2 : H - PAD - ((v - min) / span) * (H - PAD * 2))
  const d = vs.map((v, i) => `${i === 0 ? 'M' : 'L'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-40 h-9 flex-shrink-0" role="img" aria-label="Coût matière sur les 8 dernières semaines">
      {points.length >= 2 && (
        <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="text-pilote" />
      )}
      <circle cx={X(points.length - 1)} cy={Y(vs[vs.length - 1] ?? 0)} r={3} className="fill-pilote-orange" />
    </svg>
  )
}

/** Un jalon du graphe de l'onglet Statistiques : une date, et ce que la fiche
 *  valait ce jour-là. `pv` et `marge` sont null quand le prix de vente n'est
 *  pas posé ou qu'il manque un prix d'ingrédient. */
export type JalonCout = { d: string; cout: number; pv: number | null; marge: number | null }

/** Les trois lectures du graphe. Une seule série d'échelle « pourcentage »,
 *  d'où le deuxième axe. */
export type SerieCout = 'cout' | 'pv' | 'marge'

/**
 * « Évolution des coûts » — la fiche relue aux prix de chaque jalon.
 *
 * Otami superpose coût de fabrication, prix de vente et marge brute, annote
 * chaque point de sa valeur, et date l'axe. C'est ce qui transforme une courbe
 * en réponse à la vraie question : « la rentabilité de ce produit se
 * dégrade-t-elle ? » — un coût qui monte pendant qu'un prix de vente reste plat
 * se lit d'un coup d'œil, alors qu'il fallait auparavant comparer deux écrans.
 *
 * Le coût est PAR UNITÉ DE VENTE, la même base que le prix : superposer un coût
 * de batch et un prix au kilo donnerait deux courbes qui ne se parlent pas.
 */
export function GrapheCouts({ points, series, uniteVente }: {
  points: JalonCout[]
  series: Record<SerieCout, boolean>
  uniteVente: string
}) {
  const W = 720, H = 220, L = 46, R = 44, T = 26, B = 30
  const n = points.length
  if (n < 2) return null

  // Échelle des EUROS : coût et prix de vente la partagent, sinon les deux
  // courbes ne seraient pas comparables. Bornée à 0 en bas — une échelle qui
  // démarre au minimum transforme une variation de 2 % en falaise.
  const euros = [
    ...points.map(p => p.cout),
    ...points.map(p => p.pv).filter((v): v is number => v !== null && series.pv),
  ]
  const maxE = Math.max(...euros) * 1.12 || 1
  const X = (i: number) => L + (i / (n - 1)) * (W - L - R)
  const Ye = (v: number) => H - B - (v / maxE) * (H - T - B)
  // Échelle des POURCENTAGES : 0 à 100, fixe — une marge se lit sur une échelle
  // absolue, pas sur une échelle qui bouge à chaque fiche.
  const Ym = (v: number) => H - B - (Math.max(0, Math.min(100, v)) / 100) * (H - T - B)

  const trace = (vals: (number | null)[], y: (v: number) => number) => {
    let d = ''
    let ouvert = false
    vals.forEach((v, i) => {
      if (v === null) { ouvert = false; return }
      d += `${ouvert ? 'L' : 'M'}${X(i).toFixed(1)},${y(v).toFixed(1)} `
      ouvert = true
    })
    return d.trim()
  }

  const jour = (s: string) => new Date(s + 'T00:00:00Z').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
  // Au-delà de 6 jalons les dates se chevauchent : on n'en écrit qu'une sur deux
  // et le premier comme le dernier sont toujours là.
  const pas = n > 6 ? 2 : 1

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
      aria-label={`Évolution du coût de revient par ${uniteVente} sur les huit dernières semaines`}>
      {/* Grille horizontale — quatre repères, discrets */}
      {[0, 0.25, 0.5, 0.75, 1].map(f => (
        <line key={f} x1={L} x2={W - R} y1={H - B - f * (H - T - B)} y2={H - B - f * (H - T - B)}
          className="stroke-gray-100" strokeWidth={1} />
      ))}
      {[0, 0.5, 1].map(f => (
        <text key={`e${f}`} x={L - 6} y={H - B - f * (H - T - B) + 3} textAnchor="end"
          className="fill-gray-400 text-[9px] tabular">{(maxE * f).toFixed(maxE < 10 ? 1 : 0)}&nbsp;€</text>
      ))}
      {series.marge && [0, 0.5, 1].map(f => (
        <text key={`m${f}`} x={W - R + 6} y={H - B - f * (H - T - B) + 3} textAnchor="start"
          className="fill-pilote-orange text-[9px] tabular">{Math.round(f * 100)}&nbsp;%</text>
      ))}

      {/* Prix de vente — plat, en gris : c'est le repère, pas le sujet */}
      {series.pv && points.some(p => p.pv !== null) && (
        <path d={trace(points.map(p => p.pv), Ye)} fill="none" strokeWidth={2}
          strokeDasharray="5 4" className="stroke-gray-300" strokeLinecap="round" />
      )}
      {/* Marge — l'accent orange, une seule fois sur l'écran */}
      {series.marge && points.some(p => p.marge !== null) && (
        <path d={trace(points.map(p => p.marge), Ym)} fill="none" strokeWidth={2}
          className="stroke-pilote-orange" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {/* Coût de revient — le sujet, en navy plein */}
      {series.cout && (
        <path d={trace(points.map(p => p.cout), Ye)} fill="none" strokeWidth={2.5}
          className="stroke-pilote" strokeLinecap="round" strokeLinejoin="round" />
      )}

      {/* Points annotés de leur valeur — c'est ce qui rend la courbe lisible
          sans survol, et le survol n'existe pas sur le comptoir d'un atelier. */}
      {series.cout && points.map((p, i) => (
        <g key={p.d}>
          <circle cx={X(i)} cy={Ye(p.cout)} r={2.5} className="fill-pilote" />
          {(i === 0 || i === n - 1 || i % pas === 0) && (
            <text x={X(i)} y={Ye(p.cout) - 7} textAnchor="middle" className="fill-gray-600 text-[9px] font-semibold tabular">
              {p.cout.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </text>
          )}
        </g>
      ))}
      {series.marge && points.map((p, i) => (
        p.marge === null ? null : <circle key={`pm${p.d}`} cx={X(i)} cy={Ym(p.marge)} r={2} className="fill-pilote-orange" />
      ))}

      {/* Axe des dates */}
      {points.map((p, i) => (
        (i === 0 || i === n - 1 || i % pas === 0)
          ? <text key={`d${p.d}`} x={X(i)} y={H - 10} textAnchor="middle" className="fill-gray-400 text-[9px] tabular">{jour(p.d)}</text>
          : null
      ))}
    </svg>
  )
}

/** Le poids d'une fiche : brut, net, et le nombre de lignes SANS poids connu */
export type FichePoids = { net: number; brut: number; horsAssiette: number }

/**
 * Le tableau des ingrédients — nom (+ dernière réf fournisseur facturée),
 * quantité, **part de poids**, coût, **part de coût**.
 *
 * Les deux pourcentages lus ensemble répondent à la question qu'un boucher se
 * pose devant une fiche : « qu'est-ce qui pèse dans mon coût, et est-ce que ça
 * pèse dans ma recette ? » Un boyau à 1 % du poids et 10 % du coût saute alors
 * aux yeux — invisible dans une colonne seule.
 */
export function TableauIngredients({
  ingredients, ratio, palierActif, coutMatiere, poids, avecEmballage,
  confirmIng, saving, onRemove, onCancelConfirm,
}: {
  ingredients: FicheIngredient[]
  /** Multiplicateur de quantité du palier choisi (1 = base) */
  ratio: number
  /** Un palier est sélectionné — l'en-tête « Qté » le rappelle */
  palierActif: boolean
  /** Matière + emballage du batch — le dénominateur de la part de coût */
  coutMatiere: number
  poids: FichePoids
  /** La fiche porte de l'emballage — le pied le dit */
  avecEmballage: boolean
  /** Index de la ligne en attente de confirmation de retrait */
  confirmIng: number | null
  saving: boolean
  /** Premier clic : demande confirmation. Second clic : retire la ligne. */
  onRemove: (index: number) => void
  /** La confirmation perd le focus — on la referme sans rien retirer */
  onCancelConfirm: () => void
}) {
  return (
    <>
      <div className="overflow-x-auto max-h-[30rem] overflow-y-auto">
        <table className="w-full min-w-[520px]">
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-50 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              <th className="px-3.5 py-2.5 text-left">
                Ingrédient
                <span className="block text-[10px] font-normal normal-case tracking-normal text-gray-300">dernière réf. fournisseur facturée</span>
              </th>
              <th className="px-3.5 py-2.5 text-right align-bottom">Qté{palierActif ? ` (×${(Math.round(ratio * 100) / 100).toLocaleString('fr-FR')})` : ''}</th>
              <th className="px-3.5 py-2.5 text-right align-bottom">Poids (%)</th>
              <th className="px-3.5 py-2.5 text-right align-bottom">Coût (€)</th>
              <th className="px-3.5 py-2.5 text-right align-bottom">Coût (%)</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {ingredients.map((ing, i) => {
              const coutPct = coutMatiere > 0 ? (ing.line_total_ht / coutMatiere) * 100 : null
              const kg = ligneKg(ing)
              const poidsPct = kg !== null && poids.brut > 0 ? (kg.brut / poids.brut) * 100 : null
              const loss = Number(ing.loss_pct) || 0
              const uniteAffichee = ing.generic_id ? (ing.qty_unit === 'piece' ? 'pièce' : ing.qty_unit || '') : (ing.unit || '')
              return (
                <tr key={i} className="group border-t border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="px-3.5 py-2.5">
                    <span className="text-sm font-semibold text-gray-900">{ing.label}</span>
                    {ing.categorie === 'emballage' && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wider text-blue-700 bg-blue-50 rounded px-1.5 py-0.5">Emballage</span>}
                    {ing.sub_recipe_id && (
                      <Link href={`/dashboard/recettes/${ing.sub_recipe_id}`}
                        title="Sous-recette — coût complet de la fiche ÷ son rendement, relu en continu. Cliquer pour l'ouvrir."
                        className="ml-1.5 text-[10px] font-semibold uppercase tracking-wider text-pilote bg-pilote-50 ring-1 ring-pilote-100 rounded px-1.5 py-0.5 hover:bg-pilote-100 transition-colors">
                        Sous-recette
                      </Link>
                    )}
                    {ing.price_source === 'aucun' && <span className="ml-1.5 text-[10px] font-semibold text-amber-600">{ing.sub_recipe_id ? 'rendement de la sous-fiche requis' : 'prix manquant'}</span>}
                    {ing.price_source === 'manuel' && <span className="ml-1.5 text-[10px] text-gray-400">prix manuel</span>}
                    {ing.sub_incomplete && <span className="ml-1.5 text-[10px] font-semibold text-amber-600">coût de la sous-fiche incomplet</span>}
                    {/* De QUAND date ce prix. Même code que la mercuriale :
                        au-delà de 30 jours, l'orange signale que le chiffre
                        a vieilli — c'est sur lui que se décide un PV. */}
                    {ing.price_source === 'mercuriale' && ing.price_date && (() => {
                      const j = ageJours(ing.price_date)
                      if (j === null) return null
                      return (
                        <span className={`ml-1.5 text-[10px] tabular ${j > 30 ? 'font-semibold text-orange-500' : 'text-gray-400'}`}
                          title={`Dernière facture connue pour cet article : ${fmtDateFr(ing.price_date)}`}>
                          prix du {fmtDateFr(ing.price_date)}{j > 30 ? ` · ${j} j` : ''}
                        </span>
                      )
                    })()}
                    {/* La réf telle qu'elle est écrite sur la facture : le
                        générique s'appelle « BOYAUX MOUTON 24 26 », la
                        ligne facturée « BOYAU MENU MOUTON 24/26A SUR TUB
                        15 … ». C'est ce nom-là qu'on retrouve chez le
                        fournisseur quand on veut discuter le prix. */}
                    {ing.price_ref_name && (() => {
                      // Le libellé stocké est celui du connecteur : « Facture
                      // DAVID MASTELLA - 608488 ». Affiché brut, il faisait
                      // passer une nature de pièce et un numéro de facture pour
                      // le nom d'une maison. Même nettoyage que la mercuriale,
                      // même fonction — et rien quand il ne reste pas une seule
                      // lettre exploitable.
                      const maison = nomFournisseur(ing.price_ref_supplier)
                      const suffixe = maison ? ` — ${maison}` : ''
                      return (
                        <p className="text-[11px] italic text-gray-400 truncate max-w-[18rem]"
                          title={`Prix repris de la réf facturée « ${ing.price_ref_name} »${suffixe}`}>
                          {ing.price_ref_name}{suffixe}
                        </p>
                      )
                    })()}
                  </td>
                  <td className="px-3.5 py-2.5 text-right tabular">
                    <span className="text-sm font-semibold text-gray-900">{fmtQty(ing.quantity * ratio)} {uniteAffichee}</span>
                    {loss > 0 && <p className="text-[11px] text-gray-400">({fmtQty(ing.qty_brute * ratio)} {ing.generic_id ? unitFr(ing.qty_unit === 'g' ? 'kg' : ing.qty_unit) : uniteAffichee} brut · perte {loss.toLocaleString('fr-FR')} %)</p>}
                  </td>
                  <td className="px-3.5 py-2.5 text-right text-sm text-gray-600 tabular">
                    {poidsPct !== null
                      ? pctFmt(poidsPct)
                      : <span className="text-gray-300" title="Ligne comptée à la pièce : sans poids connu, elle ne peut pas prendre de part de poids.">—</span>}
                  </td>
                  <td className="px-3.5 py-2.5 text-right text-sm font-semibold text-gray-900 tabular">{ing.unit_price_ht !== null ? fmtEuro(ing.line_total_ht * ratio) : '—'}</td>
                  <td className="px-3.5 py-2.5 text-right text-sm text-gray-600 tabular">{coutPct !== null && ing.unit_price_ht !== null ? pctFmt(coutPct) : '—'}</td>
                  <td className="pr-2 text-right">
                    {confirmIng === i ? (
                      <button onClick={() => onRemove(i)} onBlur={onCancelConfirm}
                        className="text-[10px] font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg px-1.5 py-1 whitespace-nowrap" title="Confirmer le retrait">
                        OK ?
                      </button>
                    ) : (
                      <button onClick={() => onRemove(i)} disabled={saving}
                        className="p-1 rounded-lg text-gray-300 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all" title="Retirer cet ingrédient">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="bg-pilote text-white">
              <td className="px-3.5 py-2.5 text-[11px] font-bold uppercase tracking-wider text-white/60">Total matière{avecEmballage ? ' + emb.' : ''}</td>
              <td className="px-3.5 py-2.5 text-right font-bold tabular text-sm">
                {poids.brut > 0 ? (
                  <>
                    {fmtQty(poids.brut * ratio)} kg <span className="font-semibold text-white/60">brut</span>
                    {Math.abs(poids.brut - poids.net) >= 0.005 && (
                      <span className="block text-[10px] font-semibold text-white/60">{fmtQty(poids.net * ratio)} kg net</span>
                    )}
                  </>
                ) : ''}
              </td>
              <td className="px-3.5 py-2.5 text-right font-bold tabular text-white/70 text-sm">{poids.brut > 0 ? '100 %' : '—'}</td>
              <td className="px-3.5 py-2.5 text-right font-bold tabular text-sm">{fmtEuro(coutMatiere * ratio)}</td>
              <td className="px-3.5 py-2.5 text-right font-bold tabular text-white/70 text-sm">100 %</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Ce que la colonne « Poids (%) » ne couvre PAS. Sans cette ligne,
          une fiche moitié en pièces afficherait des parts de poids qui ne
          totalisent visiblement pas 100 % sans que rien ne l'explique. */}
      {poids.horsAssiette > 0 && (
        <p className="px-3.5 py-2 text-[11px] text-gray-400 border-t border-gray-100">
          {poids.horsAssiette} ligne{poids.horsAssiette > 1 ? 's' : ''} comptée{poids.horsAssiette > 1 ? 's' : ''} à la pièce
          {poids.brut > 0
            ? <> — sans poids connu, {poids.horsAssiette > 1 ? 'elles restent' : 'elle reste'} hors de l&apos;assiette du % de poids (le % de coût, lui, {poids.horsAssiette > 1 ? 'les' : 'l’'}inclut).</>
            : <> : aucune ligne pesable sur cette fiche, la colonne « Poids (%) » n&apos;a rien à répartir.</>}
        </p>
      )}
    </>
  )
}
