'use client'

/**
 * LISTING DES PRIX — tout ce qui a un prix chez le boucher, sur une page.
 *
 * ─── LA BRANCHE DROITE DU SCHÉMA ──────────────────────────────────────────
 *
 * Mercuriale → fiches recettes / valorisation → LISTING DES PRIX. C'est le
 * dernier morceau du dessin de Théo : après avoir su ce qu'on paie (mercuriale),
 * ce que ça coûte à fabriquer (fiches) et ce que vaut un morceau de carcasse
 * (valorisation), on veut la LISTE — celle qu'on imprime, qu'on emporte au
 * comptoir, qu'on relit avant d'annoncer un prix.
 *
 * ─── AUCUN CALCUL NEUF, ET C'EST VOULU ────────────────────────────────────
 *
 * Cet écran ne calcule RIEN. Il assemble deux lectures qui existent déjà :
 *   · `/api/mercuriale` pour les prix d'ACHAT (garde-fou d'unités, quarantaine,
 *     morceaux de découpe et motifs de prix manquant compris) ;
 *   · `/api/recipes` pour les prix de VENTE (un par format, avec le coût de
 *     revient, la marge et le coefficient déjà arbitrés par `lib/recipes`).
 *
 * Un seul moteur par calcul : recalculer une marge ici, c'est se garantir qu'un
 * jour elle différera de celle de la fiche. La contrepartie est assumée : la
 * page charge deux gros points d'entrée, comme les deux écrans dont elle
 * reprend les chiffres.
 *
 * ─── DEUX COLONNES DE PRIX, JAMAIS UNE ────────────────────────────────────
 *
 * Un prix d'achat et un prix de vente ne se mélangent pas dans une colonne
 * « Prix ». Le boucher lirait 12,40 € sur une ligne et 24,90 € sur la suivante
 * sans savoir laquelle il paie et laquelle il encaisse. Deux colonnes
 * distinctes, une pastille de nature, et un tiret nommé partout où l'on ne
 * sait pas.
 *
 * ─── L'ANGLE MORT QUE CETTE PAGE RÉVÈLE ───────────────────────────────────
 *
 * Un produit acheté qu'aucune fiche ne vend n'apparaissait nulle part comme un
 * manque. Ici il se compte : c'est le chiffre le plus utile de l'écran, parce
 * qu'il désigne exactement le travail qui reste.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, RefreshCw, Search } from 'lucide-react'
import { TuileRoi, Tuile, TuileAlerte, TitreCarte, Absent } from '@/components/ui/da'

// ── Ce qu'on lit des deux API ──────────────────────────────────────────────
type Generic = {
  id: string
  name: string
  base_unit: 'kg' | 'piece'
  category: string | null
  price_ht: number | null
  price_date: string | null
  price_supplier: string | null
  price_missing_reason: string | null
  valorisation_cut_id?: string | null
}
type Format = {
  id: string
  name: string
  sell_unit: string | null
  selling_price_ttc: number | null
  tva_rate: number
  validated: boolean
  cout_unite_ht: number | null
  pv_unitaire_ht: number | null
  marge_pct: number | null
  coefficient: number | null
}
type Recipe = {
  id: string
  name: string
  category: string | null
  formats: Format[]
  cost?: { prix_manquants?: number }
}

/** Une ligne du listing. `achat` et `vente` ne sont JAMAIS renseignés tous les
 *  deux : une ligne est soit un produit qu'on achète, soit un format qu'on vend. */
type Ligne = {
  cle: string
  nom: string
  detail: string | null
  nature: 'achat' | 'vente'
  categorie: string | null
  unite: string
  achatHt: number | null
  venteTtc: number | null
  venteHt: number | null
  coutHt: number | null
  margePct: number | null
  coefficient: number | null
  origine: string | null
  /** Pourquoi il n'y a pas de prix, en clair. null = il y en a un. */
  motifAbsent: string | null
}

const MOTIFS_PRIX: Record<string, string> = {
  aucune_ref: 'aucune réf rattachée',
  quarantaine: 'prix en quarantaine',
  conversion: 'conversion d’unité à renseigner',
  jamais_facture: 'jamais facturé',
  decoupe_sans_carcasse: 'aucune carcasse chiffrée',
}

const eur = (n: number, d = 2) =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' €'

const uniteCourte = (u: string | null | undefined, base: 'kg' | 'piece' = 'kg') =>
  (u && u.trim()) ? u.trim() : (base === 'piece' ? 'pièce' : 'kg')

const FILTRES = [
  { cle: 'tout', label: 'Tout' },
  { cle: 'vente', label: 'Prix de vente' },
  { cle: 'achat', label: 'Prix d’achat' },
  { cle: 'sans', label: 'Sans prix' },
] as const

