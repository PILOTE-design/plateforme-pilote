// Planning de production — un jour, ses ordres de fabrication, et tout ce qui s'en
// déduit : la charge de travail par personne (comparée aux heures pointées au
// planning ce jour-là) et la liste d'ingrédients agrégée, valorisée au prix
// mercuriale du jour.
//
// GET  ?date=YYYY-MM-DD → { orders, ingredients, workload, totals }
// POST { production_date, recipe_id, batches, employee_id? }
//
// Rien n'est copié depuis les recettes : minutes et ingrédients sont relus à
// chaque affichage — modifier une fiche met à jour tous les jours de production.
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { PAYROLL_EMPLOYEE_COLUMNS, JOURS, type PayrollEmployee } from '@/lib/payroll'
import { averageLoadedRate, employeeLoadedRate, buildGenericMap, costIngredients, type IngredientRow } from '@/lib/recipes'

export const dynamic = 'force-dynamic'

function isoWeekOf(d: Date): { week: number; year: number } {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return { week: Math.ceil((((t.getTime() - yearStart.getTime()) / 86400000) + 1) / 7), year: t.getUTCFullYear() }
}

const round2 = (n: number) => Math.round(n * 100) / 100

export async function GET(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json({ orders: [], ingredients: [], workload: [], totals: null })

  const dateStr = new URL(request.url).searchParams.get('date') || ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return NextResponse.json({ error: 'date requise (YYYY-MM-DD)' }, { status: 400 })

  const [{ data: orders }, { data: recipes }, { data: recipeIngs }, { data: employees }, { data: articles }, { data: generics }] = await Promise.all([
    service.from('production_orders').select('*').eq('client_id', clientId).eq('production_date', dateStr).order('created_at'),
    service.from('recipes').select('id, name, yield_qty, yield_unit, labor_minutes, employee_id').eq('client_id', clientId),
    service.from('recipe_ingredients').select('*').eq('client_id', clientId),
    service.from('employees').select(PAYROLL_EMPLOYEE_COLUMNS).eq('client_id', clientId),
    service.from('articles').select('id, last_price_ht, last_price_date, generic_id, conversion_factor').eq('client_id', clientId),
    service.from('generic_articles').select('id, name, base_unit, category, default_loss_pct').eq('client_id', clientId).eq('active', true),
  ])

  const recipeById = new Map((recipes || []).map((r: any) => [r.id, r]))
  const ingsByRecipe = new Map<string, IngredientRow[]>()
  for (const ing of (recipeIngs || []) as (IngredientRow & { recipe_id: string })[]) {
    const arr = ingsByRecipe.get(ing.recipe_id) || []
    arr.push(ing)
    ingsByRecipe.set(ing.recipe_id, arr)
  }
  const priceByArticle = new Map<string, number>()
  for (const a of articles || []) {
    if (a.last_price_ht != null) priceByArticle.set(a.id, parseFloat(String(a.last_price_ht)))
  }
  const genericById = buildGenericMap((generics || []) as Record<string, unknown>[], (articles || []) as Record<string, unknown>[])
  const empById = new Map((employees || []).map((e: any) => [e.id, e]))
  const emps = (employees || []) as unknown as PayrollEmployee[]
  const laborRate = averageLoadedRate(emps)

  // Heures pointées au planning ce jour-là (pour la jauge de charge par personne)
  const day = new Date(dateStr + 'T00:00:00Z')
  const { week, year } = isoWeekOf(day)
  const jourCol = JOURS[(day.getUTCDay() + 6) % 7] // getUTCDay: 0=dimanche → JOURS[6]
  const empIds = (employees || []).map((e: any) => e.id)
  const { data: planning } = empIds.length > 0
    ? await service.from('planning_entries').select(`employee_id, ${jourCol}`)
        .in('employee_id', empIds).eq('week_number', week).eq('year', year)
    : { data: [] as any[] }
  const plannedHours = new Map<string, number>()
  for (const p of (planning || []) as any[]) {
    plannedHours.set(p.employee_id, parseFloat(String(p[jourCol] || 0)) || 0)
  }

  // Ordres enrichis + agrégats. La liste d'ingrédients agrège les quantités
  // BRUTES (perte comprise — c'est ce qu'on sort du frigo), en unité de base
  // pour les lignes génériques.
  const needs = new Map<string, { label: string; unit: string | null; article_id: string | null; total_qty: number; unit_price_ht: number | null; total_cost: number; missing_price: boolean }>()
  const workloadByEmp = new Map<string, number>() // '' = non affecté
  let totalMinutes = 0
  let totalMatiere = 0

  const outOrders = (orders || []).map((o: any) => {
    const recipe = recipeById.get(o.recipe_id)
    const batches = parseFloat(String(o.batches)) || 1
    const minutes = recipe ? (parseFloat(String(recipe.labor_minutes)) || 0) * batches : 0
    const costed = recipe ? costIngredients(ingsByRecipe.get(o.recipe_id) || [], priceByArticle, genericById) : []
    const matiere = round2(costed.reduce((s, i) => s + i.line_total_ht, 0) * batches)
    // Taux MO : l'employé choisi sur la FICHE prime, sinon taux moyen d'équipe
    const rate = (recipe ? employeeLoadedRate(emps, recipe.employee_id) : null) ?? laborRate

    totalMinutes += minutes
    totalMatiere += matiere
    const empKey = o.employee_id || ''
    workloadByEmp.set(empKey, (workloadByEmp.get(empKey) || 0) + minutes)

    for (const ing of costed) {
      const generic = ing.generic_id ? genericById.get(ing.generic_id) : null
      const key = ing.generic_id || ing.article_id || `libre:${ing.label.toLowerCase()}`
      const unit = generic ? (generic.base_unit === 'kg' ? 'kg' : 'pièce') : ing.unit
      const cur = needs.get(key) || { label: generic?.name ?? ing.label, unit, article_id: ing.article_id, total_qty: 0, unit_price_ht: ing.unit_price_ht, total_cost: 0, missing_price: ing.price_source === 'aucun' }
      cur.total_qty = round2(cur.total_qty + ing.qty_brute * batches)
      cur.total_cost = round2(cur.total_cost + ing.line_total_ht * batches)
      needs.set(key, cur)
    }

    return {
      id: o.id, recipe_id: o.recipe_id,
      recipe_name: recipe?.name ?? 'Recette supprimée',
      yield_qty: recipe?.yield_qty ?? null, yield_unit: recipe?.yield_unit ?? null,
      batches, minutes, matiere,
      cost_total: round2(matiere + (rate !== null ? minutes / 60 * rate : 0)),
      employee_id: o.employee_id, employee_name: o.employee_id ? (empById.get(o.employee_id)?.name ?? '?') : null,
      status: o.status,
    }
  })

  const workload = [...workloadByEmp.entries()].map(([empId, minutes]) => {
    const planned = empId ? plannedHours.get(empId) ?? null : null
    return {
      employee_id: empId || null,
      employee_name: empId ? (empById.get(empId)?.name ?? '?') : 'Non affecté',
      minutes: round2(minutes),
      planned_hours: planned,
      charge_pct: planned && planned > 0 ? Math.round((minutes / 60 / planned) * 100) : null,
    }
  }).sort((a, b) => b.minutes - a.minutes)

  return NextResponse.json({
    date: dateStr,
    orders: outOrders,
    ingredients: [...needs.values()].sort((a, b) => b.total_cost - a.total_cost),
    workload,
    totals: { minutes: round2(totalMinutes), matiere: round2(totalMatiere), labor_rate_ht: laborRate },
  })
}

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const date = String(body.production_date ?? '')
  const recipeId = String(body.recipe_id ?? '')
  const batches = Number(body.batches)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'production_date requise (YYYY-MM-DD)' }, { status: 400 })
  if (!recipeId) return NextResponse.json({ error: 'recipe_id requis' }, { status: 400 })
  if (!Number.isFinite(batches) || batches <= 0 || batches > 500) return NextResponse.json({ error: 'Nombre de batchs invalide' }, { status: 400 })

  // La recette doit appartenir au client — une production orpheline n'aurait aucun sens
  const { data: recipe } = await service.from('recipes')
    .select('id').eq('id', recipeId).eq('client_id', clientId).eq('active', true).maybeSingle()
  if (!recipe) return NextResponse.json({ error: 'Recette introuvable' }, { status: 404 })

  const employeeId = typeof body.employee_id === 'string' && body.employee_id ? body.employee_id : null
  const { error } = await service.from('production_orders').insert({
    client_id: clientId, production_date: date, recipe_id: recipeId,
    batches, employee_id: employeeId,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
