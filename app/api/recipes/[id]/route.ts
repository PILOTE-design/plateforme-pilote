// Fiche recette — édition et suppression.
//
// PUT    → mêmes champs que la création (employee_id, ingrédients sur articles
//          génériques…) ; si `ingredients` est fourni, la liste est REMPLACÉE
//          entièrement (pas de merge ligne à ligne — la modale renvoie toujours
//          la liste complète).
// DELETE → désactivation (active = false), pas de suppression physique : les
//          fiches restent réactivables et l'historique de production y survivra.
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { parseIngredients, parseRecipeFields, type IngredientRow } from '@/lib/recipes'

export const dynamic = 'force-dynamic'

async function authClient() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Non authentifié' }, { status: 401 }) }
  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return { error: NextResponse.json({ error: 'Client introuvable' }, { status: 404 }) }
  return { service, clientId }
}

/** L'employé et chaque article générique visés doivent appartenir au client.
 *  (Même garde-fou que dans route.ts — un module de route n'exporte que ses verbes.) */
async function checkOwnership(
  service: ReturnType<typeof createServiceClient>,
  clientId: string,
  fields: Record<string, unknown>,
  rows: IngredientRow[] | null,
): Promise<string | null> {
  const employeeId = fields.employee_id as string | null
  if (employeeId) {
    const { data } = await service.from('employees').select('id').eq('id', employeeId).eq('client_id', clientId).maybeSingle()
    if (!data) return 'Employé introuvable'
  }
  const genericIds = [...new Set((rows || []).map(r => r.generic_id).filter((g): g is string => g !== null))]
  if (genericIds.length > 0) {
    const { data } = await service.from('generic_articles')
      .select('id').eq('client_id', clientId).eq('active', true).in('id', genericIds)
    if ((data || []).length !== genericIds.length) return 'Un des articles génériques est introuvable'
  }
  return null
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authClient()
  if ('error' in auth) return auth.error
  const { service, clientId } = auth

  const { data: existing } = await service.from('recipes')
    .select('id').eq('id', params.id).eq('client_id', clientId).maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Recette introuvable' }, { status: 404 })

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const parsedFields = parseRecipeFields(body)
  if (parsedFields.error) return NextResponse.json({ error: parsedFields.error }, { status: 400 })

  let rows: IngredientRow[] | null = null
  if ('ingredients' in body) {
    const parsedIngs = parseIngredients(body.ingredients)
    if (parsedIngs.error) return NextResponse.json({ error: parsedIngs.error }, { status: 400 })
    rows = parsedIngs.rows!
  }

  const guard = await checkOwnership(service, clientId, parsedFields.fields!, rows)
  if (guard) return NextResponse.json({ error: guard }, { status: 400 })

  const { error: upErr } = await service.from('recipes')
    .update(parsedFields.fields!).eq('id', params.id).eq('client_id', clientId)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  if (rows) {
    const { error: delErr } = await service.from('recipe_ingredients')
      .delete().eq('recipe_id', params.id).eq('client_id', clientId)
    if (delErr) return NextResponse.json({ error: `Purge des ingrédients : ${delErr.message}` }, { status: 500 })
    const { error: insErr } = await service.from('recipe_ingredients').insert(
      rows.map(r => ({ ...r, client_id: clientId, recipe_id: params.id })),
    )
    if (insErr) return NextResponse.json({ error: `Ingrédients : ${insErr.message}` }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authClient()
  if ('error' in auth) return auth.error
  const { service, clientId } = auth

  const { error } = await service.from('recipes')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', params.id).eq('client_id', clientId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
