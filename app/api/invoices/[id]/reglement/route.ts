// app/api/invoices/[id]/reglement/route.ts — POINTER UNE FACTURE RÉGLÉE. Lot 108.
//
// LE GESTE QUI MANQUAIT. Jusqu'ici `payment_status` ne valait que
// 'to_be_processed' ou rien : aucune facture n'était jamais marquée réglée.
// La trésorerie (lot 104) ne pouvait donc être qu'un prévisionnel — une
// échéance passée restait une échéance DUE, faute de savoir si l'argent était
// sorti. Ce geste transforme le prévisionnel en constat, ligne par ligne.
//
// CE QUE CETTE ROUTE NE FAIT PAS : elle ne touche à AUCUN montant, à aucune
// semaine d'imputation, à aucune catégorie. Une facture pointée réglée compte
// exactement pareil dans les achats, la marge et le résultat de sa semaine.
// Payer et devoir sont deux questions différentes ; celle-ci ne connaît que la
// première.
//
// POURQUOI UNE ROUTE DÉDIÉE, et pas PATCH /api/invoices/[id] : cette dernière
// applique le corps JSON reçu tel quel à `update(body)`. Le lot 86 lui a posé
// une liste blanche, mais le principe reste — on ne bâtit pas un geste NEUF sur
// une route générique. Ici, deux issues écrites en dur, rien d'autre ne passe.
//
// RÉVERSIBLE. Un pointage qu'on ne peut pas défaire n'est pas un pointage,
// c'est un piège : on se trompe de ligne, et le solde ment jusqu'à la fin des
// temps. `regle: false` remet la facture dans la file.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'

export const dynamic = 'force-dynamic'

/** Le statut qui vaut « payée » pour `estReglee` (lib/tresorerie). Écrit ici
 *  en toutes lettres pour qu'on voie ce qui part en base. */
const STATUT_REGLEE = 'paid'
/** Le statut d'origine du connecteur, remis en dépointant : on rend la facture
 *  à l'état où le reste du produit l'attend. */
const STATUT_A_TRAITER = 'to_be_processed'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  if (typeof body?.regle !== 'boolean') {
    return NextResponse.json({ error: 'regle (true | false) requis' }, { status: 400 })
  }
  const regle = body.regle as boolean

  // La date de règlement peut différer de l'échéance — payer en retard est le
  // cas courant. Fournie, elle fait foi ; absente, on prend aujourd'hui.
  // Jamais l'échéance : ce serait dater le décaissement du jour prévu et non du
  // jour réel.
  const jourFourni = typeof body?.le === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.le)
    ? body.le as string
    : null
  const dateReglement = regle
    ? (jourFourni ? `${jourFourni}T12:00:00.000Z` : new Date().toISOString())
    : null

  // CLOISONNEMENT : le filtre porte sur l'id ET le client. Une facture d'une
  // autre boucherie ne peut pas être pointée depuis ce compte, même en
  // devinant son identifiant.
  const { data, error } = await service
    .from('invoices')
    .update({
      payment_status: regle ? STATUT_REGLEE : STATUT_A_TRAITER,
      paid_at: dateReglement,
    })
    .eq('id', params.id)
    .eq('client_id', clientId)
    .select('id, supplier_name, amount_ttc, paid_at')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 })

  return NextResponse.json({
    ok: true,
    id: data.id,
    regle,
    paid_at: data.paid_at,
    motif: regle
      ? `${data.supplier_name ?? 'Facture'} pointée réglée — elle sort des échéances à venir, ses montants ne bougent pas`
      : `${data.supplier_name ?? 'Facture'} remise dans les échéances à régler`,
  })
}
