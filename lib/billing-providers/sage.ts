import type { BillingProvider, SyncResult } from './types'

// Sage Business Cloud Comptabilité — API OAuth2
// Doc : https://developer.sage.com/accounting/
const BASE = 'https://api.accounting.sage.com/v3.1'

async function apiFetch(token: string, path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(`Sage ${res.status}`)
  return res.json()
}

function fmt(d: Date) { return d.toISOString().split('T')[0] }

export const sage: BillingProvider = {
  id: 'sage',
  name: 'Sage',
  logo: 'SG',
  color: 'bg-green-600',
  helpUrl: 'https://developer.sage.com/accounting/',
  tokenLabel: 'Access Token Sage',
  tokenPlaceholder: 'Bearer token issu de Sage OAuth2',
  needsCompanyId: false,

  async testConnection(token) {
    try {
      await apiFetch(token, '/purchase_invoices?items_per_page=1')
      return true
    } catch {
      return false
    }
  },

  async fetchWeekInvoices(token, from, to): Promise<SyncResult> {
    try {
      const url = `/purchase_invoices?from_date=${fmt(from)}&to_date=${fmt(to)}&items_per_page=100`
      const data = await apiFetch(token, url)
      const items: any[] = data.$items ?? data.items ?? []

      const invoices = items.map((inv: any) => {
        const ht  = parseFloat(inv.net_amount ?? 0)
        const ttc = parseFloat(inv.total_amount ?? 0)
        const tva = ht > 0 && ttc > ht ? parseFloat(((ttc - ht) / ht * 100).toFixed(1)) : 20
        return {
          supplier_name:  inv.contact?.name ?? 'Fournisseur inconnu',
          invoice_number: inv.reference ?? undefined,
          invoice_date:   inv.date?.split('T')[0] ?? fmt(from),
          amount_ht:      ht,
          tva_rate:       tva,
          amount_ttc:     ttc || +(ht * 1.2).toFixed(2),
          category:       'autre',
          external_id:    String(inv.id ?? ''),
        }
      }).filter((i: any) => i.amount_ht > 0)

      return { success: true, invoices }
    } catch (err) {
      return { success: false, invoices: [], error: String(err) }
    }
  },
}
