'use client'

/**
 * TRÉSORERIE — l'écran du bas du schéma : encaissements, décaissements, solde.
 *
 * ─── CE QUE CET ÉCRAN PROMET, ET CE QU'IL NE PROMET PAS ───────────────────
 *
 * Il ne montre PAS un solde de compte bancaire, et il le dit en toutes lettres,
 * à côté du chiffre, en permanence. Trois raisons, toutes portées par le moteur
 * (`lib/tresorerie`) et rendues ici sans être reformulées :
 *
 *   · les SALAIRES n'y sont pas — le planning reste hors trésorerie, c'est un
 *     choix du client, et c'est une des plus grosses sorties de la semaine :
 *     le solde est structurellement optimiste ;
 *   · aucune facture n'est jamais marquée réglée, donc une échéance passée est
 *     une échéance DUE, pas une sortie constatée ;
 *   · sans relevé bancaire il n'y a pas de solde d'ouverture : ce qu'on lit est
 *     une VARIATION cumulée.
 *
 * La phrase de réserve vient de `phraseReserves()`, calculée dans le moteur.
 * Elle n'est pas réécrite ici : une réserve recopiée est une réserve qui finit
 * par diverger de celle du PDF ou de l'API.
 *
 * ─── LA HIÉRARCHIE ────────────────────────────────────────────────────────
 *
 * Un seul chiffre-roi : le solde de la fenêtre. Un seul orange, et seulement
 * s'il y a un geste à faire : les échéances passées et dues. S'il n'y en a pas,
 * il n'y a pas d'orange à l'écran — cette absence est une information.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Wallet, ArrowDownRight, ArrowUpRight, RefreshCw, ExternalLink } from 'lucide-react'
import { TuileRoi, Tuile, TuileAlerte, TitreCarte, Absent } from '@/components/ui/da'

// ── Types de la réponse d'API ──────────────────────────────────────────────
type Jour = {
  jour: string
  encaissements: number
  decaissements: number
  mouvement: number
  solde: number
  entreesInconnues: boolean
}
type Sortie = {
  jour: string
  montant: number
  libelle: string
  factureId: string
  chargeFixe: boolean
  enRetard: boolean
}
type NonDatee = { factureId: string; libelle: string; montant: number; motif: string }
type Bilan = {
  fenetre: { debut: string; fin: string }
  jours: Jour[]
  totalEncaissements: number
  totalDecaissements: number
  variation: number
  soldeOuverture: number
  soldeCloture: number
  sorties: Sortie[]
  reserves: {
    salairesAbsents: true
    reglementsInconnus: boolean
    enRetard: { nombre: number; montant: number }
    nonDatees: NonDatee[]
    montantNonDate: number
    joursSansReleve: string[]
    provisionRecurrentes: number
  }
  phrase_reserves: string | null
  lecture_incomplete: boolean
  releves_multi_jours: { nombre: number; ca_ttc: number }
  journees_au_ca: number
}

// ── Formats ────────────────────────────────────────────────────────────────
const eur2 = (n: number) =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

const JOURS_COURTS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']

function libelleJour(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  return `${JOURS_COURTS[d.getUTCDay()]} ${d.getUTCDate()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const isoDuJour = (decalageJours: number) =>
  new Date(Date.now() + decalageJours * 86400000).toISOString().slice(0, 10)

/** Les fenêtres proposées. « Avant » compte des jours déjà passés : la
 *  trésorerie se lit autant en arrière (ce qui est rentré) qu'en avant (ce qui
 *  va sortir). */
const FENETRES = [
  { cle: '7-21', label: '4 semaines', avant: 7, apres: 21 },
  { cle: '14-45', label: '2 mois', avant: 14, apres: 45 },
  { cle: '30-90', label: '4 mois', avant: 30, apres: 90 },
] as const

/** Échéances montrées d'emblée. Au-delà, le nombre restant est écrit et un
 *  bouton déplie le reste : une troncature muette se lit comme une liste
 *  complète. */
const PLAFOND_ECHEANCES = 12

const MOTIFS: Record<string, string> = {
  sans_echeance: 'aucune échéance sur le document',
  hors_fenetre: 'échéance hors de la fenêtre',
}

