'use client'

// LA SEMAINE LUE PAR POSTE — l'autre onglet du planning.
//
// Même partage des rôles que la mercuriale et les fiches : `page.tsx` garde
// l'état et les gestes, ce fichier garde le dessin. Il ne fetch rien, ne pose
// aucun état persistant, et ne modifie jamais le planning : c'est une LECTURE.
//
// Ce qu'on reprend de Skello, relevé sur le planning réel de la boucherie :
//   · une ligne par poste, avec sa pastille de couleur ;
//   · le NOM de la personne dans la cellule, sous l'horaire ;
//   · sous chaque jour, la couverture — « 1 pers. · 7h00 » ;
//   · le total du poste sur la semaine, à droite.
//
// Ce qu'on ne reprend PAS : sa palette, ses sélecteurs en bout de cellule. Le
// planning PILOTE reste navy/orange, et il garde ce que Skello n'a pas — le
// coût. La vue par poste répond à « mon rayon est-il couvert ? » ; la vue par
// employé, à « qui travaille, et combien ça coûte ». Les deux, pas l'une.

import { AlertTriangle } from 'lucide-react'
import type { LignePoste } from '@/lib/planning-postes'

const JOURS_COURTS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

/** « 9.5 » → « 9h30 » ; « 0 » → « 0h00 ». Même écriture que la vue employés. */
export function fmtHeures(h: number): string {
  const total = Math.round(h * 60)
  const heures = Math.floor(total / 60)
  const minutes = total % 60
  return `${heures}h${String(minutes).padStart(2, '0')}`
}

