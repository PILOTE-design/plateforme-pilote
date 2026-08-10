'use client'

// Les trois onglets d'AFFICHAGE de la fiche recette — Infos, Vente,
// Statistiques — extraits de fiche-panel.tsx tels quels (lot de découpe,
// aucun changement de comportement). Aucun état ici, hormis `series` que le
// panneau possède et passe avec son setter : chaque composant reçoit dans `p`
// les valeurs que fiche-panel calcule déjà. Les onglets Ingrédients et
// Fabrication, eux, portent l'état d'édition — ils restent dans le panneau.

import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { AlertTriangle, Pencil, Users } from 'lucide-react'
import { ALLERGENES, parseAllergenes, labelAllergene, type AllergeneId } from '@/lib/allergenes'
import { useToast } from '@/components/ui/toast'
import { facteurPerte } from '@/lib/recipes'
import {
  GrapheCouts, TrendSpark,
  fmtDateFr, fmtEuro, fmtQty, round2, unitFr, uniteAuPluriel,
  type FicheCost, type FicheFormat, type FichePoids, type FicheRecipe, type JalonCout, type SerieCout,
} from './fiche-ui'

type PropsInfos = {
  baseQty: number
  uniteLabel: string
  poids: FichePoids
  pertePct: number
  perteHt: number
  c: FicheCost
  formats: FicheFormat[]
  recipe: FicheRecipe
  employeeName: string | null
  /** Recharge la fiche après un enregistrement réussi (lot 125) */
  onSaved: () => void
}

type PropsVente = {
  actif: FicheFormat | null
  venteQty: number
  uniteVente: string
  pvHTActif: number | null
  tvaActive: number
  c: FicheCost
  pertePct: number
  perteHt: number
  matiereUnite: number | null
  moUnite: number | null
  margeBrute: number | null
  margeNette: number | null
  foodCostPct: number | null
  coutUnite: number | null
  coutIncomplet: boolean
  nomsSansPrix: string
  formats: FicheFormat[]
}

type PropsStats = {
  c: FicheCost
  baseQty: number
  venteQty: number
  coutUnite: number | null
  pvHTActif: number | null
  margeActive: number | null
  recipe: FicheRecipe
  jalonsGraphe: JalonCout[]
  uniteVente: string
  series: Record<SerieCout, boolean>
  setSeries: Dispatch<SetStateAction<Record<SerieCout, boolean>>>
  historiqueIncomplet: boolean
}

