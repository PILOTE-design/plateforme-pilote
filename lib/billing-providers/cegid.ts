import type { BillingProvider, SyncResult } from './types'

// Cegid Loop — API REST
// Doc : https://developers.cegid.com/loop
const BASE = 'https://api.cegid.com/loop/v1'

async function apiFetch(token: string, path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'X-API-Key': token, 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(`Cegid ${res.status}`)
  return res.json()
}

function fmt(d: Date) { return d.toISOString().split('T')[0] }

export const cegid: BillingProvider = {
  id: 'cegid',
  name: 'Cegid',
  logo: 'CG',
  color: 'bg-purple-600',
  helpUrl: 'https://developers.cegid.com',
  tokenLabel: 'Clé API Cegid',
  tokenPlaceholder: 'Clé API depuis votre espace Cegid',
  needsCompanyId: true,
  companyIdLabel: 'ID Entreprise Cegid',

  async testConnection(token, companyId) {
    try {
      await apiFetch(token, `/companies/${companyId}/purchase-invoices?limit=1`)
      return true
    } catch {
      return false
    }
  },

  async fetchWeekInvoices(token, from, to, companyId): Promise<SyncResult> {
    try {
      const url = `/companies/${companyId}/purchase-invoices?dateFrom=${fmt(from)}&dateTo=${fmt(to)}&limit=100`
      const data = await apiFetch(token, url)
      const items: any[] = data.items ?? data.data ?? []

      const invoices = items.map((inv: any) => {
        const ht  = parseFloat(inv.netAmount ?? inv.amountExcludingTax ?? 0)
        const ttc = parseFloat(inv.totalAmount ?? inv.amountIncludingTax ?? 0)
        const tva = ht > 0 && ttc > ht ? parseFloat(((ttc - ht) / ht * 100).toFixed(1)) : 20
        return {
          supplier_name:  inv.supplier?.name ?? inv.vendorName ?? 'Fournisseur inconnu',
          invoice_number: inv.invoiceNumber ?? inv.reference ?? undefined,
          invoice_date:   inv.invoiceDate?.split('T')[0] ?? fmt(from),
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
