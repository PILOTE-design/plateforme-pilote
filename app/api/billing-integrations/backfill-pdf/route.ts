// app/api/billing-integrations/backfill-pdf/route.ts — RATTRAPAGE des PDF manquants.
//
// Mesuré le 31/07 : 53 factures sur 118 (18 485 €) n'ont aucun PDF archivé, donc
// aucune ligne, donc aucun prix de mercuriale. La cause est structurelle :
// l'URL de fichier de Pennylane expire en 30 minutes, et si la synchro a été
// interrompue (fenêtre Vercel) ou si le champ manquait ce jour-là, le PDF est
// perdu pour toujours — la synchro ne repasse que sur UNE semaine à la fois,
// celle choisie dans l'écran, ce qui imposerait vingt-six clics pour six mois.
//
// Cette route balaie les factures SANS PDF, redemande une URL FRAÎCHE à
// Pennylane et archive le document. Deux chemins :
//   1. `external_id` connu → appel direct sur la facture (fiable) ;
//   2. sinon → appariement sur la liste de la semaine de la facture, par
//      fournisseur + date + montant, et UNIQUEMENT si la correspondance est
//      unique (jamais de PDF rattaché à la mauvaise facture).
// Mesuré : 10 factures ont un external_id, 43 passeront par l'appariement.
//
// Traitement par LOTS bornés : la fenêtre Vercel est de 60 s et chaque PDF coûte
// un aller-retour. La route dit toujours combien il en reste — jamais de
// troncature muette.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { isAdminEmail } from '@/lib/admins'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BASE = 'https://app.pennylane.com/api/external/v2'
/** Un lot volontairement petit : mieux vaut plusieurs passages sûrs qu'un seul
 *  interrompu à mi-chemin par la fenêtre de la plateforme. */
const LOT = 12

type Cible = {
  id: string
  supplier_name: string | null
  invoice_date: string | null
  amount_ht: string | number | null
  external_id: string | null
}

async function plGet(token: string, path: string): Promise<any | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(9000),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

function itemsOf(data: any): any[] {
  for (const k of ['supplier_invoices', 'invoices', 'items', 'data', 'results']) {
    if (Array.isArray(data?.[k])) return data[k]
  }
  return Array.isArray(data) ? data : []
}

const fileUrlOf = (inv: any): string | null =>
  typeof inv?.public_file_url === 'string' && inv.public_file_url ? inv.public_file_url : null

/** Normalisation grossière d'un nom de fournisseur pour l'appariement : on
 *  compare des débuts de libellés, pas des chaînes exactes (PILOTE stocke
 *  « Facture DAVID MASTER - 01525617 (label généré) »). */
