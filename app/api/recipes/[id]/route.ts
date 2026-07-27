// Fiche recette — édition et suppression.
//
// PUT    → mêmes champs que la création ; si `ingredients` est fourni, la liste
//          est REMPLACÉE entièrement (pas de merge ligne à ligne — la modale
//          renvoie toujours la liste complète).
// DELETE → désactivation (active = false), pas de suppression physique : les
//          fiches restent réactivables et l'historique de production y survivra.
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { parseIngredients, parseRecipeFields } from '@/lib/recipes'

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

  const { error: upErr } = await service.from('recipes')
    .update(parsedFields.fields!).eq('id', params.id).eq('client_id', clientId)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  if ('ingredients' in body) {
    const parsedIngs = parseIngredients(body.ingredients)
    if (parsedIngs.error) return NextResponse.json({ error: parsedIngs.error }, { status: 400 })
    const { error: delErr } = await service.from('recipe_ingredients')
      .delete().eq('recipe_id', params.id).eq('client_id', clientId)
    if (delErr) return NextResponse.json({ error: `Purge des ingrédients : ${delErr.message}` }, { status: 500 })
    const { error: insErr } = await service.from('recipe_ingredients').insert(
      parsedIngs.rows!.map(r => ({ ...r, client_id: clientId, recipe_id: params.id })),
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
