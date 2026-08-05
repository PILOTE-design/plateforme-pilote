/**
 * Webhook de réception d'emails entrants (factures transférées par l'utilisateur).
 * Fournisseur branché : RESEND INBOUND (webhook `email.received`, signé Svix).
 * Les formats historiques (Mailgun, Postmark, SendGrid Inbound Parse) restent
 * lus, mais uniquement tant qu'aucun secret de signature n'est configuré.
 * L'adresse cible est : factures-{billing_forward_id}@getpilote.app
 *
 * C'EST LE CONNECTEUR DES BOUCHERIES SANS LOGICIEL DE FACTURATION (31/07).
 * Beaucoup de maisons n'ont ni Pennylane ni équivalent : elles transfèrent
 * simplement la facture reçue par mail. Le chemin doit alors être EXACTEMENT
 * celui d'une facture Pennylane, à la source près.
 *
 * D'où : la PIÈCE JOINTE PDF est la source. Elle est archivée dans le bucket
 * `invoice-files` comme le fait la synchro, l'en-tête est lu SUR LE PDF (texte
 * par coordonnées, puis IA) et la facture entre dans la MÊME file de lecture
 * (`lines_status` null) — lignes, articles, mercuriale, quarantaine des prix,
 * fiches recettes. Un seul moteur, une seule porte de validation : la facture
 * arrive « à vérifier » et ne compte dans la marge qu'après validation humaine.
 *
 * Le corps du mail reste le repli quand il n'y a AUCUNE pièce jointe lisible —
 * la facture est alors créée sans PDF et signalée comme telle, jamais devinée.
 *
 * Particularité Resend : le webhook ne porte que les MÉTADONNÉES (ni corps, ni
 * pièces jointes). Le mail complet est RÉCUPÉRÉ par l'API avec la clé déjà
 * utilisée pour l'envoi (RESEND_API_KEY), et la pièce jointe est téléchargée
 * par son URL présignée.
 *
 * Garde-fous :
 *   · signature Svix vérifiée dès que RESEND_WEBHOOK_SECRET est posée — les
 *     requêtes non signées sont alors refusées (401), quel qu'en soit le format ;
 *   · sans variable d'environnement, le VERROU PAR CLÉ D'URL prend le relais
 *     (lot 35) : la clé rangée en base (platform_settings.inbound_webhook_key)
 *     doit accompagner l'appel en `?cle=` — seul Resend connaît l'URL complète.
 *     Le webhook n'est JAMAIS ouvert à tous dès qu'un des deux verrous existe ;
 *   · destinataire inconnu, adresse non vérifiée : 200 SILENCIEUX (journalisé) —
 *     on ne renseigne pas un curieux, et Resend n'a rien à réessayer ;
 *   · échec transitoire (API Resend, extraction IA) : 4xx — Resend RÉESSAIE plus
 *     tard, et l'archivage sous un nom DÉTERMINISTE (mail-{email_id}) rend ces
 *     rejeux sans doublon ;
 *   · même mail livré deux fois : détecté par le marqueur [resend:{email_id}]
 *     dans les notes de la facture déjà créée — on répond « déjà reçue ».
 *
 * Cas à part — le CODE DE CONFIRMATION GMAIL (lot 34) : quand le boucher
 * ajoute son adresse PILOTE comme adresse de transfert automatique, Google
 * envoie son code de confirmation… ici. Sans relais, la mise en place mourrait
 * à cette étape. Le code (et le lien « confirmer en un clic ») sont rangés sur
 * le profil ; l'écran Facturation les affiche, le boucher finit ses trois
 * clics. Aucune facture n'est créée pour ce mail-là.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { loadSupplierCategories, rememberedCategory } from '@/lib/supplier-memory'
import { weekForInvoice, plausibleDelivery } from '@/lib/invoice-week'
import { pdfToLines } from '@/lib/pdf-lines'
import { verdictReleve, phraseReleve } from '@/lib/document-releve'
import { randomUUID, createHmac, timingSafeEqual } from 'crypto'
import Anthropic from '@anthropic-ai/sdk'

// Clé de repli au build : le constructeur Anthropic lève une erreur si la clé est absente,
// ce qui casse `next build` (« Collecting page data »). En prod, l'extraction échoue
// proprement à l'exécution tant que ANTHROPIC_API_KEY n'est pas définie.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'MISSING_ANTHROPIC_KEY' })

/** Au-delà, la pièce jointe n'est pas téléchargée : une facture n'a pas cette
 *  taille, et le webhook doit répondre avant l'échéance de Vercel. */
