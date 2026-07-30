'use client'

// Réglages MODIFIABLES en ligne dans le tableau des marges :
//   · RepereEditor — deux petits champs (bas-haut, en %) ;
//   · StemsEditor  — les MOTS-CLÉS qui rattachent un libellé de caisse à la
//     famille (« ma caisse écrit BOVIN, pas VIANDE DE BOEUF »).
// Les deux enregistrent au blur/Entrée via PUT /api/margin-families/[id], puis
// router.refresh() pour que le serveur recalcule.
// familyId null = famille non présente au référentiel (réglage figé).

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function RepereEditor({ familyId, lo, hi }: { familyId: string | null; lo: number | null; hi: number | null }) {
  const router = useRouter()
  const [vLo, setVLo] = useState(lo !== null ? String(lo) : '')
  const [vHi, setVHi] = useState(hi !== null ? String(hi) : '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(false)

  if (!familyId) return <span className="text-[11px] text-gray-400 tabular">{lo !== null && hi !== null ? `${lo}-${hi} %` : '—'}</span>

  async function save() {
    if (saving) return
    const lo2 = vLo.trim() === '' ? null : Number(vLo.replace(',', '.'))
    const hi2 = vHi.trim() === '' ? null : Number(vHi.replace(',', '.'))
    if (lo2 === (lo ?? null) && hi2 === (hi ?? null)) return
    setSaving(true)
    setErr(false)
    const res = await fetch(`/api/margin-families/${familyId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ benchmark_lo: lo2, benchmark_hi: hi2 }),
    }).catch(() => null)
    setSaving(false)
    if (res?.ok) router.refresh()
    else setErr(true)
  }

  const cls = `w-9 border rounded px-1 py-0.5 text-[11px] text-right tabular bg-white focus:outline-none focus:ring-1 focus:ring-pilote-200 ${err ? 'border-red-300' : 'border-gray-200'}`
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }

  return (
    <span className={`inline-flex items-center gap-0.5 ${saving ? 'opacity-50' : ''}`} title="Repère de marge (%) — modifiable, enregistré à la sortie du champ">
      <input value={vLo} onChange={e => setVLo(e.target.value)} onBlur={save} onKeyDown={onKey} inputMode="decimal" placeholder="–" className={cls} />
      <span className="text-[10px] text-gray-400">-</span>
      <input value={vHi} onChange={e => setVHi(e.target.value)} onBlur={save} onKeyDown={onKey} inputMode="decimal" placeholder="–" className={cls} />
      <span className="text-[10px] text-gray-400 ml-0.5">%</span>
    </span>
  )
}

/** Mots-clés de reconnaissance d'une famille : ce qui rattache le libellé brut de
 *  la caisse (« VIANDE DE BOEUF », « BOVIN », « GROS BOVIN »…) à cette famille.
 *  Repliés par défaut — c'est un réglage d'installation, pas une lecture
 *  quotidienne. Saisie en clair, séparés par des virgules. */
export function StemsEditor({ familyId, stems }: { familyId: string | null; stems: string[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(stems.join(', '))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(false)

  if (!familyId) return null

  async function save() {
    if (saving) return
    const next = value.split(',').map(s => s.trim()).filter(Boolean)
    if (next.join('|') === stems.join('|')) { setOpen(false); return }
    if (next.length === 0) { setErr(true); return }
    setSaving(true)
    setErr(false)
    const res = await fetch(`/api/margin-families/${familyId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ match_stems: next }),
    }).catch(() => null)
    setSaving(false)
    if (res?.ok) { setOpen(false); router.refresh() } else setErr(true)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-[10px] text-gray-400 hover:text-pilote hover:underline transition-colors"
        title="Mots-clés qui rattachent un libellé de caisse à cette famille"
      >
        {stems.length > 0 ? `mots-clés : ${stems.slice(0, 3).join(', ')}${stems.length > 3 ? '…' : ''}` : 'définir les mots-clés'}
      </button>
    )
  }

  return (
    <span className={`inline-flex items-center gap-1 ${saving ? 'opacity-50' : ''}`}>
      <input
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={e => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') { setValue(stems.join(', ')); setOpen(false) }
        }}
        placeholder="boeuf, bovin, veau"
        className={`w-56 border rounded-lg px-2 py-1 text-[11px] bg-white focus:outline-none focus:ring-1 focus:ring-pilote-200 ${err ? 'border-red-300' : 'border-gray-200'}`}
      />
      <span className="text-[10px] text-gray-400">séparés par des virgules</span>
    </span>
  )
}
