// Formats de vente d'une fiche recette — création, édition, retrait.
//
// Une recette mère se vend sous plusieurs formats (« SAUCISSE MONTAGNARDE » et
// « SAUCISSE MONTAGNARDE AU KG ») : même fabrication, même coût de batch, mais
// chacun a son unité de vente, ce que le batch représente dedans, son prix — et
// donc sa marge. Rien de dérivé n'est stocké : coût, marge et coefficient se
// relisent à l'affichage (lib/recipes, computeFormatVerdict).
//
// POST   → { name, sell_unit?, sell_qty?, selling_price_ttc?, tva_rate?, validated? }
// PUT    → { format_id, ...mêmes champs }
// DELETE → ?format_id=<id> — refusé sur le DERNIER format de la fiche.
//
// Le format PAR DÉFAUT (la position la plus basse) reste éditable par
// PUT /api/recipes/[id] : c'est ce que la modale et le panneau envoient déjà.
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { parseFormatFields } from '@/lib/recipes'

export const dynamic = 'force-dynamic'

/** 12 formats par fiche : au-delà, ce ne sont plus des formats de vente d'un
 *  même produit, c'est un catalogue — et ce sont des fiches qu'il faut. */
const MAX_FORMATS = 12

async function auth(recipeId: string) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Non authentifié' }, { status: 401 }) }
  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return { error: NextResponse.json({ error: 'Client introuvable' }, { status: 404 }) }
  // La fiche doit appartenir au client : sans ce contrôle, un identifiant deviné
  // suffirait à poser un prix sur la fiche d'une autre boutique.
  const { data: fiche } = await service.from('recipes')
    .select('id, name').eq('id', recipeId).eq('client_id', clientId).maybeSingle()
  if (!fiche) return { error: NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 }) }
  return { service, clientId, fiche }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const a = await auth(params.id)
  if ('error' in a) return a.error
  const { service, clientId } = a

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const parsed = parseFormatFields(body)
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const { data: existants } = await service.from('recipe_formats')
    .select('id, position').eq('client_id', clientId).eq('recipe_id', params.id)
  if ((existants || []).length >= MAX_FORMATS) {
    return NextResponse.json({ error: `${MAX_FORMATS} formats maximum sur une fiche` }, { status: 400 })
  }
  const position = (existants || []).reduce((m, f: any) => Math.max(m, Number(f.position) || 0), -1) + 1

  const { data: cree, error } = await service.from('recipe_formats')
    .insert({ client_id: clientId, recipe_id: params.id, ...parsed.fields, position })
    .select('id').single()
  if (error || !cree) return NextResponse.json({ error: error?.message ?? 'Création impossible' }, { status: 500 })

  return NextResponse.json({ success: true, id: cree.id })
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const a = await auth(params.id)
  if ('error' in a) return a.error
  const { service, clientId } = a

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const formatId = typeof body?.format_id === 'string' ? body.format_id : ''
  if (!formatId) return NextResponse.json({ error: 'Format non précisé' }, { status: 400 })

  const parsed = parseFormatFields(body)
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 })

  // Le format doit être CELUI de cette fiche : un id de format d'une autre
  // boutique ne doit pas pouvoir se glisser dans la mise à jour.
  const { data: cible } = await service.from('recipe_formats')
    .select('id').eq('id', formatId).eq('client_id', clientId).eq('recipe_id', params.id).maybeSingle()
  if (!cible) return NextResponse.json({ error: 'Format introuvable' }, { status: 404 })

  const { error } = await service.from('recipe_formats')
    .update(parsed.fields!).eq('id', formatId).eq('client_id', clientId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const a = await auth(params.id)
  if ('error' in a) return a.error
  const { service, clientId } = a

  const formatId = request.nextUrl.searchParams.get('format_id') || ''
  if (!formatId) return NextResponse.json({ error: 'Format non précisé' }, { status: 400 })

  const { data: tous } = await service.from('recipe_formats')
    .select('id').eq('client_id', clientId).eq('recipe_id', params.id)
  if (!(tous || []).some((f: any) => String(f.id) === formatId)) {
    return NextResponse.json({ error: 'Format introuvable' }, { status: 404 })
  }
  // Une fiche sans aucun format n'aurait ni prix ni marge, et ressemblerait à
  // une fiche vidée par erreur. Le dernier format ne se retire pas : il se
  // renomme, ou c'est la fiche entière qui se retire.
  if ((tous || []).length <= 1) {
    return NextResponse.json({ error: 'Une fiche garde au moins un format de vente' }, { status: 400 })
  }

  const { error } = await service.from('recipe_formats')
    .delete().eq('id', formatId).eq('client_id', clientId).eq('recipe_id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
