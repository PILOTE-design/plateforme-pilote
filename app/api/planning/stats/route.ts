import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

async function resolveClientId(serviceSupabase: any, userId: string, userEmail?: string | null): Promise<string | null> {
  const { data: byId } = await serviceSupabase.from('clients').select('id').eq('client_user_id', userId).maybeSingle()
  if (byId) return byId.id
  if (!userEmail) return null
  const { data: byEmail } = await serviceSupabase.from('clients').select('id').eq('email', userEmail).maybeSingle()
  if (!byEmail) return null
  await serviceSupabase.from('clients').update({ client_user_id: userId }).eq('id', byEmail.id)
  return byEmail.id
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const serviceSupabase = createServiceClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const year = parseInt(searchParams.get('year') || '0')
  if (!year) return NextResponse.json([])

  const clientId = await resolveClientId(serviceSupabase, user.id, user.email)
  if (!clientId) return NextResponse.json([])

  const { data: employees } = await serviceSupabase
    .from('employees').select('id').eq('client_id', clientId)
  if (!employees || employees.length === 0) return NextResponse.json([])

  const { data: entries } = await serviceSupabase
    .from('planning_entries')
    .select('employee_id, lundi_type, mardi_type, mercredi_type, jeudi_type, vendredi_type, samedi_type, dimanche_type')
    .eq('year', year)
    .in('employee_id', employees.map((e: any) => e.id))

  if (!entries) return NextResponse.json([])

  const DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
  const cpMap: Record<string, number> = {}
  for (const entry of entries) {
    const cp = DAYS.reduce((sum, j) => sum + ((entry as any)[`${j}_type`] === 'conges' ? 1 : 0), 0)
    cpMap[entry.employee_id] = (cpMap[entry.employee_id] || 0) + cp
  }

  return NextResponse.json(
    Object.entries(cpMap).map(([employee_id, cp_used]) => ({ employee_id, cp_used }))
  )
}
