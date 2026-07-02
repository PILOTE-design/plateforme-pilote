import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

const ADMIN_EMAIL = 'nouvion.theo51@gmail.com'

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()

  if (!user || user.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select('id, name, email, client_user_id')
    .eq('id', params.id)
    .single()

  if (clientError || !client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  const adminSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { error: inviteError } = await adminSupabase.auth.admin.inviteUserByEmail(
    client.email,
    {
      data: { client_name: client.name },
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL || 'https://pilote-coral.vercel.app'}/dashboard`,
    }
  )

  if (inviteError) {
    return NextResponse.json({ error: inviteError.message }, { status: 500 })
  }

  await supabase
    .from('clients')
    .update({ invited_at: new Date().toISOString() })
    .eq('id', params.id)

  return NextResponse.json({ success: true })
}
