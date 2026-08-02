// app/api/admin/invoice-layouts/route.ts — ALIMENTER la bibliothèque de mises
// en page avec des factures fournies, et consulter ce qu'elle contient.
//
// La bibliothèque apprend toute seule des factures bien lues — mais seulement de
// celles-là : un fournisseur qu'on n'a jamais su lire ne lui apprend jamais rien.
// Cet écran casse ce cercle : l'administrateur dépose des PDF d'exemple AVEC leur
// total HT, et chaque lecture qui boucle au centime entre dans la bibliothèque.
//
// Trois règles, non négociables :
//   · le TOTAL HT fourni est l'unique arbitre — sans lui, rien n'entre : on
//     archiverait des exemples faux avec la même confiance que des vrais, et un
//     mauvais exemple enseigne activement l'erreur ;
//   · la lecture passe par LA MÊME chaîne que la production (exemples déjà
//     appris, reprise avec l'écart nommé, lecture image en dernier recours) —
//     un import qui lirait autrement apprendrait des exemples que la production
//     ne sait pas reproduire ;
//   · rien d'autre n'est écrit : pas de facture, pas de réf, pas de point de
//     prix. La mercuriale ne voit jamais ces documents — ce sont des exemples,
//     pas des achats.
//
// Les exemples importés sont PARTAGÉS : ils servent toutes les boucheries de la
// plateforme. C'est le sens d'une donation d'exemples — et la raison pour
// laquelle cet écran est réservé aux administrateurs.

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
import {
  PROMPT_LIGNES_VERSION, TEXTE_MAX,
  extractLinesVision, lireTexteAvecReprise, sommeLignes,
  type ExtractedLine,
} from '@/lib/invoice-extract'
import { choisirExemples, consigneExemples, rangerExemple, signatureEntete } from '@/lib/invoice-layouts'

export const dynamic = 'force-dynamic'
// Jusqu'à trois passes de lecture par document : la fenêtre suit celle de la
// lecture de production. Un fichier par appel — la page boucle côté client.
export const maxDuration = 300

async function admin() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Non authentifié' }, { status: 401 }) }
  if (!isAdminEmail(user.email)) return { error: NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 }) }
  const service = createServiceClient()
  // Un administrateur n'a pas forcément de fiche client — le compte principal
  // n'en a aucune, et cette route a exigé une fiche à tort à sa première
  // version : « Client introuvable » sur l'écran même qui venait d'être livré.
  // Un import d'exemples PARTAGÉS n'appartient à aucune boucherie ; la fiche,
  // quand elle existe, ne sert qu'à voir aussi ses exemples moissonnés.
  const clientId = await resolveClientId(service, user.id, user.email)
  return { service, clientId: clientId ?? null }
}

/** Uuid qui n'existe pas : permet d'interroger la bibliothèque « exemples
 *  partagés seulement » sans écrire une seconde requête. */
const AUCUNE_FICHE = '00000000-0000-0000-0000-000000000000'

/** L'inventaire : ce que la bibliothèque sait, et depuis quand. */
export async function GET() {
  const auth = await admin()
  if ('error' in auth) return auth.error
  const { service } = auth

  const { data, error } = await service.from('invoice_layouts')
    .select('id, supplier_key, header_signature, lines_count, total_ht, shared, prompt_version, updated_at')
    .order('updated_at', { ascending: false })
    .limit(500)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const rows = data || []
  return NextResponse.json({
    total: rows.length,
    partages: rows.filter((r: { shared: boolean }) => r.shared).length,
    exemples: rows,
  })
}

/** Apprend UN document : lecture par la chaîne de production, arbitrage par le
 *  total fourni, rangement si — et seulement si — la somme tombe au centime. */
