export interface ProviderInvoice {
  supplier_name: string
  invoice_number?: string
  invoice_date: string   // YYYY-MM-DD
  amount_ht: number
  tva_rate: number       // ex: 20 pour 20%
  amount_ttc: number
  category?: string      // viande / charcuterie / epicerie / emballage / frais_generaux / autre
  external_id?: string   // ID côté plateforme (pour déduplication)
  due_date?: string        // échéance de paiement YYYY-MM-DD (Pennylane: deadline) → trésorerie
  payment_status?: string  // statut de paiement côté plateforme (paid/unpaid…) → trésorerie
  file_url?: string        // URL du PDF de la facture (Pennylane: public_file_url, expire en 30 min —
                           // à télécharger PENDANT la sync, jamais à stocker telle quelle)
  is_fixed_charge?: boolean // facture de charge fixe (loyer, assurance, énergie, télécom…)
  period_days?: number      // durée couverte estimée (30 mensuel, 91 trimestriel, 182 semestriel, 365 annuel)
  prorata_ht?: number       // part hebdomadaire HT = amount_ht × 7 / period_days
}

export interface SyncResult {
  success: boolean
  invoices: ProviderInvoice[]
  error?: string
  debug?: string          // diagnostic non bloquant (ex: champs de date disponibles côté API)
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
