import type { BillingProvider, ProviderInvoice, SyncResult } from './types'

const BASE = 'https://app.pennylane.com/api/external/v1'

function fmt(d: Date) {
  return d.toISOString().split('T')[0]
}

async function apiFetch(token: string, path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Pennylane ${res.status}: ${body.slice(0, 200)}`)
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
      await apiFetch(token, '/supplier_invoices?per_page=1')
      return true
    } catch {
      return false
    }
  },

  async fetchWeekInvoices(token, from, to) {
    try {
      const url = `/supplier_invoices?filter[date][gte]=${fmt(from)}&filter[date][lte]=${fmt(to)}&per_page=100`
      const data = await apiFetch(token, url)
      const items: any[] = data.invoices ?? data.supplier_invoices ?? data.data ?? []

      const invoices: ProviderInvoice[] = items.map((inv: any) => {
        const ht  = parseFloat(inv.amount ?? inv.total_amount ?? inv.pre_tax_amount ?? 0)
        const ttc = parseFloat(inv.tax_inclusive_amount ?? inv.total ?? 0)
        const tva = ht > 0 && ttc > ht ? parseFloat(((ttc - ht) / ht * 100).toFixed(1)) : 20
        return {
          supplier_name:  inv.supplier?.name ?? inv.third_party?.name ?? inv.label ?? 'Fournisseur inconnu',
          invoice_number: inv.invoice_number ?? inv.number ?? undefined,
          invoice_date:   inv.date?.split('T')[0] ?? fmt(from),
          amount_ht:      ht,
          tva_rate:       tva,
          amount_ttc:     ttc || +(ht * (1 + tva / 100)).toFixed(2),
          category:       guessCategory(inv.supplier?.name ?? inv.label ?? ''),
          external_id:    String(inv.id ?? ''),
        }
      }).filter(i => i.amount_ht > 0)

      return { success: true, invoices }
    } catch (err) {
      return { success: false, invoices: [], error: String(err) }
    }
  },
}
