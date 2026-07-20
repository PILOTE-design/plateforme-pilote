'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Percent, Check, Loader2, Info } from 'lucide-react'

export type Groupe = 'boucherie' | 'charcuterie' | 'traiteur' | 'achat_revente'
export type MappingRow = { source_type: 'famille' | 'achat_categorie'; source_name: string; groupe: Groupe }

export const GROUPES: { key: Groupe; label: string; color: string; active: string }[] = [
  { key: 'boucherie',     label: 'Boucherie',     color: 'text-red-700 bg-red-50 hover:bg-red-100',          active: 'bg-red-600 text-white' },
  { key: 'charcuterie',   label: 'Charcuterie',   color: 'text-orange-700 bg-orange-50 hover:bg-orange-100', active: 'bg-orange-600 text-white' },
  { key: 'traiteur',      label: 'Traiteur',      color: 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100', active: 'bg-emerald-600 text-white' },
  { key: 'achat_revente', label: 'Achat-revente', color: 'text-sky-700 bg-sky-50 hover:bg-sky-100',          active: 'bg-sky-600 text-white' },
]

const ACHAT_CATEGORIES: { key: string; label: string }[] = [
  { key: 'viande',         label: 'Viande (achats)' },
  { key: 'charcuterie',    label: 'Charcuterie (achats)' },
  { key: 'epicerie',       label: 'Épicerie (achats)' },
  { key: 'emballage',      label: 'Emballage' },
  { key: 'frais_generaux', label: 'Frais généraux' },
  { key: 'autre',          label: 'Autre' },
]

/** Pré-remplissage intelligent — le client ajuste ensuite (c'est sa réflexion à la création) */
export function defaultGroupeForFamille(nom: string): Groupe {
  const n = nom.toUpperCase()
  if (/(CHARCUT|SALAISON|SAUCISS|JAMBON|PATE|PÂTÉ|TERRINE)/.test(n)) return 'charcuterie'
  if (/(TRAITEUR|PLAT|ROTISSERIE|RÔTISSERIE|SNACK|SANDWICH)/.test(n)) return 'traiteur'
  if (/(BOEUF|BŒUF|VEAU|AGNEAU|PORC|VOLAILLE|VIANDE|BOUCH|GIBIER|ABAT)/.test(n)) return 'boucherie'
  return 'achat_revente'
}
export function defaultGroupeForCategorie(cat: string): Groupe {
  if (cat === 'viande') return 'boucherie'
  if (cat === 'charcuterie') return 'charcuterie'
  return 'achat_revente'
}

export default function MargesWizard({
  familles,
  existing,
  firstTime,
}: {
  familles: string[]
  existing: MappingRow[]
  firstTime: boolean
}) {
  const router = useRouter()
  const byKey = new Map(existing.map(m => [`${m.source_type}|${m.source_name}`, m.groupe]))
  const init: Record<string, Groupe> = {}
  for (const f of familles) init[`famille|${f}`] = byKey.get(`famille|${f}`) ?? defaultGroupeForFamille(f)
  for (const c of ACHAT_CATEGORIES) init[`achat_categorie|${c.key}`] = byKey.get(`achat_categorie|${c.key}`) ?? defaultGroupeForCategorie(c.key)

  const [choices, setChoices] = useState<Record<string, Groupe>>(init)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setSaving(true); setError('')
    const mappings: MappingRow[] = Object.entries(choices).map(([k, groupe]) => {
      const [source_type, ...rest] = k.split('|')
      return { source_type: source_type as MappingRow['source_type'], source_name: rest.join('|'), groupe }
    })
    const res = await fetch('/api/margin-mappings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mappings }),
    }).catch(() => null)
    if (!res?.ok) { setError('Enregistrement impossible — réessayez.'); setSaving(false); return }
    router.push('/dashboard/marges')
    router.refresh()
  }

  function Row({ k, label, sub }: { k: string; label: string; sub?: string }) {
    return (
      <div className="flex items-center justify-between gap-3 py-2.5 border-t border-gray-50 first:border-t-0">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{label}</p>
          {sub && <p className="text-[11px] text-gray-400">{sub}</p>}
        </div>
        <div className="flex gap-1 flex-shrink-0">
          {GROUPES.map(g => (
            <button key={g.key}
              onClick={() => setChoices(p => ({ ...p, [k]: g.key }))}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${choices[k] === g.key ? g.active + ' shadow-sm' : g.color}`}>
              {g.label}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
        <div className="bg-gradient-to-br from-pilote to-pilote-hover px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center"><Percent className="w-5 h-5 text-white" /></div>
            <div>
              <h2 className="text-lg font-extrabold text-white">{firstTime ? 'Configurons vos marges' : 'Modifier la catégorisation'}</h2>
              <p className="text-xs text-white/70">Rangez chaque famille de vente et chaque catégorie d'achat dans un des 4 groupes — propre à votre boutique, modifiable à tout moment.</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {familles.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">Familles de vente (détectées dans vos rapports)</p>
              <div>{familles.map(f => <Row key={`famille|${f}`} k={`famille|${f}`} label={f} />)}</div>
            </div>
          )}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">Catégories d'achat (factures &amp; charges fixes)</p>
            <div>{ACHAT_CATEGORIES.map(c => <Row key={`achat_categorie|${c.key}`} k={`achat_categorie|${c.key}`} label={c.label} sub={c.key === 'frais_generaux' ? 'Loyer, énergie, assurance… — leur part hebdo pèsera sur le groupe choisi' : undefined} />)}</div>
          </div>

          <div className="bg-pilote-50 border border-pilote-100 rounded-xl p-3.5 flex gap-2.5">
            <Info className="w-4 h-4 text-pilote flex-shrink-0 mt-0.5" />
            <p className="text-xs text-gray-600 leading-relaxed">Pré-rempli d'après les noms — vérifiez chaque ligne : c'est cette correspondance qui déterminera vos marges par groupe. Nouvelles familles détectées plus tard : elles apparaîtront ici à catégoriser.</p>
          </div>

          {error && <p className="text-xs font-semibold text-red-600">{error}</p>}

          <button onClick={save} disabled={saving}
            className="w-full flex items-center justify-center gap-2 bg-pilote hover:bg-pilote-hover text-white font-bold rounded-xl py-3 shadow-card active:scale-[0.99] transition-all disabled:opacity-50">
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" />Enregistrement…</> : <><Check className="w-4 h-4" />Valider ma catégorisation</>}
          </button>
        </div>
      </div>
    </div>
  )
}
