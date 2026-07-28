'use client'

// Planning de production — le troisième étage du chantier mercuriale → recettes →
// production. On choisit un jour, on pose ce qu'on fabrique (recette × batchs, et
// qui s'en charge) ; la page en déduit la charge de travail par personne — face
// aux heures pointées au planning ce jour-là — et la liste d'ingrédients agrégée,
// valorisée au prix mercuriale. Rien n'est copié : modifier une fiche recette met
// à jour tous les jours de production.

import { useCallback, useEffect, useState } from 'react'
import { Factory, Plus, X, ChevronLeft, ChevronRight, Clock, ShoppingBasket, Users } from 'lucide-react'
import Link from 'next/link'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Button } from '@/components/ui/button'

type Order = {
  id: string; recipe_id: string; recipe_name: string
  yield_qty: number | null; yield_unit: string | null
  batches: number; minutes: number; matiere: number; cost_total: number
  employee_id: string | null; employee_name: string | null; status: string
}
type Need = { label: string; unit: string | null; total_qty: number; unit_price_ht: number | null; total_cost: number; missing_price: boolean }
type Load = { employee_id: string | null; employee_name: string; minutes: number; planned_hours: number | null; charge_pct: number | null }
type RecipeOpt = { id: string; name: string; yield_qty: number | null; yield_unit: string | null }
type EmployeeOpt = { id: string; name: string }

const fmtEuro = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const fmtMin = (m: number) => {
  const h = Math.floor(m / 60), mn = Math.round(m % 60)
  return h > 0 ? `${h} h${mn > 0 ? ` ${String(mn).padStart(2, '0')}` : ''}` : `${mn} min`
}
const todayISO = () => new Date().toISOString().slice(0, 10)
const shiftDay = (iso: string, delta: number) => {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}
const dayLabel = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

