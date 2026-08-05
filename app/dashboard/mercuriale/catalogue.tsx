'use client'

// Mercuriale — les DONNÉES DE FORME de l'écran (types des objets rendus par
// l'API), les fonctions pures d'affichage, et le tableau de l'onglet « Prix du
// jour » avec la fiche dépliée d'un article. Sorti de page.tsx au lot 73 pour
// que la page reste sous le plafond de publication : la page garde ses états,
// ses appels API et ses gestes, ce fichier ne fait que dessiner.

import { Fragment, type Dispatch, type SetStateAction } from 'react'
import Link from 'next/link'
import { ShoppingBasket, ChevronDown, ChevronRight, Pencil, Trash2, Unlink, Check, AlertTriangle, ChefHat } from 'lucide-react'
import {
  fmtEuro, fmtQty, fmtDate, nomFournisseur, unitLabel, priceAge, MOTIF_PRIX,
  Variation, Sparkline, TuileMoy3Mois, BlocAchatsMensuels, BlocHistoriqueAchats,
  VerrouPrixRef,
  type PricePoint, type FicheDetail, type MotifPrix,
} from './ui'

/** Onglet affiché — l'état vit dans page.tsx, les vues le reçoivent */
export type Vue = 'prix' | 'traiter' | 'organiser' | 'fournisseurs' | 'rayons'

export type Ref = {
  id: string
  name: string
  unit: string | null
  supplier_name: string | null
  article_code: string | null
  last_price_ht: number | null
  last_price_date: string | null
  price_count: number
  variation_pct: number | null
  conversion_factor: number | string | null
  price_base: number | null
  /** Associée mais facturée dans une unité incompatible SANS facteur : prix ignoré */
  needs_conversion: boolean
  /** Clé de rapprochement (calculée serveur) — les réfs à la même clé se ressemblent */
  stem: string
  /** Ligne non-produit (taxe, remise, licence…) : jamais associée d'office */
  non_product: boolean
  /** Écartée par le gérant : hors file, restaurable depuis la section dédiée */
  ignored: boolean
  /** Générique existant à la même clé, s'il y en a un : association suggérée */
  suggested_generic_id: string | null
  /** Facture d'où vient le dernier prix — pour aller vérifier le produit */
  last_invoice_id?: string | null
  /** Date du dernier prix vu (facture), repli last_price_date */
  last_seen?: string | null
  /** Prix négocié VERROUILLÉ (lot 43) — toute facture au-dessus est signalée */
  blocked_price_ht?: number | string | null
  blocked_at?: string | null
}

/** Fiche recette utilisatrice d'un générique — quantité BRUTE par batch */
export type RecipeUse = {
  id: string
  name: string
  qty_brute: number
  yield_qty: number | null
  yield_unit: string | null
}

export type Generic = {
  id: string
  name: string
  base_unit: 'kg' | 'piece'
  category: 'ingredient' | 'emballage'
  default_loss_pct: number
  auto_created: boolean
  refs_count: number
  price_ht: number | null
  price_date: string | null
  price_supplier: string | null
  /** Variation DU GÉNÉRIQUE (toutes réfs), pas de sa seule meilleure réf */
  variation_pct: number | null
  variation_ref_pct?: number | null
  /** Prix payés sur 12 mois (inflexions, 40 points max) — réfs utilisables seulement */
  history: PricePoint[]
  /** Points d'inflexion écartés par le plafond d'affichage de la courbe */
  history_tronque?: number
  points_12m: number
  min_12m: number | null
  max_12m: number | null
  /** Dépense et nombre d'achats 12 mois, toutes réfs confondues (lot 42) */
  depense_12m?: number
  achats_12m?: number
  /** Prix précédent du GÉNÉRIQUE (dernière valeur différente, toutes réfs) */
  prev_price_ht: number | null
  prev_price_supplier?: string | null
  prev_price_date?: string | null
  /** Nombre de prix lus sur facture mais REFUSÉS par les garde-fous */
  prix_quarantaine: number
  /** Pourquoi il n'y a pas de prix — chaque cause appelle une action différente */
  price_missing_reason: MotifPrix | null
  recipes_count: number
  recipes_used: RecipeUse[]
  refs: Ref[]
}

