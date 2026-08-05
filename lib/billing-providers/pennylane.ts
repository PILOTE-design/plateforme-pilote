import type { BillingProvider, ProviderInvoice, ProviderRejet } from './types'
import { verdictReleve, phraseReleve } from '@/lib/document-releve'

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

/** Date de facture. Schéma v2 confirmé (debug 11/07/2026) : le champ `date` est la date du document
 *  quand il est renseigné (sinon null — le filtre serveur garantit de toute façon la bonne semaine). */
function pickInvoiceDate(inv: any): string | null {
  const candidates = [inv.date, inv.invoice_date, inv.emission_date, inv.issue_date, inv.document_date]
  for (const c of candidates) {
    if (typeof c === 'string' && /^\d{4}-\d{2}-\d{2}/.test(c)) return c.split('T')[0]
  }
  return null
}

/** Un montant lisible, ou rien. Sert au bilan des documents écartés, où le
 *  montant n'est là que pour aider le boucher à reconnaître la pièce. */
function montantLisible(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined
  const n = parseFloat(String(v))
  return Number.isFinite(n) ? n : undefined
}

function mapInvoice(inv: any, fallbackDate: string): ProviderInvoice {
  // Schéma v2 confirmé : currency_amount_before_tax = HT, currency_amount = TTC, currency_tax = TVA.
  // Les montants peuvent être NÉGATIFS (avoirs) — ils viennent en déduction des achats.
  // MONTANTS — on ne DÉRIVE plus le HT du TTC (31/07). L'ancien repli faisait
  // prendre au HT la valeur TTC quand le champ manquait : l'achat était alors
  // surévalué de 5,5 à 20 %, et surtout les lignes lues en HT étaient comparées
  // à un total TTC — écart mécanique au-dessus du seuil, donc 100 % des prix du
  // fournisseur en quarantaine. Mieux vaut un montant absent, signalé, qu'un
  // montant plausible et faux.
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null
    const n = parseFloat(String(v))
    return Number.isFinite(n) ? n : null
  }
  const htLu  = num(inv.currency_amount_before_tax) ?? num(inv.amount_before_tax) ?? num(inv.pre_tax_amount)
  const ttcLu = num(inv.currency_amount) ?? num(inv.amount) ?? num(inv.currency_tax_inclusive_amount) ?? num(inv.tax_inclusive_amount)
  const taxeLue = num(inv.currency_tax) ?? num(inv.tax)
  // HT absent mais TVA connue : la soustraction est exacte, pas une supposition
  const ht  = htLu ?? (ttcLu !== null && taxeLue !== null ? Math.round((ttcLu - taxeLue) * 100) / 100 : 0)
  const ttc = ttcLu ?? (htLu !== null && taxeLue !== null ? Math.round((htLu + taxeLue) * 100) / 100 : 0)
  // Taux de TVA : calculé seulement s'il tombe sur un taux réel du métier.
  // Sinon null — une TVA à 100 % (cas TTC nul) se recopiait sur chaque ligne.
  const TAUX_PLAUSIBLES = [0, 2.1, 5.5, 10, 20]
  const tvaCalc = ht !== 0 && ttc !== 0 ? Math.round(Math.abs((ttc - ht) / ht) * 1000) / 10 : null
  const tva = tvaCalc !== null
    ? (TAUX_PLAUSIBLES.find(t => Math.abs(t - tvaCalc) <= 0.6) ?? tvaCalc)
    : 20
  const supplierName = inv.supplier?.name ?? inv.third_party?.name ?? inv.vendor?.name ?? inv.label ?? 'Fournisseur inconnu'
  const category     = guessCategory(`${supplierName} ${inv.label ?? ''}`)

  const detectText   = `${supplierName} ${inv.label ?? ''} ${inv.invoice_number ?? ''}`
  const isFixed      = category === 'frais_generaux' || isFixedChargeLabel(detectText)
  const periodDays   = isFixed ? detectPeriodDays(detectText) : undefined
  const prorataHt    = isFixed && periodDays && ht !== 0 ? Math.round((ht * 7 / periodDays) * 100) / 100 : undefined

  // Échéance, statut de paiement et PDF — schéma v2 documenté (deadline,
  // payment_status, public_file_url). L'URL du fichier expire en 30 minutes :
  // la sync doit télécharger le PDF immédiatement, pas conserver le lien.
  const dueDate = typeof inv.deadline === 'string' && /^\d{4}-\d{2}-\d{2}/.test(inv.deadline)
    ? inv.deadline.split('T')[0] : undefined

  return {
    supplier_name:  supplierName,
    invoice_number: inv.invoice_number ?? inv.number ?? inv.reference ?? undefined,
    invoice_date:   pickInvoiceDate(inv) ?? fallbackDate,
    amount_ht:      ht,
    tva_rate:       tva,
    // Plus de TTC reconstruit à 20 % en dur sur une facture de viande à 5,5 % :
    // sans TTC lisible, on renvoie le HT (le TTC ne sert à aucun calcul de marge).
    amount_ttc:     ttc || ht,
    category,
    external_id:    String(inv.id ?? ''),
    due_date:       dueDate,
    payment_status: typeof inv.payment_status === 'string' ? inv.payment_status : undefined,
    file_url:       typeof inv.public_file_url === 'string' && inv.public_file_url ? inv.public_file_url : undefined,
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
      // FILTRAGE PAR DATE CÔTÉ SERVEUR — seule source de vérité fiable (confirmé en production)
      const filter = encodeURIComponent(JSON.stringify([
        { field: 'date', operator: 'gteq', value: dateFrom },
        { field: 'date', operator: 'lteq', value: dateTo },
      ]))
      let data: any
      let serverFiltered = true
      try {
        data = await apiFetch(token, `/supplier_invoices?limit=100&filter=${filter}`)
      } catch (e) {
        // Le repli n'a de sens que si le FILTRE est refusé (4xx de structure).
        // Sur un 429, un 5xx ou un timeout, basculer en non filtré revenait à
        // demander les 100 dernières factures : si la semaine visée est plus
        // ancienne, elle n'y est pas, et on renvoyait « aucune facture » avec
        // un succès. Une panne réseau ne doit jamais ressembler à une semaine vide.
        const msg = String(e)
        const structurel = /Pennylane 4(00|22)/.test(msg)
        if (!structurel) {
          return { success: false, invoices: [], error: `Pennylane injoignable ou en erreur : ${msg.slice(0, 200)}` }
        }
        serverFiltered = false
        data = await apiFetch(token, `/supplier_invoices?limit=100&sort=-date`)
      }
      const items = parseItems(data)

      if (items.length === 0) {
        if (serverFiltered) {
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

      // UN RELEVÉ N'EST PAS UNE FACTURE — et il n'entre pas.
      //
      // Un relevé de compte, un relevé de factures ou un échéancier récapitule
      // ce qui a DÉJÀ été facturé. Importé comme une facture, il compte
      // l'argent deux fois — achats, marge, résultat, rapport PDF, tous faux
      // du montant du relevé — et ses lignes, qui sont des totaux et des
      // numéros de pièce, fabriquent des prix qui n'en sont pas dans la
      // mercuriale. Il coûte en plus une lecture payante à chaque passage.
      //
      // Le tri se fait ICI, dans le connecteur, parce que c'est le point
      // unique par lequel passent les trois voies Pennylane : la sync
      // manuelle, la sync de nuit et le rattrapage. Le même contrôle posé
      // dans les trois routes aurait divergé.
      //
      // On juge sur le LIBELLÉ du document, jamais sur le nom du fournisseur
      // seul : un fournisseur peut s'appeler « RELEVÉ SARL ». Une facture
      // écartée à tort est invisible ; un relevé importé se voit dans les
      // chiffres. En cas de doute, on importe.
      const rejets: ProviderRejet[] = []
      const items2 = items.filter((inv: any) => {
        const v = verdictReleve({ libelle: typeof inv?.label === 'string' ? inv.label : null })
        if (!v.releve) return true
        const nom = inv?.supplier?.name ?? inv?.third_party?.name ?? inv?.vendor?.name ?? inv?.label ?? 'Fournisseur inconnu'
        rejets.push({
          supplier_name: String(nom),
          invoice_number: inv?.invoice_number ?? inv?.number ?? inv?.reference ?? undefined,
          invoice_date: pickInvoiceDate(inv) ?? undefined,
          amount_ht: montantLisible(inv?.currency_amount_before_tax ?? inv?.amount_before_tax),
          motif: phraseReleve(v, String(nom)),
        })
        return false
      })

      // Avoirs inclus (montants négatifs) — seuls les montants nuls sont écartés
      let mapped = items2.map((inv: any) => mapInvoice(inv, dateFrom))
        .filter((i: ProviderInvoice) => Number.isFinite(i.amount_ht) && i.amount_ht !== 0)

      if (!serverFiltered) {
        const brut = mapped.length
        mapped = mapped.filter((i: ProviderInvoice) => {
          if (i.is_fixed_charge) {
            if (!i.invoice_date) return true
            const age = (new Date(dateTo).getTime() - new Date(i.invoice_date).getTime()) / 86400000
            return age >= 0 ? age <= (i.period_days ?? 30) : i.invoice_date <= dateTo
          }
          if (!i.invoice_date) return true
          return i.invoice_date >= dateFrom && i.invoice_date <= dateTo
        })
        // Liste pleine + zéro retenue = la semaine demandée est probablement
        // hors des 100 dernières factures. On le dit plutôt que de conclure.
        if (mapped.length === 0 && brut >= 100) {
          return {
            success: false, invoices: [],
            error: `Filtre serveur indisponible et la semaine du ${dateFrom} n'est pas dans les 100 dernières factures : impossible de conclure. Réessayez.`,
          }
        }
      }

      return { success: true, invoices: mapped, rejets }
    } catch (err) {
      return { success: false, invoices: [], error: String(err) }
    }
  },
}
