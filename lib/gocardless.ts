/**
 * Client GoCardless Bank Account Data (ex-Nordigen) — agrégation bancaire DSP2, lecture seule.
 *
 * Un seul compte développeur PILOTE (clés côté serveur), partagé par tous les clients.
 * Le boucher connecte SA banque via une "requisition" (redirection), sans compte GoCardless.
 *
 * Variables d'environnement (à définir sur Vercel, jamais dans le repo) :
 *   GOCARDLESS_SECRET_ID, GOCARDLESS_SECRET_KEY
 *
 * Docs : https://developer.gocardless.com/bank-account-data/
 */

const BASE = 'https://bankaccountdata.gocardless.com/api/v2'

function creds(): { secret_id: string; secret_key: string } | null {
  const secret_id = process.env.GOCARDLESS_SECRET_ID
  const secret_key = process.env.GOCARDLESS_SECRET_KEY
  if (!secret_id || !secret_key) return null
  return { secret_id, secret_key }
}

/** Vrai si les clés API sont configurées (sinon la feature reste dormante). */
export function gocardlessConfigured(): boolean {
  return creds() !== null
}

/** Jeton d'accès (validité 24 h) — récupéré à la demande. */
export async function getToken(): Promise<string> {
  const c = creds()
  if (!c) throw new Error('GoCardless non configuré (GOCARDLESS_SECRET_ID / GOCARDLESS_SECRET_KEY manquants)')
  const res = await fetch(`${BASE}/token/new/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ secret_id: c.secret_id, secret_key: c.secret_key }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Token GoCardless échoué (${res.status})`)
  const j = await res.json()
  return j.access as string
}

async function gcFetch(path: string, token: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      accept: 'application/json',
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  })
  const text = await res.text()
  let json: any = null
  try { json = text ? JSON.parse(text) : null } catch { json = { raw: text } }
  if (!res.ok) throw new Error(`GoCardless ${path} (${res.status}) ${String(text).slice(0, 200)}`)
  return json
}

export interface GcInstitution { id: string; name: string; bic?: string; logo?: string; transaction_total_days?: string }

/** Liste des banques disponibles pour un pays (FR par défaut). */
export async function listInstitutions(country = 'fr'): Promise<GcInstitution[]> {
  const token = await getToken()
  const list = await gcFetch(`/institutions/?country=${encodeURIComponent(country)}`, token)
  return Array.isArray(list) ? list : []
}

/** Crée une demande de connexion et renvoie le lien vers lequel rediriger le boucher. */
export async function createRequisition(opts: { institutionId: string; redirect: string; reference: string }): Promise<{ id: string; link: string }> {
  const token = await getToken()
  const j = await gcFetch('/requisitions/', token, {
    method: 'POST',
    body: JSON.stringify({
      institution_id: opts.institutionId,
      redirect: opts.redirect,
      reference: opts.reference,
      user_language: 'FR',
    }),
  })
  return { id: j.id as string, link: j.link as string }
}

export async function getRequisition(id: string): Promise<{ status: string; accounts: string[]; institution_id: string }> {
  const token = await getToken()
  const j = await gcFetch(`/requisitions/${id}/`, token)
  return { status: j.status as string, accounts: (j.accounts || []) as string[], institution_id: j.institution_id as string }
}

export async function getAccountDetails(accountId: string, token: string): Promise<any> {
  const j = await gcFetch(`/accounts/${accountId}/details/`, token)
  return j.account || {}
}

export async function getAccountBalances(accountId: string, token: string): Promise<any[]> {
  const j = await gcFetch(`/accounts/${accountId}/balances/`, token)
  return (j.balances || []) as any[]
}

export async function getAccountTransactions(accountId: string, token: string): Promise<{ booked: any[]; pending: any[] }> {
  const j = await gcFetch(`/accounts/${accountId}/transactions/`, token)
  const t = j.transactions || {}
  return { booked: (t.booked || []) as any[], pending: (t.pending || []) as any[] }
}

/** Sélectionne le solde le plus pertinent parmi ceux renvoyés par la banque. */
export function pickBalance(balances: any[]): { amount: number; currency: string } | null {
  if (!balances || balances.length === 0) return null
  const order = ['closingBooked', 'interimAvailable', 'expected', 'interimBooked']
  let chosen = balances.find(b => order.includes(b.balanceType)) || balances[0]
  const amt = parseFloat(chosen?.balanceAmount?.amount ?? '')
  if (isNaN(amt)) return null
  return { amount: amt, currency: chosen?.balanceAmount?.currency || 'EUR' }
}

/** Normalise une transaction GoCardless vers nos colonnes. */
export function mapTransaction(tx: any, status: 'booked' | 'pending') {
  const amount = parseFloat(tx?.transactionAmount?.amount ?? '0') || 0
  const currency = tx?.transactionAmount?.currency || 'EUR'
  const description =
    tx?.remittanceInformationUnstructured ||
    (Array.isArray(tx?.remittanceInformationUnstructuredArray) ? tx.remittanceInformationUnstructuredArray.join(' ') : '') ||
    tx?.additionalInformation ||
    ''
  const counterparty = amount < 0 ? (tx?.creditorName || '') : (tx?.debtorName || '')
  return {
    provider_tx_id: tx?.transactionId || tx?.internalTransactionId || null,
    booking_date: tx?.bookingDate || null,
    value_date: tx?.valueDate || null,
    amount,
    currency,
    description: description || null,
    counterparty: counterparty || null,
    status,
    raw: tx,
  }
}
