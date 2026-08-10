'use client'

// ─── PRÉPARATION DES PAYES — les heures d'un mois, telles qu'on les transmet ─
//
// Rangée sous le planning : c'est la même matière — les heures de la semaine —
// et c'est depuis le planning qu'on corrige ce que la paie révèle. L'écran
// vivait ailleurs, dans une entrée de menu à part, comme s'il s'agissait de
// deux sujets.
//
// L'écran ne calcule RIEN. Tout vient de `lib/rapport-comptable` via
// `/api/rapport-comptable`, et le CSV téléchargé sort du même module que ce
// tableau. Recopier une règle ici, c'est se condamner à deux vérités.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Download, Lock, LockOpen, AlertTriangle, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import OngletsPlanning from '../onglets-planning'
import type { RapportComptable, LigneEmploye } from '@/lib/rapport-comptable'

const h = (n: number) =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Un jour ISO (YYYY-MM-DD) en clair : « 27 juillet 2026 ». UTC, jamais l'heure locale. */
const jourFr = (iso: string) =>
  iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '…'

/** Le mois précédent : la paie se prépare une fois le mois terminé. */
function moisPrecedent(): { mois: number; annee: number } {
  const d = new Date()
  const m = d.getMonth() // 0-11 → le mois précédent en base 1
  return m === 0 ? { mois: 12, annee: d.getFullYear() - 1 } : { mois: m, annee: d.getFullYear() }
}