/** Un changement de prix constaté entre deux factures d'une même réf (30 j) */
export type Move = {
  date: string
  generic_id: string
  generic_name: string
  base_unit: 'kg' | 'piece'
  ref_name: string
  supplier_name: string | null
  old_base: number
  new_base: number
  pct: number | null
  /** Facture qui porte le NOUVEAU prix — pour ouvrir le PDF source */
  invoice_id: string | null
  /** Saut ≥ ±25 % : signalement « à vérifier », pas un verdict */
  anomalie: boolean
}

/** Dépense réelle chez un fournisseur sur 12 mois (factures matière) — vue
 *  « Fournisseurs » (lot 40, modèle Otami). Libellé BRUT, nettoyé à l'affichage. */
export type FournisseurDepense = {
  nom: string
  depense_12m: number
  factures_12m: number
  derniere_facture: string | null
}

export type PendingInvoice = {
  id: string
  supplier_name: string
  invoice_date: string
  amount_ht: number | string
  lines_status: string | null
  /** Motif de l'échec ou de la lecture partielle, en clair (lot 1) */
  lines_error: string | null
  lines_checked_at: string | null
}

/** Classement matière/charge FRAGILE, à trancher d'un clic (lot 29) : le tri
 *  pose un drapeau quand sa confiance est faible (nature jugée sur une lecture
 *  image, grosse facture écartée) au lieu de décider en silence. */
export type DouteInvoice = {
  id: string
  supplier_name: string | null
  invoice_date: string | null
  amount_ht: number | string | null
  lines_status: string | null
  lines_error: string | null
}

export const titleize = (s: string) => { const t = s.trim().replace(/\s+/g, ' '); return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : t }

/** Nom proposé pour un lot de réfs qui se ressemblent : le début COMMUN de
 *  leurs libellés (« FILET DE POULET LR 3,2 » + « FILET DE POULET ML 2,5KG »
 *  → « Filet de poulet »), repli sur le premier libellé. */
export function commonLabel(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return titleize(names[0])
  const words = names.map(n => n.trim().split(/\s+/))
  const first = words[0]
  const out: string[] = []
  for (let i = 0; i < first.length; i++) {
    if (words.every(w => (w[i] || '').toLowerCase() === first[i].toLowerCase())) out.push(first[i])
    else break
  }
  const label = out.join(' ').replace(/[\s\-–·,]+$/, '')
  return titleize(label || names[0])
}

/** ══ Onglet PRIX DU JOUR : le catalogue des prix, chaque ligne dépliable sur
 *  la fiche de l'article (courbe, achats, comparaison fournisseurs, impact
 *  recettes, réfs rattachées). Aucun état ici : tout vient de page.tsx. ══ */
