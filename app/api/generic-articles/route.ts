// Articles génériques — le référentiel que l'utilisateur construit lui-même :
// chaque générique (« Filet de poulet ») regroupe des réfs fournisseurs
// (« FILET DE POULET SV », « FILET DE POULET LR ») et porte l'unité de base
// (kg ou pièce) sur laquelle tout est ramené. Les fiches recettes s'appuient
// sur ces génériques, jamais sur les réfs brutes.
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { isAdminEmail } from '@/lib/admins'
import { normText } from '@/lib/postes'
import { fetchAllPages } from '@/lib/fetch-all'

export const dynamic = 'force-dynamic'

/** ENTRETIEN PAR L'ADMINISTRATEUR : une fiche explicitement demandée (corps ou
 *  paramètre client_id) n'est servie qu'à un administrateur — la session
 *  d'association des réfs se fait pour le compte des boutiques. Pour tout
 *  autre compte, c'est un refus net, jamais un repli. */
async function authClient(ficheDemandee: string | null) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Non authentifié' }, { status: 401 }) }
  const service = createServiceClient()
  let clientId: string | null
  if (ficheDemandee) {
    if (!isAdminEmail(user.email)) return { error: NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 }) }
    clientId = ficheDemandee
  } else {
    clientId = await resolveClientId(service, user.id, user.email)
  }
  if (!clientId) return { error: NextResponse.json({ error: 'Client introuvable' }, { status: 404 }) }
  return { service, clientId }
}

export async function GET(request: NextRequest) {
  const fiche = request.nextUrl.searchParams.get('client_id')
  const auth = await authClient(fiche && fiche.trim() ? fiche.trim() : null)
  if ('error' in auth) return auth.error
  const { service, clientId } = auth

  // Paginée : ce référentiel alimente les listes de choix des fiches recettes.
  // Tronqué à mille sans le dire, il faisait « disparaître » des produits d'un
  // menu déroulant — le boucher les cherchait, ils n'y étaient plus.
  const page = await fetchAllPages<any>(apres => {
    let q = service.from('generic_articles')
      .select('id, name, base_unit, category, default_loss_pct')
      .eq('client_id', clientId).eq('active', true)
    if (apres) q = q.gt('id', apres)
    return q.order('id', { ascending: true })
  })
  if (page.erreur) return NextResponse.json({ error: page.erreur }, { status: 500 })
  const data = [...page.rows].sort((a, b) => String(a?.name ?? '').localeCompare(String(b?.name ?? ''), 'fr'))
  return NextResponse.json({ generics: data, lecture_incomplete: page.tronque || undefined })
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const auth = await authClient(typeof body.client_id === 'string' && body.client_id ? String(body.client_id) : null)
  if ('error' in auth) return auth.error
  const { service, clientId } = auth
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 120) return NextResponse.json({ error: 'Nom invalide' }, { status: 400 })
  const base_unit = body.base_unit === 'piece' ? 'piece' : 'kg'
  const category = body.category === 'emballage' ? 'emballage' : 'ingredient'
  const lossRaw = Number(body.default_loss_pct ?? 0)
  const default_loss_pct = Number.isFinite(lossRaw) && lossRaw >= 0 && lossRaw < 100 ? lossRaw : 0

  const { data, error } = await service.from('generic_articles')
    .insert({ client_id: clientId, name, name_key: normText(name), base_unit, category, default_loss_pct })
    .select('id, name, base_unit, category, default_loss_pct')
    .single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Un article générique porte déjà ce nom' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ generic: data })
}
