'use client'

// La MODALE de création / édition d'une fiche recette, sortie de ./page pour que
// le fichier reste publiable. Rien n'y est calculé : la page tient l'état, la
// modale l'affiche et le rend. Tout ce qu'elle consomme arrive par `m`.

import Link from 'next/link'
import { Plus, X, Search } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import type { Manque } from '@/lib/recettes-catalogue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ListeLigne } from './liste'
import type { Employee, Famille, Generic, IngredientDraft, Recipe } from './page'

/** Le formulaire de la modale — dix champs, tous en texte : la saisie garde ce
 *  qui a été tapé, la conversion en nombres se fait à l'enregistrement. */
export type FormFiche = {
  name: string; category: string
  yield_qty: string; yield_unit: string
  sell_unit: string; sell_qty: string
  labor_minutes: string; selling_price_ttc: string
  tva_rate: string; employee_id: string
}

/** L'aperçu du coût, calculé par la page à chaque frappe et seulement lu ici */
export type ApercuCout = {
  matiere: number; emballage: number; mo: number; minutes: number; total: number
  parUnite: number | null; parUniteVente: number | null
  manquants: number; sansPrix: string[]
}

/** TOUT ce que la modale consomme, et rien d'autre : l'état vit dans la page,
 *  la modale n'en est que la vue. */
export type EtatModale = {
  catLibre: boolean
  coefField: string
  coutIncomplet: boolean
  creantRow: number | null
  creerGenerique: (row: number, nom: string, base_unit: 'kg' | 'piece') => Promise<void>
  editId: string | null
  employees: Employee[]
  etapesChrono: { n: number; minutes: number } | null
  familles: Famille[]
  form: FormFiche
  genericById: Map<string, Generic>
  generics: Generic[]
  gesteSuivant: Manque | null
  ings: IngredientDraft[]
  laborRate: number | null
  manquesBrouillon: Manque[]
  nomsSansPrix: string
  onCoefChange: (v: string) => void
  onPvChange: (v: string) => void
  optionsFamilles: { value: string; label: string }[]
  pickGeneric: (row: number, g: Generic) => void
  pickSub: (row: number, r: Recipe) => void
  /** Archiver la fiche en cours d'édition (lot 123) — réversible depuis la
   *  section « Fiches archivées » en bas de la liste. */
  archiver: () => void
  archivant: boolean
  pickerRow: number | null
  preview: ApercuCout
  previewRate: number | null
  recipeById: Map<string, Recipe>
  recipes: Recipe[]
  remove: () => Promise<void>
  rienAChiffrer: boolean
  save: () => Promise<void>
  saving: boolean
  setCatLibre: Dispatch<SetStateAction<boolean>>
  setForm: Dispatch<SetStateAction<FormFiche>>
  setIngs: Dispatch<SetStateAction<IngredientDraft[]>>
  setPickerRow: Dispatch<SetStateAction<number | null>>
  setShow: Dispatch<SetStateAction<boolean>>
  setUniteLibre: Dispatch<SetStateAction<boolean>>
  show: boolean
  suggestions: ListeLigne[]
  uniteLibre: boolean
}

export const fmtEuro = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const unitFr = (u: string | null) => (u === 'piece' ? 'pièce' : u || '')
export const EMPTY_ING = (): IngredientDraft => ({ generic_id: null, article_id: null, sub_recipe_id: null, label: '', quantity: '', qty_unit: null, unit: null, loss_pct: '0', manual_price_ht: '', legacy_price: null })

// Unités de PRODUCTION proposées — « Autre… » garde le champ libre pour les cas
// qui n'y sont pas (bocaux, plaques…), et l'unité actuelle d'une vieille fiche
// reste sélectionnable telle quelle.
const UNITES_PRODUCTION = ['pièces', 'kg', 'g', 'litres', 'portions', 'barquettes']

// Unités de VENTE : un produit fabriqué (ou acheté) à la pièce peut se vendre
// au kg — le PV, la marge et le coef se calculent alors sur l'unité de VENTE.
const UNITES_VENTE = [
  { value: 'kg', label: 'au kg' },
  { value: '100 g', label: 'aux 100 g' },
  { value: 'pièce', label: 'à la pièce' },
  { value: 'portion', label: 'à la portion' },
  { value: 'litre', label: 'au litre' },
]

