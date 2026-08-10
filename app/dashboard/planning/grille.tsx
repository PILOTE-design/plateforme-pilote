/**
 * LA GRILLE DE LA SEMAINE — les deux lectures : par employé, par poste.
 *
 * Extrait de `page.tsx` sans réécriture : le JSX est celui d'avant, ligne pour
 * ligne. La page passait 113 809 octets, taille au-delà de laquelle l'outil de
 * publication ne peut plus réémettre le fichier — donc au-delà de laquelle la
 * page n'est plus modifiable du tout.
 *
 * Tout ce dont ce bloc a besoin arrive en propriétés. Rien n'est recalculé ici :
 * `rowStats` et les totaux sont ceux de la page, pour que l'en-tête, le pied de
 * grille et la feuille d'émargement affichent le même chiffre.
 */

'use client'

import Link from 'next/link'
import { Plus, Trash2, Clipboard, AlertTriangle, CalendarDays, Copy, FileSpreadsheet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { EmployeeProfile } from '@/components/EmployeeProfileModal'
import VuePostes from './vue-postes'
import { postesDuCreneau, totalHeures, type LignePoste } from '@/lib/planning-postes'
import {
  JOURS_SHORT, JOURS_DB, CATEGORIES, TYPE_CONFIG, CONTRACT_TYPES, EMP_PALETTES,
  contractLabel, calcTotalH, calcWorkedH, initials, fmtH, cddEndInfo, calcHoursFromSd,
  type DayType, type JourDB, type ScheduleDetail, type ScheduleDetails, type PosteDef,
  type ContractKey, type Employee, type PlanningEntry, type StatLigne,
} from './donnees'

export type GrilleProps = {
  vue: 'employes' | 'postes'
  setVue: (v: 'employes' | 'postes') => void
  employees: Employee[]
  loadingEmployees: boolean
  pageError: string | null
  figee: boolean
  weekDates: Date[]
  weekHolidays: (string | null)[]
  todayISO: string
  allPostes: PosteDef[]
  lignesPostes: LignePoste[]
  libellesPostes: Record<string, string>
  couleursPostes: Record<string, string>
  cpUsed: Record<string, number>
  rowStats: StatLigne[]
  grandH: number
  grandCost: number
  grandCharged: number
  getEntryState: (empId: string) => PlanningEntry
  updateContract: (empId: string, contractKey: ContractKey) => void
  deleteEmployee: (id: string) => void
  pasteDay: (toEmpId: string, toJour: JourDB) => void
  contractPopover: string | null
  setContractPopover: (v: string | null) => void
  copiedCell: { empId: string; jour: JourDB } | null
  setCopiedCell: (v: { empId: string; jour: JourDB } | null) => void
  setDetailModal: (v: { empId: string; jour: JourDB; idx: number } | null) => void
  setProfileEmp: (v: EmployeeProfile | null) => void
  setShowAdd: (v: boolean) => void
}

export function GrilleSemaine(props: GrilleProps) {
  const {
    vue, setVue, employees, loadingEmployees, pageError, figee,
    weekDates, weekHolidays, todayISO, allPostes, lignesPostes,
    libellesPostes, couleursPostes, cpUsed, rowStats, grandH, grandCost, grandCharged,
    getEntryState, updateContract, deleteEmployee, pasteDay,
    contractPopover, setContractPopover, copiedCell, setCopiedCell,
    setDetailModal, setProfileEmp, setShowAdd,
  } = props

  return (
    <>
      {/* ── Deux lectures de la même semaine, et sa mise au propre ──
          Les deux premiers boutons changent la LECTURE de la semaine affichée ;
          le troisième mène à un autre écran. D'où le trait qui les sépare : ce
          n'est pas la même nature de geste, et un onglet qui vous déplace sans
          le dire est un onglet qui surprend. */}
      <div className="mb-3 inline-flex items-center gap-1 bg-gray-100 rounded-xl p-1">
        {([['employes', 'Employés'], ['postes', 'Postes']] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setVue(k)}
            title={k === 'employes'
              ? 'Qui travaille, ses heures et ce qu’il coûte'
              : 'Quels rayons sont couverts, par qui, et combien d’heures'}
            className={`text-xs font-semibold rounded-lg px-3 py-1.5 transition-colors ${vue === k ? 'bg-white text-pilote shadow-card' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
        <span className="w-px h-4 bg-gray-300 mx-1" aria-hidden />
        <Link href="/dashboard/planning/paie"
          title="Les heures du mois, prêtes à transmettre au comptable"
          className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 text-gray-500 hover:text-gray-700 transition-colors">
          <FileSpreadsheet className="w-3.5 h-3.5" />
          Préparation des payes
        </Link>
      </div>

      {vue === 'postes' ? (
        <VuePostes
          lignes={lignesPostes}
          libelles={libellesPostes}
          couleurs={couleursPostes}
          joursDates={weekDates.map(d => ({
            jour: d.getUTCDate(),
            mois: d.toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' }),
          }))}
          jourActifIdx={weekDates.findIndex(d => d.toISOString().slice(0, 10) === todayISO)}
          totalSemaine={totalHeures(lignesPostes)}
        />
      ) : (
        /* La grille par EMPLOYÉ — la lecture historique, inchangée. */
        <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr className="bg-white">
              <th className="w-44 px-3 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wider sticky left-0 bg-white z-10 border-b border-r border-gray-200">Employé</th>
              {weekDates.map((date, i) => {
                const isToday = date.toISOString().slice(0, 10) === todayISO
                const isWE    = i >= 5
                const fName   = weekHolidays[i]
                return (
                  <th key={i} className={`px-1 py-2 text-center border-b border-r border-gray-200 ${
                    isToday ? 'bg-pilote' : fName ? 'bg-amber-50' : isWE ? 'bg-gray-50' : 'bg-white'
                  }`}>
                    <div className={`text-xs font-bold uppercase tracking-wide ${
                      isToday ? 'text-white' : fName ? 'text-amber-700' : isWE ? 'text-gray-400' : 'text-gray-500'
                    }`}>{JOURS_SHORT[i]}</div>
                    <div className={`text-lg font-bold ${
                      isToday ? 'text-white' : fName ? 'text-amber-800' : isWE ? 'text-gray-300' : 'text-gray-800'
                    }`}>{date.getUTCDate()}</div>
                    <div className={`text-[10px] ${isToday ? 'text-white/70' : 'text-gray-400'}`}>
                      {date.toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' })}
                    </div>
                    {fName && (
                      <div className="text-[8px] font-semibold text-amber-700 bg-amber-100 px-1 py-0.5 rounded mt-0.5 leading-tight truncate" title={fName}>
                        ✦ {fName}
                      </div>
                    )}
                  </th>
                )
              })}
              <th className="px-2 py-3 text-center text-[11px] font-semibold text-gray-400 uppercase tracking-wider border-b border-r border-gray-200 w-16">Total</th>
              <th className="px-2 py-3 text-center text-[11px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-200 w-20">Coût</th>
            </tr>
          </thead>
          <tbody>
            {loadingEmployees ? (
              <tr>
                <td colSpan={10} className="p-6">
                  <div className="animate-pulse space-y-3">
                    <div className="h-14 bg-gray-100 rounded-lg" />
                    <div className="h-14 bg-gray-100 rounded-lg" />
                    <div className="h-14 bg-gray-100 rounded-lg" />
                  </div>
                </td>
              </tr>
            ) : employees.length === 0 && !pageError ? (
              <tr>
                <td colSpan={10} className="py-16 text-center">
                  <CalendarDays className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                  <p className="text-sm font-medium text-gray-500 mb-1">Aucun employé pour l'instant</p>
                  <p className="text-xs text-gray-400 mb-4">Ajoutez votre équipe pour construire le planning de la semaine.</p>
                  <Button onClick={() => setShowAdd(true)} variant="outline" className="h-8 text-sm px-4">
                    <Plus className="w-3.5 h-3.5 mr-1.5" />Ajouter un employé
                  </Button>
                </td>
              </tr>
            ) : (
              employees.map((emp, empIdx) => {
                const pal    = EMP_PALETTES[empIdx % EMP_PALETTES.length]
                const entry  = getEntryState(emp.id)
                const ch     = emp.contract_hours || 35
                const stat   = rowStats.find(r => r.empId === emp.id) || { totalH: 0, workedH: 0, cost: 0, charged: 0, dimancheH: 0, ferieH: 0, alerts: [] as string[] }
                const { totalH, workedH, cost, charged, dimancheH, ferieH, alerts } = stat
                // Le GÉRANT n'a pas d'heures supplémentaires : non salarié, tout
                // est au taux normal (lib/payroll). Le badge « +8h48 sup » sur sa
                // ligne contredisait la préparation des payes, qui affiche « — »
                // pour lui — vu à l'écran le 10/08, signalé par Théo.
                const hasOT  = !emp.is_gerant && workedH > ch
                const showContractPop = contractPopover === emp.id
                const cpInitial   = emp.cp_initial ?? 25
                const cpUsedCount = cpUsed[emp.id] || 0
                const cpRemaining = cpInitial - cpUsedCount
                const hsCumul     = Number(emp.hs_cumules ?? 0)
                const cddEnd      = cddEndInfo(emp)

                return (
                  <tr key={emp.id} className="group">
                    {/* Employee cell */}
                    <td className={`px-3 py-0 sticky left-0 bg-white z-10 border-b border-r border-gray-200 ${pal.lborder}`}>
                      <div className="flex items-center gap-2 py-2">
                        <div className={`w-7 h-7 rounded-full ${pal.bg} flex items-center justify-center flex-shrink-0`}>
                          <span className={`text-[10px] font-bold ${pal.text}`}>{initials(emp.name)}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1">
                            <p
                              className="text-sm font-semibold text-gray-900 leading-tight truncate cursor-pointer hover:text-pilote transition-colors"
                              title="Ouvrir la fiche employé"
                              onClick={e => { e.stopPropagation(); setProfileEmp({ ...emp, charges_patronales: emp.charges_patronales ?? null, weeks_off_per_year: emp.weeks_off_per_year ?? 7, hs_cumules: emp.hs_cumules ?? 0, position: emp.position ?? null, hire_date: emp.hire_date ?? null, contract_end_date: emp.contract_end_date ?? null, phone: emp.phone ?? null, email: emp.email ?? null, notes: emp.notes ?? null, is_minor: emp.is_minor ?? false, is_gerant: emp.is_gerant ?? false, receive_planning_email: emp.receive_planning_email ?? true, cp_initial: emp.cp_initial ?? null }) }}
                            >{emp.name}</p>
                            {alerts.length > 0 && (
                              <span title={alerts.join('\n')} className="flex-shrink-0">
                                <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                            <div className="relative">
                              <button
                                onClick={e => { e.stopPropagation(); setContractPopover(showContractPop ? null : emp.id) }}
                                className="text-[10px] font-bold bg-pilote text-white px-1.5 py-0.5 rounded hover:bg-pilote-hover transition-colors cursor-pointer"
                              >
                                {contractLabel(emp.contract_type)}
                              </button>
                              {showContractPop && (
                                <div className="absolute top-full left-0 mt-1 z-50 bg-white rounded-xl shadow-2xl border border-gray-100 p-1.5 w-40" onClick={e => e.stopPropagation()}>
                                  <p className="text-[10px] text-gray-400 px-2 pb-1 font-medium">Type de contrat</p>
                                  {CONTRACT_TYPES.map(ct => (
                                    <button key={ct.key} onClick={() => updateContract(emp.id, ct.key)}
                                      className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-left transition-colors ${
                                        emp.contract_type === ct.key ? 'bg-pilote text-white' : 'hover:bg-gray-50 text-gray-700'
                                      }`}
                                    >
                                      <div>
                                        <div className="text-xs font-semibold">{ct.short}</div>
                                        <div className={`text-[9px] ${emp.contract_type === ct.key ? 'text-white/70' : 'text-gray-400'}`}>{ct.desc}</div>
                                      </div>
                                      {emp.contract_type === ct.key && <span className="text-[10px]">✓</span>}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                            <span className="text-[10px] text-gray-400">{Number(emp.hourly_rate).toFixed(2)} €/h</span>
                            {cddEnd && (
                              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${cddEnd.urgent ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                                {cddEnd.label}
                              </span>
                            )}
                            <button onClick={() => deleteEmployee(emp.id)}
                              className="ml-auto opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-400 transition-all"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                          {/* CP + HS */}
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex items-center gap-1">
                              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                cpRemaining < 0 ? 'bg-red-400' : cpRemaining <= 3 ? 'bg-orange-400' : 'bg-sky-300'
                              }`} />
                              <span className={`text-[9px] ${
                                cpRemaining < 0 ? 'text-red-500 font-semibold' : cpRemaining <= 3 ? 'text-orange-500' : 'text-gray-400'
                              }`}>{cpRemaining}j CP restants</span>
                            </div>
                            <span
                              className={`text-[9px] font-medium ${hsCumul > 0 ? 'text-orange-500' : 'text-gray-400'}`}
                              title="Compteur d'heures supplémentaires cumulées — à récupérer (modifiable dans la fiche employé)"
                            >
                              {fmtH(hsCumul)} HS cumul.
                            </span>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Day cells */}
                    {JOURS_DB.map((jour, idx) => {
                      const typeKey  = `${jour}_type` as keyof PlanningEntry
                      const type     = (entry[typeKey] as DayType) || (idx >= 5 ? 'repos' : 'travail')
                      const hours    = entry[jour] || 0
                      const fName    = weekHolidays[idx]
                      const sd: ScheduleDetail = ((entry.schedule_details as ScheduleDetails | undefined) || {})[jour] || {}
                      const catM     = allPostes.find(c => c.key === sd.categorie_matin)
                      const catA     = allPostes.find(c => c.key === sd.categorie_apmidi)
                      const catSel   = (!catM && !catA) ? allPostes.find(c => c.key === sd.categorie) : undefined
                      const maxDay   = emp.is_gerant ? 24 : emp.is_minor ? 8 : 10
                      const overDay  = type === 'travail' && hours > maxDay

                      const cellBg   = fName ? 'bg-amber-50/60' : 'bg-white hover:bg-gray-50/80'
                      const cellTxt  = fName ? 'text-amber-800' : type === 'travail' ? 'text-gray-500' : TYPE_CONFIG[type].text
                      const cellDot  = fName ? 'bg-amber-400'   : type === 'travail' ? pal.dot  : TYPE_CONFIG[type].dot
                      const typeLabel = fName ? 'Férié' : type === 'travail' ? 'Travail' : TYPE_CONFIG[type].label

                      return (
                        <td key={jour} className="p-0 border-b border-r border-gray-200 align-stretch group/cell">
                          <div className="relative h-full" data-cell="true" onClick={e => e.stopPropagation()}>
                            <div
                              className={`cursor-pointer transition-all ${cellBg} ${overDay ? 'ring-2 ring-inset ring-red-400' : ''} w-full h-full min-h-[145px] px-1 pt-2 pb-2 flex flex-col select-none`}
                              onClick={e => { e.stopPropagation(); setContractPopover(null); setDetailModal({ empId: emp.id, jour, idx }) }}
                            >
                              {/* ── Top: type + copy ── */}
                              <div className="flex items-center justify-between gap-1">
                                <div className="flex items-center gap-1 min-w-0">
                                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${overDay ? 'bg-red-500' : cellDot}`} />
                                  <span className={`text-[10px] font-semibold truncate ${cellTxt}`}>{typeLabel}</span>
                                </div>
                                {(
                                  <div className="ml-auto flex items-center gap-0.5">
                                    <button
                                      className={`p-0.5 rounded transition-all ${
                                        copiedCell?.empId === emp.id && copiedCell?.jour === jour
                                          ? 'bg-pilote text-white opacity-100'
                                          : 'opacity-0 group-hover/cell:opacity-100 bg-white/60 text-gray-400 hover:text-gray-700'
                                      }`}
                                      onClick={e => { e.stopPropagation(); setCopiedCell(copiedCell?.empId === emp.id && copiedCell?.jour === jour ? null : { empId: emp.id, jour }) }}
                                      title="Copier ce jour"
                                    >
                                      <Copy className="w-2.5 h-2.5" />
                                    </button>
                                    {copiedCell && !figee && !(copiedCell.empId === emp.id && copiedCell.jour === jour) && (
                                      <button
                                        className="p-0.5 rounded bg-white/60 text-pilote hover:text-pilote-hover opacity-0 group-hover/cell:opacity-100 transition-all"
                                        onClick={e => { e.stopPropagation(); pasteDay(emp.id, jour) }}
                                        title="Coller ici"
                                      >
                                        <Clipboard className="w-2.5 h-2.5" />
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* ── Centre: résumé ── */}
                              {/* Un jour férié PEUT être travaillé (majoration +100 % CCN 992) :
                                  la saisie de travail reste disponible sur les jours fériés */}
                              {type === 'travail' ? (
                                <div className="flex-1 flex flex-col py-1.5 gap-1 px-0.5">
                                  {/* Poste global (legacy — uniquement si pas de poste par créneau) */}
                                  {catSel && (
                                    <div className="flex justify-center">
                                      <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${catSel.color}`}>
                                        {catSel.short}
                                      </span>
                                    </div>
                                  )}

                                  {/* Les deux créneaux du jour.
                                      L'horaire tenait sur la MÊME ligne que le
                                      repère « M » et la pastille du poste : à
                                      sept colonnes, il ne restait la place que
                                      pour « 8… ». On empile désormais l'horaire
                                      au-dessus du poste — c'est la mise en page
                                      de Skello, et c'est la seule qui laisse
                                      lire une heure en entier.
                                      Le repère M / AM disparaît quand l'horaire
                                      est là : « 08:00 » dit déjà que c'est le
                                      matin. Il ne reste que sur un créneau vide,
                                      où il désigne la case à remplir. */}
                                  {([
                                    { cle: 'matin' as const, court: 'Matin', debut: sd.matin_debut, fin: sd.matin_fin },
                                    { cle: 'apmidi' as const, court: 'Après-midi', debut: sd.apmidi_debut, fin: sd.apmidi_fin },
                                  ]).map(cr => {
                                    // Tous les postes du créneau, pas seulement
                                    // le principal : un créneau partagé entre
                                    // deux rayons n'en montrait qu'un. Même
                                    // lecture que la vue Postes — une seule
                                    // vérité (lib/planning-postes).
                                    const cles = postesDuCreneau(sd as never, cr.cle)
                                    const defs = cles.map(k => allPostes.find(c => c.key === k)).filter(Boolean) as PosteDef[]
                                    const rempli = Boolean(cr.debut) || defs.length > 0
                                    return (
                                      <div key={cr.cle}
                                        className={`rounded-lg px-1.5 py-1 ${rempli ? 'bg-gray-50 border border-gray-200/70' : 'bg-gray-50/50'}`}>
                                        <p className={`text-[10px] font-bold tabular leading-tight whitespace-nowrap ${cr.debut ? 'text-gray-800' : 'text-gray-300'}`}>
                                          {cr.debut ? `${cr.debut} – ${cr.fin || '?'}` : (
                                            <span className="font-semibold">{cr.court} —</span>
                                          )}
                                        </p>
                                        {defs.length > 0 && (
                                          <div className="flex flex-wrap gap-0.5 mt-0.5">
                                            {defs.map(d => (
                                              <span key={d.key}
                                                title={defs.length > 1
                                                  ? `${d.short} — créneau partagé entre ${defs.length} postes, heures réparties à parts égales`
                                                  : d.short}
                                                className={`text-[8px] px-1 py-px rounded font-bold max-w-full truncate ${d.color}`}>
                                                {defs.length > 1 ? d.abbr : d.short}
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })}

                                  {/* Total heures */}
                                  <div className="flex justify-center mt-0.5">
                                    {(() => {
                                      const computed = calcHoursFromSd(sd)
                                      const displayH = computed !== null ? computed : hours
                                      return (
                                        <span className={`text-sm font-bold ${overDay ? 'text-red-600' : displayH > 0 ? pal.text : 'text-gray-300'}`}>
                                          {displayH > 0 ? fmtH(displayH) : '—'}
                                        </span>
                                      )
                                    })()}
                                  </div>
                                </div>
                              ) : (
                                <div className="flex-1 flex flex-col items-center justify-center gap-0.5">
                                  {fName ? (
                                    <span className="font-bold text-2xl text-amber-400">✦</span>
                                  ) : type === 'conges' ? (
                                    <span className="px-3 py-1.5 rounded-lg bg-sky-50 text-sky-700 text-sm font-bold">CP · {fmtH(ch / 5)}</span>
                                  ) : type === 'maladie' ? (
                                    <span className="px-3 py-1.5 rounded-lg bg-red-50 text-red-600 text-sm font-bold">Maladie</span>
                                  ) : (
                                    <span className="text-gray-300 font-bold text-lg">—</span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      )
                    })}

                    {/* Total */}
                    <td className="px-2 py-3 text-center border-b border-r border-gray-200">
                      <div className={`inline-flex flex-col items-center px-2 py-1 rounded-lg ${
                        alerts.length > 0 ? 'bg-red-50 ring-1 ring-red-200' : hasOT ? 'bg-orange-50' : totalH > 0 ? 'bg-gray-50' : ''
                      }`}>
                        <span className={`font-bold text-sm ${
                          alerts.length > 0 ? 'text-red-600' : hasOT ? 'text-orange-600' : totalH > 0 ? 'text-gray-800' : 'text-gray-300'
                        }`}>{fmtH(totalH)}</span>
                        {hasOT && <span className={`text-[9px] ${alerts.length > 0 ? 'text-red-400' : 'text-orange-400'}`}>+{fmtH(workedH - ch)} sup</span>}
                      </div>
                    </td>

                    {/* Cost — un COÛT, donc jamais en vert (couleur d'un gain,
                        anti-pattern de la charte ; la barre du haut avait déjà
                        quitté le vert pour la même raison).
                        Les MAJORATIONS s'écrivent sous le montant : « 8h à
                        +100 % » explique pourquoi une semaine à férié coûte
                        plus cher que taux × heures — sans cette ligne, l'écart
                        se lisait comme un chiffre faux (10/08, Théo). */}
                    <td className="px-2 py-3 text-center border-b border-gray-200">
                      {cost > 0 ? (
                        <div className="flex flex-col items-center">
                          <span className="font-bold text-sm text-gray-800">{cost.toFixed(0)} €</span>
                          <span className="text-[9px] text-gray-400" title="Brut + charges patronales">{charged.toFixed(0)} € chargé</span>
                          {ferieH > 0 && (
                            <span className="text-[9px] font-semibold text-amber-600" title="Heures travaillées un jour férié, majorées +100 % (CCN 992)">
                              {fmtH(ferieH)} férié +100 %
                            </span>
                          )}
                          {dimancheH > 0 && (
                            <span className="text-[9px] font-semibold text-amber-600" title="Heures travaillées le dimanche, majorées +20 % (CCN 992)">
                              {fmtH(dimancheH)} dim. +20 %
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="font-bold text-sm text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}

            {/* Footer row */}
            {employees.length > 0 && (
              <tr className="bg-pilote">
                <td className="px-3 py-3 sticky left-0 bg-pilote z-10 border-r border-white/15">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-white/60">Total / jour</span>
                </td>
                {JOURS_DB.map((jour, idx) => {
                  const dayH = employees.reduce((s, emp) => {
                    const e = getEntryState(emp.id)
                    const t = (e[`${jour}_type` as keyof PlanningEntry] as DayType) || 'travail'
                    const dailyCP = (emp.contract_hours || 35) / 5
                    return s + (t === 'travail' ? (e[jour] || 0) : t === 'conges' ? dailyCP : 0)
                  }, 0)
                  const present = employees.filter(emp => {
                    const t = (getEntryState(emp.id)[`${jour}_type` as keyof PlanningEntry] as DayType) || 'travail'
                    return t !== 'repos'
                  }).length
                  const isFerie = weekHolidays[idx] !== null
                  return (
                    <td key={jour} className={`px-2 py-3 text-center border-r border-white/15 ${isFerie ? 'bg-amber-950/30' : ''}`}>
                      {dayH > 0
                        ? <><div className="text-sm font-bold text-white">{fmtH(dayH)}</div><div className="text-[10px] text-white/50">{present} pers.</div></>
                        : <span className="text-white/30">—</span>}
                    </td>
                  )
                })}
                <td className="px-3 py-3 text-center border-r border-white/15"><span className="font-bold text-white">{fmtH(grandH)}</span></td>
                <td className="px-3 py-3 text-center">
                  <div className="font-bold text-orange-300">{grandCost.toFixed(0)} €</div>
                  <div className="text-[10px] text-white/50">{grandCharged.toFixed(0)} € chargé</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}

      {employees.length > 0 && (
        <div className="px-6 py-2.5 bg-amber-50 border-t border-amber-100">
          <p className="text-xs text-amber-700">
            <span className="font-semibold">Majorations CCN 992 :</span>{' '}
            35h → +25 % de 36–43h, +50 % au-delà{' · '}
            39h → +25 % de 40–47h, +50 % au-delà{' · '}
            HS calculées sur les heures travaillées uniquement (CP exclus){' · '}
            Dimanche +20 %{' · '}
            Férié +100 %{' · '}
            CP = heures contrat ÷ 5, payés au taux normal{' · '}
            Coût chargé = brut + charges patronales (modifiable dans la fiche employé)
          </p>
        </div>
      )}

    </>
  )
}
