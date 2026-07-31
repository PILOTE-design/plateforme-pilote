/**
 * Webhook de réception d'emails entrants (factures transférées par l'utilisateur).
 * Compatible Resend Inbound, Mailgun, Postmark, SendGrid Inbound Parse.
 * L'adresse cible est : factures-{billing_forward_id}@mail.getpilote.app
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
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { loadSupplierCategories, rememberedCategory } from '@/lib/supplier-memory'
import { weekForInvoice, plausibleDelivery } from '@/lib/invoice-week'
import { pdfToLines } from '@/lib/pdf-lines'
import { randomUUID } from 'crypto'
import Anthropic from '@anthropic-ai/sdk'

// Clé de repli au build : le constructeur Anthropic lève une erreur si la clé est absente,
// ce qui casse `next build` (« Collecting page data »). En prod, l'extraction échoue
// proprement à l'exécution tant que ANTHROPIC_API_KEY n'est pas définie.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'MISSING_ANTHROPIC_KEY' })

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

/** Première pièce jointe PDF du message, quel que soit le fournisseur d'email.
 *  Trois formats coexistent dans la nature :
 *   · form-data avec un vrai fichier (SendGrid Inbound Parse, Mailgun) ;
 *   · JSON avec un tableau `attachments` en base64 (Resend, Mailgun API) ;
 *   · JSON Postmark, qui capitalise (`Attachments`, `Name`, `Content`).
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

  // Accepter JSON ou form-data selon le provider. Le FormData est CONSERVÉ :
  // c'est là que vivent les pièces jointes des fournisseurs qui postent en
  // multipart (les aplatir dans `body` perdait le contenu des fichiers).
  let body: any = {}
  let form: FormData | null = null
  const contentType = request.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    body = await request.json()
  } else if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
    form = await request.formData()
    for (const [k, v] of form.entries()) body[k] = v
  }

  // Identifier l'utilisateur depuis l'adresse de destination
  const toField: string = body.to || body.recipient || body.To || body.Recipient || ''
  const match = toField.match(/factures-([a-z0-9]+)@/)
  if (!match) return NextResponse.json({ error: 'Recipient non reconnu' }, { status: 400 })
  const forwardId = match[1]

  const { data: profile } = await serviceSupabase
    .from('profiles')
    .select('user_id, delivery_email')
    .eq('billing_forward_id', forwardId)
    .eq('billing_email_verified', true)
    .maybeSingle()

  if (!profile) return NextResponse.json({ error: 'Profil non trouvé ou email non vérifié' }, { status: 404 })

  // resolveClientId (user_id puis email) — delivery_email est le même champ que
  // celui qui a servi à créer la fiche client à l'onboarding. Le lookup direct
  // client_user_id perdait les factures du second login d'une boutique.
  const clientId = await resolveClientId(serviceSupabase, String(profile.user_id), (profile as { delivery_email?: string | null }).delivery_email ?? null)

  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  // Extraire le contenu de l'email
  const subject   = body.subject   || body.Subject   || ''
  const textBody  = body.text      || body['body-plain']  || body.stripped_text || ''
  const htmlBody  = body.html      || body['body-html']   || body.stripped_html || ''
  const plainText = textBody || htmlBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

  // ── LA PIÈCE JOINTE PDF EST LA SOURCE ──────────────────────────────────
  // Le PDF est archivé AVANT toute lecture : même s'il n'est pas exploitable
  // aujourd'hui, le document reste consultable et relisible plus tard. Un échec
  // d'archivage ne fait jamais échouer la réception — la facture existe quand
  // même, simplement sans PDF (et l'écran le dit).
  const piece = await pickPdf(body, form)
  let filePath: string | null = null
  let pdfText = ''
  if (piece) {
    const path = `${clientId}/mail-${randomUUID()}.pdf`
    const { error: upErr } = await serviceSupabase.storage
      .from('invoice-files')
      .upload(path, piece.buffer, { contentType: 'application/pdf', upsert: false })
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
      notes:          `Reçue par email${piece ? ` · pièce jointe ${piece.filename}` : ' · sans pièce jointe (lu dans le corps du message)'}${memoryApplied ? ' · catégorie reprise de vos factures précédentes' : ''} — objet: ${subject.slice(0, 100)}`,
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
