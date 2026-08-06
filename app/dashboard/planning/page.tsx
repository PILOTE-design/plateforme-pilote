'use client'

// ─── LA PAGE PLANNING ───────────────────────────────────────────────────────
//
// Le fichier pesait 113 809 octets. Au-delà d'environ cent kilo-octets, l'outil
// de publication ne peut plus réémettre un fichier d'un seul tenant : la page
// devenait littéralement impossible à modifier. Elle est donc découpée, comme
// l'ont été mercuriale, facturation et valorisation avant elle.
//
//   · ./donnees   — types, constantes, calculs d'affichage
//   · ./grille    — les deux lectures de la semaine (par employé, par poste)
//   · ./modales   — détail d'une journée, récap mensuel, ajout, postes
//
// L'état et les écritures restent ici : une seule page pilote la semaine, les
// blocs extraits ne font qu'afficher ce qu'on leur donne.

import { useState, useEffect, useCallback, useRef, useMemo} from 'react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Plus, ChevronLeft, ChevronRight, CalendarDays, FileDown, Copy, BarChart2, AlertTriangle, Send, Lock, Unlock } from 'lucide-react'
import EmployeeProfileModal, { EmployeeProfile } from '@/components/EmployeeProfileModal'
import { getWeekDates, frenchHolidayNames } from '@/lib/payroll'
import { couvertureParPoste, type EntreePlanning } from '@/lib/planning-postes'
import { estFigee, bandeauFigee, type VerrouSemaine } from '@/lib/planning-lock'
import { GrilleSemaine } from './grille'
import { ModaleDetail, ModaleMensuel, ModaleAjout, ModalePostes } from './modales'
import {
  JOURS_DB, CATEGORIES, CUSTOM_POSTE_COLORS, TYPE_CONFIG, CONTRACT_TYPES, EMP_PALETTES,
  abbrOf, isoWeeksInYear, getISOWeek, getWeekLabel, getWeekVacances, getWeeksInMonth,
  contractLabel, calcTotalH, calcWorkedH, calcCostCCN, chargeMult,
  getEmployeeAlerts, emptyEntry, initials, fmtH, calcHoursFromSd,
  type DayType, type JourDB, type ScheduleDetail, type ScheduleDetails, type PosteDef,
  type ContractKey, type Employee, type PlanningEntry, type EntriesMap, type MonthlyStat,
  type StatLigne,
} from './donnees'

// ─── Component ──────────────────────────────────────────────

