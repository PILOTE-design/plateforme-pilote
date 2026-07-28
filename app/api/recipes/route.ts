// Fiches recettes — liste avec coûts calculés, et création.
//
// GET  → { recipes: [{ ...recette, ingredients: [...], cost: RecipeCost }],
//          labor_rate_ht, generics: [...], employees: [{ id, name, loaded_rate }] }
// POST → { name, category?, yield_qty?, yield_unit?, labor_minutes?, employee_id?,
//          selling_price_ttc?, tva_rate?, notes?,
//          ingredients: [{ generic_id?, article_id?, label, quantity, qty_unit?, loss_pct?, unit?, manual_price_ht? }] }
//
// Tout le calcul vit dans lib/recipes (module pur) : matière au prix du jour des
// ARTICLES GÉNÉRIQUES (unité de base kg/pièce, perte sur le brut), main-d'œuvre
// au taux chargé de l'employé choisi (repli : taux moyen de l'équipe, CCN 992).
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { PAYROLL_EMPLOYEE_COLUMNS, chargeMultiplier, type PayrollEmployee } from '@/lib/payroll'
import {
  averageLoadedRate, employeeLoadedRate, buildGenericMap,
  costIngredients, computeRecipeCost,
  parseIngredients, parseRecipeFields,
  type IngredientRow, type RecipeRow,
} from '@/lib/recipes'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json({ recipes: [], labor_rate_ht: null, generics: [], employees: [] })

  const [{ data: recipes }, { data: ingredients }, { data: employees }, { data: articles }, { data: generics }] = await Promise.all([
    service.from('recipes').select('*').eq('client_id', clientId).eq('active', true).order('name'),
    service.from('recipe_ingredients').select('*').eq('client_id', clientId).order('position'),
    service.from('employees').select(PAYROLL_EMPLOYEE_COLUMNS).eq('client_id', clientId),
    service.from('articles').select('id, last_price_ht, last_price_date, generic_id, conversion_factor').eq('client_id', clientId),
    service.from('generic_articles').select('id, name, base_unit, category, default_loss_pct').eq('client_id', clientId).eq('active', true).order('name'),
  ])

  const emps = (employees || []) as unknown as PayrollEmployee[]
  const averageRate = averageLoadedRate(emps)
  const genericById = buildGenericMap((generics || []) as Record<string, unknown>[], (articles || []) as Record<string, unknown>[])
  const priceByArticle = new Map<string, number>()
  for (const a of articles || []) {
    if (a.last_price_ht != null) priceByArticle.set(a.id, parseFloat(String(a.last_price_ht)))
  }

  const byRecipe = new Map<string, IngredientRow[]>()
  for (const ing of (ingredients || []) as (IngredientRow & { recipe_id: string })[]) {
    const arr = byRecipe.get(ing.recipe_id) || []
    arr.push(ing)
    byRecipe.set(ing.recipe_id, arr)
  }

  const out = (recipes || []).map((r: RecipeRow & Record<string, unknown>) => {
    const costed = costIngredients(byRecipe.get(r.id) || [], priceByArticle, genericById)
    const rate = employeeLoadedRate(emps, r.employee_id as string | null) ?? averageRate
    return { ...r, ingredients: costed, cost: computeRecipeCost(r, costed, rate) }
  })

  return NextResponse.json({
    recipes: out,
    labor_rate_ht: averageRate,
    generics: [...genericById.values()],
    employees: emps
      .map(e => {
        const er = e as unknown as Record<string, unknown>
        const h = Number(er.hourly_rate) || 0
        return { id: String(er.id), name: String(er.name ?? ''), loaded_rate: h > 0 ? Math.round(h * chargeMultiplier(e) * 100) / 100 : null }
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
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
  const parsedFields = parseRecipeFields(body)
  if (parsedFields.error) return NextResponse.json({ error: parsedFields.error }, { status: 400 })
  const parsedIngs = parseIngredients(body.ingredients)
  if (parsedIngs.error) return NextResponse.json({ error: parsedIngs.error }, { status: 400 })

  const guard = await checkOwnership(service, clientId, parsedFields.fields!, parsedIngs.rows!)
  if (guard) return NextResponse.json({ error: guard }, { status: 400 })

  const { data: recipe, error } = await service.from('recipes')
    .insert({ client_id: clientId, ...parsedFields.fields })
    .select('id').single()
  if (error || !recipe) return NextResponse.json({ error: error?.message ?? 'Création impossible' }, { status: 500 })

  const { error: ingErr } = await service.from('recipe_ingredients').insert(
    parsedIngs.rows!.map(r => ({ ...r, client_id: clientId, recipe_id: recipe.id })),
  )
  if (ingErr) {
    // Pas de recette sans ses ingrédients : on retire la coquille plutôt que de la laisser vide
    await service.from('recipes').delete().eq('id', recipe.id)
    return NextResponse.json({ error: `Ingrédients : ${ingErr.message}` }, { status: 500 })
  }

  return NextResponse.json({ success: true, id: recipe.id })
}

/** L'employé et chaque article générique visés doivent appartenir au client.
 *  (Dupliqué dans [id]/route.ts — un module de route n'exporte que ses verbes.) */
async function checkOwnership(
  service: ReturnType<typeof createServiceClient>,
  clientId: string,
  fields: Record<string, unknown>,
  rows: IngredientRow[],
): Promise<string | null> {
  const employeeId = fields.employee_id as string | null
  if (employeeId) {
    const { data } = await service.from('employees').select('id').eq('id', employeeId).eq('client_id', clientId).maybeSingle()
    if (!data) return 'Employé introuvable'
  }
  const genericIds = [...new Set(rows.map(r => r.generic_id).filter((g): g is string => g !== null))]
  if (genericIds.length > 0) {
    const { data } = await service.from('generic_articles')
      .select('id').eq('client_id', clientId).eq('active', true).in('id', genericIds)
    if ((data || []).length !== genericIds.length) return 'Un des articles génériques est introuvable'
  }
  return null
}
