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


// ─── LA MERCURIALE ──────────────────────────────────────────────────────────
//
// 108 718 octets, donc un fichier que l'outil de publication ne pouvait plus
// réémettre : l'écran n'était plus modifiable. Découpé comme la facturation —
// l'état d'un côté, l'affichage de l'autre.
//
//   · ./etat       — tout l'état et toutes les écritures (hook useMercuriale)
//   · ./vues       — les trois onglets : à traiter, prix du jour, organiser
//   · ./catalogue  — le tableau du catalogue (déjà sorti)
//   · ./onglets    — les vues Organiser et Fournisseurs (déjà sorties)
//   · ./ui         — les briques d'affichage (déjà sorties)

import { useMercuriale } from './etat'
import { VuesMercuriale } from './vues'

export default function MercurialePage() {
  const f = useMercuriale()
  const {
    generics, moves, movesTotal, movesOpen, setMovesOpen, hausseFilter,
    setHausseFilter, autoFilter, setAutoFilter, loading, search, setSearch,
    view, setView, fournisseurs, setFournisseurSel, setRayonSel, lectureIncomplete,
    setOpenId, fiches, setEditId, load, selRefs, ancreAffichee,
    hausses, autoAVerifier, refsAssociees, recipesCountByGeneric, aTraiterTotal, carteAssociation,
  } = f

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      {/* En-tête */}
      <div className="mb-8 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-pilote to-pilote-hover rounded-2xl flex items-center justify-center flex-shrink-0 shadow-card">
            <ShoppingBasket className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Mercuriale</h1>
            <p className="text-sm text-gray-500 mt-1">Le prix d&apos;achat du jour de chaque produit, lu sur vos factures</p>
          </div>
        </div>
        <button onClick={() => load()} disabled={loading}
          className="flex items-center gap-1.5 text-xs font-semibold text-pilote border border-pilote-200 rounded-xl px-3 py-2 hover:bg-pilote-50 transition-colors disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />Actualiser
        </button>
      </div>

      {/* Comment ça marche, en trois phrases — dépliable, pour que l'écran ne
          demande jamais un mode d'emploi externe. */}
      <details className="mb-5 -mt-4">
        <summary className="cursor-pointer text-xs font-semibold text-gray-400 hover:text-pilote transition-colors inline-flex items-center gap-1.5">
          <HelpCircle className="w-3.5 h-3.5" />Comment ça marche ?
        </summary>
        <div className="mt-2 bg-white rounded-2xl border border-gray-100 shadow-card px-4 py-3 text-xs text-gray-600 leading-relaxed max-w-2xl">
          <p><strong className="text-gray-900">1.</strong> Vos factures sont lues automatiquement : chaque produit acheté obtient son <strong className="text-gray-900">prix du jour</strong>, au kg ou à la pièce.</p>
          <p className="mt-1"><strong className="text-gray-900">2.</strong> Quand deux libellés se ressemblent (« FILET POULET SV » et « FILET DE POULET LR »), l&apos;onglet <strong className="text-gray-900">À traiter</strong> vous demande de confirmer que c&apos;est le même produit — une fois, jamais deux.</p>
          <p className="mt-1"><strong className="text-gray-900">3.</strong> Vos fiches recettes utilisent ces prix : quand un fournisseur augmente, vous le voyez ici, et l&apos;impact se lit sur chaque fiche.</p>
        </div>
      </details>

      {/* Lecture tronquée : le catalogue affiché n'est pas complet. En tête de
          page, avant tout chiffre — c'est la fiabilité de TOUT l'écran qui est
          en cause, pas celle d'une section. */}
      {lectureIncomplete && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-red-700 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-900">{lectureIncomplete} Actualisez ; si le message persiste, signalez-le — les prix, min/max et mouvements ci-dessous ne portent que sur ce qui a pu être lu.</p>
        </div>
      )}

      {/* KPIs — trois chiffres, trois réponses : qu'est-ce que je suis, ai-je
          du travail, mes coûts bougent-ils. La tuile « À traiter » CONDUIT à
          l'onglet du même nom : le chiffre et le geste ne font qu'un. */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Produits suivis</p>
          <p className="text-2xl font-extrabold tracking-tight text-gray-900 tabular">{generics.length}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">{refsAssociees} réf{refsAssociees > 1 ? 's' : ''} fournisseur rattachée{refsAssociees > 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => setView('traiter')}
          className={`text-left bg-white rounded-2xl border shadow-card p-5 transition-all hover:shadow-card-hover ${view === 'traiter' ? 'border-pilote-200 ring-2 ring-pilote-200' : 'border-gray-100'}`}>
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">À traiter</p>
          <p className={`text-2xl font-extrabold tracking-tight tabular ${aTraiterTotal > 0 ? 'text-amber-600' : 'text-gray-900'}`}>{aTraiterTotal}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">{aTraiterTotal > 0 ? 'cliquer pour tout régler au même endroit' : 'rien en attente — tout est à jour'}</p>
        </button>
        {hausses > 0 ? (
          <button onClick={() => { setHausseFilter(v => !v); setView('prix') }}
            className={`text-left bg-white rounded-2xl border shadow-card p-5 transition-all hover:shadow-card-hover ${hausseFilter ? 'border-pilote-200 ring-2 ring-pilote-200' : 'border-gray-100'}`}>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Prix en hausse</p>
            <p className="text-2xl font-extrabold tracking-tight tabular text-red-600">{hausses}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">{hausseFilter ? 'filtre actif — cliquer pour tout revoir' : 'cliquer pour ne voir que les hausses'}</p>
          </button>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Prix en hausse</p>
            <p className="text-2xl font-extrabold tracking-tight tabular text-gray-900">0</p>
            <p className="text-[11px] text-gray-400 mt-0.5">aucune hausse en cours</p>
          </div>
        )}
      </div>

      {/* ── Mouvements de prix — chaque changement constaté sur 30 jours.
          Sur « Prix du jour » seulement : c'est de la consultation. ── */}
      {view === 'prix' && moves.length > 0 && (
        <div className="mb-6 bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-baseline gap-2 flex-wrap">
            <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-700">Mouvements de prix</h2>
            <span className="text-[11px] text-gray-400 tabular">
              30 derniers jours · {movesTotal} changement{movesTotal > 1 ? 's' : ''}
              {movesTotal > moves.length ? ` (les ${moves.length} plus récents affichés)` : ''}
            </span>
            {moves.filter(m => m.anomalie).length > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 ring-1 ring-amber-200 rounded-full px-2.5 py-0.5 tabular">
                <AlertTriangle className="w-3 h-3" />
                {moves.filter(m => m.anomalie).length} à vérifier (écart ≥ 25 %)
              </span>
            )}
          </div>
          <div className="divide-y divide-gray-50">
            {(movesOpen ? moves : moves.slice(0, 5)).map((m, i) => (
              <button key={`${m.generic_id}-${m.date}-${i}`}
                onClick={() => { setView('prix'); setHausseFilter(false); setOpenId(m.generic_id); setEditId(null) }}
                title="Ouvrir cet article au catalogue"
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors flex-wrap">
                <span className="text-[11px] text-gray-400 tabular w-16 flex-shrink-0">{fmtDate(m.date)}</span>
                <span className="flex-1 min-w-[180px]">
                  <span className="text-sm font-bold text-gray-900">{m.generic_name}</span>
                  <span className="block text-[11px] text-gray-400 truncate">{m.ref_name}{m.supplier_name ? ` · ${m.supplier_name}` : ''}</span>
                </span>
                <span className="text-xs text-gray-500 tabular">
                  {fmtEuro(m.old_base)} <span className="text-gray-300">→</span>{' '}
                  <span className={`font-bold ${m.new_base > m.old_base ? 'text-red-600' : 'text-green-600'}`}>{fmtEuro(m.new_base)}</span>
                  <span className="text-gray-400"> / {unitLabel(m.base_unit)}</span>
                </span>
                {(recipesCountByGeneric.get(m.generic_id) ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-pilote bg-pilote-50 rounded-full px-2 py-0.5 tabular" title="Fiches recettes qui utilisent cet article — impact détaillé dans la ligne dépliée du catalogue">
                    <ChefHat className="w-3 h-3" />{recipesCountByGeneric.get(m.generic_id)} fiche{(recipesCountByGeneric.get(m.generic_id) ?? 0) > 1 ? 's' : ''}
                  </span>
                )}
                <Variation pct={m.pct} />
                {m.anomalie && (
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-amber-700 bg-amber-50 ring-1 ring-amber-200 rounded-full px-2 py-0.5"
                    title="Saut de prix inhabituel entre deux factures de cette réf — promo, saison… ou erreur de facturation : vérifiez, et demandez un avoir au fournisseur si le prix est faux">
                    <AlertTriangle className="w-3 h-3" />à vérifier
                    {m.invoice_id && (
                      <span role="link" tabIndex={0}
                        onClick={e => { e.stopPropagation(); window.open(`/api/invoices/${m.invoice_id}/file`, '_blank') }}
                        onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); window.open(`/api/invoices/${m.invoice_id}/file`, '_blank') } }}
                        className="underline hover:text-amber-900 cursor-pointer">
                        voir la facture
                      </span>
                    )}
                  </span>
                )}
              </button>
            ))}
          </div>
          {moves.length > 5 && (
            <button onClick={() => setMovesOpen(v => !v)}
              className="w-full px-4 py-2 text-[11px] font-semibold text-pilote hover:bg-pilote-50 transition-colors border-t border-gray-100 flex items-center justify-center gap-1">
              {movesOpen ? <>Replier <ChevronDown className="w-3 h-3 rotate-180" /></> : <>Afficher les {moves.length - 5} autres <ChevronDown className="w-3 h-3" /></>}
            </button>
          )}
        </div>
      )}

      {/* Trois onglets, un par intention : consulter / agir / ranger. La
          recherche vit à côté — elle filtre l'onglet affiché. */}
      <div className="mb-5 flex items-center gap-3 flex-wrap">
        <div className="inline-flex bg-pilote-50 ring-1 ring-pilote-100 rounded-full p-1 gap-1">
          <button onClick={() => setView('prix')}
            className={`text-xs font-semibold rounded-full px-3.5 py-1.5 transition-colors ${view === 'prix' ? 'bg-pilote text-white shadow-card' : 'text-pilote hover:bg-pilote-100'}`}>
            Prix du jour
          </button>
          <button onClick={() => { setView('rayons'); setRayonSel(null) }}
            className={`text-xs font-semibold rounded-full px-3.5 py-1.5 transition-colors ${view === 'rayons' ? 'bg-pilote text-white shadow-card' : 'text-pilote hover:bg-pilote-100'}`}>
            Rayons
          </button>
          <button onClick={() => { setView('fournisseurs'); setFournisseurSel(null) }}
            className={`text-xs font-semibold rounded-full px-3.5 py-1.5 transition-colors ${view === 'fournisseurs' ? 'bg-pilote text-white shadow-card' : 'text-pilote hover:bg-pilote-100'}`}>
            Fournisseurs
          </button>
          <button onClick={() => setView('traiter')}
            className={`flex items-center gap-1.5 text-xs font-semibold rounded-full px-3.5 py-1.5 transition-colors ${view === 'traiter' ? 'bg-pilote text-white shadow-card' : 'text-pilote hover:bg-pilote-100'}`}>
            À traiter
            {aTraiterTotal > 0 && (
              <span className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 tabular ${view === 'traiter' ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-700'}`}>{aTraiterTotal}</span>
            )}
          </button>
          <button onClick={() => setView('organiser')}
            className={`text-xs font-semibold rounded-full px-3.5 py-1.5 transition-colors ${view === 'organiser' ? 'bg-pilote text-white shadow-card' : 'text-pilote hover:bg-pilote-100'}`}>
            Organiser
          </button>
        </div>
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un produit, une réf, un fournisseur…"
            className="w-full border border-gray-200 rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200" />
        </div>
        {/* Revue des génériques créés tout seuls. Le badge « Auto » demandait de
            vérifier nom et unité, mais rien ne permettait ni de les isoler, ni
            de dire que c'était fait : le compteur ne bougeait jamais. */}
        {view === 'prix' && autoAVerifier > 0 && (
          <button onClick={() => { setAutoFilter(v => !v); setView('prix') }}
            className={`flex items-center gap-1.5 text-xs font-semibold rounded-full px-3.5 py-2 ring-1 transition-colors ${autoFilter ? 'bg-pilote text-white ring-pilote shadow-card' : 'text-pilote bg-white ring-pilote-200 hover:bg-pilote-50'}`}>
            Auto à vérifier
            <span className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 tabular ${autoFilter ? 'bg-white/20 text-white' : 'bg-pilote-50 text-pilote'}`}>{autoAVerifier}</span>
          </button>
        )}
      </div>

      {/* ── Association en cours — REPLI. Le panneau vit normalement SOUS la
          ligne cliquée, dans la file. Ici seulement quand aucune réf du lot
          n'est à l'écran (autre onglet, recherche filtrante) : sans ça, une
          sélection en cours n'aurait plus aucun bouton pour la valider. ── */}
      {selRefs.length > 0 && ancreAffichee === null && (
        <div className="sticky top-2 z-30 mb-5">
          {carteAssociation}
        </div>
      )}


      {loading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : (
        <VuesMercuriale f={f} />
      )}
    </div>
  )
}
