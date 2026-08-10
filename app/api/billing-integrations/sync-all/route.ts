// Route appelée automatiquement par le Vercel Cron Job chaque LUNDI matin (04h UTC = 6h Paris été)
// et synchronise la SEMAINE PRÉCÉDENTE (celle qui vient de se terminer) — le gérant retrouve
// toutes les factures de la semaine écoulée en arrivant le lundi.
// ATTENTION : Vercel Cron invoque en GET — les deux méthodes sont exportées.
// Sécurisée par CRON_SECRET pour éviter les appels non autorisés
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/admins'
import { PROVIDERS } from '@/lib/billing-providers'
import { classifyFixedCharges } from '@/lib/billing-providers/classify'
import { loadSupplierCategories, rememberedCategory } from '@/lib/supplier-memory'
import { enrichInvoicesAfterSync, sansDejaImportees } from '@/lib/billing-providers/enrich'
import { weekForInvoice } from '@/lib/invoice-week'

// Le cron itère sur TOUTES les intégrations : appel du connecteur, classification
// IA, puis téléchargement des PDF quatre par quatre. Sans plafond déclaré, la
// route retombait sur le défaut de la plateforme et pouvait être tuée en cours
// de route — les factures étaient insérées, les PDF restants perdus (leur URL
// expire en 30 min), et rien ne l'indiquait puisque la mise à jour finale du
// statut n'était jamais atteinte. C'est un producteur direct de factures sans PDF.
export const maxDuration = 300

function getWeekBounds(weekNumber: number, year: number): [Date, Date] {
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const dow = jan4.getUTCDay() || 7
  const mon = new Date(jan4)
  mon.setUTCDate(jan4.getUTCDate() - dow + 1 + (weekNumber - 1) * 7)
  const sun = new Date(mon)
  sun.setUTCDate(mon.getUTCDate() + 6)
  return [mon, sun]
}

function getISOWeek(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return {
    week: Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7),
    year: d.getUTCFullYear(),
  }
}

