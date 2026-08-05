/**
 * LES FENÊTRES DE LA PAGE PLANNING.
 *
 * Quatre blocs extraits de `page.tsx` sans réécriture — le JSX est celui
 * d'avant, ligne pour ligne : le détail d'une journée, le récapitulatif
 * mensuel, l'ajout d'un salarié, la gestion des postes personnalisés.
 *
 * La page avait atteint 113 809 octets, taille au-delà de laquelle l'outil de
 * publication ne peut plus réémettre le fichier — donc au-delà de laquelle la
 * page n'est plus modifiable du tout. Découper n'était pas du confort.
 */

'use client'

import { X, Plus, Trash2, AlertTriangle, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { bandeauFigee, type VerrouSemaine } from '@/lib/planning-lock'
import {
  JOURS_SHORT, JOURS_DB, CATEGORIES, CUSTOM_POSTE_COLORS, TYPE_CONFIG, CONTRACT_TYPES, EMP_PALETTES,
  calcSlotDuration, calcHoursFromSd, combineTime, parseTimePart, fmtH, initials, contractLabel,
  type DayType, type JourDB, type ScheduleDetail, type ScheduleDetails, type PosteDef,
  type ContractKey, type Employee, type PlanningEntry, type MonthlyStat,
} from './donnees'

// ─── Le détail d'une journée ────────────────────────────────────────────────

export type ModaleDetailProps = {
  detailModal: { empId: string; jour: JourDB; idx: number } | null
  setDetailModal: (v: { empId: string; jour: JourDB; idx: number } | null) => void
  employees: Employee[]
  allPostes: PosteDef[]
  weekDates: Date[]
  weekHolidays: (string | null)[]
  figee: boolean
  verrouCourant: VerrouSemaine | null
  getEntryState: (empId: string) => PlanningEntry
  changeType: (empId: string, jour: JourDB, newType: DayType) => void
  updateHours: (empId: string, jour: JourDB, value: string) => void
  handleBlur: (empId: string) => void
  handleScheduleDetailChange: (empId: string, jour: JourDB, field: keyof ScheduleDetail, value: string) => void
  handleScheduleDetailBlur: (empId: string) => void
  setSlotCategory: (empId: string, jour: JourDB, slot: 'categorie_matin' | 'categorie_apmidi', value: string) => void
  toggleSlotPoste: (empId: string, jour: JourDB, slot: 'matin' | 'apmidi', key: string) => void
}

export function ModaleDetail(props: ModaleDetailProps) {
  const {
    detailModal, setDetailModal, employees, allPostes, weekDates, weekHolidays,
    figee, verrouCourant, getEntryState, changeType, updateHours, handleBlur,
    handleScheduleDetailChange, handleScheduleDetailBlur, setSlotCategory, toggleSlotPoste,
  } = props
  return (
    <>
      {/* ── Detail Modal ── */}
      {detailModal && (() => {
        const mEmpIdx = employees.findIndex(e => e.id === detailModal.empId)
        if (mEmpIdx < 0) return null
        const mEmp   = employees[mEmpIdx]
        const mPal   = EMP_PALETTES[mEmpIdx % EMP_PALETTES.length]
        const mEntry = getEntryState(detailModal.empId)
        const mJour  = detailModal.jour
        const mIdx   = detailModal.idx
        const mType  = (mEntry[`${mJour}_type` as keyof PlanningEntry] as DayType) || (mIdx >= 5 ? 'repos' : 'travail')
        const mHours = (mEntry[mJour] as number) || 0
        const mSd: ScheduleDetail = ((mEntry.schedule_details as ScheduleDetails | undefined) || {})[mJour] || {}
        const mDate  = weekDates[mIdx]
        const mFName = weekHolidays[mIdx]
        const mComputed = calcHoursFromSd(mSd)
        const mMaxDay = mEmp.is_gerant ? 24 : mEmp.is_minor ? 8 : 10
        const mEffH   = mComputed !== null ? mComputed : mHours

        return (
          <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50 backdrop-blur-[2px]" onClick={() => setDetailModal(null)}>
            <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>

              {/* Barre couleur fine */}
              <div className="h-[3px]" style={{ background: mPal.hex }} />

              {/* Header minimal */}
              <div className="px-5 pt-4 pb-3.5 flex items-center justify-between border-b border-gray-100">
                <div>
                  <p className="font-semibold text-gray-900 text-sm leading-tight">{mEmp.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {JOURS_SHORT[mIdx]} {mDate.getUTCDate()} {mDate.toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' })}
                    {mFName && <span className="text-amber-500"> · {mFName}</span>}
                  </p>
                </div>
                <button onClick={() => setDetailModal(null)} className="p-1.5 rounded-lg text-gray-300 hover:text-gray-500 hover:bg-gray-50 transition-colors ml-4">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="px-5 py-4 space-y-4">

                {/* Semaine figée : la fiche du jour se lit, elle ne se saisit plus */}
                {figee && verrouCourant && (
                  <p className="flex items-center gap-1.5 text-[11px] font-medium text-pilote-800 bg-pilote-50 border border-pilote-100 rounded-lg px-2.5 py-1.5">
                    <Lock className="w-3 h-3 flex-shrink-0 text-pilote" />{bandeauFigee(verrouCourant)}
                  </p>
                )}

                {/* Segmented control type */}
                <div className="flex bg-gray-100 rounded-xl p-1 gap-0.5">
                  {(['travail', 'conges', 'maladie', 'repos'] as DayType[]).map(t => (
                    <button key={t}
                      onClick={() => changeType(detailModal.empId, mJour, t)}
                      disabled={figee}
                      className={`flex-1 py-1.5 text-[11px] font-semibold rounded-[9px] transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                        mType === t ? 'bg-white shadow-sm text-gray-900' : 'text-gray-400 hover:text-gray-600'
                      }`}
                    >
                      {t === 'travail' ? 'Travail' : t === 'conges' ? 'Congé' : t === 'maladie' ? 'Maladie' : 'Repos'}
                    </button>
                  ))}
                </div>

                {mType === 'travail' && (
                  <div className="space-y-3.5">

                    {/* Jour férié travaillé : autorisé, avec rappel de la majoration CCN */}
                    {mFName && (
                      <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
                        ✦ {mFName} — jour férié travaillé : heures majorées +100 % (CCN 992), prises en compte automatiquement dans le coût
                      </p>
                    )}

                    {/* Poste(s) matin — PLUSIEURS possibles : les heures du créneau se
                        partagent à parts égales ; le premier coché reste le poste
                        principal (impression et envoi inchangés) */}
                    <div className="flex items-start gap-3">
                      <span className="text-xs text-gray-400 w-20 shrink-0 pt-1">Poste matin</span>
                      <div className="flex flex-wrap gap-1.5">
                        {allPostes.map(cat => {
                          const listM = Array.isArray(mSd.postes_matin) && mSd.postes_matin.length > 0
                            ? mSd.postes_matin
                            : (mSd.categorie_matin || mSd.categorie ? [(mSd.categorie_matin || mSd.categorie) as string] : [])
                          const isSel = listM.includes(cat.key)
                          const isPrimary = listM[0] === cat.key && listM.length > 1
                          return (
                            <button key={cat.key}
                              onClick={() => toggleSlotPoste(detailModal.empId, mJour, 'matin', cat.key)}
                              disabled={figee}
                              title={isPrimary ? 'Poste principal (affiché à l’impression et dans l’envoi)' : 'Cliquer pour ajouter/retirer — plusieurs postes possibles sur le créneau'}
                              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                                isSel ? cat.color : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                              }${isPrimary ? ' ring-2 ring-offset-1 ring-gray-300' : ''}`}
                            >
                              {cat.short}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* Poste(s) après-midi — même logique multi-postes */}
                    <div className="flex items-start gap-3">
                      <span className="text-xs text-gray-400 w-20 shrink-0 pt-1">Poste a.-midi</span>
                      <div className="flex flex-wrap gap-1.5">
                        {allPostes.map(cat => {
                          const listA = Array.isArray(mSd.postes_apmidi) && mSd.postes_apmidi.length > 0
                            ? mSd.postes_apmidi
                            : (mSd.categorie_apmidi || mSd.categorie ? [(mSd.categorie_apmidi || mSd.categorie) as string] : [])
                          const isSel = listA.includes(cat.key)
                          const isPrimary = listA[0] === cat.key && listA.length > 1
                          return (
                            <button key={cat.key}
                              onClick={() => toggleSlotPoste(detailModal.empId, mJour, 'apmidi', cat.key)}
                              disabled={figee}
                              title={isPrimary ? 'Poste principal (affiché à l’impression et dans l’envoi)' : 'Cliquer pour ajouter/retirer — plusieurs postes possibles sur le créneau'}
                              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                                isSel ? cat.color : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                              }${isPrimary ? ' ring-2 ring-offset-1 ring-gray-300' : ''}`}
                            >
                              {cat.short}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    {((mSd.postes_matin?.length ?? 0) > 1 || (mSd.postes_apmidi?.length ?? 0) > 1) && (
                      <p className="text-[11px] text-gray-400 -mt-1">
                        Plusieurs postes sur un créneau : les heures se partagent à parts égales entre eux (paie et marges).
                        Le poste entouré reste celui affiché à l&apos;impression et dans l&apos;envoi aux employés.
                      </p>
                    )}

                    {/* Horaires */}
                    <div className="flex items-start gap-3">
                      <span className="text-xs text-gray-400 w-20 shrink-0 pt-1.5">Horaires</span>
                      <div className="space-y-2">
                        {([
                          { label: 'Matin',      startF: 'matin_debut'  as const, endF: 'matin_fin'  as const },
                          { label: 'Après-midi', startF: 'apmidi_debut' as const, endF: 'apmidi_fin' as const },
                        ] as { label: string; startF: 'matin_debut' | 'apmidi_debut'; endF: 'matin_fin' | 'apmidi_fin' }[]).map(({ label, startF, endF }) => (
                          <div key={label} className="flex items-center gap-1.5">
                            <span className="text-[11px] text-gray-500 font-medium w-16 shrink-0">{label}</span>
                            {/* Début */}
                            <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden focus-within:border-gray-500 transition-colors">
                              <input type="text" inputMode="numeric" placeholder="--" maxLength={2} disabled={figee}
                                value={parseTimePart(mSd[startF] || '', 'h')}
                                onChange={e => {
                                  const m = parseTimePart(mSd[startF] || '', 'm')
                                  handleScheduleDetailChange(detailModal.empId, mJour, startF, combineTime(e.target.value, m))
                                }}
                                onBlur={() => handleScheduleDetailBlur(detailModal.empId)}
                                className="w-6 text-right text-xs text-gray-900 font-semibold py-1.5 pl-1 focus:outline-none bg-transparent disabled:text-gray-400"
                              />
                              <span className="text-[11px] font-bold text-gray-400 select-none px-px">h</span>
                              <input type="text" inputMode="numeric" placeholder="--" maxLength={2} disabled={figee}
                                value={parseTimePart(mSd[startF] || '', 'm')}
                                onChange={e => {
                                  const h = parseTimePart(mSd[startF] || '', 'h')
                                  handleScheduleDetailChange(detailModal.empId, mJour, startF, combineTime(h, e.target.value))
                                }}
                                onBlur={() => handleScheduleDetailBlur(detailModal.empId)}
                                className="w-7 text-left text-xs text-gray-900 font-semibold py-1.5 pr-1 focus:outline-none bg-transparent disabled:text-gray-400"
                              />
                            </div>
                            <span className="text-gray-400 text-xs">→</span>
                            {/* Fin */}
                            <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden focus-within:border-gray-500 transition-colors">
                              <input type="text" inputMode="numeric" placeholder="--" maxLength={2} disabled={figee}
                                value={parseTimePart(mSd[endF] || '', 'h')}
                                onChange={e => {
                                  const m = parseTimePart(mSd[endF] || '', 'm')
                                  handleScheduleDetailChange(detailModal.empId, mJour, endF, combineTime(e.target.value, m))
                                }}
                                onBlur={() => handleScheduleDetailBlur(detailModal.empId)}
                                className="w-6 text-right text-xs text-gray-900 font-semibold py-1.5 pl-1 focus:outline-none bg-transparent disabled:text-gray-400"
                              />
                              <span className="text-[11px] font-bold text-gray-400 select-none px-px">h</span>
                              <input type="text" inputMode="numeric" placeholder="--" maxLength={2} disabled={figee}
                                value={parseTimePart(mSd[endF] || '', 'm')}
                                onChange={e => {
                                  const h = parseTimePart(mSd[endF] || '', 'h')
                                  handleScheduleDetailChange(detailModal.empId, mJour, endF, combineTime(h, e.target.value))
                                }}
                                onBlur={() => handleScheduleDetailBlur(detailModal.empId)}
                                className="w-7 text-left text-xs text-gray-900 font-semibold py-1.5 pr-1 focus:outline-none bg-transparent disabled:text-gray-400"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Heures du jour — saisie rapide si pas d'horaires détaillés */}
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400 w-20 shrink-0">Heures</span>
                      {mComputed !== null ? (
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-sm font-bold text-gray-900">{fmtH(mComputed)}</span>
                          <span className="text-[10px] text-gray-400">calculées depuis les horaires</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number" min="0" max="24" step="0.5"
                            disabled={figee}
                            value={mHours || ''}
                            onChange={e => updateHours(detailModal.empId, mJour, e.target.value)}
                            onBlur={() => handleBlur(detailModal.empId)}
                            placeholder="0"
                            className="w-16 border border-gray-300 rounded-lg px-2 py-1.5 text-sm font-semibold text-gray-900 text-center focus:outline-none focus:border-gray-500 transition-colors disabled:bg-gray-50 disabled:text-gray-400"
                          />
                          <span className="text-xs text-gray-400">h</span>
                        </div>
                      )}
                    </div>

                    {/* Temps de découpe — visible uniquement si un poste boucherie est sélectionné ce jour.
                        Imputé automatiquement à la main d'œuvre de la valorisation carcasse. */}
                    {(mSd.categorie_matin === 'boucherie' || mSd.categorie_apmidi === 'boucherie' || mSd.categorie === 'boucherie') && (
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-400 w-20 shrink-0">Découpe</span>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number" min="0" max="600" step="1"
                            disabled={figee}
                            value={mSd.decoupe ?? ''}
                            onChange={e => handleScheduleDetailChange(detailModal.empId, mJour, 'decoupe', e.target.value)}
                            onBlur={() => handleScheduleDetailBlur(detailModal.empId)}
                            placeholder="ex : 120"
                            className="w-16 border border-gray-300 rounded-lg px-2 py-1.5 text-sm font-semibold text-gray-900 text-center focus:outline-none focus:border-gray-500 transition-colors disabled:bg-gray-50 disabled:text-gray-400"
                          />
                          <span className="text-xs text-gray-400">min de découpe</span>
                        </div>
                      </div>
                    )}

                    {/* Alertes du jour */}
                    {mEffH > mMaxDay && (
                      <p className="text-[11px] text-red-600 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                        Dépasse la durée max légale de {mMaxDay}h/jour{mEmp.is_minor ? ' (mineur)' : ''}
                      </p>
                    )}
                    {mEffH > 6 && mEffH <= mMaxDay && (
                      <p className="text-[10px] text-amber-600">Pause de 20 min minimum obligatoire au-delà de 6h de travail</p>
                    )}

                  </div>
                )}

              </div>
            </div>
          </div>
        )
      })()}

    </>
  )
}

// ─── Le récapitulatif mensuel ───────────────────────────────────────────────

export type ModaleMensuelProps = {
  showMonthly: boolean
  setShowMonthly: (v: boolean) => void
  loadingMonthly: boolean
  monthlyData: MonthlyStat[] | null
  year: number
  weekDates: Date[]
}

export function ModaleMensuel(props: ModaleMensuelProps) {
  const { showMonthly, setShowMonthly, loadingMonthly, monthlyData, year, weekDates } = props
  return (
    <>
      {/* ── Récap mensuel modal ── */}
      {showMonthly && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm" onClick={() => setShowMonthly(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-3xl shadow-2xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-base font-bold text-gray-900">Récapitulatif mensuel</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {weekDates[0].toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
                </p>
              </div>
              <button onClick={() => setShowMonthly(false)} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            {loadingMonthly ? (
              <div className="animate-pulse space-y-3 py-4">
                <div className="h-10 bg-gray-100 rounded-lg" />
                <div className="h-10 bg-gray-100 rounded-lg" />
                <div className="h-10 bg-gray-100 rounded-lg" />
              </div>
            ) : monthlyData ? (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-gray-200">
                    <th className="text-left py-2.5 font-semibold text-gray-500 text-xs uppercase">Employé</th>
                    <th className="text-center py-2.5 font-semibold text-gray-500 text-xs uppercase">Heures</th>
                    <th className="text-center py-2.5 font-semibold text-orange-500 text-xs uppercase" title="Heures supplémentaires — heures travaillées au-delà du contrat, par semaine (CP exclus)">HS</th>
                    <th className="text-center py-2.5 font-semibold text-gray-500 text-xs uppercase">Jours trav.</th>
                    <th className="text-center py-2.5 font-semibold text-sky-600 text-xs uppercase">CP</th>
                    <th className="text-center py-2.5 font-semibold text-red-500 text-xs uppercase">Arrêt</th>
                    <th className="text-center py-2.5 font-semibold text-green-700 text-xs uppercase">Brut</th>
                    <th className="text-center py-2.5 font-semibold text-gray-700 text-xs uppercase" title="Brut + charges patronales">Chargé</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyData.map(({ emp, hours, cost, charged, ot, worked, cp, sick }, i) => {
                    const pal  = EMP_PALETTES[i % EMP_PALETTES.length]
                    return (
                      <tr key={emp.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="py-3">
                          <div className="flex items-center gap-2">
                            <div className={`w-6 h-6 rounded-full ${pal.bg} flex items-center justify-center flex-shrink-0`}>
                              <span className={`text-[9px] font-bold ${pal.text}`}>{initials(emp.name)}</span>
                            </div>
                            <div>
                              <div className="font-semibold text-gray-900">{emp.name}</div>
                              <div className="text-[10px] text-gray-400">{contractLabel(emp.contract_type)}</div>
                            </div>
                          </div>
                        </td>
                        <td className="text-center py-3">
                          <span className="font-bold text-gray-800">{fmtH(hours)}</span>
                        </td>
                        <td className="text-center py-3">
                          {ot > 0 ? <span className="text-orange-600 font-bold">{fmtH(ot)}</span> : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="text-center py-3 text-gray-600">{worked > 0 ? `${worked}j` : '—'}</td>
                        <td className="text-center py-3">
                          {cp > 0 ? <span className="text-sky-700 font-medium">{cp}j</span> : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="text-center py-3">
                          {sick > 0 ? <span className="text-red-600 font-medium">{sick}j</span> : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="text-center py-3 font-bold text-green-700">{cost.toFixed(0)} €</td>
                        <td className="text-center py-3 font-bold text-gray-800">{charged.toFixed(0)} €</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-pilote">
                    <td className="py-2.5 px-2 text-xs font-bold uppercase text-white/60">Total mois</td>
                    <td className="text-center py-2.5 font-bold text-white">{fmtH(monthlyData.reduce((s, r) => s + r.hours, 0))}</td>
                    <td className="text-center py-2.5 font-bold text-orange-300">{fmtH(monthlyData.reduce((s, r) => s + r.ot, 0))}</td>
                    <td className="text-center py-2.5 text-white/60">{monthlyData.reduce((s, r) => s + r.worked, 0)}j</td>
                    <td className="text-center py-2.5 text-sky-300">{monthlyData.reduce((s, r) => s + r.cp, 0)}j</td>
                    <td className="text-center py-2.5 text-red-300">{monthlyData.reduce((s, r) => s + r.sick, 0)}j</td>
                    <td className="text-center py-2.5 font-bold text-green-300">{monthlyData.reduce((s, r) => s + r.cost, 0).toFixed(0)} €</td>
                    <td className="text-center py-2.5 font-bold text-orange-300">{monthlyData.reduce((s, r) => s + r.charged, 0).toFixed(0)} €</td>
                  </tr>
                </tfoot>
              </table>
            ) : null}
          </div>
        </div>
      )}

    </>
  )
}

// ─── L'ajout d'un salarié ───────────────────────────────────────────────────

export type ModaleAjoutProps = {
  showAdd: boolean
  setShowAdd: (v: boolean) => void
  newName: string
  setNewName: (v: string) => void
  newRate: string
  setNewRate: (v: string) => void
  newContractKey: ContractKey
  setNewContractKey: (v: ContractKey) => void
  adding: boolean
  addEmployee: () => void
}

export function ModaleAjout(props: ModaleAjoutProps) {
  const {
    showAdd, setShowAdd, newName, setNewName, newRate, setNewRate,
    newContractKey, setNewContractKey, adding, addEmployee,
  } = props
  return (
    <>
      {/* ── Ajout employé modal ── */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm" onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold text-gray-900 mb-1">Nouvel employé</h2>
            <p className="text-sm text-gray-500 mb-5">Renseignez les informations de l'employé.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Prénom et nom</label>
                <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Marie Dupont" autoFocus onKeyDown={e => e.key === 'Enter' && addEmployee()} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Taux horaire brut (€/h)</label>
                <Input type="number" step="0.01" min="0" value={newRate} onChange={e => setNewRate(e.target.value)} placeholder="12.50" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Type de contrat</label>
                <div className="grid grid-cols-2 gap-2">
                  {CONTRACT_TYPES.map(ct => (
                    <button key={ct.key} onClick={() => setNewContractKey(ct.key)}
                      className={`py-2.5 px-3 rounded-lg border-2 text-left transition-all ${
                        newContractKey === ct.key ? 'border-pilote bg-pilote text-white' : 'border-gray-200 text-gray-700 hover:border-gray-300 bg-white'
                      }`}
                    >
                      <div className="text-sm font-bold">{ct.short}</div>
                      <div className={`text-[10px] mt-0.5 ${newContractKey === ct.key ? 'text-white/70' : 'text-gray-400'}`}>{ct.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setShowAdd(false)}>Annuler</Button>
                <Button className="flex-1 bg-pilote hover:bg-pilote-hover text-white" onClick={addEmployee} disabled={!newName.trim() || !newRate || adding}>
                  {adding ? 'Ajout...' : 'Ajouter'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

    </>
  )
}

// ─── Les postes personnalisés ───────────────────────────────────────────────

export type ModalePostesProps = {
  showPostes: boolean
  setShowPostes: (v: boolean) => void
  customPostes: { key: string; label: string }[]
  newPosteLabel: string
  setNewPosteLabel: (v: string) => void
  savingPostes: boolean
  addCustomPoste: () => void
  removeCustomPoste: (key: string) => void
}

export function ModalePostes(props: ModalePostesProps) {
  const {
    showPostes, setShowPostes, customPostes, newPosteLabel, setNewPosteLabel,
    savingPostes, addCustomPoste, removeCustomPoste,
  } = props
  return (
    <>
      {/* ── Modal gestion des postes personnalisés ── */}
      {showPostes && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm" onClick={() => setShowPostes(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-1">
              <h2 className="text-base font-bold text-gray-900">Mes postes de travail</h2>
              <button onClick={() => setShowPostes(false)} className="p-1 rounded hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Ajoutez vos propres postes (ex. « Prestation »). Ils sont proposés sur chaque créneau du
              planning et peuvent servir de famille de marge en facturation — l'écriture proche suffit
              (« boucher » est reconnu comme « Boucherie »).
            </p>

            <div className="mb-4">
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Postes intégrés</span>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {CATEGORIES.map(c => (
                  <span key={c.key} className={`text-[11px] px-2 py-1 rounded-lg font-semibold ${c.color}`}>{c.short}</span>
                ))}
              </div>
            </div>

            <div className="mb-4">
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Mes postes ({customPostes.length}/12)</span>
              {customPostes.length === 0 ? (
                <p className="text-xs text-gray-400 mt-1.5">Aucun poste personnalisé pour l'instant.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {customPostes.map((p, i) => (
                    <span key={p.key} className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg font-semibold ${CUSTOM_POSTE_COLORS[i % CUSTOM_POSTE_COLORS.length]}`}>
                      {p.label}
                      <button onClick={() => removeCustomPoste(p.key)} disabled={savingPostes} className="opacity-60 hover:opacity-100" title="Retirer ce poste">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Input value={newPosteLabel} onChange={e => setNewPosteLabel(e.target.value)} placeholder="Ex. Prestation, Fromage, Marché..."
                maxLength={30} autoFocus onKeyDown={e => e.key === 'Enter' && addCustomPoste()} />
              <Button onClick={addCustomPoste} disabled={newPosteLabel.trim().length < 2 || savingPostes || customPostes.length >= 12}
                className="bg-pilote hover:bg-pilote-hover text-white shrink-0">
                {savingPostes ? '...' : <><Plus className="w-3.5 h-3.5 mr-1" />Ajouter</>}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
