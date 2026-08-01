// app/api/admin/invoice-eval/route.ts — MESURE de la lecture des factures.
//
// Rejoue l'extracteur COURANT sur les textes de factures archivés (colonne
// `lines_source_text`, posée à chaque lecture) et compare, chiffre par chiffre,
// à ce qui est en base. Deux résultats, qui ne disent pas la même chose :
//
//   · EXACTITUDE — les montants, quantités et prix relus coïncident-ils avec la
//     référence ? C'est le garde-fou anti-régression : un changement de prompt
//     qui la fait baisser ne se livre pas.
//   · PRIX EXPLOITABLES — combien de lignes ressortent avec un prix qui se
//     recoupe (quantité × prix = montant), donc publiable dans la mercuriale ?
//     C'est le chiffre à faire MONTER. Mesuré le 31/07 : 47 prix refusés sur
//     306 lignes, dont 32 sur des factures dont la somme tombait pourtant au
//     centime près — le prix était juste, le recoupement échouait.
//
// RÉFÉRENCE : seules les factures dont la somme des lignes tombe sur le total à
// deux centimes près servent de cas. Sur celles-là, la lecture est sûre — c'est
// la seule vérité disponible sans ressaisie humaine, et elle suffit à détecter
// une régression.
//
// Réservé aux administrateurs. Le rejeu appelle l'IA une fois par facture : le
// lot est BORNÉ pour tenir dans la fenêtre de 60 s, et les cas non traités sont
// annoncés — jamais tronqués en silence.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/admins'
import { PROMPT_LIGNES_VERSION, extractLinesLong } from '@/lib/invoice-extract'
import { compareFacture, aggregerFactures, type CasFacture, type LigneFacture } from '@/lib/invoice-eval'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Un rejeu = un appel IA par facture. Six tiennent dans la fenêtre ; au-delà,
 *  la route rend ce qu'elle a en disant combien il reste. */