export default function PlanningPage() {
  const { toast } = useToast()
  const { confirm: confirmAction } = useConfirm()
  const now = getISOWeek(new Date())
  const [week, setWeek]   = useState(now.week)
  const [year, setYear]   = useState(now.year)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [entries, setEntries]     = useState<EntriesMap>({})
  const entriesRef = useRef<EntriesMap>({})
  const [detailModal,    setDetailModal]     = useState<{ empId: string; jour: JourDB; idx: number } | null>(null)
  const [contractPopover,setContractPopover] = useState<string | null>(null)
  const [loadingEmployees, setLoadingEmployees] = useState(true)
  const [showAdd,      setShowAdd]      = useState(false)
  const [newName,      setNewName]      = useState('')
  const [newRate,      setNewRate]      = useState('')
  const [newContractKey, setNewContractKey] = useState<ContractKey>('CDI_35')
  const [adding,       setAdding]       = useState(false)
  const [pageError,    setPageError]    = useState<string | null>(null)
  // New
  const [profileEmp,     setProfileEmp]     = useState<EmployeeProfile | null>(null)
  const [copying,        setCopying]        = useState(false)
  const [copiedCell,     setCopiedCell]     = useState<{ empId: string; jour: JourDB } | null>(null)
  const [cpUsed,         setCpUsed]         = useState<Record<string, number>>({})
  const [showMonthly,    setShowMonthly]    = useState(false)
  const [monthlyData,    setMonthlyData]    = useState<MonthlyStat[] | null>(null)
  const [loadingMonthly, setLoadingMonthly] = useState(false)
  const [sendingMail,    setSendingMail]    = useState(false)
  // Postes personnalisés du client (ex. « Prestation ») — s'ajoutent aux 6 intégrés,
  // utilisables sur chaque créneau et comme famille de marge en facturation.
  const [customPostes,   setCustomPostes]   = useState<{ key: string; label: string }[]>([])
  const [showPostes,     setShowPostes]     = useState(false)
  // La semaine se lit de DEUX façons — par employé (« qui travaille, et combien
  // ça coûte ») ou par poste (« mon rayon est-il couvert ? »). Même donnée, même
  // écran, deux questions ; le boucher se pose les deux.
  const [vue, setVue] = useState<'employes' | 'postes'>('employes')
  const [newPosteLabel,  setNewPosteLabel]  = useState('')
  const [savingPostes,   setSavingPostes]   = useState(false)
  // Semaines FIGÉES du client (cf. lib/planning-lock). Une semaine figée
  // s'affiche, s'imprime et se compte comme avant — elle ne s'écrit plus.
  const [verrous,        setVerrous]        = useState<VerrouSemaine[]>([])
  const [verrouillage,   setVerrouillage]   = useState(false)

  const allPostes: PosteDef[] = [
    ...CATEGORIES,
    ...customPostes.map((p, i) => ({ key: p.key, short: p.label, abbr: abbrOf(p.label), color: CUSTOM_POSTE_COLORS[i % CUSTOM_POSTE_COLORS.length] })),
  ]

  useEffect(() => {
    fetch('/api/postes', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (Array.isArray(d?.custom)) setCustomPostes(d.custom) })
      .catch(() => {})
  }, [])

  /** Remplace la liste des postes personnalisés (le serveur slugifie et valide) */
  async function saveCustomPostes(next: { label: string }[]) {
    setSavingPostes(true)
    const res = await fetch('/api/postes', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom_postes: next }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => ({} as any)) : ({} as any)
    setSavingPostes(false)
    if (res?.ok && Array.isArray(data.custom)) {
      setCustomPostes(data.custom)
      return true
    }
    toast({ variant: 'error', title: 'Postes non enregistrés', description: data?.error || 'Réessayez.' })
    return false
  }

  async function addCustomPoste() {
    const label = newPosteLabel.trim()
    if (label.length < 2) return
    const ok = await saveCustomPostes([...customPostes, { label }])
    if (ok) { setNewPosteLabel(''); toast({ variant: 'success', title: `Poste « ${label} » ajouté`, description: 'Disponible sur les créneaux du planning et comme famille de marge en facturation.' }) }
  }

  async function removeCustomPoste(key: string) {
    const p = customPostes.find(x => x.key === key)
    const ok = await confirmAction({
      title: `Retirer le poste « ${p?.label ?? key} » ?`,
      description: 'Il ne sera plus proposé sur les créneaux. Les heures déjà pointées dessus restent comptées (et reconnues en facturation si une famille de marge lui ressemble).',
      confirmLabel: 'Retirer',
      variant: 'danger',
    })
    if (!ok) return
    await saveCustomPostes(customPostes.filter(x => x.key !== key))
  }

  const { week: cw, year: cy } = getISOWeek(new Date())
  const isCurrentWeek = week === cw && year === cy
  const weekDates     = getWeekDates(week, year)

  // Date du jour au format ISO local (évite le mélange UTC/local)
  const tNow = new Date()
  const todayISO = `${tNow.getFullYear()}-${String(tNow.getMonth() + 1).padStart(2, '0')}-${String(tNow.getDate()).padStart(2, '0')}`

  // Jours fériés pour l'année affichée
  const holidays     = frenchHolidayNames(year)
  const weekHolidays = weekDates.map(d => holidays.get(d.toISOString().slice(0, 10)) ?? null)
  const weekVacances = getWeekVacances(weekDates)

  // Rangement par poste — moteur PUR (lib/planning-postes, 50 assertions). Les
  // heures d'un créneau multi-postes se partagent à parts égales, si bien que le
  // total de cette vue égale exactement celui des heures travaillées.
  const lignesPostes = useMemo(() => couvertureParPoste({
    employes: employees.map(e => ({ id: e.id, name: e.name })),
    entrees: entries as unknown as Record<string, EntreePlanning>,
    postes: allPostes.map(p => p.key),
  }), [employees, entries, allPostes])
  const libellesPostes = useMemo(
    () => Object.fromEntries(allPostes.map(p => [p.key, p.short])), [allPostes])
  const couleursPostes = useMemo(
    () => Object.fromEntries(allPostes.map(p => [p.key, p.color])), [allPostes])
  const holidayFlags = weekHolidays.map(h => h !== null)

  const setEntriesSync = (updater: (prev: EntriesMap) => EntriesMap) => {
    setEntries(prev => {
      const next = updater(prev)
      entriesRef.current = next
      return next
    })
  }

  useEffect(() => {
    const close = () => setContractPopover(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])

  useEffect(() => {
    fetch('/api/employees').then(r => r.json()).then(data => {
      if (Array.isArray(data)) { setEmployees(data); setPageError(null) }
      else setPageError(data?.error || 'Erreur chargement')
      setLoadingEmployees(false)
    }).catch(() => { setPageError('Erreur réseau'); setLoadingEmployees(false) })
  }, [])

  // Solde CP : rechargé à chaque changement d'année
  const refreshCpUsed = useCallback(() => {
    fetch(`/api/planning/stats?year=${year}`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          const map: Record<string, number> = {}
          for (const { employee_id, cp_used } of data) map[employee_id] = cp_used
          setCpUsed(map)
        }
      })
      .catch(() => {})
  }, [year])

  useEffect(() => { refreshCpUsed() }, [refreshCpUsed])

  /** Remplace (ou retire) le verrou d'une semaine dans la liste locale. */
  const majVerrou = useCallback((w: number, y: number, v: VerrouSemaine | null) => {
    setVerrous(prev => {
      const autres = prev.filter(x => !(Number(x.week_number) === w && Number(x.year) === y))
      return v ? [...autres, { ...v, week_number: w, year: y }] : autres
    })
  }, [])

  // Les verrous de l'année, chargés d'un coup : en changeant de semaine, la
  // grille sait tout de suite qu'elle est figée — elle ne s'offre pas à la
  // saisie le temps d'un aller-retour.
  useEffect(() => {
    let vivant = true
    fetch(`/api/planning/lock?year=${year}`).then(r => r.json()).then(data => {
      if (!vivant || !Array.isArray(data)) return
      setVerrous(prev => [...prev.filter(v => Number(v.year) !== year), ...(data as VerrouSemaine[])])
    }).catch(() => {})
    return () => { vivant = false }
  }, [year])

  const loadEntries = useCallback(() => {
    fetch(`/api/planning?week=${week}&year=${year}`).then(r => r.json()).then(data => {
      const liste = Array.isArray(data) ? data : (Array.isArray(data?.entries) ? data.entries : null)
      if (liste) {
        const map: EntriesMap = {}
        for (const e of liste) map[e.employee_id] = e
        setEntries(map); entriesRef.current = map
      }
      if (!Array.isArray(data)) majVerrou(week, year, (data?.verrou as VerrouSemaine | null) ?? null)
    })
  }, [week, year, majVerrou])

  useEffect(() => { loadEntries() }, [loadEntries])

  /** La semaine affichée est-elle figée ? (la question passe par lib/planning-lock) */
  const figee = estFigee(verrous, week, year)
  const verrouCourant = verrous.find(v => Number(v.week_number) === week && Number(v.year) === year) ?? null

  function getEntry(empId: string)      { return entriesRef.current[empId] ?? emptyEntry(empId, week, year) }
  function getEntryState(empId: string) { return entries[empId] ?? emptyEntry(empId, week, year) }

  async function saveEntryValues(empId: string, entry: PlanningEntry) {
    if (figee) return
    const res = await fetch('/api/planning', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...entry, employee_id: empId, week_number: week, year }),
    })
    // Le serveur a le dernier mot : si la semaine a été figée entre-temps, on
    // dit son refus tel quel et on recharge ce qui est réellement enregistré.
    if (res.status === 409) {
      const data = await res.json().catch(() => null)
      toast({ variant: 'error', title: 'Modification refusée', description: data?.error || `Erreur ${res.status}` })
      loadEntries()
    }
  }

  /** Figer / libérer la semaine affichée. */
  async function basculerVerrou() {
    if (verrouillage) return
    const ok = await confirmAction(figee
      ? {
          title: `Déverrouiller la semaine ${week} ?`,
          description: `Cette semaine a servi de base : ses heures sont parties dans le rapport hebdomadaire et dans les plannings envoyés aux employés. La modifier maintenant fera diverger ce qui a déjà été envoyé de ce que dit la plateforme.`,
          confirmLabel: 'Déverrouiller',
          variant: 'danger',
        }
      : {
          title: `Figer la semaine ${week} ?`,
          description: `La semaine passe en lecture seule : ses heures ne bougeront plus, ni à l'écran ni depuis le serveur. Les impressions, le récapitulatif du mois et les calculs continuent de la lire normalement. C'est réversible à tout moment.`,
          confirmLabel: 'Figer la semaine',
          variant: 'default',
        })
    if (!ok) return
    setVerrouillage(true)
    try {
      const res = await fetch('/api/planning/lock', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week, year, locked: !figee }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast({
          variant: 'error',
          title: figee ? 'Déverrouillage impossible' : 'Verrouillage impossible',
          description: data?.error || `Erreur ${res.status}`,
        })
        return
      }
      const nouveau = (data?.verrou as VerrouSemaine | null) ?? null
      majVerrou(week, year, nouveau)
      toast({
        variant: 'success',
        title: nouveau ? `Semaine ${week} figée` : `Semaine ${week} déverrouillée`,
        description: nouveau ? bandeauFigee(nouveau) : 'La saisie est de nouveau ouverte sur cette semaine.',
      })
    } finally {
      setVerrouillage(false)
    }
  }

  async function updateContract(empId: string, contractKey: ContractKey) {
    const ct = CONTRACT_TYPES.find(c => c.key === contractKey)!
    setEmployees(prev => prev.map(e =>
      e.id === empId ? { ...e, contract_type: ct.key, contract_hours: ct.hours } : e
    ))
    setContractPopover(null)
    await fetch(`/api/employees/${empId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contract_type: ct.key, contract_hours: ct.hours }),
    })
  }

  async function changeType(empId: string, jour: JourDB, newType: DayType) {
    if (figee) return
    const typeKey = `${jour}_type` as keyof PlanningEntry
    const currentH = getEntry(empId)[jour] || 0
    const emp = employees.find(e => e.id === empId)
    const dailyCP = Math.round(((emp?.contract_hours || 35) / 5) * 10) / 10
    const newH = newType === 'travail' ? currentH : newType === 'conges' ? dailyCP : TYPE_CONFIG[newType].defaultHours
    const updated: PlanningEntry = {
      ...getEntry(empId), [typeKey]: newType,
      [jour]: newH,
    }
    setEntriesSync(prev => ({ ...prev, [empId]: updated }))
    await saveEntryValues(empId, updated)
    refreshCpUsed()
  }

  function updateHours(empId: string, jour: JourDB, value: string) {
    if (figee) return
    const hours = value === '' ? 0 : Math.max(0, Math.min(24, parseFloat(value) || 0))
    setEntriesSync(prev => ({ ...prev, [empId]: { ...getEntry(empId), [jour]: hours } }))
  }

  function handleScheduleDetailChange(empId: string, jour: JourDB, field: keyof ScheduleDetail, value: string) {
    if (figee) return
    const current = getEntry(empId)
    const currentSd = ((current.schedule_details || {}) as ScheduleDetails)
    const newDaySd = { ...(currentSd[jour] || {}), [field]: value }
    const computedH = calcHoursFromSd(newDaySd)
    const updated: PlanningEntry = {
      ...current,
      schedule_details: { ...currentSd, [jour]: newDaySd },
      ...(computedH !== null ? { [jour]: computedH } : {}),
    }
    setEntriesSync(prev => ({ ...prev, [empId]: updated }))
  }

  /** Sélectionne le poste d'un créneau (matin/après-midi) et efface l'ancien poste global */
  function setSlotCategory(empId: string, jour: JourDB, slot: 'categorie_matin' | 'categorie_apmidi', value: string) {
    if (figee) return
    const current = getEntry(empId)
    const currentSd = ((current.schedule_details || {}) as ScheduleDetails)
    const newDaySd: ScheduleDetail = { ...(currentSd[jour] || {}), [slot]: value, categorie: '' }
    const updated: PlanningEntry = {
      ...current,
      schedule_details: { ...currentSd, [jour]: newDaySd },
    }
    setEntriesSync(prev => ({ ...prev, [empId]: updated }))
    saveEntryValues(empId, updated)
  }

  /** PLUSIEURS postes sur un même créneau : le clic AJOUTE ou RETIRE le poste de
   *  la liste. Les heures du créneau se partagent à parts égales entre les postes
   *  cochés (paie/marges) ; le PREMIER coché reste le poste principal écrit dans
   *  categorie_matin/apmidi — l'impression et l'envoi aux employés le lisent et
   *  ne changent donc PAS. */
  function toggleSlotPoste(empId: string, jour: JourDB, slot: 'matin' | 'apmidi', key: string) {
    if (figee) return
    const current = getEntry(empId)
    const currentSd = ((current.schedule_details || {}) as ScheduleDetails)
    const daySd = currentSd[jour] || {}
    const prevList: string[] = slot === 'matin'
      ? (Array.isArray(daySd.postes_matin) && daySd.postes_matin.length > 0
          ? [...daySd.postes_matin]
          : (daySd.categorie_matin || daySd.categorie ? [(daySd.categorie_matin || daySd.categorie) as string] : []))
      : (Array.isArray(daySd.postes_apmidi) && daySd.postes_apmidi.length > 0
          ? [...daySd.postes_apmidi]
          : (daySd.categorie_apmidi || daySd.categorie ? [(daySd.categorie_apmidi || daySd.categorie) as string] : []))
    const next = prevList.includes(key) ? prevList.filter(k => k !== key) : [...prevList, key]
    const newDaySd: ScheduleDetail = slot === 'matin'
      ? { ...daySd, postes_matin: next, categorie_matin: next[0] || '', categorie: '' }
      : { ...daySd, postes_apmidi: next, categorie_apmidi: next[0] || '', categorie: '' }
    const updated: PlanningEntry = {
      ...current,
      schedule_details: { ...currentSd, [jour]: newDaySd },
    }
    setEntriesSync(prev => ({ ...prev, [empId]: updated }))
    saveEntryValues(empId, updated)
  }

  function handleScheduleDetailBlur(empId: string) {
    const entry = entriesRef.current[empId] ?? emptyEntry(empId, week, year)
    saveEntryValues(empId, entry)
  }

  function handleBlur(empId: string) {
    saveEntryValues(empId, entriesRef.current[empId] ?? emptyEntry(empId, week, year))
  }

  async function addEmployee() {
    if (!newName.trim() || !newRate) return
    setAdding(true)
    const ct = CONTRACT_TYPES.find(c => c.key === newContractKey)!
    const res = await fetch('/api/employees', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), hourly_rate: parseFloat(newRate), contract_type: ct.key, contract_hours: ct.hours }),
    })
    const data = await res.json()
    if (data.id) {
      setEmployees(p => [...p, data])
      setNewName(''); setNewRate(''); setNewContractKey('CDI_35'); setShowAdd(false)
    }
    setAdding(false)
  }

  async function deleteEmployee(id: string) {
    const emp = employees.find(e => e.id === id)
    const ok = await confirmAction({
      title: `Supprimer ${emp?.name ?? 'cet employé'} ?`,
      description: 'Tout son historique de planning sera également supprimé. Cette action est définitive.',
      confirmLabel: 'Supprimer',
      variant: 'danger',
    })
    if (!ok) return
    await fetch(`/api/employees/${id}`, { method: 'DELETE' })
    setEmployees(p => p.filter(e => e.id !== id))
    setEntriesSync(prev => { const n = { ...prev }; delete n[id]; return n })
    toast({ variant: 'success', title: 'Employé supprimé' })
  }

  function prevWeek() {
    if (week === 1) { setYear(y => y - 1); setWeek(isoWeeksInYear(year - 1)) }
    else setWeek(w => w - 1)
  }
  function nextWeek() {
    const maxW = isoWeeksInYear(year)
    if (week === maxW) { setYear(y => y + 1); setWeek(1) }
    else setWeek(w => w + 1)
  }

  async function copyPrevWeek() {
    // On peut copier DEPUIS une semaine figée ; jamais DANS une semaine figée.
    if (copying || figee) return
    const prevY = week === 1 ? year - 1 : year
    const prevW = week === 1 ? isoWeeksInYear(prevY) : week - 1
    setCopying(true)
    try {
      const res = await fetch(`/api/planning?week=${prevW}&year=${prevY}`)
      const payload = await res.json()
      const data = Array.isArray(payload) ? payload : (Array.isArray(payload?.entries) ? payload.entries : null)
      if (!Array.isArray(data) || data.length === 0) {
        toast({ variant: 'info', title: 'Aucun planning à copier', description: `Aucun planning trouvé pour la semaine ${prevW} (${prevY}).` })
        return
      }
      const currentHasData = Object.values(entriesRef.current).some(entry =>
        JOURS_DB.some(j => (Number((entry as Record<string, unknown>)[j]) || 0) > 0)
      )
      if (currentHasData) {
        const ok = await confirmAction({
          title: `Écraser le planning de la semaine ${week} ?`,
          description: `La semaine ${week} contient déjà des heures saisies. Copier la semaine ${prevW} remplacera les jours déjà renseignés.`,
          confirmLabel: 'Copier et écraser',
          variant: 'danger',
        })
        if (!ok) return
      }
      const posts = data.map((entry: Record<string, unknown>) => {
        const entryData = { ...entry }; delete entryData.id
        return fetch('/api/planning', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...entryData, week_number: week, year }),
        })
      })
      const resultats = await Promise.all(posts)
      const refus = resultats.find(r => r.status === 409)
      if (refus) {
        const d = await refus.json().catch(() => null)
        toast({ variant: 'error', title: 'Copie refusée', description: d?.error || `Erreur ${refus.status}` })
        loadEntries()
        return
      }
      loadEntries()
      toast({ variant: 'success', title: 'Planning copié', description: `Semaine ${prevW} copiée vers la semaine ${week}.` })
    } finally {
      setCopying(false)
    }
  }

  /** Envoie à chaque employé (ayant un email dans sa fiche) son planning individuel de la semaine.
   *  Un envoi automatique a aussi lieu chaque dimanche soir pour la semaine à venir. */
  async function sendPlanningMail() {
    if (sendingMail) return
    setSendingMail(true)
    try {
      const res = await fetch('/api/planning/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week, year }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast({ variant: 'error', title: 'Envoi impossible', description: data?.error || `Erreur ${res.status}` })
        return
      }
      const extras: string[] = []
      if (data.noEmail > 0) extras.push(`${data.noEmail} sans adresse mail (fiche employé)`)
      if (data.noPlanning > 0) extras.push(`${data.noPlanning} sans planning cette semaine`)
      if (data.disabled > 0) extras.push(`${data.disabled} envoi${data.disabled > 1 ? 's' : ''} désactivé${data.disabled > 1 ? 's' : ''} (fiche employé)`)
      toast({
        variant: data.sent > 0 ? 'success' : 'info',
        title: data.sent > 0 ? `Planning envoyé à ${data.sent} employé${data.sent > 1 ? 's' : ''}` : 'Aucun email envoyé',
        description: extras.length > 0 ? extras.join(' · ') : `Semaine ${week} — chacun ne reçoit que ses propres horaires.`,
      })
    } finally {
      setSendingMail(false)
    }
  }

  function pasteDay(toEmpId: string, toJour: JourDB) {
    if (!copiedCell || figee) return
    const fromEntry = getEntryState(copiedCell.empId)
    const fromType  = (fromEntry[`${copiedCell.jour}_type` as keyof PlanningEntry] as DayType) || 'travail'
    const fromHours = (fromEntry[copiedCell.jour as keyof PlanningEntry] as number) || 0
    const fromSd    = ((fromEntry.schedule_details as ScheduleDetails | undefined) || {})[copiedCell.jour]
    const toEntry   = getEntryState(toEmpId)
    const toSd      = ((toEntry.schedule_details as ScheduleDetails | undefined) || {})
    const updated: PlanningEntry = {
      ...toEntry,
      [`${toJour}_type`]: fromType,
      [toJour]: fromHours,
      ...(fromSd ? { schedule_details: { ...toSd, [toJour]: { ...fromSd } } } : {}),
    }
    setEntriesSync(prev => ({ ...prev, [toEmpId]: updated }))
    saveEntryValues(toEmpId, updated)
  }

  async function openMonthly() {
    setShowMonthly(true)
    setLoadingMonthly(true)
    setMonthlyData(null)
    const monthYear = weekDates[0].getUTCFullYear()
    const month     = weekDates[0].getUTCMonth() + 1
    const weeks     = getWeeksInMonth(monthYear, month)
    try {
      const allResults = await Promise.all(
        weeks.map(({ week: w, year: y }) =>
          fetch(`/api/planning?week=${w}&year=${y}`).then(r => r.json())
            .then(d => Array.isArray(d) ? d : (Array.isArray(d?.entries) ? d.entries : []))
            .catch(() => [])
        )
      )
      const holidayCache: Record<number, Map<string, string>> = {}
      const stats: Record<string, { hours: number; cost: number; charged: number; ot: number; worked: number; cp: number; sick: number }> = {}
      allResults.forEach((weekEntries, wi) => {
        if (!Array.isArray(weekEntries)) return
        const { week: w, year: y } = weeks[wi]
        if (!holidayCache[y]) holidayCache[y] = frenchHolidayNames(y)
        const wDates = getWeekDates(w, y)
        const wFlags = wDates.map(d => holidayCache[y].has(d.toISOString().slice(0, 10)))
        for (const entry of weekEntries) {
          if (!stats[entry.employee_id]) stats[entry.employee_id] = { hours: 0, cost: 0, charged: 0, ot: 0, worked: 0, cp: 0, sick: 0 }
          const emp = employees.find(e => e.id === entry.employee_id)
          if (!emp) continue
          const ch = emp.contract_hours || 35
          const weekH = calcTotalH(entry, ch)
          const weekWorkedH = calcWorkedH(entry)
          const weekCost = calcCostCCN(entry, emp, wFlags)
          stats[entry.employee_id].hours   += weekH
          stats[entry.employee_id].cost    += weekCost
          stats[entry.employee_id].charged += weekCost * chargeMult(emp)
          stats[entry.employee_id].ot      += Math.max(0, weekWorkedH - ch)
          for (const jour of JOURS_DB) {
            const t = (entry[`${jour}_type`] as DayType) || 'travail'
            const h = (entry[jour] as number) || 0
            if (t === 'conges') stats[entry.employee_id].cp++
            else if (t === 'maladie') stats[entry.employee_id].sick++
            else if (t === 'travail' && h > 0) stats[entry.employee_id].worked++
          }
        }
      })
      setMonthlyData(employees.map(emp => ({ emp, ...(stats[emp.id] || { hours: 0, cost: 0, charged: 0, ot: 0, worked: 0, cp: 0, sick: 0 }) })))
    } finally {
      setLoadingMonthly(false)
    }
  }

  const rowStats = employees.map(emp => {
    const e  = getEntryState(emp.id)
    const ch = emp.contract_hours || 35
    const cost = calcCostCCN(e, emp, holidayFlags)
    return {
      empId: emp.id, name: emp.name,
      totalH: calcTotalH(e, ch),
      workedH: calcWorkedH(e),
      cost,
      charged: cost * chargeMult(emp),
      alerts: getEmployeeAlerts(emp, e),
    }
  })
  const grandH       = rowStats.reduce((s, r) => s + r.totalH, 0)
  const grandCost    = rowStats.reduce((s, r) => s + r.cost, 0)
  const grandCharged = rowStats.reduce((s, r) => s + r.charged, 0)
  const weekAlerts   = rowStats.flatMap(r => r.alerts.map(msg => ({ name: r.name, msg })))

  /** PDF = FEUILLE D'ÉMARGEMENT à afficher et faire signer.
   *  AUCUN montant, aucun taux horaire, aucun coût : l'argent reste sur la plateforme. */
  function exportPDF() {
    const dates = getWeekDates(week, year)
    const fmtD  = (d: Date) => d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    const dayHeaders = dates.map((d, i) => {
      const fName = holidays.get(d.toISOString().slice(0, 10))
      const bg    = fName ? '#d97706' : i >= 5 ? '#94a3b8' : '#1E3A5F'
      return `<th style="background:${bg};color:white;padding:7px 5px;font-size:10px;text-align:center;">${fmtD(d)}${fName ? `<br><span style="font-size:8px;opacity:.9;">✦ ${fName}</span>` : ''}</th>`
    }).join('')
    const CUSTOM_HEX = ['#0d9488', '#be185d', '#6d28d9', '#0e7490', '#4d7c0f', '#a21caf'] // pendants hex des couleurs Tailwind des postes personnalisés
    const catHex: Record<string, string> = { boucherie: '#b91c1c', charcuterie: '#c2410c', traiteur: '#047857', vente: '#0369a1', administratif: '#475569', livraison: '#4f46e5' }
    customPostes.forEach((p, i) => { catHex[p.key] = CUSTOM_HEX[i % CUSTOM_HEX.length] })
    const empRows = employees.map((emp, i) => {
      const pal    = EMP_PALETTES[i % EMP_PALETTES.length]
      const entry  = getEntryState(emp.id)
      const ch     = emp.contract_hours || 35
      const totalH = calcTotalH(entry, ch)
      const cells  = JOURS_DB.map((j, idx) => {
        const type   = (entry[`${j}_type` as keyof PlanningEntry] as DayType) || (idx >= 5 ? 'repos' : 'travail')
        const h      = entry[j] || 0
        const fName  = weekHolidays[idx]
        const sd: ScheduleDetail = ((entry.schedule_details as ScheduleDetails | undefined) || {})[j] || {}
        const catM   = allPostes.find(c => c.key === sd.categorie_matin)
        const catA   = allPostes.find(c => c.key === sd.categorie_apmidi)
        const catG   = (!catM && !catA) ? allPostes.find(c => c.key === sd.categorie) : undefined
        const bg     = fName ? '#fef3c7' : type === 'travail' ? pal.lightHex : TYPE_CONFIG[type].pdfColor
        let label = ''
        if (type === 'travail') {
          const lines: string[] = []
          if (catG) lines.push(`<div style=\"font-size:7.5px;font-weight:700;color:${catHex[catG.key] || '#334155'};text-transform:uppercase;letter-spacing:.3px;\">${catG.short}</div>`)
          if (sd.matin_debut || catM) lines.push(`<div style=\"font-size:8px;color:#475569;\">M ${sd.matin_debut ? `${sd.matin_debut}–${sd.matin_fin || '?'}` : ''}${catM ? ` <span style=\"font-weight:700;color:${catHex[catM.key] || '#334155'};\">${catM.abbr}</span>` : ''}</div>`)
          if (sd.apmidi_debut || catA) lines.push(`<div style=\"font-size:8px;color:#475569;\">AM ${sd.apmidi_debut ? `${sd.apmidi_debut}–${sd.apmidi_fin || '?'}` : ''}${catA ? ` <span style=\"font-weight:700;color:${catHex[catA.key] || '#334155'};\">${catA.abbr}</span>` : ''}</div>`)
          lines.push(h > 0 ? `<strong style=\"font-size:11px;\">${fmtH(h)}</strong>` : '—')
          label = lines.join('')
        } else if (type === 'conges') {
          label = `<span style=\"font-size:9px;\">CP ${fmtH(ch / 5)}</span>`
        } else {
          label = `<span style=\"font-size:9px;\">${TYPE_CONFIG[type].label}</span>`
        }
        return `<td style="padding:5px 4px;text-align:center;background:${bg};border-bottom:1px solid #e2e8f0;border-right:1px solid #e2e8f0;vertical-align:middle;">${label}${fName ? `<br><span style="font-size:8px;color:#92400e;">Férié</span>` : ''}</td>`
      }).join('')
      return `<tr>
        <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;border-left:3px solid ${pal.hex};background:#fafafa;">
          <div style="display:flex;align-items:center;gap:7px;">
            <div style="width:26px;height:26px;border-radius:50%;background:${pal.hex};display:flex;align-items:center;justify-content:center;"><span style="color:white;font-size:9px;font-weight:700;">${initials(emp.name)}</span></div>
            <div><div style="font-weight:700;font-size:12px;">${emp.name}</div><div style="font-size:9px;color:#94a3b8;">${contractLabel(emp.contract_type)}</div></div>
          </div>
        </td>${cells}
        <td style="padding:6px;text-align:center;font-weight:700;font-size:12px;color:#1e293b;background:#f8fafc;border-bottom:1px solid #e2e8f0;">${fmtH(totalH)}</td>
        <td style="padding:6px 8px;background:#ffffff;border-bottom:1px solid #e2e8f0;border-left:1px solid #e2e8f0;vertical-align:bottom;"><div style="height:30px;"></div><div style="border-top:1px dotted #94a3b8;font-size:7px;color:#94a3b8;padding-top:2px;text-align:center;">Signature</div></td>
      </tr>`
    }).join('')
    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Emargement S${week}</title>
