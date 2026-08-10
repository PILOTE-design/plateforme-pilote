// app/api/invoices/confirm-nature/route.ts — TRANCHER un doute matière/charge.
//
// Le tri des factures pose un drapeau de DOUTE sur ses classements fragiles
// (nature jugée sur une lecture image, grosse facture écartée) au lieu de
// décider en silence — lot 29. Cette route reçoit le verdict du boucher, un
// clic, deux issues :
//
//   · « C'est une charge » — les lignes éventuellement publiées sont retirées,
//     la facture est classée hors matière, le doute est levé. Le fournisseur
//     s'en souvient : la mémoire de l'étage 2 ne compte que les classements
//     SANS doute, donc ce verdict verrouille ce qui ne l'était pas.
//   · « C'est de la matière » — si des lignes sont déjà publiées, le doute est
//     simplement levé. Si la facture avait été écartée, il faut RELIRE le
//     document : la route répond { relire_requise: true } et l'écran enchaîne
//     l'appel de lecture avec { relire: true, nature: 'matiere' } — le verdict
//     humain l'emporte sur le classement automatique, jamais sur les chiffres.
//
// Le verdict est écrit dans le motif, daté : l'historique dit toujours QUI a
// tranché — la machine ou l'humain.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { isAdminEmail } from '@/lib/admins'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const body = await request.json().catch(() => ({} as Record<string, unknown>))

  const service = createServiceClient()
  // ENTRETIEN PAR L'ADMINISTRATEUR : un corps { client_id } désigne la fiche —
  // accepté UNIQUEMENT pour un administrateur, refus net pour tout autre compte.
  const ficheDemandee = typeof body.client_id === 'string' && body.client_id ? String(body.client_id) : null
  let clientId: string | null
  if (ficheDemandee) {
    if (!isAdminEmail(user.email)) return NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 })
    clientId = ficheDemandee
  } else {
    clientId = await resolveClientId(service, user.id, user.email)
  }
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const invoiceId = typeof body.invoice_id === 'string' && body.invoice_id ? String(body.invoice_id) : null
  const nature = body.nature === 'matiere' || body.nature === 'hors_matiere' ? String(body.nature) : null
  if (!invoiceId || !nature) {
    return NextResponse.json({ error: 'invoice_id et nature (matiere | hors_matiere) requis' }, { status: 400 })
  }

  const { data: invoice } = await service.from('invoices')
    .select('id, supplier_name, lines_status, lines_error, nature_doute')
    .eq('id', invoiceId).eq('client_id', clientId).maybeSingle()
  if (!invoice) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 })

  const jour = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

  if (nature === 'hors_matiere') {
    // Verdict : charge. Les lignes publiées — s'il y en a — sortent de la
    // mercuriale ; c'est exactement le dégât mesuré (frais bancaires publiés
    // comme articles) que ce verdict répare.
    const { error: delErr } = await service.from('invoice_lines')
      .delete().eq('invoice_id', invoice.id).eq('client_id', clientId)
    if (delErr) return NextResponse.json({ error: `Retrait des lignes impossible : ${delErr.message}` }, { status: 500 })
    const { error } = await service.from('invoices').update({
      lines_status: 'hors_matiere',
      lines_error: `Confirmée charge (hors matière) d'un clic le ${jour}.`,
      lines_checked_at: new Date().toISOString(),
      nature_doute: false,
    }).eq('id', invoice.id).eq('client_id', clientId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, status: 'hors_matiere' })
  }

  // Verdict : matière.
  if (invoice.lines_status === 'done' || invoice.lines_status === 'partial') {
    // Les lignes sont déjà là et vérifiées : le doute est simplement levé.
    const { error } = await service.from('invoices').update({
      lines_error: [`Nature (matière) confirmée d'un clic le ${jour}.`, invoice.lines_error].filter(Boolean).join(' '),
      nature_doute: false,
    }).eq('id', invoice.id).eq('client_id', clientId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, status: invoice.lines_status })
  }

  // La facture avait été écartée : ses lignes n'existent pas — il faut relire
  // le document avec le verdict humain. C'est l'écran qui enchaîne l'appel de
  // lecture (même geste que « Relire »), pour que la fenêtre longue de
  // l'extraction ne soit pas imbriquée dans celle-ci.
  return NextResponse.json({ success: true, relire_requise: true })
}
