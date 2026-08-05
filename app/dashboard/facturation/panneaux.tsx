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


/**
 * Les panneaux de l'écran Facturation : intégrations, achats de la semaine,
 * charges de structure. Extraits de `page.tsx` sans réécriture — le JSX est
 * celui d'avant, ligne pour ligne.
 *
 * Tout arrive dans un seul objet, celui du hook `useFacturation` : son type se
 * déduit de ce que le hook renvoie, si bien qu'aucune liste de propriétés n'est
 * maintenue en double. Ce bloc ne décide de rien — il affiche.
 */

import { type Facturation } from './etat'

export function PanneauxFacturation({ f }: { f: Facturation }) {
  const {
    week, year, ecarteesOuvertes, setEcarteesOuvertes, recurringCharges, recurringActuals,
    showRecurring, setShowRecurring, recForm, setRecForm, recSaving, showReconcile,
    setShowReconcile, reconChargeId, setReconChargeId, reconYear, setReconYear, actualDraft,
    setActualDraft, summary, loading, showProviders, chargeFamilies, invoiceView,
    setInvoiceView, mail, mailStep, setMailStep, mailAddr, setMailAddr,
    mailCode, setMailCode, mailBusy, mailMsg, setMailMsg, mailCopie,
    setMailCopie, mailEdition, setMailEdition, integrations, setShowConnect, setConnectProvider,
    setConnectToken, setConnectCompanyId, setConnectError, rattrapage, monISO, sunISO,
    envoyerCodeMail, validerCodeMail, verifierCodeTransfert, openAdd, moveBackToVariable, televersant,
    televerserDocument, setChargeFam, validateAllPending, openNewRecurring, openEditRecurring, saveRecurring,
    deleteRecurring, saveActual, deleteActual, lancerRattrapage, variableInvoices, sortedVariable,
    invoiceGroups, pendingCount, pendingHt, variableTotalHt, variableTotalTtc, recurringWeekly,
    chargeHasActualThisWeek, activeRecurring, fixedThisWeek, structureLines, structureEcartees, structureGroupes,
    structureTotal, structureSomme, structureEcart, ecarteesPieces, renderInvoiceRow,
  } = f
  return (
    <>
      {/* Panneau intégrations (replié par défaut) */}
      {showProviders && (
        <div className="bg-white border-b border-gray-100 px-6 py-4 space-y-4">
          {/* ── Rattrapage initial : les 2 derniers mois, une seule fois ── */}
          {(() => {
            const pl = integrations.find(i => i.provider === 'pennylane')
            if (!pl) return null
            const fait = Boolean(pl.backfill_at)
            return (
              <div className={`rounded-2xl border p-4 ${fait ? 'border-gray-100 bg-gray-50/60' : 'border-pilote-100 bg-white'}`}>
                <div className="flex items-start gap-3 flex-wrap">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${fait ? 'bg-gray-300' : 'bg-pilote'}`}>
                    <History className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-[240px]">
                    <p className="font-bold text-sm text-gray-900">
                      {fait ? 'Vos 2 derniers mois ont déjà été récupérés' : 'Récupérer vos 2 derniers mois de factures'}
                    </p>
                    {fait ? (
                      <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
                        Fait le {new Date(String(pl.backfill_at)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                        {typeof pl.backfill_imported === 'number' ? ` · ${pl.backfill_imported} facture${pl.backfill_imported > 1 ? 's' : ''} récupérée${pl.backfill_imported > 1 ? 's' : ''}` : ''}
                        {pl.backfill_tronque ? ' · le plafond de 100 factures par appel avait été atteint : il en manque peut-être' : ''}.
                        {' '}Cette récupération ne se rejoue pas — les factures qui arrivent depuis sont prises par la synchronisation hebdomadaire.
                      </p>
                    ) : (
                      <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
                        La synchronisation travaille semaine par semaine : pour démarrer avec un historique, il faudrait
                        la lancer neuf fois. Ce bouton interroge Pennylane <strong>une seule fois</strong> sur les deux
                        derniers mois. Les factures arrivent « à vérifier » et n&apos;entrent dans vos marges
                        qu&apos;après votre validation. À utiliser une fois, à la mise en service.
                      </p>
                    )}
                  </div>
                  {!fait && (
                    <button onClick={lancerRattrapage} disabled={rattrapage}
                      className="flex items-center gap-1.5 bg-pilote hover:bg-pilote-hover text-white text-xs font-semibold rounded-xl px-3.5 py-2 transition-colors disabled:opacity-50 flex-shrink-0">
                      <History className={`w-3.5 h-3.5 ${rattrapage ? 'animate-spin' : ''}`} />
                      {rattrapage ? 'Récupération…' : 'Récupérer 2 mois'}
                    </button>
                  )}
                </div>
              </div>
            )
          })()}

          {/* ── Sans logiciel de facturation : l'adresse de transfert ── */}
          <div className="rounded-2xl border border-pilote-100 bg-pilote-50/40 p-4">
            <div className="flex items-start gap-3 flex-wrap">
              <div className="w-8 h-8 rounded-lg bg-pilote flex items-center justify-center flex-shrink-0">
                <Mail className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1 min-w-[240px]">
                <p className="font-bold text-sm text-gray-900">Pas de logiciel de facturation ? Vos factures arrivent par email, toutes seules</p>
                <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
                  Mettez en place le transfert automatique UNE fois (guide ci-dessous), ou donnez simplement cette adresse
                  à vos fournisseurs : chaque facture qui arrive dans votre boîte file ici sans aucun geste. La pièce
                  jointe PDF est archivée et lue exactement comme une facture synchronisée — lignes, mercuriale, prix du
                  jour. Elle arrive « à vérifier » et n&apos;entre dans vos marges qu&apos;après votre validation.
                </p>
              </div>
            </div>

            {mail.verified && mail.forward_id && !mailEdition ? (
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <code className="text-xs font-semibold text-pilote-800 bg-white ring-1 ring-pilote-100 rounded-lg px-3 py-2 tabular">
                  factures-{mail.forward_id}@getpilote.app
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(`factures-${mail.forward_id}@getpilote.app`)
                      .then(() => { setMailCopie(true); setTimeout(() => setMailCopie(false), 2000) })
                      .catch(() => setMailMsg({ ok: false, texte: 'Copie impossible — sélectionnez l\'adresse à la main.' }))
                  }}
                  className="flex items-center gap-1.5 text-xs font-semibold text-pilote border border-pilote-200 bg-white rounded-lg px-2.5 py-2 hover:bg-pilote-50 transition-colors">
                  {mailCopie ? <><Check className="w-3.5 h-3.5" />Copiée</> : <><Copy className="w-3.5 h-3.5" />Copier</>}
                </button>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-700 bg-green-50 rounded-full px-2 py-1">
                  <Check className="w-3 h-3" />Adresse active{mail.email ? ` · vérifiée sur ${mail.email}` : ''}
                </span>
                <button onClick={() => { setMailEdition(true); setMailAddr(mail.email ?? ''); setMailStep('idle'); setMailMsg(null) }}
                  title="L'adresse de facturation n'est pas forcément celle du compte — changez-la ici (nouveau code de vérification)"
                  className="text-[11px] font-semibold text-gray-500 hover:text-pilote hover:underline">
                  Changer l&apos;adresse
                </button>

                {/* Le code que Gmail a envoyé pour valider le transfert automatique —
                    capté par PILOTE et relayé ici, sinon la mise en place mourrait
                    à cette étape (le code part à l'adresse PILOTE, pas au boucher). */}
                {mail.confirmation && (
                  <div className="w-full mt-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                    <p className="text-xs font-bold text-amber-800">Gmail demande une confirmation — la voici :</p>
                    {mail.confirmation.code && (
                      <p className="mt-1 text-lg font-extrabold tracking-widest text-gray-900 tabular">{mail.confirmation.code}</p>
                    )}
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      Saisissez ce code dans la fenêtre Gmail « Ajouter une adresse de transfert »
                      {mail.confirmation.lien ? <> — ou <a href={mail.confirmation.lien} target="_blank" rel="noreferrer" className="font-semibold underline">confirmez en un clic</a>, puis activez le transfert dans Gmail.</> : ', puis activez le transfert.'}
                    </p>
                  </div>
                )}

                {/* Mise en place du transfert AUTOMATIQUE : configurée une fois,
                    plus aucun geste — facture reçue = facture arrivée ici. */}
                <details className="w-full mt-1">
                  <summary className="cursor-pointer text-xs font-semibold text-pilote hover:underline">
                    Mettre en place le transfert automatique (une fois, 2 minutes)
                  </summary>
                  <div className="mt-2 grid md:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-gray-100 bg-white p-3">
                      <p className="text-xs font-bold text-gray-900 mb-1.5">Sur Gmail</p>
                      <ol className="text-[11px] text-gray-600 space-y-1 list-decimal list-inside leading-relaxed">
                        <li>Roue dentée → « Voir tous les paramètres » → onglet <span className="font-semibold">Transfert et POP/IMAP</span></li>
                        <li>« Ajouter une adresse de transfert » → collez votre adresse PILOTE ci-dessus</li>
                        <li>Gmail envoie un code de confirmation : <span className="font-semibold">il s&apos;affiche ici</span> — cliquez « Relever le code Gmail »</li>
                        <li>Choisissez « Transférer une copie » : vos mails restent aussi dans votre boîte</li>
                      </ol>
                    </div>
                    <div className="rounded-xl border border-gray-100 bg-white p-3">
                      <p className="text-xs font-bold text-gray-900 mb-1.5">Sur Outlook</p>
                      <ol className="text-[11px] text-gray-600 space-y-1 list-decimal list-inside leading-relaxed">
                        <li>Roue dentée → « Courrier » → <span className="font-semibold">Transfert</span></li>
                        <li>« Activer le transfert » → collez votre adresse PILOTE → cochez « Conserver une copie »</li>
                        <li>Aucun code demandé — c&apos;est terminé</li>
                      </ol>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <button onClick={verifierCodeTransfert} disabled={mailBusy}
                      className="text-xs font-semibold text-pilote border border-pilote-200 bg-white rounded-lg px-2.5 py-1.5 hover:bg-pilote-50 transition-colors disabled:opacity-50">
                      {mailBusy ? 'Vérification…' : 'Relever le code Gmail'}
                    </button>
                    <span className="text-[10px] text-gray-400">Une fois le transfert actif : plus aucun geste, chaque facture reçue arrive ici et la lecture se fait la nuit.</span>
                  </div>
                </details>
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {/* Changement d'une adresse DÉJÀ vérifiée : dire clairement ce qui
                    se passe — suspension le temps du nouveau code, adresse PILOTE
                    inchangée (les transferts déjà en place restent bons). */}
                {mail.verified && mailEdition && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                    Changement d&apos;adresse : la réception est suspendue dès l&apos;envoi du code, jusqu&apos;à la vérification de la
                    nouvelle adresse. Votre adresse PILOTE (factures-…) ne change pas — les transferts déjà en place restent bons.
                  </p>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  {mailStep === 'idle' ? (
                    <>
                      <Input value={mailAddr} onChange={e => setMailAddr(e.target.value)} placeholder="votre@email.fr"
                        className="h-9 text-sm max-w-[240px]" />
                      <Button onClick={envoyerCodeMail} disabled={mailBusy}
                        className="h-9 bg-pilote hover:bg-pilote-hover text-white text-xs">
                        {mailBusy ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Envoi…</> : 'Recevoir le code'}
                      </Button>
                      {mail.verified && mailEdition ? (
                        <button onClick={() => { setMailEdition(false); setMailMsg(null) }}
                          className="text-[11px] font-semibold text-gray-500 hover:text-gray-700">Annuler</button>
                      ) : (
                        <span className="text-[11px] text-gray-400">Une seule fois : on vérifie que l&apos;adresse est bien la vôtre — mettez celle qui REÇOIT vos factures fournisseurs.</span>
                      )}
                    </>
                  ) : (
                    <>
                      <Input value={mailCode} onChange={e => setMailCode(e.target.value)} placeholder="123456" inputMode="numeric"
                        className="h-9 text-sm max-w-[120px] tabular" />
                      <Button onClick={validerCodeMail} disabled={mailBusy}
                        className="h-9 bg-pilote hover:bg-pilote-hover text-white text-xs">
                        {mailBusy ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Validation…</> : 'Valider'}
                      </Button>
                      <button onClick={() => { setMailStep('idle'); setMailMsg(null) }}
                        className="text-[11px] font-semibold text-gray-500 hover:text-gray-700">Changer d&apos;adresse</button>
                    </>
                  )}
                </div>
              </div>
            )}
            {mailMsg && (
              <p className={`text-[11px] mt-2 font-medium ${mailMsg.ok ? 'text-green-700' : 'text-red-600'}`}>{mailMsg.texte}</p>
            )}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {PROVIDERS_META.filter(p => !integrations.find(i => i.provider === p.id)).map(prov => (
              <div key={prov.id} className="rounded-lg border-2 border-dashed border-gray-200 hover:border-gray-300 bg-gray-50/30 p-4 transition-all">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-8 h-8 rounded-lg ${prov.color} flex items-center justify-center text-white text-[10px] font-extrabold flex-shrink-0`}>{prov.logo}</div>
                  <span className="font-bold text-sm text-gray-900">{prov.name}</span>
                </div>
                <p className="text-[10px] text-gray-400 mb-3 leading-relaxed">{prov.description}</p>
                <button onClick={() => { setConnectProvider(prov); setConnectToken(''); setConnectCompanyId(''); setConnectError(''); setShowConnect(true) }}
                  className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold bg-pilote text-white rounded-xl py-1.5 hover:bg-pilote-hover transition-colors">
                  <Link2 className="w-3 h-3" />Connecter
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 px-6 py-6 space-y-6">

        {/* Factures à vérifier — importées automatiquement, exclues des marges tant que non validées */}
        {pendingCount > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <p className="text-sm text-amber-800"><strong>{pendingCount} facture{pendingCount > 1 ? 's' : ''} à vérifier</strong> — importée{pendingCount > 1 ? 's' : ''} automatiquement, exclue{pendingCount > 1 ? 's' : ''} du calcul des marges tant que non validée{pendingCount > 1 ? 's' : ''}.</p>
            <button onClick={validateAllPending} className="ml-auto text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl px-3 py-1.5 transition-colors flex-shrink-0">Tout valider</button>
          </div>
        )}

        {/* ── Achats de la semaine — triables par catégorie (sous-totaux) ou par date ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold text-gray-900">Achats de la semaine {week}</h2>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-0.5 bg-gray-50 border border-gray-100 rounded-lg p-0.5">
                {([['categorie', 'Par catégorie'], ['date', 'Par date']] as const).map(([key, label]) => (
                  <button key={key} onClick={() => setInvoiceView(key)}
                    className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all ${invoiceView === key ? 'bg-white text-pilote shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <span className="text-xs text-gray-400 tabular">{variableInvoices.length} facture{variableInvoices.length > 1 ? 's' : ''} · {fmtEuro(variableTotalHt)} HT</span>
            </div>
          </div>
          {loading ? (
            <div className="p-6 animate-pulse space-y-3">
              <div className="h-10 bg-gray-100 rounded-lg" />
              <div className="h-10 bg-gray-100 rounded-lg" />
              <div className="h-10 bg-gray-100 rounded-lg" />
            </div>
          ) : variableInvoices.length === 0 ? (
            <div className="py-14 flex flex-col items-center justify-center text-center bg-gradient-to-b from-pilote-50/30 to-white">
              <div className="w-14 h-14 rounded-lg bg-gradient-to-br from-pilote-50 to-pilote-100 ring-1 ring-pilote-200/60 flex items-center justify-center mb-4 shadow-sm">
                <ShoppingCart className="w-6 h-6 text-pilote" />
              </div>
              <p className="text-sm font-bold text-gray-900">Aucun achat sur la semaine {week}</p>
              <p className="text-xs text-gray-400 mt-1 max-w-xs">Lancez un sync pour importer les factures, ou ajoutez-les à la main.</p>
              <button onClick={openAdd} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-pilote hover:bg-pilote-hover rounded-xl px-4 py-2 shadow-card active:scale-95 transition-all">
                <Plus className="w-3.5 h-3.5" />Ajouter une facture
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full tabular min-w-[720px]">
                <thead>
                  <tr className="bg-gray-50 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                    <th className="px-4 py-2.5 text-left">Fournisseur</th>
                    <th className="px-4 py-2.5 text-left">Ventilation</th>
                    <th className="px-4 py-2.5 text-left">Date</th>
                    <th className="px-4 py-2.5 text-right">HT</th>
                    <th className="px-4 py-2.5 text-right">TVA</th>
                    <th className="px-4 py-2.5 text-right">TTC</th>
                    <th className="px-4 py-2.5 text-center w-24"></th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceView === 'date'
                    ? sortedVariable.map(renderInvoiceRow)
                    : invoiceGroups.map(g => (
                        <Fragment key={g.cat.key}>
                          <tr className="border-t border-gray-100 bg-gray-50/80">
                            <td colSpan={3} className="px-4 py-2">
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-500">
                                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: g.cat.dot }} />
                                {g.cat.label}
                                <span className="font-semibold normal-case tracking-normal text-gray-400">· {g.rows.length} facture{g.rows.length > 1 ? 's' : ''}</span>
                              </span>
                            </td>
                            <td className="px-4 py-2 text-right text-xs font-bold text-gray-700 tabular">{fmtEuro(g.rows.reduce((s, i) => s + i.amount_ht, 0))}</td>
                            <td></td>
                            <td className="px-4 py-2 text-right text-xs font-semibold text-gray-500 tabular">{fmtEuro(g.rows.reduce((s, i) => s + i.amount_ttc, 0))}</td>
                            <td></td>
                          </tr>
                          {g.rows.map(renderInvoiceRow)}
                        </Fragment>
                      ))}
                </tbody>
                <tfoot>
                  <tr className="bg-pilote text-white">
                    <td colSpan={3} className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white/60">
                      Total achats variables
                      {pendingHt > 0 && <span className="normal-case tracking-normal font-semibold text-white/50"> · dont {fmtEuro(pendingHt)} à vérifier</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold">{fmtEuro(variableTotalHt)}</td>
                    <td className="px-4 py-2.5"></td>
                    <td className="px-4 py-2.5 text-right font-bold text-orange-300">{fmtEuro(variableTotalTtc)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        <BlocChargesFixesSemaine
          fixedThisWeek={fixedThisWeek} week={week} chargeFamilies={chargeFamilies} televersant={televersant}
          setChargeFam={setChargeFam} moveBackToVariable={moveBackToVariable} televerserDocument={televerserDocument} />

        <BlocChargesRecurrentes
          loading={loading} activeRecurring={activeRecurring} recurringActuals={recurringActuals}
          recurringWeekly={recurringWeekly} chargeHasActualThisWeek={chargeHasActualThisWeek}
          monISO={monISO} sunISO={sunISO} week={week} year={year}
          openNewRecurring={openNewRecurring} openEditRecurring={openEditRecurring} deleteRecurring={deleteRecurring}
          setReconYear={setReconYear} setReconChargeId={setReconChargeId}
          setActualDraft={setActualDraft} setShowReconcile={setShowReconcile} />

        <BlocChargesStructure
          structureLines={structureLines} structureGroupes={structureGroupes} structureEcartees={structureEcartees}
          structureTotal={structureTotal} structureSomme={structureSomme} structureEcart={structureEcart}
          ecarteesPieces={ecarteesPieces} ecarteesOuvertes={ecarteesOuvertes} setEcarteesOuvertes={setEcarteesOuvertes}
          week={week} />
      </div>

      <ModaleChargeRecurrente
        showRecurring={showRecurring} setShowRecurring={setShowRecurring}
        recForm={recForm} setRecForm={setRecForm} recSaving={recSaving} saveRecurring={saveRecurring} />

      <ModaleReconciliation
        showReconcile={showReconcile} setShowReconcile={setShowReconcile}
        reconChargeId={reconChargeId} setReconChargeId={setReconChargeId}
        reconYear={reconYear} setReconYear={setReconYear}
        actualDraft={actualDraft} setActualDraft={setActualDraft}
        recurringCharges={recurringCharges} recurringActuals={recurringActuals} activeRecurring={activeRecurring}
        saveActual={saveActual} deleteActual={deleteActual} />

    </>
  )
}
