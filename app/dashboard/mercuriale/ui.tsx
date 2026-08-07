'use client'

// Briques d'affichage de la mercuriale — formats, courbes, blocs de la fiche
// produit enrichie (lot 41) et vue « Rayons » (lot 42), modèle Otami. Sorties
// de page.tsx : la page garde les états et les appels API, ce module garde le
// dessin — dérivations d'affichage comprises (regroupements par rayon). Rien
// ici ne pose d'état persistant ni ne fetch.

import { useMemo } from 'react'
import { TrendingUp, TrendingDown, Store, ChevronRight, Lock } from 'lucide-react'
import { matchFamilyId, type MarginFamily } from '@/lib/margin-families'
import { nomFournisseur } from '@/lib/supplier-name'

// ── Formats partagés ──────────────────────────────────────

export const fmtEuro = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
export const fmtQty = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 3 })
export const fmtDate = (s: string | null) => (s ? new Date(s + 'T00:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—')

/** Nom de fournisseur LISIBLE. Le connecteur stocke des libellés générés du
 *  genre « Facture AURIBAULT OIRY - 15299292 (label généré) » : affichés tels
 *  quels, ils noient le nom qui compte au milieu d'un numéro de pièce.
 *
 *  Le nettoyage vit désormais dans `lib/supplier-name` — les fiches recettes
 *  l'affichent AUSSI, sous chaque ingrédient, depuis le lot 44. Ré-exporté ici
 *  pour que les vingt appels de la page n'aient pas à changer d'import. */
export { nomFournisseur }
export const unitLabel = (u: 'kg' | 'piece') => (u === 'kg' ? 'kg' : 'pièce')

/** Âge d'un prix en jours — au-delà de 30 j, les écrans le signalent */
export const priceAge = (d: string | null) => (d ? Math.floor((Date.now() - new Date(d + 'T00:00:00Z').getTime()) / 86400000) : null)

/** « Pas de prix » a cinq causes qui appellent cinq gestes différents.
 *  Les nommer, c'est la différence entre un écran qui constate et un écran
 *  qui dit quoi faire.
 *
 *  `decoupe_sans_carcasse` corrige un reproche injuste : un morceau de découpe
 *  n'a PAS de fournisseur, et lui demander d'en rattacher un envoyait le
 *  boucher chercher quelque chose qui n'existe pas. Son prix vient d'une
 *  carcasse enregistrée — c'est le seul geste qui le lui donnera. */
export type MotifPrix = 'aucune_ref' | 'conversion' | 'quarantaine' | 'jamais_facture' | 'decoupe_sans_carcasse'

export const MOTIF_PRIX: Record<string, { court: string; quoi_faire: string }> = {
  aucune_ref:      { court: 'aucune réf rattachée',   quoi_faire: 'Rattachez une réf fournisseur à cet article depuis l’onglet « À traiter ».' },
  conversion:      { court: 'conversion manquante',   quoi_faire: 'Une réf est facturée dans une autre unité : indiquez sa conversion dans l’onglet « À traiter ».' },
  quarantaine:     { court: 'prix refusés à la lecture', quoi_faire: 'Des prix ont été lus mais écartés faute de vérification. Relancez la lecture de la facture concernée.' },
  jamais_facture:  { court: 'jamais facturé',         quoi_faire: 'Aucune facture lue ne porte encore cet article — le prix arrivera à la prochaine lecture.' },
  decoupe_sans_carcasse: { court: 'aucune carcasse chiffrée', quoi_faire: 'Ce morceau vient de la découpe, pas d’un fournisseur : son prix arrivera dès que vous aurez enregistré une carcasse de cette espèce avec son poids et son coût, dans l’écran Valorisation.' },
}

// ── Types de la fiche enrichie (lot 41) ──────────────────

/** Point d'historique : date de facture + prix payé, à l'unité de base */
export type PricePoint = { d: string; p: number }

export type FicheMois = { m: string; qte: number; montant: number; nb: number; prix_moyen: number | null }
export type FicheLigne = {
  id: string
  d: string
  fournisseur: string | null
  numero: string | null
  invoice_id: string | null
  ref: string
  qte: number | null
  pu: number
  montant: number | null
  /** Dépense cumulée depuis le début de la fenêtre 12 mois, cette ligne incluse */
  cumul: number
}
export type FicheDetail = {
  generic: { id: string; name: string; base_unit: 'kg' | 'piece' }
  moy_3m: number | null
  moy_12m: number | null
  total_12m: number
  qte_12m: number
  mois: FicheMois[]
  lignes: FicheLigne[]
  lignes_total: number
  lignes_ecartees: number
  quarantaine_12m: number
  lecture_incomplete: string | null
  /** Un prix qui vaut un multiple ENTIER de la lecture précédente (lot 119).
   *  `null` dans l'immense majorité des cas. */
  saut_de_prix: {
    facteur: number
    jours: number
    corrobore: boolean
    phrase: string
    recente: { date: string; prix: number; quantite: number | null; facture?: string | null }
    precedente: { date: string; prix: number; quantite: number | null; facture?: string | null }
  } | null
}

// ── Petits composants ─────────────────────────────────────

export function Variation({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-gray-300">—</span>
  const up = pct > 0
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold tabular ${up ? 'text-red-600' : 'text-green-600'}`}>
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {pct > 0 ? '+' : ''}{pct.toLocaleString('fr-FR')} %
    </span>
  )}

/** Courbe d'historique d'un générique : x = DATE du point, y = prix à l'unité
 *  de base. Trait navy, dernier prix marqué en orange — l'unique accent.
 *
 *  L'axe des x plaçait les points par RANG, alors que les étiquettes en dessous
 *  sont des dates : un prix stable onze mois puis un bond la semaine dernière se
 *  dessinait comme une montée régulière, c'est-à-dire l'inverse de ce qui s'est
 *  passé. Les paliers se voient maintenant tels quels — un plat long reste plat.
 *  Un escalier (« le prix a tenu jusqu'ici, puis a sauté ») est plus honnête
 *  qu'une diagonale : le prix payé n'a pas glissé entre deux factures. */
export function Sparkline({ points }: { points: PricePoint[] }) {
  const W = 240, H = 48, PAD = 5
  const ps = points.map(x => x.p)
  const min = Math.min(...ps), max = Math.max(...ps)
  const span = max - min
  const jour = (d: string) => new Date(d + 'T00:00:00Z').getTime()
  const t0 = jour(points[0]?.d ?? ''), t1 = jour(points[points.length - 1]?.d ?? '')
  const dt = t1 - t0
  const X = (i: number) => {
    if (points.length < 2) return W / 2
    // Dates identiques ou illisibles : repli sur le rang plutôt qu'un NaN
    if (!Number.isFinite(dt) || dt <= 0) return PAD + (i / (points.length - 1)) * (W - PAD * 2)
    return PAD + ((jour(points[i].d) - t0) / dt) * (W - PAD * 2)
  }
  const Y = (p: number) => (span === 0 ? H / 2 : H - PAD - ((p - min) / span) * (H - PAD * 2))
  // Tracé en ESCALIER : le prix tient jusqu'à la facture suivante, puis change.
  const d = ps.map((p, i) => (i === 0
    ? `M${X(0).toFixed(1)},${Y(p).toFixed(1)}`
    : `L${X(i).toFixed(1)},${Y(ps[i - 1]).toFixed(1)} L${X(i).toFixed(1)},${Y(p).toFixed(1)}`)).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-12" role="img" aria-label="Historique du prix sur 12 mois">
      {points.length >= 2 && (
        <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="text-pilote" />
      )}
      <circle cx={X(points.length - 1)} cy={Y(ps[ps.length - 1] ?? 0)} r={3.5} className="fill-pilote-orange" />
    </svg>
  )
}

/** Achats par mois (lot 41, modèle Otami) : barres = quantités achetées (repli
 *  sur les montants quand les factures ne portent pas de quantité), ligne =
 *  prix moyen payé le mois. C'est la réponse à « ma dépense monte : parce que
 *  je paie plus cher, ou parce que j'achète plus ? ». Échelles indépendantes,
 *  dernier prix en orange (l'unique accent), détail au survol de chaque barre. */
function AchatsMensuels({ mois, baseUnit }: { mois: FicheMois[]; baseUnit: 'kg' | 'piece' }) {
  const W = 300, H = 72, PAD = 4, HAUT = 10
  const enQte = mois.some(m => m.qte > 0)
  const vals = mois.map(m => (enQte ? m.qte : m.montant))
  const vmax = Math.max(...vals, 0)
  const slot = (W - PAD * 2) / 12
  const bw = slot * 0.62
  const prix = mois.map(m => m.prix_moyen).filter((p): p is number => p !== null)
  const pmin = Math.min(...prix), pmax = Math.max(...prix)
  const pspan = pmax - pmin
  const Xc = (i: number) => PAD + slot * i + slot / 2
  const Yp = (p: number) => (pspan === 0 ? HAUT + (H - HAUT - 16) / 2 : HAUT + (1 - (p - pmin) / pspan) * (H - HAUT - 16))
  const pts = mois
    .map((m, i) => (m.prix_moyen !== null ? `${Xc(i).toFixed(1)},${Yp(m.prix_moyen).toFixed(1)}` : null))
    .filter((x): x is string => x !== null)
  let dernierIdx = -1
  for (let i = mois.length - 1; i >= 0; i--) { if (mois[i].prix_moyen !== null) { dernierIdx = i; break } }
  const moisCourt = (m: string) => new Date(m + '-01T00:00:00Z').toLocaleDateString('fr-FR', { month: 'short', year: '2-digit', timeZone: 'UTC' })
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[72px]" role="img" aria-label="Achats et prix moyen par mois sur 12 mois">
        {mois.map((m, i) => {
          const v = enQte ? m.qte : m.montant
          const h = vmax > 0 ? (v / vmax) * (H - HAUT - 4) : 0
          return (
            <rect key={m.m} x={(Xc(i) - bw / 2).toFixed(1)} y={(H - 2 - Math.max(h, m.nb > 0 ? 1.5 : 0)).toFixed(1)}
              width={bw.toFixed(1)} height={Math.max(h, m.nb > 0 ? 1.5 : 0).toFixed(1)} rx={1.5}
              className={i === dernierIdx ? 'fill-pilote-200' : 'fill-pilote-100'}>
              <title>{`${moisCourt(m.m)} : ${m.nb} achat${m.nb > 1 ? 's' : ''} · ${fmtQty(m.qte)} ${unitLabel(baseUnit)} · ${fmtEuro(m.montant)}${m.prix_moyen !== null ? ` · prix moyen ${fmtEuro(m.prix_moyen)} / ${unitLabel(baseUnit)}` : ''}`}</title>
            </rect>
          )
        })}
        {pts.length >= 2 && (
          <polyline points={pts.join(' ')} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="text-pilote" />
        )}
        {dernierIdx >= 0 && mois[dernierIdx].prix_moyen !== null && (
          <circle cx={Xc(dernierIdx)} cy={Yp(mois[dernierIdx].prix_moyen as number)} r={3} className="fill-pilote-orange" />
        )}
      </svg>
      <div className="flex justify-between gap-2 text-[10px] text-gray-400 mt-0.5">
        <span className="tabular">{moisCourt(mois[0].m)}</span>
        <span className="text-gray-300">barres : {enQte ? `${unitLabel(baseUnit)} achetés` : 'montants'} · ligne : prix moyen</span>
        <span className="tabular">{moisCourt(mois[mois.length - 1].m)}</span>
      </div>
    </div>
  )
}

// ── Blocs de la fiche produit enrichie (lot 41) ───────────

/** Tuile « Moy 3 mois » de la rangée min/max — absente tant que la fiche charge */
export function TuileMoy3Mois({ fiche }: { fiche: FicheDetail | undefined }) {
  if (!fiche || fiche.moy_3m === null) return null
  return (
    <div>
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Moy 3 mois</p>
      <p className="text-sm font-extrabold text-gray-900 tabular" title="Moyenne des prix payés sur les 90 derniers jours">{fmtEuro(fiche.moy_3m)}</p>
    </div>
  )
}

/** Achats par mois + totaux 12 mois : barres = quantités, ligne = prix moyen —
 *  pour distinguer « on paie plus cher » de « on achète plus ». */
export function BlocAchatsMensuels({ fiche, baseUnit }: { fiche: FicheDetail | undefined; baseUnit: 'kg' | 'piece' }) {
  if (!fiche || !fiche.mois.some(m => m.nb > 0)) return null
  return (
    <div className="mb-2.5 bg-white border border-gray-100 rounded-xl px-3.5 py-2.5 flex items-center gap-6 flex-wrap">
      <div className="w-72 flex-shrink-0">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Achats par mois — quantités et prix moyen</p>
        <AchatsMensuels mois={fiche.mois} baseUnit={baseUnit} />
      </div>
      <div>
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Acheté 12 mois</p>
        <p className="text-sm font-extrabold text-gray-900 tabular">{fmtQty(fiche.qte_12m)} {unitLabel(baseUnit)}</p>
      </div>
      <div>
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Dépensé 12 mois</p>
        <p className="text-sm font-extrabold text-gray-900 tabular">{fmtEuro(fiche.total_12m)}</p>
      </div>
      {fiche.moy_12m !== null && (
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Prix moyen 12 mois</p>
          <p className="text-sm font-extrabold text-gray-900 tabular">{fmtEuro(fiche.moy_12m)} / {unitLabel(baseUnit)}</p>
        </div>
      )}
    </div>
  )
}

/** Historique des achats : facture par facture, du plus récent au plus ancien,
 *  avec la dépense CUMULÉE depuis le début de la fenêtre 12 mois. Chaque écart
 *  de lecture est annoncé — jamais de troncature muette. */
export function BlocHistoriqueAchats({ fiche, baseUnit }: { fiche: FicheDetail | undefined; baseUnit: 'kg' | 'piece' }) {
  if (!fiche || fiche.lignes.length === 0) return null
  const avertissements = [
    fiche.lignes_total > fiche.lignes.length ? `les ${fiche.lignes.length} achats les plus récents sont affichés (sur ${fiche.lignes_total})` : null,
    fiche.lignes_ecartees > 0 ? `${fiche.lignes_ecartees} ligne${fiche.lignes_ecartees > 1 ? 's' : ''} hors unité de base non comptée${fiche.lignes_ecartees > 1 ? 's' : ''} (conversion manquante)` : null,
    fiche.quarantaine_12m > 0 ? `${fiche.quarantaine_12m} prix refusé${fiche.quarantaine_12m > 1 ? 's' : ''} à la lecture non compté${fiche.quarantaine_12m > 1 ? 's' : ''}` : null,
    fiche.lecture_incomplete,
  ].filter((x): x is string => x !== null)
  const saut = fiche.saut_de_prix
  return (
    <div className="mb-2.5 bg-white border border-gray-100 rounded-xl overflow-hidden">
      {/* UN PRIX QUI EST LE MULTIPLE ENTIER DU PRÉCÉDENT N'EST PAS UNE HAUSSE.
          Placé ICI, en tête de l'historique facture par facture : c'est le seul
          endroit de l'écran où le boucher a les deux lectures sous les yeux et
          peut trancher. Une alerte loin de sa preuve ne se traite pas. */}
      {saut !== null && (
        <div className="px-3.5 py-2.5 bg-amber-50 border-b border-amber-200">
          <p className="text-[11px] font-bold text-amber-900 whitespace-nowrap">
            Prix multiplié par {saut.facteur.toLocaleString('fr-FR')} — à vérifier
          </p>
          <p className="text-[11px] text-amber-800 mt-0.5 leading-relaxed">{saut.phrase}</p>
        </div>
      )}
      <div className="px-3.5 py-2 bg-gray-50/80 flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Historique des achats — facture par facture</p>
        <p className="text-[11px] text-gray-500 tabular">{fiche.lignes_total} achat{fiche.lignes_total > 1 ? 's' : ''} · {fmtEuro(fiche.total_12m)} sur 12 mois</p>
      </div>
      <div className="max-h-60 overflow-y-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              <th className="sticky top-0 bg-gray-50 px-3.5 py-1.5 font-semibold">Date</th>
              <th className="sticky top-0 bg-gray-50 px-2 py-1.5 font-semibold">Fournisseur · réf</th>
              <th className="sticky top-0 bg-gray-50 px-2 py-1.5 font-semibold text-right">Qté</th>
              <th className="sticky top-0 bg-gray-50 px-2 py-1.5 font-semibold text-right">€ / {unitLabel(baseUnit)}</th>
              <th className="sticky top-0 bg-gray-50 px-2 py-1.5 font-semibold text-right">Montant</th>
              <th className="sticky top-0 bg-gray-50 px-3.5 py-1.5 font-semibold text-right">Cumul</th>
            </tr>
          </thead>
          <tbody>
            {fiche.lignes.map(l => (
              <tr key={l.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                <td className="px-3.5 py-1.5 text-gray-500 tabular whitespace-nowrap">{fmtDate(l.d)}</td>
                <td className="px-2 py-1.5">
                  <span className="font-semibold text-gray-800" title={l.numero ? `Facture n° ${l.numero}` : undefined}>{nomFournisseur(l.fournisseur) || '—'}</span>
                  <span className="text-gray-400"> · {l.ref}</span>
                </td>
                <td className="px-2 py-1.5 text-right text-gray-500 tabular whitespace-nowrap">{l.qte !== null ? `${fmtQty(l.qte)} ${unitLabel(baseUnit)}` : '—'}</td>
                <td className="px-2 py-1.5 text-right font-semibold text-gray-900 tabular">{fmtEuro(l.pu)}</td>
                <td className="px-2 py-1.5 text-right text-gray-700 tabular">{l.montant !== null ? fmtEuro(l.montant) : '—'}</td>
                <td className="px-3.5 py-1.5 text-right text-gray-400 tabular">{fmtEuro(l.cumul)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {avertissements.length > 0 && (
        <p className="px-3.5 py-1.5 text-[10px] text-gray-400 border-t border-gray-50">{avertissements.join(' · ')}</p>
      )}
    </div>
  )
}

// ── Vue « Rayons » (lot 42, modèle Otami) ─────────────────

/** Produit tel que la vue « Rayons » a besoin de le voir — structurellement
 *  compatible avec le Generic de la page (typage structurel TS). */
export type ProduitRayon = {
  id: string
  name: string
  base_unit: 'kg' | 'piece'
  price_ht: number | null
  price_date: string | null
  variation_pct: number | null
  refs_count: number
  depense_12m?: number
  achats_12m?: number
}

/** La mercuriale par RAYON de la boutique : chaque famille racine du
 *  référentiel des marges avec sa dépense réelle 12 mois, puis les produits du
 *  rayon classés par sous-famille et triés par dépense — la navigation
 *  produits d'Otami (rayon → sous-famille → réf, cumuls € à chaque étage).
 *  La dépense hors catalogue (réfs pas encore rapprochées) est ANNONCÉE :
 *  un total par rayon qui la tairait se lirait comme un total complet. */
export function VueRayons({ produits, familles, search, sel, onSel, onOuvrirProduit, horsCatalogue, onVoirATraiter }: {
  produits: ProduitRayon[]
  familles: MarginFamily[]
  search: string
  sel: string | null
  onSel: (nom: string | null) => void
  onOuvrirProduit: (id: string) => void
  horsCatalogue: number
  onVoirATraiter: () => void
}) {
  const rayons = useMemo(() => {
    const q = search.trim().toLowerCase()
    const retenus = q ? produits.filter(p => p.name.toLowerCase().includes(q)) : produits
    const famById = new Map(familles.map(f => [f.id, f]))
    const parRayon = new Map<string, { depense: number; nbRefs: number; achats: number; sections: Map<string, { depense: number; produits: ProduitRayon[] }> }>()
    for (const p of retenus) {
      const fid = matchFamilyId(p.name, familles)
      const fam = fid ? famById.get(fid) ?? null : null
      const racine = fam ? (fam.parent_id ? famById.get(fam.parent_id)?.name ?? fam.name : fam.name) : 'Autres'
      const sousTitre = fam && fam.parent_id ? fam.name : ''
      const r = parRayon.get(racine) || { depense: 0, nbRefs: 0, achats: 0, sections: new Map() }
      r.depense += p.depense_12m || 0
      r.nbRefs += p.refs_count
      r.achats += p.achats_12m || 0
      const s = r.sections.get(sousTitre) || { depense: 0, produits: [] }
      s.depense += p.depense_12m || 0
      s.produits.push(p)
      r.sections.set(sousTitre, s)
      parRayon.set(racine, r)
    }
    return [...parRayon.entries()].map(([nom, r]) => ({
      nom,
      depense: Math.round(r.depense * 100) / 100,
      nbRefs: r.nbRefs,
      achats: r.achats,
      nbProduits: [...r.sections.values()].reduce((s, x) => s + x.produits.length, 0),
      sections: [...r.sections.entries()]
        .map(([titre, s]) => ({
          titre,
          depense: Math.round(s.depense * 100) / 100,
          produits: [...s.produits].sort((a, b) => (b.depense_12m || 0) - (a.depense_12m || 0) || a.name.localeCompare(b.name, 'fr')),
        }))
        .sort((a, b) => b.depense - a.depense || b.produits.length - a.produits.length || (a.titre || '').localeCompare(b.titre || '', 'fr')),
    })).sort((a, b) => b.depense - a.depense || b.nbProduits - a.nbProduits || a.nom.localeCompare(b.nom, 'fr'))
  }, [produits, familles, search])

  const rayonOuvert = sel !== null ? rayons.find(r => r.nom === sel) ?? null : null

  if (rayonOuvert === null) {
    return (
      <div>
        <div className="flex items-baseline gap-2 mb-3">
          <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-700">Mes rayons</h2>
          <span className="text-[11px] text-gray-400 tabular">
            {rayons.length} rayon{rayons.length > 1 ? 's' : ''} · dépense réelle sur 12 mois, lue sur les factures
          </span>
        </div>
        {rayons.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-gray-200 py-14 text-center">
            <Store className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-500">Aucun rayon{search ? ' ne correspond à la recherche' : ' pour l’instant — ils se remplissent à chaque facture lue'}.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {rayons.map(r => (
              <button key={r.nom} onClick={() => onSel(r.nom)}
                className="text-left bg-white rounded-2xl border border-gray-100 shadow-card p-5 hover:shadow-card-hover hover:-translate-y-0.5 transition-all">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-pilote-50 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-extrabold text-pilote">{r.nom.slice(0, 2).toUpperCase()}</span>
                  </div>
                  <p className="text-sm font-bold text-gray-900 leading-snug flex-1">{r.nom}</p>
                </div>
                <p className="text-2xl font-extrabold tracking-tight text-gray-900 tabular">
                  {r.depense > 0 ? fmtEuro(r.depense) : '—'}
                  <span className="text-xs font-semibold text-gray-400 ml-1.5">/ 12 mois</span>
                </p>
                <p className="text-[11px] text-gray-500 mt-2 tabular">
                  {r.nbProduits} produit{r.nbProduits > 1 ? 's' : ''} · {r.nbRefs} réf{r.nbRefs > 1 ? 's' : ''}
                  {r.achats > 0 ? ` · ${r.achats} achat${r.achats > 1 ? 's' : ''}` : ''}
                </p>
              </button>
            ))}
          </div>
        )}
        {horsCatalogue > 0 && (
          <p className="mt-4 text-[11px] text-gray-400">
            + {fmtEuro(horsCatalogue)} d&apos;achats sur 12 mois portés par des réfs pas encore rapprochées — hors rayons tant qu&apos;elles ne sont pas rattachées à un produit.{' '}
            <button onClick={onVoirATraiter} className="font-semibold text-pilote hover:underline">Les rapprocher</button>
          </p>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <button onClick={() => onSel(null)}
          className="flex items-center gap-1 text-xs font-semibold text-pilote hover:underline">
          <ChevronRight className="w-3.5 h-3.5 rotate-180" />Tous les rayons
        </button>
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-700">{rayonOuvert.nom}</h2>
        <span className="text-[11px] text-gray-400 tabular">
          {fmtEuro(rayonOuvert.depense)} sur 12 mois · {rayonOuvert.nbProduits} produit{rayonOuvert.nbProduits > 1 ? 's' : ''} · {rayonOuvert.nbRefs} réf{rayonOuvert.nbRefs > 1 ? 's' : ''}
        </span>
      </div>
      {rayonOuvert.sections.map(sec => (
        <div key={sec.titre || '∅'} className="mb-5">
          {(rayonOuvert.sections.length > 1 || sec.titre !== '') && (
            <div className="flex items-baseline gap-2 mb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">{sec.titre || 'Sans sous-famille'}</h3>
              <span className="text-[11px] text-gray-400 tabular">{sec.produits.length} · {fmtEuro(sec.depense)}</span>
            </div>
          )}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden divide-y divide-gray-50">
            {sec.produits.map(p => {
              const age = priceAge(p.price_date)
              const vieux = age !== null && age > 30
              return (
                <div key={p.id} className="px-4 py-2.5 flex items-center gap-3 flex-wrap text-xs">
                  <button onClick={() => onOuvrirProduit(p.id)} title="Ouvrir la fiche dans « Prix du jour »"
                    className="text-sm font-semibold text-gray-900 hover:text-pilote hover:underline text-left flex-1 min-w-[200px]">
                    {p.name}
                  </button>
                  <span className="text-gray-500 tabular w-28 text-right flex-shrink-0">
                    {p.price_ht !== null ? `${fmtEuro(p.price_ht)} / ${unitLabel(p.base_unit)}` : '—'}
                  </span>
                  <span className={`tabular w-24 text-right flex-shrink-0 ${vieux ? 'text-amber-600 font-semibold' : 'text-gray-400'}`}
                    title={vieux ? `Dernier prix il y a ${age} jours — il a pu bouger depuis` : undefined}>
                    {fmtDate(p.price_date)}
                  </span>
                  <span className="w-16 text-right flex-shrink-0"><Variation pct={p.variation_pct} /></span>
                  <span className="w-28 text-right flex-shrink-0">
                    <span className="block font-bold text-gray-900 tabular">{p.depense_12m && p.depense_12m > 0 ? fmtEuro(p.depense_12m) : '—'}</span>
                    <span className="block text-[10px] text-gray-400 tabular">{p.achats_12m ? `${p.achats_12m} achat${p.achats_12m > 1 ? 's' : ''} / 12 mois` : ''}</span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Prix bloqués (lot 43, modèle Otami) ───────────────────

/** Une facture payée AU-DESSUS d'un prix bloqué — un écart à réclamer */
export type EcartBloque = {
  article_id: string
  ref_name: string
  supplier_name: string | null
  generic_id: string | null
  generic_name: string | null
  unit: string | null
  bloque: number
  paye: number
  qte: number | null
  /** (payé − bloqué) × quantité de la ligne — null si la facture n'a pas de quantité lue */
  ecart_ht: number | null
  date: string
  invoice_id: string | null
}

/** Verrou de prix d'une réf, dans la fiche produit : bloquer le prix négocié,
 *  le débloquer, ou voir depuis quand il tient. Le prix proposé par défaut est
 *  le dernier payé — on verrouille ce qu'on vient d'accepter. */
export function VerrouPrixRef({ r, draft, onDraft, onVerrou, enCours }: {
  r: { id: string; unit: string | null; last_price_ht: number | null; blocked_price_ht?: number | string | null; blocked_at?: string | null }
  draft: string
  onDraft: (v: string) => void
  onVerrou: (id: string, prix: number | null) => void
  enCours: boolean
}) {
  const bloque = r.blocked_price_ht !== null && r.blocked_price_ht !== undefined ? Number(r.blocked_price_ht) : null
  if (bloque !== null && bloque > 0) {
    return (
      <span className="flex items-center gap-1.5 text-[10px] font-semibold text-green-800 bg-green-50 ring-1 ring-green-200 rounded-full px-2 py-0.5 tabular"
        title={`Prix négocié verrouillé${r.blocked_at ? ` le ${fmtDate(String(r.blocked_at).slice(0, 10))}` : ''} — toute facture au-dessus sera signalée dans « À traiter »`}>
        <Lock className="w-3 h-3" />bloqué à {fmtEuro(bloque)}{r.unit ? ` / ${r.unit}` : ''}
        <button onClick={() => onVerrou(r.id, null)} disabled={enCours}
          className="font-bold underline hover:text-green-900 disabled:opacity-50">Débloquer</button>
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-[10px] text-gray-400 tabular">
      <input value={draft} inputMode="decimal"
        placeholder={r.last_price_ht !== null ? String(Number(r.last_price_ht)) : 'prix'}
        onChange={e => onDraft(e.target.value)}
        title="Prix négocié à verrouiller (par défaut : le dernier payé)"
        className="w-16 border border-gray-200 rounded px-1.5 py-0.5 text-right tabular bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200" />
      <button onClick={() => {
        const v = parseFloat((draft || '').replace(',', '.'))
        const prix = v > 0 ? v : (r.last_price_ht !== null ? Number(r.last_price_ht) : NaN)
        if (prix > 0) onVerrou(r.id, prix)
      }} disabled={enCours}
        title="Verrouiller le prix négocié avec le fournisseur : toute facture au-dessus sera signalée dans « À traiter »"
        className="flex items-center gap-1 font-semibold text-gray-400 hover:text-pilote transition-colors disabled:opacity-50">
        <Lock className="w-3 h-3" />Bloquer
      </button>
    </span>
  )
}

/** Écarts sur prix bloqués — section « À traiter » : le fournisseur a facturé
 *  au-dessus du prix convenu. Groupé par réf (le plus gros cumul d'abord),
 *  trois gestes par ligne : voir la facture, rebloquer au nouveau prix
 *  (l'accepter), ou déverrouiller. Le plafond de liste est annoncé, et un
 *  dépassement sans quantité lue est COMPTÉ comme non chiffré, jamais omis. */
export function BlocEcartsBloques({ ecarts, total, enCours, onOuvrirProduit, onVerrou }: {
  ecarts: EcartBloque[]
  total: number
  enCours: string | null
  onOuvrirProduit: (genericId: string) => void
  onVerrou: (articleId: string, prix: number | null) => void
}) {
  const groupes = useMemo(() => {
    const m = new Map<string, EcartBloque[]>()
    for (const e of ecarts) {
      const arr = m.get(e.article_id) || []
      arr.push(e)
      m.set(e.article_id, arr)
    }
    return [...m.values()].map(lignes => {
      const tri = [...lignes].sort((a, b) => String(b.date).localeCompare(String(a.date)))
      const cumul = tri.reduce((s, l) => s + (l.ecart_ht ?? 0), 0)
      const sansMontant = tri.filter(l => l.ecart_ht === null).length
      return { ref: tri[0], lignes: tri, cumul: Math.round(cumul * 100) / 100, sansMontant }
    }).sort((a, b) => b.cumul - a.cumul || String(b.ref.date).localeCompare(String(a.ref.date)))
  }, [ecarts])
  if (groupes.length === 0) return null
  return (
    <div className="mb-6 bg-white rounded-2xl border border-red-200 shadow-card overflow-hidden">
      <div className="px-4 py-2.5 bg-red-50/70 flex items-center gap-2 flex-wrap">
        <Lock className="w-4 h-4 text-red-600 flex-shrink-0" />
        <p className="text-sm font-bold text-gray-900 flex-1 min-w-[220px]">
          {groupes.length} prix bloqué{groupes.length > 1 ? 's' : ''} dépassé{groupes.length > 1 ? 's' : ''}
          <span className="ml-2 text-[11px] font-normal text-red-700">le fournisseur a facturé au-dessus du prix convenu — matière à demander un avoir</span>
        </p>
        {total > ecarts.length && (
          <span className="text-[11px] text-gray-400 tabular">les {ecarts.length} écarts les plus récents affichés (sur {total})</span>
        )}
      </div>
      <div className="divide-y divide-gray-100">
        {groupes.map(g => {
          const pct = g.ref.bloque > 0 ? Math.round(((g.ref.paye - g.ref.bloque) / g.ref.bloque) * 1000) / 10 : null
          return (
            <div key={g.ref.article_id} className="px-4 py-2.5 flex items-center gap-3 flex-wrap text-xs">
              <span className="flex-1 min-w-[220px]">
                <span className="text-sm font-semibold text-gray-900">{g.ref.ref_name}</span>
                <span className="block text-[11px] text-gray-400">
                  {nomFournisseur(g.ref.supplier_name) || '—'}
                  {g.ref.generic_id && g.ref.generic_name ? (
                    <>
                      {' · '}
                      <button onClick={() => onOuvrirProduit(g.ref.generic_id as string)} className="font-semibold text-pilote hover:underline">{g.ref.generic_name}</button>
                    </>
                  ) : null}
                </span>
              </span>
              <span className="tabular text-gray-500">
                bloqué à <strong className="text-gray-900">{fmtEuro(g.ref.bloque)}</strong>{g.ref.unit ? ` / ${g.ref.unit}` : ''}
                {' → payé '}<strong className="text-red-600">{fmtEuro(g.ref.paye)}</strong> le {fmtDate(g.ref.date)}
                {pct !== null ? <span className="font-bold text-red-600"> (+{pct.toLocaleString('fr-FR')} %)</span> : null}
              </span>
              <span className="tabular text-right">
                <span className="block font-bold text-red-600">{g.cumul > 0 ? `${fmtEuro(g.cumul)} d'écart` : '—'}</span>
                <span className="block text-[10px] text-gray-400">
                  {g.lignes.length} dépassement{g.lignes.length > 1 ? 's' : ''}
                  {g.sansMontant > 0 ? ` · ${g.sansMontant} sans quantité lue (non chiffré${g.sansMontant > 1 ? 's' : ''})` : ''}
                </span>
              </span>
              <span className="flex items-center gap-2 flex-shrink-0">
                {g.ref.invoice_id && (
                  <button onClick={() => window.open(`/api/invoices/${g.ref.invoice_id}/file`, '_blank')}
                    className="text-[11px] font-semibold text-gray-500 hover:text-pilote underline">voir la facture</button>
                )}
                <button onClick={() => onVerrou(g.ref.article_id, g.ref.paye)} disabled={enCours === g.ref.article_id}
                  title="Accepter le nouveau prix : le verrou repart de là"
                  className="text-[11px] font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg px-2.5 py-1 disabled:opacity-50">
                  Rebloquer à {fmtEuro(g.ref.paye)}
                </button>
                <button onClick={() => onVerrou(g.ref.article_id, null)} disabled={enCours === g.ref.article_id}
                  className="text-[11px] font-bold text-white bg-pilote hover:bg-pilote-hover rounded-lg px-2.5 py-1 shadow-card disabled:opacity-50">
                  Débloquer
                </button>
              </span>
            </div>
          )
        })}
      </div>
      <p className="px-4 py-2 text-[10px] text-gray-400 border-t border-gray-50">
        Un écart compare chaque facture postérieure au verrou avec le prix convenu, à l&apos;unité facturée de la réf. Rebloquer accepte le nouveau prix ; débloquer retire la surveillance.
      </p>
    </div>
  )
}
