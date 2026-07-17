import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getToken, getRequisition, getAccountDetails, getAccountBalances, getAccountTransactions, pickBalance, mapTransaction } from '@/lib/gocardless'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Retour de redirection après consentement bancaire. GoCardless rappelle cette URL avec
 * ?ref=<reference>. On finalise la connexion : récupération des comptes, soldes et opérations.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const reference = url.searchParams.get('ref')
  const gcError = url.searchParams.get('error')
  const dashboard = `${url.origin}/dashboard/tresorerie`

  if (gcError) return NextResponse.redirect(`${dashboard}?error=refus`)
  if (!reference) return NextResponse.redirect(`${dashboard}?error=ref`)

  const service = createServiceClient()
  const { data: connection } = await service
    .from('bank_connections').select('*').eq('reference', reference).maybeSingle()
  if (!connection) return NextResponse.redirect(`${dashboard}?error=introuvable`)

  try {
    const token = await getToken()
    const req = await getRequisition(connection.requisition_id)

    await service.from('bank_connections')
      .update({ status: req.accounts.length > 0 ? 'linked' : req.status?.toLowerCase() || 'pending', updated_at: new Date().toISOString() })
      .eq('id', connection.id)

    for (const acc of req.accounts) {
      let iban: string | null = null, name: string | null = null, currency = 'EUR'
      try {
        const details = await getAccountDetails(acc, token)
        iban = details.iban || null
        name = details.name || details.ownerName || details.product || null
        currency = details.currency || 'EUR'
      } catch {}

      let balance: number | null = null
      try { balance = pickBalance(await getAccountBalances(acc, token))?.amount ?? null } catch {}

      const { data: savedAcc } = await service.from('bank_accounts').upsert({
        connection_id: connection.id,
        client_id: connection.client_id,
        account_id: acc,
        iban, name, currency,
        balance,
        balance_at: new Date().toISOString(),
      }, { onConflict: 'connection_id,account_id' }).select('id').single()

      if (!savedAcc) continue

      try {
        const { booked, pending } = await getAccountTransactions(acc, token)
        const rows = [
          ...booked.map(t => mapTransaction(t, 'booked')),
          ...pending.map(t => mapTransaction(t, 'pending')),
        ].filter(r => r.provider_tx_id).map(r => ({ ...r, account_id: savedAcc.id, client_id: connection.client_id }))
        if (rows.length > 0) {
          await service.from('bank_transactions').upsert(rows, { onConflict: 'account_id,provider_tx_id' })
        }
      } catch {}
    }

    return NextResponse.redirect(`${dashboard}?connected=1`)
  } catch (e: any) {
    await service.from('bank_connections').update({ status: 'error', updated_at: new Date().toISOString() }).eq('id', connection.id)
    return NextResponse.redirect(`${dashboard}?error=sync`)
  }
}
