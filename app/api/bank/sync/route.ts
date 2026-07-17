import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { gocardlessConfigured, getToken, getAccountBalances, getAccountTransactions, pickBalance, mapTransaction } from '@/lib/gocardless'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Rafraîchit soldes + opérations des comptes reliés du client. */
export async function POST(_request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!gocardlessConfigured()) {
    return NextResponse.json({ error: 'Connexion bancaire pas encore configurée' }, { status: 503 })
  }

  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const { data: accounts } = await service
    .from('bank_accounts').select('id, account_id').eq('client_id', clientId)
  if (!accounts || accounts.length === 0) return NextResponse.json({ accounts: 0, transactions: 0 })

  let txCount = 0
  try {
    const token = await getToken()
    for (const acc of accounts) {
      try {
        const balance = pickBalance(await getAccountBalances(acc.account_id, token))?.amount ?? null
        if (balance !== null) {
          await service.from('bank_accounts').update({ balance, balance_at: new Date().toISOString() }).eq('id', acc.id)
        }
      } catch {}
      try {
        const { booked, pending } = await getAccountTransactions(acc.account_id, token)
        const rows = [
          ...booked.map(t => mapTransaction(t, 'booked')),
          ...pending.map(t => mapTransaction(t, 'pending')),
        ].filter(r => r.provider_tx_id).map(r => ({ ...r, account_id: acc.id, client_id: clientId }))
        if (rows.length > 0) {
          await service.from('bank_transactions').upsert(rows, { onConflict: 'account_id,provider_tx_id' })
          txCount += rows.length
        }
      } catch {}
    }
    return NextResponse.json({ accounts: accounts.length, transactions: txCount })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Erreur de synchronisation' }, { status: 500 })
  }
}
