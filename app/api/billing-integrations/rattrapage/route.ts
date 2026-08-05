// Rattrapage initial des factures — les 2 derniers mois, en UN appel, UNE FOIS.
//
// La synchro ordinaire (`/api/billing-integrations/sync`) travaille semaine par
// semaine : c'est le bon grain pour le fonctionnement courant, mais à la mise en
// service d'une boucherie, il fallait la déclencher neuf fois à la main pour
// remonter deux mois. La mercuriale et les fiches recettes partent alors d'un
// catalogue vide, et le produit ne montre rien pendant des semaines.
//
// POURQUOI UNE SEULE FOIS. Chaque appel consomme du quota chez Pennylane, et
// rejouer n'apporte rien : l'upsert ignore déjà les doublons. Le verrou est une
// DATE et non un booléen — « fait le 4 août à 14 h 12 » s'affiche et s'explique,
// là où un drapeau laisse le boucher sans réponse quand le bouton a disparu.
//
// POURQUOI PENNYLANE SEULEMENT. Le canal e-mail n'a rien à rattraper : les
// factures reçues avant la mise en service n'ont jamais été transférées à
// PILOTE, il n'existe aucun historique à interroger côté serveur. Un bouton qui
// ne ramènerait jamais rien serait pire que pas de bouton — la page de
// facturation affiche à la place la consigne de transfert.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { PROVIDERS } from '@/lib/billing-providers'
import { classifyFixedCharges } from '@/lib/billing-providers/classify'
import { loadSupplierCategories, rememberedCategory } from '@/lib/supplier-memory'
import { enrichInvoicesAfterSync } from '@/lib/billing-providers/enrich'
import { weekForInvoice } from '@/lib/invoice-week'

export const maxDuration = 60

/** Deux mois glissants. 62 jours plutôt que 60 : deux mois pleins quelle que
 *  soit la longueur des mois traversés, sans jamais tomber court. */
const JOURS = 62

/** Plafond d'un appel Pennylane. Le connecteur ne remonte pas le nombre BRUT de
 *  factures avant filtrage : on ne peut donc pas savoir avec certitude qu'il en
 *  restait. Atteindre le plafond est le seul signal disponible — on l'annonce
 *  comme tel (« il en reste peut-être »), sans affirmer plus que ce qu'on sait. */
const PLAFOND_APPEL = 100

const isoWeek = (date: Date) => {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return {
    week: Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7),
    year: d.getUTCFullYear(),
  }
}

