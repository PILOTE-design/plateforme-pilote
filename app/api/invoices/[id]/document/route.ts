// app/api/invoices/[id]/document/route.ts — TÉLÉVERSER le document d'une
// facture qui n'en a pas (lot 31).
//
// Demande client (03/08) : une facture mal transmise par le connecteur arrive
// en « charges structurelles » sans document, et rien ne permettait au boucher
// de fournir lui-même le PDF. Il l'a pourtant, souvent — dans ses mails, dans
// un tiroir. Cette route le reçoit, l'archive, et REMET LA FACTURE EN FILE DE
// LECTURE : c'est le DOCUMENT qui la fera re-juger, comme partout ailleurs —
// si la lecture prouve de la matière, l'étiquette « charge fixe » tombe
// automatiquement (corrigerEtiquette) et la facture repasse dans les achats de
// la semaine. On ne « déplace » pas une facture sur parole : on lit sa preuve.
//
// Garde-fous :
//   · le téléversement n'est permis que si la facture N'A PAS de lecture
//     exploitable — sans PDF, ou no_file / scan_illisible / error /
//     hors_matiere. Une facture done/partial a des lignes VÉRIFIÉES : son
//     document ne s'écrase pas, jamais.
//   · uniquement du PDF (l'en-tête %PDF fait foi, pas l'extension), 8 Mo max ;
//   · le fichier est archivé sous un nom propre à la facture (upload-{id}) —
//     re-téléverser remplace le précédent, il ne s'empile pas.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { isAdminEmail } from '@/lib/admins'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Au-delà, ce n'est plus une facture : la plateforme plafonne de toute façon
 *  le corps des requêtes autour de 4,5 Mo — on annonce une limite honnête. */
const TAILLE_MAX = 8 * 1024 * 1024

/** Statuts SANS lecture exploitable : le document peut être (re)fourni. */
const REMPLACABLES = new Set(['no_file', 'scan_illisible', 'error', 'hors_matiere'])

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const service = createServiceClient()

  const form = await request.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Envoi illisible — joignez le fichier PDF.' }, { status: 400 })

  // ENTRETIEN PAR L'ADMINISTRATEUR : un champ client_id désigne la fiche —
  // accepté UNIQUEMENT pour un administrateur, refus net pour tout autre compte.
  const ficheDemandee = typeof form.get('client_id') === 'string' && form.get('client_id') ? String(form.get('client_id')) : null
  let clientId: string | null
  if (ficheDemandee) {
    if (!isAdminEmail(user.email)) return NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 })
    clientId = ficheDemandee
  } else {
    clientId = await resolveClientId(service, user.id, user.email)
  }
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const { data: invoice } = await service.from('invoices')
    .select('id, supplier_name, file_path, lines_status, is_fixed_charge')
    .eq('id', params.id).eq('client_id', clientId).maybeSingle()
  if (!invoice) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 })

  // Une lecture exploitable existe : le document en place a fait ses preuves
  // (lignes vérifiées au centime). On ne l'écrase pas — si un prix semble faux,
  // c'est la relecture qu'il faut, pas un autre fichier.
  const remplacable = !invoice.file_path || REMPLACABLES.has(String(invoice.lines_status ?? ''))
  if (!remplacable) {
    return NextResponse.json({
      error: 'Cette facture a déjà un document lu et vérifié — son fichier ne se remplace pas. Utilisez « Relire » si sa lecture semble fausse.',
    }, { status: 409 })
  }

  const fichier = form.get('file')
  if (!fichier || typeof fichier === 'string' || !('arrayBuffer' in fichier)) {
    return NextResponse.json({ error: 'Aucun fichier joint — sélectionnez le PDF de la facture.' }, { status: 400 })
  }
  const buf = Buffer.from(await (fichier as File).arrayBuffer())
  if (buf.length === 0) return NextResponse.json({ error: 'Fichier vide.' }, { status: 400 })
  if (buf.length > TAILLE_MAX) {
    return NextResponse.json({ error: 'Fichier trop lourd (8 Mo maximum). Exportez la facture en PDF léger plutôt qu\'en scan haute résolution.' }, { status: 413 })
  }
  // L'en-tête fait foi : un .pdf renommé n'est pas un PDF.
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return NextResponse.json({ error: 'Ce fichier n\'est pas un PDF. Exportez la facture au format PDF et réessayez.' }, { status: 415 })
  }

  const path = `${clientId}/upload-${invoice.id}.pdf`
  const { error: upErr } = await service.storage.from('invoice-files')
    .upload(path, buf, { contentType: 'application/pdf', upsert: true })
  if (upErr) return NextResponse.json({ error: `Archivage impossible : ${upErr.message}` }, { status: 500 })

  // Le document REMET la facture en file de lecture — statut vierge, doute
  // levé : c'est la lecture qui va trancher sa nature, pas nous ici.
  const jour = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  const { error: updErr } = await service.from('invoices').update({
    file_path: path,
    lines_status: null,
    lines_error: `Document téléversé le ${jour} — en attente de lecture.`,
    nature_doute: false,
  }).eq('id', invoice.id).eq('client_id', clientId)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  return NextResponse.json({ success: true, file_path: path })
}
