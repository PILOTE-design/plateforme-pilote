// app/api/generic-articles/orphelins/route.ts — RETIRER DU CATALOGUE LES
// MORCEAUX DE DÉCOUPE QUI ONT SURVÉCU À LEUR CARCASSE. Lot 121.
//
// Mesuré en production le 07/08/2026 : 33 morceaux de découpe actifs sur une
// boutique qui n'a plus aucune valorisation. La carcasse de contrôle qui les
// avait créés a été supprimée ; eux sont restés, comptés dans le catalogue et
// présents dans toutes les recherches, sans prix et sans en attendre.
//
// ─── CE QUE CETTE ROUTE NE FAIT PAS ───────────────────────────────────────
//
//  · Elle ne SUPPRIME rien. Elle pose `active = false`, ce qui sort le morceau
//    du catalogue sans détruire son historique ni son identifiant. Le jour où le
//    boucher ressaisit la carcasse, `ensureGeneriquesDecoupe` retrouve la même
//    ligne et la réactive : rien n'est perdu, rien n'est dupliqué.
//
//  · Elle ne décide PAS toute seule. Le client envoie la liste des morceaux à
//    retirer ; le serveur la revérifie entièrement et n'en retire aucun que le
//    calcul ne confirme pas. Un identifiant envoyé à la main ne suffit donc pas
//    à faire disparaître un produit.
//
//  · Elle ne touche JAMAIS un morceau qui SERT — utilisé par une fiche recette
//    ou porteur d'une réf fournisseur. C'est la vérification qui compte le plus :
//    désactiver un générique employé par une fiche ferait tomber le coût de
//    revient de cette fiche, en silence, et c'est exactement ce que la maison
//    interdit.
//
//  · Elle ne touche jamais un morceau dont l'espèce a une carcasse, même trop
//    peu pesée pour publier un prix : celui-là ATTEND une saisie, il n'est pas
//    un résidu.
//
// `client_id` vient de `resolveClientId`, jamais du corps de la requête.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { fetchAllPages } from '@/lib/fetch-all'
import { especesAvecCarcasse } from '@/lib/valorisation-source'
import { morceauxOrphelins, orphelinsRetirables, type MorceauCatalogue } from '@/lib/morceaux-orphelins'

export const dynamic = 'force-dynamic'

/** Plafond de sécurité : un retrait de masse n'a aucune raison de dépasser la
 *  taille d'une nomenclature complète, toutes espèces confondues. */
const MAX = 500

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const corps = await request.json().catch(() => null)
  const demandes: string[] = Array.isArray(corps?.ids)
    ? corps.ids.map((x: unknown) => String(x)).filter(Boolean).slice(0, MAX)
    : []
  if (demandes.length === 0) {
    return NextResponse.json({ error: 'Aucun morceau désigné.' }, { status: 400 })
  }

  // ── ON RECALCULE, ON NE FAIT PAS CONFIANCE À LA LISTE REÇUE ──────────────
  const genPage = await fetchAllPages<Record<string, unknown>>(apres => {
    let q = service.from('generic_articles')
      .select('id, name, valorisation_cut_id')
      .eq('client_id', clientId).eq('active', true)
      .not('valorisation_cut_id', 'is', null)
    if (apres) q = q.gt('id', apres)
    return q.order('id', { ascending: true })
  })
  if (genPage.erreur) {
    return NextResponse.json({ error: `Lecture du catalogue impossible : ${genPage.erreur}` }, { status: 500 })
  }
  const ids = genPage.rows.map(g => String(g.id))
  if (ids.length === 0) return NextResponse.json({ retires: 0, refuses: demandes.length, motif: 'Aucun morceau de découpe au catalogue.' })

  // Ce qui RETIENT un morceau : une fiche qui s'en sert, ou une réf rattachée.
  // Les deux lectures paginent — un catalogue de mille morceaux ne doit pas se
  // faire silencieusement tronquer par le plafond PostgREST (leçon du lot 93).
  const usagePage = await fetchAllPages<Record<string, unknown>>(apres => {
    let q = service.from('recipe_ingredients').select('id, generic_id').in('generic_id', ids)
    if (apres) q = q.gt('id', apres)
    return q.order('id', { ascending: true })
  })
  const refsPage = await fetchAllPages<Record<string, unknown>>(apres => {
    let q = service.from('articles').select('id, generic_id').eq('client_id', clientId).in('generic_id', ids)
    if (apres) q = q.gt('id', apres)
    return q.order('id', { ascending: true })
  })
  if (usagePage.tronque || refsPage.tronque || usagePage.erreur || refsPage.erreur) {
    // Une lecture incomplète ferait passer un morceau UTILISÉ pour libre. On
    // préfère ne rien retirer plutôt que de retirer à tort.
    return NextResponse.json({
      error: 'Lecture incomplète des usages : aucun morceau n’a été retiré, pour ne pas en retirer un qui sert.',
    }, { status: 503 })
  }

  const fiches = new Map<string, number>()
  for (const r of usagePage.rows) {
    const g = String(r.generic_id ?? '')
    if (g) fiches.set(g, (fiches.get(g) ?? 0) + 1)
  }
  const refs = new Map<string, number>()
  for (const r of refsPage.rows) {
    const g = String(r.generic_id ?? '')
    if (g) refs.set(g, (refs.get(g) ?? 0) + 1)
  }

  const especesVues = await especesAvecCarcasse(service, clientId, user.id)

  // `price_ht: null` : un morceau qui A un prix n'est de toute façon pas
  // orphelin, et il ne peut en avoir un que si son espèce a une carcasse — ce
  // que `especesVues` tranche déjà, en amont et plus sûrement.
  const catalogue: MorceauCatalogue[] = genPage.rows.map(g => ({
    id: String(g.id),
    name: String(g.name ?? ''),
    valorisation_cut_id: (g.valorisation_cut_id as string | null) ?? null,
    price_ht: null,
    recipes_count: fiches.get(String(g.id)) ?? 0,
    refs_count: refs.get(String(g.id)) ?? 0,
  }))

  const retirables = new Set(orphelinsRetirables(morceauxOrphelins(catalogue, especesVues)).map(o => o.id))
  const aRetirer = demandes.filter(id => retirables.has(id))
  const refuses = demandes.length - aRetirer.length

  if (aRetirer.length === 0) {
    return NextResponse.json({
      retires: 0, refuses,
      motif: 'Aucun des morceaux désignés n’est retirable : ils servent dans une fiche, portent une réf fournisseur, ou leur espèce a de nouveau une carcasse.',
    })
  }

  // Écriture cloisonnée par `client_id`, et bornée aux identifiants confirmés.
  const { error } = await service.from('generic_articles')
    .update({ active: false })
    .eq('client_id', clientId)
    .in('id', aRetirer)
  if (error) {
    return NextResponse.json({ error: `Retrait impossible : ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({
    retires: aRetirer.length,
    refuses,
    // Dit en clair ce qui s'est passé, y compris la réversibilité : un boucher
    // qui croit avoir supprimé pour de bon n'ose plus toucher au bouton.
    motif: `${aRetirer.length} morceau${aRetirer.length > 1 ? 'x' : ''} retiré${aRetirer.length > 1 ? 's' : ''} du catalogue`
      + `${refuses > 0 ? `, ${refuses} conservé${refuses > 1 ? 's' : ''} car ${refuses > 1 ? 'ils servent' : 'il sert'} encore` : ''}. `
      + 'Rien n’est supprimé : enregistrez une carcasse de cette espèce et ils reviendront avec leur prix.',
  })
}
