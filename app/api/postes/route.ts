import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import {
  BUILTIN_POSTES, parseCustomPostes, parseMarginFamilies, slugifyPoste, DEFAULT_TVA_RATE,
  type Poste,
} from '@/lib/postes'

export const dynamic = 'force-dynamic'

/**
 * Postes de travail du client (intégrés + personnalisés), familles de marge et taux
 * de TVA — toute la configuration portée par la table `clients`.
 * GET → { builtin, custom, margin_families, tva_rate }
 * PUT → { custom_postes?: {label, key?}[], margin_families?: string[3], tva_rate?: number }
 *   - custom_postes remplace la liste des postes personnalisés (clés slugifiées,
 *     collisions avec les postes intégrés refusées, 12 maximum) ;
 *   - margin_families : exactement 3 clés distinctes, parmi intégrés + personnalisés.
 */
export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const serviceSupabase = createServiceClient()
  const clientId = await resolveClientId(serviceSupabase, user.id, user.email)
  if (!clientId) return NextResponse.json({ builtin: BUILTIN_POSTES, custom: [], margin_families: parseMarginFamilies(null), tva_rate: DEFAULT_TVA_RATE })

  const { data: row, error } = await serviceSupabase
    .from('clients').select('custom_postes, margin_families, tva_rate').eq('id', clientId).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    builtin: BUILTIN_POSTES,
    custom: parseCustomPostes(row?.custom_postes),
    margin_families: parseMarginFamilies(row?.margin_families),
    tva_rate: Number(row?.tva_rate ?? DEFAULT_TVA_RATE),
  })
}

export async function PUT(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const serviceSupabase = createServiceClient()
  const clientId = await resolveClientId(serviceSupabase, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const updates: Record<string, unknown> = {}

  // Liste actuelle (pour valider margin_families contre les postes existants)
  const { data: row } = await serviceSupabase
    .from('clients').select('custom_postes, margin_families').eq('id', clientId).maybeSingle()
  let customs: Poste[] = parseCustomPostes(row?.custom_postes)

  if ('custom_postes' in body) {
    if (!Array.isArray(body.custom_postes)) return NextResponse.json({ error: 'custom_postes doit être une liste' }, { status: 400 })
    const builtinKeys = new Set(BUILTIN_POSTES.map(p => p.key))
    const next: Poste[] = []
    for (const p of body.custom_postes as unknown[]) {
      const label = String((p as any)?.label ?? '').trim()
      if (!label) continue
      if (label.length < 2 || label.length > 30) {
        return NextResponse.json({ error: `Libellé « ${label.slice(0, 30)} » invalide (2 à 30 caractères)` }, { status: 400 })
      }
      const key = slugifyPoste(label)
      if (!key) return NextResponse.json({ error: `Libellé « ${label} » invalide` }, { status: 400 })
      if (builtinKeys.has(key)) return NextResponse.json({ error: `« ${label} » existe déjà comme poste intégré` }, { status: 400 })
      if (next.some(x => x.key === key)) continue // doublon silencieux
      next.push({ key, label })
    }
    if (next.length > 12) return NextResponse.json({ error: '12 postes personnalisés maximum' }, { status: 400 })
    customs = next
    updates.custom_postes = next
  }

  if ('margin_families' in body) {
    if (!Array.isArray(body.margin_families)) return NextResponse.json({ error: 'margin_families doit être une liste' }, { status: 400 })
    const keys = (body.margin_families as unknown[]).map(k => String(k)).filter(Boolean)
    if (keys.length !== 3 || new Set(keys).size !== 3) {
      return NextResponse.json({ error: 'Choisissez exactement 3 familles distinctes' }, { status: 400 })
    }
    const valid = new Set([...BUILTIN_POSTES.map(p => p.key), ...customs.map(p => p.key)])
    for (const k of keys) {
      if (!valid.has(k)) return NextResponse.json({ error: `Poste inconnu : ${k}` }, { status: 400 })
    }
    updates.margin_families = keys
  }

  // Taux de TVA du CA caisse — sert à ramener le chiffre d'affaires en HT avant tout
  // calcul de marge (cf. lib/week-economics). Bornes volontairement larges mais
  // fermées : 20 % pour un traiteur sur place, 0 exclu (un taux nul désactiverait la
  // conversion sans que le gérant comprenne pourquoi ses marges ont bondi).
  if ('tva_rate' in body) {
    const t = Number(body.tva_rate)
    if (!Number.isFinite(t) || t <= 0 || t > 20) {
      return NextResponse.json({ error: 'Taux de TVA invalide (entre 0 et 20 %)' }, { status: 400 })
    }
    updates.tva_rate = Math.round(t * 100) / 100
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Aucun champ à mettre à jour' }, { status: 400 })
  }

  const { error } = await serviceSupabase.from('clients').update(updates).eq('id', clientId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    builtin: BUILTIN_POSTES,
    custom: customs,
    margin_families: 'margin_families' in updates
      ? updates.margin_families
      : parseMarginFamilies(row?.margin_families),
  })
}
