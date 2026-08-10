'use client'

// Facturation — les BLOCS D'ÉCRAN des charges (les factures passées en charges
// fixes de la semaine, le tableau des charges récurrentes, le détail des
// charges de structure et leurs deux modales) et la modale de répartition des
// achats par rayon. Sortis de page.tsx pour que la page tienne sous le plafond
// de publication : aucun état, aucun effet, aucun appel API ici — la page garde
// tout cela et ne passe que des données et des gestes.

import { useState, type Dispatch, type SetStateAction } from 'react'
import {
  Plus, Trash2, Save, X, Check, Loader2, AlertCircle, ChevronLeft, ChevronRight,
  Repeat, PieChart, Pencil, CalendarClock, Scale, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  costForWindow, provisionForWindow, enumeratePeriods, reelsDeLaFenetre,
  reelsChevauchants, phraseChevauchement,
  type RecurringCharge, type RecurringActual, type Periodicity,
} from '@/lib/recurring-charges'
import { libelleMotif, PERIODE_LUE, type MotifEcart } from '@/lib/charges-fixes'
import { nomFournisseur } from '@/lib/supplier-name'
import {
  documentRemplacable, fmtEuro, fmtPct, catInfo, motifTon, normSupplier,
  pctSaisi, totalVent, emptyVent, periodicityLabel, periodicityShort,
  CATEGORIES, TVA_RATES, PERIODICITY_OPTIONS, EMPTY_RECURRING,
  type ChargeVue, type Invoice, type RayonFamille, type Summary,
  type VentDraft, type VentFamily,
} from './donnees'

/** Une ligne du détail « charges de structure », telle que le moteur la rend */
type LigneStructure = NonNullable<Summary['charges_fixes_lines']>[number]
/** Les lignes retenues, groupées par origine — provision ou facture */
type GroupeStructure = { key: 'recurrent' | 'facture'; titre: string; lignes: LigneStructure[] }
/** Une société en cours de répartition : son libellé et ses parts saisies */
type SocieteVent = { label: string; parts: VentDraft }


/** Les factures sorties des achats matière et classées en charge, dont la
 *  période couvre la semaine affichée */
