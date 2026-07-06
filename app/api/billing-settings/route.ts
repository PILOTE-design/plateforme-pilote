import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const serviceSupabase = createServiceClient()
  const { data } = await serviceSupabase
    .from('profiles')
    .select('billing_email, company_name, siret')
    .eq('id', user.id)
    .maybeSingle()

  return NextResponse.json(data || {})
}

export async function PATCH(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { billing_email, company_name, siret } = body

  const serviceSupabase = createServiceClient()
  const { data, error } = await serviceSupabase
    .from('profiles')
    .upsert({ id: user.id, billing_email, company_name, siret })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
