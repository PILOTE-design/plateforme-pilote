import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

async function resolveClientId(
  serviceSupabase: ReturnType<typeof createServiceClient>,
  userId: string,
  userEmail?: string | null
) {
  const { data: byId } = await serviceSupabase
    .from('clients').select('id').eq('client_user_id', userId).maybeSingle()
  if (byId) return byId.id as string
  if (!userEmail) return null
  const { data: byEmail } = await serviceSupabase
    .from('clients').select('id').eq('email', userEmail).maybeSingle()
  if (!byEmail) return null
  await serviceSupabase.from('clients').update({ client_user_id: userId }).eq('id', byEmail.id)
  return byEmail.id as string
}

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json(null)

  const serviceSupabase = createServiceClient()
  const clientId = await resolveClientId(serviceSupabase, user.id, user.email)
  if (!clientId) return NextResponse.json(null)

  const { data } = await serviceSupabase
    .from('reports')
    .select('week_number, year')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json(data)
}