const cle = (s: string | null | undefined) =>
  String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/^(facture|avoir)\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 18)

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const service = createServiceClient()
  // ENTRETIEN PAR L'ADMINISTRATEUR : le compte admin n'a pas de fiche, mais il a
  // la charge de toutes. Un corps { client_id } désigne la fiche à rattraper —
  // accepté UNIQUEMENT pour un administrateur : pour tout autre compte, demander
  // une autre fiche est un refus net, jamais un repli silencieux sur la sienne.
  const corps = await req.json().catch(() => ({} as Record<string, unknown>))
  const ficheDemandee = typeof corps?.client_id === 'string' && corps.client_id ? corps.client_id : null
  let clientId: string | null
  if (ficheDemandee) {
    if (!isAdminEmail(user.email)) return NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 })
    clientId = ficheDemandee
  } else {
    clientId = await resolveClientId(service, user.id, user.email)
  }
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const { data: integ } = await service.from('billing_integrations')
    .select('api_token')
    .eq('client_id', clientId).eq('provider', 'pennylane').eq('is_active', true)
    .order('last_sync_at', { ascending: false })
    .limit(1).maybeSingle()
  if (!integ?.api_token) {
    return NextResponse.json({ error: 'Aucune intégration Pennylane active — connectez-la depuis Facturation.' }, { status: 404 })
  }
  const token = String(integ.api_token)

  // Les plus récentes d'abord : ce sont celles dont les prix comptent le plus
  const { data: cibles, count } = await service.from('invoices')
    .select('id, supplier_name, invoice_date, amount_ht, external_id', { count: 'exact' })
    .eq('client_id', clientId)
    .is('file_path', null)
    .eq('is_fixed_charge', false)
    .order('invoice_date', { ascending: false })
    .limit(LOT)

  const liste = (cibles || []) as Cible[]
  if (liste.length === 0) {
    return NextResponse.json({ ok: true, traitees: 0, recuperes: 0, restantes: 0, message: 'Aucune facture sans PDF.' })
  }

  // Une seule liste Pennylane par semaine visitée, réutilisée pour l'appariement
  const cacheSemaine = new Map<string, any[]>()
  const echecs: { facture: string; motif: string }[] = []
  let recuperes = 0

  for (const c of liste) {
    let url: string | null = null

    if (c.external_id) {
      const detail = await plGet(token, `/supplier_invoices/${c.external_id}`)
      url = fileUrlOf(detail)
      if (!url) echecs.push({ facture: c.supplier_name ?? c.id, motif: 'Pennylane ne renvoie pas de fichier pour cette facture' })
    } else if (c.invoice_date) {
      // Appariement : la liste des factures autour de la date, puis une seule
      // correspondance fournisseur + date + montant, sinon on ne touche à rien.
      const jour = String(c.invoice_date).slice(0, 10)
      let items = cacheSemaine.get(jour)
      if (!items) {
        const filtre = encodeURIComponent(JSON.stringify([
          { field: 'date', operator: 'gteq', value: jour },
          { field: 'date', operator: 'lteq', value: jour },
        ]))
        items = itemsOf(await plGet(token, `/supplier_invoices?limit=100&filter=${filtre}`))
        cacheSemaine.set(jour, items)
      }
      const montant = Math.abs(parseFloat(String(c.amount_ht ?? 0)) || 0)
      const k = cle(c.supplier_name)
      const candidats = items.filter((it: any) => {
        const ht = Math.abs(parseFloat(String(it.currency_amount_before_tax ?? it.amount_before_tax ?? 0)) || 0)
        const nom = cle(it.supplier?.name ?? it.third_party?.name ?? it.label)
        return Math.abs(ht - montant) < 0.02 && k.length > 2 && (nom.startsWith(k) || k.startsWith(nom))
      })
      if (candidats.length === 1) {
        url = fileUrlOf(candidats[0])
        if (!url) echecs.push({ facture: c.supplier_name ?? c.id, motif: 'facture retrouvée mais sans fichier chez Pennylane' })
        // On profite du passage pour poser l'external_id manquant : le prochain
        // rattrapage passera par le chemin direct, sans appariement.
        if (candidats[0]?.id) {
          await service.from('invoices').update({ external_id: String(candidats[0].id) }).eq('id', c.id)
        }
      } else {
        echecs.push({
          facture: c.supplier_name ?? c.id,
          motif: candidats.length === 0 ? 'aucune facture correspondante chez Pennylane' : `${candidats.length} factures identiques ce jour-là — appariement impossible sans risque`,
        })
      }
    } else {
      echecs.push({ facture: c.supplier_name ?? c.id, motif: 'facture sans date : rien à quoi la rattacher' })
    }

    if (!url) continue

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) { echecs.push({ facture: c.supplier_name ?? c.id, motif: `téléchargement refusé (HTTP ${res.status})` }); continue }
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length === 0) { echecs.push({ facture: c.supplier_name ?? c.id, motif: 'fichier vide' }); continue }
      const path = `${clientId}/backfill-${c.id}.pdf`
      const { error: upErr } = await service.storage.from('invoice-files')
        .upload(path, buf, { contentType: 'application/pdf', upsert: true })
      if (upErr) { echecs.push({ facture: c.supplier_name ?? c.id, motif: `archivage impossible : ${upErr.message}` }); continue }
      // Le PDF retrouvé REMET la facture dans la file de lecture : sans ça elle
      // resterait « no_file » à vie, exclue de la file (défaut corrigé au lot 1).
      await service.from('invoices').update({
        file_path: path,
        lines_status: null,
        lines_error: null,
      }).eq('id', c.id)
      recuperes++
    } catch (e) {
      echecs.push({ facture: c.supplier_name ?? c.id, motif: e instanceof Error ? e.message.slice(0, 120) : 'téléchargement impossible' })
    }
  }

  const restantes = Math.max(0, (count ?? liste.length) - recuperes)
  return NextResponse.json({
    ok: true,
    traitees: liste.length,
    recuperes,
    restantes,
    echecs: echecs.slice(0, 20),
    message: restantes > 0
      ? `${recuperes} PDF récupéré${recuperes > 1 ? 's' : ''} · ${restantes} facture${restantes > 1 ? 's' : ''} encore sans PDF — relancez pour continuer.`
      : `${recuperes} PDF récupéré${recuperes > 1 ? 's' : ''} · plus aucune facture sans PDF.`,
  })
}
