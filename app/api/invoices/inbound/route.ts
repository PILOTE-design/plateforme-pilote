/**
 * Webhook de réception d'emails entrants (factures transférées par l'utilisateur).
 * Compatible Resend Inbound, Mailgun, Postmark, SendGrid Inbound Parse.
 * L'adresse cible est : factures-{billing_forward_id}@mail.getpilote.app
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { loadSupplierCategories, rememberedCategory } from '@/lib/supplier-memory'
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

export async function POST(request: NextRequest) {
  const serviceSupabase = createServiceClient()

  // Accepter JSON ou form-data selon le provider
  let body: any = {}
  const contentType = request.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    body = await request.json()
  } else if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
    const form = await request.formData()
    for (const [k, v] of form.entries()) body[k] = v
  }

  // Identifier l'utilisateur depuis l'adresse de destination
  const toField: string = body.to || body.recipient || body.To || body.Recipient || ''
  const match = toField.match(/factures-([a-z0-9]+)@/)
  if (!match) return NextResponse.json({ error: 'Recipient non reconnu' }, { status: 400 })
  const forwardId = match[1]

  const { data: profile } = await serviceSupabase
    .from('profiles')
    .select('user_id')
    .eq('billing_forward_id', forwardId)
    .eq('billing_email_verified', true)
    .maybeSingle()

  if (!profile) return NextResponse.json({ error: 'Profil non trouvé ou email non vérifié' }, { status: 404 })

  const { data: clientRow } = await serviceSupabase
    .from('clients')
    .select('id')
    .eq('client_user_id', profile.user_id)
    .maybeSingle()

  if (!clientRow) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  // Extraire le contenu de l'email
  const subject   = body.subject   || body.Subject   || ''
  const textBody  = body.text      || body['body-plain']  || body.stripped_text || ''
  const htmlBody  = body.html      || body['body-html']   || body.stripped_html || ''
  const plainText = textBody || htmlBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

  const emailContent = `Objet: ${subject}\n\n${plainText}`.slice(0, 8000)

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
  "amount_ht": 0.00,
  "tva_rate": 20,
  "amount_ttc": 0.00,
  "category": "viande|charcuterie|epicerie|emballage|frais_generaux|autre"
}

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
  const { week, year } = getISOWeek(invoiceDate)

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
  const supplierMemory = await loadSupplierCategories(serviceSupabase, clientRow.id)
  const remembered = rememberedCategory(supplierMemory, supplierName)
  const memoryApplied = Boolean(remembered && remembered !== category)
  if (remembered) category = remembered

  const { data: invoice, error } = await serviceSupabase
    .from('invoices')
    .insert({
      client_id:      clientRow.id,
      week_number:    week,
      year,
      supplier_name:  supplierName,
      invoice_number: invoiceData.invoice_number || null,
      invoice_date:   invoiceDate.toISOString().slice(0, 10),
      category,
      amount_ht:      amountHT,
      tva_rate:       tvaRate,
      amount_ttc:     amountTTC,
      notes:          `Importé automatiquement${memoryApplied ? ' · catégorie reprise de vos factures précédentes' : ''} — objet: ${subject.slice(0, 100)}`,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, invoice, memoryApplied })
}