const TAILLE_PIECE_MAX = 15 * 1024 * 1024

function getISOWeek(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return { week: Math.ceil((((d.getTime() - y.getTime()) / 86400000) + 1) / 7), year: d.getUTCFullYear() }
}

/** Une pièce jointe retenue : son nom et son contenu */
type Piece = { filename: string; buffer: Buffer }

const looksPdf = (name: string, type?: string) =>
  /\.pdf$/i.test(String(name || '')) || String(type || '').toLowerCase().includes('pdf')

/** Vérification de la signature Svix (schéma des webhooks Resend).
 *  Retourne null si la signature est valable, sinon le MOTIF du rejet.
 *  Implémentée sans dépendance : HMAC-SHA256 de `{id}.{timestamp}.{corps brut}`
 *  avec la clé base64 du secret (après le préfixe `whsec_`), comparée à chacune
 *  des signatures annoncées (l'en-tête peut en porter plusieurs, séparées par
 *  des espaces, chacune préfixée de sa version « v1, »). */
function verifierSignatureSvix(headers: Headers, corps: string, secret: string): string | null {
  const id = headers.get('svix-id')
  const ts = headers.get('svix-timestamp')
  const sigs = headers.get('svix-signature')
  if (!id || !ts || !sigs) return 'en-têtes svix absents'
  const age = Math.abs(Date.now() / 1000 - Number(ts))
  if (!Number.isFinite(age) || age > 300) return `horodatage hors fenêtre (${Math.round(age)} s) — rejeu ?`
  let attendu: Buffer
  try {
    const cle = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64')
    attendu = createHmac('sha256', cle).update(`${id}.${ts}.${corps}`).digest()
  } catch { return 'secret de signature illisible' }
  for (const partie of sigs.split(' ')) {
    const val = partie.includes(',') ? partie.slice(partie.indexOf(',') + 1) : partie
    try {
      const recu = Buffer.from(val, 'base64')
      if (recu.length === attendu.length && timingSafeEqual(recu, attendu)) return null
    } catch { /* signature illisible : on tente la suivante */ }
  }
  return 'aucune signature ne correspond'
}

/** Première pièce jointe PDF du message, pour les formats qui livrent le
 *  contenu EN LIGNE (formats historiques — Resend passe par l'API, plus bas).
 *  Deux formes coexistent dans la nature :
 *   · form-data avec un vrai fichier (SendGrid Inbound Parse, Mailgun) ;
 *   · JSON avec un tableau `attachments` en base64 (Mailgun API, Postmark qui
 *     capitalise : `Attachments`, `Name`, `Content`).
 *  Aucune n'est privilégiée : on prend la première qui ressemble à un PDF.
 *  null = pas de pièce jointe exploitable (le corps du mail prendra le relais). */
async function pickPdf(body: any, form: FormData | null): Promise<Piece | null> {
  if (form) {
    for (const [, value] of form.entries()) {
      if (value && typeof value === 'object' && 'arrayBuffer' in value) {
        const f = value as File
        if (!looksPdf(f.name, f.type)) continue
        const buf = Buffer.from(await f.arrayBuffer())
        if (buf.length > 0) return { filename: f.name || 'facture.pdf', buffer: buf }
      }
    }
  }
  const arr: any[] = Array.isArray(body?.attachments) ? body.attachments
    : Array.isArray(body?.Attachments) ? body.Attachments
    : []
  for (const a of arr) {
    const name = a?.filename ?? a?.Name ?? a?.name ?? ''
    const type = a?.content_type ?? a?.ContentType ?? a?.contentType ?? ''
    if (!looksPdf(name, type)) continue
    const raw = a?.content ?? a?.Content ?? a?.data ?? null
    if (typeof raw !== 'string' || raw.length === 0) continue
    try {
      // Certains fournisseurs préfixent en data-URL : on ne garde que le base64
      const b64 = raw.includes(',') && raw.slice(0, 40).includes('base64') ? raw.slice(raw.indexOf(',') + 1) : raw
      const buf = Buffer.from(b64, 'base64')
      if (buf.length > 0) return { filename: String(name) || 'facture.pdf', buffer: buf }
    } catch { /* pièce illisible : on tente la suivante */ }
  }
  return null
}

