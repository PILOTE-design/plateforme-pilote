import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { PROVIDERS } from '@/lib/billing-providers'
import { classifyFixedCharges } from '@/lib/billing-providers/classify'

export const maxDuration = 60 // Vercel Pro: 60s max, Hobby: 10s (mieux que défaut)

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

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const service = createServiceClient()
  const body = await req.json().catch(() => ({}))
  const { provider: filterProvider, week: bodyWeek, year: bodyYear } = body

  // Utiliser la semaine envoyée par l'UI, sinon semaine courante
  const { week, year } = (bodyWeek && bodyYear)
    ? { week: Number(bodyWeek), year: Number(bodyYear) }
    : getISOWeek(new Date())

  const { data: clientRow } = await service
    .from('clients').select('id').eq('client_user_id', user.id).maybeSingle()
  if (!clientRow) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  let query = service.from('billing_integrations')
    .select('*')
    .eq('client_id', clientRow.id)
    .eq('is_active', true)
  if (filterProvider) query = query.eq('provider', filterProvider)
  const { data: integrations } = await query

  if (!integrations?.length) return NextResponse.json({ error: 'Aucune intégration active' }, { status: 404 })

  const [from, to] = getWeekBounds(week, year)
  const results: Record<string, any> = {}

  for (const integ of integrations) {
    const prov = PROVIDERS[integ.provider]
    if (!prov) continue

    const syncResult = await prov.fetchWeekInvoices(integ.api_token, from, to, integ.company_id)

    let syncError: string | null = syncResult.error ?? null
    let imported = 0

    if (syncResult.success && syncResult.invoices.length > 0) {
      // Classification IA des charges fixes (fallback : détection mots-clés déjà appliquée)
      const enriched = await classifyFixedCharges(syncResult.invoices)

      const rows = enriched.map(inv => ({
        client_id:      clientRow.id,
        supplier_name:  inv.supplier_name,
        invoice_number: inv.invoice_number ?? null,
        invoice_date:   inv.invoice_date,
        category:       inv.category ?? 'autre',
        amount_ht:      inv.amount_ht,
        tva_rate:       inv.tva_rate,
        amount_ttc:     inv.amount_ttc,
        week_number:    week,
        year,
        is_fixed_charge: inv.is_fixed_charge ?? false,
        period_days:     inv.period_days ?? null,
        prorata_ht:      inv.prorata_ht ?? null,
        notes: `Importé depuis ${prov.name}${inv.external_id ? ` (${inv.external_id})` : ''}`,
      }))

      const { error: upsertError } = await service.from('invoices').upsert(rows, {
        onConflict: 'client_id,invoice_number,invoice_date',
        ignoreDuplicates: true,
      })

      if (upsertError) {
        syncError = `Upsert invoices a échoué: ${upsertError.message}`
      } else {
        imported = rows.length
      }
    }

    const ok = syncResult.success && !syncError

    await service.from('billing_integrations').update({
      last_sync_at:     new Date().toISOString(),
      last_sync_status: ok ? 'success' : 'error',
      // En succès, on stocke l'éventuel diagnostic (champs de date côté API) — non bloquant
      last_sync_error:  syncError ?? syncResult.debug ?? null,
      invoices_synced:  imported,
      updated_at:       new Date().toISOString(),
    }).eq('id', integ.id)

    results[integ.provider] = {
      success:  ok,
      imported,
      error:    syncError,
      debug:    syncResult.debug ?? null,
    }
  }

  return NextResponse.json({ success: true, week, year, results })
}