const LOT_DEFAUT = 6

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  if (!isAdminEmail(user.email)) return NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 })

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const lot = Math.min(12, Math.max(1, Number(body?.lot) || LOT_DEFAUT))

  const service = createServiceClient()

  // Cas candidats : un texte source archivé et des lignes en base. La lecture
  // image n'est pas rejouable depuis un texte — elle est comptée à part.
  const { data: candidats } = await service.from('invoices')
    .select('id, supplier_name, invoice_date, amount_ht, lines_source_text, lines_mode, lines_prompt_version')
    .not('lines_source_text', 'is', null)
    .eq('lines_mode', 'texte')
    .order('invoice_date', { ascending: false })
    .limit(200)

  const { data: nonRejouables } = await service.from('invoices')
    .select('id', { count: 'exact', head: true })
    .not('lines_source_text', 'is', null)
    .neq('lines_mode', 'texte')

  const liste = candidats || []
  if (liste.length === 0) {
    return NextResponse.json({
      ok: true, cas: 0,
      message: 'Corpus vide : aucune facture n’a encore été relue depuis la mise en place de l’archivage. Relancez une lecture de factures pour le remplir.',
      prompt_version: PROMPT_LIGNES_VERSION,
    })
  }

  // Lignes de référence de ces factures
  const ids = liste.map(i => String(i.id))
  const { data: toutesLignes } = await service.from('invoice_lines')
    .select('invoice_id, designation, quantity, unit, unit_price_ht, amount_ht, weight_kg')
    .in('invoice_id', ids)

  const refParFacture = new Map<string, LigneFacture[]>()
  for (const l of (toutesLignes || []) as Record<string, unknown>[]) {
    const k = String(l.invoice_id)
    const arr = refParFacture.get(k) || []
    arr.push({
      designation: String(l.designation ?? ''),
      quantity: num(l.quantity),
      unit: (l.unit as string) ?? null,
      unit_price_ht: num(l.unit_price_ht),
      amount_ht: num(l.amount_ht) ?? 0,
      weight_kg: num(l.weight_kg),
    })
    refParFacture.set(k, arr)
  }

  // Seules les factures qui BOUCLENT servent de référence : ailleurs, on ne sait
  // pas laquelle des deux lectures a raison, donc rien à comparer.
  const eligibles = liste.filter(i => {
    const ref = refParFacture.get(String(i.id)) || []
    if (ref.length === 0) return false
    const total = num(i.amount_ht) ?? 0
    const somme = ref.reduce((s, l) => s + l.amount_ht, 0)
    return Math.abs(somme - total) <= 0.02
  })

  const aTraiter = eligibles.slice(0, lot)
  const cas: CasFacture[] = []
  const echecs: { facture: string; motif: string }[] = []

  for (const inv of aTraiter) {
    const ref = refParFacture.get(String(inv.id)) || []
    try {
      const { lines } = await extractLinesLong(String(inv.lines_source_text || ''), num(inv.amount_ht) ?? 0)
      cas.push(compareFacture(
        String(inv.id),
        String(inv.supplier_name ?? ''),
        (inv.invoice_date as string) ?? null,
        ref,
        lines.map(l => ({
          designation: l.designation,
          quantity: l.quantity,
          unit: l.unit,
          unit_price_ht: l.unit_price_ht,
          amount_ht: l.amount_ht,
          weight_kg: l.weight_kg,
        })),
      ))
    } catch (e) {
      echecs.push({ facture: String(inv.supplier_name ?? inv.id), motif: e instanceof Error ? e.message.slice(0, 160) : 'rejeu impossible' })
    }
  }

  const corpus = aggregerFactures(cas)
  // Prix exploitables de la RÉFÉRENCE, sur les mêmes factures : c'est la base de
  // comparaison. Le rejeu doit faire au moins aussi bien.
  const prixRefs = aTraiter.reduce((s, inv) => {
    const ref = refParFacture.get(String(inv.id)) || []
    return s + ref.filter(l => l.unit_price_ht !== null).length
  }, 0)

  const restants = Math.max(0, eligibles.length - aTraiter.length)
  return NextResponse.json({
    ok: true,
    prompt_version_courante: PROMPT_LIGNES_VERSION,
    versions_du_corpus: [...new Set(liste.map(i => String(i.lines_prompt_version ?? 'inconnue')))],
    corpus_disponible: liste.length,
    cas_eligibles: eligibles.length,
    cas_rejoues: cas.length,
    cas_restants: restants,
    non_rejouables_lecture_image: nonRejouables ?? 0,
    exactitude: Math.round(corpus.exactitude * 1000) / 10,
    chiffres_compares: corpus.total_chiffres,
    chiffres_justes: corpus.exacts,
    lignes_attendues: corpus.lignes_attendues,
    lignes_obtenues: corpus.lignes_obtenues,
    prix_exploitables_rejeu: corpus.prix_exploitables,
    prix_exploitables_reference: prixRefs,
    prix_gagnes: corpus.prix_gagnes,
    prix_perdus: corpus.prix_perdus,
    echecs,
    par_cas: corpus.par_cas.map(c => ({
      fournisseur: c.fournisseur, date: c.date,
      exactitude: Math.round(c.exactitude * 1000) / 10,
      lignes: `${c.lignes_obtenues}/${c.lignes_attendues}`,
      prix_exploitables: c.prix_exploitables,
      prix_gagnes: c.prix_gagnes,
      prix_perdus: c.prix_perdus,
      divergences: c.divergences.slice(0, 8),
    })),
    message: restants > 0
      ? `${cas.length} facture${cas.length > 1 ? 's' : ''} rejouée${cas.length > 1 ? 's' : ''} · ${restants} encore à rejouer — relancez pour continuer.`
      : `${cas.length} facture${cas.length > 1 ? 's' : ''} rejouée${cas.length > 1 ? 's' : ''} · corpus entièrement parcouru.`,
  })
}
