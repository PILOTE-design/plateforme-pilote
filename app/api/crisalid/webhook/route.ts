/**
 * Webhook entrant Crisalid — reçoit les événements de caisse (ventes validées/terminées,
 * ouvertures/fermetures de caisse) et les archive bruts dans la table `crisalid_events`.
 *
 * URL à communiquer à Crisalid :
 *   https://<domaine-pilote>/api/crisalid/webhook
 *
 * Sécurité : si la variable d'environnement CRISALID_WEBHOOK_SECRET est définie, la
 * signature HMAC-SHA256 transmise dans l'en-tête (X-Kash-Signature / X-Crisalid-Signature)
 * est vérifiée ; un appel dont la signature est absente ou invalide est rejeté (401).
 * Tant que le secret n'est pas configuré (phase de mise en place), les événements sont
 * acceptés et archivés avec signature_valid = null.
 *
 * Mapping boutique → client : table billing_integrations
 *   (provider = 'crisalid', company_id = identifiant boutique / SHOPID).
 * Un événement dont la boutique n'est pas encore rattachée est tout de même archivé
 * (client_id = null) afin de ne rien perdre.
 *
 * NB : les noms exacts des champs du payload et de l'en-tête de signature sont à figer
 * à réception de la documentation API Crisalid — plusieurs variantes sont acceptées ici.
 */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Champs possibles selon la source de l'événement (à confirmer avec la doc Crisalid)
const SHOP_ID_KEYS = ['account_id', 'shopID', 'shopId', 'shop_id', 'shopid', 'boutique_id']
const TYPE_KEYS    = ['type', 'event', 'event_type']
const SIG_HEADERS  = ['x-kash-signature', 'x-crisalid-signature', 'x-signature']
const TS_HEADERS   = ['x-kash-timestamp', 'x-crisalid-timestamp', 'x-timestamp']

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v) return v
    if (typeof v === 'number') return String(v)
  }
  return null
}

function firstHeader(req: NextRequest, names: string[]): string | null {
  for (const n of names) {
    const v = req.headers.get(n)
    if (v) return v
  }
  return null
}

/**
 * Vérifie la signature HMAC-SHA256 du corps brut.
 * Retourne null si aucun secret n'est configuré (vérification désactivée),
 * true/false sinon. Deux schémas candidats sont testés : "timestamp.body" (doc Kash)
 * et le corps seul, pour rester compatible tant que le schéma exact n'est pas figé.
 */
function verifySignature(rawBody: string, sigHeader: string | null, timestamp: string | null): boolean | null {
  const secret = process.env.CRISALID_WEBHOOK_SECRET
  if (!secret) return null
  if (!sigHeader) return false
  const provided = sigHeader.replace(/^sha256=/i, '').trim().toLowerCase()
  const bases = timestamp ? [`${timestamp}.${rawBody}`, rawBody] : [rawBody]
  for (const base of bases) {
    const expected = crypto.createHmac('sha256', secret).update(base, 'utf8').digest('hex')
    if (
      expected.length === provided.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
    ) {
      return true
    }
  }
  return false
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()

  // Parse JSON — le payload brut est conservé tel quel si le corps n'est pas du JSON objet
  let parsed: Record<string, unknown> = {}
  try {
    const j: unknown = JSON.parse(rawBody)
    parsed = j && typeof j === 'object' && !Array.isArray(j)
      ? (j as Record<string, unknown>)
      : { _raw: j }
  } catch {
    parsed = { _raw: rawBody }
  }

  const sigHeader      = firstHeader(request, SIG_HEADERS)
  const timestamp      = firstHeader(request, TS_HEADERS)
  const signatureValid = verifySignature(rawBody, sigHeader, timestamp)

  // Secret configuré + signature invalide → appel non authentifié, rejeté
  if (signatureValid === false) {
    console.error('[crisalid webhook] signature invalide')
    return NextResponse.json({ error: 'Signature invalide' }, { status: 401 })
  }

  const shopId    = pickString(parsed, SHOP_ID_KEYS)
  const eventType = pickString(parsed, TYPE_KEYS) ?? 'unknown'

  const service = createServiceClient()

  // Mapping boutique → client (billing_integrations.company_id = SHOPID)
  let clientId: string | null = null
  if (shopId) {
    const { data: integ } = await service
      .from('billing_integrations')
      .select('client_id')
      .eq('provider', 'crisalid')
      .eq('company_id', shopId)
      .maybeSingle()
    clientId = (integ?.client_id as string | undefined) ?? null
  }

  const { error } = await service.from('crisalid_events').insert({
    client_id:       clientId,
    shop_id:         shopId,
    event_type:      eventType,
    signature_valid: signatureValid,
    payload:         parsed,
  })

  if (error) {
    console.error('[crisalid webhook] insert', error.message)
    return NextResponse.json({ error: 'Enregistrement échoué' }, { status: 500 })
  }

  // 200 systématique une fois l'événement archivé (évite les relances côté Crisalid)
  return NextResponse.json({ received: true })
}

// Petit point de santé pour vérifier dans un navigateur que l'URL répond (rien n'est exposé)
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'crisalid-webhook' })
}