/** Le mail complet, récupéré par l'API Resend — le webhook n'en porte que les
 *  métadonnées. `erreur` non nulle = échec TRANSITOIRE à faire réessayer (4xx). */
type MailResend = {
  erreur: string | null
  subject: string
  texte: string
  piece: Piece | null
  motifPiece: string | null
}

async function chargerMailResend(emailId: string): Promise<MailResend> {
  const vide: MailResend = { erreur: null, subject: '', texte: '', piece: null, motifPiece: null }
  const cle = process.env.RESEND_API_KEY
  if (!cle) return { ...vide, erreur: 'RESEND_API_KEY absente : contenu du mail irrécupérable' }
  const entetes = { Authorization: `Bearer ${cle}` }

  const rep = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, { headers: entetes })
  if (!rep.ok) return { ...vide, erreur: `API Resend ${rep.status} sur le mail ${emailId}` }
  const mail: any = await rep.json().catch(() => null)
  if (!mail) return { ...vide, erreur: 'réponse API Resend illisible' }

  // Corps : le texte brut d'abord ; l'HTML en repli, jamais une data-URL brute.
  const html = typeof mail.html === 'string' && !mail.html.startsWith('data:') ? mail.html : ''
  const texte = typeof mail.text === 'string' && mail.text.trim()
    ? mail.text
    : html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

  // Première pièce jointe PDF : métadonnées → URL présignée → contenu.
  // Chaque pièce écartée laisse son motif — le journal dira pourquoi une
  // facture est arrivée sans document, jamais « ça n'a pas marché ».
  let piece: Piece | null = null
  let motifPiece: string | null = null
  const pjs: any[] = Array.isArray(mail.attachments) ? mail.attachments : []
  for (const a of pjs) {
    const nom = String(a?.filename ?? '')
    if (!looksPdf(nom, String(a?.content_type ?? ''))) continue
    if (Number(a?.size) > TAILLE_PIECE_MAX) { motifPiece = `pièce ${nom} trop lourde (${Math.round(Number(a.size) / 1e6)} Mo)`; continue }
    const repMeta = await fetch(`https://api.resend.com/emails/receiving/${emailId}/attachments/${a.id}`, { headers: entetes })
    if (!repMeta.ok) { motifPiece = `API Resend ${repMeta.status} sur la pièce ${nom}`; continue }
    const meta: any = await repMeta.json().catch(() => null)
    if (typeof meta?.download_url !== 'string') { motifPiece = `pièce ${nom} sans URL de téléchargement`; continue }
    const repPj = await fetch(meta.download_url)
    if (!repPj.ok) { motifPiece = `téléchargement de ${nom} en échec (${repPj.status})`; continue }
    const buf = Buffer.from(await repPj.arrayBuffer())
    // L'en-tête fait foi : un .pdf renommé n'est pas un PDF.
    if (buf.length === 0 || buf.subarray(0, 5).toString('latin1') !== '%PDF-') { motifPiece = `pièce ${nom} sans en-tête PDF`; continue }
    piece = { filename: nom || 'facture.pdf', buffer: buf }
    motifPiece = null
    break
  }

  return { erreur: null, subject: String(mail.subject ?? ''), texte, piece, motifPiece }
}

/** Texte d'un PDF : par COORDONNÉES d'abord (colonnes séparées, même lecture
 *  que l'extraction des lignes), repli sur le texte plat de pdf-parse. */
async function readPdfText(buffer: Buffer): Promise<string> {
  const coordLines = await pdfToLines(buffer)
  if (coordLines.length > 0) return coordLines.join('\n')
  const _m = await import('pdf-parse') as any
  const pdfParse = typeof _m.default === 'function' ? _m.default : _m
  return (await pdfParse(buffer)).text
}