export default function VuePostes({
  lignes, libelles, couleurs, joursDates, jourActifIdx, totalSemaine,
}: {
  /** Une entrée par poste, dans l'ordre voulu — y compris les postes à 0 h */
  lignes: LignePoste[]
  /** clé de poste → libellé lisible (« boucherie » → « Boucherie ») */
  libelles: Record<string, string>
  /** clé de poste → classes Tailwind de sa pastille */
  couleurs: Record<string, string>
  /** Les 7 dates de la semaine, pour l'en-tête */
  joursDates: { jour: number; mois: string }[]
  /** Index du jour d'aujourd'hui dans la semaine, ou -1 */
  jourActifIdx: number
  /** Total des heures planifiées, tous postes confondus */
  totalSemaine: number
}) {
  const nonCouverts = lignes.filter(l => l.vide)

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
      {/* Ce que cette vue apprend, et qu'on ne voyait pas autrement. Un rayon
          jamais couvert de la semaine est un trou dans le magasin, pas une
          ligne vide dans un tableau. */}
      {nonCouverts.length > 0 && (
        <div className="px-5 py-3 border-b border-amber-100 bg-amber-50/60 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] leading-relaxed text-amber-800">
            <strong>{nonCouverts.length} poste{nonCouverts.length > 1 ? 's' : ''} sans personne cette semaine</strong>
            {' — '}
            {nonCouverts.map(l => libelles[l.poste] ?? l.poste).join(', ')}.
            {' '}Si c&apos;est normal (rayon fermé, activité saisonnière), il n&apos;y a rien à faire ;
            sinon, il manque quelqu&apos;un.
          </p>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 w-44">Poste</th>
              {JOURS_COURTS.map((j, i) => (
                <th key={j} className={`px-2 py-3 text-center text-[11px] font-semibold uppercase tracking-wider ${i === jourActifIdx ? 'text-pilote' : 'text-gray-400'}`}>
                  <span className="block">{j}</span>
                  <span className={`block text-sm font-extrabold tabular ${i === jourActifIdx ? 'text-pilote' : 'text-gray-600'}`}>
                    {joursDates[i]?.jour ?? ''}
                  </span>
                  <span className="block text-[10px] font-normal normal-case text-gray-400">{joursDates[i]?.mois ?? ''}</span>
                </th>
              ))}
              <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-400 w-24">Total</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map(ligne => (
              <tr key={ligne.poste} className={`border-t border-gray-100 align-top ${ligne.vide ? 'bg-gray-50/40' : ''}`}>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-2">
                    <span className={`text-[10px] font-semibold uppercase tracking-wider rounded-full px-2 py-0.5 whitespace-nowrap ${couleurs[ligne.poste] ?? 'bg-gray-100 text-gray-600'}`}>
                      {libelles[ligne.poste] ?? ligne.poste}
                    </span>
                  </span>
                </td>

                {ligne.jours.map((j, i) => (
                  <td key={j.jour} className={`px-2 py-2 align-top ${i === jourActifIdx ? 'bg-pilote-50/40' : ''}`}>
                    <div className="space-y-1">
                      {j.creneaux.map((c, k) => (
                        <div key={`${c.employe_id}-${c.moment}-${k}`}
                          title={c.partage
                            ? `${c.employe_nom} — créneau partagé entre plusieurs postes : ${fmtHeures(c.heures)} imputées ici`
                            : `${c.employe_nom} — ${fmtHeures(c.heures)}`}
                          className={`rounded-lg px-2 py-1 text-left ${couleurs[ligne.poste] ?? 'bg-gray-100 text-gray-600'}`}>
                          <p className="text-[10px] font-bold tabular leading-tight">
                            {c.debut && c.fin ? `${c.debut} – ${c.fin}` : fmtHeures(c.heures)}
                            {/* Un créneau partagé ne donne pas toutes ses heures
                                à ce poste : le dire évite de lire « 4 h de
                                boucherie » là où il y en a deux. */}
                            {c.partage && <span className="ml-1 font-semibold opacity-70">· {fmtHeures(c.heures)}</span>}
                          </p>
                          <p className="text-[10px] leading-tight truncate opacity-80">{c.employe_nom}</p>
                        </div>
                      ))}
                    </div>
                    {/* La COUVERTURE du jour — le chiffre pour lequel cette vue
                        existe. Écrit même à zéro : un « 0 pers. » se remarque,
                        une cellule vide ne dit rien. */}
                    <p className={`mt-1 text-[10px] tabular text-center ${j.personnes === 0 ? 'text-gray-300' : 'text-gray-500'}`}>
                      {j.personnes} pers. · {fmtHeures(j.heures)}
                    </p>
                  </td>
                ))}

                <td className="px-4 py-3 text-right">
                  <span className={`text-sm font-extrabold tabular ${ligne.vide ? 'text-gray-300' : 'text-gray-900'}`}>
                    {fmtHeures(ligne.heures_semaine)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-200 bg-gray-50">
              <td className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500">Toutes activités</td>
              {lignes[0]?.jours.map((_, i) => {
                const heuresJour = lignes.reduce((s, l) => s + l.jours[i].heures, 0)
                const gens = new Set(lignes.flatMap(l => l.jours[i].creneaux.map(c => c.employe_id))).size
                return (
                  <td key={i} className="px-2 py-3 text-center">
                    <span className="block text-xs font-bold tabular text-gray-700">{fmtHeures(heuresJour)}</span>
                    <span className="block text-[10px] text-gray-400">{gens} pers.</span>
                  </td>
                )
              })}
              <td className="px-4 py-3 text-right text-sm font-extrabold tabular text-gray-900">{fmtHeures(totalSemaine)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* La règle de partage, écrite une fois sous le tableau plutôt que
          répétée sur chaque cellule. */}
      <div className="px-5 py-2.5 border-t border-gray-100 bg-gray-50/60">
        <p className="text-[10px] text-gray-400 leading-relaxed">
          Un créneau qui sert plusieurs postes partage ses heures à parts égales entre eux — le total
          de cette vue est donc exactement celui des heures travaillées, sans double compte.
          Congés, arrêts et repos n&apos;occupent aucun poste.
        </p>
      </div>
    </div>
  )
}
