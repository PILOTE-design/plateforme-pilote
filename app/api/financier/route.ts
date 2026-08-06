// GET /api/financier — LES RELEVÉS DE CAISSE D'UNE FENÊTRE DE DATES.
//
// Alimente le suivi quotidien du CA et, à partir de là, les ENCAISSEMENTS de
// la trésorerie. Les relevés arrivent par le canal e-mail de la boutique
// (webhook Resend → /api/invoices/inbound, qui reconnaît un relevé financier
// et l'envoie ici plutôt que dans les factures).
//
// Ce que la route ANNONCE, parce que le taire fabriquerait un chiffre faux :
//   · les journées MANQUANTES de la fenêtre — un relevé non transféré n'est
//     pas une journée à zéro, et un total sur une fenêtre trouée n'est pas un
//     total ;
//   · les relevés qui couvrent PLUSIEURS jours : leur CA est compté dans le
//     total, mais il n'est pas réparti en journées (on n'invente pas) ;
//   · les ventilations par mode de règlement non publiables, avec leur motif.
import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { lireFinanciers } from '@/lib/financier-store'
import { MODES_REGLEMENT, type CleMode } from '@/lib/financier-jour'

export const dynamic = 'force-dynamic'

/** Fenêtre par défaut : deux mois, assez pour une vue mensuelle et la
 *  comparaison avec le mois précédent, sans charger une année. */
const JOURS_DEFAUT = 60

const round2 = (n: number) => Math.round(n * 100) / 100

function isoJour(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function jourValide(s: string | null): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  return Number.isFinite(Date.parse(s + 'T00:00:00Z')) ? s : null
}

export async function GET(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Aucune boutique' }, { status: 404 })

  const params = new URL(req.url).searchParams
  const aujourdhui = new Date()
  const jusquA = jourValide(params.get('jusqu_a')) ?? isoJour(aujourdhui)
  const depuisDefaut = new Date(Date.parse(jusquA + 'T00:00:00Z') - (JOURS_DEFAUT - 1) * 86400000)
  const depuis = jourValide(params.get('depuis')) ?? isoJour(depuisDefaut)

  if (depuis > jusquA) {
    return NextResponse.json({ error: 'Fenêtre inversée : depuis est postérieur à jusqu_a' }, { status: 400 })
  }

  const { lignes, erreur } = await lireFinanciers(service, clientId, depuis, jusquA)
  if (erreur) return NextResponse.json({ error: erreur }, { status: 500 })

  // ── Totaux ──────────────────────────────────────────────────────────────
  // Le CA total additionne TOUS les relevés de la fenêtre, journaliers ou non.
  // La ventilation, elle, n'additionne que les ventilations PUBLIABLES : y
  // mêler une ventilation en quarantaine donnerait une répartition fausse.
  let caTotal = 0
  let caVentile = 0
  const parMode: Partial<Record<CleMode, number>> = {}
  const joursCouverts = new Set<string>()
  let relevesMultiJours = 0
  let sansVentilation = 0

  for (const l of lignes) {
    caTotal += Number(l.ca_ttc) || 0

    if (l.nb_jours === 1) {
      joursCouverts.add(l.date_debut)
    } else {
      relevesMultiJours++
    }

    if (l.reglements) {
      caVentile += Number(l.ca_ttc) || 0
      for (const [cle, montant] of Object.entries(l.reglements)) {
        const k = cle as CleMode
        parMode[k] = round2((parMode[k] ?? 0) + (Number(montant) || 0))
      }
    } else {
      sansVentilation++
    }
  }

  // ── Les journées manquantes ─────────────────────────────────────────────
  // Bornées à la veille : la journée en cours n'est pas « manquante », elle
  // n'est simplement pas finie.
  const veille = isoJour(new Date(Date.now() - 86400000))
  const finComptee = jusquA < veille ? jusquA : veille
  const manquantes: string[] = []
  for (let t = Date.parse(depuis + 'T00:00:00Z'); t <= Date.parse(finComptee + 'T00:00:00Z'); t += 86400000) {
    const jour = isoJour(new Date(t))
    if (!joursCouverts.has(jour)) manquantes.push(jour)
  }

  return NextResponse.json({
    fenetre: { depuis, jusqu_a: jusquA },
    lignes,
    totaux: {
      ca_ttc: round2(caTotal),
      ca_ventile: round2(caVentile),
      par_mode: parMode,
      jours_couverts: joursCouverts.size,
      releves: lignes.length,
    },
    // Tout ce qui manque ou ne peut pas être publié, nommé.
    reserves: {
      jours_manquants: manquantes,
      nb_jours_manquants: manquantes.length,
      releves_multi_jours: relevesMultiJours,
      releves_sans_ventilation: sansVentilation,
      // Une ventilation qui ne couvre pas tout le CA de la fenêtre ne doit pas
      // être lue comme une répartition du total.
      ventilation_partielle: round2(caTotal - caVentile) > 0,
    },
    modes: MODES_REGLEMENT.map(m => ({ cle: m.cle, label: m.label })),
  })
}
