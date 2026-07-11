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
  // Immobilier / locaux
  'loyer', 'bail', 'sci ', 'immobili',
  // Assurances / prévoyance
  'assurance', 'mutuelle', 'prevoyance', 'prévoyance', 'axa', 'maaf', 'groupama', 'allianz',
  // Énergie / eau
  'edf', 'engie', 'totalenergies', 'total energies', 'electricit', 'électricit', 'energie', 'énergie', 'gaz',
  'veolia', 'suez', 'saur',
  // Télécom / logiciels / abonnements
  'orange', 'sfr', 'bouygues telecom', 'free pro', 'telecom', 'télécom', 'internet', 'fibre',
  'abonnement', 'forfait', 'logiciel', 'saas', 'pennylane', 'swile',
  // Financement / leasing
  'leasing', 'credit-bail', 'crédit-bail', 'credit bail', 'location longue duree',
  // Services récurrents
  'maintenance', 'entretien annuel', ' initial ', // Initial = location/entretien vêtements pro
  // Honoraires / conseil
  'honoraires', 'comptable', 'expert-comptable', 'fiduciaire', 'o2a', 'conseils',
  // Banque / cotisations / collectivités
  'frais bancaires', 'banque', 'cotisation', 'urssaf', 'redevance',
  'communaute urbaine', 'communauté urbaine', 'tresor public', 'trésor public', 'dgfip', 'impot', 'impôt',
]

function isFixedChargeLabel(label: string): boolean {
  const l = ` ${label.toLowerCase()} `
  return FIXED_CHARGE_KEYWORDS.some(k => l.includes(k))
}

/** Durée couverte estimée par la facture, d'après son libellé. Défaut : mensuel (30 j). */
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

/** Extrait la date de FACTURE (date du document) — PAS la date de saisie comptable ni l'échéance.
 *  Constat terrain : `date` chez Pennylane correspond souvent à la date de comptabilisation
 *  (les factures scannées en batch le lundi sortent toutes datées du lundi).
 *  On privilégie donc les champs explicites du document quand ils existent. */
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

/** Diagnostic : liste les champs du 1er item dont la valeur ressemble à une date,
 *  pour identifier une fois pour toutes le bon champ côté API. Stocké dans last_sync_error (non bloquant). */
function buildDateDebug(sample: any): string {
  if (!sample || typeof sample !== 'object') return ''
  const entries: string[] = []
  for (const [k, v] of Object.entries(sample)) {
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) entries.push(`${k}=${v.slice(0, 10)}`)
  }
  return entries.length ? `DEBUG dates API: ${entries.join(', ')}` : ''
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
      const data = await apiFetch(token, `/supplier_invoices?limit=100&sort=-date`)
      const items = parseItems(data)

      if (items.length === 0) {
        const topLevelKeys = Object.keys(data ?? {})
        const firstValue = topLevelKeys.length > 0 ? JSON.stringify(data[topLevelKeys[0]]).slice(0, 200) : 'vide'
        return {
          success: false,
          invoices: [],
          error: `parseItems=0. Clés de réponse: [${topLevelKeys.join(', ')}]. Premier champ: ${firstValue}`,
        }
      }

      const debug = buildDateDebug(items[0])

      // Filtrage côté client sur la plage de dates.
      // Les charges fixes sont TOUJOURS conservées même hors plage : leur prorata hebdo
      // s'applique à chaque semaine tant que la facture couvre la période.
      const mapped = items
        .map((inv: any) => mapInvoice(inv, dateFrom))
        .filter((i: ProviderInvoice) => {
          if (i.amount_ht <= 0) return false
          if (i.is_fixed_charge) {
            if (!i.invoice_date) return true
            const age = (new Date(dateTo).getTime() - new Date(i.invoice_date).getTime()) / 86400000
            return age >= 0 ? age <= (i.period_days ?? 30) : i.invoice_date <= dateTo
          }
          if (!i.invoice_date) return true
          return i.invoice_date >= dateFrom && i.invoice_date <= dateTo
        })

      if (mapped.length > 0) {
        return { success: true, invoices: mapped, debug }
      }

      const datesFound = items.slice(0, 10).map((inv: any) => pickInvoiceDate(inv) ?? '?').join(', ')
      const sample = items[0]
      return {
        success: false,
        invoices: [],
        error: `${items.length} factures trouvées, 0 dans ${dateFrom}→${dateTo}. Dates: ${datesFound}. Champs: ${JSON.stringify(Object.keys(sample))}`,
        debug,
      }
    } catch (err) {
      return { success: false, invoices: [], error: String(err) }
    }
  },
}