export default function TresoreriePage() {
  const [fenetre, setFenetre] = useState<(typeof FENETRES)[number]['cle']>('7-21')
  const [bilan, setBilan] = useState<Bilan | null>(null)
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)

  const charger = useCallback(async () => {
    const f = FENETRES.find(x => x.cle === fenetre)!
    setChargement(true)
    setErreur(null)
    try {
      const r = await fetch(`/api/tresorerie?debut=${isoDuJour(-f.avant)}&fin=${isoDuJour(f.apres)}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Lecture impossible')
      setBilan(j as Bilan)
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Lecture impossible')
      setBilan(null)
    } finally {
      setChargement(false)
    }
  }, [fenetre])

  useEffect(() => { void charger() }, [charger])

  const aujourdHui = useMemo(() => isoDuJour(0), [])

  // Amplitude des mouvements, pour dessiner les barres du tableau. Une échelle
  // commune aux entrées ET aux sorties : deux échelles séparées feraient
  // paraître un petit encaissement aussi gros qu'un gros décaissement.
  const maxMouvement = useMemo(() => {
    if (!bilan) return 0
    return bilan.jours.reduce((m, j) => Math.max(m, j.encaissements, j.decaissements), 0)
  }, [bilan])

  // AUCUN relevé du tout : distinct de « zéro encaissé ». Tant que la boutique
  // n'a transféré aucun relevé, la trésorerie n'a pas d'entrées à montrer, et
  // le dire est plus utile que d'afficher un zéro.
  const aucunReleve = useMemo(
    () => !!bilan && bilan.totalEncaissements === 0 && bilan.jours.every(j => j.encaissements === 0),
    [bilan],
  )

  const prochainesSorties = useMemo(() => {
    if (!bilan) return []
    return [...bilan.sorties].sort((a, b) => a.jour.localeCompare(b.jour) || b.montant - a.montant)
  }, [bilan])

  // PLAFOND D'AFFICHAGE. Quarante-neuf échéances déroulaient une colonne cinq
  // fois plus haute que sa voisine : la carte « Hors de la courbe » se
  // retrouvait perdue dans le vide, et personne ne lit la trente-huitième
  // ligne. On en montre douze — et, règle de la maison, on écrit combien on
  // n'affiche pas. Le total, lui, porte toujours sur la totalité.
  const [toutesEcheances, setToutesEcheances] = useState(false)
  const echeancesVisibles = toutesEcheances ? prochainesSorties : prochainesSorties.slice(0, PLAFOND_ECHEANCES)

  return (
    <div className="space-y-6 pb-24">
      {/* ── En-tête ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-encre-fort">Trésorerie</h1>
          <p className="mt-1 text-sm text-encre-doux">
            Ce qui rentre, ce qui sort, jour par jour.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-gray-100 bg-white p-1 shadow-card" role="group" aria-label="Fenêtre affichée">
            {FENETRES.map(f => (
              <button
                key={f.cle}
                onClick={() => setFenetre(f.cle)}
                aria-pressed={fenetre === f.cle}
                className={`min-h-[44px] whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-pilote-200 ${
                  fenetre === f.cle ? 'bg-pilote text-white' : 'text-encre-doux hover:bg-gray-50'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => void charger()}
            aria-label="Recharger la trésorerie"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-gray-100 bg-white text-encre-doux shadow-card transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-pilote-200"
          >
            <RefreshCw className={`h-4 w-4 ${chargement ? 'animate-spin' : ''}`} strokeWidth={2} />
          </button>
        </div>
      </div>

      {erreur && (
        <div className="rounded-2xl border border-gray-100 bg-white p-5 text-sm text-etat-perte shadow-card">
          {erreur}
        </div>
      )}

      {chargement && !bilan && (
        <div className="rounded-2xl border border-gray-100 bg-white p-5 text-sm text-encre-doux shadow-card">
          Lecture en cours…
        </div>
      )}

      {bilan && (
        <>
          {/* ── CE QUE CE SOLDE N'EST PAS ─────────────────────────────────
              Placé AVANT les chiffres, volontairement : lire « 4 711 € » puis
              découvrir en bas de page que les salaires n'y sont pas, c'est
              avoir cru une minute à un chiffre faux. */}
          {bilan.phrase_reserves && (
            <div className="rounded-2xl border border-gray-100 bg-pilote-50 p-4 shadow-card">
              <p className="text-sm font-semibold leading-relaxed text-encre">
                {bilan.phrase_reserves}
              </p>
              <p className="mt-1 text-xs text-encre-doux">
                Les salaires seront comptés le jour où le planning entrera dans la trésorerie.
                Une facture ne peut pas encore être marquée réglée : les échéances passées
                restent donc affichées comme dues.
              </p>
            </div>
          )}

          {bilan.lecture_incomplete && (
            <div className="rounded-2xl border-t-[3px] border-etat-attente bg-white p-4 shadow-card">
              <p className="text-sm font-semibold text-etat-attente">
                Lecture incomplète — tous les mouvements de la période ne sont pas dans ce total.
              </p>
            </div>
          )}

          {/* ── Les chiffres ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <TuileRoi
              label="Solde de la période"
              valeur={eur2(bilan.soldeCloture)}
              detail={`variation du ${libelleJour(bilan.fenetre.debut)} au ${libelleJour(bilan.fenetre.fin)}`}
            />
            {/* « 0,00 € » et « aucun relevé reçu » ne sont pas la même chose.
                Vu à l'écran le premier jour : la tuile affichait un zéro massif
                là où la table est simplement vide — un chiffre là où il n'y a
                pas de donnée, exactement ce que la maison s'interdit. */}
            <Tuile
              label="Encaissé"
              valeur={
                aucunReleve
                  ? <Absent
                      raison="aucun relevé"
                      explication="Aucun relevé de caisse n’est encore arrivé : ce n’est pas zéro euro encaissé."
                    />
                  : eur2(bilan.totalEncaissements)
              }
              detail={
                aucunReleve
                  ? 'transférez le relevé financier à l’adresse de la boutique'
                  : bilan.reserves.joursSansReleve.length > 0
                    ? `${bilan.reserves.joursSansReleve.length} journée(s) sans relevé de caisse`
                    : 'relevés de caisse reçus'
              }
            />
            <Tuile
              label="Décaissé"
              valeur={eur2(bilan.totalDecaissements)}
              detail={`${bilan.sorties.length} échéance(s) de facture`}
            />
            {bilan.reserves.enRetard.nombre > 0 ? (
              <TuileAlerte
                label="Échéances passées et dues"
                valeur={eur2(bilan.reserves.enRetard.montant)}
                action={`${bilan.reserves.enRetard.nombre} facture(s) à régler ou à pointer`}
                href="/dashboard/facturation"
              />
            ) : (
              <Tuile
                label="Charges récurrentes"
                valeur={eur2(bilan.reserves.provisionRecurrentes)}
                detail="provisionnées sur la période, hors courbe"
              />
            )}
          </div>

          {/* ── Le fil des jours ─────────────────────────────────────────── */}
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-card">
            <TitreCarte
              action={
                <span className="text-[11px] font-semibold text-encre-faible">
                  {bilan.jours.length} jours
                </span>
              }
            >
              Jour par jour
            </TitreCarte>

            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-[11px] font-semibold uppercase tracking-wider text-encre-faible">
                    <th className="px-5 py-2 text-left font-semibold">Jour</th>
                    <th className="px-3 py-2 text-right font-semibold">Encaissé</th>
                    <th className="px-3 py-2 text-right font-semibold">Décaissé</th>
                    <th className="px-3 py-2 text-left font-semibold">Mouvement</th>
                    <th className="px-5 py-2 text-right font-semibold">Solde cumulé</th>
                  </tr>
                </thead>
                <tbody>
                  {bilan.jours.map(j => {
                    const cejour = j.jour === aujourdHui
                    const futur = j.jour > aujourdHui
                    const largeurE = maxMouvement > 0 ? (j.encaissements / maxMouvement) * 100 : 0
                    const largeurD = maxMouvement > 0 ? (j.decaissements / maxMouvement) * 100 : 0
                    return (
                      <tr
                        key={j.jour}
                        className={`border-t border-gray-100 transition-colors hover:bg-gray-50 ${
                          cejour ? 'bg-pilote-50/60' : ''
                        }`}
                      >
                        <td className="whitespace-nowrap px-5 py-2 text-sm">
                          <span className={cejour ? 'font-bold text-pilote' : 'font-medium text-encre'}>
                            {libelleJour(j.jour)}
                          </span>
                          {cejour && (
                            <span className="ml-2 rounded-md bg-pilote px-1.5 py-0.5 text-[11px] font-bold text-white">
                              aujourd’hui
                            </span>
                          )}
                        </td>

                        <td className="whitespace-nowrap px-3 py-2 text-right text-sm tabular">
                          {j.entreesInconnues ? (
                            <Absent
                              raison="sans relevé"
                              explication="Aucun relevé de caisse reçu pour cette journée : ce n’est pas une journée sans vente."
                            />
                          ) : j.encaissements > 0 ? (
                            <span className="font-semibold text-etat-gain">{eur2(j.encaissements)}</span>
                          ) : futur ? (
                            <Absent raison="à venir" explication="Journée non commencée." />
                          ) : (
                            <span className="text-trait">—</span>
                          )}
                        </td>

                        <td className="whitespace-nowrap px-3 py-2 text-right text-sm tabular">
                          {j.decaissements > 0
                            ? <span className="font-semibold text-etat-perte">{eur2(j.decaissements)}</span>
                            : <span className="text-trait">—</span>}
                        </td>

                        {/* La barre ne porte aucune information seule : les deux
                            montants sont écrits dans les colonnes voisines. */}
                        <td className="px-3 py-2" aria-hidden>
                          <div className="flex h-2 items-center gap-px">
                            <div className="flex h-2 w-1/2 justify-end">
                              <div className="h-2 rounded-l-sm bg-rayon-boucherie/70" style={{ width: `${largeurD}%` }} />
                            </div>
                            <div className="flex h-2 w-1/2 justify-start">
                              <div className="h-2 rounded-r-sm bg-pilote/70" style={{ width: `${largeurE}%` }} />
                            </div>
                          </div>
                        </td>

                        <td className="whitespace-nowrap px-5 py-2 text-right text-sm font-bold tabular text-encre-fort">
                          {eur2(j.solde)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* ── Les échéances ─────────────────────────────────────────── */}
            <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-card">
              <TitreCarte
                action={
                  <Link
                    href="/dashboard/facturation"
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-pilote hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-pilote-200"
                  >
                    Facturation <ExternalLink className="h-3 w-3" aria-hidden />
                  </Link>
                }
              >
                Échéances de la période
              </TitreCarte>

              {prochainesSorties.length === 0 ? (
                <p className="py-6 text-center text-sm text-encre-doux">
                  Aucune échéance de facture sur cette fenêtre.
                </p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {echeancesVisibles.map(s => (
                    <li key={s.factureId} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-encre">{s.libelle}</p>
                        <p className="text-xs text-encre-faible">
                          {libelleJour(s.jour)}
                          {s.chargeFixe && ' · charge de structure'}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {/* UN AVOIR N'EST PAS UNE SORTIE. Il porte un montant
                            négatif : l'afficher « échue » en rouge comme une
                            facture à payer inverse son sens. Vu à l'écran sur
                            un avoir PLUXEE de −268,34 €. */}
                        {s.montant < 0 ? (
                          <span className="whitespace-nowrap rounded-md bg-etat-gain/10 px-1.5 py-0.5 text-[11px] font-bold text-etat-gain">
                            avoir
                          </span>
                        ) : s.enRetard ? (
                          <span className="whitespace-nowrap rounded-md bg-pilote-orange/[0.12] px-1.5 py-0.5 text-[11px] font-bold text-[#9A4A00]">
                            échue
                          </span>
                        ) : null}
                        <span className={`whitespace-nowrap text-sm font-bold tabular ${s.montant < 0 ? 'text-etat-gain' : 'text-encre-fort'}`}>
                          {eur2(s.montant)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {prochainesSorties.length > PLAFOND_ECHEANCES && (
                <button
                  onClick={() => setToutesEcheances(v => !v)}
                  className="mt-3 min-h-[44px] w-full rounded-xl border border-pilote-200 bg-white px-4 text-sm font-semibold text-pilote transition-colors hover:bg-pilote-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-pilote-200"
                >
                  {toutesEcheances
                    ? `Réduire — ${prochainesSorties.length} échéances au total`
                    : `Afficher les ${prochainesSorties.length - PLAFOND_ECHEANCES} autres échéances`}
                </button>
              )}
            </div>

            {/* ── CE QUI N'EST PAS DANS LA COURBE ───────────────────────── */}
            <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-card">
              <TitreCarte>Hors de la courbe</TitreCarte>
              <p className="mb-3 text-xs text-encre-doux">
                Rien de tout cela n’est perdu : ces montants existent, mais on ne peut pas
                les poser sur un jour sans inventer une date.
              </p>

              <ul className="space-y-2 text-sm">
                <li className="flex items-start justify-between gap-3 border-b border-gray-100 pb-2">
                  <span className="text-encre">
                    Charges récurrentes provisionnées
                    <span className="block text-xs text-encre-faible">
                      une provision dit combien coûte une période, pas quel jour l’argent part
                    </span>
                  </span>
                  <span className="whitespace-nowrap font-bold tabular text-encre-fort">
                    {eur2(bilan.reserves.provisionRecurrentes)}
                  </span>
                </li>

                <li className="flex items-start justify-between gap-3 border-b border-gray-100 pb-2">
                  <span className="text-encre">
                    Factures sans échéance exploitable
                    <span className="block text-xs text-encre-faible">
                      {bilan.reserves.nonDatees.length === 0
                        ? 'aucune'
                        : bilan.reserves.nonDatees
                            .slice(0, 3)
                            .map(n => `${n.libelle} (${MOTIFS[n.motif] ?? n.motif})`)
                            .join(' · ')}
                      {bilan.reserves.nonDatees.length > 3 &&
                        ` · et ${bilan.reserves.nonDatees.length - 3} autre(s)`}
                    </span>
                  </span>
                  <span className="whitespace-nowrap font-bold tabular text-encre-fort">
                    {eur2(bilan.reserves.montantNonDate)}
                  </span>
                </li>

                <li className="flex items-start justify-between gap-3 border-b border-gray-100 pb-2">
                  <span className="text-encre">
                    Relevés de caisse sur plusieurs jours
                    <span className="block text-xs text-encre-faible">
                      comptés à part : une semaine ne se répartit pas en sept journées
                    </span>
                  </span>
                  <span className="whitespace-nowrap font-bold tabular text-encre-fort">
                    {bilan.releves_multi_jours.nombre === 0
                      ? '—'
                      : `${bilan.releves_multi_jours.nombre} · ${eur2(bilan.releves_multi_jours.ca_ttc)}`}
                  </span>
                </li>

                <li className="flex items-start justify-between gap-3">
                  <span className="text-encre">
                    Salaires
                    <span className="block text-xs text-encre-faible">
                      hors trésorerie pour l’instant — le solde est optimiste d’autant
                    </span>
                  </span>
                  <span className="whitespace-nowrap">
                    <Absent
                      raison="non comptés"
                      explication="Le planning reste hors trésorerie. Le moteur de paie existe : les brancher ne change rien d’autre."
                    />
                  </span>
                </li>
              </ul>

              {bilan.journees_au_ca > 0 && (
                <p className="mt-3 rounded-xl bg-gray-50 p-3 text-xs text-encre-doux">
                  <span className="font-semibold text-encre">
                    {bilan.journees_au_ca} journée(s) comptée(s) au chiffre d’affaires
                  </span>{' '}
                  faute d’encaissé confirmé sur le relevé. Leur montant est surestimé de ce
                  qui est parti en compte client.
                </p>
              )}
            </div>
          </div>

          {/* ── Repère de lecture ───────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1 text-xs text-encre-doux">
            <span className="inline-flex items-center gap-1.5">
              <ArrowUpRight className="h-3.5 w-3.5 text-etat-gain" aria-hidden /> Encaissé : relevés de caisse
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ArrowDownRight className="h-3.5 w-3.5 text-etat-perte" aria-hidden /> Décaissé : échéances de factures, TTC
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Wallet className="h-3.5 w-3.5 text-encre-faible" aria-hidden /> Solde : variation cumulée, pas un solde de compte
            </span>
          </div>
        </>
      )}
    </div>
  )
}
