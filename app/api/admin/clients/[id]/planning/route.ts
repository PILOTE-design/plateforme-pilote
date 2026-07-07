import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

const ADMIN_EMAIL = 'nouvion.theo51@gmail.com'

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
  const week = parseInt(searchParams.get('week') || '0')
  const year = parseInt(searchParams.get('year') || '0')
  if (!week || !year) return NextResponse.json([])

  const service = createServiceClient()

  const { data: empList } = await service
    .from('employees')
    .select('id')
    .eq('client_id', params.id)

  if (!empList?.length) return NextResponse.json([])

  const { data, error } = await service
    .from('planning_entries')
    .select('*')
    .in('employee_id', empList.map(e => e.id))
    .eq('week_number', week)
    .eq('year', year)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
