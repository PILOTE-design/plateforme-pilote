// Route appelée par la tâche planifiée chaque dimanche 22h
// Synchronise TOUS les clients qui ont des intégrations actives
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { PROVIDERS } from '@/lib/billing-providers'

function getWeekBounds(weekNumber: number, year: number): [Date, Date] {
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const dow = jan4.getUTCDay() || 7
  const mon = new Date(jan4)
  mon.setUTCDate(jan4.getUTCDate() - dow + 1 + (weekNumber - 1) * 7)
  const sun = new Date(mon)
  sun.setUTCDate(mon.getUTCDate() + 6)
  return [mon, sun]
}

function getISOWeek(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return {
    week: Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7),
    year: d.getUTCFullYear(),
  }
}

export async function POST() {
  const service = createServiceClient()
  const { week, year } = getISOWeek(new Date())
  const [from, to] = getWeekBounds(week, year)

  const { data: integrations } = await service
    .from('billing_integrations')
    .select('*, clients!inner(id)')
    .eq('is_active', true)

  if (!integrations?.length) return NextResponse.json({ synced: 0 })

  let totalImported = 0

  for (const integ of integrations) {
    const prov = PROVIDERS[integ.provider]
    if (!prov) continue

    const syncResult = await prov.fetchWeekInvoices(integ.api_token, from, to, integ.company_id)

    if (syncResult.success && syncResult.invoices.length > 0) {
      const rows = syncResult.invoices.map(inv => ({
        client_id:      integ.client_id,
        supplier_name:  inv.supplier_name,
        invoice_number: inv.invoice_number ?? null,
        invoice_date:   inv.invoice_date,
        category:       inv.category ?? 'autre',
        amount_ht:      inv.amount_ht,
        tva_rate:       inv.tva_rate,
        amount_ttc:     inv.amount_ttc,
        week_number:    week,
        year,
        notes:          `Importé depuis ${prov.name}`,
      }))

      await service.from('invoices').upsert(rows, {
        onConflict: 'client_id,invoice_number,invoice_date',
        ignoreDuplicates: true,
      })

      totalImported += syncResult.invoices.length
    }

    await service.from('billing_integrations').update({
      last_sync_at:     new Date().toISOString(),
      last_sync_status: syncResult.success ? 'success' : 'error',
      last_sync_error:  syncResult.error ?? null,
      invoices_synced:  syncResult.invoices.length,
    }).eq('id', integ.id)
  }

  return NextResponse.json({ success: true, week, year, totalImported, count: integrations.length })
}