<style>@page{size:A4 landscape;margin:1.2cm 1.5cm}*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;color:#1e293b}table{width:100%;border-collapse:collapse}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid #1E3A5F;">
  <div><div style="font-size:18px;font-weight:800;color:#1E3A5F;">Planning &amp; Emargement — Semaine ${week}</div><div style="font-size:11px;color:#64748b;margin-top:2px;">${getWeekLabel(week, year)}</div></div>
  <div style="text-align:right;"><div style="font-size:10px;color:#64748b;">Total heures equipe</div><div style="font-size:16px;font-weight:800;color:#1E3A5F;">${fmtH(grandH)}</div></div>
</div>
<table><thead><tr><th style="background:#1E3A5F;color:white;padding:7px 10px;font-size:10px;text-align:left;width:150px;">Employé</th>${dayHeaders}<th style="background:#1E3A5F;color:white;padding:7px 5px;font-size:10px;text-align:center;width:50px;">Total</th><th style="background:#1E3A5F;color:white;padding:7px 5px;font-size:10px;text-align:center;width:110px;">Emargement</th></tr></thead><tbody>${empRows}</tbody></table>
<div style="display:flex;justify-content:space-between;margin-top:14px;">
  <p style="font-size:9px;color:#94a3b8;">Document a afficher — chaque employe emarge pour attester de ses horaires · CP = heures contrat / 5 · Genere via PILOTE le ${new Date().toLocaleDateString('fr-FR')}</p>
  <div style="text-align:right;"><div style="font-size:9px;color:#64748b;margin-bottom:22px;">Visa de la direction :</div><div style="border-top:1px dotted #94a3b8;width:160px;"></div></div>
