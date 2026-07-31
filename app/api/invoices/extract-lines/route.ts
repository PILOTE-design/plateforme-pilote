// Extraction ligne à ligne d'une facture fournisseur — le cœur de la mercuriale.
//
// Pennylane ne fournit que des lignes COMPTABLES (libellé + montants, sans quantité
// ni prix unitaire) : les lignes PRODUITS — « ÉCHINE DE PORC · 4521 · 12,4 kg ×
// 5,80 € » — n'existent que sur le PDF. On le lit donc nous-mêmes, avec le même
// pipeline éprouvé que le rapport hebdomadaire : pdf-parse + Haiku + garde-fous
// déterministes (la somme des lignes doit boucler sur le total de la facture).
//
// Chaque ligne insérée est un POINT DE PRIX daté : l'historique de la mercuriale
// EST la table invoice_lines, il n'y a pas de copie à maintenir. L'article
// canonique est rattaché par code fournisseur d'abord (stable), libellé normalisé
// ensuite, créé sinon.
if (typeof globalThis.DOMMatrix === 'undefined') {
  ;(globalThis as Record<string, unknown>).DOMMatrix = class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { normalizeSupplierName, supplierSociete, societeKey } from '@/lib/supplier-memory'
import { normText } from '@/lib/postes'
import { pdfToLines } from '@/lib/pdf-lines'
import { plausibleDelivery } from '@/lib/invoice-week'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'MISSING_ANTHROPIC_KEY' })

type ExtractedLine = {
  designation: string
  article_code: string | null
  quantity: number | null
  unit: string | null
  unit_price_ht: number | null
  amount_ht: number
  tva_rate: number | null
}