export async function POST(request: NextRequest) {
  const serviceSupabase = createServiceClient()
  const secret = process.env.RESEND_WEBHOOK_SECRET || ''
  const contentType = request.headers.get('content-type') || ''

  // ── PORTE D'ENTRÉE ────────────────────────────────────────────────────
  // Deux verrous possibles, du plus fort au plus simple :
  //   1. RESEND_WEBHOOK_SECRET posée → SEULES les requêtes signées Svix
  //      passent, les formats multipart historiques sont refusés du même coup ;
  //   2. sinon, clé d'URL en base (platform_settings) → l'appel doit porter
  //      `?cle=` identique — seul Resend connaît l'URL complète du webhook.
  // Sans AUCUN des deux (bac à sable), tout est accepté — et le journal le
  // crie à chaque réception.
  if (!secret) {
    const { data: reglage } = await serviceSupabase
      .from('platform_settings').select('value').eq('key', 'inbound_webhook_key').maybeSingle()
    const cleAttendue = reglage?.value ? String(reglage.value) : ''
    if (cleAttendue) {
      const cleRecue = Buffer.from(request.nextUrl.searchParams.get('cle') ?? '', 'utf8')
      const attendue = Buffer.from(cleAttendue, 'utf8')
      if (cleRecue.length !== attendue.length || !timingSafeEqual(cleRecue, attendue)) {
        console.warn('[inbound] REJET : clé d\'URL absente ou fausse')
        return NextResponse.json({ error: 'Clé requise' }, { status: 401 })
      }
    } else {
      console.warn('[inbound] aucun verrou configuré (ni RESEND_WEBHOOK_SECRET, ni clé d\'URL) — webhook accepté SANS vérification')
    }
  }

  let body: any = {}
  let form: FormData | null = null
  if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
    if (secret) {
      console.warn('[inbound] REJET : requête multipart non signée alors qu\'un secret est configuré')
      return NextResponse.json({ error: 'Signature requise' }, { status: 401 })
    }
    form = await request.formData()
    for (const [k, v] of form.entries()) body[k] = v
  } else {
    const brut = await request.text()
    if (secret) {
      const motif = verifierSignatureSvix(request.headers, brut, secret)
      if (motif) {
        console.warn('[inbound] REJET signature :', motif)
        return NextResponse.json({ error: 'Signature invalide' }, { status: 401 })
      }
    }
    try { body = JSON.parse(brut) } catch {
      return NextResponse.json({ error: 'Corps illisible' }, { status: 400 })
    }
  }

  // ── RESEND `email.received` : aller CHERCHER le mail complet ──────────
  // Le webhook ne livre que les métadonnées. L'échec de récupération est
  // TRANSITOIRE : on répond 422 pour que Resend représente le même événement
  // plus tard — l'archivage déterministe rend ce rejeu sans doublon.
  let resendEmailId: string | null = null
  let subject = ''
  let plainText = ''
  let piece: Piece | null = null
  let motifPiece: string | null = null
  let toField = ''

  if (body?.type === 'email.received' && body?.data && typeof body.data === 'object') {
    const d = body.data
    resendEmailId = typeof d.email_id === 'string' && d.email_id ? d.email_id : null
    if (!resendEmailId) return NextResponse.json({ error: 'événement sans email_id' }, { status: 400 })
    // L'adresse PILOTE peut être le destinataire direct (to), un destinataire
    // en copie, ou — cas du transfert automatique depuis la boîte du boucher —
    // n'apparaître QUE dans l'enveloppe (received_for).
    toField = [d.to, d.cc, d.received_for].flat().filter(Boolean).map(String).join(' ')
  } else {
    // Formats historiques : tout est déjà dans la requête.
    toField = String(body.to || body.recipient || body.To || body.Recipient || '')
    subject = String(body.subject || body.Subject || '')
    const textBody = body.text || body['body-plain'] || body.stripped_text || ''
    const htmlBody = body.html || body['body-html'] || body.stripped_html || ''
    plainText = String(textBody || String(htmlBody).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
  }

  // Identifier l'utilisateur depuis l'adresse de destination
  const match = toField.match(/factures-([a-z0-9]+)@/)
  if (!match) {
    // 200 SILENCIEUX : un mail qui n'est pas pour nous ne mérite ni rejeu ni
    // indice — mais le journal garde la trace.
    console.warn('[inbound] destinataire sans adresse factures-… :', toField.slice(0, 160))
    return NextResponse.json({ ok: false, motif: 'destinataire non reconnu' })
  }
  const forwardId = match[1]

  const { data: profile } = await serviceSupabase
    .from('profiles')
    .select('user_id, delivery_email')
    .eq('billing_forward_id', forwardId)
    .eq('billing_email_verified', true)
    .maybeSingle()

  if (!profile) {
    console.warn('[inbound] forward_id inconnu ou adresse non vérifiée :', forwardId)
    return NextResponse.json({ ok: false, motif: 'adresse inconnue' })
  }

  // resolveClientId (user_id puis email) — delivery_email est le même champ que
  // celui qui a servi à créer la fiche client à l'onboarding. Le lookup direct
  // client_user_id perdait les factures du second login d'une boutique.
  const clientId = await resolveClientId(serviceSupabase, String(profile.user_id), (profile as { delivery_email?: string | null }).delivery_email ?? null)

  if (!clientId) {
    console.warn('[inbound] fiche introuvable pour forward_id :', forwardId)
    return NextResponse.json({ ok: false, motif: 'fiche introuvable' })
  }

  // ── CODE DE CONFIRMATION GMAIL (lot 34) ───────────────────────────────
  // Le mail de « forwarding-noreply@google.com » n'est pas une facture :
  // c'est Gmail qui vérifie l'adresse de transfert. Le code vit dans l'OBJET
  // (déjà porté par le webhook — le relais tient même si l'API contenu
  // échoue) ; le lien « confirmer en un clic » vit dans le corps, on va le
  // chercher en plus, sans que son échec ne coûte jamais le code.
  if (resendEmailId && /forwarding-noreply@google\.com/i.test(String(body?.data?.from ?? ''))) {
    const objet = String(body?.data?.subject ?? '')
    let code = (objet.match(/(\d{6,12})/) || [])[1] ?? null
    let lien: string | null = null
    const mailConf = await chargerMailResend(resendEmailId)
    if (!mailConf.erreur) {
      if (!code) code = (mailConf.texte.match(/(\d{6,12})/) || [])[1] ?? null
      lien = (mailConf.texte.match(/https:\/\/mail-settings\.google\.com\/[^\s"'<>)\]]+/) || [])[0] ?? null
    }
    await serviceSupabase.from('profiles').update({
      billing_forward_confirmation: { code, lien, objet: objet.slice(0, 160), recu_le: new Date().toISOString() },
    }).eq('billing_forward_id', forwardId)
    console.log('[inbound] code de confirmation Gmail relayé pour', forwardId, '— code', code ? 'présent' : 'ABSENT')
    return NextResponse.json({ ok: true, type: 'confirmation_transfert_gmail', code_present: Boolean(code) })
  }

  // ── IDEMPOTENCE : le même mail ne crée jamais deux factures ───────────
  // Resend représente l'événement tant qu'il n'a pas vu de 2xx : si la facture
  // de CE mail existe déjà, on répond « déjà reçue » et rien d'autre ne bouge.
  if (resendEmailId) {
    const { data: deja } = await serviceSupabase
      .from('invoices')
      .select('id')
      .eq('client_id', clientId)
      .ilike('notes', `%[resend:${resendEmailId}]%`)
      .limit(1)
      .maybeSingle()
    if (deja) return NextResponse.json({ ok: true, deja_recue: true, invoice_id: deja.id })
  }

  // Récupération du contenu Resend — APRÈS le tri du destinataire : on ne
  // dépense pas d'appels API pour un mail qui ne nous concerne pas.
  if (resendEmailId) {
    const mail = await chargerMailResend(resendEmailId)
    if (mail.erreur) {
      console.error('[inbound] contenu irrécupérable :', mail.erreur)
      return NextResponse.json({ error: mail.erreur }, { status: 422 })
    }
    subject = mail.subject
    plainText = mail.texte
    piece = mail.piece
    motifPiece = mail.motifPiece
    if (motifPiece) console.warn('[inbound] pièce jointe écartée :', motifPiece)
  } else {
    piece = await pickPdf(body, form)
  }

  // ── LA PIÈCE JOINTE PDF EST LA SOURCE ──────────────────────────────────
  // Le PDF est archivé AVANT toute lecture : même s'il n'est pas exploitable
  // aujourd'hui, le document reste consultable et relisible plus tard. Un échec
  // d'archivage ne fait jamais échouer la réception — la facture existe quand
  // même, simplement sans PDF (et l'écran le dit). Le nom est DÉTERMINISTE pour
  // un mail Resend (rejeux sans doublon), aléatoire pour les formats en ligne.
  let filePath: string | null = null
  let pdfText = ''
  if (piece) {
    const path = `${clientId}/mail-${resendEmailId ?? randomUUID()}.pdf`
    const { error: upErr } = await serviceSupabase.storage
      .from('invoice-files')
      .upload(path, piece.buffer, { contentType: 'application/pdf', upsert: Boolean(resendEmailId) })
    if (!upErr) filePath = path
    else console.error('[inbound] archivage du PDF impossible:', upErr.message)
    try {
      pdfText = await readPdfText(piece.buffer)
    } catch (e) {
      console.error('[inbound] lecture du PDF impossible:', e instanceof Error ? e.message : String(e))
    }
  }

  // La source de vérité est le PDF quand il est lisible ; le corps du mail ne
  // sert que de repli (facture annoncée dans le texte, sans pièce jointe).
  const emailContent = pdfText.trim().length > 40
    ? `Facture (texte du PDF joint « ${piece?.filename ?? 'facture.pdf'} ») :\n\n${pdfText}`.slice(0, 12000)
    : `Objet: ${subject}\n\n${plainText}`.slice(0, 8000)

  // Claude Haiku extrait les données de la facture
  const extraction = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Tu es un assistant comptable pour une boucherie artisanale française. Extrais les informations de cette facture fournisseur. Réponds UNIQUEMENT avec du JSON valide, sans texte supplémentaire.

Email reçu :
${emailContent}

JSON attendu :
{
  "supplier_name": "Nom du fournisseur",
  "invoice_number": "Numéro ou null",
  "invoice_date": "YYYY-MM-DD",
  "delivery_date": "YYYY-MM-DD ou null",
  "due_date": "YYYY-MM-DD ou null",
  "amount_ht": 0.00,
  "tva_rate": 20,
  "amount_ttc": 0.00,
  "category": "viande|charcuterie|epicerie|emballage|frais_generaux|autre"
}

Règle des DATES — elles sont distinctes, ne jamais recopier l'une dans l'autre :
- invoice_date = date d'ÉMISSION de la facture (« facture du », « le »).
- delivery_date = date de LIVRAISON de la marchandise (« livré le », « bon de livraison », « expédition »), null si absente.
- due_date = date limite de PAIEMENT (« à régler avant le », « échéance », « payable au »), null si absente.

Règles catégories :
- viande : bœuf, porc, veau, agneau, volaille, abats
- charcuterie : saucisse, pâté, rillette, lardons, jambon
- epicerie : condiments, épices, conserves, fromage
- emballage : barquette, film, ficelle, papier boucher, sac
- frais_generaux : électricité, gaz, téléphone, loyer, assurance, carburant
- autre : tout le reste
Si montant HT absent, déduire de TTC : HT = TTC / 1.{tva_rate/100+1}`
    }]
  })

  let invoiceData: any = null
  try {
    const raw = extraction.content[0].type === 'text' ? extraction.content[0].text : '{}'
    invoiceData = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Impossible de parser la facture' }, { status: 422 })
  }

  if (!invoiceData.supplier_name || !invoiceData.amount_ht) {
    return NextResponse.json({ error: 'Données insuffisantes dans la facture' }, { status: 422 })
  }

  // UN RELEVÉ N'EST PAS UNE FACTURE — seconde ligne de défense.
  //
  // Le connecteur Pennylane écarte les relevés sur leur libellé (cf.
  // lib/document-releve). Ici, mieux : le TEXTE du PDF est déjà lu, et un
  // relevé s'annonce dans son en-tête. Un relevé importé compte l'argent deux
  // fois — achats, marge, résultat, rapport PDF — et ses lignes, qui sont des
  // totaux et des numéros de pièce, fabriquent des prix qui n'en sont pas.
  //
  // Le document n'entre pas, et le refus est TRACÉ : un import silencieux qui
  // avale une pièce est pire qu'un import qui la refuse en le disant.
  const verdictDoc = verdictReleve({ libelle: invoiceData.supplier_name, texte: pdfText })
  if (verdictDoc.releve) {
    const motif = phraseReleve(verdictDoc, invoiceData.supplier_name)
    console.warn(`[inbound] ${motif}`)
    return NextResponse.json({ ok: true, ignored: 'releve', motif }, { status: 200 })
  }

  const invoiceDate = new Date(invoiceData.invoice_date || new Date().toISOString().slice(0, 10))
  if (isNaN(invoiceDate.getTime())) invoiceDate.setTime(Date.now())
  // Semaine d'imputation : livraison si l'IA l'a lue, sinon date de facture ;
  // repli sur la date de facture parsée SEULEMENT si aucune date exploitable (la
  // facture reste « à vérifier », donc hors marge tant qu'elle n'est pas validée).
  // L'échéance de paiement est passée en 3e argument : une date de livraison qui
  // lui est égale (confusion classique de l'IA) est écartée par le garde-fou.
  const echeance = typeof invoiceData.due_date === 'string' && invoiceData.due_date ? invoiceData.due_date.slice(0, 10) : null
  // Même garde-fou que l'extraction des lignes : une date de livraison égale à
  // l'échéance, ou hors de la fenêtre autour de la facture, n'est PAS retenue.
  const livraisonRetenue = plausibleDelivery(
    typeof invoiceData.delivery_date === 'string' ? invoiceData.delivery_date.slice(0, 10) : null,
    invoiceData.invoice_date ?? null,
    echeance,
  )
  const { week, year } = weekForInvoice(
    invoiceData.delivery_date ?? null,
    invoiceData.invoice_date ?? null,
    echeance,
  ) ?? getISOWeek(invoiceDate)

  const amountHT  = parseFloat(invoiceData.amount_ht)  || 0
  const tvaRate   = parseFloat(invoiceData.tva_rate)   || 20
  const amountTTC = parseFloat(invoiceData.amount_ttc) || parseFloat((amountHT * (1 + tvaRate / 100)).toFixed(2))

  // ── MÉMOIRE FOURNISSEUR → CATÉGORIE ──
  // Si ce fournisseur a déjà été catégorisé par le boucher, sa dernière catégorie
  // l'emporte sur la supposition de l'IA : la charte des marges reste cohérente
  // sans re-tri manuel. Correspondance par FAMILLE de noms (lib partagée) :
  // « DAVID MASTER SAS » est classé avec « DAVID MASTER ».
  let category: string = invoiceData.category || 'autre'
  const supplierName = String(invoiceData.supplier_name).trim()
  const supplierMemory = await loadSupplierCategories(serviceSupabase, clientId)
  const remembered = rememberedCategory(supplierMemory, supplierName)
  const memoryApplied = Boolean(remembered && remembered !== category)
  if (remembered) category = remembered

  const { data: invoice, error } = await serviceSupabase
    .from('invoices')
    .insert({
      client_id:      clientId,
      week_number:    week,
      year,
      // Toujours importée « à vérifier » : ne compte dans la marge qu'après
      // validation humaine. Explicite, sans dépendre du défaut de colonne.
      status:         'a_verifier',
      supplier_name:  supplierName,
      invoice_number: invoiceData.invoice_number || null,
      invoice_date:   invoiceDate.toISOString().slice(0, 10),
      category,
      amount_ht:      amountHT,
      tva_rate:       tvaRate,
      amount_ttc:     amountTTC,
      // Dates lues sur le document — la livraison passe le garde-fou (une date
      // égale à l'échéance, ou hors fenêtre, est écartée plutôt que propagée).
      delivery_date:  livraisonRetenue,
      due_date:       echeance,
      // Le PDF archivé rend la facture RELISIBLE : elle rejoint la file
      // « factures en attente de lecture » de la mercuriale (lines_status null)
      // et suit ensuite exactement le chemin d'une facture Pennylane.
      file_path:      filePath,
      lines_status:   null,
      notes:          `Reçue par email${piece ? ` · pièce jointe ${piece.filename}` : ` · sans pièce jointe${motifPiece ? ` (${motifPiece})` : ' (lu dans le corps du message)'}`}${memoryApplied ? ' · catégorie reprise de vos factures précédentes' : ''} — objet: ${subject.slice(0, 100)}${resendEmailId ? ` [resend:${resendEmailId}]` : ''}`,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({
    ok: true, invoice, memoryApplied,
    pdf_archive: Boolean(filePath),
    lu_sur: pdfText.trim().length > 40 ? 'pdf' : 'corps_du_mail',
  })
}