export default function PaiePage() {
  const { toast } = useToast()
  const { confirm } = useConfirm()

  const [periode, setPeriode] = useState(moisPrecedent)
  const [rapport, setRapport] = useState<RapportComptable | null>(null)
  const [chargement, setChargement] = useState(true)
  const [figeage, setFigeage] = useState(false)
  const [ouvert, setOuvert] = useState<string | null>(null)

  const charger = useCallback(async () => {
    setChargement(true)
    try {
      const res = await fetch(`/api/rapport-comptable?mois=${periode.mois}&annee=${periode.annee}`)
      if (!res.ok) throw new Error(String(res.status))
      setRapport(await res.json())
    } catch {
      setRapport(null)
      toast({ variant: 'error', title: 'Rapport indisponible', description: 'Le mois n’a pas pu être chargé. Réessayez dans un instant.' })
    } finally {
      setChargement(false)
    }
  }, [periode, toast])

  useEffect(() => { charger() }, [charger])

  const decaler = (pas: number) => setPeriode(p => {
    const m = p.mois + pas
    if (m < 1) return { mois: 12, annee: p.annee - 1 }
    if (m > 12) return { mois: 1, annee: p.annee + 1 }
    return { mois: m, annee: p.annee }
  })

  /** Les semaines de la période dont les heures peuvent encore bouger.
   *
   *  EXACTEMENT le filtre du bandeau de réserves, côté serveur. La première
   *  version ne retenait que les semaines où un salarié avait déjà du planning :
   *  le bandeau annonçait cinq semaines libres et le bouton proposait d'en figer
   *  une seule. Une semaine vide se fige aussi — c'est même tout l'intérêt,
   *  puisque c'est là qu'on peut encore ajouter des heures après l'envoi. */
  const libres = useMemo(
    () => (rapport?.semaines ?? []).filter(s => s.rattachee && !s.figee),
    [rapport],
  )

  async function figerLaPeriode() {
    if (!rapport || libres.length === 0) return
    const ok = await confirm({
      variant: 'default',
      title: `Figer ${libres.length === 1 ? 'la semaine' : `les ${libres.length} semaines`} de ${rapport.libelle} ?`,
      description:
        `Le planning de ${libres.map(s => `S${s.week}`).join(', ')} ne pourra plus être modifié sans être déverrouillé d’abord.`
        + ` C’est ce qui rend ce rapport stable : les heures que reçoit le comptable resteront celles de la plateforme.`
        + ` Le déverrouillage reste possible à tout moment, depuis le planning.`,
      confirmLabel: 'Figer',
    })
    if (!ok) return

    setFigeage(true)
    let faites = 0
    const echecs: string[] = []
    for (const s of libres) {
      try {
        const res = await fetch('/api/planning/lock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ week: s.week, year: s.year, locked: true, note: `Transmis au comptable — ${rapport.libelle}` }),
        })
        if (res.ok) faites++
        else echecs.push(`S${s.week} : ${(await res.json().catch(() => ({}))).error || 'refus'}`)
      } catch {
        echecs.push(`S${s.week} : réseau`)
      }
    }
    setFigeage(false)
    await charger()

    if (echecs.length === 0) {
      toast({ variant: 'success', title: `${faites} semaine${faites > 1 ? 's' : ''} figée${faites > 1 ? 's' : ''}` })
    } else {
      toast({
        variant: 'error',
        title: faites > 0 ? `${faites} figée${faites > 1 ? 's' : ''}, ${echecs.length} refusée${echecs.length > 1 ? 's' : ''}` : 'Aucune semaine figée',
        description: echecs.join(' · '),
      })
    }
  }

  const lien = `/api/rapport-comptable?mois=${periode.mois}&annee=${periode.annee}&format=csv`

  return (
    <div className="space-y-6">
      {/* ─── En-tête ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">Préparation des payes</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Les heures du mois, prêtes à transmettre. <strong className="font-semibold text-gray-700">Ce document
            n’est pas un bulletin de paie</strong> : PILOTE ne connaît ni les primes, ni la mutuelle, ni
            l’ancienneté. Il donne la base — les heures —, le reste appartient au comptable.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => decaler(-1)}
            className="w-9 h-9 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50"
            aria-label="Mois précédent"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-sm font-semibold text-gray-900 min-w-[9.5rem] text-center">
            {rapport?.libelle ?? '…'}
          </div>
          <button
            onClick={() => decaler(1)}
            className="w-9 h-9 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50"
            aria-label="Mois suivant"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ─── Bornes de la période — calée sur le dernier dimanche du mois ─── */}
      {rapport && (
        <div className="-mt-3 inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-pilote-50 border border-pilote-100 px-3 py-2 text-xs text-pilote-800">
          <span className="font-semibold uppercase tracking-wide text-pilote">Période</span>
          <span>du <strong className="font-semibold tabular">{jourFr(rapport.debut)}</strong> au <strong className="font-semibold tabular">{jourFr(rapport.fin)}</strong></span>
          <span className="text-pilote-500">— semaines entières finissant le dimanche, seuil des heures sup. jamais coupé.</span>
        </div>
      )}

      {/* ─── Actions ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <a href={lien} download>
          <Button variant="outline" disabled={!rapport || rapport.employes.length === 0}>
            <Download className="w-4 h-4 mr-2" />
            Télécharger le tableau (CSV)
          </Button>
        </a>
        {libres.length > 0 && (
          <Button onClick={figerLaPeriode} disabled={figeage}>
            <Lock className="w-4 h-4 mr-2" />
            {figeage ? 'Verrouillage…' : `Figer ${libres.length === 1 ? 'la semaine' : `les ${libres.length} semaines`} du mois`}
          </Button>
        )}
        {rapport && libres.length === 0 && rapport.employes.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-sm text-green-700 font-medium">
            <Lock className="w-3.5 h-3.5" />
            Toutes les semaines de la période sont figées
          </span>
        )}

      </div>

      {/* La rangée d'onglets, à la même hauteur que celle de la grille du
          planning : « Employés · Postes · Préparation des payes » là-bas,
          « Planning · Préparation des payes » ici. */}
      <OngletsPlanning />

      {/* ─── Les réserves ────────────────────────────────────────────── */}
      {rapport && rapport.avertissements.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-amber-900 font-semibold text-sm mb-2">
            <AlertTriangle className="w-4 h-4" />
            Ce que ce rapport ne garantit pas
          </div>
          <ul className="space-y-1.5">
            {rapport.avertissements.map((a, i) => (
              <li key={i} className="text-sm text-amber-900/90 leading-relaxed pl-4 relative">
                <span className="absolute left-0 top-2 w-1.5 h-1.5 rounded-full bg-amber-400" />
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ─── Le tableau ──────────────────────────────────────────────── */}
      {chargement && <div className="text-sm text-gray-400 py-12 text-center">Chargement du mois…</div>}

      {!chargement && rapport && rapport.employes.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center">
          <p className="text-gray-500 text-sm">Aucun salarié enregistré. Le rapport se remplira dès qu’un employé sera créé dans le planning.</p>
        </div>
      )}

      {!chargement && rapport && rapport.employes.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-left">
                  <th className="px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Salarié</th>
                  <th className="px-3 py-3 font-semibold text-gray-600 text-right whitespace-nowrap">Travaillées</th>
                  <th className="px-3 py-3 font-semibold text-gray-600 text-right whitespace-nowrap">Jours</th>
                  <th className="px-3 py-3 font-semibold text-gray-600 text-right whitespace-nowrap">CP</th>
                  <th className="px-3 py-3 font-semibold text-gray-600 text-right whitespace-nowrap">Maladie</th>
                  <th className="px-3 py-3 font-semibold text-gray-600 text-right whitespace-nowrap">Payées</th>
                  <th className="px-3 py-3 font-semibold text-gray-600 text-right whitespace-nowrap">HS +25 %</th>
                  <th className="px-3 py-3 font-semibold text-gray-600 text-right whitespace-nowrap">HS +50 %</th>
                  <th className="px-3 py-3 font-semibold text-gray-600 text-right whitespace-nowrap">Manquantes</th>
                  <th className="px-3 py-3 font-semibold text-gray-600 text-right whitespace-nowrap">Dim.</th>
                  <th className="px-3 py-3 font-semibold text-gray-600 text-right whitespace-nowrap">Fériés</th>
                  <th className="px-3 py-3 w-8" />
                </tr>
              </thead>
              <tbody>
                {rapport.employes.map(l => (
                  <LigneSalarie
                    key={l.employee_id}
                    l={l}
                    ouvert={ouvert === l.employee_id}
                    basculer={() => setOuvert(o => (o === l.employee_id ? null : l.employee_id))}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/60 text-xs text-gray-500 leading-relaxed">
            « Payées » = heures travaillées + congés payés valorisés à un cinquième du contrat hebdomadaire.
            La période est faite de <strong className="font-semibold">semaines entières</strong> finissant le dimanche
            (dernier dimanche du mois) : aucune semaine n’est coupée, et le seuil légal des heures
            supplémentaires — hebdomadaire — n’est jamais scindé. Ouvrez une ligne pour voir le détail par semaine.
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Une ligne, et son détail hebdomadaire ──────────────────────────────────

function LigneSalarie({ l, ouvert, basculer }: { l: LigneEmploye; ouvert: boolean; basculer: () => void }) {
  const cell = 'px-3 py-3 text-right tabular-nums whitespace-nowrap'
  return (
    <>
      <tr
        onClick={basculer}
        className="border-b border-gray-100 hover:bg-gray-50/70 cursor-pointer"
      >
        <td className="px-4 py-3">
          <div className="font-semibold text-gray-900">{l.nom}</div>
          <div className="text-xs text-gray-400">
            {l.contrat} · {l.contractuel_hebdo} h/sem
            {l.sans_planning && <span className="text-amber-600 font-medium"> · aucun planning saisi</span>}
          </div>
        </td>
        <td className={`${cell} font-semibold text-gray-900`}>{h(l.heures_travaillees)}</td>
        <td className={`${cell} text-gray-500`}>{l.jours_travailles}</td>
        <td className={`${cell} text-gray-500`}>{l.jours_cp ? `${l.jours_cp} j · ${h(l.heures_cp)}` : '—'}</td>
        <td className={`${cell} text-gray-500`}>{l.jours_maladie ? `${l.jours_maladie} j` : '—'}</td>
        <td className={`${cell} font-semibold text-gray-900`}>{h(l.heures_payees)}</td>
        <td className={`${cell} ${l.hs25 ? 'text-gray-900 font-medium' : 'text-gray-300'}`}>{l.hs25 ? h(l.hs25) : '—'}</td>
        <td className={`${cell} ${l.hs50 ? 'text-gray-900 font-medium' : 'text-gray-300'}`}>{l.hs50 ? h(l.hs50) : '—'}</td>
        <td className={`${cell} ${l.heures_manquantes ? 'text-amber-700 font-semibold' : 'text-gray-300'}`}>
          {l.heures_manquantes ? `− ${h(l.heures_manquantes)}` : '—'}
        </td>
        <td className={`${cell} text-gray-500`}>{l.jours_dimanche ? `${l.jours_dimanche} j` : '—'}</td>
        <td className={`${cell} text-gray-500`}>{l.jours_ferie ? `${l.jours_ferie} j` : '—'}</td>
        <td className="px-3 py-3 text-gray-300">
          <ChevronDown className={`w-4 h-4 transition-transform ${ouvert ? 'rotate-180' : ''}`} />
        </td>
      </tr>

      {ouvert && (
        <tr className="bg-gray-50/50 border-b border-gray-100">
          <td colSpan={12} className="px-4 py-4">
            {l.semaines.length === 0 ? (
              <p className="text-sm text-gray-500">Aucune semaine de planning saisie sur ce mois.</p>
            ) : (
              <div className="space-y-1.5">
                {l.semaines.map(s => (
                  <div key={`${s.year}-${s.week}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="font-semibold text-gray-900 w-20">S{s.week}</span>
                    <span className="inline-flex items-center gap-1 text-xs text-gray-400 w-20">
                      {s.figee ? <><Lock className="w-3 h-3" /> figée</> : <><LockOpen className="w-3 h-3" /> libre</>}
                    </span>
                    <span className="text-gray-600 tabular-nums">
                      {h(s.heures_travaillees)} h travaillées / {s.contractuel} h
                    </span>
                    <span className={`tabular-nums font-medium ${s.ecart > 0 ? 'text-gray-900' : s.ecart < 0 ? 'text-amber-700' : 'text-gray-300'}`}>
                      {s.ecart > 0 ? `+ ${h(s.ecart)}` : s.ecart < 0 ? `− ${h(-s.ecart)}` : '±0'}
                    </span>
                    {(s.hs25 > 0 || s.hs50 > 0) && (
                      <span className="text-xs text-gray-500">
                        {s.hs25 > 0 && `${h(s.hs25)} h à +25 %`}
                        {s.hs25 > 0 && s.hs50 > 0 && ' · '}
                        {s.hs50 > 0 && `${h(s.hs50)} h à +50 %`}
                      </span>
                    )}
                    {s.aCheval && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${s.rattachee ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                        à cheval — heures sup. {s.rattachee ? 'comptées ici' : 'comptées au mois voisin'}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
