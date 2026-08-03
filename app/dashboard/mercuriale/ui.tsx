'use client'

// Briques d'affichage de la mercuriale — formats, courbes et blocs de la fiche
// produit enrichie (lot 41, modèle Otami). Sorties de page.tsx : la page garde
// la logique (états, appels API, filtres), ce module garde le dessin. Tout ce
// qui est ici est PUR — des props vers du JSX, aucun état, aucun fetch.

import { TrendingUp, TrendingDown } from 'lucide-react'

// ── Formats partagés ──────────────────────────────────────

export const fmtEuro = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
export const fmtQty = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 3 })
export const fmtDate = (s: string | null) => (s ? new Date(s + 'T00:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—')

/** Nom de fournisseur LISIBLE. Le connecteur stocke des libellés générés du
 *  genre « Facture AURIBAULT OIRY - 15299292 (label généré) » : affichés tels
 *  quels, ils noient le nom qui compte au milieu d'un numéro de pièce. On garde
 *  la maison, pas la référence de la facture. */
export const nomFournisseur = (s: string | null | undefined): string => {
  const t = String(s ?? '').trim()
  if (!t) return ''
  return t
    .replace(/^(facture|avoir)\s+/i, '')
    .replace(/\s*\(label\s+g[ée]n[ée]r[ée]\)\s*$/i, '')
    // Numéro de pièce en fin de libellé : EXIGE un espace avant le tiret et au
    // moins un chiffre — sinon « SOCIETE JEAN-CHARLES » perdrait son Charles.
    .replace(/\s+-\s*(?=[A-Za-z0-9/-]*\d)[A-Za-z0-9/-]{4,}$/, '')
    .trim() || t
}
export const unitLabel = (u: 'kg' | 'piece') => (u === 'kg' ? 'kg' : 'pièce')

/** Âge d'un prix en jours — au-delà de 30 j, les écrans le signalent */
export const priceAge = (d: string | null) => (d ? Math.floor((Date.now() - new Date(d + 'T00:00:00Z').getTime()) / 86400000) : null)

/** « Pas de prix » a quatre causes qui appellent quatre gestes différents.
 *  Les nommer, c'est la différence entre un écran qui constate et un écran
 *  qui dit quoi faire. */
export const MOTIF_PRIX: Record<string, { court: string; quoi_faire: string }> = {
  aucune_ref:      { court: 'aucune réf rattachée',   quoi_faire: 'Rattachez une réf fournisseur à cet article depuis l’onglet « À traiter ».' },
  conversion:      { court: 'conversion manquante',   quoi_faire: 'Une réf est facturée dans une autre unité : indiquez sa conversion dans l’onglet « À traiter ».' },
  quarantaine:     { court: 'prix refusés à la lecture', quoi_faire: 'Des prix ont été lus mais écartés faute de vérification. Relancez la lecture de la facture concernée.' },
  jamais_facture:  { court: 'jamais facturé',         quoi_faire: 'Aucune facture lue ne porte encore cet article — le prix arrivera à la prochaine lecture.' },
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
  return (
    <div className="mb-2.5 bg-white border border-gray-100 rounded-xl overflow-hidden">
      <div className="px-3.5 py-2 bg-gray-50/80 flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Historique des achats — facture par facture</p>
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
