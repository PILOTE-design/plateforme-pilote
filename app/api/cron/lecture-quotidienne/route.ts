// app/api/cron/lecture-quotidienne/route.ts — LECTURE DE NUIT des factures.
//
// Mesuré sur la première fiche pilote : sans automate, la lecture n'avance que
// quand l'administrateur pense à cliquer — 53 factures sur 118 sont restées des
// mois sans PDF ni lignes. Une plateforme à dix boucheries ne tiendra jamais
// sur des clics. Ce cron passe CHAQUE NUIT (04:30 UTC, après la synchro du
// lundi 04:00) derrière toutes les fiches actives :
//
//   1. RATTRAPAGE — jusqu'à trois lots de PDF manquants (l'URL Pennylane
//      expire en 30 min : plus on attend, plus on perd) ;
//   2. LECTURE — les factures qui ont un PDF mais jamais été lues, les plus
//      récentes d'abord, trois lectures de front, 40 par fiche et par nuit.
//
// La route N'EXTRAIT RIEN elle-même : elle appelle les routes existantes
// (backfill-pdf, extract-lines) sur sa propre origine. Un seul chemin de
// publication, une seule quarantaine — un orchestrateur qui dupliquerait la
// lecture serait le meilleur moyen de la voir diverger.
//
// Accès : le secret de plateforme (Vercel l'envoie de lui-même quand
// CRON_SECRET est posé) OU une session d'administrateur pour un déclenchement
// manuel. Les appels internes portent la même autorité que l'appelant : le
// jeton en mode machine, les cookies en mode admin.
//
// Budget : 240 s de lancements sur une fenêtre de 300 s — l'automate s'arrête
// PROPREMENT avant d'être tué, et dit ce qu'il n'a pas eu le temps de faire.
// Ce qui reste attend la nuit suivante : rien n'est perdu, tout est dit.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/admins'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Lots de rattrapage PDF par fiche (12 PDF chacun côté backfill). */
const LOTS_PDF = 3
/** Factures lues par fiche et par nuit — borne le coût d'API (~1 ct/facture). */
const LECTURES_MAX = 40
/** Lectures menées de front. Trois : assez pour avancer, pas assez pour
 *  s'attirer un 429 de l'API d'extraction. */
const FRONT = 3
/** On cesse de LANCER du travail à 240 s ; ce qui est parti se termine dans la
 *  fenêtre de 300 s. */
const DEADLINE_MS = 240_000

type BilanFiche = {
  fiche: string
  client_id: string
  pdf_recuperes: number
  pdf_restants: number
  factures_a_lire: number
  lues: number
  publiees: number
  ecartees: number
  echecs: { facture: string; motif: string }[]
  coupee_par_le_temps: boolean
}

