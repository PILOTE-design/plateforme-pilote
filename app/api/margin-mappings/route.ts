import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'

export const dynamic = 'force-dynamic'

const GROUPES = ['boucherie', 'charcuterie', 'traiteur', 'achat_revente']
const SOURCE_TYPES = ['famille', 'achat_categorie']

/** Correspondances du client : famille CRISALID / catégorie d'achat → groupe de marge */
export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const serviceSupabase = createServiceClient()
  const clientId = await resolveClientId(serviceSupabase, user.id, user.email)
  if (!clientId) return NextResponse.json([])

  const { data, error } = await serviceSupabase
    .from('margin_mappings')
    .select('source_type, source_name, groupe')
    .eq('client_id', clientId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** Enregistre l'ensemble des correspondances (assistant ou réglages) — remplace l'existant */
export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const serviceSupabase = createServiceClient()
  const clientId = await resolveClientId(serviceSupabase, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const body = await request.json()
  const mappings = Array.isArray(body?.mappings) ? body.mappings : []
  const rows = mappings
    .filter((m: any) => SOURCE_TYPES.includes(m?.source_type) && GROUPES.includes(m?.groupe) && String(m?.source_name || '').trim())
    .map((m: any) => ({
      client_id: clientId,
      source_type: m.source_type,
      source_name: String(m.source_name).trim(),
      groupe: m.groupe,
    }))
  if (rows.length === 0) return NextResponse.json({ error: 'Aucune correspondance valide' }, { status: 400 })

  // Remplacement complet : simple et prévisible (l'assistant renvoie toujours l'état entier)
  const { error: delErr } = await serviceSupabase.from('margin_mappings').delete().eq('client_id', clientId)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
  const { error: insErr } = await serviceSupabase.from('margin_mappings').insert(rows)
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, count: rows.length })
}