</div>
</body></html>`
    const win = window.open('', '_blank', 'width=1100,height=750')
    if (!win) return
    win.document.write(html); win.document.close(); win.focus()
    setTimeout(() => win.print(), 600)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <style>{`
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
      `}</style>

      {/* ── Header ── */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <CalendarDays className="w-5 h-5 text-pilote" />
          <h1 className="text-lg font-bold tracking-tight text-gray-900">Planning des équipes</h1>
        </div>
        <div className="flex items-center gap-2">
          {employees.length > 0 && (
            <>
              <Button onClick={openMonthly} variant="outline" className="h-8 text-sm px-3 border-gray-300 text-gray-600 hover:bg-gray-50">
                <BarChart2 className="w-3.5 h-3.5 mr-1.5" />Récap du mois
              </Button>
              <Button onClick={exportPDF} variant="outline" className="h-8 text-sm px-3 border-pilote text-pilote hover:bg-pilote-50" title="Feuille d'émargement à imprimer et faire signer — sans données financières">
                <FileDown className="w-3.5 h-3.5 mr-1.5" />Feuille d'émargement
              </Button>
              <Button onClick={sendPlanningMail} disabled={sendingMail} variant="outline" className="h-8 text-sm px-3 border-pilote text-pilote hover:bg-pilote-50"
                title="Envoie à chaque employé son planning individuel de la semaine affichée (email requis dans la fiche). Envoi automatique chaque dimanche soir pour la semaine à venir.">
                <Send className="w-3.5 h-3.5 mr-1.5" />{sendingMail ? 'Envoi...' : 'Envoyer aux employés'}
              </Button>
            </>
          )}
          <Button onClick={() => setShowAdd(true)} className="bg-pilote hover:bg-pilote-hover text-white h-8 text-sm px-3">
            <Plus className="w-3.5 h-3.5 mr-1.5" />Ajouter un employé
          </Button>
        </div>
      </div>

      {/* ── Week nav ── */}
      <div className="bg-white border-b border-gray-100 px-6 py-2.5 flex items-center gap-3">
        <button onClick={prevWeek} className="p-1.5 rounded hover:bg-gray-100 transition-colors"><ChevronLeft className="w-4 h-4 text-gray-500" /></button>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-900 text-sm">Semaine {week}</span>
          <span className="hidden md:inline text-xs text-gray-400">{getWeekLabel(week, year)}</span>
          {isCurrentWeek && <span className="text-[10px] bg-pilote text-white px-1.5 py-0.5 rounded font-medium">Actuelle</span>}
          {/* Le cadenas de la semaine — ouvert : la saisie est libre ; fermé : la
              semaine est figée. Il ne touche jamais à la lecture. */}
          <button
            type="button"
            onClick={basculerVerrou}
            disabled={verrouillage}
            title={figee
              ? 'Semaine figée — cliquer pour la déverrouiller'
              : 'Figer cette semaine : ses heures ne bougeront plus'}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all active:scale-[0.98] disabled:opacity-40 ${
              figee
                ? 'bg-pilote text-white hover:bg-pilote-hover shadow-card'
                : 'border border-gray-200 text-gray-500 hover:text-gray-800 hover:bg-gray-50'
            }`}
          >
            {figee ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
            {figee ? 'Figée' : 'Figer'}
          </button>
        </div>
        <button onClick={nextWeek} className="p-1.5 rounded hover:bg-gray-100 transition-colors"><ChevronRight className="w-4 h-4 text-gray-500" /></button>
        {!isCurrentWeek && (
          <button onClick={() => { setWeek(cw); setYear(cy) }} className="text-xs text-pilote hover:underline">← Semaine actuelle</button>
        )}
        <button
          onClick={copyPrevWeek}
          disabled={copying || figee}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded-xl px-2.5 py-1 hover:bg-gray-50 transition-colors disabled:opacity-40"
        >
          <Copy className="w-3 h-3" />
          {copying ? 'Copie...' : `Copier S${week === 1 ? isoWeeksInYear(year - 1) : week - 1}`}
        </button>
        {weekVacances.length > 0 && (
          <div className="hidden md:flex items-center gap-1.5 ml-1">
            <span className="text-[11px] font-medium text-gray-400">Vacances scolaires :</span>
            {weekVacances.map(v => (
              <span key={v.zone} title={`Vacances de ${v.label.toLowerCase()} — zone ${v.zone}`}
                className="text-[10px] font-bold bg-violet-50 text-violet-700 border border-violet-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                Zone {v.zone} · {v.label}
              </span>
            ))}
          </div>
        )}
        {/* Trois totaux de même poids ne disaient pas lequel décide. Le brut
            était même en VERT : un coût peint de la couleur d'un gain. Le
            chiffre qui compte est le coût CHARGÉ — ce que la semaine sort
            réellement de la caisse —, il passe donc en navy plein ; les deux
            autres restent ce qu'ils sont, des détails de composition. */}
        <div className="ml-auto flex items-center gap-3 text-xs text-encre-faible">
          <span><span className="font-semibold text-encre tabular">{fmtH(grandH)}</span> total</span>
          <span><span className="font-semibold text-encre tabular">{grandCost.toFixed(0)} €</span> brut</span>
          <span title="Brut + charges patronales — le coût réel de la semaine"
            className="inline-flex items-baseline gap-1.5 rounded-full bg-pilote px-3 py-1 text-white">
            <span className="font-extrabold tabular">{grandCharged.toFixed(0)} €</span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-pilote-200">chargé</span>
          </span>
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="bg-white border-b border-gray-100 px-6 py-2 flex items-center gap-5 flex-wrap">
        <span className="text-xs font-medium text-gray-400">Postes :</span>
        {allPostes.map(c => (
          <div key={c.key} className="flex items-center gap-1.5">
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${c.color}`}>{c.short}</span>
          </div>
        ))}
        <button onClick={() => setShowPostes(true)}
          className="flex items-center gap-1 text-[11px] font-medium text-pilote hover:underline"
          title="Ajouter ou retirer vos propres postes (ex. Prestation) — proposés sur chaque créneau et utilisables comme famille de marge en facturation">
          <Plus className="w-3 h-3" />Gérer mes postes
        </button>
        <span className="text-xs font-medium text-gray-400 ml-3">Types :</span>
        {([
          { label: 'Congé payé',   dot: 'bg-sky-400'    },
          { label: 'Arrêt maladie',dot: 'bg-red-400'    },
          { label: 'Repos',        dot: 'bg-gray-300'   },
          { label: 'Jour férié',   dot: 'bg-amber-400'  },
          { label: 'Alerte légale',dot: 'bg-red-500'    },
        ]).map(t => (
          <div key={t.label} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-sm ${t.dot}`} />
            <span className="text-xs text-gray-600">{t.label}</span>
          </div>
        ))}
      </div>

      {pageError && <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{pageError}</div>}

      {/* ── Alertes légales ── */}
      {weekAlerts.length > 0 && (
        <div className="mx-6 mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-red-700 mb-0.5">
                {weekAlerts.length} alerte{weekAlerts.length > 1 ? 's' : ''} légale{weekAlerts.length > 1 ? 's' : ''} sur cette semaine
              </p>
              {weekAlerts.map((a, i) => (
                <p key={i} className="text-xs text-red-600">{a.name} — {a.msg}</p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Semaine figée : le bandeau, en haut de la grille ── */}
      {figee && verrouCourant && (
        <div className="mx-6 mt-3 flex items-center gap-2 rounded-xl border border-pilote-100 bg-pilote-50 px-3 py-2">
          <Lock className="w-3.5 h-3.5 text-pilote flex-shrink-0" />
          <p className="text-xs font-medium text-pilote-800">{bandeauFigee(verrouCourant)}</p>
        </div>
      )}


      <GrilleSemaine
        vue={vue} setVue={setVue}
        employees={employees} loadingEmployees={loadingEmployees} pageError={pageError}
        figee={figee} weekDates={weekDates} weekHolidays={weekHolidays} todayISO={todayISO}
        allPostes={allPostes} lignesPostes={lignesPostes}
        libellesPostes={libellesPostes} couleursPostes={couleursPostes}
        cpUsed={cpUsed} rowStats={rowStats}
        grandH={grandH} grandCost={grandCost} grandCharged={grandCharged}
        getEntryState={getEntryState} updateContract={updateContract}
        deleteEmployee={deleteEmployee} pasteDay={pasteDay}
        contractPopover={contractPopover} setContractPopover={setContractPopover}
        copiedCell={copiedCell} setCopiedCell={setCopiedCell}
        setDetailModal={setDetailModal} setProfileEmp={setProfileEmp} setShowAdd={setShowAdd}
      />

      <ModaleDetail
        detailModal={detailModal} setDetailModal={setDetailModal}
        employees={employees} allPostes={allPostes}
        weekDates={weekDates} weekHolidays={weekHolidays}
        figee={figee} verrouCourant={verrouCourant}
        getEntryState={getEntryState} changeType={changeType} updateHours={updateHours}
        handleBlur={handleBlur}
        handleScheduleDetailChange={handleScheduleDetailChange}
        handleScheduleDetailBlur={handleScheduleDetailBlur}
        setSlotCategory={setSlotCategory} toggleSlotPoste={toggleSlotPoste}
      />

      <ModaleMensuel
        showMonthly={showMonthly} setShowMonthly={setShowMonthly}
        loadingMonthly={loadingMonthly} monthlyData={monthlyData} year={year} weekDates={weekDates}
      />
      {/* ── Fiche employé modal ── */}
      <EmployeeProfileModal
        employee={profileEmp}
        onClose={() => setProfileEmp(null)}
        onSaved={updated => {
          setEmployees(prev => prev.map(e => e.id === updated.id ? { ...e, ...updated } : e))
          setProfileEmp(null)
        }}
      />


      <ModaleAjout
        showAdd={showAdd} setShowAdd={setShowAdd}
        newName={newName} setNewName={setNewName}
        newRate={newRate} setNewRate={setNewRate}
        newContractKey={newContractKey} setNewContractKey={setNewContractKey}
        adding={adding} addEmployee={addEmployee}
      />

      <ModalePostes
        showPostes={showPostes} setShowPostes={setShowPostes}
        customPostes={customPostes} newPosteLabel={newPosteLabel}
        setNewPosteLabel={setNewPosteLabel} savingPostes={savingPostes}
        addCustomPoste={addCustomPoste} removeCustomPoste={removeCustomPoste}
      />
    </div>
  )
}
