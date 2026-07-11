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

// ─── Détection des charges fixes ────────────────────────────────────────

const FIXED_CHARGE_KEYWORDS = [
  'loyer', 'bail', 'sci ', 'immobili',
  'assurance', 'mutuelle', 'prevoyance', 'prévoyance', 'axa', 'maaf', 'groupama', 'allianz',
  'edf', 'engie', 'totalenergies', 'total energies', 'electricit', 'électricit', 'energie', 'énergie', 'gaz',
  'veolia', 'suez', 'saur',
  'orange', 'sfr', 'bouygues telecom', 'free pro', 'telecom', 'télécom', 'internet', 'fibre',
  'abonnement', 'forfait', 'logiciel', 'saas', 'pennylane', 'swile',
  'leasing', 'credit-bail', 'crédit-bail', 'credit bail', 'location longue duree',
  'maintenance', 'entretien annuel', ' initial ',
  'honoraires', 'comptable', 'expert-comptable', 'fiduciaire', 'o2a', 'conseils',
  'frais bancaires', 'banque', 'cotisation', 'urssaf', 'redevance',
  'communaute urbaine', 'communauté urbaine', 'tresor public', 'trésor public', 'dgfip', 'impot', 'impôt',
]

function isFixedChargeLabel(label: string): boolean {
  const l = ` ${label.toLowerCase()} `
  return FIXED_CHARGE_KEYWORDS.some(k => l.includes(k))
}

function detectPeriodDays(label: string): number {
  const l = label.toLowerCase()
  if (l.includes('annuel') || l.includes('/an') || l.includes('12 mois') || l.includes('année')) return 365
  if (l.includes('semestr') || l.includes('6 mois')) return 182
  if (l.includes('trimestr') || l.includes('3 mois')) return 91
  return 30
}

function parseItems(data: any): any[] {
  if (Array.isArray(data?.supplier_invoices)) return data.supplier_invoices
  if (Array.isArray(data?.invoices))          return data.invoices
  if (Array.isArray(data?.data))              return data.data
  if (Array.isArray(data?.items))             return data.items
  if (Array.isArray(data?.results))           return data.results
  if (Array.isArray(data))                   return data
  return []
}

/** Date de facture si un champ exploitable existe dans le payload (souvent absent chez Pennylane v2 :
 *  seul created_at/updated_at sont renvoyés — d'où le filtrage par date CÔTÉ SERVEUR ci-dessous). */
function pickInvoiceDate(inv: any): string | null {
  const candidates = [
    inv.invoice_date, inv.emission_date, inv.emitted_at, inv.issue_date, inv.issued_at,
    inv.document_date, inv.billing_date, inv.date,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && /^\d{4}-\d{2}-\d{2}/.test(c)) return c.split('T')[0]
  }
  return null
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
  const supplierName = inv.supplier?.name ?? inv.third_party?.name ?? inv.vendor?.name ?? inv.label ?? 'Fournisseur inconnu'
  const category     = guessCategory(`${supplierName} ${inv.label ?? ''}`)

  const detectText   = `${supplierName} ${inv.label ?? ''} ${inv.invoice_number ?? ''}`
  const isFixed      = category === 'frais_generaux' || isFixedChargeLabel(detectText)
  const periodDays   = isFixed ? detectPeriodDays(detectText) : undefined
  const prorataHt    = isFixed && periodDays && ht > 0 ? Math.round((ht * 7 / periodDays) * 100) / 100 : undefined

  return {
    supplier_name:  supplierName,
    invoice_number: inv.invoice_number ?? inv.number ?? inv.reference ?? undefined,
    invoice_date:   pickInvoiceDate(inv) ?? fallbackDate,
    amount_ht:      ht,
    tva_rate:       tva,
    amount_ttc:     ttc || +(ht * (1 + tva / 100)).toFixed(2),
    category,
    external_id:    String(inv.id ?? ''),
    is_fixed_charge: isFixed,
    period_days:     periodDays,
    prorata_ht:      prorataHt,
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
      // ── FILTRAGE PAR DATE CÔTÉ SERVEUR ──
      // Le payload des factures ne contient AUCUNE date de document (seulement created_at/updated_at),
      // mais le champ `date` est filtrable/triable côté API. On demande donc directement à Pennylane
      // les factures dont la date est dans la semaine — c'est la seule source de vérité fiable.
      const filter = encodeURIComponent(JSON.stringify([
        { field: 'date', operator: 'gteq', value: dateFrom },
        { field: 'date', operator: 'lteq', value: dateTo },
      ]))
      let data: any
      let serverFiltered = true
      try {
        data = await apiFetch(token, `/supplier_invoices?limit=100&filter=${filter}`)
      } catch {
        serverFiltered = false
        data = await apiFetch(token, `/supplier_invoices?limit=100&sort=-date`)
      }
      const items = parseItems(data)

      const debug = items.length > 0
        ? `DEBUG ${serverFiltered ? 'filtre serveur OK' : 'filtre serveur KO (fallback tri)'} | item[0]: ${JSON.stringify(items[0]).slice(0, 450)}`
        : undefined

      if (items.length === 0) {
        if (serverFiltered) {
          // Semaine sans facture : c'est un résultat valide, pas une erreur
          return { success: true, invoices: [], debug: `Aucune facture datée entre ${dateFrom} et ${dateTo} (filtre serveur)` }
        }
        const topLevelKeys = Object.keys(data ?? {})
        const firstValue = topLevelKeys.length > 0 ? JSON.stringify(data[topLevelKeys[0]]).slice(0, 200) : 'vide'
        return {
          success: false,
          invoices: [],
          error: `parseItems=0. Clés de réponse: [${topLevelKeys.join(', ')}]. Premier champ: ${firstValue}`,
        }
      }

      let mapped = items.map((inv: any) => mapInvoice(inv, dateFrom)).filter((i: ProviderInvoice) => i.amount_ht > 0)

      // Sans filtre serveur (fallback), on filtre côté client sur les dates disponibles
      if (!serverFiltered) {
        mapped = mapped.filter((i: ProviderInvoice) => {
          if (i.is_fixed_charge) {
            if (!i.invoice_date) return true
            const age = (new Date(dateTo).getTime() - new Date(i.invoice_date).getTime()) / 86400000
            return age >= 0 ? age <= (i.period_days ?? 30) : i.invoice_date <= dateTo
          }
          if (!i.invoice_date) return true
          return i.invoice_date >= dateFrom && i.invoice_date <= dateTo
        })
      }

      if (mapped.length > 0) {
        return { success: true, invoices: mapped, debug }
      }

      return {
        success: true,
        invoices: [],
        debug: debug ?? `0 facture retenue entre ${dateFrom} et ${dateTo}`,
      }
    } catch (err) {
      return { success: false, invoices: [], error: String(err) }
    }
  },
}
