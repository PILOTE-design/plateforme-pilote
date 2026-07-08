import type { BillingProvider, SyncResult } from './types'

// EBP en ligne — API REST
// Doc : https://developer.ebp.com
const BASE = 'https://api.ebp.com/v1'

async function apiFetch(token: string, path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(`EBP ${res.status}`)
  return res.json()
}

function fmt(d: Date) { return d.toISOString().split('T')[0] }

export const ebp: BillingProvider = {
  id: 'ebp',
  name: 'EBP',
  logo: 'EBP',
  color: 'bg-orange-600',
  helpUrl: 'https://developer.ebp.com',
  tokenLabel: 'Token API EBP en ligne',
  tokenPlaceholder: 'Token depuis EBP → Paramètres → API',
  needsCompanyId: true,
  companyIdLabel: 'Identifiant dossier EBP',

  async testConnection(token, companyId) {
    try {
      await apiFetch(token, `/companies/${companyId}/purchase-invoices?top=1`)
      return true
    } catch {
      return false
    }
  },

  async fetchWeekInvoices(token, from, to, companyId): Promise<SyncResult> {
    try {
      const url = `/companies/${companyId}/purchase-invoices?dateFrom=${fmt(from)}&dateTo=${fmt(to)}&top=100`
      const data = await apiFetch(token, url)
      const items: any[] = data.value ?? data.items ?? []

      const invoices = items.map((inv: any) => {
        const ht  = parseFloat(inv.NetAmount ?? inv.TotalNetAmount ?? 0)
        const ttc = parseFloat(inv.TaxIncludedAmount ?? inv.TotalAmount ?? 0)
        const tva = ht > 0 && ttc > ht ? parseFloat(((ttc - ht) / ht * 100).toFixed(1)) : 20
        return {
          supplier_name:  inv.ThirdParty?.Name ?? inv.SupplierName ?? 'Fournisseur inconnu',
          invoice_number: inv.Number ?? inv.Reference ?? undefined,
          invoice_date:   inv.Date?.split('T')[0] ?? fmt(from),
          amount_ht:      ht,
          tva_rate:       tva,
          amount_ttc:     ttc || +(ht * 1.2).toFixed(2),
          category:       'autre',
          external_id:    String(inv.Id ?? ''),
        }
      }).filter((i: any) => i.amount_ht > 0)

      return { success: true, invoices }
    } catch (err) {
      return { success: false, invoices: [], error: String(err) }
    }
  },
}