export function OngletInfos({ p }: { p: PropsInfos }) {
  return (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <div className="rounded-2xl border border-gray-100 overflow-hidden">
              <h3 className="px-4 py-2.5 bg-gray-50 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Ce que produit le batch</h3>
              <dl className="p-4 space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Production</dt>
                  <dd className="font-semibold text-gray-900 tabular text-right">{p.baseQty > 0 ? `${fmtQty(p.baseQty)} ${p.uniteLabel}` : <span className="text-gray-300">non renseignée</span>}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Poids à sortir &middot; net</dt>
                  <dd className="font-semibold text-gray-900 tabular text-right">
                    {p.poids.brut > 0
                      ? <>{fmtQty(round2(p.poids.brut * facteurPerte(p.pertePct) * 1000) / 1000)} kg <span className="font-normal text-gray-400">&middot; {fmtQty(p.poids.net)} kg net</span></>
                      : <span className="text-gray-300">aucune ligne pesable</span>}
                  </dd>
                </div>
                {p.pertePct > 0 && p.poids.brut > 0 && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-gray-500">dont perte de fabrication</dt>
                    <dd className="font-semibold text-amber-600 tabular text-right">{p.pertePct.toLocaleString('fr-FR')} % &middot; {fmtEuro(p.perteHt)}</dd>
                  </div>
                )}
                {/* Le coût AU KILO se rapporte au poids NET — ce qui sort de
                    l'atelier, pas ce qu'on a sorti du frigo. Il n'existe que si
                    la fiche a des lignes pesables : sinon, tiret. */}
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Coût au kg <span className="text-gray-400">(net)</span></dt>
                  <dd className="font-semibold text-gray-900 tabular text-right">{p.c && p.poids.net > 0 ? fmtEuro(round2(p.c.total_ht / p.poids.net)) : <span className="text-gray-300">&mdash;</span>}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Formats de vente</dt>
                  <dd className="font-semibold text-gray-900 tabular text-right">{p.formats.length}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Catégorie</dt>
                  <dd className="text-right">
                    {p.recipe.category
                      ? <span className="text-[10px] font-semibold uppercase tracking-wider text-pilote bg-pilote-50 ring-1 ring-pilote-100 rounded-full px-2.5 py-1">{p.recipe.category}</span>
                      : <span className="text-gray-300 text-sm">sans catégorie</span>}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="rounded-2xl border border-gray-100 overflow-hidden">
              <h3 className="px-4 py-2.5 bg-gray-50 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Qui fabrique, et notes</h3>
              <div className="p-4 space-y-3 text-sm">
                <p className="flex items-center gap-1.5 text-gray-600">
                  <Users className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                  Fabriqué par <span className="font-semibold text-gray-900">{p.employeeName ?? 'taux moyen de l’équipe'}</span>
                  {p.c?.labor_rate_ht != null && <span className="tabular text-gray-400">&middot; {fmtEuro(p.c.labor_rate_ht)}/h productif</span>}
                </p>
                <p className="text-[11px] text-gray-400">
                  Le taux productif est celui de l&rsquo;heure réellement TRAVAILLÉE (congés, RCR et fériés déduits) — pas de l&rsquo;heure payée.
                </p>
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Notes</p>
                  <p className="text-sm text-gray-700">{p.recipe.notes || <span className="text-gray-300">aucune note</span>}</p>
                </div>
                <p className="text-[11px] text-gray-400 pt-1 border-t border-gray-100">
                  Nom, production, TVA, employé et ingrédients se modifient via &laquo;&nbsp;Modifier la fiche&nbsp;&raquo;.
                </p>
              </div>
            </div>

            {/* ── CONSERVATION ET ALLERGÈNES (lot 125) ─────────────────────
                Les deux seuls champs « Infos » que le boucher remplit
                réellement chez Otami (relevé du 06/08 : « 2 °C · 7 jours »
                renseignés, tout le reste vide). Édités ICI, sur la fiche —
                pas dans la modale de création, que le lot 117 vient justement
                d'alléger. Et imprimés sur la fiche atelier : c'est au
                laboratoire qu'ils servent. */}
            <CarteConservation recipe={p.recipe} onSaved={p.onSaved} />
            <CarteAllergenes recipe={p.recipe} onSaved={p.onSaved} />
          </div>
  )
}