export function BlocChargesFixesSemaine({
  fixedThisWeek,
  week,
  chargeFamilies,
  televersant,
  setChargeFam,
  moveBackToVariable,
  televerserDocument,
}: {
  fixedThisWeek: Invoice[]
  week: number
  chargeFamilies: VentFamily[]
  televersant: string | null
  setChargeFam: (inv: Invoice, familyId: string) => void
  moveBackToVariable: (inv: Invoice) => void
  televerserDocument: (inv: Invoice, fichier: File | null) => void
}) {
  return (
    <>
      {/* ── Factures déplacées en charges fixes cette semaine : hors marges
          matière, classées dans une famille de charge PERSONNALISABLE.
          Elles ne viennent PAS de la liste des achats — cette liste-là exclut
          les charges fixes par construction. Elles arrivent de ?fixed=all et
          sont retenues sur le CHEVAUCHEMENT de leur période avec la semaine. ── */}
      {fixedThisWeek.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-2">
            <div>
              <h2 className="font-bold text-gray-900 text-sm">Factures reçues cette semaine</h2>
              <p className="text-[11px] text-gray-400">Factures de charge (loyer, énergie, abonnements…) sorties des achats matière — elles ne pèsent sur aucune marge. Celles dont la période couvre la semaine {week}, même facturées avant. Seule une période <span className="font-semibold text-gray-500">lue sur le document</span> les fait entrer dans le résultat.</p>
            </div>
          </div>
          <div className="divide-y divide-gray-50">
            {fixedThisWeek.map(inv => {
              const jours = Number(inv.period_days ?? 0)
              const lue   = String(inv.period_source ?? '') === PERIODE_LUE
              return (
              <div key={inv.id} className="px-5 py-2.5 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[180px]">
                  <p className="text-sm font-semibold text-gray-900">{nomFournisseur(inv.supplier_name) || inv.supplier_name}</p>
                  <p className="text-[11px] text-gray-400 tabular">{new Date(inv.invoice_date).toLocaleDateString('fr-FR')}{inv.invoice_number ? ` · ${inv.invoice_number}` : ''}</p>
                </div>
                {/* La période ET SA PROVENANCE : c'est elle qui décide si la
                    charge entre dans le résultat, le boucher doit la voir. */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {jours > 0 ? (
                    <>
                      <span className="text-[11px] font-semibold text-gray-600 bg-gray-100 rounded-full px-2 py-0.5 tabular">{jours} jour{jours > 1 ? 's' : ''}</span>
                      <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ring-1 ${lue ? 'text-green-700 bg-green-50 ring-green-200' : 'text-amber-700 bg-amber-50 ring-amber-200'}`}
                        title={lue ? 'Période lue sur le document : sa part hebdomadaire entre dans le résultat de la semaine.' : 'Période devinée par la lecture : sa part hebdomadaire serait un chiffre inventé — elle n’entre pas dans le résultat.'}>
                        {lue ? 'période lue sur le document' : 'période devinée'}
                      </span>
                    </>
                  ) : (
                    <span className="text-[10px] font-bold rounded-full px-2 py-0.5 ring-1 text-amber-700 bg-amber-50 ring-amber-200"
                      title="Aucune période sur cette facture : impossible de dire quelle part revient à cette semaine — elle n’entre pas dans le résultat.">
                      aucune période
                    </span>
                  )}
                </div>
                <span className="text-sm font-semibold text-gray-700 tabular">{fmtEuro(inv.amount_ht)}</span>
                <select value={(inv as any).charge_family_id ?? ''} onChange={e => setChargeFam(inv, e.target.value)}
                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200">
                  <option value="">Famille de charge…</option>
                  {chargeFamilies.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                {/* Facture mal transmise ? Le boucher fournit le document, la
                    lecture juge sur pièce : matière → retour en achats tout
                    seul ; charge → elle reste ici, confirmée. (lot 31) */}
                {documentRemplacable(inv) && (
                  <label className={`text-[11px] font-bold rounded-lg px-2.5 py-1.5 cursor-pointer transition-colors ${televersant === inv.id ? 'text-gray-400 bg-gray-100' : 'text-white bg-pilote hover:bg-pilote-hover shadow-card'}`}
                    title="Joindre le PDF de cette facture : sa lecture décidera si c'est de la matière (retour en achats) ou bien une charge">
                    {televersant === inv.id ? 'Lecture…' : 'Téléverser la facture'}
                    <input type="file" accept="application/pdf,.pdf" className="hidden" disabled={televersant !== null}
                      onChange={e => { const f = e.target.files?.[0] ?? null; e.target.value = ''; televerserDocument(inv, f) }} />
                  </label>
                )}
                <button onClick={() => moveBackToVariable(inv)}
                  className="text-[11px] font-semibold text-gray-400 hover:text-pilote hover:underline">Repasser en achats</button>
              </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}


/** Les charges fixes & récurrentes, avec la provision de la semaine au jour près */
export function BlocChargesRecurrentes({
  loading,
  activeRecurring,
  recurringActuals,
  recurringWeekly,
  chargeHasActualThisWeek,
  monISO,
  sunISO,
  week,
  year,
  openNewRecurring,
  openEditRecurring,
  deleteRecurring,
  setReconYear,
  setReconChargeId,
  setActualDraft,
  setShowReconcile,
}: {
  loading: boolean
  activeRecurring: ChargeVue[]
  recurringActuals: RecurringActual[]
  recurringWeekly: number
  chargeHasActualThisWeek: Record<string, boolean>
  monISO: string
  sunISO: string
  week: number
  year: number
  openNewRecurring: () => void
  openEditRecurring: (c: RecurringCharge) => void
  deleteRecurring: (c: RecurringCharge) => void
  setReconYear: Dispatch<SetStateAction<number>>
  setReconChargeId: Dispatch<SetStateAction<string>>
  setActualDraft: Dispatch<SetStateAction<Record<string, string>>>
  setShowReconcile: Dispatch<SetStateAction<boolean>>
}) {
  return (
    <>
      {/* ── Charges fixes & récurrentes (provision au jour près) ── */}
      <div className="bg-white rounded-2xl border border-pilote-100 shadow-card overflow-hidden">
        <div className="px-5 py-3.5 border-b border-pilote-100 bg-pilote-50/60 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-white ring-1 ring-pilote-200/60 flex items-center justify-center flex-shrink-0"><Repeat className="w-4 h-4 text-pilote" /></div>
            <div className="min-w-0">
              <h2 className="font-bold text-gray-900">Charges fixes &amp; récurrentes</h2>
              <p className="text-[11px] text-gray-400">Loyer, énergie, assurance, crédit… étalées au jour près sur chaque semaine. Le réel remplace la provision sur sa période.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="text-right mr-1 hidden sm:block">
              <p className="text-sm font-bold text-pilote tabular">≈ {fmtEuro(recurringWeekly)}/sem</p>
              <p className="text-[10px] text-gray-400">semaine {week}</p>
            </div>
            <button onClick={() => { setReconYear(year); setReconChargeId(activeRecurring[0]?.id || ''); setActualDraft({}); setShowReconcile(true) }}
              disabled={activeRecurring.length === 0}
              className="inline-flex items-center gap-1.5 rounded-xl border border-pilote-200 text-pilote bg-white hover:bg-pilote-50 px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40">
              <Scale className="w-3.5 h-3.5" />Réconcilier
            </button>
            <button onClick={openNewRecurring}
              className="inline-flex items-center gap-1.5 rounded-xl bg-pilote hover:bg-pilote-hover text-white px-3 py-1.5 text-xs font-semibold shadow-card active:scale-[0.98] transition-all">
              <Plus className="w-3.5 h-3.5" />Ajouter
            </button>
          </div>
        </div>
        {loading ? (
          <div className="p-6 animate-pulse"><div className="h-10 bg-gray-100 rounded-lg" /></div>
        ) : activeRecurring.length === 0 ? (
          <div className="py-10 flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-lg bg-gray-50 ring-1 ring-gray-200/70 flex items-center justify-center mb-3">
              <Repeat className="w-5 h-5 text-gray-300" />
            </div>
            <p className="text-sm font-semibold text-gray-700">Aucune charge récurrente</p>
            <p className="text-xs text-gray-400 mt-1 max-w-sm">Ajoutez vos charges fixes (loyer, énergie, assurance, crédit, abonnements). Elles pèseront automatiquement, au jour près, sur chaque semaine.</p>
            <button onClick={openNewRecurring} className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-pilote hover:bg-pilote-hover text-white px-3.5 py-2 text-xs font-semibold shadow-card active:scale-[0.98] transition-all"><Plus className="w-3.5 h-3.5" />Ajouter une charge</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full tabular min-w-[720px]">
            <thead>
              <tr className="bg-gray-50 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                <th className="px-4 py-2.5 text-left">Charge</th>
                <th className="px-4 py-2.5 text-left">Catégorie</th>
                <th className="px-4 py-2.5 text-right">Montant</th>
                <th className="px-4 py-2.5 text-center">Périodicité</th>
                <th className="px-4 py-2.5 text-left">Période active</th>
                <th className="px-4 py-2.5 text-right">Provision hebdo</th>
                <th className="px-4 py-2.5 text-center w-24"></th>
              </tr>
            </thead>
            <tbody>
              {activeRecurring.map((c, i) => {
                const wk = costForWindow(c, recurringActuals, monISO, sunISO)
                const hasAct = chargeHasActualThisWeek[c.id]
                const ended = !!c.end_date && c.end_date < monISO
                const notStarted = c.start_date > sunISO
                return (
                  <tr key={c.id} className={`border-t border-gray-100 hover:bg-pilote-50/40 group transition-colors ${i % 2 === 0 ? '' : 'bg-gray-50/50'} ${c.active ? '' : 'opacity-60'}`}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center flex-shrink-0"><CalendarClock className="w-4 h-4" /></div>
                        <div>
                          <div className="font-semibold text-sm text-gray-900">{c.label}</div>
                          {!c.active && <div className="text-[10px] font-semibold text-gray-400">clôturée</div>}
                          {/* LE MÊME FOURNISSEUR DES DEUX CÔTÉS.
                              Une charge récurrente s'AJOUTE aux factures du
                              même fournisseur, elle ne les remplace pas :
                              sans ce mot, l'argent sort deux fois du
                              résultat, une fois en achats et une fois en
                              charges de structure. On pose la question, on
                              ne tranche pas — un fournisseur peut livrer de
                              la marchandise ET louer du matériel. */}
                          {c.double_emploi && (
                            <div className="mt-1 flex items-start gap-1.5 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 max-w-md">
                              <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-px" />
                              <span className="font-medium leading-snug">{c.double_emploi.phrase}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs font-semibold rounded-full px-2.5 py-0.5 ${catInfo(c.category).color}`}>{catInfo(c.category).label}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="font-semibold text-sm text-gray-900">{fmtEuro(c.amount_ht)}</span>
                      <span className="text-[10px] text-gray-400"> {periodicityShort(c.periodicity)}</span>
                    </td>
                    <td className="px-4 py-2.5 text-center text-xs text-gray-600">{periodicityLabel(c.periodicity)}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(c.start_date).toLocaleDateString('fr-FR')} → {c.end_date ? new Date(c.end_date).toLocaleDateString('fr-FR') : '…'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {wk > 0 ? (
                        <>
                          <span className="font-bold text-sm text-pilote tabular">≈ {fmtEuro(wk)}</span>
                          {hasAct && <span className="ml-1 text-[9px] font-bold text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full align-middle">réel</span>}
                        </>
                      ) : (
                        <span className="text-xs text-gray-300">{notStarted ? 'à venir' : ended ? 'terminée' : '—'}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1 md:opacity-0 md:group-hover:opacity-100 transition-all">
                        <button onClick={() => { setReconYear(year); setReconChargeId(c.id); setActualDraft({}); setShowReconcile(true) }} className="p-1.5 rounded hover:bg-pilote-50 text-gray-300 hover:text-pilote transition-colors" title="Réconcilier (saisir le réel par période)"><Scale className="w-3.5 h-3.5" /></button>
                        <button onClick={() => openEditRecurring(c)} className="p-1.5 rounded hover:bg-gray-100 text-gray-300 hover:text-gray-600 transition-colors" title="Modifier"><Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={() => deleteRecurring(c)} className="p-1.5 rounded hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors" title="Supprimer"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-pilote text-white">
                <td colSpan={5} className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white/60">Provision de la semaine {week}</td>
                <td className="px-4 py-2.5 text-right font-bold text-orange-300">≈ {fmtEuro(recurringWeekly)}/sem</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
          </div>
        )}
      </div>
    </>
  )
}


/** Le détail du montant retiré du résultat net — et les lignes non comptées */
export function BlocChargesStructure({
  structureLines,
  structureGroupes,
  structureEcartees,
  structureTotal,
  structureSomme,
  structureEcart,
  ecarteesPieces,
  ecarteesOuvertes,
  setEcarteesOuvertes,
  week,
}: {
  structureLines: LigneStructure[]
  structureGroupes: GroupeStructure[]
  structureEcartees: LigneStructure[]
  structureTotal: number
  structureSomme: number
  structureEcart: number
  ecarteesPieces: number
  ecarteesOuvertes: boolean
  setEcarteesOuvertes: Dispatch<SetStateAction<boolean>>
  week: number
}) {
  return (
    <>
      {/* ── Charges de structure de la semaine ──────────────────────────────
          Le DÉTAIL du montant qui sort du résultat net : le moteur le calcule
          (charges_fixes_lines), le résumé le transporte, et jusqu'ici personne
          ne le montrait. Deux origines — la provision d'une charge récurrente,
          la part hebdomadaire d'une facture de charge — et surtout les lignes
          ÉCARTÉES avec leur motif : une charge qui n'entre pas dans le
          résultat est une information, pas un silence.
          Le total affiché est celui du MOTEUR ; la somme des lignes retenues
          ne sert qu'à le contrôler, et l'écart éventuel se dit. ── */}
      {structureLines.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="font-bold text-gray-900">Charges de structure de la semaine {week}</h2>
              <p className="text-[11px] text-gray-400 max-w-xl">Le détail du montant retiré du résultat net : provisions récurrentes et parts hebdomadaires des factures de charge — et ce qui n'y entre pas.</p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Retiré du résultat</p>
              <p className="text-2xl font-extrabold tracking-tight text-gray-900 tabular leading-tight">{fmtEuro(structureTotal)}</p>
            </div>
          </div>

          {structureGroupes.map(g => (
            <div key={g.key}>
              <div className="px-5 py-2 bg-gray-50/80 border-t border-gray-100 flex items-center justify-between gap-3">
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
                  {g.titre}
                  <span className="ml-1.5 font-semibold normal-case tracking-normal text-gray-400">· {g.lignes.length} ligne{g.lignes.length > 1 ? 's' : ''}</span>
                </span>
                <span className="text-xs font-bold text-gray-700 tabular">{fmtEuro(Math.round(g.lignes.reduce((s, l) => s + (Number(l.cost) || 0), 0) * 100) / 100)}</span>
              </div>
              <div className="divide-y divide-gray-50">
                {g.lignes.map(l => (
                  <div key={`${g.key}-${l.id}`} className="px-5 py-2.5 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">
                        {l.label}
                        {/* Le réel saisi a remplacé la provision sur sa fenêtre */}
                        {g.key === 'recurrent' && l.hasActual && (
                          <span className="ml-1.5 text-[9px] font-bold text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full align-middle">réel</span>
                        )}
                      </p>
                      <p className="text-[11px] text-gray-400 leading-snug">{l.phrase || catInfo(l.category).label}</p>
                    </div>
                    <span className="text-sm font-bold text-pilote tabular flex-shrink-0">{fmtEuro(Number(l.cost) || 0)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="px-5 py-3 bg-pilote text-white flex items-center justify-between gap-3">
            <span className="text-xs font-bold uppercase tracking-wider text-white/60">Charges de structure retenues</span>
            <span className="text-base font-bold tabular text-orange-300">{fmtEuro(structureTotal)}</span>
          </div>

          {/* Le total vient du calcul. Si les lignes ne tombent pas dessus, on
              le DIT : masquer un écart, c'est publier un chiffre qu'on ne sait
              pas justifier. */}
          {structureEcart !== 0 && (
            <div className="px-5 py-2.5 bg-amber-50 border-t border-amber-200 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] font-medium text-amber-800 leading-snug">
                Les lignes ci-dessus totalisent <span className="font-bold tabular">{fmtEuro(structureSomme)}</span>, soit {structureEcart > 0 ? '+' : '−'}<span className="font-bold tabular">{fmtEuro(Math.abs(structureEcart))}</span> par rapport au montant retiré du résultat. C'est le montant du calcul qui fait foi — signalez cet écart.
              </p>
            </div>
          )}

          {structureEcartees.length > 0 && (
            <div className="border-t border-gray-100">
              <button onClick={() => setEcarteesOuvertes(v => !v)}
                className="w-full px-5 py-3 flex items-center justify-between gap-3 text-left hover:bg-gray-50 transition-colors">
                <span className="inline-flex items-center gap-2 text-xs font-bold text-gray-700">
                  <AlertCircle className="w-3.5 h-3.5 text-pilote-orange" />
                  {structureEcartees.length} charge{structureEcartees.length > 1 ? 's' : ''} non comptée{structureEcartees.length > 1 ? 's' : ''}
                </span>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-gray-400">
                  <span className="tabular">{fmtEuro(ecarteesPieces)}</span> de factures hors résultat
                  <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-300 ${ecarteesOuvertes ? 'rotate-90' : ''}`} />
                </span>
              </button>
              {ecarteesOuvertes && (
                <div className="divide-y divide-gray-50 border-t border-gray-100">
                  {structureEcartees.map(l => (
                    <div key={`ecartee-${l.id}`} className="px-5 py-3 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-gray-700">{l.label}</p>
                          {l.motif && (
                            <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ring-1 ${motifTon(l.motif)}`}>
                              {libelleMotif(l.motif as MotifEcart)}
                            </span>
                          )}
                        </div>
                        {l.phrase && <p className="text-[11px] text-gray-500 leading-snug mt-0.5 max-w-2xl">{l.phrase}</p>}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-semibold text-gray-400 tabular">{fmtEuro(Number(l.montant_facture) || 0)}</p>
                        <p className="text-[10px] font-semibold text-gray-400">non comptée</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}


/** Création / édition d'une charge récurrente */
export function ModaleChargeRecurrente({
  showRecurring,
  setShowRecurring,
  recForm,
  setRecForm,
  recSaving,
  saveRecurring,
}: {
  showRecurring: boolean
  setShowRecurring: Dispatch<SetStateAction<boolean>>
  recForm: typeof EMPTY_RECURRING
  setRecForm: Dispatch<SetStateAction<typeof EMPTY_RECURRING>>
  recSaving: boolean
  saveRecurring: () => void
}) {
  return (
    <>
      {/* Modal : Charge récurrente (création / édition) */}
      {showRecurring && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm p-4" onClick={() => setShowRecurring(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="text-base font-bold text-gray-900">{recForm.id ? 'Modifier la charge' : 'Nouvelle charge récurrente'}</h2>
              <button onClick={() => setShowRecurring(false)} className="p-1.5 rounded-xl hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Libellé</label>
                <Input value={recForm.label} onChange={e => setRecForm(p => ({ ...p, label: e.target.value }))} placeholder="Loyer, EDF, assurance…" autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Montant HT (€)</label>
                  <Input type="number" step="0.01" min="0" value={recForm.amount_ht} onChange={e => setRecForm(p => ({ ...p, amount_ht: e.target.value }))} placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Périodicité</label>
                  <select value={recForm.periodicity} onChange={e => setRecForm(p => ({ ...p, periodicity: e.target.value as Periodicity }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200">
                    {PERIODICITY_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Catégorie</label>
                  <select value={recForm.category} onChange={e => setRecForm(p => ({ ...p, category: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200">
                    {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">TVA (%)</label>
                  <select value={recForm.tva_rate} onChange={e => setRecForm(p => ({ ...p, tva_rate: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200">
                    {TVA_RATES.map(t => <option key={t} value={String(t)}>{t} %</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Début</label>
                  <Input type="date" value={recForm.start_date} onChange={e => setRecForm(p => ({ ...p, start_date: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Fin <span className="text-gray-400 font-normal">(optionnel)</span></label>
                  <Input type="date" value={recForm.end_date} onChange={e => setRecForm(p => ({ ...p, end_date: e.target.value }))} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={recForm.active} onChange={e => setRecForm(p => ({ ...p, active: e.target.checked }))} className="rounded border-gray-300 text-pilote focus:ring-pilote-200" />
                Charge active (décochez pour la geler sans la supprimer)
              </label>
              <p className="text-[11px] text-gray-400">Le montant saisi est celui d&apos;UNE période ({periodicityLabel(recForm.periodicity).toLowerCase()}). Il est réparti au jour près sur les semaines couvertes.</p>
            </div>
            <div className="flex gap-2 p-5 border-t border-gray-100">
              <Button variant="outline" className="flex-1" onClick={() => setShowRecurring(false)}>Annuler</Button>
              <Button onClick={saveRecurring} disabled={recSaving} className="flex-1 bg-pilote hover:bg-pilote-hover text-white">
                {recSaving ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Enregistrement...</> : <><Save className="w-4 h-4 mr-1.5" />Enregistrer</>}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}


/** Provisionné vs réel : le montant réellement facturé remplace la provision */
export function ModaleReconciliation({
  showReconcile,
  setShowReconcile,
  reconChargeId,
  setReconChargeId,
  reconYear,
  setReconYear,
  actualDraft,
  setActualDraft,
  recurringCharges,
  recurringActuals,
  activeRecurring,
  saveActual,
  deleteActual,
}: {
  showReconcile: boolean
  setShowReconcile: Dispatch<SetStateAction<boolean>>
  reconChargeId: string
  setReconChargeId: Dispatch<SetStateAction<string>>
  reconYear: number
  setReconYear: Dispatch<SetStateAction<number>>
  actualDraft: Record<string, string>
  setActualDraft: Dispatch<SetStateAction<Record<string, string>>>
  recurringCharges: ChargeVue[]
  recurringActuals: RecurringActual[]
  activeRecurring: ChargeVue[]
  saveActual: (chargeId: string, period_start: string, period_end: string, amount: number) => void
  deleteActual: (id: string) => void
}) {
  // Le refus d'un relevé qui en recouvrirait un autre, attaché à SA période :
  // la phrase s'affiche là où le boucher vient de cliquer, pas en haut de l'écran.
  const [refus, setRefus] = useState<{ cle: string; texte: string } | null>(null)
  return (
    <>
      {/* Modal : Réconciliation provisionné vs réel */}
      {showReconcile && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm p-4" onClick={() => setShowReconcile(false)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between p-5 border-b border-gray-100">
              <div>
                <h2 className="text-base font-bold text-gray-900">Réconciliation — provisionné vs réel</h2>
                <p className="text-xs text-gray-500 mt-0.5 max-w-md">Saisissez le montant réel facturé pour une période. Il remplace la provision sur sa fenêtre — le résultat net des semaines concernées est recalculé.</p>
              </div>
              <button onClick={() => setShowReconcile(false)} className="p-1.5 rounded-xl hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="flex items-center gap-2 px-5 pt-3">
              <select value={reconChargeId} onChange={e => { setReconChargeId(e.target.value); setActualDraft({}) }} className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200">
                {activeRecurring.map(c => <option key={c.id} value={c.id}>{c.label} · {periodicityLabel(c.periodicity)}</option>)}
              </select>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => setReconYear(y => y - 1)} className="p-1.5 rounded-xl hover:bg-gray-100"><ChevronLeft className="w-4 h-4 text-gray-500" /></button>
                <span className="text-sm font-bold text-gray-900 tabular w-12 text-center">{reconYear}</span>
                <button onClick={() => setReconYear(y => y + 1)} className="p-1.5 rounded-xl hover:bg-gray-100"><ChevronRight className="w-4 h-4 text-gray-500" /></button>
              </div>
            </div>
            <div className="p-5 pt-3 overflow-y-auto">
              {(() => {
                const c = recurringCharges.find(x => x.id === reconChargeId)
                if (!c) return <p className="text-sm text-gray-400 py-8 text-center">Sélectionnez une charge.</p>
                const periods = enumeratePeriods(c, `${reconYear}-01-01`, `${reconYear}-12-31`)
                if (periods.length === 0) return <p className="text-sm text-gray-400 py-8 text-center">Aucune période active en {reconYear}.</p>
                return (
                  <>
                    <div className="hidden md:flex items-center gap-2 px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                      <span className="w-28">Période</span>
                      <span className="flex-1 text-right">Provisionné</span>
                      <span className="flex-1 text-right">Réel</span>
                      <span className="flex-1 text-right">Écart</span>
                      <span className="w-24" />
                    </div>
                    <div className="space-y-1.5">
                      {periods.map(occ => {
                        const sISO = occ.start.toISOString().slice(0, 10)
                        const eISO = occ.end.toISOString().slice(0, 10)
                        const prov = provisionForWindow(c, sISO, eISO)
                        // La MÊME règle que le moteur : la fenêtre la plus étroite, jour par
                        // jour. Chercher « le premier qui chevauche » pouvait afficher un
                        // montant que le résultat de la semaine ne comptait pas.
                        const reels = reelsDeLaFenetre(recurringActuals, c.id, sISO, eISO)
                        const act = reels[0] ?? null
                        const partage = reels.length > 1
                        const draft = actualDraft[occ.key] ?? ''
                        const ecart = act ? Number(act.amount_ht) - prov : 0
                        return (
                          <div key={occ.key} className="flex flex-col md:flex-row md:items-center gap-2 p-2 rounded-lg hover:bg-gray-50">
                            <span className="w-28 text-sm font-semibold text-gray-800">{occ.label}</span>
                            <span className="flex-1 text-right text-sm text-gray-600 tabular">{fmtEuro(prov)}</span>
                            {act ? (
                              <>
                                <span className="flex-1 text-right text-sm font-semibold text-gray-900 tabular">
                                  {fmtEuro(Number(act.amount_ht))}
                                  {partage && (
                                    <span className="block text-[10px] font-medium text-amber-600" title={reels.map(r => `${r.period_start} → ${r.period_end} : ${Number(r.amount_ht).toFixed(2)} €`).join(' · ')}>
                                      {reels.length} relevés sur cette période
                                    </span>
                                  )}
                                </span>
                                <span className={`flex-1 text-right text-sm font-bold tabular ${ecart > 0 ? 'text-red-500' : ecart < 0 ? 'text-green-600' : 'text-gray-400'}`}>{ecart > 0 ? '+' : ''}{fmtEuro(ecart)}</span>
                                <span className="w-24 flex justify-end"><button onClick={() => deleteActual(act.id)} className="text-xs font-medium text-gray-400 hover:text-red-500">Retirer</button></span>
                              </>
                            ) : (
                              <>
                                <div className="flex-1 flex justify-end">
                                  <input type="number" step="0.01" min="0" value={draft} onChange={e => setActualDraft(p => ({ ...p, [occ.key]: e.target.value }))} placeholder="réel €" className="w-24 border border-gray-300 rounded-lg px-2 py-1 text-sm text-right tabular focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                                </div>
                                <span className="flex-1 text-right text-xs text-gray-300">—</span>
                                <span className="w-24 flex justify-end">
                                  <button
                                    disabled={!draft}
                                    onClick={() => {
                                      // La MÊME fonction que le serveur. Le serveur reste
                                      // l'arbitre — il refuse en 409 —, mais c'est ici que
                                      // le boucher lit POURQUOI, avant d'avoir cliqué dans
                                      // le vide.
                                      const genants = reelsChevauchants(recurringActuals, c.id, sISO, eISO)
                                      if (genants.length > 0) { setRefus({ cle: occ.key, texte: phraseChevauchement(genants) }); return }
                                      setRefus(null)
                                      saveActual(c.id, sISO, eISO, parseFloat(draft) || 0)
                                      setActualDraft(p => { const n = { ...p }; delete n[occ.key]; return n })
                                    }}
                                    className="text-xs font-semibold text-pilote hover:underline disabled:opacity-40"
                                  >Enregistrer</button>
                                </span>
                              </>
                            )}
                            {refus?.cle === occ.key && (
                              <p className="w-full text-[11px] leading-relaxed text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
                                {refus.texte}
                              </p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </>
                )
              })()}
              <p className="text-[11px] text-gray-400 mt-3">Écart = réel − provisionné. Un écart positif (rouge) = la charge réelle a dépassé la provision ; les semaines de la période sont recalculées avec le réel.</p>
            </div>
            <div className="flex gap-2 p-5 border-t border-gray-100">
              <Button variant="outline" className="flex-1" onClick={() => setShowReconcile(false)}>Fermer</Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}


/** Répartition des achats par rayon, société par société */
export function ModaleRepartitionRayons({
  showSplits,
  setShowSplits,
  splitSearch,
  setSplitSearch,
  splitsTab,
  setSplitsTab,
  splitOpen,
  setSplitOpen,
  splitEntries,
  splitsTodo,
  splitsDone,
  splitSuppliers,
  famillesOrdonnees,
  setSplitDraft,
  splitSaving,
  saveSplits,
}: {
  showSplits: boolean
  setShowSplits: Dispatch<SetStateAction<boolean>>
  splitSearch: string
  setSplitSearch: Dispatch<SetStateAction<string>>
  splitsTab: 'todo' | 'all'
  setSplitsTab: Dispatch<SetStateAction<'todo' | 'all'>>
  splitOpen: string | null
  setSplitOpen: Dispatch<SetStateAction<string | null>>
  splitEntries: [string, SocieteVent][]
  splitsTodo: [string, SocieteVent][]
  splitsDone: [string, SocieteVent][]
  splitSuppliers: { key: string; name: string }[]
  famillesOrdonnees: RayonFamille[]
  setSplitDraft: Dispatch<SetStateAction<Record<string, SocieteVent>>>
  splitSaving: boolean
  saveSplits: () => void
}) {
  return (
    <>
      {/* Modal : Répartition des achats par rayon (par fournisseur) */}
      {showSplits && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm p-4" onClick={() => setShowSplits(false)}>
          <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between p-5 pb-3 border-b border-gray-100">
              <div>
                <h2 className="text-base font-bold text-gray-900">Répartition des achats par rayon</h2>
                <p className="text-xs text-gray-500 mt-0.5 max-w-xl">Pour chaque société, indiquez la part (%) de ses achats affectée à chaque famille de votre boutique — les mêmes familles que celles de votre chiffre d&apos;affaires. Appliqué automatiquement à toutes ses factures.</p>
              </div>
              <button onClick={() => setShowSplits(false)} className="p-1.5 rounded-xl hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            {/* Chercher une société + ne garder que celles qui restent à répartir */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 px-5 pt-3 pb-1">
              <input value={splitSearch} onChange={e => setSplitSearch(e.target.value)} placeholder="Rechercher une société…"
                className="flex-1 border border-gray-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200" />
              <label className="flex items-center gap-2 text-xs font-semibold text-gray-600 cursor-pointer select-none flex-shrink-0">
                <input type="checkbox" checked={splitsTab === 'todo'}
                  onChange={e => { setSplitsTab(e.target.checked ? 'todo' : 'all'); setSplitOpen(null) }}
                  className="w-4 h-4 rounded border-gray-300 accent-pilote" />
                Seulement les sociétés non réparties
                <span className="rounded-full bg-gray-100 text-gray-600 px-1.5 text-[10px] font-bold tabular">{splitsTodo.length}</span>
              </label>
            </div>
            <div className="p-5 pt-2 overflow-y-auto">
              {(() => {
                const base = splitsTab === 'todo' ? splitsTodo : splitEntries
                const q = normSupplier(splitSearch)
                const list = q ? base.filter(([, v]) => normSupplier(v.label).includes(q)) : base
                if (list.length === 0) {
                  if (q) {
                    return (
                      <div className="text-center py-12">
                        <div className="w-11 h-11 rounded-lg bg-gray-50 flex items-center justify-center mx-auto mb-3"><PieChart className="w-5 h-5 text-gray-300" /></div>
                        <p className="text-sm font-semibold text-gray-700">Aucune société ne correspond à « {splitSearch.trim()} »</p>
                        <p className="text-xs text-gray-400 mt-1">{splitsTab === 'todo' ? 'Décochez le filtre pour chercher parmi toutes vos sociétés.' : 'Vérifiez l’orthographe du nom.'}</p>
                      </div>
                    )
                  }
                  return splitsTab === 'todo' ? (
                    <div className="text-center py-12">
                      <div className="w-11 h-11 rounded-lg bg-pilote-50 flex items-center justify-center mx-auto mb-3"><Check className="w-5 h-5 text-pilote" /></div>
                      <p className="text-sm font-semibold text-gray-700">Tout est réparti</p>
                      <p className="text-xs text-gray-400 mt-1">{splitSuppliers.length === 0 ? "Ajoutez des factures d'achat pour commencer." : 'Chaque société connue a sa ventilation.'}</p>
                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <div className="w-11 h-11 rounded-lg bg-gray-50 flex items-center justify-center mx-auto mb-3"><PieChart className="w-5 h-5 text-gray-300" /></div>
                      <p className="text-sm font-semibold text-gray-700">Aucune société connue</p>
                      <p className="text-xs text-gray-400 mt-1">Ajoutez des factures d&apos;achat : leurs sociétés apparaîtront ici.</p>
                    </div>
                  )
                }
                return (
                  <>
                    <div className="flex items-center justify-between px-1 pb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      <span>{list.length} société{list.length > 1 ? 's' : ''}</span>
                      <span className="tabular">{splitsDone.length} répartie{splitsDone.length > 1 ? 's' : ''} sur {splitEntries.length}</span>
                    </div>
                    <div className="space-y-2">
                      {list.map(([key, v]) => {
                        const tot = totalVent(v.parts)
                        const ouverte = splitOpen === key
                        // Les deux familles les plus lourdes — le résumé qui dit d'un coup d'œil
                        // ce que fait cette société, sans déplier quinze cases.
                        const lourdes = famillesOrdonnees
                          .map(f => ({ nom: f.name, pct: pctSaisi(v.parts[f.id]) }))
                          .filter(x => x.pct > 0)
                          .sort((a, b) => b.pct - a.pct)
                        const resume = lourdes.slice(0, 2).map(x => `${fmtPct(x.pct)} % ${x.nom}`).join(' · ')
                        const autres = lourdes.length - 2
                        const upd = (id: string, val: string) =>
                          setSplitDraft(prev => ({ ...prev, [key]: { ...prev[key], parts: { ...prev[key].parts, [id]: val } } }))
                        const vider = () =>
                          setSplitDraft(prev => ({ ...prev, [key]: { ...prev[key], parts: emptyVent() } }))
                        return (
                          <div key={key} className={`rounded-2xl border bg-white transition-all ${ouverte ? 'border-pilote-200 shadow-card' : 'border-gray-100 hover:border-gray-200'}`}>
                            <button onClick={() => setSplitOpen(o => (o === key ? null : key))}
                              className="w-full flex items-center gap-3 px-4 py-3 text-left">
                              <ChevronRight className={`w-4 h-4 flex-shrink-0 transition-transform ${ouverte ? 'rotate-90 text-pilote' : 'text-gray-300'}`} />
                              <span className="flex-1 min-w-0 truncate text-sm font-semibold text-gray-900" title={v.label}>{v.label}</span>
                              <span className={`hidden sm:block max-w-[16rem] truncate text-xs ${tot > 0 ? 'text-gray-500' : 'text-gray-400'}`}>
                                {tot > 0 ? `${resume}${autres > 0 ? ` · +${autres}` : ''}` : 'non réparti'}
                              </span>
                              {tot > 0 && (
                                <span className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold tabular ${
                                  tot >= 99.5 && tot <= 100.5 ? 'bg-green-50 text-green-700'
                                    : tot < 99.5 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'
                                }`}>
                                  {tot >= 99.5 && tot <= 100.5
                                    ? `${fmtPct(tot)} %`
                                    : tot < 99.5
                                      ? `${fmtPct(tot)} % · il reste ${fmtPct(100 - tot)} %`
                                      : `${fmtPct(tot)} % · ${fmtPct(tot - 100)} % de trop`}
                                </span>
                              )}
                            </button>
                            {ouverte && (
                              <div className="border-t border-gray-100 px-4 py-3">
                                {famillesOrdonnees.length === 0 ? (
                                  <p className="text-xs text-gray-400">Aucune famille de vente pour l&apos;instant — la répartition s&apos;ouvrira dès que vos familles seront créées.</p>
                                ) : (
                                  <>
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1.5">
                                      {famillesOrdonnees.map(f => {
                                        const sousFamille = f.parent_id !== null
                                        return (
                                          <div key={f.id} className={`flex items-center gap-1.5 ${sousFamille ? 'pl-3' : ''}`}>
                                            <span className={`flex-1 min-w-0 truncate ${sousFamille ? 'text-[11px] text-gray-500' : 'text-xs font-semibold text-gray-700'}`} title={f.name}>
                                              {sousFamille ? `› ${f.name}` : f.name}
                                            </span>
                                            <input type="number" min="0" max="100" value={v.parts[f.id] ?? ''} onChange={e => upd(f.id, e.target.value)}
                                              placeholder="0"
                                              className="w-14 flex-shrink-0 border border-gray-200 rounded-lg px-1.5 py-1 text-sm text-right tabular focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                                            <span className="text-[10px] text-gray-400 flex-shrink-0">%</span>
                                          </div>
                                        )
                                      })}
                                    </div>
                                    <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-50">
                                      <button onClick={vider}
                                        className="text-[11px] font-semibold text-gray-400 hover:text-red-500 rounded-lg px-2 py-1 hover:bg-red-50 transition-colors">
                                        Vider
                                      </button>
                                      <span className="text-[11px] text-gray-400">Une sous-famille compte dans sa famille.</span>
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </>
                )
              })()}
              <p className="text-[11px] text-gray-400 mt-3">Le total par société devrait faire 100 %. Une société laissée vide reste « non répartie » et n&apos;entre pas dans la marge par famille. Vider une répartition la renvoie dans les sociétés non réparties après enregistrement.</p>
            </div>
            <div className="flex gap-2 p-5 border-t border-gray-100">
              <Button variant="outline" className="flex-1" onClick={() => setShowSplits(false)}>Fermer</Button>
              <Button onClick={saveSplits} disabled={splitSaving} className="flex-1 bg-pilote hover:bg-pilote-hover text-white">
                {splitSaving ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Enregistrement...</> : <><Save className="w-4 h-4 mr-1.5" />Enregistrer</>}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