export default function ProductionPage() {
  const { toast } = useToast()
  const { confirm: confirmAction } = useConfirm()
  const [date, setDate] = useState(todayISO())
  const [orders, setOrders] = useState<Order[]>([])
  const [needs, setNeeds] = useState<Need[]>([])
  const [workload, setWorkload] = useState<Load[]>([])
  const [totals, setTotals] = useState<{ minutes: number; matiere: number; labor_rate_ht: number | null } | null>(null)
  const [recipes, setRecipes] = useState<RecipeOpt[]>([])
  const [employees, setEmployees] = useState<EmployeeOpt[]>([])
  const [loading, setLoading] = useState(true)

  // Ajout
  const [addRecipe, setAddRecipe] = useState('')
  const [addBatches, setAddBatches] = useState('1')
  const [addEmployee, setAddEmployee] = useState('')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async (d: string) => {
    setLoading(true)
    const data = await fetch(`/api/production?date=${d}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null)
    if (data) {
      setOrders(data.orders || []); setNeeds(data.ingredients || [])
      setWorkload(data.workload || []); setTotals(data.totals || null)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load(date) }, [date, load])
  useEffect(() => {
    fetch('/api/recipes', { cache: 'no-store' }).then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.recipes) setRecipes(d.recipes.map((r: any) => ({ id: r.id, name: r.name, yield_qty: r.yield_qty, yield_unit: r.yield_unit }))) })
      .catch(() => {})
    fetch('/api/employees', { cache: 'no-store' }).then(r => r.ok ? r.json() : null)
      .then(d => { if (Array.isArray(d)) setEmployees(d.map((e: any) => ({ id: e.id, name: e.name }))) })
      .catch(() => {})
  }, [])

  async function addOrder() {
    if (!addRecipe) return
    setAdding(true)
    const res = await fetch('/api/production', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ production_date: date, recipe_id: addRecipe, batches: parseFloat(addBatches.replace(',', '.')) || 1, employee_id: addEmployee || null }),
    }).catch(() => null)
    setAdding(false)
    if (res?.ok) { setAddBatches('1'); load(date) }
    else toast({ variant: 'error', title: 'Ajout impossible', description: (await res?.json().catch(() => null))?.error })
  }

  async function patchOrder(id: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/production/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    }).catch(() => null)
    if (res?.ok) load(date)
    else toast({ variant: 'error', title: 'Modification impossible' })
  }

  async function removeOrder(id: string, name: string) {
    const ok = await confirmAction({
      title: `Retirer « ${name} » de la production ?`,
      description: 'La fiche recette n’est pas touchée, seul ce jour de production l’oublie.',
      confirmLabel: 'Retirer', variant: 'danger',
    })
    if (!ok) return
    const res = await fetch(`/api/production/${id}`, { method: 'DELETE' }).catch(() => null)
    if (res?.ok) { toast({ variant: 'info', title: 'Production retirée' }); load(date) }
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      {/* En-tête */}
      <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-pilote to-pilote-hover rounded-2xl flex items-center justify-center flex-shrink-0 shadow-card">
            <Factory className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Production</h1>
            <p className="text-sm text-gray-500 mt-1">Charge par personne et liste d&apos;ingrédients, déduites de vos fiches recettes</p>
          </div>
        </div>
      </div>

      {/* Navigation jour */}
      <div className="mb-6 flex items-center gap-2 flex-wrap">
        <button onClick={() => setDate(d => shiftDay(d, -1))} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50"><ChevronLeft className="w-4 h-4 text-gray-500" /></button>
        <input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-pilote-200" />
        <button onClick={() => setDate(d => shiftDay(d, 1))} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50"><ChevronRight className="w-4 h-4 text-gray-500" /></button>
        <span className="text-sm font-bold text-gray-700 capitalize ml-1">{dayLabel(date)}</span>
        {date !== todayISO() && (
          <button onClick={() => setDate(todayISO())} className="text-xs font-semibold text-pilote hover:underline">Aujourd&apos;hui</button>
        )}
        {totals && orders.length > 0 && (
          <span className="ml-auto text-xs text-gray-500 tabular">
            <Clock className="w-3.5 h-3.5 inline mr-1 text-gray-400" />{fmtMin(totals.minutes)} de fabrication ·
            matière {fmtEuro(totals.matiere)}
          </span>
        )}
      </div>

      {/* Ajout */}
      <div className="mb-6 bg-white rounded-2xl border border-gray-100 shadow-card p-4 flex items-center gap-2 flex-wrap">
        <select value={addRecipe} onChange={e => setAddRecipe(e.target.value)}
          className="flex-1 min-w-[180px] h-10 border border-gray-200 rounded-lg px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200">
          <option value="">Choisir une recette…</option>
          {recipes.map(r => <option key={r.id} value={r.id}>{r.name}{r.yield_qty ? ` (${r.yield_qty} ${r.yield_unit || ''}/batch)` : ''}</option>)}
        </select>
        <input inputMode="decimal" value={addBatches} onChange={e => setAddBatches(e.target.value)} placeholder="Batchs"
          className="w-20 h-10 border border-gray-200 rounded-lg px-3 text-sm text-right tabular focus:outline-none focus:ring-2 focus:ring-pilote-200" />
        <select value={addEmployee} onChange={e => setAddEmployee(e.target.value)}
          className="w-40 h-10 border border-gray-200 rounded-lg px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200">
          <option value="">Non affecté</option>
          {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <Button onClick={addOrder} disabled={adding || !addRecipe} className="bg-pilote hover:bg-pilote-hover text-white">
          <Plus className="w-4 h-4 mr-1.5" />{adding ? 'Ajout…' : 'Ajouter'}
        </Button>
        {recipes.length === 0 && (
          <p className="w-full text-[11px] text-gray-400">Aucune recette — créez d&apos;abord vos <Link href="/dashboard/recettes" className="text-pilote font-semibold hover:underline">fiches recettes</Link>.</p>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : orders.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-gray-200 py-16 text-center">
          <Factory className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-500 mb-1">Rien de planifié ce jour</p>
          <p className="text-xs text-gray-400">Ajoutez une recette ci-dessus : la charge et les ingrédients se calculent seuls.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Ordres du jour */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-bold text-gray-900">À fabriquer</p>
            </div>
            <div className="divide-y divide-gray-100">
              {orders.map(o => (
                <div key={o.id} className={`px-4 py-3 flex items-center gap-3 flex-wrap ${o.status === 'fait' ? 'bg-green-50/40' : ''}`}>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={o.status === 'fait'}
                      onChange={e => patchOrder(o.id, { status: e.target.checked ? 'fait' : 'planifie' })}
                      className="w-4 h-4 rounded border-gray-300 text-pilote focus:ring-pilote-200" />
                  </label>
                  <div className="flex-1 min-w-[160px]">
                    <p className={`text-sm font-semibold ${o.status === 'fait' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{o.recipe_name}</p>
                    <p className="text-[11px] text-gray-400 tabular">
                      {o.batches} batch{o.batches > 1 ? 's' : ''}
                      {o.yield_qty ? ` = ${(o.batches * o.yield_qty).toLocaleString('fr-FR')} ${o.yield_unit || ''}` : ''}
                      {' · '}{fmtMin(o.minutes)} · matière {fmtEuro(o.matiere)}
                    </p>
                  </div>
                  <select value={o.employee_id || ''} onChange={e => patchOrder(o.id, { employee_id: e.target.value || null })}
                    className="h-9 border border-gray-200 rounded-lg px-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-pilote-200">
                    <option value="">Non affecté</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                  <button onClick={() => removeOrder(o.id, o.recipe_name)} className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Charge par personne */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-card p-5">
              <p className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2"><Users className="w-4 h-4 text-pilote" />Charge par personne</p>
              <div className="space-y-3">
                {workload.map(w => (
                  <div key={w.employee_id || 'none'}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className={`font-semibold ${w.employee_id ? 'text-gray-700' : 'text-amber-600'}`}>{w.employee_name}</span>
                      <span className="text-gray-500 tabular">
                        {fmtMin(w.minutes)}
                        {w.planned_hours !== null && w.planned_hours > 0 ? ` / ${w.planned_hours} h au planning` : ''}
                        {w.charge_pct !== null ? ` · ${w.charge_pct} %` : ''}
                      </span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${
                        w.charge_pct === null ? 'bg-pilote-200'
                        : w.charge_pct > 100 ? 'bg-red-500'
                        : w.charge_pct > 90 ? 'bg-amber-500'
                        : 'bg-pilote'
                      }`} style={{ width: `${Math.min(100, w.charge_pct ?? (w.minutes > 0 ? 40 : 0))}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-3 leading-snug">
                La jauge compare les minutes de fabrication aux heures pointées au <Link href="/dashboard/planning" className="text-pilote font-medium hover:underline">planning</Link> ce jour-là.
                Au-delà de 90 % la journée est pleine — la vente et le reste du travail n&apos;ont plus de place.
              </p>
            </div>

            {/* Liste d'ingrédients */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-card overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <p className="text-sm font-bold text-gray-900 flex items-center gap-2"><ShoppingBasket className="w-4 h-4 text-pilote" />Ingrédients nécessaires</p>
                <span className="text-xs text-gray-500 tabular font-semibold">{fmtEuro(needs.reduce((s, n) => s + n.total_cost, 0))}</span>
              </div>
              <table className="w-full">
                <tbody>
                  {needs.map((n, i) => (
                    <tr key={i} className="border-b border-gray-50 last:border-0">
                      <td className="px-5 py-2 text-sm text-gray-800">{n.label}</td>
                      <td className="px-2 py-2 text-right text-sm font-semibold text-gray-900 tabular whitespace-nowrap">
                        {n.total_qty.toLocaleString('fr-FR')} {n.unit || ''}
                      </td>
                      <td className="px-5 py-2 text-right text-xs tabular whitespace-nowrap">
                        {n.missing_price
                          ? <span className="text-amber-600 font-semibold">prix ?</span>
                          : <span className="text-gray-500">{fmtEuro(n.total_cost)}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-5 py-3 text-[11px] text-gray-400 border-t border-gray-100">
                Quantités agrégées sur toutes les fabrications du jour, valorisées au dernier prix mercuriale — votre liste de sortie de chambre froide ou de commande.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