async function lireQuotidien(req: NextRequest): Promise<NextResponse> {
  const debut = Date.now()
  const tempsEcoule = () => Date.now() - debut > DEADLINE_MS

  // ── Qui appelle ? Le cron (secret de plateforme) ou un administrateur.
  const secret = process.env.CRON_SECRET
  const estMachine = !!secret && req.headers.get('authorization') === `Bearer ${secret}`
  if (!estMachine) {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    if (!isAdminEmail(user.email)) return NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 })
  }

  // Les appels internes reprennent l'autorité de l'appelant, jamais plus.
  const enTetes: Record<string, string> = { 'Content-Type': 'application/json' }
  if (estMachine) enTetes['authorization'] = `Bearer ${secret}`
  else enTetes['cookie'] = req.headers.get('cookie') ?? ''
  const origine = req.nextUrl.origin

  const appel = async (chemin: string, corps: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> => {
    try {
      const res = await fetch(`${origine}${chemin}`, {
        method: 'POST',
        headers: enTetes,
        body: JSON.stringify(corps),
        signal: AbortSignal.timeout(timeoutMs),
      })
      const donnees = await res.json().catch(() => ({} as Record<string, unknown>))
      // Un refus de la route porte son motif en français (« somme qui ne boucle
      // pas », « scan illisible »…) : le bilan le garde tel quel, pas un code.
      if (!res.ok) return { __erreur: String(donnees?.error ?? `HTTP ${res.status}`).slice(0, 160) }
      return donnees
    } catch (e) {
      return { __erreur: e instanceof Error ? e.name === 'TimeoutError' ? 'délai dépassé' : e.message.slice(0, 120) : 'appel impossible' }
    }
  }

  // ── Les fiches à servir : celles qui ont une intégration comptable ACTIVE.
  // Une fiche débranchée (bac à sable) sort de la tournée d'elle-même.
  const service = createServiceClient()
  const { data: integs } = await service.from('billing_integrations')
    .select('client_id')
    .eq('provider', 'pennylane').eq('is_active', true)
  const clientIds = [...new Set((integs || []).map(i => String(i.client_id)))]
  if (clientIds.length === 0) {
    return NextResponse.json({ ok: true, fiches: [], message: 'Aucune fiche avec intégration active — rien à lire.' })
  }
  const { data: clients } = await service.from('clients').select('id, name').in('id', clientIds)
  const nomDe = new Map((clients || []).map(c => [String(c.id), String(c.name ?? '')]))

  const bilans: BilanFiche[] = []

  for (const clientId of clientIds) {
    const bilan: BilanFiche = {
      fiche: nomDe.get(clientId) || clientId.slice(0, 8),
      client_id: clientId,
      pdf_recuperes: 0,
      pdf_restants: 0,
      factures_a_lire: 0,
      lues: 0,
      publiees: 0,
      ecartees: 0,
      echecs: [],
      coupee_par_le_temps: false,
    }
    bilans.push(bilan)
    if (tempsEcoule()) { bilan.coupee_par_le_temps = true; continue }

    // 1. RATTRAPAGE des PDF manquants — avant la lecture, pour que les factures
    //    tout juste récupérées entrent dans la file de cette nuit.
    for (let lot = 0; lot < LOTS_PDF && !tempsEcoule(); lot++) {
      const r = await appel('/api/billing-integrations/backfill-pdf', { client_id: clientId }, 58_000)
      if (r.__erreur) { bilan.echecs.push({ facture: 'rattrapage PDF', motif: String(r.__erreur) }); break }
      bilan.pdf_recuperes += Number(r.recuperes) || 0
      bilan.pdf_restants = Number(r.restantes) || 0
      // Plus rien à rattraper, ou plus rien de rattrapABLE : inutile d'insister.
      if (!r.restantes || !r.recuperes) break
    }

    // 2. LECTURE des factures jamais lues — un PDF présent, aucun statut.
    //    Les plus récentes d'abord : leurs prix comptent le plus.
    const { data: aLire, count } = await service.from('invoices')
      .select('id, supplier_name', { count: 'exact' })
      .eq('client_id', clientId)
      .not('file_path', 'is', null)
      .is('lines_status', null)
      .order('invoice_date', { ascending: false })
      .limit(LECTURES_MAX)
    const file = aLire || []
    bilan.factures_a_lire = count ?? file.length

    let curseur = 0
    const ouvrier = async () => {
      while (true) {
        if (tempsEcoule()) { bilan.coupee_par_le_temps = true; return }
        const i = curseur++
        if (i >= file.length) return
        const f = file[i]
        const r = await appel('/api/invoices/extract-lines', { client_id: clientId, invoice_id: String(f.id) }, 120_000)
        bilan.lues++
        if (r.__erreur) bilan.echecs.push({ facture: String(f.supplier_name ?? f.id), motif: String(r.__erreur) })
        else if (r.success === true && (Number(r.lines) || 0) > 0) bilan.publiees++
        // Écartée = traitée mais sans ligne publiée : hors matière, quarantaine,
        // scan illisible… La route a posé son motif en base ; pas un échec ICI.
        else bilan.ecartees++
      }
    }
    await Promise.all(Array.from({ length: FRONT }, () => ouvrier()))
  }

  const duree = Math.round((Date.now() - debut) / 1000)
  const bilanGlobal = {
    ok: true,
    duree_s: duree,
    fiches: bilans,
    message: bilans.some(b => b.coupee_par_le_temps)
      ? `Tournée écourtée à ${duree} s — la suite attend la prochaine nuit.`
      : `Tournée complète en ${duree} s : ${bilans.reduce((s, b) => s + b.publiees, 0)} facture(s) publiée(s) sur ${bilans.reduce((s, b) => s + b.lues, 0)} lue(s).`,
  }
  // Trace pour les journaux de la plateforme : c'est là qu'on vient voir ce que
  // la nuit a donné quand personne n'a déclenché à la main.
  console.log('[lecture-quotidienne]', JSON.stringify(bilanGlobal))
  return NextResponse.json(bilanGlobal)
}

/** Le cron de la plateforme appelle en GET. */
export async function GET(req: NextRequest) {
  return lireQuotidien(req)
}

/** Déclenchement manuel (écran d'administration) en POST. */
export async function POST(req: NextRequest) {
  return lireQuotidien(req)
}