export function TableauCatalogue({
  aTraiterTotal, setView, filteredGenerics, filteredQueue, generics, queue,
  openId, setOpenId, editId, setEditId, confirmDelId, setConfirmDelId,
  edit, setEdit, saving, submitEdit, validant, validerAuto, startEdit, removeGeneric,
  fiches, ficheLoading, supplierRows, cheaperAlt,
  verrouDrafts, setVerrouDrafts, poserVerrou, verrouillant, dissociate,
}: {
  aTraiterTotal: number
  setView: Dispatch<SetStateAction<Vue>>
  filteredGenerics: Generic[]
  filteredQueue: Ref[]
  generics: Generic[]
  queue: Ref[]
  openId: string | null
  setOpenId: Dispatch<SetStateAction<string | null>>
  editId: string | null
  setEditId: Dispatch<SetStateAction<string | null>>
  confirmDelId: string | null
  setConfirmDelId: Dispatch<SetStateAction<string | null>>
  edit: { name: string; base_unit: 'kg' | 'piece'; category: 'ingredient' | 'emballage'; loss: string }
  setEdit: Dispatch<SetStateAction<{ name: string; base_unit: 'kg' | 'piece'; category: 'ingredient' | 'emballage'; loss: string }>>
  saving: boolean
  submitEdit: (g: Generic) => Promise<void>
  validant: string | null
  validerAuto: (g: Generic) => Promise<void>
  startEdit: (g: Generic) => void
  removeGeneric: (g: Generic) => Promise<void>
  fiches: Record<string, FicheDetail>
  ficheLoading: string | null
  supplierRows: (g: Generic) => { sup: string; price: number; date: string | null }[]
  cheaperAlt: (g: Generic) => { sup: string; pct: number; price: number; date: string | null } | null
  verrouDrafts: Record<string, string>
  setVerrouDrafts: Dispatch<SetStateAction<Record<string, string>>>
  poserVerrou: (refId: string, prix: number | null) => Promise<void>
  verrouillant: string | null
  dissociate: (refId: string, refName: string) => Promise<void>
}) {
  return (
    <>
      {/* Ce qui attend un geste n'est plus sous les yeux ici : une
          ligne le rappelle, l'onglet « À traiter » fait le reste. */}
      {aTraiterTotal > 0 && (
        <button onClick={() => setView('traiter')}
          className="w-full mb-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center gap-2.5 text-left hover:bg-amber-100/70 transition-colors">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <span className="text-sm text-amber-900 flex-1">
            <strong>{aTraiterTotal} élément{aTraiterTotal > 1 ? 's' : ''} attend{aTraiterTotal > 1 ? 'ent' : ''} dans « À traiter »</strong> — factures à lire, produits à regrouper…
          </span>
          <ChevronRight className="w-4 h-4 text-amber-600 flex-shrink-0" />
        </button>
      )}
      {filteredGenerics.length === 0 && filteredQueue.length === 0 ? (
      <div className="bg-white rounded-2xl border border-dashed border-gray-200 py-16 text-center">
        <ShoppingBasket className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <p className="text-sm font-medium text-gray-500 mb-1">{generics.length === 0 && queue.length === 0 ? 'Aucun article pour l’instant' : 'Rien ne correspond à la recherche'}</p>
        {generics.length === 0 && queue.length === 0 && (
          <p className="text-xs text-gray-400 max-w-md mx-auto">
            Synchronisez Pennylane depuis la page Facturation, puis cliquez sur « Lire les factures » :
            les réfs sans ressemblance deviennent automatiquement des articles génériques,
            et seuls les produits aux appellations proches vous attendront ici pour être regroupés.
          </p>
        )}
      </div>
    ) : filteredGenerics.length > 0 ? (
      <div>
        <div className="flex items-baseline gap-2 mb-3">
          <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-700">Catalogue</h2>
          <span className="text-[11px] text-gray-400 tabular">{filteredGenerics.length} article{filteredGenerics.length > 1 ? 's' : ''} générique{filteredGenerics.length > 1 ? 's' : ''}</span>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="bg-gray-50 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  <th className="px-4 py-2.5 text-left">Article générique</th>
                  <th className="px-4 py-2.5 text-left">Catégorie</th>
                  <th className="px-4 py-2.5 text-right">Dernier prix HT</th>
                  <th className="px-4 py-2.5 text-left">Unité</th>
                  <th className="px-4 py-2.5 text-right">Au</th>
                  <th className="px-4 py-2.5 text-right">Variation</th>
                  <th className="px-4 py-2.5 text-right">Réfs</th>
                  <th className="px-4 py-2.5 text-right">Fiches</th>
                </tr>
              </thead>
              <tbody>
                {filteredGenerics.map(g => {
                  const isOpen = openId === g.id
                  const isEdit = editId === g.id
                  return (
                    <Fragment key={g.id}>
                      <tr id={`generic-${g.id}`}
                        onClick={() => { setOpenId(isOpen ? null : g.id); setEditId(null); setConfirmDelId(null) }}
                        className="border-t border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer">
                        <td className="px-4 py-2.5 text-sm font-semibold text-gray-900">
                          <span className="inline-flex items-center gap-1.5">
                            {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
                            {g.name}
                            {g.auto_created && <span className="text-[9px] font-semibold uppercase tracking-wider text-pilote bg-pilote-50 rounded-full px-1.5 py-0.5" title="Créé par l'association automatique">Auto</span>}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`text-[10px] font-semibold uppercase tracking-wider rounded-lg px-1.5 py-0.5 ${g.category === 'emballage' ? 'text-blue-700 bg-blue-50' : 'text-pilote bg-pilote-50'}`}>
                            {g.category === 'emballage' ? 'Emballage' : 'Ingrédient'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <span className="text-sm font-bold text-gray-900 tabular">{g.price_ht !== null ? fmtEuro(Number(g.price_ht)) : '—'}</span>
                          {g.price_ht === null && g.price_missing_reason && (
                            <span className="block text-[10px] font-semibold text-amber-600" title={MOTIF_PRIX[g.price_missing_reason]?.quoi_faire}>
                              {MOTIF_PRIX[g.price_missing_reason]?.court}
                              {g.prix_quarantaine > 0 && g.price_missing_reason === 'quarantaine' ? ` (${g.prix_quarantaine})` : ''}
                            </span>
                          )}
                          {(() => {
                            const alt = cheaperAlt(g)
                            return alt ? (
                              <span className="block text-[10px] font-semibold text-green-700 tabular"
                                title={`${alt.sup} : ${fmtEuro(alt.price)} / ${unitLabel(g.base_unit)} le ${fmtDate(alt.date)} — comparaison complète dans la ligne dépliée`}>
                                −{alt.pct.toLocaleString('fr-FR')} % chez {alt.sup}
                              </span>
                            ) : null
                          })()}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-500">/ {unitLabel(g.base_unit)}</td>
                        <td className="px-4 py-2.5 text-right text-xs tabular">
                          {(() => { const age = priceAge(g.price_date); const vieux = age !== null && age > 30; return (
                            <span className={vieux ? 'text-amber-600 font-semibold' : 'text-gray-500'} title={vieux ? `Dernier prix il y a ${age} jours — pas de facture récente pour ce produit` : undefined}>
                              {fmtDate(g.price_date)}{vieux ? ` (${age} j)` : ''}
                            </span>
                          ) })()}
                        </td>
                        <td className="px-4 py-2.5 text-right"><Variation pct={g.variation_pct} /></td>
                        <td className="px-4 py-2.5 text-right text-xs text-gray-400 tabular">
                          {g.refs_count}
                          {g.refs.some(r => r.needs_conversion) && <AlertTriangle className="w-3 h-3 text-amber-500 inline ml-1" />}
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs tabular">
                          {g.recipes_count > 0
                            ? <span className="font-semibold text-pilote">{g.recipes_count}</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-gray-50/60">
                          <td colSpan={8} className="px-4 py-3">
                            {isEdit ? (
                              <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end" onClick={e => e.stopPropagation()}>
                                <div className="md:col-span-2">
                                  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Nom</label>
                                  <input value={edit.name} onChange={e => setEdit(f => ({ ...f, name: e.target.value }))}
                                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                                </div>
                                <div>
                                  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Unité</label>
                                  <select value={edit.base_unit} onChange={e => setEdit(f => ({ ...f, base_unit: e.target.value as 'kg' | 'piece' }))}
                                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200">
                                    <option value="kg">au kg</option>
                                    <option value="piece">à la pièce</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Catégorie</label>
                                  <select value={edit.category} onChange={e => setEdit(f => ({ ...f, category: e.target.value as 'ingredient' | 'emballage' }))}
                                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200">
                                    <option value="ingredient">Ingrédient</option>
                                    <option value="emballage">Emballage</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Perte par défaut (%)</label>
                                  <input value={edit.loss} onChange={e => setEdit(f => ({ ...f, loss: e.target.value }))} inputMode="decimal"
                                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                                </div>
                                <div className="md:col-span-5 flex justify-end gap-2">
                                  <button onClick={() => setEditId(null)} className="text-xs font-semibold text-gray-500 rounded-lg px-3 py-2 hover:bg-gray-100">Annuler</button>
                                  <button onClick={() => submitEdit(g)} disabled={saving}
                                    className="text-xs font-bold text-white bg-pilote hover:bg-pilote-hover rounded-lg px-4 py-2 shadow-card disabled:opacity-50">Enregistrer</button>
                                </div>
                              </div>
                            ) : (
                              <div onClick={e => e.stopPropagation()}>
                                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                                  <p className="text-[11px] text-gray-500">
                                    Perte par défaut : <strong className="tabular">{g.default_loss_pct.toLocaleString('fr-FR')} %</strong>
                                    {g.price_supplier ? <> · dernier prix chez <strong>{nomFournisseur(g.price_supplier)}</strong></> : null}
                                  </p>
                                  <div className="flex items-center gap-2">
                                    {g.auto_created && (
                                      <button onClick={() => validerAuto(g)} disabled={validant === g.id}
                                        title="Le nom et l'unité sont bons : retirer le marqueur « Auto »"
                                        className="flex items-center gap-1 text-xs font-semibold text-green-700 rounded-lg px-2.5 py-1.5 hover:bg-green-50 disabled:opacity-50">
                                        <Check className="w-3 h-3" />{validant === g.id ? 'Validation…' : 'Vu, c’est bon'}
                                      </button>
                                    )}
                                    <button onClick={() => startEdit(g)} className="flex items-center gap-1 text-xs font-semibold text-pilote rounded-lg px-2.5 py-1.5 hover:bg-pilote-50"><Pencil className="w-3 h-3" />Modifier</button>
                                    <button onClick={() => removeGeneric(g)}
                                      className={`flex items-center gap-1 text-xs font-semibold rounded-lg px-2.5 py-1.5 transition-colors ${confirmDelId === g.id ? 'text-white bg-red-600 hover:bg-red-700' : 'text-red-600 hover:bg-red-50'}`}>
                                      <Trash2 className="w-3 h-3" />{confirmDelId === g.id ? 'Confirmer la suppression ?' : 'Supprimer'}
                                    </button>
                                  </div>
                                </div>
                                {/* Historique 12 mois : la courbe des prix payés, min/max — ou l'absence assumée */}
                                {g.history.length >= 2 ? (
                                  <div className="mb-2.5 bg-white border border-gray-100 rounded-xl px-3.5 py-2.5 flex items-center gap-6 flex-wrap">
                                    <div className="w-60 flex-shrink-0">
                                      <Sparkline points={g.history} />
                                      <div className="flex justify-between text-[10px] text-gray-400 tabular mt-0.5">
                                        <span>{fmtDate(g.history[0].d)}</span>
                                        <span>{fmtDate(g.history[g.history.length - 1].d)}</span>
                                      </div>
                                    </div>
                                    <div>
                                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Min 12 mois</p>
                                      <p className="text-sm font-extrabold text-gray-900 tabular">{g.min_12m !== null ? fmtEuro(g.min_12m) : '—'}</p>
                                    </div>
                                    <TuileMoy3Mois fiche={fiches[g.id]} />
                                    <div>
                                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Max 12 mois</p>
                                      <p className="text-sm font-extrabold text-gray-900 tabular">{g.max_12m !== null ? fmtEuro(g.max_12m) : '—'}</p>
                                    </div>
                                    <p className="text-[11px] text-gray-400">
                                      {g.points_12m} prix relevé{g.points_12m > 1 ? 's' : ''} sur 12 mois · en € / {unitLabel(g.base_unit)}
                                      {/* Le min/max porte sur les 12 mois entiers, la courbe sur ses 40
                                          derniers changements : sans cette phrase, un « Min » absent du
                                          dessin passait pour une erreur de lecture. */}
                                      {g.history_tronque && g.history_tronque > 0
                                        ? <> · la courbe montre les {g.history.length} derniers changements ({g.history_tronque} plus anciens hors du dessin — le min/max, lui, couvre les 12 mois)</>
                                        : null}
                                    </p>
                                  </div>
                                ) : (
                                  <p className="mb-2.5 text-[11px] text-gray-400">
                                    {g.points_12m > 0
                                      ? <>Prix stable : {g.points_12m} prix relevé{g.points_12m > 1 ? 's' : ''} sur 12 mois, aucun changement — la courbe apparaîtra au premier mouvement.</>
                                      : <>Pas encore d&apos;historique — la courbe des prix se construit à chaque facture lue.</>}
                                  </p>
                                )}
                                {ficheLoading === g.id && !fiches[g.id] && (
                                  <p className="mb-2.5 text-[11px] text-gray-400">Chargement du détail des achats…</p>
                                )}
                                <BlocAchatsMensuels fiche={fiches[g.id]} baseUnit={g.base_unit} />
                                {/* Comparaison fournisseurs : dernier prix connu de chacun, du moins cher au plus cher */}
                                {(() => {
                                  const rows = supplierRows(g)
                                  if (rows.length < 2) return null
                                  const cheapest = rows[0]
                                  return (
                                    <div className="mb-2.5 bg-white border border-gray-100 rounded-xl overflow-hidden">
                                      <div className="px-3.5 py-2 bg-gray-50/80">
                                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Comparaison fournisseurs — dernier prix connu de chacun</p>
                                      </div>
                                      <div className="divide-y divide-gray-50">
                                        {rows.map(row => {
                                          const gapPct = cheapest.price > 0 ? Math.round(((row.price - cheapest.price) / cheapest.price) * 1000) / 10 : null
                                          const age = priceAge(row.date)
                                          const vieux = age !== null && age > 30
                                          return (
                                            <div key={row.sup} className="px-3.5 py-2 flex items-center gap-3 flex-wrap text-xs">
                                              <span className="font-semibold text-gray-800 flex-1 min-w-[140px]">{row.sup}</span>
                                              <span className={`tabular ${vieux ? 'text-amber-600 font-semibold' : 'text-gray-400'}`} title={vieux ? `Dernier prix il y a ${age} jours — il a pu bouger depuis` : undefined}>
                                                {fmtDate(row.date)}{vieux ? ` (${age} j)` : ''}
                                              </span>
                                              <span className="font-bold text-gray-900 tabular">{fmtEuro(row.price)} / {unitLabel(g.base_unit)}</span>
                                              {row.sup === cheapest.sup ? (
                                                <span className="text-[10px] font-semibold uppercase tracking-wider text-green-700 bg-green-50 rounded-full px-2 py-0.5">le moins cher</span>
                                              ) : gapPct !== null && gapPct > 0 ? (
                                                <span className="text-[11px] font-bold text-red-600 tabular">+{gapPct.toLocaleString('fr-FR')} %</span>
                                              ) : (
                                                <span className="text-[11px] text-gray-400 tabular">=</span>
                                              )}
                                            </div>
                                          )
                                        })}
                                      </div>
                                      <p className="px-3.5 py-1.5 text-[10px] text-gray-400 border-t border-gray-50">
                                        Écarts sur le dernier prix connu de chaque fournisseur, à l&apos;unité de base — les dates comptent : un prix ancien a pu bouger depuis.
                                      </p>
                                    </div>
                                  )
                                })()}
                                <BlocHistoriqueAchats fiche={fiches[g.id]} baseUnit={g.base_unit} />
                                {/* Impact sur les fiches recettes : Δprix × quantité brute, par batch et par unité produite */}
                                {g.recipes_used.length > 0 ? (() => {
                                  const delta = g.price_ht !== null && g.prev_price_ht !== null
                                    ? Math.round((g.price_ht - g.prev_price_ht) * 10000) / 10000
                                    : null
                                  const hasImpact = delta !== null && delta !== 0
                                  return (
                                    <div className="mb-2.5 bg-white border border-gray-100 rounded-xl overflow-hidden">
                                      <div className="px-3.5 py-2 bg-gray-50/80 flex items-center gap-2 flex-wrap">
                                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                                          <ChefHat className="w-3 h-3" />Utilisé dans {g.recipes_used.length} fiche{g.recipes_used.length > 1 ? 's' : ''} recette{g.recipes_used.length > 1 ? 's' : ''}
                                        </p>
                                        {hasImpact && (
                                          <span className={`text-[11px] font-bold tabular ${delta! > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                            dernier mouvement : {delta! > 0 ? '+' : '−'}{fmtEuro(Math.abs(delta!))} / {unitLabel(g.base_unit)}
                                          </span>
                                        )}
                                        {/* D'où à où, et chez qui : un changement de fournisseur est la
                                            cause la plus fréquente d'un saut de prix — le taire rendait
                                            l'écart incompréhensible. */}
                                        {hasImpact && g.prev_price_ht !== null && g.price_ht !== null && (
                                          <span className="text-[11px] text-gray-500 tabular">
                                            {fmtEuro(g.prev_price_ht)}{g.prev_price_supplier ? ` chez ${nomFournisseur(g.prev_price_supplier)}` : ''}
                                            {' → '}
                                            {fmtEuro(g.price_ht)}{g.price_supplier ? ` chez ${nomFournisseur(g.price_supplier)}` : ''}
                                            {g.prev_price_date ? ` (depuis le ${fmtDate(g.prev_price_date)})` : ''}
                                          </span>
                                        )}
                                      </div>
                                      <div className="divide-y divide-gray-50">
                                        {g.recipes_used.map(u => {
                                          const impact = hasImpact ? delta! * u.qty_brute : null
                                          const perUnit = impact !== null && u.yield_qty !== null && u.yield_qty > 0 ? impact / u.yield_qty : null
                                          return (
                                            <div key={u.id} className="px-3.5 py-2 flex items-center gap-3 flex-wrap text-xs">
                                              <Link href={`/dashboard/recettes/${u.id}`} className="font-semibold text-pilote hover:underline flex-1 min-w-[150px]">{u.name}</Link>
                                              <span className="text-gray-400 tabular">{fmtQty(u.qty_brute)} {unitLabel(g.base_unit)} brut / batch</span>
                                              {impact !== null && Math.abs(impact) >= 0.005 && (
                                                <span className={`font-bold tabular ${impact > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                                  {impact > 0 ? '+' : '−'}{fmtEuro(Math.abs(impact))} / batch
                                                  {perUnit !== null && Math.abs(perUnit) >= 0.005 ? ` · ${impact > 0 ? '+' : '−'}${fmtEuro(Math.abs(perUnit))} / ${u.yield_unit || 'unité'}` : ''}
                                                </span>
                                              )}
                                            </div>
                                          )
                                        })}
                                      </div>
                                      {hasImpact && (
                                        <p className="px-3.5 py-1.5 text-[10px] text-gray-400 border-t border-gray-50">
                                          Impact matière seule (Δprix × quantité brute de la fiche) — le coût complet à jour est sur chaque fiche.
                                        </p>
                                      )}
                                    </div>
                                  )
                                })() : (
                                  <p className="mb-2.5 text-[11px] text-gray-400">Utilisé dans aucune fiche recette pour l&apos;instant.</p>
                                )}
                                {g.refs.length === 0 ? (
                                  <p className="text-xs text-gray-400">Aucune réf fournisseur rattachée.</p>
                                ) : (
                                  <div className="space-y-1">
                                    {g.refs.map(r => (
                                      <div key={r.id} className="flex items-center gap-3 text-xs bg-white border border-gray-100 rounded-lg px-3 py-2 flex-wrap">
                                        <span className="font-semibold text-gray-800 flex-1 min-w-[180px]">{r.name}</span>
                                        <span className="text-gray-400">{nomFournisseur(r.supplier_name) || '—'}</span>
                                        <span className="text-gray-500 tabular">
                                          {r.last_price_ht !== null ? `${fmtEuro(Number(r.last_price_ht))}${r.unit ? ` / ${r.unit}` : ''}` : '—'}
                                        </span>
                                        {r.needs_conversion ? (
                                          <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 rounded px-1.5 py-0.5">conversion manquante — à régler dans « À traiter »</span>
                                        ) : (
                                          <span className="font-bold text-gray-900 tabular">
                                            {r.price_base !== null ? `${fmtEuro(r.price_base)} / ${unitLabel(g.base_unit)}` : '—'}
                                          </span>
                                        )}
                                        <VerrouPrixRef r={r} draft={verrouDrafts[r.id] ?? ''}
                                          onDraft={v => setVerrouDrafts(p => ({ ...p, [r.id]: v }))}
                                          onVerrou={poserVerrou} enCours={verrouillant === r.id} />
                                        <button onClick={() => dissociate(r.id, r.name)} title="Renvoyer dans la file d'attente"
                                          className="flex items-center gap-1 font-semibold text-gray-400 hover:text-red-600 transition-colors"><Unlink className="w-3 h-3" />Dissocier</button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-[11px] text-gray-400 border-t border-gray-100 leading-snug">
            Le prix d&apos;un produit est le dernier prix relevé parmi ses réfs fournisseurs, ramené à son unité
            de base par la conversion (« 1 rouleau = 4,5 kg »). Une réf facturée dans une autre unité et sans
            conversion est ignorée pour le prix — réglez-la dans l&apos;onglet « À traiter ». Une hausse est en
            rouge — c&apos;est un coût d&apos;achat. Les fiches recettes s&apos;appuient uniquement sur ces prix.
          </p>
        </div>
      </div>
      ) : null}
    </>
  )
}
