import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { gocardlessConfigured, listInstitutions } from '@/lib/gocardless'

export const dynamic = 'force-dynamic'

/** Liste des banques connectables (France). Renvoie configured:false si les clés manquent. */
export async function GET(_request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!gocardlessConfigured()) {
    return NextResponse.json({ configured: false, institutions: [] })
  }
  try {
    const institutions = await listInstitutions('fr')
    return NextResponse.json({
      configured: true,
      institutions: institutions.map(i => ({ id: i.id, name: i.name, bic: i.bic, logo: i.logo })),
    })
  } catch (e: any) {
    return NextResponse.json({ configured: true, institutions: [], error: e?.message || 'Erreur GoCardless' }, { status: 500 })
  }
}
