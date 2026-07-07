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
  const week = searchParams.get('week')
  const year = searchParams.get('year')

  const service = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = service.from('invoices').select('*').eq('client_id', params.id)
  if (week) query = query.eq('week_number', parseInt(week))
  if (year) query = query.eq('year', parseInt(year))
  query = query.order('invoice_date', { ascending: false })

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
