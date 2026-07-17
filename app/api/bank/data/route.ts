import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { gocardlessConfigured } from '@/lib/gocardless'

export const dynamic = 'force-dynamic'

/** Données de trésorerie du client : connexions, comptes, dernières opérations. */
export async function GET(_request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json({ configured: gocardlessConfigured(), connections: [], accounts: [], transactions: [] })

  const [{ data: connections }, { data: accounts }, { data: transactions }] = await Promise.all([
    service.from('bank_connections').select('id, institution_name, status, agreement_expires_at, created_at').eq('client_id', clientId).order('created_at', { ascending: false }),
    service.from('bank_accounts').select('id, name, iban, currency, balance, balance_at').eq('client_id', clientId).order('created_at', { ascending: true }),
    service.from('bank_transactions').select('id, account_id, booking_date, amount, currency, description, counterparty, category, status').eq('client_id', clientId).order('booking_date', { ascending: false }).limit(300),
  ])

  return NextResponse.json({
    configured: gocardlessConfigured(),
    connections: connections || [],
    accounts: accounts || [],
    transactions: transactions || [],
  })
}
