// app/api/admin/invoice-layouts/corriger/route.ts — APPRENDRE UNE FACTURE QUI
// RÉSISTE, en corrigeant sa lecture à la main. Lot 112.
//
// ─── LE CERCLE QU'ON CASSE ────────────────────────────────────────────────
//
// La bibliothèque n'apprend que des factures bien lues. Une mise en page que la
// chaîne ne sait PAS lire ne lui apprend donc jamais rien — et c'est exactement
// celle dont on aurait besoin. L'écran d'import cassait déjà à moitié ce cercle
// (l'administrateur fournit le total), mais s'arrêtait au premier échec : le
// document résistait, le travail de lecture était jeté, et il n'y avait plus
// qu'à réessayer le même document en espérant un autre résultat.
//
// Ici l'administrateur reprend la main : il corrige les lignes lues — une ligne
// oubliée, un montant mal découpé, une ligne en double — et l'exemple entre. La
// mise en page qui résistait le plus est précisément celle qui apprend le plus.
//
// ─── CE QUI NE CHANGE PAS, ET NE DOIT JAMAIS CHANGER ──────────────────────
//
//  1. LE TOTAL RESTE L'UNIQUE ARBITRE. Une correction n'est acceptée que si la
//     somme des lignes retombe sur le total au centime. On ne fait pas confiance
//     à l'administrateur davantage qu'à la machine : on lui donne le droit de
//     PROPOSER, pas celui de contourner l'arithmétique. Un exemple faux
//     enseignerait activement l'erreur, à toutes les boucheries.
//
//  2. LE TEXTE VIENT TOUJOURS DU PDF, jamais du navigateur. C'est lui que le
//     modèle relira comme exemple : accepter un texte envoyé par le client
//     ouvrirait la porte à un exemple dont la « facture » n'a jamais existé.
//     Le PDF est donc renvoyé avec la correction, et relu ici par la même
//     lecture par coordonnées que la production.
//
//  3. RIEN D'AUTRE N'EST ÉCRIT : pas de facture, pas de réf, pas de point de
//     prix. La mercuriale ne voit jamais ces documents.
//
// Aucun appel au modèle : cette route ne lit pas, elle range ce qu'on lui donne
// après l'avoir vérifié. C'est aussi pour ça qu'elle est rapide et gratuite.

