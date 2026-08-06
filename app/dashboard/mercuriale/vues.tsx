'use client'

// Mercuriale — le référentiel de prix d'achat, à deux étages :
//   · les RÉFS FOURNISSEURS, créées automatiquement par la lecture des factures ;
//   · les ARTICLES GÉNÉRIQUES, qui regroupent les réfs (« FILET DE POULET SV »
//     + « FILET DE POULET LR » → « Filet de poulet ») et ramènent tout à une
//     unité de base (kg ou pièce).
//
// Une réf qui ne ressemble à rien est associée TOUTE SEULE (générique auto,
// côté API). Le reste se regroupe par SÉLECTION : cliquer « Associer » sur une
// réf la met dans l'association en cours, cliquer « Associer » sur d'autres les
// ajoute, puis tout part vers le même générique (existant ou créé). Une réf
// facturée dans une autre unité que la base du générique (pièce vs kg) exige
// son facteur de conversion — sans lui, son prix serait faux, donc il est
// IGNORÉ et signalé.
//
// TROIS ONGLETS, un par intention (refonte lisibilité 03/08) :
//   · PRIX DU JOUR — ce qu'on vient CONSULTER : le catalogue, les mouvements ;
//   · À TRAITER — tout ce qui attend un geste, au même endroit et compté :
//     factures à lire, classements à confirmer, produits à regrouper,
//     conversions à renseigner ;
//   · ORGANISER — le rangement du catalogue : chaque article avec ses réfs
//     (déplacer, dissocier, fusionner), le rapprochement intelligent.
// La lecture des factures se déclenche dans « À traiter » (une à la fois).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ShoppingBasket, FileSearch, Search, RefreshCw, Link2, ChevronDown, ChevronRight, X, Check, AlertTriangle, ChefHat, HelpCircle } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { guessBaseUnit, unitKind } from '@/lib/mercuriale-auto'
import { matchFamilyId, type MarginFamily } from '@/lib/margin-families'
// Briques d'affichage de la mercuriale (formats, courbes, blocs de la fiche
// enrichie du lot 41) — voir ./ui.tsx : la page garde la logique, ui le dessin.
import {
  fmtEuro, fmtDate, nomFournisseur, unitLabel,
  Variation, VueRayons, BlocEcartsBloques,
  type FicheDetail, type EcartBloque,
} from './ui'

// Types de l'écran, fonctions pures d'appellation et grands tableaux
// d'affichage — sortis d'ici au lot 73 pour que la page reste publiable (voir
// ./catalogue et ./onglets) : la page garde les états, les appels API et les
// gestes, ces fichiers ne font que dessiner.
import {
  TableauCatalogue, titleize, commonLabel,
  type Ref, type Generic, type Move, type FournisseurDepense,
  type PendingInvoice, type DouteInvoice,
} from './catalogue'
import { VueOrganiser, VueFournisseurs } from './onglets'
import type { MotifSortie } from '@/lib/lecture-file'

/** Une facture SORTIE de la file de lecture (lot 80) : la facture telle que la
 *  file la connaît, plus la raison de sa sortie — motif technique, phrase en
 *  clair et pastille courte, toutes trois calculées côté API par
 *  lib/lecture-file. La page n'en rejuge aucune : elle affiche. */
type LectureAbandonnee = PendingInvoice & {
  motif: MotifSortie
  phrase: string
  libelle: string
}


/**
 * LES TROIS ONGLETS DE LA MERCURIALE — à traiter, prix du jour, organiser.
 *
 * Extrait de `page.tsx` sans réécriture : le JSX est celui d'avant, ligne pour
 * ligne. Tout arrive dans un seul objet, celui du hook `useMercuriale` : son
 * type se déduit de ce que le hook renvoie. Ce bloc ne décide de rien.
 */

import { type Mercuriale } from './etat'