export default function ModaleFiche({ m }: { m: EtatModale }) {
  return (
    <>
      {/* Modale création / édition */}
      {m.show && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm p-4" onClick={() => m.setShow(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-gray-900">{m.editId ? 'Modifier la recette' : 'Nouvelle recette'}</h2>
                {!m.editId && (
                  <p className="text-xs text-gray-600 mt-1 max-w-lg leading-relaxed">
                    <span className="font-semibold text-gray-800">Le nom suffit pour enregistrer.</span>{' '}
                    Les ingrédients donnent le coût, le prix de vente donne la marge — tout le reste
                    se complète plus tard, sur la fiche.
                  </p>
                )}
              </div>
              <button onClick={() => m.setShow(false)} aria-label="Fermer" className="p-1.5 rounded-xl hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-pilote-200"><X className="w-4 h-4 text-gray-500" /></button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Nom <span className="font-normal text-pilote">— le seul champ obligatoire</span>
                  </label>
                  <Input value={m.form.name} onChange={e => m.setForm(p => ({ ...p, name: e.target.value }))} placeholder="Terrine de campagne" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Catégorie <span className="font-normal text-gray-400">— les familles de la boutique</span></label>
                  {m.catLibre ? (
                    <div className="flex items-center gap-1.5">
                      <Input autoFocus value={m.form.category}
                        onChange={e => m.setForm(p => ({ ...p, category: e.target.value }))} placeholder="pâtisserie salée…" />
                      <button type="button" onClick={() => { m.setCatLibre(false); m.setForm(p => ({ ...p, category: '' })) }}
                        title="Revenir à la liste des familles" className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  ) : (
                    <select value={m.form.category}
                      onChange={e => { if (e.target.value === '__libre__') { m.setCatLibre(true); m.setForm(p => ({ ...p, category: '' })) } else m.setForm(p => ({ ...p, category: e.target.value })) }}
                      className="w-full h-10 border border-gray-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200 bg-white">
                      <option value="">Sans catégorie</option>
                      {m.optionsFamilles.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      {/* Catégorie héritée d'avant les familles : sélectionnable telle
                          quelle, jamais perdue en ouvrant la fiche */}
                      {m.form.category && !m.optionsFamilles.some(o => o.value.toLowerCase() === m.form.category.trim().toLowerCase()) && (
                        <option value={m.form.category}>{m.form.category} (actuelle)</option>
                      )}
                      <option value="__libre__">Autre…</option>
                    </select>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Production</label>
                    <Input inputMode="decimal" value={m.form.yield_qty} onChange={e => m.setForm(p => ({ ...p, yield_qty: e.target.value }))} placeholder="6" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Unité</label>
                    {m.uniteLibre ? (
                      <div className="flex items-center gap-1.5">
                        <Input autoFocus value={m.form.yield_unit} onChange={e => m.setForm(p => ({ ...p, yield_unit: e.target.value }))} placeholder="bocaux…" />
                        <button type="button" onClick={() => { m.setUniteLibre(false); m.setForm(p => ({ ...p, yield_unit: 'pièces' })) }}
                          title="Revenir à la liste" className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ) : (
                      <select value={m.form.yield_unit}
                        onChange={e => { if (e.target.value === '__libre__') { m.setUniteLibre(true); m.setForm(p => ({ ...p, yield_unit: '' })) } else m.setForm(p => ({ ...p, yield_unit: e.target.value })) }}
                        className="w-full h-10 border border-gray-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200 bg-white">
                        {UNITES_PRODUCTION.map(u => <option key={u} value={u}>{u}</option>)}
                        {m.form.yield_unit && !UNITES_PRODUCTION.includes(m.form.yield_unit) && (
                          <option value={m.form.yield_unit}>{m.form.yield_unit} (actuelle)</option>
                        )}
                        <option value="__libre__">Autre…</option>
                      </select>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Temps (min) <span className="font-normal text-gray-400">— repli si les étapes de la fiche ne sont pas chronométrées</span></label>
                  {m.etapesChrono ? (
                    <>
                      <div className="flex h-10 w-full items-center rounded-md border border-gray-200 bg-gray-50 px-3 text-sm text-gray-500 tabular">
                        {m.etapesChrono.minutes.toLocaleString('fr-FR')} min
                      </div>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        Somme des {m.etapesChrono.n} étape{m.etapesChrono.n > 1 ? 's' : ''} chronométrée{m.etapesChrono.n > 1 ? 's' : ''} — c&apos;est ce temps-là qui compte. Il se modifie sur la fiche, étape par étape.
                      </p>
                    </>
                  ) : (
                    <Input inputMode="decimal" value={m.form.labor_minutes} onChange={e => m.setForm(p => ({ ...p, labor_minutes: e.target.value }))} placeholder="45" />
                  )}
                </div>
                {/* Vendu dans quelle unité ? Un produit fabriqué en pièces peut se
                    vendre au kg : la quantité vendable du batch fait la conversion,
                    et PV / marge / coef basculent sur l'unité de VENTE. */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Vendu</label>
                    <select value={m.form.sell_unit}
                      onChange={e => m.setForm(p => ({ ...p, sell_unit: e.target.value, sell_qty: e.target.value ? p.sell_qty : '' }))}
                      title={m.form.sell_unit ? `Vendu en ${m.form.sell_unit}` : `Vendu à l’unité produite (${m.form.yield_unit || 'unité'})`}
                      className="w-full h-10 border border-gray-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200 bg-white">
                      <option value="">à l&apos;unité produite</option>
                      {UNITES_VENTE.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                    </select>
                  </div>
                  {m.form.sell_unit ? (
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Batch vendable <span className="font-normal text-gray-400">en {m.form.sell_unit}</span></label>
                      <Input inputMode="decimal" value={m.form.sell_qty} onChange={e => m.setForm(p => ({ ...p, sell_qty: e.target.value }))} placeholder="2,4" />
                      <p className="text-[10px] text-gray-400 mt-0.5">Ce que le batch représente à la vente — ex. 6 pièces de 400 g → 2,4. Marge et coef se calculent sur cette base.</p>
                    </div>
                  ) : (
                    <div className="flex items-end pb-2.5">
                      <p className="text-[10px] text-gray-400">Fabriqué en pièces mais vendu au kg ? Choisissez l&apos;unité de vente — la marge suivra.</p>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Prix de vente TTC <span className="font-normal text-gray-400">/ {m.form.sell_unit || m.form.yield_unit || 'unité'}</span></label>
                    <Input inputMode="decimal" value={m.form.selling_price_ttc} onChange={e => m.onPvChange(e.target.value)} placeholder="4,50" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Coef ×</label>
                    <Input inputMode="decimal" value={m.coefField} onChange={e => m.onCoefChange(e.target.value)} placeholder="3"
                      disabled={m.coutIncomplet}
                      title={m.coutIncomplet
                        ? `Coût incomplet : ${m.nomsSansPrix} sans prix. Un coefficient appliqué dessus donnerait un prix de vente trop bas — saisissez le prix de vente directement, ou attendez le prix.`
                        : 'Coefficient multiplicateur : PV HT ÷ coût de revient — saisir un coef recalcule le PV TTC'} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">TVA de vente</label>
                  <select value={m.form.tva_rate} onChange={e => m.setForm(p => ({ ...p, tva_rate: e.target.value }))}
                    className="w-full h-10 border border-gray-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200 bg-white">
                    <option value="5.5">5,5 % (à emporter)</option>
                    <option value="10">10 % (sur place)</option>
                    <option value="20">20 %</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Qui fabrique ? <span className="font-normal text-gray-400">— le coût main-d&apos;œuvre prend son taux productif (heure travaillée)</span></label>
                  <select value={m.form.employee_id} onChange={e => m.setForm(p => ({ ...p, employee_id: e.target.value }))}
                    className="w-full h-10 border border-gray-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200 bg-white">
                    <option value="">Taux moyen de l&apos;équipe{m.laborRate !== null ? ` (${fmtEuro(m.laborRate)}/h)` : ''}</option>
                    {m.employees.map(e => (
                      <option key={e.id} value={e.id}>
                        {e.name}{e.loaded_rate !== null ? ` (${fmtEuro(e.loaded_rate)}/h productif)` : ' (sans taux — repli taux moyen)'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Ingrédients — uniquement des articles génériques de la mercuriale */}
              <div>
                <p className="text-xs font-semibold text-gray-700 mb-2">Ingrédients <span className="font-normal text-gray-400">— choisis parmi vos articles génériques ; la perte gonfle la quantité brute à sortir</span></p>
                {m.generics.length === 0 && (
                  <p className="text-[11px] text-amber-600 mb-2">
                    Aucun article générique : associez d&apos;abord vos réfs dans la <Link href="/dashboard/mercuriale" className="font-bold underline">Mercuriale</Link>.
                  </p>
                )}
                <div className="space-y-2">
                  {m.ings.map((ing, i) => {
                    const g = ing.generic_id ? m.genericById.get(ing.generic_id) ?? null : null
                    const sub = ing.sub_recipe_id ? m.recipeById.get(ing.sub_recipe_id) ?? null : null
                    const q = ing.label.trim().toLowerCase()
                    const sugg = m.pickerRow === i && q.length >= 2 && !ing.generic_id && !ing.sub_recipe_id
                      ? m.generics.filter(x => x.name.toLowerCase().includes(q)).slice(0, 6)
                      : []
                    // Fiches proposées en sous-recette — jamais la fiche en cours d'édition
                    const suggR = m.pickerRow === i && q.length >= 2 && !ing.generic_id && !ing.sub_recipe_id
                      ? m.recipes.filter(x => x.id !== m.editId && !x.archived_at && x.name.toLowerCase().includes(q)).slice(0, 4)
                      : []
                    const isLegacy = !ing.generic_id && !ing.sub_recipe_id && !!ing.article_id
                    // Création proposée en dernier recours : seulement si rien ne
                    // porte déjà exactement ce nom (sinon la route refuserait le
                    // doublon, et l'article existant est déjà dans les suggestions).
                    const dejaPris = m.generics.some(x => x.name.trim().toLowerCase() === q)
                    const peutCreer = m.pickerRow === i && q.length >= 2 && !ing.generic_id && !ing.sub_recipe_id && !dejaPris
                    return (
                      <div key={i} className="relative">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 relative min-w-[140px]">
                            <Search className="w-3.5 h-3.5 text-gray-300 absolute left-2.5 top-1/2 -translate-y-1/2" />
                            <input value={ing.label}
                              onChange={e => { m.setIngs(prev => prev.map((x, j) => j === i ? { ...x, label: e.target.value, generic_id: null, article_id: null, sub_recipe_id: null, legacy_price: null } : x)); m.setPickerRow(i) }}
                              onFocus={() => m.setPickerRow(i)}
                              placeholder="Chercher un article générique ou une fiche…"
                              className={`w-full border rounded-lg pl-8 pr-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pilote-200 ${ing.generic_id || ing.sub_recipe_id ? 'border-pilote-200 bg-pilote-50/50 font-medium' : isLegacy ? 'border-amber-200 bg-amber-50/50' : 'border-gray-200'}`} />
                          </div>
                          <input inputMode="decimal" value={ing.quantity}
                            onChange={e => m.setIngs(prev => prev.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))}
                            placeholder="Qté" className="w-14 border border-gray-200 rounded-lg px-2 py-2 text-sm text-right tabular focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                          {g ? (
                            g.base_unit === 'kg' ? (
                              <select value={ing.qty_unit ?? 'kg'}
                                onChange={e => m.setIngs(prev => prev.map((x, j) => j === i ? { ...x, qty_unit: e.target.value as 'kg' | 'g' } : x))}
                                className="w-14 border border-gray-200 rounded-lg px-1 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200 flex-shrink-0">
                                <option value="kg">kg</option>
                                <option value="g">g</option>
                              </select>
                            ) : (
                              <span className="text-[11px] text-gray-400 w-14 flex-shrink-0 text-center">pièce</span>
                            )
                          ) : (
                            <span className="text-[11px] text-gray-400 w-14 flex-shrink-0 text-center">{ing.unit || '—'}</span>
                          )}
                          <div className="relative flex-shrink-0">
                            <input inputMode="decimal" value={ing.loss_pct} title="Perte / rendement (%)"
                              onChange={e => m.setIngs(prev => prev.map((x, j) => j === i ? { ...x, loss_pct: e.target.value } : x))}
                              className="w-14 border border-gray-200 rounded-lg pl-2 pr-5 py-2 text-xs text-right tabular focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                            <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">%</span>
                          </div>
                          {g ? (
                            g.price_ht !== null ? (
                              <span className="text-xs text-gray-500 tabular w-24 text-right flex-shrink-0" title={ing.manual_price_ht.trim() ? 'Prix de la mercuriale — il l’emporte sur le prix de repli saisi à la main' : undefined}>{fmtEuro(g.price_ht)} / {unitFr(g.base_unit)}</span>
                            ) : (
                              <input id={`prix-repli-${i}`} inputMode="decimal" value={ing.manual_price_ht} title={`Aucun prix facturé — saisissez un prix HT par ${unitFr(g.base_unit)}`}
                                onChange={e => m.setIngs(prev => prev.map((x, j) => j === i ? { ...x, manual_price_ht: e.target.value } : x))}
                                placeholder={`€/${unitFr(g.base_unit)}`} className="w-24 border border-amber-200 rounded-lg px-2 py-2 text-xs text-right tabular focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                            )
                          ) : sub ? (
                            <span className="text-xs text-gray-500 tabular w-24 text-right flex-shrink-0" title="Coût complet de la sous-fiche ÷ son rendement — relu en continu">
                              {sub.cost.par_unite_ht !== null ? `${fmtEuro(sub.cost.par_unite_ht)} / ${sub.yield_unit || 'u'}` : 'rendement requis'}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-500 tabular w-24 text-right flex-shrink-0">{ing.legacy_price !== null ? fmtEuro(ing.legacy_price) : '—'}</span>
                          )}
                          <button onClick={() => m.setIngs(prev => prev.length > 1 ? prev.filter((_, j) => j !== i) : prev)}
                            className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400 flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
                        </div>
                        {isLegacy && (
                          <p className="text-[10px] text-amber-600 mt-0.5 ml-1">Ancienne réf directe — re-choisissez un article générique pour profiter des prix à jour.</p>
                        )}
                        {sub && (
                          <p className="text-[10px] text-pilote mt-0.5 ml-1">Sous-recette — quantité en {sub.yield_unit || 'unités'} de « {sub.name} », coût complet ÷ rendement, relu en continu.</p>
                        )}
                        {/* Prix de repli DORMANT : un prix saisi à la main disparaissait
                            de l'écran dès qu'une facture donnait un prix mercuriale — mais
                            il restait en base, et ressurgissait au premier trou de prix,
                            des mois plus tard, sans que personne ne l'ait revu. */}
                        {g && g.price_ht !== null && ing.manual_price_ht.trim() !== '' && (
                          <p className="text-[10px] text-gray-400 mt-0.5 ml-1 flex items-center gap-1.5 flex-wrap">
                            <span>Prix de repli saisi à la main : <span className="tabular font-semibold">{ing.manual_price_ht} €</span> / {unitFr(g.base_unit)} — inutilisé tant que la mercuriale a un prix, mais il reprendrait la main si ce prix disparaissait.</span>
                            <button type="button"
                              onClick={() => m.setIngs(prev => prev.map((x, j) => j === i ? { ...x, manual_price_ht: '' } : x))}
                              className="font-semibold text-pilote hover:underline flex-shrink-0">Effacer</button>
                          </p>
                        )}
                        {(sugg.length > 0 || suggR.length > 0 || peutCreer) && (
                          <div className="absolute z-10 left-0 right-24 mt-1 bg-white border border-gray-200 rounded-lg shadow-card-hover overflow-hidden">
                            {sugg.map(x => (
                              <button key={x.id} onClick={() => m.pickGeneric(i, x)}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-pilote-50 flex items-center justify-between gap-2">
                                <span className="truncate">{x.name}
                                  {x.category === 'emballage' && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wider text-blue-700 bg-blue-50 rounded px-1 py-0.5">Emballage</span>}
                                </span>
                                <span className="text-xs text-gray-500 tabular flex-shrink-0">
                                  {x.price_ht !== null ? `${fmtEuro(x.price_ht)} / ${unitFr(x.base_unit)}` : 'pas encore de prix'}
                                </span>
                              </button>
                            ))}
                            {suggR.length > 0 && (
                              <p className={`px-3 pt-2 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider ${sugg.length > 0 ? 'border-t border-gray-100' : ''}`}>Fiches recettes — en sous-recette</p>
                            )}
                            {suggR.map(x => (
                              <button key={`sub-${x.id}`} onClick={() => m.pickSub(i, x)}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-pilote-50 flex items-center justify-between gap-2">
                                <span className="truncate">{x.name}
                                  <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wider text-pilote bg-pilote-50 rounded px-1 py-0.5">Fiche</span>
                                </span>
                                <span className="text-xs text-gray-500 tabular flex-shrink-0">
                                  {x.cost.par_unite_ht !== null ? `${fmtEuro(x.cost.par_unite_ht)} / ${x.yield_unit || 'u'}` : 'rendement requis'}
                                </span>
                              </button>
                            ))}
                            {peutCreer && (
                              <div className={`px-3 py-2 ${sugg.length > 0 || suggR.length > 0 ? 'border-t border-gray-100 bg-gray-50/70' : ''}`}>
                                <p className="text-[11px] text-gray-500">
                                  Rien de tel dans vos articles. Créer <span className="font-semibold text-gray-800">« {ing.label.trim()} »</span> —
                                  {' '}se vend-il au kilo ou à la pièce&nbsp;?
                                </p>
                                <div className="flex gap-2 mt-1.5">
                                  <button type="button" disabled={m.creantRow !== null}
                                    onClick={() => m.creerGenerique(i, ing.label, 'kg')}
                                    className="flex items-center gap-1 text-xs font-bold text-white bg-pilote hover:bg-pilote-hover rounded-lg px-2.5 py-1.5 disabled:opacity-50 transition-colors">
                                    <Plus className="w-3 h-3" />au kilo
                                  </button>
                                  <button type="button" disabled={m.creantRow !== null}
                                    onClick={() => m.creerGenerique(i, ing.label, 'piece')}
                                    className="flex items-center gap-1 text-xs font-bold text-pilote border border-pilote-200 hover:bg-pilote-50 rounded-lg px-2.5 py-1.5 disabled:opacity-50 transition-colors">
                                    <Plus className="w-3 h-3" />à la pièce
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                <button onClick={() => m.setIngs(prev => [...prev, EMPTY_ING()])}
                  className="mt-2 text-xs font-semibold text-pilote hover:underline flex items-center gap-1"><Plus className="w-3.5 h-3.5" />Ajouter un ingrédient</button>
              </div>

              {/* CE QU'IL RESTE À FAIRE — un seul geste, celui par lequel commencer.
                  Le formulaire ne dit plus seulement ce qu'il attend, il dit ce que
                  le manque EMPÊCHE : un champ réclamé sans raison énoncée passe
                  pour une brimade, et on ne le remplit pas. */}
              {m.gesteSuivant !== null ? (
                <div className={`rounded-lg p-3.5 ring-1 ${m.gesteSuivant.gravite === 'fausse' ? 'bg-amber-50 ring-amber-200' : 'bg-gray-50 ring-gray-200'}`}>
                  <p className="text-xs font-bold text-gray-900">
                    Prochaine étape&nbsp;: {m.gesteSuivant.titre}
                  </p>
                  <p className="text-[11px] text-gray-600 mt-0.5 leading-relaxed">{m.gesteSuivant.effet}</p>
                  {m.manquesBrouillon.length > 1 && (
                    <p className="text-[11px] text-gray-500 mt-1.5">
                      {m.manquesBrouillon.length - 1} autre{m.manquesBrouillon.length > 2 ? 's' : ''} point{m.manquesBrouillon.length > 2 ? 's' : ''} à compléter ensuite — rien n’empêche d’enregistrer maintenant.
                    </p>
                  )}
                </div>
              ) : (
                <div className="rounded-lg p-3.5 ring-1 bg-green-50 ring-green-200">
                  <p className="text-xs font-bold text-green-800">Cette fiche est complète.</p>
                  <p className="text-[11px] text-green-700 mt-0.5">Coût, marge et coefficient sont tous calculables.</p>
                </div>
              )}

              {/* Aperçu du coût — masqué tant qu'il n'y a RIEN à chiffrer.
                  « 0,00 € » écrit trois fois sur un formulaire vide fait passer une
                  recette non commencée pour une recette gratuite, et c'est
                  exactement le chiffre faux en silence qu'on ne veut nulle part. */}
              {m.rienAChiffrer ? (
                <div className="bg-gray-50 ring-1 ring-gray-200 rounded-lg p-4">
                  <p className="text-sm font-semibold text-gray-700">Coût de revient</p>
                  <p className="text-xs text-gray-600 mt-0.5">
                    Rien à chiffrer pour l’instant : ajoutez un ingrédient et une quantité,
                    le coût du jour s’affichera ici, relu de la mercuriale.
                  </p>
                </div>
              ) : (
              <div className="bg-pilote-50/70 ring-1 ring-pilote-100 rounded-lg p-4 text-sm tabular">
                <div className="flex justify-between text-gray-600"><span>Matière (brut, perte comprise)</span><span className="font-semibold">{fmtEuro(m.preview.matiere)}</span></div>
                {m.preview.emballage > 0 && (
                  <div className="flex justify-between text-gray-600"><span>Emballage &amp; conditionnement</span><span className="font-semibold">{fmtEuro(m.preview.emballage)}</span></div>
                )}
                <div className="flex justify-between text-gray-600">
                  <span>Main-d&apos;œuvre{m.previewRate !== null ? ` (${fmtEuro(m.previewRate)}/h)` : ''}{m.preview.minutes > 0 ? ` — ${m.preview.minutes.toLocaleString('fr-FR')} min${m.etapesChrono ? ' (étapes)' : ''}` : ''}</span>
                  <span className="font-semibold">{fmtEuro(m.preview.mo)}</span>
                </div>
                <div className="flex justify-between font-extrabold text-pilote-800 mt-1.5 pt-1.5 border-t border-pilote-100">
                  <span>
                    Coût de revient{m.preview.parUnite !== null ? ` (${fmtEuro(m.preview.parUnite)} / ${m.form.yield_unit || 'unité'})` : ''}
                    {m.form.sell_unit && m.preview.parUniteVente !== null && m.preview.parUniteVente !== m.preview.parUnite ? ` — soit ${fmtEuro(m.preview.parUniteVente)} / ${m.form.sell_unit} vendu` : ''}
                  </span>
                  <span>{fmtEuro(m.preview.total)}</span>
                </div>
                {m.preview.manquants > 0 && (
                  <p className="text-[11px] text-amber-600 mt-1.5">
                    {m.preview.manquants} ingrédient{m.preview.manquants > 1 ? 's' : ''} sans prix ({m.nomsSansPrix}) — ce coût est donc <span className="font-semibold">sous-estimé</span>, et le coef reste désactivé tant qu&apos;il l&apos;est : un prix de vente calculé dessus serait trop bas. Le prix arrivera avec la prochaine facture lue, ou saisissez un prix de repli.
                  </p>
                )}
              </div>
              )}

              <div>
                <div className="flex gap-3 pt-1">
                  {m.editId && (
                    <>
                      {/* Archiver AVANT Retirer, et dans une couleur neutre : c'est
                          le geste réversible, celui qu'on veut voir en premier.
                          Retirer reste pour les fiches créées par erreur. */}
                      <Button variant="outline" onClick={m.archiver} disabled={m.archivant}
                        title="La fiche sort de la liste et des choix d’ingrédients, mais garde tout — ingrédients, temps, formats. Restaurable en un clic depuis « Fiches archivées », en bas de la liste.">
                        {m.archivant ? 'Archivage…' : 'Archiver'}
                      </Button>
                      <Button variant="outline" onClick={m.remove} className="text-red-600 border-red-200 hover:bg-red-50"
                        title="Retire la fiche pour de bon — pour une fiche créée par erreur. Pour une recette qu’on ne fait plus, préférez Archiver.">Retirer</Button>
                    </>
                  )}
                  <Button variant="outline" className="flex-1" onClick={() => m.setShow(false)}>Annuler</Button>
                  {/* Un bouton grisé qui ne dit pas ce qu'il attend arrête net celui
                      qui le regarde. Ici il n'attend qu'une chose, et il l'écrit. */}
                  <Button className="flex-1 bg-pilote hover:bg-pilote-hover text-white" onClick={m.save} disabled={m.saving || !m.form.name.trim()}
                    title={!m.form.name.trim() ? 'Donnez un nom à la recette — c’est la seule chose exigée pour enregistrer.' : undefined}>
                    {m.saving ? 'Enregistrement…' : 'Enregistrer'}
                  </Button>
                </div>
                {!m.form.name.trim() && (
                  <p className="text-[11px] text-gray-600 mt-2 text-right">
                    Donnez un nom à la recette pour pouvoir l’enregistrer — c’est la seule chose exigée.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