export async function POST(_req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const { data: integrations } = await service.from('billing_integrations')
    .select('*')
    .eq('client_id', clientId)
    .eq('provider', 'pennylane')
    .eq('is_active', true)

  const integ = (integrations ?? [])[0] as Record<string, unknown> | undefined
  if (!integ) {
    return NextResponse.json({
      error: 'Aucune connexion Pennylane active',
      detail: 'Le rattrapage lit l’historique de Pennylane. Sans cette connexion, les anciennes factures doivent être transférées à votre adresse PILOTE.',
    }, { status: 404 })
  }

  // LE VERROU. Vérifié côté serveur et pas seulement dans l'écran : un bouton
  // caché n'est pas une garantie.
  if (integ.backfill_at) {
    return NextResponse.json({
      error: 'Rattrapage déjà effectué',
      backfill_at: integ.backfill_at,
      backfill_imported: integ.backfill_imported ?? null,
    }, { status: 409 })
  }

  const prov = PROVIDERS[String(integ.provider)]
  if (!prov) return NextResponse.json({ error: 'Connecteur inconnu' }, { status: 500 })

  const to = new Date()
  const from = new Date(to.getTime() - JOURS * 86400000)

  const syncResult = await prov.fetchWeekInvoices(
    String(integ.api_token), from, to, integ.company_id as string | undefined,
  )

  if (!syncResult.success) {
    // ÉCHEC : le verrou n'est PAS posé. Une panne réseau ne doit pas coûter au
    // boucher son unique rattrapage.
    return NextResponse.json({
      error: syncResult.error || 'Pennylane n’a pas répondu',
      detail: 'Rien n’a été importé et votre rattrapage reste disponible.',
    }, { status: 502 })
  }

  const brutes = syncResult.invoices
  const tronque = brutes.length >= PLAFOND_APPEL

  let imported = 0
  let pdfInfo: string | null = null

  if (brutes.length > 0) {
    const supplierMemory = await loadSupplierCategories(service, clientId)
    const enriched = await classifyFixedCharges(brutes)

    const rows = enriched.map(inv => {
      // Semaine d'imputation PAR FACTURE, dérivée de sa propre date — jamais de
      // la fenêtre du rattrapage, qui couvre deux mois. Sans ça, deux mois de
      // factures atterriraient tous dans la semaine courante et fausseraient
      // chaque marge hebdomadaire de la période.
      const wk = weekForInvoice(null, inv.invoice_date) ?? isoWeek(new Date(inv.invoice_date || Date.now()))
      return {
        client_id: clientId,
        supplier_name: inv.supplier_name,
        invoice_number: inv.invoice_number ?? null,
        invoice_date: inv.invoice_date,
        category: rememberedCategory(supplierMemory, inv.supplier_name) ?? inv.category ?? 'autre',
        amount_ht: inv.amount_ht,
        tva_rate: inv.tva_rate,
        amount_ttc: inv.amount_ttc,
        week_number: wk.week,
        year: wk.year,
        // Même porte de validation que partout : rien ne compte dans une marge
        // avant relecture humaine. Un rattrapage de deux mois qui entrerait
        // directement dans les chiffres serait un cadeau empoisonné.
        status: 'a_verifier',
        is_fixed_charge: inv.is_fixed_charge ?? false,
        period_days: inv.period_days ?? null,
        prorata_ht: inv.prorata_ht ?? null,
        period_source: inv.period_source ?? null,
        notes: `Rattrapage ${prov.name} — 2 derniers mois${inv.external_id ? ` (${inv.external_id})` : ''}`,
      }
    })

    const { error: upsertError } = await service.from('invoices').upsert(rows, {
      onConflict: 'client_id,invoice_number,invoice_date',
      ignoreDuplicates: true,
    })
    if (upsertError) {
      return NextResponse.json({
        error: `Enregistrement impossible : ${upsertError.message}`,
        detail: 'Votre rattrapage reste disponible.',
      }, { status: 500 })
    }
    imported = rows.length

    // PDF et échéances : confort, jamais bloquant — les montants sont déjà en
    // base. Sur deux mois, c'est aussi l'étape la plus susceptible de frôler la
    // fenêtre de 60 s ; son échec ne doit rien remettre en cause.
    try {
      const bilan = await enrichInvoicesAfterSync(service, clientId, enriched)
      if (bilan) {
        const manquants = (bilan.echecs ?? 0) + (bilan.sansUrl ?? 0)
        pdfInfo = `${bilan.pdfs} PDF archivé${bilan.pdfs > 1 ? 's' : ''}`
          + (manquants > 0 ? ` · ${manquants} sans PDF` : '')
      }
    } catch (e) {
      console.error('[rattrapage] enrichissement:', e)
      pdfInfo = 'PDF non récupérés — la lecture des lignes se fera à la prochaine synchro'
    }
  }

  // Le verrou n'est posé qu'ICI : après un appel réussi et un enregistrement
  // réussi. Tout chemin d'échec plus haut rend la main sans le consommer.
  const { error: verrouErr } = await service.from('billing_integrations').update({
    backfill_at: new Date().toISOString(),
    backfill_imported: imported,
    backfill_tronque: tronque,
    updated_at: new Date().toISOString(),
  }).eq('id', integ.id as string)
  if (verrouErr) console.error('[rattrapage] verrou non posé:', verrouErr.message)

  return NextResponse.json({
    success: true,
    imported,
    tronque,
    pdf: pdfInfo,
    depuis: from.toISOString().slice(0, 10),
    jusqu_a: to.toISOString().slice(0, 10),
  })
}
