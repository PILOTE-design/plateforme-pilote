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
 * Les fenêtres de l'écran Facturation : connexion d'une intégration, ajout
 * d'une facture, chiffre d'affaires, familles de marge, ventilation d'une
 * facture, paramètres. Extraites de `page.tsx` sans réécriture.
 *
 * Tout arrive dans un seul objet, celui du hook `useFacturation` : son type se
 * déduit de ce que le hook renvoie, si bien qu'aucune liste de propriétés n'est
 * maintenue en double. Ce bloc ne décide de rien — il affiche.
 */

import { type Facturation } from './etat'

export function ModalesFacturation({ f }: { f: Facturation }) {
  const {
    week, summary, showAdd, setShowAdd, showCA, setShowCA,
    showSettings, setShowSettings, showSplits, setShowSplits, ventFamilies, invSplits,
    ventInvoice, setVentInvoice, splitSuppliers, setSplitDraft, splitSaving, splitsTab,
    setSplitsTab, splitSearch, setSplitSearch, splitOpen, setSplitOpen, newSplit,
    setNewSplit, setSplitTouched, setCategoryTouched, newInvoice, setNewInvoice, saving,
    showFamilles, setShowFamilles, postesList, familleDraft, setFamilleDraft, famSaving,
    suppliersMemo, memoTouched, setMemoTouched, caForm, setCaForm, settForm,
    setSettForm, tvaDraft, setTvaDraft, showConnect, setShowConnect, connectProvider,
    connectToken, setConnectToken, connectCompanyId, setConnectCompanyId, connecting, connectError,
    mon, sun, monISO, sunISO, load, saveSplits,
    addInvoice, saveCA, saveSettings, connectIntegration, saveFamilles, ttcAmount,
    supplierMatch, matchHasTva, splitEntries, splitsTodo, splitsDone, famillesOrdonnees,
  } = f
  return (
    <>
      {/* Modal : Connecter intégration */}
      {showConnect && connectProvider && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm" onClick={() => setShowConnect(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg ${connectProvider.color} flex items-center justify-center text-white text-xs font-extrabold`}>{connectProvider.logo}</div>
                <div><h2 className="text-base font-bold text-gray-900">Connecter {connectProvider.name}</h2><p className="text-xs text-gray-400">{connectProvider.description}</p></div>
              </div>
              <button onClick={() => setShowConnect(false)} className="p-1.5 rounded-xl hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">{connectProvider.tokenLabel} *</label>
                <Input value={connectToken} onChange={e => setConnectToken(e.target.value)} placeholder={connectProvider.tokenPlaceholder} type="password" autoFocus />
              </div>
              {connectProvider.needsCompanyId && (
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">{connectProvider.companyIdLabel} *</label>
                  <Input value={connectCompanyId} onChange={e => setConnectCompanyId(e.target.value)} placeholder="Identifiant de votre entreprise" />
                </div>
              )}
              <p className="text-[10px] text-gray-400">Votre token est chiffré et stocké de manière sécurisée. <a href={connectProvider.helpUrl} target="_blank" rel="noreferrer" className="text-pilote underline">Comment trouver mon token ?</a></p>
              {connectError && <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />{connectError}</div>}
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setShowConnect(false)}>Annuler</Button>
                <Button className="flex-1 bg-pilote hover:bg-pilote-hover text-white" onClick={connectIntegration} disabled={!connectToken || connecting || (connectProvider.needsCompanyId && !connectCompanyId)}>
                  {connecting ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Test en cours...</> : <><Link2 className="w-4 h-4 mr-1.5" />Connecter</>}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal : Ajouter facture */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm p-4" onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-gray-900">Nouvelle facture</h2>
              <button onClick={() => setShowAdd(false)} className="p-1.5 rounded-xl hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="space-y-4">
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-gray-600 mb-1">Fournisseur *</label>
                <Input list="suppliers-memo" value={newInvoice.supplier_name} onChange={e => {
                  const supplier_name = e.target.value
                  const m = memoTouched ? null : matchSupplier(supplier_name, suppliersMemo)
                  setNewInvoice((p: any) => ({
                    ...p, supplier_name,
                    ...(m ? { category: m.category } : {}),
                    ...(m && m.tva_rate !== null && TVA_RATES.includes(m.tva_rate) ? { tva_rate: String(m.tva_rate) } : {}),
                  }))
                }} placeholder="Bigard, Maison Dupont..." autoFocus />
                <datalist id="suppliers-memo">
                  {suppliersMemo.map(m => <option key={m.name.toLowerCase()} value={m.name} />)}
                </datalist>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">N° facture</label>
                  <Input value={newInvoice.invoice_number} onChange={e => setNewInvoice((p: any) => ({ ...p, invoice_number: e.target.value }))} placeholder="F-2024-001" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Date *</label>
                  <Input type="date" value={newInvoice.invoice_date} onChange={e => setNewInvoice((p: any) => ({ ...p, invoice_date: e.target.value }))} />
                </div>
              </div>
              {newInvoice.invoice_date && (newInvoice.invoice_date < monISO || newInvoice.invoice_date > sunISO) && (
                <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 -mt-1.5">
                  Cette date est hors de la semaine {week} affichée — la facture sera tout de même comptée sur la semaine {week}.
                </p>
              )}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Catégorie</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {CATEGORIES.map(cat => (
                    <button key={cat.key} onClick={() => { setMemoTouched(true); setCategoryTouched(true); setNewInvoice((p: any) => ({ ...p, category: cat.key })) }}
                      className={`py-1.5 px-2 rounded-xl text-xs font-semibold border-2 transition-all ${
                        newInvoice.category === cat.key ? 'border-pilote bg-pilote text-white' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}>{cat.label}
                    </button>
                  ))}
                </div>
                {supplierMatch && (
                  <p className="text-[11px] text-pilote mt-1.5">
                    {matchHasTva ? 'Catégorie et TVA pré-remplies' : 'Catégorie pré-remplie'} d'après vos achats chez {supplierMatch.name} — modifiable.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Montant HT *</label>
                  <Input type="number" step="0.01" value={newInvoice.amount_ht} onChange={e => setNewInvoice((p: any) => ({ ...p, amount_ht: e.target.value }))} placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Taux TVA (%)</label>
                  <select value={newInvoice.tva_rate} onChange={e => { setMemoTouched(true); setNewInvoice((p: any) => ({ ...p, tva_rate: e.target.value })) }} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-pilote">
                    {TVA_RATES.map(r => <option key={r} value={r}>{r === 0 ? '0 % (exonéré)' : `${r} %`}</option>)}
                  </select>
                </div>
              </div>
              {newInvoice.amount_ht && <div className="bg-gray-50 rounded-lg px-3 py-2 flex items-center justify-between"><span className="text-xs text-gray-500">Montant TTC calculé</span><span className="font-bold text-gray-900">{fmtEuro(ttcAmount)}</span></div>}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Notes</label>
                <Input value={newInvoice.notes} onChange={e => setNewInvoice((p: any) => ({ ...p, notes: e.target.value }))} placeholder="Livraison lundi matin..." />
              </div>
              <div className="border-t border-gray-100 pt-3">
                <label className="block text-xs font-semibold text-gray-600 mb-0.5">Répartition par famille (%)</label>
                <p className="text-[11px] text-gray-400 mb-2">Mémorisée pour <span className="font-semibold text-gray-600">{newInvoice.supplier_name || 'cette société'}</span> — ré-appliquée automatiquement à ses prochaines factures.</p>
                {famillesOrdonnees.length === 0 ? (
                  <p className="text-[11px] text-gray-400">Aucune famille de vente pour l&apos;instant — la répartition s&apos;ouvrira dès que vos familles seront créées.</p>
                ) : (
                  <>
                    <div className="max-h-56 overflow-y-auto pr-1">
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                        {famillesOrdonnees.map(f => {
                          const sousFamille = f.parent_id !== null
                          return (
                            <div key={f.id} className={`flex items-center gap-1.5 ${sousFamille ? 'pl-3' : ''}`}>
                              <span className={`flex-1 min-w-0 truncate ${sousFamille ? 'text-[11px] text-gray-500' : 'text-[11px] font-semibold text-gray-700'}`} title={f.name}>
                                {sousFamille ? `› ${f.name}` : f.name}
                              </span>
                              <input type="number" min="0" max="100" value={newSplit[f.id] ?? ''}
                                onChange={e => { setSplitTouched(true); setNewSplit(p => ({ ...p, [f.id]: e.target.value })) }}
                                placeholder="0"
                                className="w-12 flex-shrink-0 border border-gray-200 rounded-lg px-1.5 py-1 text-xs text-right tabular focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                              <span className="text-[10px] text-gray-400 flex-shrink-0">%</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                    {(() => {
                      const t = totalVent(newSplit)
                      if (!t) return null
                      const ok = t >= 99.5 && t <= 100.5
                      return (
                        <p className={`text-[11px] mt-2 ${ok ? 'text-gray-400' : 'text-amber-600'}`}>
                          Total réparti {fmtPct(t)} %{ok ? '' : t < 100 ? ` — il reste ${fmtPct(100 - t)} %` : ` — ${fmtPct(t - 100)} % de trop`}
                        </p>
                      )
                    })()}
                  </>
                )}
              </div>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setShowAdd(false)}>Annuler</Button>
                <Button className="flex-1 bg-pilote hover:bg-pilote-hover text-white" onClick={addInvoice} disabled={!newInvoice.supplier_name || !newInvoice.invoice_date || !newInvoice.amount_ht || saving}>
                  {saving ? 'Enregistrement...' : 'Enregistrer'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal : CA */}
      <ModaleRepartitionRayons
        showSplits={showSplits} setShowSplits={setShowSplits}
        splitSearch={splitSearch} setSplitSearch={setSplitSearch}
        splitsTab={splitsTab} setSplitsTab={setSplitsTab}
        splitOpen={splitOpen} setSplitOpen={setSplitOpen}
        splitEntries={splitEntries} splitsTodo={splitsTodo} splitsDone={splitsDone}
        splitSuppliers={splitSuppliers} famillesOrdonnees={famillesOrdonnees}
        setSplitDraft={setSplitDraft} splitSaving={splitSaving} saveSplits={saveSplits} />

      {/* Modal : Choix des 3 familles de marge (liste = postes du planning) */}
      {showFamilles && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm p-4" onClick={() => setShowFamilles(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1.5">
              <h2 className="text-base font-bold text-gray-900">Mes 3 familles de marge</h2>
              <button onClick={() => setShowFamilles(false)} className="p-1.5 rounded-xl hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <p className="text-xs text-gray-500 mb-4">La liste vient des postes du planning. Les heures pointées sur un poste, le CA et les achats qui lui ressemblent (« boucher » ≈ « boucherie ») alimentent automatiquement sa marge.</p>
            <div className="space-y-3">
              {[0, 1, 2].map(i => (
                <div key={i}>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Famille {i + 1}</label>
                  <select value={familleDraft[i] ?? ''} onChange={e => setFamilleDraft(prev => { const n = [...prev]; n[i] = e.target.value; return n })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200">
                    {postesList.length === 0 && <option value={familleDraft[i] ?? ''}>{familleDraft[i] ?? ''}</option>}
                    {postesList.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                  </select>
                </div>
              ))}
              {new Set(familleDraft).size !== 3 && (
                <p className="text-[11px] text-amber-600">Choisissez trois familles différentes.</p>
              )}
              <p className="text-[11px] text-gray-400">Il manque un poste (ex. « Prestation ») ? Ajoutez-le depuis le <Link href="/dashboard/planning" className="text-pilote hover:underline">planning</Link>, bouton « Postes » — il apparaîtra ici.</p>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setShowFamilles(false)}>Annuler</Button>
                <Button className="flex-1 bg-pilote hover:bg-pilote-hover text-white" onClick={saveFamilles} disabled={famSaving || new Set(familleDraft).size !== 3}>
                  {famSaving ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Enregistrement...</> : <><Save className="w-4 h-4 mr-1.5" />Enregistrer</>}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ventilation propre à UNE facture (référentiel familles/sous-familles) */}
      {ventInvoice && (
        <VentilationFacture
          invoice={{ id: ventInvoice.id, supplier_name: ventInvoice.supplier_name, amount_ht: ventInvoice.amount_ht }}
          families={ventFamilies}
          current={invSplits[ventInvoice.id] ?? []}
          onClose={() => setVentInvoice(null)}
          onSaved={() => { setVentInvoice(null); load() }}
        />
      )}

      {showCA && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm" onClick={() => setShowCA(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div><h2 className="text-base font-bold text-gray-900">CA de la semaine {week}</h2><p className="text-xs text-gray-400 mt-0.5">{fmtDate(mon)} – {fmtDate(sun)}</p></div>
              <button onClick={() => setShowCA(false)} className="p-1.5 rounded-xl hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">CA Total (€)</label>
                <Input type="number" step="0.01" min="0" value={caForm.ca_total} onChange={e => setCaForm(p => ({ ...p, ca_total: e.target.value }))} placeholder="0.00" className="text-lg font-bold" autoFocus />
              </div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider pt-1">Détail par rayon (optionnel)</p>
              {Array.isArray(summary?.ca_detail?.families_detail) && summary!.ca_detail!.families_detail!.length > 0 && (
                <p className="text-[11px] text-pilote bg-pilote-50 rounded-lg px-2.5 py-1.5">
                  Le détail par rayon est lu automatiquement depuis votre rapport hebdo — cette saisie ne sert que de secours.
                </p>
              )}
              {[{ key: 'ca_boucherie', label: 'Boucherie' }, { key: 'ca_charcuterie', label: 'Charcuterie' }, { key: 'ca_traiteur', label: 'Traiteur' }, { key: 'ca_divers', label: 'Divers' }].map(({ key, label }) => (
                <div key={key} className="flex items-center gap-2">
                  <label className="text-xs text-gray-500 w-28 flex-shrink-0">{label}</label>
                  <Input type="number" step="0.01" min="0" value={(caForm as any)[key]} onChange={e => setCaForm(p => ({ ...p, [key]: e.target.value }))} placeholder="0.00" />
                </div>
              ))}
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowCA(false)}>Annuler</Button>
                <Button className="flex-1 bg-pilote hover:bg-pilote-hover text-white" onClick={saveCA} disabled={saving}>
                  <Check className="w-4 h-4 mr-1.5" />{saving ? 'Enregistrement...' : 'Enregistrer'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal : Paramètres */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm" onClick={() => setShowSettings(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-gray-900">Paramètres entreprise</h2>
              <button onClick={() => setShowSettings(false)} className="p-1.5 rounded-xl hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Nom de l&apos;entreprise</label>
                <Input value={settForm.company_name} onChange={e => setSettForm(p => ({ ...p, company_name: e.target.value }))} placeholder="Boucherie Dupont" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">SIRET</label>
                <Input value={settForm.siret} onChange={e => setSettForm(p => ({ ...p, siret: e.target.value }))} placeholder="123 456 789 00012" />
              </div>
              <div>
                <label htmlFor="tva-rate" className="block text-xs font-semibold text-gray-700 mb-1">Taux de TVA sur le CA</label>
                <Input id="tva-rate" inputMode="decimal" value={tvaDraft} onChange={e => setTvaDraft(e.target.value)} placeholder="5,5" />
                <p className="text-[11px] text-gray-500 mt-1 leading-snug">
                  Sert à ramener votre CA de caisse en HT avant le calcul des marges — vos achats et vos salaires sont HT.
                  5,5 % pour la vente à emporter, 10 % si vous servez sur place.
                </p>
              </div>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setShowSettings(false)}>Annuler</Button>
                <Button className="flex-1 bg-pilote hover:bg-pilote-hover text-white" onClick={saveSettings} disabled={saving}>
                  <Save className="w-4 h-4 mr-1.5" />{saving ? 'Enregistrement...' : 'Sauvegarder'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