async function runSyncAll(req: NextRequest) {
  // ── Qui appelle ? Le cron (secret de plateforme) ou un administrateur.
  // JAMAIS fail-open : si CRON_SECRET manque, la route n'est pas publique pour
  // autant — une session admin est alors EXIGÉE (même patron que
  // cron/lecture-quotidienne). L'ancienne garde `if (cronSecret && ...)`
  // rendait la tournée service-role appelable par n'importe qui dès que la
  // variable disparaissait de Vercel.
  const cronSecret = process.env.CRON_SECRET
  const estMachine = !!cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`
  if (!estMachine) {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    if (!isAdminEmail(user.email)) return NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 })
  }

  const service = createServiceClient()

  // SEMAINE PRÉCÉDENTE : le cron tourne le lundi matin, on synchronise la semaine qui vient de se terminer
  const ref = new Date()
  ref.setUTCDate(ref.getUTCDate() - 7)
  const { week, year } = getISOWeek(ref)
  const [from, to] = getWeekBounds(week, year)

  const { data: integrations, error: fetchError } = await service
    .from('billing_integrations')
    .select('*')
    .eq('is_active', true)

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  if (!integrations?.length) {
    return NextResponse.json({ success: true, synced: 0, message: 'Aucune intégration active' })
  }

  let totalImported = 0
  const results: Record<string, any> = {}

  // Mémoire de tri fournisseur → catégorie, chargée au plus une fois par client :
  // la catégorie choisie par le boucher l'emporte sur celle devinée par le connecteur.
  const memoryByClient = new Map<string, Map<string, string>>()

  for (const integ of integrations) {
    const prov = PROVIDERS[integ.provider]
    if (!prov) continue

    const syncResult = await prov.fetchWeekInvoices(integ.api_token, from, to, integ.company_id)

    let syncError: string | null = syncResult.error ?? null
    let pdfInfo: string | null = null
    let imported = 0

    if (syncResult.success && syncResult.invoices.length > 0) {
      // Un document Pennylane déjà importé ne repasse pas, même si son numéro
      // a changé chez eux : l'external_id décide (lot 130).
      const filtre = await sansDejaImportees(service, integ.client_id, syncResult.invoices)
      // Classification IA des charges fixes (fallback : détection mots-clés déjà appliquée)
      const enriched = await classifyFixedCharges(filtre.aImporter)

      let supplierMemory = memoryByClient.get(integ.client_id)
      if (!supplierMemory) {
        supplierMemory = await loadSupplierCategories(service, integ.client_id)
        memoryByClient.set(integ.client_id, supplierMemory)
      }
      const memory = supplierMemory

      const rows = enriched.map(inv => {
        // Semaine d'imputation PAR FACTURE, dérivée de sa propre date (et non de
        // la fenêtre de synchro appliquée en bloc). Repli sur la fenêtre si la
        // facture n'a pas de date exploitable.
        const wk = weekForInvoice(null, inv.invoice_date) ?? { week, year }
        return {
        client_id:      integ.client_id,
        supplier_name:  inv.supplier_name,
        invoice_number: inv.invoice_number ?? null,
        invoice_date:   inv.invoice_date,
        category:       rememberedCategory(memory, inv.supplier_name) ?? inv.category ?? 'autre',
        amount_ht:      inv.amount_ht,
        tva_rate:       inv.tva_rate,
        amount_ttc:     inv.amount_ttc,
        week_number:    wk.week,
        year:           wk.year,
        // Toujours importée « à vérifier » : ne compte dans la marge qu'après
        // validation humaine. Explicite, sans dépendre du défaut de colonne.
        status:         'a_verifier',
        is_fixed_charge: inv.is_fixed_charge ?? false,
        period_days:     inv.period_days ?? null,
        prorata_ht:      inv.prorata_ht ?? null,
        period_source:   inv.period_source ?? null,
        notes:          `Importé depuis ${prov.name}`,
        }
      })

      const { error: upsertError } = await service.from('invoices').upsert(rows, {
        onConflict: 'client_id,invoice_number,invoice_date',
        ignoreDuplicates: true,
      })

      if (upsertError) {
        syncError = `Upsert invoices a échoué: ${upsertError.message}`
      } else {
        imported = rows.length
        totalImported += imported
        // Échéance, statut de paiement, PDF stocké — mêmes updates ciblés que la
        // sync manuelle (cf. lib/billing-providers/enrich). Non bloquant.
        try {
          // Le bilan était calculé puis jeté : sur le cron, personne ne voyait
          // que des PDF manquaient à l'appel. Il est désormais consigné.
          // TOUTES les factures du connecteur — les déjà-importées incluses,
          // pour que leur statut de paiement continue de se rafraîchir.
          const bilan = await enrichInvoicesAfterSync(service, integ.client_id, syncResult.invoices)
          if (bilan) {
            const manquants = (bilan.echecs ?? 0) + (bilan.sansUrl ?? 0)
            pdfInfo = `${bilan.pdfs} PDF archivé${bilan.pdfs > 1 ? 's' : ''}`
              + (manquants > 0 ? ` · ${manquants} manquant${manquants > 1 ? 's' : ''}` : '')
          }
        } catch (e) { console.error('Enrichissement factures:', e) }
      }
    }

    // Les relevés écartés (cf. lib/document-releve) : consignés comme sur la
    // sync manuelle. La lecture de nuit n'a personne devant elle — raison de
    // plus pour que la trace reste.
    const rejets = syncResult.rejets ?? []
    const rejetInfo = rejets.length > 0
      ? `${rejets.length} relevé${rejets.length > 1 ? 's' : ''} écarté${rejets.length > 1 ? 's' : ''} (non importé${rejets.length > 1 ? 's' : ''}) : `
        + rejets.slice(0, 3).map(r => r.supplier_name).join(', ')
        + (rejets.length > 3 ? `, et ${rejets.length - 3} autre${rejets.length - 3 > 1 ? 's' : ''}` : '')
      : null

    const ok = syncResult.success && !syncError

    await service.from('billing_integrations').update({
      last_sync_at:     new Date().toISOString(),
      last_sync_status: ok ? 'success' : 'error',
      last_sync_error:  syncError ?? [pdfInfo, rejetInfo].filter(Boolean).join(' · ') ?? null,
      invoices_synced:  imported,
    }).eq('id', integ.id)

    results[`${integ.client_id}:${integ.provider}`] = {
      success:  ok,
      imported,
      rejets:   rejets.length,
      error:    syncError,
    }
  }

  console.log(`[CRON] Sync lundi — semaine écoulée S${week}/${year} — ${integrations.length} intégration(s), ${totalImported} facture(s) importée(s)`)

  return NextResponse.json({
    success: true,
    week,
    year,
    integrations: integrations.length,
    totalImported,
    results,
  })
}

// Vercel Cron → GET
export async function GET(req: NextRequest) {
  return runSyncAll(req)
}

// Appels manuels / outils → POST
export async function POST(req: NextRequest) {
  return runSyncAll(req)
}