if (typeof globalThis.DOMMatrix === 'undefined') {
  ;(globalThis as Record<string, unknown>).DOMMatrix = class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { isAdminEmail } from '@/lib/admins'
import { pdfToLines } from '@/lib/pdf-lines'
import { normalizeSupplierName, supplierSociete } from '@/lib/supplier-memory'
import { normText } from '@/lib/postes'
import { PROMPT_LIGNES_VERSION, TEXTE_MAX, type ExtractedLine } from '@/lib/invoice-extract'
import { rangerExemple, signatureEntete } from '@/lib/invoice-layouts'

export const dynamic = 'force-dynamic'
// Pas d'appel au modèle : seule la relecture du texte du PDF coûte du temps.
export const maxDuration = 60

/** Tolérance de bouclage — la même qu'à l'import et que dans `rangerExemple`.
 *  Écrite ici pour qu'on la voie, jamais assouplie. */
const TOL_EUR = 0.02

/** Plafond de lignes acceptées dans une correction. Une facture d'exemple qui
 *  en porterait mille n'apprend pas mieux qu'une de vingt, et l'extrait rangé
 *  est de toute façon tronqué. */
const LIGNES_MAX = 400

function nombreOuNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function texteOuNull(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return s === '' ? null : s.slice(0, 200)
}

/** Une ligne reçue du navigateur, ramenée à la forme du moteur. Toute ligne
 *  dont le montant n'est pas un nombre est REFUSÉE, jamais devinée à zéro : une
 *  ligne à zéro fausserait la somme sans se voir. */
function versLigne(brute: unknown): ExtractedLine | null {
  if (!brute || typeof brute !== 'object') return null
  const o = brute as Record<string, unknown>
  const montant = nombreOuNull(o.amount_ht)
  if (montant === null) return null
  const designation = String(o.designation ?? '').trim().slice(0, 300)
  if (designation === '') return null
  return {
    designation,
    article_code: texteOuNull(o.article_code),
    quantity: nombreOuNull(o.quantity),
    unit: texteOuNull(o.unit),
    unit_price_ht: nombreOuNull(o.unit_price_ht),
    amount_ht: Math.round(montant * 100) / 100,
    tva_rate: nombreOuNull(o.tva_rate),
    weight_kg: nombreOuNull(o.weight_kg),
  }
}

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  if (!isAdminEmail(user.email)) return NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 })

  const service = createServiceClient()
  const clientId = (await resolveClientId(service, user.id, user.email)) ?? null

  const form = await request.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Corps multipart attendu (fichier + total + lignes)' }, { status: 400 })

  const fichier = form.get('file')
  if (!(fichier instanceof File)) {
    return NextResponse.json({ error: 'Le PDF d’origine est requis : l’exemple rangé doit porter le texte du document, jamais un texte reçu du navigateur.' }, { status: 400 })
  }

  const total = nombreOuNull(form.get('total'))
  if (total === null || total === 0) {
    return NextResponse.json({ error: 'Total HT manquant — sans arbitre, une correction ne vaut rien.' }, { status: 400 })
  }

  let brutes: unknown
  try {
    brutes = JSON.parse(String(form.get('lignes') ?? '[]'))
  } catch {
    return NextResponse.json({ error: 'Lignes corrigées illisibles' }, { status: 400 })
  }
  if (!Array.isArray(brutes)) {
    return NextResponse.json({ error: 'Lignes corrigées illisibles' }, { status: 400 })
  }
  if (brutes.length > LIGNES_MAX) {
    return NextResponse.json({ error: `Trop de lignes (${brutes.length}) : ${LIGNES_MAX} au maximum.` }, { status: 400 })
  }

  const lignes: ExtractedLine[] = []
  let refusees = 0
  for (const b of brutes) {
    const l = versLigne(b)
    if (l) lignes.push(l)
    else refusees++
  }

  if (lignes.length < 2) {
    return NextResponse.json({
      appris: false,
      motif: `Une mise en page s’apprend d’au moins deux lignes${refusees > 0 ? ` (${refusees} ligne(s) sans désignation ou sans montant lisible ont été écartées)` : ''}.`,
    })
  }

  // ── L'ARBITRE ────────────────────────────────────────────────────────────
  const somme = Math.round(lignes.reduce((s, l) => s + l.amount_ht, 0) * 100) / 100
  const ecart = Math.round((somme - total) * 100) / 100
  if (Math.abs(ecart) > TOL_EUR) {
    return NextResponse.json({
      appris: false, somme, total, ecart,
      motif: `La correction ne boucle toujours pas : ${somme.toFixed(2)} € pour ${total.toFixed(2)} € attendus (${ecart > 0 ? '+' : ''}${ecart.toFixed(2)} €). Rien n’entre — le total reste l’arbitre, même sur une correction faite à la main.`,
    })
  }

  // ── LE TEXTE, RELU DU DOCUMENT ───────────────────────────────────────────
  const buffer = Buffer.from(await fichier.arrayBuffer())
  let texte = ''
  try {
    texte = (await pdfToLines(buffer)).join('\n')
  } catch { /* repli ci-dessous */ }
  if (texte.trim().length < 40) {
    try {
      const _m = await import('pdf-parse') as any // eslint-disable-line @typescript-eslint/no-explicit-any
      const pdfParse = typeof _m.default === 'function' ? _m.default : _m
      texte = (await pdfParse(buffer)).text
    } catch { /* compté comme sans texte */ }
  }

  const lettres = (texte.match(/[A-Za-zÀ-ÿ]/g) || []).length
  if (lettres < 200) {
    return NextResponse.json({
      appris: false,
      motif: `Ce PDF ne porte pas de texte exploitable (${lettres} lettres) : c’est un scan. Une lecture corrigée ne sert à rien sans le texte qu’elle doit apprendre à découper.`,
    })
  }

  const nomFourni = String(form.get('fournisseur') ?? '').trim()
  const nomBase = nomFourni || fichier.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim()
  const supplierKey = normalizeSupplierName(supplierSociete(nomBase))
    || normText(nomBase).replace(/\s+/g, '').slice(0, 60)
    || 'import'

  const signature = signatureEntete(texte)

  // Même précaution qu'à l'import : un exemple partagé sans fiche échappe à
  // l'unicité de l'upsert (les NULL sont tous distincts pour Postgres), on
  // retire donc l'éventuel doublon exact pour remplacer au lieu d'empiler.
  if (clientId === null) {
    await service.from('invoice_layouts').delete()
      .is('client_id', null).eq('supplier_key', supplierKey).eq('header_signature', signature)
  }

  await rangerExemple(service, {
    clientId, supplierKey, invoiceId: null,
    texte: texte.slice(0, TEXTE_MAX), lignes, totalHT: total,
    promptVersion: PROMPT_LIGNES_VERSION,
    shared: true,
  })

  return NextResponse.json({
    appris: true,
    somme, total, ecart,
    lignes: lignes.length,
    prix: lignes.filter(l => l.unit_price_ht !== null).length,
    refusees,
    fournisseur: supplierKey,
    signature,
    // Dit en clair ce qui vient d'entrer : c'est un exemple corrigé À LA MAIN,
    // et l'inventaire ne le distingue pas d'un exemple lu tout seul.
    motif: `Exemple corrigé rangé : ${lignes.length} lignes pour ${somme.toFixed(2)} € — il servira à toutes les boucheries.`,
  })
}