export async function POST(request: NextRequest) {
  const auth = await admin()
  if ('error' in auth) return auth.error
  const { service, clientId } = auth

  const form = await request.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Corps multipart attendu (fichier + total)' }, { status: 400 })

  const fichier = form.get('file')
  if (!(fichier instanceof File)) return NextResponse.json({ error: 'Fichier PDF manquant' }, { status: 400 })

  const totalBrut = String(form.get('total') ?? '').trim().replace(/\s/g, '').replace(',', '.')
  const total = parseFloat(totalBrut)
  if (!Number.isFinite(total) || total === 0) {
    return NextResponse.json({ appris: false, motif: 'Total HT manquant ou illisible — sans lui, aucun arbitre : rien ne peut entrer dans la bibliothèque.' })
  }

  const nomFourni = String(form.get('fournisseur') ?? '').trim()
  const nomBase = nomFourni || fichier.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim()
  const supplierKey = normalizeSupplierName(supplierSociete(nomBase))
    || normText(nomBase).replace(/\s+/g, '').slice(0, 60)
    || 'import'

  const buffer = Buffer.from(await fichier.arrayBuffer())

  // Texte du PDF : lecture par coordonnées d'abord (colonnes préservées), repli
  // pdf-parse — exactement comme la lecture de production.
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
      motif: `Ce PDF ne porte pas de texte exploitable (${lettres} lettres lues) : c'est un scan ou une photo. La bibliothèque apprend des mises en page TEXTE — un scan ne lui apprend rien.`,
    })
  }

  // La MÊME chaîne que la production : exemples déjà appris, deux passes texte,
  // puis lecture image si le compte ne tombe toujours pas.
  const exemples = consigneExemples(
    await choisirExemples(service, clientId ?? AUCUNE_FICHE, supplierKey, texte).catch(() => []),
  )
  const lecture = await lireTexteAvecReprise(texte, total, exemples)
  let lines: ExtractedLine[] = lecture.lines
  let passe: string = lecture.passe
  let tentatives = lecture.tentatives

  // Zéro ligne compte comme un écart de la valeur du total : un document que le
  // texte ne livre pas (couche abîmée, nature mal jugée) mérite d'être REGARDÉ
  // avant d'être déclaré illisible — c'est tout le sens du processeur de secours.
  const ecartDe = (ls: ExtractedLine[]) => Math.abs(sommeLignes(ls) - total)
  if (lines.length === 0 || ecartDe(lines) > 0.02) {
    tentatives++
    try {
      const vu = await extractLinesVision(buffer, total)
      const nbPrix = (ls: ExtractedLine[]) => ls.filter(l => l.unit_price_ht !== null).length
      const mieux = vu.lines.length > 0 && (
        ecartDe(vu.lines) < ecartDe(lines) - 0.005
        || (Math.abs(ecartDe(vu.lines) - ecartDe(lines)) <= 0.005 && nbPrix(vu.lines) > nbPrix(lines))
      )
      // La lecture IMAGE peut produire un exemple TEXTE : le texte abîmé associé
      // à la lecture juste (vérifiée par le total) apprend exactement les mises
      // en page que la lecture texte rate — c'est le cas AURIBAULT.
      if (mieux) { lines = vu.lines; passe = 'vision' }
    } catch (e) {
      console.error('[layouts-import] lecture image indisponible:', e instanceof Error ? e.message : e)
    }
  }

  const somme = Math.round(sommeLignes(lines) * 100) / 100
  const ecart = Math.round((somme - total) * 100) / 100

  if (lines.length === 0) {
    return NextResponse.json({ appris: false, somme, total, ecart, passe, tentatives, motif: 'Aucune ligne d’article reconnue sur ce document.' })
  }
  if (lines.length < 2) {
    return NextResponse.json({ appris: false, somme, total, ecart, passe, tentatives, motif: 'Une seule ligne : ce document n’apprend rien d’une mise en page.' })
  }
  if (Math.abs(ecart) > 0.02) {
    return NextResponse.json({
      appris: false, somme, total, ecart, passe, tentatives,
      motif: `La lecture ne boucle pas : ${somme.toFixed(2)} € lus pour ${total.toFixed(2)} € attendus (${ecart > 0 ? '+' : ''}${ecart.toFixed(2)} €) après ${tentatives} passe${tentatives > 1 ? 's' : ''}. Rien n’entre dans la bibliothèque — vérifiez le total saisi, ou le document résiste encore.`,
    })
  }

  // Le compte tombe : l'exemple entre, PARTAGÉ — c'est une donation à la
  // plateforme. `rangerExemple` revérifie le bouclage de son côté : la barrière
  // vit dans la bibliothèque, pas seulement ici.
  // Un exemple partagé sans fiche (client_id null) échappe à l'unicité de
  // l'upsert — les NULL sont tous distincts pour Postgres. On retire donc
  // d'abord l'éventuel doublon exact, pour qu'un ré-import remplace au lieu
  // d'empiler.
  const signature = signatureEntete(texte)
  if (clientId === null) {
    await service.from('invoice_layouts').delete()
      .is('client_id', null).eq('supplier_key', supplierKey).eq('header_signature', signature)
  }
  await rangerExemple(service, {
    clientId, supplierKey, invoiceId: null,
    texte: texte.slice(0, TEXTE_MAX), lignes: lines, totalHT: total,
    promptVersion: PROMPT_LIGNES_VERSION,
    shared: true,
  })

  return NextResponse.json({
    appris: true, somme, total, ecart, passe, tentatives,
    lignes: lines.length,
    prix: lines.filter(l => l.unit_price_ht !== null).length,
    fournisseur: supplierKey,
    signature,
  })
}
