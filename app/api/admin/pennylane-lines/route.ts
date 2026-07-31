// app/api/admin/pennylane-lines/route.ts — SONDE de l'endpoint « lignes de
// facture » de Pennylane (API v2).
//
// Pourquoi : la lecture des lignes par IA sur le PDF plafonne à ~68 % de
// factures parfaitement lues (mesuré en prod le 31/07 : 43 « done », 13
// « partial », 7 « error »). Or Pennylane extrait DÉJÀ les lignes de chaque
// facture fournisseur — validées par le comptable — et les expose :
//   GET /supplier_invoices/{id}/invoice_lines
// Les champs renvoyés ne sont PAS documentés publiquement. Avant d'écrire le
// moindre connecteur, cette sonde appelle l'endpoint avec la clé DÉJÀ en base
// et rend la réponse BRUTE : on saura alors si la quantité, l'unité et le prix
// unitaire y sont — les trois champs dont la mercuriale a besoin.
//
// Lecture seule, réservée aux administrateurs, et le token n'est JAMAIS renvoyé
// au navigateur (seule son existence est confirmée).

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/admins'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BASE = 'https://app.pennylane.com/api/external/v2'

async function plFetch(token: string, path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10000),
  })
  const text = await res.text().catch(() => '')
  let json: unknown = null
  try { json = JSON.parse(text) } catch { /* réponse non JSON : on garde le texte */ }
  return { status: res.status, ok: res.ok, json, text: text.slice(0, 2000) }
}

/** Les lignes peuvent arriver sous plusieurs clés selon la version du schéma */
function pickLines(payload: any): any[] {
  if (Array.isArray(payload)) return payload
  for (const k of ['invoice_lines', 'items', 'data', 'results', 'lines']) {
    if (Array.isArray(payload?.[k])) return payload[k]
  }
  return []
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const clientId = typeof body.client_id === 'string' && body.client_id ? body.client_id : null

  const service = createServiceClient()

  // Intégration Pennylane active — le token reste côté serveur
  let q = service.from('billing_integrations')
    .select('client_id, api_token, clients(name)')
    .eq('provider', 'pennylane').eq('is_active', true)
  if (clientId) q = q.eq('client_id', clientId)
  const { data: integrations, error: intErr } = await q.limit(1)
  if (intErr) return NextResponse.json({ error: intErr.message }, { status: 500 })
  const integ = (integrations || [])[0] as any
  if (!integ?.api_token) {
    return NextResponse.json({ error: 'Aucune intégration Pennylane active' }, { status: 404 })
  }
  const token = String(integ.api_token)
  const boutique = integ.clients?.name ?? '—'

  // 1. Quelques factures fournisseurs récentes (pour disposer d'un id réel)
  const list = await plFetch(token, '/supplier_invoices?limit=5&sort=-date')
  if (!list.ok) {
    return NextResponse.json({
      boutique, etape: 'liste des factures',
      status: list.status, reponse: list.text,
      error: `Pennylane a répondu ${list.status}`,
    }, { status: 502 })
  }
  const items = pickLines(list.json).length > 0 ? pickLines(list.json) : (list.json as any)?.supplier_invoices ?? []
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ boutique, etape: 'liste des factures', error: 'Aucune facture renvoyée', reponse: list.text })
  }

  // 2. Les LIGNES de chacune — l'objet de la sonde
  const sondes: any[] = []
  for (const inv of items.slice(0, 3)) {
    const id = inv?.id
    if (id === undefined || id === null) continue
    const r = await plFetch(token, `/supplier_invoices/${id}/invoice_lines?limit=100`)
    const lignes = r.ok ? pickLines(r.json) : []
    sondes.push({
      facture_id: String(id),
      fournisseur: inv?.supplier?.name ?? inv?.third_party?.name ?? inv?.label ?? '—',
      date: inv?.date ?? null,
      montant_ht: inv?.currency_amount_before_tax ?? inv?.amount_before_tax ?? null,
      status: r.status,
      nb_lignes: lignes.length,
      // Ce qui décide de tout : les champs réellement présents sur une ligne
      champs_disponibles: lignes.length > 0 ? Object.keys(lignes[0]).sort() : [],
      premiere_ligne: lignes.length > 0 ? lignes[0] : null,
      reponse_brute: lignes.length === 0 ? r.text : undefined,
    })
  }

  // Verdict lisible : la mercuriale a besoin d'une désignation, d'une quantité
  // et d'un prix unitaire. On dit ce qu'on VOIT, sans extrapoler.
  const champs = new Set<string>(sondes.flatMap(s => s.champs_disponibles as string[]))
  const trouve = (mots: string[]) => [...champs].filter(c => mots.some(m => c.toLowerCase().includes(m)))
  const verdict = {
    lignes_disponibles: sondes.some(s => s.nb_lignes > 0),
    champs_designation: trouve(['label', 'description', 'designation', 'name']),
    champs_quantite: trouve(['quantity', 'qty', 'quantite']),
    champs_prix_unitaire: trouve(['unit_price', 'unit_amount', 'price']),
    champs_montant: trouve(['amount', 'total']),
  }

  return NextResponse.json({ boutique, sondes, verdict, champs_vus: [...champs].sort() })
}
