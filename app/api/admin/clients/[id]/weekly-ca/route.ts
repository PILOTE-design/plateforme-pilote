import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

const ADMIN_EMAIL = 'theo.nouvion@gmail.com'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const week = searchParams.get('week')
  const year = searchParams.get('year')
  if (!week || !year) return NextResponse.json(null)

  const service = createServiceClient()
  const { data } = await service
    .from('weekly_ca')
    .select('*')
    .eq('client_id', params.id)
    .eq('week_number', parseInt(week))
    .eq('year', parseInt(year))
    .maybeSingle()

  return NextResponse.json(data)
}