function parseNum(s: string): number | null {
  const n = parseFloat(String(s ?? '').trim().replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function parseDate(s: string): string | null {
  const m = String(s ?? '').match(/(\d{4})-(\d{2})-(\d{2})|(\d{2})\/(\d{2})\/(\d{4})/)
  if (!m) return null
  return m[1] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[6]}-${m[5]}-${m[4]}`
}

/** Le PDF → lignes produits + dates, format pipe (une ligne par article, robuste
 *  aux JSON mal fermés). L'IA n'effectue AUCUN calcul : les montants sont relus
 *  tels quels et vérifiés en code contre le total connu de la facture. */
async function extractLines(pdfText: string, totalHT: number): Promise<{
  lines: ExtractedLine[]; delivery_date: string | null; due_date: string | null; nature: 'matiere' | 'hors_matiere'
}> {
  const r = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 3000,
    messages: [{ role: 'user', content: `Voici le texte d'une facture fournisseur de boucherie. Total HT connu : ${totalHT.toFixed(2)} EUR.
COMMENCE par qualifier la facture :
NATURE|matiere      si elle facture des ingrédients alimentaires ou des consommables de production (viande, charcuterie, épicerie, boissons, emballages, barquettes…)
NATURE|hors_matiere si elle facture autre chose : matériel, équipement, entretien, services, logiciels, abonnements, avantages salariés, énergie, transport seul, honoraires.
Si NATURE est hors_matiere, n'écris AUCUNE ligne L| — la facture ne nourrit pas la mercuriale.

Sinon, extrais CHAQUE ligne d'article facturé. Retourne UNIQUEMENT des lignes aux formats suivants, sans autre texte :

NATURE|matiere
LIVRAISON|2026-07-21
ECHEANCE|2026-08-20
L|DESIGNATION|CODE|QUANTITE|UNITE|PRIX_UNITAIRE_HT|MONTANT_HT|TAUX_TVA

Exemples :
L|ECHINE DE PORC SANS OS|4521|12.4|kg|5.80|71.92|5.5
L|BARQUETTE 500G x100|EMB-102|2|colis|18.50|37.00|20
L|REMISE COMMERCIALE||||-12.00|-12.00|5.5

Règles STRICTES :
- MONTANT_HT = montant HT de la ligne tel qu'écrit sur la facture (jamais recalculé, jamais TTC).
- CODE = référence article du fournisseur si présente, sinon vide.
- QUANTITE et PRIX_UNITAIRE_HT vides s'ils ne figurent pas sur la facture — ne JAMAIS les inventer.
- UNITE = kg, pièce, colis, L… telle qu'écrite.
- Point décimal. Une ligne L| par article, remises et consignes comprises (montants négatifs autorisés).
- Ignorer les sous-totaux, totaux, TVA récapitulative, frais de port SI déjà comptés ailleurs.
- LIVRAISON = date de LIVRAISON de la marchandise (mentions « livré le », « date de livraison », « expédition », « bon de livraison / BL »). ECHEANCE = date limite de PAIEMENT (« à régler avant le », « échéance », « date d'échéance », « payable au »). Ces deux dates sont DIFFÉRENTES : ne jamais recopier l'échéance en LIVRAISON. Si une seule figure sur la facture, ne renseigner QUE celle-là. Format AAAA-MM-JJ, ligne absente si introuvable.

Texte de la facture :
${pdfText.slice(0, 15000)}` }],
  })
  const raw = r.content[0]?.type === 'text' ? r.content[0].text : ''
  const lines: ExtractedLine[] = []
  let delivery_date: string | null = null
  let due_date: string | null = null
  let nature: 'matiere' | 'hors_matiere' = 'matiere'
  for (const l of raw.split('\n')) {
    const t = l.trim()
    if (t.startsWith('NATURE|')) { if (t.slice(7).trim() === 'hors_matiere') nature = 'hors_matiere'; continue }
    if (t.startsWith('LIVRAISON|')) { delivery_date = parseDate(t.slice(10)); continue }
    if (t.startsWith('ECHEANCE|')) { due_date = parseDate(t.slice(9)); continue }
    if (!t.startsWith('L|')) continue
    const p = t.slice(2).split('|')
    if (p.length < 6) continue
    const designation = p[0]?.trim()
    const amount = parseNum(p[5] ?? '')
    if (!designation || amount === null || amount === 0) continue
    lines.push({
      designation: designation.slice(0, 120),
      article_code: p[1]?.trim() ? p[1].trim().slice(0, 40) : null,
      quantity: parseNum(p[2] ?? ''),
      unit: p[3]?.trim() ? p[3].trim().toLowerCase().slice(0, 12) : null,
      unit_price_ht: parseNum(p[4] ?? ''),
      amount_ht: amount,
      tva_rate: parseNum(p[6] ?? ''),
    })
  }
  return { lines: lines.slice(0, 120), delivery_date, due_date, nature }
}

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const { invoice_id } = await request.json().catch(() => ({} as Record<string, unknown>))
  if (!invoice_id) return NextResponse.json({ error: 'invoice_id requis' }, { status: 400 })

  const { data: invoice } = await service.from('invoices')
    .select('id, supplier_name, invoice_date, amount_ht, tva_rate, file_path, delivery_date, due_date, is_fixed_charge')
    .eq('id', invoice_id).eq('client_id', clientId).maybeSingle()
  if (!invoice) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 })

  // ── Reconnaissance en trois étages : seules les factures de MATIÈRE (ingrédients,
  // consommables de production) nourrissent la mercuriale. ──
  // Étage 1 — déterministe : une charge fixe (loyer, logiciel, leasing, assurance…)
  // n'est jamais de la matière. Zéro appel IA.
  if (invoice.is_fixed_charge) {
    await service.from('invoices').update({ lines_status: 'hors_matiere' }).eq('id', invoice.id)
    return NextResponse.json({ success: true, status: 'hors_matiere', reason: 'charge fixe' })
  }

  // Étage 2 — mémoire fournisseur : si ce fournisseur a déjà été reconnu hors
  // matière et n'a JAMAIS produit de lignes, inutile de relire chaque nouvelle
  // facture (Wiismile revient tous les mois). Un seul appel IA par fournisseur.
  const supKey = societeKey(invoice.supplier_name || '')
  if (supKey) {
    const { data: histo } = await service.from('invoices')
      .select('supplier_name, lines_status')
      .eq('client_id', clientId)
      .in('lines_status', ['done', 'partial', 'hors_matiere'])
    let dejaHors = false, dejaMatiere = false
    for (const h of histo || []) {
      if (societeKey(h.supplier_name || '') !== supKey) continue
      if (h.lines_status === 'hors_matiere') dejaHors = true
      else dejaMatiere = true
    }
    if (dejaHors && !dejaMatiere) {
      await service.from('invoices').update({ lines_status: 'hors_matiere' }).eq('id', invoice.id)
      return NextResponse.json({ success: true, status: 'hors_matiere', reason: 'fournisseur déjà reconnu hors matière' })
    }
  }

  if (!invoice.file_path) {
    await service.from('invoices').update({ lines_status: 'no_file' }).eq('id', invoice.id)
    return NextResponse.json({ error: 'Aucun PDF pour cette facture — relancez une synchronisation Pennylane.' }, { status: 422 })
  }

  try {
    // 1. PDF depuis le bucket privé
    const { data: file, error: dlErr } = await service.storage.from('invoice-files').download(invoice.file_path)
    if (dlErr || !file) throw new Error(`Téléchargement du PDF impossible : ${dlErr?.message ?? 'fichier vide'}`)
    const buffer = Buffer.from(await file.arrayBuffer())
    // Lecture PAR COORDONNÉES (colonnes séparées) ; repli sur le texte plat de
    // pdf-parse seulement si le PDF résiste. C'est ce texte propre qui est donné
    // à l'IA, au lieu du texte plat qui colle « 12.4kg5.8071.92 ».
    const coordLines = await pdfToLines(buffer)
    let pdfText: string
    if (coordLines.length > 0) {
      pdfText = coordLines.join('\n')
    } else {
      const _m = await import('pdf-parse') as any
      const pdfParse = typeof _m.default === 'function' ? _m.default : _m
      pdfText = (await pdfParse(buffer)).text
    }

    // 2. Extraction des lignes
    const totalHT = parseFloat(String(invoice.amount_ht || 0)) || 0
    const { lines, delivery_date, due_date, nature } = await extractLines(pdfText, totalHT)

    // Étage 3 — la nature lue sur le PDF lui-même. C'est lui qui rattrape les
    // catégories fausses du connecteur (des factures de viande arrivent en
    // « frais_divers ») : le document tranche, pas l'étiquette.
    if (nature === 'hors_matiere') {
      await service.from('invoice_lines').delete().eq('invoice_id', invoice.id).eq('client_id', clientId)
      const patch: Record<string, unknown> = { lines_status: 'hors_matiere' }
      if (due_date && !invoice.due_date) patch.due_date = due_date
      await service.from('invoices').update(patch).eq('id', invoice.id)
      return NextResponse.json({ success: true, status: 'hors_matiere', reason: 'facture sans matière première (matériel, service, abonnement…)' })
    }

    if (lines.length === 0) {
      await service.from('invoices').update({ lines_status: 'error' }).eq('id', invoice.id)
      return NextResponse.json({ error: 'Aucune ligne reconnue sur ce PDF.' }, { status: 422 })
    }

    // 3. Garde-fous déterministes de la lecture, à DEUX niveaux :
    //   · FACTURE : la somme des lignes doit boucler sur le total (à 3 %). Un total
    //     inconnu (0) n'est PLUS un laissez-passer — sans total, rien n'est
    //     vérifiable, donc on ne promeut aucun prix.
    //   · LIGNE : quand quantité ET prix unitaire figurent tous deux, leur produit
    //     doit égaler le montant (sinon l'un des deux est mal lu). C'est ce prix
    //     unitaire qui devient le point de mercuriale — on ne le publie que vérifié.
    const somme = lines.reduce((s, l) => s + l.amount_ht, 0)
    const coherent = totalHT > 0 && Math.abs(somme - totalHT) / totalHT <= 0.03
    const ligneVerifiee = (l: ExtractedLine): boolean => {
      if (l.unit_price_ht != null && l.quantity != null && l.quantity !== 0) {
        return Math.abs(l.quantity * l.unit_price_ht - l.amount_ht) <= Math.max(0.05, Math.abs(l.amount_ht) * 0.01)
      }
      return true // pas de contradiction vérifiable (prix seul, ou dérivé de la quantité)
    }

    // 4. Rattachement aux articles — par code fournisseur, sinon libellé normalisé.
    const supplierKey = normalizeSupplierName(supplierSociete(invoice.supplier_name || '')) || ''
    const { data: existing } = await service.from('articles')
      .select('id, article_code, name_key, last_price_date, price_count')
      .eq('client_id', clientId).eq('supplier_key', supplierKey)
    const byCode = new Map<string, any>()
    const byName = new Map<string, any>()
    for (const a of existing || []) {
      if (a.article_code) byCode.set(String(a.article_code), a)
      else byName.set(String(a.name_key), a)
    }

    const rows: any[] = []
    let prixPromus = 0, prixQuarantaine = 0
    for (const l of lines) {
      const nameKey = normText(l.designation)
      let art = (l.article_code && byCode.get(l.article_code)) || byName.get(nameKey) || null
      const unitPrice = l.unit_price_ht ?? (l.quantity && l.quantity > 0 ? +(l.amount_ht / l.quantity).toFixed(4) : null)
      // QUARANTAINE : un prix ne devient un point de mercuriale que si la facture
      // boucle ET la ligne est vérifiée. Sinon l'article est rattaché SANS prix,
      // et la ligne stockée SANS prix — « prix manquant » signalé plutôt qu'un
      // prix douteux publié en silence (mercuriale ET coût des recettes protégés).
      const promouvoir = coherent && ligneVerifiee(l) && unitPrice !== null
      if (unitPrice !== null) { if (promouvoir) prixPromus++; else prixQuarantaine++ }
      const prixRetenu = promouvoir ? unitPrice : null

      if (!art && nameKey) {
        const { data: created } = await service.from('articles').insert({
          client_id: clientId, name: l.designation, name_key: nameKey, unit: l.unit,
          supplier_key: supplierKey, supplier_name: invoice.supplier_name,
          article_code: l.article_code,
          last_price_ht: prixRetenu,
          last_price_date: promouvoir ? invoice.invoice_date : null,
          price_count: promouvoir ? 1 : 0,
        }).select('id, article_code, name_key, last_price_date, price_count').single()
        if (created) {
          art = created
          if (created.article_code) byCode.set(String(created.article_code), created)
          else byName.set(String(created.name_key), created)
        }
      } else if (art && promouvoir) {
        // Dernier prix : seule une facture plus récente (ou du même jour) le remplace.
        const patch: Record<string, unknown> = { price_count: (art.price_count || 0) + 1, updated_at: new Date().toISOString() }
        if (!art.last_price_date || invoice.invoice_date >= art.last_price_date) {
          patch.last_price_ht = unitPrice
          patch.last_price_date = invoice.invoice_date
        }
        await service.from('articles').update(patch).eq('id', art.id)
        art.price_count = (art.price_count || 0) + 1
      }
      // Une ligne non promue laisse l'article INCHANGÉ (son prix précédent reste).

      rows.push({
        client_id: clientId, invoice_id: invoice.id, article_id: art?.id ?? null,
        designation: l.designation, article_code: l.article_code, quantity: l.quantity,
        unit: l.unit,
        // Prix en quarantaine = null : la mercuriale prend le point de prix le plus
        // récent depuis invoice_lines ; un prix non vérifié n'en est pas un.
        unit_price_ht: prixRetenu,
        amount_ht: l.amount_ht, tva_rate: l.tva_rate ?? invoice.tva_rate,
      })
    }

    // 5. Remplacement atomique des lignes de CETTE facture (ré-extraction incluse)
    const { error: delErr } = await service.from('invoice_lines').delete().eq('invoice_id', invoice.id).eq('client_id', clientId)
    if (delErr) throw new Error(`Purge des anciennes lignes : ${delErr.message}`)
    const { error: insErr } = await service.from('invoice_lines').insert(rows)
    if (insErr) throw new Error(`Insertion des lignes : ${insErr.message}`)

    // 6. Statut + dates lues sur le PDF (jamais d'écrasement d'une valeur déjà posée).
    // 'done' seulement si la facture boucle ET aucun prix en quarantaine ; sinon
    // 'partial' : les lignes sont gardées, mais des prix restent à valider.
    const complet = coherent && prixQuarantaine === 0
    const patch: Record<string, unknown> = { lines_status: complet ? 'done' : 'partial' }
    // GARDE-FOU DATES (31/07) : une date de livraison lue par l'IA n'est écrite
    // que si elle est PLAUSIBLE — jamais l'échéance de paiement recopiée, jamais
    // une date hors de la fenêtre autour de la facture. Mesuré en prod : 10
    // livraisons fausses sur 61, dont 8 égales à l'échéance. Une date écartée
    // laisse la colonne vide : l'imputation retombe sur la date de facture
    // (déterministe) au lieu de partir dans une autre semaine.
    const echeance = due_date ?? (invoice.due_date as string | null) ?? null
    const livraisonRetenue = plausibleDelivery(delivery_date, invoice.invoice_date as string | null, echeance)
    if (livraisonRetenue && !invoice.delivery_date) patch.delivery_date = livraisonRetenue
    if (due_date && !invoice.due_date) patch.due_date = due_date
    await service.from('invoices').update(patch).eq('id', invoice.id)

    return NextResponse.json({
      success: true, status: complet ? 'done' : 'partial',
      lines: rows.length, prix_promus: prixPromus, prix_en_quarantaine: prixQuarantaine,
      somme: +somme.toFixed(2), total_facture: totalHT,
    })
  } catch (err) {
    await service.from('invoices').update({ lines_status: 'error' }).eq('id', invoice.id)
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
