// Cibles de marge des fiches recettes, PAR CATÉGORIE de fiche (« boucherie »,
// « charcuterie », « traiteur », ou toute catégorie libre du client).
//
// PUT → { category, target_marge_pct }
//   · nombre entre 1 et 99 : la cible est posée (upsert) ;
//   · null / vide : la cible est RETIRÉE — sans cible, la page ne juge pas la
//     marge d'une fiche de cette catégorie (aucune cible inventée par défaut).
// La comparaison marge/cible se recalcule à l'affichage : rien de dérivé n'est
// stocké, poser ou retirer une cible ne touche aucune fiche.
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'

export const dynamic = 'force-dynamic'

export async function PUT(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const category = String(body.category ?? '').trim().toLowerCase()
  if (!category || category === 'sans catégorie') {
    return NextResponse.json({ error: 'Catégorie requise' }, { status: 400 })
  }

  const raw = body.target_marge_pct
  if (raw === null || raw === undefined || raw === '') {
    const { error } = await service.from('recipe_targets')
      .delete().eq('client_id', clientId).eq('category', category)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, removed: true })
  }

  const target = Number(raw)
  if (!Number.isFinite(target) || target <= 0 || target >= 100) {
    return NextResponse.json({ error: 'La cible est un pourcentage entre 1 et 99' }, { status: 400 })
  }

  const { error } = await service.from('recipe_targets').upsert(
    {
      client_id: clientId,
      category,
      target_marge_pct: Math.round(target * 100) / 100,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'client_id,category' },
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
