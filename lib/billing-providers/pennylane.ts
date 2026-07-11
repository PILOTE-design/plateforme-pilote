import type { BillingProvider, ProviderInvoice } from './types'

const BASE = 'https://app.pennylane.com/api/external/v2'

function fmt(d: Date) {
  return d.toISOString().split('T')[0]
}

async function apiFetch(token: string, path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(8000),
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
  // Essai dans l'ordre le plus probable pour l'API Pennylane v2
  if (Array.isArray(data?.supplier_invoices)) return data.supplier_invoices
  if (Array.isArray(data?.invoices))          return data.invoices
  if (Array.isArray(data?.data))              return data.data
  if (Array.isArray(data?.items))             return data.items
  if (Array.isArray(data?.results))           return data.results
  if (Array.isArray(data))                   return data
  return []
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
        signal: AbortSignal.timeout(8000),
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
      const data = await apiFetch(token, `/supplier_invoices?limit=100&sort=-date`)
      const items = parseItems(data)

      // Si on n'a rien trouvé, loguer la structure brute de la réponse pour identifier la bonne clé
      if (items.length === 0) {
        const topLevelKeys = Object.keys(data ?? {})
        const firstValue = topLevelKeys.length > 0 ? JSON.stringify(data[topLevelKeys[0]]).slice(0, 200) : 'vide'
        return {
          success: false,
          invoices: [],
          error: `parseItems=0. Clés de réponse: [${topLevelKeys.join(', ')}]. Premier champ: ${firstValue}`,
        }
      }

      // Filtrage côté client sur la plage de dates
      const mapped = items
        .map((inv: any) => mapInvoice(inv, dateFrom))
        .filter((i: ProviderInvoice) => {
          if (i.amount_ht <= 0) return false
          if (!i.invoice_date) return true
          return i.invoice_date >= dateFrom && i.invoice_date <= dateTo
        })

      if (mapped.length > 0) {
        return { success: true, invoices: mapped }
      }

      // Factures trouvées mais aucune dans la plage de dates
      const datesFound = items.slice(0, 10).map((inv: any) => inv.date ?? inv.invoice_date ?? '?').join(', ')
      const sample = items[0]
      return {
        success: false,
        invoices: [],
        error: `${items.length} factures trouvées, 0 dans ${dateFrom}→${dateTo}. Dates: ${datesFound}. Champs: ${JSON.stringify(Object.keys(sample))}`,
      }
    } catch (err) {
      return { success: false, invoices: [], error: String(err) }
    }
  },
}
