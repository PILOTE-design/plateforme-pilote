'use client'

import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import VentilationFacture from './ventilation-facture'
import {
  Receipt, ChevronLeft, ChevronRight, Plus, Trash2,
  TrendingUp, TrendingDown, ShoppingCart, Users, Euro,
  Save, X, Settings, Check, Loader2, AlertCircle,
  Link2, Link2Off, RefreshCw, ArrowUpRight, Repeat, PieChart,
  Mail, Copy, History} from 'lucide-react'
import {
  weekRecurringCost,
  type RecurringCharge, type RecurringActual,
} from '@/lib/recurring-charges'
import { periodeCouvreSemaine } from '@/lib/charges-fixes'
import { DEFAULT_MARGIN_FAMILIES, DEFAULT_TVA_RATE, DIVERS_POSTE, type Poste } from '@/lib/postes'
import { nomFournisseur } from '@/lib/supplier-name'
import {
  BlocChargesFixesSemaine, BlocChargesRecurrentes, BlocChargesStructure,
  ModaleChargeRecurrente, ModaleReconciliation, ModaleRepartitionRayons,
} from './blocs'
import {
  CATEGORIES, TVA_RATES, EMPTY_RECURRING, EMPTY_INVOICE, PROVIDERS_META,
  emptyVent, ordonnerFamilles, totalVent, fmtPct, partsPayload, draftFromParts,
  familleDot, categoryFromSplit, matchSplit, getISOWeek, getWeekDates,
  fmtDate, fmtEuro, catInfo, initials, matchSupplier, isoWeeksInYear, getLastWeek,
  type BillingIntegration, type ChargeVue, type Invoice, type ProviderMeta,
  type RayonFamille, type RayonSplit, type SupplierMemo, type Summary,
  type VentDraft, type VentFamily,
} from './donnees'


// ─── LA PAGE FACTURATION ────────────────────────────────────────────────────
//
// Le fichier pesait 99 948 octets, taille au-delà de laquelle l'outil de
// publication ne peut plus le réémettre d'un seul tenant : la page n'était plus
// modifiable du tout. Le lot 87 a dû livrer une correction à moitié pour cette
// seule raison — le message d'un refus restait bloqué en « Erreur 409 ».
//
//   · ./etat      — tout l'état et toutes les écritures (hook useFacturation)
//   · ./panneaux  — intégrations, achats de la semaine, charges de structure
//   · ./modales   — connexion, ajout, CA, familles, ventilation, paramètres
//   · ./blocs     — les blocs de charges (déjà sortis précédemment)
//
// La page n'est plus qu'un assemblage : elle appelle le hook et pose les blocs.

import { useFacturation } from './etat'
import { PanneauxFacturation } from './panneaux'
import { ModalesFacturation } from './modales'