type CleFiltre = (typeof FILTRES)[number]['cle']

export default function ListingPrixPage() {
  const [lignes, setLignes] = useState<Ligne[] | null>(null)
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [recherche, setRecherche] = useState('')
  const [filtre, setFiltre] = useState<CleFiltre>('tout')

  const charger = useCallback(async () => {
    setChargement(true)
    setErreur(null)
    try {
      const [rm, rr] = await Promise.all([fetch('/api/mercuriale'), fetch('/api/recipes')])
      const [jm, jr] = await Promise.all([rm.json(), rr.json()])
      if (!rm.ok) throw new Error(jm?.error || 'Mercuriale illisible')
      if (!rr.ok) throw new Error(jr?.error || 'Fiches recettes illisibles')

      const out: Ligne[] = []

      // ── LES PRIX DE VENTE : un par format ────────────────────────────────
      // Un par FORMAT et non par fiche : une même recette vendue au kg et à la
      // portion a deux prix, et n'en montrer qu'un serait cacher l'autre.
      for (const r of (jr.recipes ?? []) as Recipe[]) {
        for (const f of r.formats ?? []) {
          out.push({
            cle: `v-${f.id}`,
            nom: r.name,
            detail: (r.formats?.length ?? 0) > 1 ? f.name : null,
            nature: 'vente',
            categorie: r.category,
            unite: uniteCourte(f.sell_unit),
            achatHt: null,
            venteTtc: f.selling_price_ttc,
            venteHt: f.pv_unitaire_ht,
            coutHt: f.cout_unite_ht,
            margePct: f.marge_pct,
            coefficient: f.coefficient,
            origine: f.validated ? 'fiche validée' : 'fiche recette',
            motifAbsent: f.selling_price_ttc && f.selling_price_ttc > 0
              ? null
              : 'aucun prix de vente sur ce format',
          })
        }
      }

      // ── LES PRIX D'ACHAT : un par produit du catalogue ───────────────────
      for (const g of (jm.generics ?? []) as Generic[]) {
        const raison = g.price_missing_reason
        out.push({
          cle: `a-${g.id}`,
          nom: g.name,
          detail: null,
          nature: 'achat',
          categorie: g.category,
          unite: uniteCourte(null, g.base_unit === 'piece' ? 'piece' : 'kg'),
          achatHt: g.price_ht,
          venteTtc: null,
          venteHt: null,
          coutHt: null,
          margePct: null,
          coefficient: null,
          // Un morceau de carcasse ne vient pas d'un fournisseur : son prix
          // sort de la découpe, et le dire évite de lire « — » comme un trou.
          origine: g.valorisation_cut_id
            ? 'découpe de carcasse'
            : (g.price_supplier ?? (g.price_date ? 'facture' : null)),
          motifAbsent: g.price_ht === null || g.price_ht === undefined
            ? (raison ? (MOTIFS_PRIX[raison] ?? raison) : 'aucun prix connu')
            : null,
        })
      }

      out.sort((a, b) => a.nom.localeCompare(b.nom, 'fr') || a.unite.localeCompare(b.unite, 'fr'))
      setLignes(out)
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Lecture impossible')
      setLignes(null)
    } finally {
      setChargement(false)
    }
  }, [])

  useEffect(() => { void charger() }, [charger])

  const visibles = useMemo(() => {
    if (!lignes) return []
    const q = recherche.trim().toLowerCase()
    return lignes.filter(l => {
      if (filtre === 'vente' && l.nature !== 'vente') return false
      if (filtre === 'achat' && l.nature !== 'achat') return false
      if (filtre === 'sans' && l.motifAbsent === null) return false
      if (!q) return true
      return l.nom.toLowerCase().includes(q)
        || (l.detail ?? '').toLowerCase().includes(q)
        || (l.categorie ?? '').toLowerCase().includes(q)
    })
  }, [lignes, recherche, filtre])

  const compte = useMemo(() => {
    const l = lignes ?? []
    const ventes = l.filter(x => x.nature === 'vente')
    return {
      total: l.length,
      ventes: ventes.length,
      achats: l.filter(x => x.nature === 'achat').length,
      sansPrix: l.filter(x => x.motifAbsent !== null).length,
      // La marge médiane plutôt que la moyenne : une fiche à 90 % de marge
      // tirerait une moyenne que le catalogue ne connaît nulle part.
      margeMediane: (() => {
        const m = ventes.map(x => x.margePct).filter((x): x is number => x !== null).sort((a, b) => a - b)
        if (m.length === 0) return null
        return m.length % 2 ? m[(m.length - 1) / 2] : (m[m.length / 2 - 1] + m[m.length / 2]) / 2
      })(),
    }
  }, [lignes])

  /** Export CSV — un listing sert à être emporté. Point-virgule et virgule
   *  décimale : c'est ce qu'un tableur français ouvre sans rien demander. */
  const exporter = useCallback(() => {
    const nombre = (n: number | null) => (n === null ? '' : String(n).replace('.', ','))
    const champ = (s: string | null) => `"${(s ?? '').replace(/"/g, '""')}"`
    const entetes = ['Produit', 'Format', 'Nature', 'Catégorie', 'Unité', 'Prix achat HT', 'Prix vente TTC', 'Prix vente HT', 'Coût HT', 'Marge %', 'Coefficient', 'Origine', 'Sans prix']
    const lignesCsv = visibles.map(l => [
      champ(l.nom), champ(l.detail), champ(l.nature === 'vente' ? 'Vente' : 'Achat'),
      champ(l.categorie), champ(l.unite),
      nombre(l.achatHt), nombre(l.venteTtc), nombre(l.venteHt), nombre(l.coutHt),
      nombre(l.margePct), nombre(l.coefficient), champ(l.origine), champ(l.motifAbsent),
    ].join(';'))
    // Le BOM : sans lui, un tableur français lit « Coût » comme « CoÃ»t ».
    const blob = new Blob(['﻿' + [entetes.join(';'), ...lignesCsv].join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `listing-prix-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [visibles])

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-encre-fort">Listing des prix</h1>
          <p className="mt-1 text-sm text-encre-doux">
            Ce que vous payez, ce que vous vendez, sur une seule liste.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exporter}
            disabled={!lignes || visibles.length === 0}
            className="flex min-h-[44px] items-center gap-2 rounded-xl border border-pilote-200 bg-white px-4 text-sm font-semibold text-pilote transition-colors hover:bg-pilote-50 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-pilote-200"
          >
            <Download className="h-4 w-4" aria-hidden /> Exporter
          </button>
          <button
            onClick={() => void charger()}
            aria-label="Recharger le listing"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-gray-100 bg-white text-encre-doux shadow-card transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-pilote-200"
          >
            <RefreshCw className={`h-4 w-4 ${chargement ? 'animate-spin' : ''}`} aria-hidden />
          </button>
        </div>
      </div>

      {erreur && (
        <div className="rounded-2xl border border-gray-100 bg-white p-5 text-sm text-etat-perte shadow-card">{erreur}</div>
      )}
      {chargement && !lignes && (
        <div className="rounded-2xl border border-gray-100 bg-white p-5 text-sm text-encre-doux shadow-card">
          Lecture de la mercuriale et des fiches…
        </div>
      )}

      {lignes && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <TuileRoi
              label="Prix au catalogue"
              valeur={String(compte.total)}
              detail={`${compte.ventes} de vente · ${compte.achats} d’achat`}
            />
            <Tuile
              label="Marge médiane"
              valeur={
                compte.margeMediane === null
                  ? <Absent raison="non calculable" explication="Aucun format n’a à la fois un prix de vente et un coût complet." />
                  : `${compte.margeMediane.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`
              }
              detail="médiane, pas moyenne : une fiche exceptionnelle ne la déplace pas"
            />
            <Tuile
              label="Formats de vente"
              valeur={String(compte.ventes)}
              detail="un prix par format, jamais un seul par fiche"
            />
            {compte.sansPrix > 0 ? (
              <TuileAlerte
                label="Lignes sans prix"
                valeur={String(compte.sansPrix)}
                action="voir lesquelles et pourquoi"
              />
            ) : (
              <Tuile label="Lignes sans prix" valeur="0" detail="tout le catalogue est chiffré" />
            )}
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-card">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="relative min-w-[220px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-encre-faible" aria-hidden />
                <input
                  value={recherche}
                  onChange={e => setRecherche(e.target.value)}
                  placeholder="Chercher un produit, une catégorie…"
                  aria-label="Chercher dans le listing"
                  className="min-h-[44px] w-full rounded-xl border border-gray-300 pl-9 pr-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-pilote-200"
                />
              </div>
              <div className="flex rounded-xl border border-gray-100 bg-white p-1" role="group" aria-label="Filtrer le listing">
                {FILTRES.map(f => (
                  <button
                    key={f.cle}
                    onClick={() => setFiltre(f.cle)}
                    aria-pressed={filtre === f.cle}
                    className={`min-h-[44px] whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-pilote-200 ${
                      filtre === f.cle ? 'bg-pilote text-white' : 'text-encre-doux hover:bg-gray-50'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <p className="mb-2 text-xs text-encre-doux">
              {visibles.length} ligne(s) affichée(s) sur {compte.total}. Les prix d’achat sont HT à
              l’unité de base ; les prix de vente sont ceux du format, TTC et HT.
            </p>

            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-[11px] font-semibold uppercase tracking-wider text-encre-faible">
                    <th className="px-5 py-2 text-left font-semibold">Produit</th>
                    <th className="px-3 py-2 text-left font-semibold">Nature</th>
                    <th className="px-3 py-2 text-left font-semibold">Unité</th>
                    <th className="px-3 py-2 text-right font-semibold">Achat HT</th>
                    <th className="px-3 py-2 text-right font-semibold">Vente TTC</th>
                    <th className="px-3 py-2 text-right font-semibold">Coût HT</th>
                    <th className="px-5 py-2 text-right font-semibold">Marge</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map(l => (
                    <tr key={l.cle} className="border-t border-gray-100 transition-colors hover:bg-gray-50">
                      <td className="px-5 py-2">
                        <p className="text-sm font-medium text-encre">{l.nom}</p>
                        <p className="text-xs text-encre-faible">
                          {[l.detail, l.categorie, l.origine].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
                          l.nature === 'vente'
                            ? 'bg-rayon-vente/10 text-rayon-vente'
                            : 'bg-rayon-administratif/10 text-rayon-administratif'
                        }`}>
                          {l.nature === 'vente' ? 'vente' : 'achat'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-sm text-encre-doux">{l.unite}</td>

                      <td className="whitespace-nowrap px-3 py-2 text-right text-sm tabular">
                        {l.achatHt !== null
                          ? <span className="font-semibold text-encre-fort">{eur(l.achatHt)}</span>
                          : l.nature === 'achat'
                            ? <Absent raison={l.motifAbsent ?? 'sans prix'} />
                            : <span className="text-trait">—</span>}
                      </td>

                      <td className="whitespace-nowrap px-3 py-2 text-right text-sm tabular">
                        {l.venteTtc !== null && l.venteTtc > 0
                          ? (
                            <>
                              <span className="font-semibold text-encre-fort">{eur(l.venteTtc)}</span>
                              {l.venteHt !== null && (
                                <span className="block text-xs text-encre-faible">{eur(l.venteHt)} HT</span>
                              )}
                            </>
                          )
                          : l.nature === 'vente'
                            ? <Absent raison="pas de prix" explication={l.motifAbsent ?? undefined} />
                            : <span className="text-trait">—</span>}
                      </td>

                      <td className="whitespace-nowrap px-3 py-2 text-right text-sm tabular">
                        {l.coutHt !== null
                          ? <span className="font-semibold text-encre">{eur(l.coutHt)}</span>
                          : <span className="text-trait">—</span>}
                      </td>

                      <td className="whitespace-nowrap px-5 py-2 text-right text-sm tabular">
                        {l.margePct !== null && l.coefficient !== null ? (
                          <>
                            <span className={`font-bold ${l.margePct < 0 ? 'text-etat-perte' : 'text-encre-fort'}`}>
                              {l.margePct.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %
                            </span>
                            <span className="block text-xs text-encre-faible">
                              × {l.coefficient.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}
                            </span>
                          </>
                        ) : l.nature === 'vente' ? (
                          <Absent
                            raison="non publiée"
                            explication="Un prix d’ingrédient manque : la marge qui s’en déduirait serait flattée."
                          />
                        ) : (
                          <span className="text-trait">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {visibles.length === 0 && (
              <p className="py-8 text-center text-sm text-encre-doux">
                Aucune ligne ne correspond à cette recherche.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-card">
            <TitreCarte>Comment lire cette liste</TitreCarte>
            <ul className="space-y-1.5 text-sm text-encre-doux">
              <li>
                <span className="font-semibold text-encre">Un prix d’achat et un prix de vente ne se mélangent pas.</span>{' '}
                Deux colonnes distinctes : un produit du catalogue n’a qu’un prix d’achat, un format
                de fiche n’a qu’un prix de vente.
              </li>
              <li>
                <span className="font-semibold text-encre">Une marge n’est publiée que si le coût est complet.</span>{' '}
                Tant qu’un prix d’ingrédient manque, le coût est sous-évalué et la marge serait flattée.
              </li>
              <li>
                <span className="font-semibold text-encre">Un morceau de carcasse n’a pas de fournisseur.</span>{' '}
                Son prix vient de la dernière découpe chiffrée, et sa ligne le dit.
              </li>
              <li>
                <span className="font-semibold text-encre">Rien n’est recalculé ici.</span>{' '}
                Les prix d’achat viennent de la mercuriale, les marges des fiches recettes — mêmes
                chiffres, mêmes garde-fous, un seul moteur.
              </li>
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