export function VuesMercuriale({ f }: { f: Mercuriale }) {
  const {
    generics, queue, pending, hausseFilter, setHausseFilter, autoFilter,
    setAutoFilter, validant, search, setSearch, view, setView,
    fournisseurs, familles, fournisseurSel, setFournisseurSel, rayonSel, setRayonSel,
    depenseHorsCatalogue, ecartsBloques, ecartsBloquesTotal, verrouDrafts, setVerrouDrafts, verrouillant,
    processing, progress, stopRef, showMotifs, setShowMotifs, relisant,
    abandonnees, showAbandons, setShowAbandons, abandonnant, doutes, tranchant,
    sansPdf, backfill, selSaving, fixDrafts, setFixDrafts, smartLoading,
    smartSuggestions, setSmartSuggestions, smartNames, setSmartNames, mergeSel, setMergeSel,
    merging, openId, setOpenId, fiches, ficheLoading, editId,
    setEditId, edit, setEdit, confirmDelId, setConfirmDelId, queueSort,
    setQueueSort, queueAll, setQueueAll, showNonProduct, setShowNonProduct, showIgnored,
    setShowIgnored, processQueue, rattraperPdf, relire, changerLecture, trancherNature,
    groupToPanel, assocSuggested, dissociate, fixConversion, runSmart, pickTarget,
    doMerge, applySuggestion, setIgnored, ignoreGroup, poserVerrou, moveRef,
    startEdit, saving, submitEdit, validerAuto, removeGeneric, filteredGenerics,
    filteredQueue, visibleQueue, ignoredRefs, queueGroups, nonProductRefs, productRefCount,
    conversionsManquantes, assocGenerics, supplierRows, cheaperAlt, refsAssociees, refsSansConversion,
    aTraiterTotal, refsParFournisseur, cartesFournisseurs, catalogueFournisseur, renderRefAncree,
  } = f
  return (
    <>
          {/* ══ Onglet À TRAITER : tout ce qui attend un geste, dans l'ordre du
              circuit — lire les factures, confirmer les classements, regrouper
              les produits, renseigner les conversions. Chaque section
              n'apparaît que si elle a du travail à montrer. ══ */}
          {view === 'traiter' && (
            <>
              {/* 1. Factures sans PDF : rien à lire tant que le document n'est pas récupéré */}
              {sansPdf > 0 && (
                <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
                  <AlertTriangle className="w-4 h-4 text-amber-700 flex-shrink-0" />
                  <p className="text-sm text-amber-900 flex-1 min-w-[220px]">
                    <strong>{sansPdf} facture{sansPdf > 1 ? 's' : ''} sans document archivé</strong> — sans PDF, aucune ligne ne peut être lue
                    et leurs prix manquent à la mercuriale. Le fichier peut être redemandé à votre logiciel de facturation.
                  </p>
                  <button onClick={rattraperPdf} disabled={backfill}
                    className="text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg px-3.5 py-2 shadow-card active:scale-[0.98] transition-all disabled:opacity-50">
                    {backfill ? 'Récupération…' : 'Récupérer les PDF'}
                  </button>
                </div>
              )}

              {/* 2. File d'attente de lecture — jamais lues ET relectures (partial, error) */}
              {pending.length > 0 && (() => {
                const neuves = pending.filter(p => !p.lines_status)
                const arelire = pending.filter(p => !!p.lines_status)
                return (
                <div className="mb-6 bg-pilote-50 border border-pilote-200 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <FileSearch className="w-4 h-4 text-pilote flex-shrink-0" />
                    <p className="text-sm text-pilote-800 flex-1 min-w-[200px]">
                      <strong>{pending.length} facture{pending.length > 1 ? 's' : ''}</strong> à lire
                      {arelire.length > 0 ? <> — dont <strong>{arelire.length} à relire</strong> (lecture incomplète ou en échec)</> : null}.
                      Seule la matière première entre dans la mercuriale ; les réfs sans ressemblance s&apos;associent toutes seules.
                    </p>
                    {processing ? (
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-semibold text-pilote tabular">{progress.done} / {progress.total}{progress.errors > 0 ? ` · ${progress.errors} échec${progress.errors > 1 ? 's' : ''}` : ''}</span>
                        <button onClick={() => { stopRef.current = true }}
                          className="text-xs font-bold text-pilote underline">Arrêter</button>
                      </div>
                    ) : (
                      <button onClick={processQueue}
                        className="text-xs font-bold text-white bg-pilote hover:bg-pilote-hover rounded-lg px-3.5 py-2 shadow-card active:scale-[0.98] transition-all">
                        Lire les {neuves.length > 0 && arelire.length > 0 ? `${pending.length} ` : ''}factures
                      </button>
                    )}
                  </div>

                  {/* Ce qui a coincé, et pourquoi — dépliable, avec relecture à l'unité */}
                  {arelire.length > 0 && (
                    <div className="mt-2.5 border-t border-pilote-200/70 pt-2">
                      <button onClick={() => setShowMotifs(v => !v)}
                        className="flex items-center gap-1.5 text-[11px] font-bold text-pilote hover:underline">
                        {showMotifs ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        Voir pourquoi {arelire.length > 1 ? 'ces lectures ont coincé' : 'cette lecture a coincé'}
                      </button>
                      {showMotifs && (
                        <div className="mt-1.5 space-y-1">
                          {arelire.map(p => (
                            <div key={p.id} className="bg-white rounded-lg px-3 py-2 flex items-start gap-3 flex-wrap">
                              <span className="text-[11px] text-gray-400 tabular flex-shrink-0 w-16">{fmtDate(p.invoice_date)}</span>
                              <span className="flex-1 min-w-[180px]">
                                <span className="text-xs font-semibold text-gray-900">{p.supplier_name}</span>
                                <span className="block text-[11px] text-gray-500 leading-snug">
                                  {p.lines_error || (p.lines_status === 'error' ? 'Échec sans motif enregistré — relancez la lecture pour en obtenir un.' : 'Lecture incomplète.')}
                                </span>
                              </span>
                              <span className="flex items-center gap-2 flex-shrink-0">
                                <button onClick={() => window.open(`/api/invoices/${p.id}/file`, '_blank')}
                                  className="text-[11px] font-semibold text-gray-500 hover:text-pilote underline">voir la facture</button>
                                <button onClick={() => relire(p)} disabled={processing || relisant === p.id}
                                  className="text-[11px] font-bold text-white bg-pilote hover:bg-pilote-hover rounded-lg px-2.5 py-1 shadow-card disabled:opacity-50">
                                  {relisant === p.id ? 'Lecture…' : 'Relire'}
                                </button>
                                {/* Sortie de file assumée : chaque tentative repasse le
                                    document au lecteur, et certaines factures ne seront
                                    jamais lisibles. Réversible d'un clic plus bas. */}
                                <button onClick={() => changerLecture(p, true)} disabled={processing || abandonnant !== null || relisant !== null}
                                  title="Sortir cette facture de la file de lecture — son montant reste compté dans vos achats"
                                  className="text-[11px] font-semibold text-gray-500 border border-gray-200 bg-white rounded-lg px-2.5 py-1 hover:text-red-600 hover:border-red-200 transition-colors disabled:opacity-50">
                                  {abandonnant === p.id ? '…' : 'Ne plus essayer'}
                                </button>
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                )
              })()}

              {/* 2 bis. LECTURES ABANDONNÉES (lot 80) — sorties de la file, pas
                  des comptes. À la main, après trois échecs, ou faute de reprise
                  depuis une semaine. Repliées comme « Lignes non-produit » et
                  « Réfs écartées » : ce n'est plus un travail à faire, c'est un
                  rangement consultable — et chaque ligne se réessaie d'un clic. */}
              {abandonnees.length > 0 && (
                <div className="mb-6 bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
                  <button onClick={() => setShowAbandons(v => !v)}
                    className="w-full px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-gray-50 transition-colors">
                    <p className="text-xs font-semibold text-gray-500 text-left">
                      Lectures abandonnées ({abandonnees.length})
                      <span className="text-gray-400 font-normal"> — plus proposées à la lecture ; leur montant reste compté dans vos achats, seules leurs lignes manquent ici</span>
                    </p>
                    <span className="text-[11px] font-bold text-gray-400 tabular flex items-center gap-1 flex-shrink-0">
                      {abandonnees.length}
                      {showAbandons ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </span>
                  </button>
                  {showAbandons && (
                    <div className="divide-y divide-gray-100 border-t border-gray-100">
                      {abandonnees.map(a => (
                        <div key={a.id} className="px-4 py-2.5 flex items-start gap-3 flex-wrap">
                          <span className="text-[11px] text-gray-400 tabular flex-shrink-0 w-16 pt-0.5">{fmtDate(a.invoice_date)}</span>
                          <span className="flex-1 min-w-[220px]">
                            <span className="text-xs font-semibold text-gray-900">{nomFournisseur(a.supplier_name) || '—'}</span>
                            <span className="text-xs text-gray-500 tabular"> · {fmtEuro(Number(a.amount_ht) || 0)}</span>
                            <span className="ml-2 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-500 align-middle">{a.libelle}</span>
                            <span className="block text-[11px] text-gray-500 leading-snug mt-0.5">{a.phrase}</span>
                          </span>
                          <span className="flex items-center gap-2 flex-shrink-0">
                            <button onClick={() => window.open(`/api/invoices/${a.id}/file`, '_blank')}
                              className="text-[11px] font-semibold text-gray-500 hover:text-pilote underline">voir la facture</button>
                            <button onClick={() => changerLecture(a, false)} disabled={processing || abandonnant !== null || relisant !== null}
                              title="Remettre cette facture dans la file de lecture"
                              className="text-[11px] font-bold text-pilote border border-pilote-200 bg-white rounded-lg px-3 py-1 hover:bg-pilote-50 transition-colors disabled:opacity-50">
                              {abandonnant === a.id ? '…' : 'Réessayer'}
                            </button>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 3. File de doute matière/charge (lot 29) — le tri dit quand il
                  n'est pas sûr, et c'est le boucher qui tranche, d'un clic. */}
              {doutes.length > 0 && (
                <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <HelpCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                    <p className="text-sm text-amber-900">
                      <strong>{doutes.length} classement{doutes.length > 1 ? 's' : ''} à confirmer</strong> — la lecture a hésité entre matière première et charge. Votre œil tranche en un clic.
                    </p>
                  </div>
                  <div className="space-y-1">
                    {doutes.map(d => (
                      <div key={d.id} className="bg-white rounded-lg px-3 py-2 flex items-start gap-3 flex-wrap">
                        <span className="text-[11px] text-gray-400 tabular flex-shrink-0 w-16">{fmtDate(d.invoice_date)}</span>
                        <span className="flex-1 min-w-[180px]">
                          <span className="text-xs font-semibold text-gray-900">{nomFournisseur(d.supplier_name)}</span>
                          <span className="text-xs text-gray-500 tabular"> · {fmtEuro(Number(d.amount_ht) || 0)}</span>
                          <span className="block text-[11px] text-gray-500 leading-snug">
                            {d.lines_status === 'hors_matiere' ? 'Écartée comme charge. ' : 'Lue comme matière. '}
                            {d.lines_error || ''}
                          </span>
                        </span>
                        <span className="flex items-center gap-2 flex-shrink-0">
                          <button onClick={() => window.open(`/api/invoices/${d.id}/file`, '_blank')}
                            className="text-[11px] font-semibold text-gray-500 hover:text-pilote underline">voir la facture</button>
                          <button onClick={() => trancherNature(d, 'hors_matiere')} disabled={tranchant !== null}
                            className="text-[11px] font-bold text-amber-800 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg px-2.5 py-1 disabled:opacity-50">
                            {tranchant === d.id ? '…' : 'C’est une charge'}
                          </button>
                          <button onClick={() => trancherNature(d, 'matiere')} disabled={tranchant !== null}
                            className="text-[11px] font-bold text-white bg-pilote hover:bg-pilote-hover rounded-lg px-2.5 py-1 shadow-card disabled:opacity-50">
                            {tranchant === d.id ? 'En cours…' : 'C’est de la matière'}
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 3 bis. Prix bloqués dépassés (lot 43) : le fournisseur a facturé
                  au-dessus du prix convenu — les gestes vivent dans ui.tsx. */}
              <BlocEcartsBloques ecarts={ecartsBloques} total={ecartsBloquesTotal} enCours={verrouillant}
                onOuvrirProduit={id => { setView('prix'); setSearch(''); setOpenId(id); setEditId(null) }}
                onVerrou={poserVerrou} />

          {/* 4. File de RAPPROCHEMENT : uniquement les réfs qui se ressemblent. */}
          {(queueGroups.length > 0 || nonProductRefs.length > 0) && (
            <div className="mb-8">
              <div className="flex items-baseline gap-2 mb-1">
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-700">À rapprocher</h2>
                <span className="text-[11px] text-gray-400 tabular">{productRefCount} réf{productRefCount > 1 ? 's' : ''} · {queueGroups.length} produit{queueGroups.length > 1 ? 's' : ''}</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap mb-3">
                <p className="text-[11px] text-gray-400 flex-1 min-w-[260px]">
                  Les réfs qui ne ressemblent à rien deviennent automatiquement leur propre article générique.
                  Ici : cliquez « Associer » sur deux réfs (ou plus) pour les regrouper, ou utilisez le bouton du groupe.
                </p>
                <label className="text-[11px] text-gray-400 flex items-center gap-1.5 flex-shrink-0">
                  Trier par
                  <select value={queueSort} onChange={e => setQueueSort(e.target.value as typeof queueSort)}
                    className="border border-gray-200 rounded-lg px-2 py-1 text-[11px] bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-pilote-200">
                    <option value="montant">prix le plus élevé</option>
                    <option value="anciennete">le plus ancien</option>
                    <option value="fournisseur">fournisseur</option>
                    <option value="refs">nombre de réfs</option>
                  </select>
                </label>
              </div>
              <div className="space-y-3">
                {(queueAll ? queueGroups : queueGroups.slice(0, 10)).map(grp => (
                  <div key={grp.stem} className="bg-white rounded-2xl border border-amber-200 shadow-card overflow-hidden">
                    <div className="px-4 py-2.5 bg-amber-50/60 flex items-center gap-3 flex-wrap">
                      <p className="text-sm font-bold text-gray-900 flex-1 min-w-[180px]">
                        {grp.label}
                        <span className="ml-2 text-[11px] font-semibold text-amber-700 tabular">{grp.refs.length} réf{grp.refs.length > 1 ? 's' : ''}{grp.refs.length > 1 ? ' qui se ressemblent' : ''}</span>
                      </p>
                      {grp.suggested ? (
                        <button onClick={() => assocSuggested(grp)} disabled={selSaving}
                          className="text-xs font-bold text-white bg-pilote hover:bg-pilote-hover rounded-lg px-3.5 py-2 shadow-card active:scale-[0.98] transition-all disabled:opacity-50">
                          {selSaving ? 'Association…' : `${grp.refs.length > 1 ? 'Tout associer' : 'Associer'} à « ${grp.suggested.name} »`}
                        </button>
                      ) : (
                        <>
                          <button onClick={() => groupToPanel(grp.refs, 'new', grp.label)}
                            className="text-xs font-bold text-white bg-pilote hover:bg-pilote-hover rounded-lg px-3.5 py-2 shadow-card active:scale-[0.98] transition-all">
                            {grp.refs.length > 1 ? `Regrouper les ${grp.refs.length} réfs` : 'Créer son générique'}
                          </button>
                          {/* SANS SUGGESTION, il n'y avait qu'une issue : créer un
                              générique de plus. Or l'absence de suggestion ne veut
                              pas dire que le produit n'existe pas au catalogue —
                              elle veut dire que les deux premiers mots du libellé
                              ne tombent pas juste. « Épaule agneau 1er choix » ne
                              suggère rien face à « Épaule d'agneau ». Ce second
                              bouton ouvre le même panneau, mais sur le catalogue :
                              à chercher, à choisir. */}
                          <button onClick={() => groupToPanel(grp.refs, '', grp.label)}
                            title="Chercher le produit dans tout le catalogue, même s'il n'est pas proposé"
                            className="text-xs font-bold text-pilote bg-white ring-1 ring-pilote-200 hover:bg-pilote-50 rounded-lg px-3.5 py-2 active:scale-[0.98] transition-all">
                            Associer à un produit existant…
                          </button>
                        </>
                      )}
                      <button onClick={() => ignoreGroup(grp.refs)} title="Ne pas rapprocher — écarter tout le groupe"
                        className="text-[11px] font-semibold text-gray-400 hover:text-red-600 rounded-lg px-2 py-1.5 transition-colors">
                        Écarter
                      </button>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {grp.refs.map(renderRefAncree)}
                    </div>
                  </div>
                ))}

                {/* Au-delà de dix groupes, la file devenait un mur de cartes
                    empilées : le reste se déplie à la demande. */}
                {!queueAll && queueGroups.length > 10 && (
                  <button onClick={() => setQueueAll(true)}
                    className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-gray-500 border-2 border-dashed border-gray-200 rounded-xl py-2.5 hover:border-pilote-200 hover:text-pilote transition-colors">
                    <ChevronDown className="w-3.5 h-3.5" />Voir les {queueGroups.length - 10} autres produits à rapprocher
                  </button>
                )}
                {queueAll && queueGroups.length > 10 && (
                  <button onClick={() => setQueueAll(false)}
                    className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-gray-400 rounded-xl py-2 hover:text-pilote transition-colors">
                    <ChevronRight className="w-3.5 h-3.5" />N&apos;afficher que les dix premiers
                  </button>
                )}

                {/* Lignes non-produit (taxes, remises, frais, licences, entretien…) —
                    jamais associées d'office, repliées pour ne pas encombrer */}
                {nonProductRefs.length > 0 && (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
                    <button onClick={() => setShowNonProduct(v => !v)}
                      className="w-full px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-gray-50 transition-colors">
                      <p className="text-xs font-semibold text-gray-500 text-left">
                        Lignes non-produit ignorées
                        <span className="text-gray-400 font-normal"> — taxes, remises, frais, licences, entretien… rien à faire, associables à la main si besoin</span>
                      </p>
                      <span className="text-[11px] font-bold text-gray-400 tabular flex items-center gap-1 flex-shrink-0">
                        {nonProductRefs.length}
                        {showNonProduct ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </span>
                    </button>
                    {showNonProduct && (
                      <div className="divide-y divide-gray-100 border-t border-gray-100">{nonProductRefs.map(renderRefAncree)}</div>
                    )}
                  </div>
                )}

                {/* Réfs écartées par le gérant — restaurables */}
                {ignoredRefs.length > 0 && (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
                    <button onClick={() => setShowIgnored(v => !v)}
                      className="w-full px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-gray-50 transition-colors">
                      <p className="text-xs font-semibold text-gray-500 text-left">
                        Réfs écartées
                        <span className="text-gray-400 font-normal"> — vous avez choisi de ne pas les rapprocher ; restaurables à tout moment</span>
                      </p>
                      <span className="text-[11px] font-bold text-gray-400 tabular flex items-center gap-1 flex-shrink-0">
                        {ignoredRefs.length}
                        {showIgnored ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </span>
                    </button>
                    {showIgnored && (
                      <div className="divide-y divide-gray-100 border-t border-gray-100">
                        {ignoredRefs.map(r => (
                          <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 flex-wrap">
                            <div className="flex-1 min-w-[220px]">
                              <p className="text-sm font-semibold text-gray-500">{r.name}</p>
                              <p className="text-[11px] text-gray-400">{nomFournisseur(r.supplier_name) || '—'}{r.article_code ? ` · ${r.article_code}` : ''}</p>
                            </div>
                            <span className="text-xs text-gray-400 tabular">{r.last_price_ht !== null ? `${fmtEuro(Number(r.last_price_ht))}${r.unit ? ` / ${r.unit}` : ''}` : '—'}</span>
                            <button onClick={() => setIgnored(r, false)}
                              className="text-xs font-bold text-pilote border border-pilote-200 bg-white rounded-lg px-3 py-1.5 hover:bg-pilote-50 transition-colors">
                              Restaurer
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

              {/* 5. Conversions à renseigner — une réf facturée dans une autre
                  unité que la base de son article a un prix INUTILISABLE tant
                  que « combien ça pèse » n'est pas dit. Liste à plat : les
                  régler ne demande plus de fouiller article par article. */}
              {refsSansConversion.length > 0 && (
                <div className="mb-6 bg-white rounded-2xl border border-amber-200 shadow-card overflow-hidden">
                  <div className="px-4 py-2.5 bg-amber-50/60">
                    <p className="text-sm font-bold text-gray-900">
                      {refsSansConversion.length} conversion{refsSansConversion.length > 1 ? 's' : ''} à renseigner
                      <span className="ml-2 text-[11px] font-normal text-amber-700">le prix de ces réfs est ignoré tant que la conversion manque — jamais pris tel quel</span>
                    </p>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {refsSansConversion.map(({ r, g }) => (
                      <div key={r.id} className="px-4 py-2.5 flex items-center gap-3 flex-wrap text-xs">
                        <span className="font-semibold text-gray-800 flex-1 min-w-[170px]">
                          {r.name}
                          <span className="block text-[11px] font-normal text-gray-400">{nomFournisseur(r.supplier_name) || '—'} · article « {g.name} »</span>
                        </span>
                        <span className="text-gray-500 tabular">{r.last_price_ht !== null ? `${fmtEuro(Number(r.last_price_ht))}${r.unit ? ` / ${r.unit}` : ''}` : '—'}</span>
                        <span className="flex items-center gap-1.5 text-[11px] text-amber-700 bg-amber-50 ring-1 ring-amber-200 rounded-lg px-2 py-1 tabular">
                          1 {r.unit || 'unité'} =
                          <input value={fixDrafts[r.id] ?? ''} inputMode="decimal" placeholder="?"
                            onChange={e => setFixDrafts(p => ({ ...p, [r.id]: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') fixConversion(r, g.id) }}
                            className="w-14 border border-amber-300 rounded px-1.5 py-0.5 text-right tabular bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                          {unitLabel(g.base_unit)}
                          <button onClick={() => fixConversion(r, g.id)}
                            className="font-bold text-white bg-pilote hover:bg-pilote-hover rounded px-1.5 py-0.5 transition-colors">OK</button>
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="px-4 py-2 text-[10px] text-gray-400 border-t border-gray-50">Exemple : une réf facturée « à la pièce » pour un article « au kg » → tapez le poids d&apos;une pièce (1,5 pour 1,5 kg).</p>
                </div>
              )}

              {/* Tout est réglé : le dire clairement vaut mieux qu'un écran vide */}
              {aTraiterTotal === 0 && (
                <div className="bg-white rounded-2xl border border-dashed border-gray-200 py-14 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-3">
                    <Check className="w-6 h-6 text-green-600" />
                  </div>
                  <p className="text-sm font-bold text-gray-900 mb-1">Rien à traiter — tout est à jour</p>
                  <p className="text-xs text-gray-400 max-w-md mx-auto">
                    Les factures sont lues, les produits regroupés, les conversions renseignées.
                    Les prochaines factures arriveront ici toutes seules après leur lecture de nuit.
                  </p>
                </div>
              )}
            </>
          )}

          {/* ══ Onglet ORGANISER : le rangement du catalogue — chaque article
              avec ses réfs (déplacer, dissocier, fusionner), et le
              rapprochement intelligent des doublons d'appellation. ══ */}
          {view === 'organiser' ? (
            <VueOrganiser
              filteredGenerics={filteredGenerics} assocGenerics={assocGenerics} generics={generics}
              refsAssociees={refsAssociees} conversionsManquantes={conversionsManquantes}
              search={search} visibleQueue={visibleQueue}
              autoFilter={autoFilter} setAutoFilter={setAutoFilter}
              hausseFilter={hausseFilter} setHausseFilter={setHausseFilter}
              runSmart={runSmart} smartLoading={smartLoading}
              smartSuggestions={smartSuggestions} setSmartSuggestions={setSmartSuggestions}
              smartNames={smartNames} setSmartNames={setSmartNames}
              pickTarget={pickTarget} applySuggestion={applySuggestion} merging={merging}
              mergeSel={mergeSel} setMergeSel={setMergeSel} doMerge={doMerge}
              fixDrafts={fixDrafts} setFixDrafts={setFixDrafts} fixConversion={fixConversion}
              moveRef={moveRef} dissociate={dissociate}
              setView={setView} setOpenId={setOpenId} setEditId={setEditId} />
          ) : view === 'rayons' ? (
            /* ══ Onglet RAYONS (lot 42, modèle Otami) : la dépense réelle 12
                mois par rayon de la boutique, puis les produits du rayon par
                sous-famille — regroupements dessinés par ui.VueRayons. ══ */
            <VueRayons produits={generics} familles={familles} search={search}
              sel={rayonSel} onSel={setRayonSel}
              onOuvrirProduit={id => { setView('prix'); setSearch(''); setOpenId(id); setEditId(null) }}
              horsCatalogue={depenseHorsCatalogue} onVoirATraiter={() => setView('traiter')} />
          ) : view === 'fournisseurs' ? (
            /* ══ Onglet FOURNISSEURS (lot 40, modèle Otami) : la mercuriale de
                chaque maison — cartes triées par la dépense réelle 12 mois,
                puis le catalogue du fournisseur classé par familles. ══ */
            <VueFournisseurs
              cartesFournisseurs={cartesFournisseurs} refsParFournisseur={refsParFournisseur}
              catalogueFournisseur={catalogueFournisseur}
              fournisseurSel={fournisseurSel} setFournisseurSel={setFournisseurSel}
              search={search} setSearch={setSearch}
              setView={setView} setOpenId={setOpenId} setEditId={setEditId} />
          ) : view === 'prix' ? (
            /* ══ Onglet PRIX DU JOUR : le catalogue des prix ══ */
            <TableauCatalogue
              aTraiterTotal={aTraiterTotal} setView={setView}
              filteredGenerics={filteredGenerics} filteredQueue={filteredQueue}
              generics={generics} queue={queue}
              openId={openId} setOpenId={setOpenId} editId={editId} setEditId={setEditId}
              confirmDelId={confirmDelId} setConfirmDelId={setConfirmDelId}
              edit={edit} setEdit={setEdit} saving={saving} submitEdit={submitEdit}
              validant={validant} validerAuto={validerAuto} startEdit={startEdit} removeGeneric={removeGeneric}
              fiches={fiches} ficheLoading={ficheLoading}
              supplierRows={supplierRows} cheaperAlt={cheaperAlt}
              verrouDrafts={verrouDrafts} setVerrouDrafts={setVerrouDrafts}
              poserVerrou={poserVerrou} verrouillant={verrouillant} dissociate={dissociate} />
          ) : null}
    </>
  )
}
