export interface ProviderInvoice {
  supplier_name: string
  invoice_number?: string
  invoice_date: string   // YYYY-MM-DD
  amount_ht: number
  tva_rate: number       // ex: 20 pour 20%
  amount_ttc: number
  category?: string      // viande / charcuterie / epicerie / emballage / frais_generaux / autre
  external_id?: string   // ID côté plateforme (pour déduplication)
}

export interface SyncResult {
  success: boolean
  invoices: ProviderInvoice[]
  error?: string
}

export interface BillingProvider {
  id: string
  name: string
  logo: string           // emoji ou initiales
  color: string          // tailwind bg color
  helpUrl: string
  tokenLabel: string     // label affiché dans l'UI
  tokenPlaceholder: string
  needsCompanyId: boolean
  companyIdLabel?: string
  testConnection(token: string, companyId?: string): Promise<boolean>
  fetchWeekInvoices(token: string, from: Date, to: Date, companyId?: string): Promise<SyncResult>
}
