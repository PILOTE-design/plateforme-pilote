// Fiches recettes — liste avec coûts calculés, et création.
//
// GET  → { recipes: [{ ...recette, ingredients: [...], cost: RecipeCost }], labor_rate_ht }
// POST → { name, category?, yield_qty?, yield_unit?, labor_minutes?, selling_price_ttc?,
//          tva_rate?, notes?, ingredients: [{ article_id?, label, quantity, unit?, manual_price_ht? }] }
//
// Tout le calcul vit dans lib/recipes (module pur) : coût matière au dernier prix
// mercuriale, main-d'œuvre au taux horaire chargé moyen de l'équipe (CCN 992).
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { PAYROLL_EMPLOYEE_COLUMNS, type PayrollEmployee } from '@/lib/payroll'
import {
  averageLoadedRate, costIngredients, computeRecipeCost,
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
  if (!clientId) return NextResponse.json({ recipes: [], labor_rate_ht: null })

  const [{ data: recipes }, { data: ingredients }, { data: employees }, { data: articles }] = await Promise.all([
    service.from('recipes').select('*').eq('client_id', clientId).eq('active', true).order('name'),
    service.from('recipe_ingredients').select('*').eq('client_id', clientId).order('position'),
    service.from('employees').select(PAYROLL_EMPLOYEE_COLUMNS).eq('client_id', clientId),
    service.from('articles').select('id, last_price_ht').eq('client_id', clientId).not('last_price_ht', 'is', null),
  ])

  const laborRate = averageLoadedRate((employees || []) as unknown as PayrollEmployee[])
  const priceByArticle = new Map<string, number>()
  for (const a of articles || []) priceByArticle.set(a.id, parseFloat(String(a.last_price_ht)))

  const byRecipe = new Map<string, IngredientRow[]>()
  for (const ing of (ingredients || []) as (IngredientRow & { recipe_id: string })[]) {
    const arr = byRecipe.get(ing.recipe_id) || []
    arr.push(ing)
    byRecipe.set(ing.recipe_id, arr)
  }

  const out = (recipes || []).map((r: RecipeRow & Record<string, unknown>) => {
    const costed = costIngredients(byRecipe.get(r.id) || [], priceByArticle)
    return { ...r, ingredients: costed, cost: computeRecipeCost(r, costed, laborRate) }
  })

  return NextResponse.json({ recipes: out, labor_rate_ht: laborRate })
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