/** Conservation — température et durée, éditées sur place. */
function CarteConservation({ recipe, onSaved }: { recipe: FicheRecipe; onSaved: () => void }) {
  const { toast } = useToast()
  const [edit, setEdit] = useState<{ temp: string; jours: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const temp = typeof recipe.storage_temp_c === 'number' ? recipe.storage_temp_c : null
  const jours = typeof recipe.storage_days === 'number' ? recipe.storage_days : null

  async function enregistrer() {
    if (!edit || saving) return
    // Champ vide = effacé VOLONTAIREMENT (null) — distinct d'un champ absent,
    // qui ne serait pas envoyé du tout. C'est la règle de la route.
    const versNombre = (v: string) => {
      const t = v.trim().replace(',', '.')
      return t === '' ? null : parseFloat(t)
    }
    setSaving(true)
    const res = await fetch(`/api/recipes/${recipe.id}/infos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storage_temp_c: versNombre(edit.temp), storage_days: versNombre(edit.jours) }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    setSaving(false)
    if (res?.ok) { setEdit(null); onSaved() }
    else toast({ variant: 'error', title: data?.error || 'Enregistrement impossible', description: 'Réessayez.' })
  }

  return (
    <div className="rounded-2xl border border-gray-100 overflow-hidden">
      <div className="px-4 py-2.5 bg-gray-50 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Conservation</h3>
        {edit === null && (
          <button type="button" aria-label="Modifier la conservation"
            onClick={() => setEdit({ temp: temp !== null ? String(temp).replace('.', ',') : '', jours: jours !== null ? String(jours) : '' })}
            className="p-1 rounded-lg hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-pilote-200">
            <Pencil className="w-3.5 h-3.5 text-gray-500" />
          </button>
        )}
      </div>
      {edit === null ? (
        <dl className="p-4 space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500">Température</dt>
            <dd className="font-semibold text-gray-900 tabular text-right">
              {temp !== null ? `${temp.toLocaleString('fr-FR')} °C` : <span className="text-gray-300">non renseignée</span>}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500">Durée</dt>
            <dd className="font-semibold text-gray-900 tabular text-right">
              {jours !== null ? `${jours.toLocaleString('fr-FR')} jour${jours > 1 ? 's' : ''}` : <span className="text-gray-300">non renseignée</span>}
            </dd>
          </div>
          <p className="text-[11px] text-gray-400 pt-1 border-t border-gray-100">
            Imprimée sur la fiche atelier, avec les allergènes.
          </p>
        </dl>
      ) : (
        <div className="p-4 space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[11px] font-semibold text-gray-600 mb-1">Température (°C)</span>
              <input inputMode="decimal" value={edit.temp} placeholder="2"
                onChange={e => setEdit(p2 => (p2 ? { ...p2, temp: e.target.value } : p2))}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm text-right tabular focus:outline-none focus:ring-2 focus:ring-pilote-200" />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-gray-600 mb-1">Durée (jours)</span>
              <input inputMode="numeric" value={edit.jours} placeholder="7"
                onChange={e => setEdit(p2 => (p2 ? { ...p2, jours: e.target.value } : p2))}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm text-right tabular focus:outline-none focus:ring-2 focus:ring-pilote-200" />
            </label>
          </div>
          <p className="text-[11px] text-gray-500">Un champ laissé vide efface la valeur.</p>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setEdit(null)}
              className="text-xs font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 rounded-xl px-3 py-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-pilote-200">Annuler</button>
            <button type="button" onClick={enregistrer} disabled={saving}
              className="text-xs font-semibold text-white bg-pilote hover:bg-pilote-hover disabled:opacity-50 rounded-xl px-3 py-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-pilote-200">
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Allergènes — les quatorze de l'annexe II, cochés, jamais saisis. */
function CarteAllergenes({ recipe, onSaved }: { recipe: FicheRecipe; onSaved: () => void }) {
  const { toast } = useToast()
  const declares = parseAllergenes(recipe.allergens)
  const [edit, setEdit] = useState<Set<AllergeneId> | null>(null)
  const [saving, setSaving] = useState(false)

  async function enregistrer() {
    if (!edit || saving) return
    setSaving(true)
    const res = await fetch(`/api/recipes/${recipe.id}/infos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allergens: [...edit] }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    setSaving(false)
    if (res?.ok) { setEdit(null); onSaved() }
    else toast({ variant: 'error', title: data?.error || 'Enregistrement impossible', description: 'Réessayez.' })
  }

  return (
    <div className="rounded-2xl border border-gray-100 overflow-hidden lg:col-span-2">
      <div className="px-4 py-2.5 bg-gray-50 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
          Allergènes <span className="normal-case font-normal">— les 14 à déclaration obligatoire (vente en vrac)</span>
        </h3>
        {edit === null && (
          <button type="button" aria-label="Modifier les allergènes"
            onClick={() => setEdit(new Set(declares))}
            className="p-1 rounded-lg hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-pilote-200">
            <Pencil className="w-3.5 h-3.5 text-gray-500" />
          </button>
        )}
      </div>
      {edit === null ? (
        <div className="p-4">
          {declares.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {declares.map(id => (
                <span key={id} className="text-[11px] font-semibold text-amber-800 bg-amber-50 ring-1 ring-amber-200 rounded-full px-2.5 py-1">
                  {labelAllergene(id)}
                </span>
              ))}
            </div>
          ) : (
            /* « Aucun déclaré » n'est PAS « aucun » : personne n'a encore
               répondu à la question. La distinction s'imprime aussi sur la
               fiche atelier — sur une étiquette, le silence doit être un
               choix visible, jamais un oubli possible. */
            <p className="text-sm text-gray-500">Aucun allergène déclaré pour cette recette.</p>
          )}
        </div>
      ) : (
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
            {ALLERGENES.map(a2 => {
              const coche = edit.has(a2.id)
              return (
                <button key={a2.id} type="button" title={a2.detail ?? undefined}
                  onClick={() => setEdit(prev => {
                    if (!prev) return prev
                    const n = new Set(prev)
                    if (n.has(a2.id)) n.delete(a2.id); else n.add(a2.id)
                    return n
                  })}
                  className={`text-left text-xs font-semibold rounded-xl px-2.5 py-2 border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-pilote-200 ${coche ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  {coche ? '✓ ' : ''}{a2.label}
                </button>
              )
            })}
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setEdit(null)}
              className="text-xs font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 rounded-xl px-3 py-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-pilote-200">Annuler</button>
            <button type="button" onClick={enregistrer} disabled={saving}
              className="text-xs font-semibold text-white bg-pilote hover:bg-pilote-hover disabled:opacity-50 rounded-xl px-3 py-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-pilote-200">
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function OngletVente({ p }: { p: PropsVente }) {
  return (
          <div className="rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Ce que rapporte {p.actif ? `le format « ${p.actif.name} »` : 'la fiche'}
              </h3>
              <span className="text-[11px] text-gray-400 tabular">
                {p.venteQty > 0 ? `${fmtQty(p.venteQty)} ${uniteAuPluriel(p.venteQty, p.uniteVente)} vendables par batch` : 'quantité vendable non renseignée'}
              </span>
            </div>
            {/* Les deux marges du métier, PAR UNITÉ DE VENTE :
                  · marge BRUTE  = PV HT − matière (emballage compris) ;
                  · marge NETTE  = marge brute − main-d'œuvre.
                Elles ne sont PAS publiées tant qu'il manque un prix
                d'ingrédient : le coût serait sous-évalué et les deux marges
                flattées — même règle que le moteur. */}
            <dl className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Prix de vente HT</dt>
                <dd className="font-semibold text-gray-900 tabular">{p.pvHTActif !== null ? fmtEuro(p.pvHTActif) : <span className="text-gray-300">&mdash;</span>}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">TVA appliquée</dt>
                <dd className="font-semibold text-gray-900 tabular">{p.tvaActive.toLocaleString('fr-FR')} %</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Matière {p.c && p.c.emballage_ht > 0 ? '+ emballage' : ''}{p.pertePct > 0 ? ', perte comprise' : ''}</dt>
                <dd className="font-semibold text-gray-900 tabular">{p.matiereUnite !== null ? fmtEuro(p.matiereUnite) : <span className="text-gray-300">&mdash;</span>}</dd>
              </div>
              {p.pertePct > 0 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">dont perte de fabrication <span className="text-gray-400">({p.pertePct.toLocaleString('fr-FR')} %)</span></dt>
                  <dd className="font-semibold text-amber-600 tabular">{p.venteQty > 0 ? fmtEuro(round2(p.perteHt / p.venteQty)) : fmtEuro(p.perteHt)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Main-d&rsquo;œuvre</dt>
                <dd className="font-semibold text-gray-900 tabular">{p.moUnite !== null ? fmtEuro(p.moUnite) : <span className="text-gray-300">&mdash;</span>}</dd>
              </div>
              <div className="flex justify-between gap-3 pt-2 border-t border-gray-100">
                <dt className="text-gray-500">Marge brute <span className="text-gray-400">(hors main-d&rsquo;œuvre)</span></dt>
                <dd className="font-bold text-gray-900 tabular">{p.margeBrute !== null ? fmtEuro(p.margeBrute) : <span className="text-gray-300">&mdash;</span>}</dd>
              </div>
              <div className="flex justify-between gap-3 pt-2 border-t border-gray-100">
                <dt className="text-gray-500">Marge nette <span className="text-gray-400">(main-d&rsquo;œuvre déduite)</span></dt>
                <dd className={`font-bold tabular ${p.margeNette !== null && p.margeNette < 0 ? 'text-red-600' : 'text-gray-900'}`}>{p.margeNette !== null ? fmtEuro(p.margeNette) : <span className="text-gray-300">&mdash;</span>}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Coût matière dans le PV HT</dt>
                <dd className="font-semibold text-gray-900 tabular">{p.foodCostPct !== null ? `${p.foodCostPct} %` : <span className="text-gray-300">&mdash;</span>}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Coût de revient complet</dt>
                <dd className="font-semibold text-gray-900 tabular">{p.coutUnite !== null ? `${fmtEuro(p.coutUnite)} / ${p.uniteVente}` : <span className="text-gray-300">&mdash;</span>}</dd>
              </div>
            </dl>
            {p.coutIncomplet && (
              <p className="px-4 py-2.5 text-[11px] text-amber-700 bg-amber-50 border-t border-amber-100">
                {p.nomsSansPrix} sans prix : les marges ne sont pas calculées tant que le coût est sous-évalué — elles paraîtraient meilleures qu&rsquo;elles ne le sont.
              </p>
            )}
            {p.formats.length > 1 && (
              <p className="px-4 py-2 text-[11px] text-gray-400 border-t border-gray-100">
                Cette fiche a {p.formats.length} formats de vente : les chiffres ci-dessus sont ceux du format choisi en haut. La fabrication, elle, est commune.
              </p>
            )}
          </div>
  )
}

export function OngletStats({ p }: { p: PropsStats }) {
  return (
          <>
        {/* ── Coût matière dans le temps : la fiche relue aux prix d'hier ── */}
        {p.c && Array.isArray(p.c.matiere_series) && p.c.matiere_series.length >= 2 && (() => {
          const s = p.c.matiere_series
          const first = s[0], last = s[s.length - 1]
          const delta = round2(last.v - first.v)
          const stable = Math.abs(delta) < 0.005
          const deltaUnit = p.baseQty > 0 ? round2(delta / p.baseQty) : null
          // Marge qu'aurait la fiche au coût du début de période, à PV inchangé —
          // sur la base de VENTE (celle du PV), pas forcément l'unité produite.
          const coutVente = p.coutUnite
          const deltaVente = p.venteQty > 0 ? round2(delta / p.venteQty) : null
          let margeAvant: number | null = null
          if (!stable && p.pvHTActif !== null && p.pvHTActif > 0 && coutVente != null && deltaVente !== null) {
            margeAvant = Math.round(((p.pvHTActif - (coutVente - deltaVente)) / p.pvHTActif) * 1000) / 10
          }
          return (
            <div className="mb-4 rounded-2xl border border-gray-100 bg-gray-50/60 px-4 py-3 flex items-center gap-4 flex-wrap">
              <div className="min-w-[240px] flex-1">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Coût matière — 8 dernières semaines</p>
                <p className="text-xs text-gray-600 mt-1 tabular">
                  {stable ? (
                    <>Stable depuis le {fmtDateFr(first.d)} — {fmtEuro(last.v)} le batch, aux prix mercuriale relus à chaque date.</>
                  ) : (
                    <>
                      {fmtEuro(first.v)} le {fmtDateFr(first.d)} → {fmtEuro(last.v)} aujourd&apos;hui :{' '}
                      <span className={`font-bold ${delta > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {delta > 0 ? '+' : '−'}{fmtEuro(Math.abs(delta))} / batch
                        {deltaUnit !== null && Math.abs(deltaUnit) >= 0.005 ? ` (${delta > 0 ? '+' : '−'}${fmtEuro(Math.abs(deltaUnit))} / ${unitFr(p.recipe.yield_unit)})` : ''}
                      </span>
                      {margeAvant !== null && p.margeActive !== null && (
                        <> · à PV inchangé, marge <span className="font-bold tabular">{margeAvant.toLocaleString('fr-FR')} %</span> → <span className={`font-bold tabular ${delta > 0 ? 'text-red-600' : 'text-green-600'}`}>{p.margeActive.toLocaleString('fr-FR')} %</span></>
                      )}
                    </>
                  )}
                </p>
              </div>
              <TrendSpark points={s} />
            </div>
          )
        })()}

        {/* ── Le graphe : coût, prix de vente et marge superposés ──────────────
            Otami superpose les trois et annote chaque point. C'est ce qui
            transforme une courbe en réponse à « la rentabilité de ce produit
            se dégrade-t-elle ? » : un coût qui monte pendant qu'un prix reste
            plat se lit d'un coup d'œil. */}
        {p.jalonsGraphe.length >= 2 && (
          <div className="mb-4 rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 flex items-center justify-between gap-3 flex-wrap">
              <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Évolution du coût de revient</h3>
              <div className="flex items-center gap-1.5 flex-wrap">
                {([
                  { id: 'cout' as const, label: `Coût / ${p.uniteVente}`, actif: 'bg-pilote text-white' },
                  { id: 'pv' as const, label: 'Prix de vente HT', actif: 'bg-gray-600 text-white' },
                  { id: 'marge' as const, label: 'Taux de marge', actif: 'bg-pilote-orange text-white' },
                ]).map(s => {
                  const dispo = s.id === 'cout' || p.jalonsGraphe.some(j => (s.id === 'pv' ? j.pv : j.marge) !== null)
                  return (
                    <button key={s.id} disabled={!dispo}
                      onClick={() => p.setSeries(p => ({ ...p, [s.id]: !p[s.id] }))}
                      title={dispo ? undefined : 'Posez un prix de vente sur ce format pour lire cette courbe'}
                      className={`text-[11px] font-semibold rounded-full px-2.5 py-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${p.series[s.id] && dispo ? s.actif : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-100'}`}>
                      {s.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="px-2 pt-2">
              <GrapheCouts points={p.jalonsGraphe} series={p.series} uniteVente={p.uniteVente} />
            </div>
            {/* Ce que le graphe N'EST PAS. Otami date son axe des jours où un
                prix a changé ; ici ce sont des lundis. Le dire évite de lire
                « le prix a bougé ce jour-là » là où il n'y a qu'un jalon. */}
            <p className="px-4 py-2 text-[11px] text-gray-400 border-t border-gray-100">
              Un point par lundi des huit dernières semaines, plus aujourd&apos;hui — ce sont des jalons de lecture, pas les dates auxquelles un prix a changé.
              Le coût est relu aux prix mercuriale de chaque date ; le prix de vente et la main-d&apos;œuvre, eux, sont ceux d&apos;aujourd&apos;hui.
            </p>
          </div>
        )}

        {/* Courbe impossible à tracer : DIRE POURQUOI. Un bloc simplement absent
            se lit « le coût matière n'a pas bougé » — c'est l'inverse du sens. */}
        {p.c && (!Array.isArray(p.c.matiere_series) || p.c.matiere_series.length < 2) && p.c.matiere_series_motif && (
          <div className="mb-4 rounded-2xl border border-gray-100 bg-gray-50/60 px-4 py-3">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Coût matière — 8 dernières semaines</p>
            <p className="text-xs text-gray-500 mt-1">{p.c.matiere_series_motif}</p>
          </div>
        )}

        {/* Historique tronqué : la courbe est partielle, ou absente faute de
            points. Le silence donnerait à lire « le prix n'a pas bougé ». */}
        {p.historiqueIncomplet && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 flex items-start gap-2 text-xs text-amber-800">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>L&apos;historique des prix n&apos;a pas pu être lu en entier : la courbe du coût matière ci-dessus est partielle. Actualisez ; si le message persiste, signalez-le.</span>
          </div>
        )}
          </>
  )
}
