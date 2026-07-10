import type { BillingProvider, ProviderInvoice } from './types'

const BASE = 'https://app.pennylane.com/api/external/v2'

function fmt(d: Date) {
  return d.toISOString().split('T')[0]
}

async function apiFetch(token: string, path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Pennylane ${res.status}: ${body.slice(0, 300)}`)
  }
  return res.json()
}

function guessCategory(label: string): string {
  const l = label.toLowerCase()
  if (l.includes('viande') || l.includes('boeuf') || l.includes('veau') || l.includes('agneau') || l.includes('porc')) return 'viande'
  if (l.includes('charcuterie') || l.includes('jambon') || l.includes('saucisse')) return 'charcuterie'
  if (l.includes('emballage') || l.includes('barquette') || l.includes('sac') || l.includes('film')) return 'emballage'
  if (l.includes('epicerie') || l.includes('condiment') || l.includes('sauce')) return 'epicerie'
  if (l.includes('energie') || l.includes('loyer') || l.includes('assurance') || l.includes('telephone')) return 'frais_generaux'
  return 'autre'
}

function parseItems(data: any): any[] {
  return data?.supplier_invoices ?? data?.invoices ?? data?.data ?? []
}

function mapInvoice(inv: any, fallbackDate: string): ProviderInvoice {
  const ht  = parseFloat(
    inv.currency_amount ?? inv.amount ?? inv.total_amount ?? inv.pre_tax_amount ?? 0
  )
  const ttc = parseFloat(
    inv.currency_tax_inclusive_amount ?? inv.tax_inclusive_amount ??
    inv.total_amount_with_tax ?? inv.total ?? 0
  )
  const tva = ht > 0 && ttc > ht ? parseFloat(((ttc - ht) / ht * 100).toFixed(1)) : 20
  return {
    supplier_name:  inv.supplier?.name ?? inv.third_party?.name ?? inv.vendor?.name ?? inv.label ?? 'Fournisseur inconnu',
    invoice_number: inv.invoice_number ?? inv.number ?? inv.reference ?? undefined,
    invoice_date:   inv.date?.split('T')[0] ?? inv.invoice_date?.split('T')[0] ?? fallbackDate,
    amount_ht:      ht,
    tva_rate:       tva,
    amount_ttc:     ttc || +(ht * (1 + tva / 100)).toFixed(2),
    category:       guessCategory(inv.supplier?.name ?? inv.vendor?.name ?? inv.label ?? ''),
    external_id:    String(inv.id ?? ''),
  }
}

export const pennylane: BillingProvider = {
  id: 'pennylane',
  name: 'Pennylane',
  logo: 'PL',
  color: 'bg-blue-600',
  helpUrl: 'https://help.pennylane.com/fr/articles/developer-api',
  tokenLabel: 'Token API Pennylane',
  tokenPlaceholder: 'eyJhbGci...',
  needsCompanyId: false,

  async testConnection(token) {
    try {
      const res = await fetch(`${BASE}/supplier_invoices?limit=1`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      })
      if (res.status === 401 || res.status === 403) return false
      return true
    } catch {
      return true
    }
  },

  async fetchWeekInvoices(token, from, to) {
    const dateFrom = fmt(from)
    const dateTo   = fmt(to)

    try {
      // Essai 1 : avec filtre de date Pennylane v2
      const filter = JSON.stringify([
        { field: 'date', operator: 'gteq', value: dateFrom },
        { field: 'date', operator: 'lteq', value: dateTo },
      ])
      const params = new URLSearchParams({ filter, limit: '100' })
      const data = await apiFetch(token, `/supplier_invoices?${params.toString()}`)
      const items = parseItems(data)

      if (items.length > 0) {
        const mapped = items
          .map((inv: any) => mapInvoice(inv, dateFrom))
          .filter((i: ProviderInvoice) => i.amount_ht > 0)
        return { success: true, invoices: mapped }
      }

      // Essai 2 : sans filtre, pour voir la structure réelle des factures
      const rawData = await apiFetch(token, `/supplier_invoices?limit=5&sort=-date`)
      const rawItems = parseItems(rawData)

      if (rawItems.length === 0) {
        return { success: true, invoices: [] }
      }

      // Logger la structure pour debug
      const sample = rawItems[0]
      const debugInfo = JSON.stringify({
        date: sample.date,
        invoice_date: sample.invoice_date,
        currency_amount: sample.currency_amount,
        amount: sample.amount,
        pre_tax_amount: sample.pre_tax_amount,
        total: sample.total,
        currency_tax_inclusive_amount: sample.currency_tax_inclusive_amount,
        deadline_at: sample.deadline_at,
        created_at: sample.created_at,
        updated_at: sample.updated_at,
      })

      // Filtrage côté client sur la date réelle
      const mapped = rawItems
        .map((inv: any) => mapInvoice(inv, dateFrom))
        .filter((i: ProviderInvoice) => {
          if (i.amount_ht <= 0) return false
          if (!i.invoice_date) return true
          return i.invoice_date >= dateFrom && i.invoice_date <= dateTo
        })

      if (mapped.length > 0) {
        return { success: true, invoices: mapped }
      }

      return {
        success: false,
        invoices: [],
        error: `0 factures pour ${dateFrom}→${dateTo}. Structure: ${debugInfo}`,
      }
    } catch (err) {
      return { success: false, invoices: [], error: String(err) }
    }
  },
}
