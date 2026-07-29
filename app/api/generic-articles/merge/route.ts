// Fusion d'articles génériques — « Cervelas choix » + « Cervelas droit
// supérieur » + « Cervelas pur porc » → un seul « Cervelas ».
//
// POST { target_id, source_ids: [] } :
//   · les RÉFS des sources rejoignent la cible — leur facteur de conversion est
//     CONSERVÉ si la source a la même unité de base que la cible (il reste
//     vrai), REMIS À ZÉRO sinon (un facteur exprimé en pièces ne vaut rien en
//     kg : la réf ressort « conversion manquante », visible et réglable) ;
//   · les LIGNES DE FICHES RECETTES qui pointaient une source sont remappées
//     vers la cible — uniquement si les unités de base sont identiques. Fusion
//     à bases différentes REFUSÉE si des fiches utilisent une source : les
//     quantités saisies (kg vs pièces) deviendraient silencieusement fausses.
//   · les sources sont désactivées (soft delete, le nom redevient libre).
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const targetId = typeof body.target_id === 'string' ? body.target_id : ''
  const sourceIds = Array.isArray(body.source_ids)
    ? [...new Set((body.source_ids as unknown[]).map(String).filter(id => id && id !== targetId))]
    : []
  if (!targetId || sourceIds.length === 0) {
    return NextResponse.json({ error: 'target_id et source_ids requis' }, { status: 400 })
  }
  if (sourceIds.length > 20) return NextResponse.json({ error: '20 génériques maximum par fusion' }, { status: 400 })

  const { data: rows, error: gErr } = await service.from('generic_articles')
    .select('id, name, base_unit')
    .eq('client_id', clientId).eq('active', true)
    .in('id', [targetId, ...sourceIds])
  if (gErr) return NextResponse.json({ error: gErr.message }, { status: 500 })
  const byId = new Map((rows || []).map((g: { id: string }) => [String(g.id), g as { id: string; name: string; base_unit: string }]))
  const target = byId.get(targetId)
  if (!target) return NextResponse.json({ error: 'Générique cible introuvable' }, { status: 404 })
  const sources = sourceIds.map(id => byId.get(id)).filter((g): g is { id: string; name: string; base_unit: string } => !!g)
  if (sources.length !== sourceIds.length) return NextResponse.json({ error: 'Un des génériques à fusionner est introuvable' }, { status: 404 })

  const sameBase = sources.filter(s => s.base_unit === target.base_unit).map(s => s.id)
  const diffBase = sources.filter(s => s.base_unit !== target.base_unit).map(s => s.id)

  // Bases différentes : refuser si des fiches utilisent ces sources (leurs
  // quantités sont saisies dans l'ancienne unité — les remapper les fausserait).
  if (diffBase.length > 0) {
    const { count, error: riErr } = await service.from('recipe_ingredients')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId).in('generic_id', diffBase)
    if (riErr) return NextResponse.json({ error: riErr.message }, { status: 500 })
    if ((count || 0) > 0) {
      return NextResponse.json({
        error: `Des fiches recettes utilisent un générique d'unité différente (kg vs pièce). Alignez d'abord les unités de base, ou modifiez ces fiches.`,
      }, { status: 400 })
    }
  }

  // Réfs : même base → facteur conservé ; base différente → facteur remis à zéro
  let movedRefs = 0
  if (sameBase.length > 0) {
    const { data, error } = await service.from('articles')
      .update({ generic_id: targetId })
      .eq('client_id', clientId).in('generic_id', sameBase).select('id')
    if (error) return NextResponse.json({ error: `Réfs : ${error.message}` }, { status: 500 })
    movedRefs += (data || []).length
  }
  if (diffBase.length > 0) {
    const { data, error } = await service.from('articles')
      .update({ generic_id: targetId, conversion_factor: null })
      .eq('client_id', clientId).in('generic_id', diffBase).select('id')
    if (error) return NextResponse.json({ error: `Réfs : ${error.message}` }, { status: 500 })
    movedRefs += (data || []).length
  }

  // Lignes de fiches (uniquement des sources de MÊME base — cf. garde ci-dessus)
  let movedIngredients = 0
  if (sameBase.length > 0) {
    const { data, error } = await service.from('recipe_ingredients')
      .update({ generic_id: targetId })
      .eq('client_id', clientId).in('generic_id', sameBase).select('id')
    if (error) return NextResponse.json({ error: `Fiches : ${error.message}` }, { status: 500 })
    movedIngredients = (data || []).length
  }

  const { error: offErr } = await service.from('generic_articles')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('client_id', clientId).in('id', sourceIds)
  if (offErr) return NextResponse.json({ error: `Désactivation : ${offErr.message}` }, { status: 500 })

  return NextResponse.json({ success: true, moved_refs: movedRefs, moved_ingredients: movedIngredients })
}
