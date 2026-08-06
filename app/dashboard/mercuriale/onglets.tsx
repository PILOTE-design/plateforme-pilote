'use client'

// Mercuriale — les deux onglets de RANGEMENT, sortis de page.tsx au lot 73 :
//   · ORGANISER : chaque article avec ses réfs (déplacer, dissocier, fusionner)
//     et le rapprochement intelligent des doublons d'appellation ;
//   · FOURNISSEURS : la mercuriale de chaque maison, cartes triées par dépense
//     12 mois puis catalogue du fournisseur classé par familles.
// Aucun état, aucun appel API ici : la page passe ses données et ses gestes.

import { type Dispatch, type SetStateAction } from 'react'
import { ChevronRight, Unlink, AlertTriangle, Sparkles, Store } from 'lucide-react'
import { fmtEuro, fmtDate, nomFournisseur, unitLabel, priceAge, MOTIF_PRIX, Variation } from './ui'
import type { Generic, Ref, Vue } from './catalogue'
import ChoixProduit from './choix-produit'

export function VueOrganiser({
  filteredGenerics, assocGenerics, generics, refsAssociees, conversionsManquantes,
  search, visibleQueue, autoFilter, setAutoFilter, hausseFilter, setHausseFilter,
  runSmart, smartLoading, smartSuggestions, setSmartSuggestions, smartNames, setSmartNames,
  pickTarget, applySuggestion, merging, mergeSel, setMergeSel, doMerge,
  fixDrafts, setFixDrafts, fixConversion, moveRef, dissociate,
  setView, setOpenId, setEditId,
}: {
  filteredGenerics: Generic[]
  assocGenerics: Generic[]
  generics: Generic[]
  refsAssociees: number
  conversionsManquantes: number
  search: string
  visibleQueue: Ref[]
  autoFilter: boolean
  setAutoFilter: Dispatch<SetStateAction<boolean>>
  hausseFilter: boolean
  setHausseFilter: Dispatch<SetStateAction<boolean>>
  runSmart: () => Promise<void>
  smartLoading: boolean
  smartSuggestions: { name: string; ids: string[] }[] | null
  setSmartSuggestions: Dispatch<SetStateAction<{ name: string; ids: string[] }[] | null>>
  smartNames: Record<string, string>
  setSmartNames: Dispatch<SetStateAction<Record<string, string>>>
  pickTarget: (ids: string[]) => Generic | null
  applySuggestion: (key: string, s: { name: string; ids: string[] }) => Promise<void>
  merging: boolean
  mergeSel: Record<string, string>
  setMergeSel: Dispatch<SetStateAction<Record<string, string>>>
  doMerge: (targetId: string, sourceIds: string[], newName?: string) => Promise<boolean>
  fixDrafts: Record<string, string>
  setFixDrafts: Dispatch<SetStateAction<Record<string, string>>>
  fixConversion: (r: Ref, genericId: string) => Promise<void>
  moveRef: (r: Ref, genericId: string) => Promise<void>
  dissociate: (refId: string, refName: string) => Promise<void>
  setView: Dispatch<SetStateAction<Vue>>
  setOpenId: Dispatch<SetStateAction<string | null>>
  setEditId: Dispatch<SetStateAction<string | null>>
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-700">Organiser le catalogue</h2>
          <span className="text-[11px] text-gray-400 tabular">{filteredGenerics.length} produit{filteredGenerics.length > 1 ? 's' : ''} · {refsAssociees} réf{refsAssociees > 1 ? 's' : ''} rattachée{refsAssociees > 1 ? 's' : ''}</span>
        </div>
        <button onClick={runSmart} disabled={smartLoading}
          className="flex items-center gap-1.5 text-xs font-bold text-white bg-pilote hover:bg-pilote-hover rounded-xl px-3.5 py-2 shadow-card active:scale-[0.98] transition-all disabled:opacity-50">
          <Sparkles className="w-3.5 h-3.5" />{smartLoading ? 'Lecture intelligente…' : 'Rapprochement intelligent'}
        </button>
      </div>
      <p className="text-[11px] text-gray-400 mb-3">
        Chaque produit avec ses réfs fournisseurs : déplacez une réf mal rangée, dissociez-la, fusionnez deux produits en doublon.
        Le rapprochement intelligent repère les doublons d&apos;appellation entre fournisseurs (« cervelas » acheté chez trois maisons) — chaque fusion se valide.
      </p>

      {/* Fusions proposées par la lecture intelligente — à valider une par une */}
      {smartSuggestions !== null && smartSuggestions.length > 0 && (
        <div className="mb-4 space-y-2.5">
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{smartSuggestions.length} fusion{smartSuggestions.length > 1 ? 's' : ''} proposée{smartSuggestions.length > 1 ? 's' : ''} — rien n&apos;est fait sans votre accord</p>
          {smartSuggestions.map(s => {
            const key = s.ids.join(',')
            const target = pickTarget(s.ids)
            const members = s.ids.map(id => generics.find(g => g.id === id)).filter((g): g is Generic => !!g)
            if (!target || members.length < 2) return null
            return (
              <div key={key} className="bg-white rounded-2xl border border-pilote-200 shadow-card p-4">
                <div className="flex items-center gap-3 flex-wrap mb-2.5">
                  <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Appellation</span>
                  <input value={smartNames[key] ?? s.name}
                    onChange={e => setSmartNames(p => ({ ...p, [key]: e.target.value }))}
                    className="border border-gray-200 rounded-xl px-3 py-1.5 text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-pilote-200 min-w-[180px]" />
                  <span className="text-[11px] text-gray-400">/ {unitLabel(target.base_unit)} · les réfs des autres rejoignent « {target.name} »</span>
                  <span className="flex-1" />
                  <button onClick={() => applySuggestion(key, s)} disabled={merging}
                    className="text-xs font-bold text-white bg-pilote hover:bg-pilote-hover rounded-xl px-3.5 py-2 shadow-card active:scale-[0.98] transition-all disabled:opacity-50">
                    {merging ? 'Fusion…' : `Fusionner les ${members.length}`}
                  </button>
                  <button onClick={() => setSmartSuggestions(prev => prev ? prev.filter(x => x.ids.join(',') !== key) : prev)}
                    className="text-xs font-semibold text-gray-500 rounded-xl px-3 py-2 hover:bg-gray-100 transition-colors">Ignorer</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {members.map(m => (
                    <span key={m.id} className="text-[11px] text-gray-600 bg-gray-50 ring-1 ring-gray-100 rounded-full px-2.5 py-1 tabular">
                      {m.name} · {m.refs_count} réf{m.refs_count > 1 ? 's' : ''} / {unitLabel(m.base_unit)}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {conversionsManquantes > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center gap-2 text-xs text-amber-800">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span><strong>{conversionsManquantes} réf{conversionsManquantes > 1 ? 's' : ''} sans conversion d&apos;unité</strong> — leur prix est ignoré (jamais pris tel quel) tant que la conversion n&apos;est pas renseignée. Encadrés orange ci-dessous.</span>
        </div>
      )}
      {filteredGenerics.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-gray-200 py-12 text-center">
          <p className="text-sm font-medium text-gray-500">Aucun article générique{search ? ' ne correspond à la recherche' : ''}</p>
          {/* Le mot cherché peut ne vivre que dans une réf PAS ENCORE
              rapprochée : le catalogue disparaissait alors sans un mot,
              alors que la réponse était dans la file juste à côté. */}
          {search && visibleQueue.length > 0 && (
            <p className="text-xs text-gray-500 mt-2">
              Mais {visibleQueue.length} réf{visibleQueue.length > 1 ? 's' : ''} pas encore rapprochée{visibleQueue.length > 1 ? 's' : ''} correspond{visibleQueue.length > 1 ? 'ent' : ''} à « {search.trim()} » —{' '}
              <button onClick={() => setView('traiter')} className="font-semibold text-pilote hover:underline">voir dans « À traiter »</button>.
            </p>
          )}
          {search && autoFilter && (
            <p className="text-xs text-gray-500 mt-2">
              Le filtre « Auto à vérifier » est actif —{' '}
              <button onClick={() => setAutoFilter(false)} className="font-semibold text-pilote hover:underline">le retirer</button>.
            </p>
          )}
          {search && hausseFilter && (
            <p className="text-xs text-gray-500 mt-2">
              Le filtre « Prix en hausse » est actif —{' '}
              <button onClick={() => setHausseFilter(false)} className="font-semibold text-pilote hover:underline">le retirer</button>.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {assocGenerics.map(g => (
            <div key={g.id} className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50/80 flex items-center gap-2 flex-wrap">
                <p className="text-sm font-bold text-gray-900">{g.name}</p>
                <span className={`text-[10px] font-semibold uppercase tracking-wider rounded-lg px-1.5 py-0.5 ${g.category === 'emballage' ? 'text-blue-700 bg-blue-50' : 'text-pilote bg-pilote-50'}`}>
                  {g.category === 'emballage' ? 'Emballage' : 'Ingrédient'}
                </span>
                {g.auto_created && (
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-pilote bg-pilote-50 ring-1 ring-pilote-100 rounded-full px-2 py-0.5" title="Créé par l'association automatique — vérifiez nom et unité">Auto</span>
                )}
                <span className="text-[11px] text-gray-400">/ {unitLabel(g.base_unit)}</span>
                <span className="flex-1" />
                <span className="text-xs font-bold text-gray-900 tabular" title={g.price_ht === null && g.price_missing_reason ? MOTIF_PRIX[g.price_missing_reason]?.quoi_faire : undefined}>
                  {g.price_ht !== null
                    ? `${fmtEuro(Number(g.price_ht))} / ${unitLabel(g.base_unit)}`
                    : <span className="text-amber-600">pas de prix — {MOTIF_PRIX[g.price_missing_reason ?? 'jamais_facture']?.court}</span>}
                </span>
                {/* Cherchable, et surtout DESSINÉ À L'OUVERTURE. Ce menu listait
                    le catalogue entier, une fois par article : avec G articles,
                    G² éléments dans la page — la page se figeait bien avant tout
                    plafond serveur. */}
                <ChoixProduit
                  produits={generics.filter(x => x.id !== g.id)}
                  value={mergeSel[g.id] ?? ''}
                  onChange={v => setMergeSel(p => ({ ...p, [g.id]: v }))}
                  placeholder="Fusionner dans…"
                  unite={unitLabel}
                  className="w-[190px]"
                />
                {mergeSel[g.id] && (
                  <button onClick={async () => { const ok = await doMerge(mergeSel[g.id], [g.id]); if (ok) setMergeSel(p => ({ ...p, [g.id]: '' })) }} disabled={merging}
                    className="text-[11px] font-bold text-white bg-pilote hover:bg-pilote-hover rounded-lg px-2.5 py-1 shadow-card transition-colors disabled:opacity-50">
                    Confirmer
                  </button>
                )}
                <button onClick={() => { setView('prix'); setOpenId(g.id); setEditId(null) }}
                  className="text-[11px] font-semibold text-pilote hover:underline">Ouvrir dans Prix du jour</button>
              </div>
              {g.refs.length === 0 ? (
                <p className="px-4 py-3 text-xs text-gray-400">Aucune réf fournisseur rattachée.</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {[...g.refs].sort((a, b) => (b.needs_conversion ? 1 : 0) - (a.needs_conversion ? 1 : 0)).map(r => (
                    <div key={r.id} className="px-4 py-2 flex items-center gap-3 flex-wrap text-xs">
                      <span className="font-semibold text-gray-800 flex-1 min-w-[170px]">{r.name}</span>
                      <span className="text-gray-400">{nomFournisseur(r.supplier_name) || '—'}</span>
                      <span className="text-gray-500 tabular">{r.last_price_ht !== null ? `${fmtEuro(Number(r.last_price_ht))}${r.unit ? ` / ${r.unit}` : ''}` : '—'}</span>
                      {r.needs_conversion ? (
                        <span className="flex items-center gap-1.5 text-[11px] text-amber-700 bg-amber-50 ring-1 ring-amber-200 rounded-lg px-2 py-1 tabular">
                          1 {r.unit || 'unité'} =
                          <input value={fixDrafts[r.id] ?? ''} inputMode="decimal" placeholder="?"
                            onChange={e => setFixDrafts(p => ({ ...p, [r.id]: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') fixConversion(r, g.id) }}
                            className="w-14 border border-amber-300 rounded px-1.5 py-0.5 text-right tabular bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                          {unitLabel(g.base_unit)}
                          <button onClick={() => fixConversion(r, g.id)}
                            className="font-bold text-white bg-pilote hover:bg-pilote-hover rounded px-1.5 py-0.5 transition-colors">OK</button>
                        </span>
                      ) : (
                        <span className="font-bold text-gray-900 tabular">{r.price_base !== null ? `${fmtEuro(r.price_base)} / ${unitLabel(g.base_unit)}` : '—'}</span>
                      )}
                      {/* Idem, et pire encore : celui-ci était dessiné par RÉF,
                          soit R×G éléments de plus. Une réf peut désormais aller
                          vers n'importe quel produit du catalogue, en le
                          cherchant. */}
                      <ChoixProduit
                        produits={generics.filter(x => x.id !== g.id)}
                        value=""
                        onChange={v => { if (v) moveRef(r, v) }}
                        placeholder="Déplacer vers…"
                        unite={unitLabel}
                        className="w-[190px]"
                      />
                      <button onClick={() => dissociate(r.id, r.name)} title="Renvoyer dans la file « À rapprocher »"
                        className="flex items-center gap-1 font-semibold text-gray-400 hover:text-red-600 transition-colors"><Unlink className="w-3 h-3" />Dissocier</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function VueFournisseurs({
  cartesFournisseurs, refsParFournisseur, catalogueFournisseur,
  fournisseurSel, setFournisseurSel, search, setSearch,
  setView, setOpenId, setEditId,
}: {
  cartesFournisseurs: { nom: string; nbRefs: number; dernier: string | null; depense: number; factures: number }[]
  refsParFournisseur: Map<string, { refs: { r: Ref; g: Generic | null }[]; dernier: string | null }>
  catalogueFournisseur: { titre: string; refs: { r: Ref; g: Generic | null }[] }[] | null
  fournisseurSel: string | null
  setFournisseurSel: Dispatch<SetStateAction<string | null>>
  search: string
  setSearch: Dispatch<SetStateAction<string>>
  setView: Dispatch<SetStateAction<Vue>>
  setOpenId: Dispatch<SetStateAction<string | null>>
  setEditId: Dispatch<SetStateAction<string | null>>
}) {
  return (
    fournisseurSel === null ? (
      <div>
        <div className="flex items-baseline gap-2 mb-3">
          <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-700">Mes fournisseurs</h2>
          <span className="text-[11px] text-gray-400 tabular">
            {cartesFournisseurs.length} maison{cartesFournisseurs.length > 1 ? 's' : ''} · triées par dépense sur 12 mois
          </span>
        </div>
        {cartesFournisseurs.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-gray-200 py-14 text-center">
            <Store className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-500">Aucun fournisseur pour l&apos;instant — ils apparaîtront à la première facture lue.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cartesFournisseurs
              .filter(f => !search.trim() || f.nom.toLowerCase().includes(search.trim().toLowerCase()))
              .map(f => (
                <button key={f.nom} onClick={() => setFournisseurSel(f.nom)}
                  className="text-left bg-white rounded-2xl border border-gray-100 shadow-card p-5 hover:shadow-card-hover hover:-translate-y-0.5 transition-all">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-pilote-50 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-extrabold text-pilote">{f.nom.slice(0, 2).toUpperCase()}</span>
                    </div>
                    <p className="text-sm font-bold text-gray-900 leading-snug flex-1">{f.nom}</p>
                  </div>
                  <p className="text-2xl font-extrabold tracking-tight text-gray-900 tabular">
                    {f.depense > 0 ? fmtEuro(f.depense) : '—'}
                    <span className="text-xs font-semibold text-gray-400 ml-1.5">/ 12 mois</span>
                  </p>
                  <p className="text-[11px] text-gray-500 mt-2 tabular">
                    {f.nbRefs} réf{f.nbRefs > 1 ? 's' : ''}
                    {f.factures > 0 ? ` · ${f.factures} facture${f.factures > 1 ? 's' : ''}` : ''}
                    {f.dernier ? ` · dernier achat ${fmtDate(f.dernier)}` : ''}
                  </p>
                </button>
              ))}
          </div>
        )}
      </div>
    ) : (
      <div>
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <button onClick={() => setFournisseurSel(null)}
            className="flex items-center gap-1 text-xs font-semibold text-pilote hover:underline">
            <ChevronRight className="w-3.5 h-3.5 rotate-180" />Tous les fournisseurs
          </button>
          <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-700">{fournisseurSel}</h2>
          <span className="text-[11px] text-gray-400 tabular">
            {refsParFournisseur.get(fournisseurSel)?.refs.length ?? 0} réf{(refsParFournisseur.get(fournisseurSel)?.refs.length ?? 0) > 1 ? 's' : ''}
            {(() => { const d = refsParFournisseur.get(fournisseurSel)?.dernier; return d ? ` · dernier achat ${fmtDate(d)}` : '' })()}
          </span>
        </div>
        {(catalogueFournisseur ?? []).length === 0 && (
          <div className="bg-white rounded-2xl border border-dashed border-gray-200 py-12 text-center">
            <p className="text-sm font-medium text-gray-500">Aucune réf{search ? ' ne correspond à la recherche' : ''} chez ce fournisseur.</p>
          </div>
        )}
        {(catalogueFournisseur ?? []).map(sec => (
          <div key={sec.titre} className="mb-5">
            <div className="flex items-baseline gap-2 mb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">{sec.titre}</h3>
              <span className="text-[11px] text-gray-400 tabular">{sec.refs.length}</span>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden divide-y divide-gray-50">
              {sec.refs.map(({ r, g }) => (
                <div key={r.id} className="px-4 py-2.5 flex items-center gap-3 flex-wrap text-xs">
                  <span className="flex-1 min-w-[220px]">
                    <span className="text-sm font-semibold text-gray-900">{r.name}</span>
                    {g ? (
                      <button onClick={() => { setView('prix'); setSearch(''); setOpenId(g.id); setEditId(null) }}
                        title="Ouvrir cet article dans « Prix du jour »"
                        className="ml-1.5 text-[10px] font-semibold text-pilote bg-pilote-50 ring-1 ring-pilote-100 rounded-full px-2 py-0.5 hover:bg-pilote-100 transition-colors">
                        {g.name}
                      </button>
                    ) : (
                      <span className="ml-1.5 text-[10px] font-semibold text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">à rapprocher</span>
                    )}
                  </span>
                  <span className="text-gray-400 w-12 text-center flex-shrink-0">{r.unit || '—'}</span>
                  {(() => {
                    const d = r.last_seen || r.last_price_date
                    const age = priceAge(d ? String(d).slice(0, 10) : null)
                    const vieux = age !== null && age > 30
                    return (
                      <span className={`tabular w-24 text-right flex-shrink-0 ${vieux ? 'text-amber-600 font-semibold' : 'text-gray-400'}`}
                        title={vieux ? `Dernier achat il y a ${age} jours — ce prix a pu bouger depuis` : undefined}>
                        {d ? fmtDate(String(d).slice(0, 10)) : '—'}
                      </span>
                    )
                  })()}
                  <span className="font-bold text-gray-900 tabular w-28 text-right flex-shrink-0">
                    {r.last_price_ht !== null ? `${fmtEuro(Number(r.last_price_ht))}${r.unit ? ` / ${r.unit}` : ''}` : '—'}
                  </span>
                  <span className="w-16 text-right flex-shrink-0"><Variation pct={r.variation_pct} /></span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  )
}
