// app/api/articles/bulk/route.ts — agir sur PLUSIEURS réfs en un seul appel.
//
// Pourquoi cette route existe. La page mercuriale traitait un groupe de réfs par
// une boucle `for` avec un PUT par réf, en série : sur un groupe de dix, dix
// allers-retours depuis l'arrière-boutique, l'un après l'autre. Et surtout,
// quand trois échouaient, le message disait « relancez sur les réfs restantes »
// SANS DIRE LESQUELLES — les sept réussies ayant quitté la file, plus rien ne
// distinguait ce qui restait à faire de ce qui avait échoué. Le boucher devait
// deviner, ou tout refaire.
//
// Ici : le générique est validé UNE fois, les réfs relues UNE fois, puis un
// UPDATE par facteur de conversion distinct. Et la réponse NOMME chaque échec,
// pour que la page puisse laisser précisément ces réfs-là sélectionnées.
//
// Le contrat par réf est celui de PUT /api/articles/[id], sans écart :
//   · { generic_id: "…", refs: [{ id, conversion_factor? }] } associe ;
//   · { generic_id: null, refs } dissocie — avec `no_auto`, car dissocier est un
//     geste volontaire que l'association automatique ne doit pas défaire ;
//   · { ignored: true|false, refs } écarte ou restaure, sans toucher au
//     rattachement.
// Un `conversion_factor` strictement positif dit combien d'unités de base du
// générique vaut UNE unité facturée de la réf.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'

export const dynamic = 'force-dynamic'

/** Au-delà, ce n'est plus une association manuelle mais un import : refusé
 *  franchement plutôt que tronqué en silence. */
const MAX_REFS = 200
/** Taille d'un `in (...)` — au-delà, l'URL PostgREST devient déraisonnable. */
const CHUNK = 50

type Echec = { id: string; name: string; motif: string }

export async function PUT(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const body = await request.json().catch(() => ({} as Record<string, unknown>))

  const modeIgnore = 'ignored' in body && !('generic_id' in body)
  if (!modeIgnore && !('generic_id' in body)) {
    return NextResponse.json({ error: 'generic_id requis (null pour dissocier), ou ignored' }, { status: 400 })
  }

  const demandes = Array.isArray(body.refs) ? (body.refs as unknown[]) : null
  if (!demandes || demandes.length === 0) return NextResponse.json({ error: 'refs requis (liste non vide)' }, { status: 400 })
  if (demandes.length > MAX_REFS) return NextResponse.json({ error: `${demandes.length} réfs demandées, ${MAX_REFS} au maximum par appel` }, { status: 400 })

  // Ordre d'arrivée conservé, doublons écartés : la page peut envoyer deux fois
  // la même réf quand un groupe et la sélection en cours se recouvrent.
  const vus = new Set<string>()
  const lignes: { id: string; facteurBrut: unknown }[] = []
  for (const d of demandes) {
    const o = (d && typeof d === 'object') ? (d as Record<string, unknown>) : {}
    const id = String(o.id ?? '').trim()
    if (!id || vus.has(id)) continue
    vus.add(id)
    lignes.push({ id, facteurBrut: o.conversion_factor })
  }
  if (lignes.length === 0) return NextResponse.json({ error: 'Aucun identifiant de réf exploitable' }, { status: 400 })

  const genericId = modeIgnore ? null : (body.generic_id === null ? null : String(body.generic_id))

  // Le générique est validé UNE fois, pas une fois par réf : c'est tout l'objet
  // de cette route. Introuvable, c'est la demande entière qui est refusée — pas
  // un échec réf par réf, qui laisserait croire à un problème de données.
  if (!modeIgnore && genericId !== null) {
    const { data: generic, error: gErr } = await service.from('generic_articles')
      .select('id').eq('id', genericId).eq('client_id', clientId).eq('active', true).maybeSingle()
    if (gErr) return NextResponse.json({ error: gErr.message }, { status: 500 })
    if (!generic) return NextResponse.json({ error: 'Article générique introuvable' }, { status: 404 })
  }

  // Les réfs sont relues sous le client_id : une réf d'une autre boutique
  // ressort comme un échec nommé, jamais comme une mise à jour silencieuse.
  const nomParId = new Map<string, string>()
  for (let i = 0; i < lignes.length; i += CHUNK) {
    const ids = lignes.slice(i, i + CHUNK).map(l => l.id)
    const { data, error } = await service.from('articles')
      .select('id, name').eq('client_id', clientId).in('id', ids)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    for (const r of (data || [])) nomParId.set(String(r.id), String(r.name ?? ''))
  }

  const echecs: Echec[] = []
  // Réfs regroupées par facteur de conversion : celles qui partagent la même
  // conversion — le cas courant étant « aucune » — partent dans le même UPDATE.
  const parFacteur = new Map<string, string[]>()

  for (const l of lignes) {
    const nom = nomParId.get(l.id)
    if (nom === undefined) { echecs.push({ id: l.id, name: '', motif: 'réf introuvable' }); continue }

    let facteur: number | null = null
    if (!modeIgnore && genericId !== null && l.facteurBrut !== undefined && l.facteurBrut !== null && l.facteurBrut !== '') {
      const v = Number(l.facteurBrut)
      if (!Number.isFinite(v) || v <= 0 || v > 10000) {
        echecs.push({ id: l.id, name: nom, motif: 'facteur de conversion invalide' })
        continue
      }
      facteur = v
    }

    const cle = facteur === null ? 'null' : String(facteur)
    const arr = parFacteur.get(cle) || []
    arr.push(l.id)
    parFacteur.set(cle, arr)
  }

  const champsPour = (facteur: number | null): Record<string, unknown> => {
    if (modeIgnore) return { ignored: body.ignored === true, no_auto: true }
    if (genericId === null) return { generic_id: null, conversion_factor: null, no_auto: true }
    return { generic_id: genericId, conversion_factor: facteur }
  }

  let traitees = 0
  for (const [cle, ids] of Array.from(parFacteur.entries())) {
    const champs = champsPour(cle === 'null' ? null : Number(cle))
    for (let i = 0; i < ids.length; i += CHUNK) {
      const lot = ids.slice(i, i + CHUNK)
      const { error } = await service.from('articles')
        .update(champs).eq('client_id', clientId).in('id', lot)
      if (error) {
        for (const id of lot) echecs.push({ id, name: nomParId.get(id) ?? '', motif: error.message.slice(0, 120) })
      } else {
        traitees += lot.length
      }
    }
  }

  return NextResponse.json({ success: true, traitees, echecs })
}