export default function FacturationPage() {
  const f = useFacturation()
  const {
    lastWeek, week, setWeek, year, setYear, summary,
    setShowCA, setShowSettings, setShowProviders, setTvaDraft, integrations, syncing,
    mon, sun, cw, cy, isCurrentWeek, isLastWeek,
    openAdd, openSplits, prevWeek, nextWeek, disconnectIntegration, syncNow,
    openFamilles,
  } = f

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* Header héro */}
      <div className="bg-white border-b border-gray-100 px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-pilote to-pilote-hover rounded-lg flex items-center justify-center flex-shrink-0 shadow-card">
            <Receipt className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Facturation &amp; Achats</h1>
            <p className="text-sm text-gray-500">Achats de la semaine · Charges structurelles · CA &amp; marge</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowCA(true)} variant="outline" className="h-9 text-sm px-3.5 rounded-xl border-pilote text-pilote hover:bg-pilote-50 transition-colors">
            <Euro className="w-3.5 h-3.5 mr-1.5" />Saisir le CA
          </Button>
          <Button onClick={openAdd} className="bg-pilote hover:bg-pilote-hover text-white h-9 text-sm px-3.5 rounded-xl shadow-card active:scale-95 transition-all">
            <Plus className="w-3.5 h-3.5 mr-1.5" />Ajouter une facture
          </Button>
          <button onClick={openSplits} title="Répartir les achats par rayon, fournisseur par fournisseur"
            className="h-9 text-sm px-3 rounded-xl border border-gray-100 text-gray-600 shadow-card hover:text-pilote transition-colors flex items-center gap-1.5">
            <PieChart className="w-3.5 h-3.5" />Répartition
          </button>
          <button onClick={openFamilles} title="Choisir les 3 familles de marge"
            className="h-9 text-sm px-3 rounded-xl border border-gray-100 text-gray-600 shadow-card hover:text-pilote transition-colors">
            Familles
          </button>
          <button onClick={() => { setTvaDraft(String(summary?.tva_rate ?? DEFAULT_TVA_RATE).replace('.', ',')); setShowSettings(true) }} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors">
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Week nav */}
      <div className="bg-white border-b border-gray-100 px-6 py-2.5 flex items-center gap-2">
        <div className="flex items-center gap-1 bg-gray-50 border border-gray-100 rounded-lg px-1 py-0.5">
          <button onClick={prevWeek} className="p-1.5 rounded-xl hover:bg-white hover:shadow-sm transition-all"><ChevronLeft className="w-4 h-4 text-gray-500" /></button>
          <div className="flex items-center gap-2 px-2">
            <span className="font-bold text-gray-900 text-sm">Semaine {week}</span>
            <span className="text-gray-300 text-sm">·</span>
            <span className="text-xs text-gray-500 tabular">{fmtDate(mon)} – {fmtDate(sun)}</span>
            {isCurrentWeek && <span className="text-[10px] bg-pilote text-white px-1.5 py-0.5 rounded-lg font-semibold">En cours</span>}
            {isLastWeek && !isCurrentWeek && <span className="text-[10px] bg-amber-500 text-white px-1.5 py-0.5 rounded-lg font-semibold">Semaine écoulée</span>}
          </div>
          <button onClick={nextWeek} className="p-1.5 rounded-xl hover:bg-white hover:shadow-sm transition-all"><ChevronRight className="w-4 h-4 text-gray-500" /></button>
        </div>
        {!isLastWeek && <button onClick={() => { setWeek(lastWeek.week); setYear(lastWeek.year) }} className="text-xs text-pilote font-medium hover:underline">← Semaine écoulée</button>}
        {!isCurrentWeek && <button onClick={() => { setWeek(cw); setYear(cy) }} className="text-xs text-gray-400 hover:text-gray-600 hover:underline transition-colors">Semaine en cours →</button>}

        {/* Intégrations compactes */}
        <div className="ml-auto flex items-center gap-2">
          {integrations.map(integ => {
            const meta = PROVIDERS_META.find(p => p.id === integ.provider)
            if (!meta) return null
            const isSyncing = syncing === integ.provider
            return (
              <div key={integ.provider} className="flex items-center gap-1.5 bg-green-50 border border-green-200 rounded-lg pl-2 pr-1 py-1">
                <div className={`w-5 h-5 rounded ${meta.color} flex items-center justify-center text-white text-[8px] font-extrabold`}>{meta.logo}</div>
                <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                {integ.last_sync_status === 'error' && <span className="text-[9px] text-red-500 font-semibold">erreur</span>}
                <button onClick={() => syncNow(integ.provider)} disabled={isSyncing}
                  className="flex items-center gap-1 text-[11px] font-semibold text-green-800 hover:text-green-900 px-1.5 py-0.5 rounded hover:bg-green-100 transition-colors disabled:opacity-50"
                  title={`Synchroniser la semaine ${week}`}>
                  <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />{isSyncing ? '...' : `Sync S${week}`}
                </button>
                <button onClick={() => disconnectIntegration(integ.provider)} className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors" title="Déconnecter">
                  <Link2Off className="w-3 h-3" />
                </button>
              </div>
            )
          })}
          <button onClick={() => setShowProviders(v => !v)}
            className="flex items-center gap-1 text-xs font-semibold text-pilote border border-dashed border-gray-300 rounded-xl px-2.5 py-1.5 hover:border-pilote transition-colors">
            <Link2 className="w-3 h-3" />{integrations.length === 0 ? 'Connecter un logiciel' : 'Ajouter'}
          </button>
        </div>
      </div>


      <PanneauxFacturation f={f} />

      <ModalesFacturation f={f} />

    </div>
  )
}
