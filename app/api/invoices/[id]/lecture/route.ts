// app/api/invoices/[id]/lecture/route.ts — ARRÊTER (ou reprendre) la lecture
// d'une facture. Lot 80.
//
// Une facture illisible restait dans la file « À traiter » indéfiniment, et le
// bouton « Lire les N factures » la repassait au modèle à chaque clic, à nos
// frais. Le boucher peut désormais dire « ne plus essayer », et revenir dessus.
//
// CE QUE CETTE ROUTE NE FAIT PAS : elle ne supprime rien et ne touche à aucun
// montant. La facture garde sa place dans les achats, la marge et le résultat
// de sa semaine — elle a bien été payée, même si personne n'a pu lire ses
// lignes. Sortir de la file de LECTURE et sortir des COMPTES sont deux gestes
// différents ; celui-ci ne connaît que le premier (cf. lib/lecture-file).
//
// POURQUOI UNE ROUTE DÉDIÉE, et pas PATCH /api/invoices/[id] : cette dernière
// applique le corps JSON reçu tel quel à `update(body)`, sans liste blanche.
// Elle convient à un formulaire d'édition existant ; on ne bâtit pas un geste
// NEUF dessus. Ici, deux issues écrites en dur, rien d'autre ne passe.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { STATUT_ABANDONNE } from '@/lib/lecture-file'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  if (typeof body?.abandon !== 'boolean') {
    return NextResponse.json({ error: 'abandon (true | false) requis' }, { status: 400 })
  }
  const abandon = body.abandon as boolean

  const jour = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

  // ABANDON : le statut porte la sortie de file, le motif dit en français ce
  // qui a été décidé et ce qui NE bouge PAS. Le compteur d'échecs est laissé
  // tel quel — il raconte l'histoire du document, et l'abandon prime de toute
  // façon sur lui.
  // REPRISE : la facture repart PROPRE — plus de statut, plus de motif, plus
  // d'échecs au compteur. Sans cette remise à zéro, une facture reprise après
  // trois échecs ressortirait aussitôt de la file, et le bouton
  // « Réessayer » ne ferait rien de visible.
  const patch = abandon
    ? {
        lines_status: STATUT_ABANDONNE,
        lines_error: `Lecture abandonnée à votre demande le ${jour}. Le montant de la facture reste compté dans vos achats — seules ses lignes manquent à la mercuriale.`,
        lines_checked_at: new Date().toISOString(),
      }
    : {
        lines_status: null,
        lines_error: null,
        lectures_echouees: 0,
      }

  // Le filtre par fiche est la barrière anti-fuite du projet : une facture
  // d'une autre boutique n'est pas touchable, même avec son identifiant.
  const { data, error } = await service.from('invoices')
    .update(patch)
    .eq('id', params.id)
    .eq('client_id', clientId)
    .select('id, supplier_name, lines_status')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 })

  return NextResponse.json({ success: true, abandon, lines_status: data.lines_status ?? null })
}
