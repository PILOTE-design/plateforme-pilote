'use client'

// Repère de marge MODIFIABLE, en ligne dans le tableau des marges : deux petits
// champs (bas-haut, en %) enregistrés au blur/Entrée via PUT
// /api/margin-families/[id], puis router.refresh() pour recalculer les couleurs
// côté serveur. familyId null = famille non présente au référentiel (repère figé).

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
