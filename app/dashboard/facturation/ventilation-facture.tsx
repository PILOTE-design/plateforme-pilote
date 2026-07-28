'use client'

// Ventilation propre à UNE facture, sur le RÉFÉRENTIEL de familles et
// sous-familles (margin_families) — sans toucher la répartition des autres
// factures du même fournisseur. Vide = la facture suit la répartition
// fournisseur classique. Le moteur hebdo fait PRIMER cette ventilation.

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useToast } from '@/components/ui/toast'

type VentFamily = { id: string; parent_id: string | null; name: string; is_rachat: boolean }

const fmtEuro = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

export default function VentilationFacture({
  invoice, families, current, onClose, onSaved,
}: {
  invoice: { id: string; supplier_name: string; amount_ht: number }
  families: VentFamily[]
  current: { family_id: string; pct: number }[]
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(current.map(s => [s.family_id, String(s.pct)])))
  const [saving, setSaving] = useState(false)

  // Racines dans l'ordre du référentiel, sous-familles indentées sous la leur
  const ordered = useMemo(() => {
    const roots = families.filter(f => f.parent_id === null)
    return roots.flatMap(r => [r, ...families.filter(f => f.parent_id === r.id)])
  }, [families])

  const total = useMemo(() =>
    Object.values(draft).reduce((s, v) => s + (parseFloat(String(v).replace(',', '.')) || 0), 0), [draft])

  async function save(reset = false) {
    if (saving) return
    const splits = reset ? [] : Object.entries(draft)
      .map(([family_id, v]) => ({ family_id, pct: parseFloat(String(v).replace(',', '.')) || 0 }))
      .filter(s => s.pct > 0)
    if (!reset && splits.length > 0 && (total < 99.5 || total > 100.5)) {
      toast({ variant: 'error', title: `Le total fait ${total.toFixed(0)} % — il doit faire 100 %` })
      return
    }
    setSaving(true)
    const res = await fetch('/api/invoice-splits', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoice_id: invoice.id, splits }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    setSaving(false)
    if (!res?.ok) { toast({ variant: 'error', title: data?.error || 'Enregistrement impossible' }); return }
    toast({ variant: 'success', title: reset ? 'Ventilation propre retirée — la facture suit à nouveau son fournisseur' : 'Ventilation de la facture enregistrée' })
    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-bold text-gray-900">Ventiler cette facture</h2>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
        </div>
        <p className="text-xs text-gray-400 mb-4">
          {invoice.supplier_name} · {fmtEuro(invoice.amount_ht)} HT — cette répartition ne vaut que pour CETTE facture ;
          les autres factures du fournisseur gardent la leur.
        </p>

        <div className="space-y-1 mb-4">
          {ordered.map(f => {
            const isSub = f.parent_id !== null
            const v = draft[f.id] ?? ''
            return (
              <div key={f.id} className={`flex items-center gap-2 ${isSub ? 'pl-5' : ''}`}>
                <span className={`flex-1 truncate ${isSub ? 'text-xs text-gray-500' : 'text-sm font-semibold text-gray-800'}`}>
                  {isSub ? `└ ${f.name}` : f.name}
                  {f.is_rachat && <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider text-gray-400">rachat</span>}
                </span>
                <div className="relative flex-shrink-0">
                  <input inputMode="decimal" value={v}
                    onChange={e => setDraft(prev => ({ ...prev, [f.id]: e.target.value }))}
                    placeholder="—"
                    className="w-16 border border-gray-200 rounded-md pl-2 pr-6 py-1.5 text-sm text-right tabular focus:outline-none focus:ring-2 focus:ring-pilote-200" />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">%</span>
                </div>
              </div>
            )
          })}
        </div>

        <div className={`flex items-center justify-between text-sm font-bold rounded-lg px-3 py-2 mb-4 tabular ${total === 0 ? 'bg-gray-50 text-gray-400' : total >= 99.5 && total <= 100.5 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
          <span>Total</span>
          <span>{total.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %</span>
        </div>

        <div className="flex gap-2">
          {current.length > 0 && (
            <button onClick={() => save(true)} disabled={saving}
              className="text-xs font-semibold text-red-600 border border-red-200 rounded-md px-3 py-2 hover:bg-red-50 transition-colors disabled:opacity-50">
              Retirer
            </button>
          )}
          <button onClick={onClose} className="flex-1 text-sm font-semibold text-gray-600 border border-gray-200 rounded-md px-3 py-2 hover:bg-gray-50 transition-colors">Annuler</button>
          <button onClick={() => save(false)} disabled={saving || total === 0}
            className="flex-1 text-sm font-bold text-white bg-pilote hover:bg-pilote-hover rounded-md px-3 py-2 shadow-card transition-all disabled:opacity-50">
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}
