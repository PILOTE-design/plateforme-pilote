// lib/billing-providers/enrich.ts — enrichissement post-upsert des factures importées.
//
// L'upsert de la sync IGNORE les doublons (le tri manuel du boucher prime sur le
// connecteur) : les données nouvelles — échéance de paiement, statut, id externe,
// PDF — sont donc posées ici par des updates ciblés qui ne touchent QUE ces
// colonnes, jamais la catégorie ni les montants.
//
// Le PDF Pennylane (public_file_url) expire en 30 minutes : il est téléchargé
// PENDANT la sync vers le bucket privé invoice-files, une seule fois par facture
// (garde file_path). Le statut de paiement, lui, est rafraîchi à chaque sync —
// une facture impayée finit payée, et la trésorerie voudra le savoir.
import type { ProviderInvoice } from './types'
import type { createServiceClient } from '@/lib/supabase/server'

type Service = ReturnType<typeof createServiceClient>

/**
 * LE PRÉ-FILTRE D'IDEMPOTENCE — un document Pennylane ne s'importe qu'UNE fois.
 *
 * L'upsert des trois voies (sync, sync de nuit, rattrapage) se fait sur
 * (client, numéro, date). Si Pennylane corrige le numéro ou la date d'une
 * facture déjà importée — relecture OCR de leur côté —, elle revient sous une
 * autre clé et se réinsérait : le montant comptait DEUX fois dans les achats,
 * la marge et le résultat de la semaine. L'`external_id`, lui, ne change
 * jamais : c'est lui qui décide. (Lot 130 ; l'index unique
 * `invoices_client_external_uq` verrouille la même règle côté base.)
 *
 * Une facture sans external_id passe — on ne peut rien recouper, et écarter à
 * l'aveugle serait pire que le risque couvert.
 */
export async function sansDejaImportees(
  service: Service,
  clientId: string,
  invoices: ProviderInvoice[],
): Promise<{ aImporter: ProviderInvoice[]; dejaImportees: number }> {
  const ids = invoices.map(i => i.external_id).filter((x): x is string => !!x)
  if (ids.length === 0) return { aImporter: invoices, dejaImportees: 0 }
  const { data, error } = await service.from('invoices')
    .select('external_id')
    .eq('client_id', clientId)
    .in('external_id', ids)
  if (error) {
    // Le filtre est une protection, pas une condition : s'il ne peut pas lire,
    // l'upsert (numéro, date) et l'index unique restent les remparts.
    console.error('[sansDejaImportees] lecture impossible:', error.message)
    return { aImporter: invoices, dejaImportees: 0 }
  }
  const connus = new Set((data ?? []).map(r => String(r.external_id)))
  if (connus.size === 0) return { aImporter: invoices, dejaImportees: 0 }
  const aImporter = invoices.filter(i => !i.external_id || !connus.has(i.external_id))
  return { aImporter, dejaImportees: invoices.length - aImporter.length }
}

export async function enrichInvoicesAfterSync(
  service: Service,
  clientId: string,
  invoices: ProviderInvoice[],
): Promise<{ pdfs: number; updated: number; echecs: number; sansUrl: number }> {
  let pdfs = 0
  let echecs = 0, sansUrl = 0
  let updated = 0
  const CHUNK = 4 // téléchargements de PDF en parallèle — budget 60 s de la sync

  for (let i = 0; i < invoices.length; i += CHUNK) {
    await Promise.all(invoices.slice(i, i + CHUNK).map(async inv => {
      if (!inv.invoice_number) return
      // Ligne correspondante — même clé que l'onConflict de l'upsert
      const { data: row } = await service.from('invoices')
        .select('id, file_path, due_date, payment_status')
        .eq('client_id', clientId)
        .eq('invoice_number', inv.invoice_number)
        .eq('invoice_date', inv.invoice_date)
        .maybeSingle()
      if (!row) return

      const patch: Record<string, unknown> = {}
      if (inv.due_date && !row.due_date) patch.due_date = inv.due_date
      if (inv.payment_status && inv.payment_status !== row.payment_status) patch.payment_status = inv.payment_status
      if (inv.external_id) patch.external_id = inv.external_id

      if (!inv.file_url && !row.file_path) {
        // Pennylane n'a pas renvoyé d'URL de fichier : à compter, sinon on ne
        // sait pas distinguer « pas de PDF chez eux » d'un échec de notre côté.
        sansUrl++
      }
      if (inv.file_url && !row.file_path) {
        try {
          const res = await fetch(inv.file_url, { signal: AbortSignal.timeout(10000) })
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer())
            const path = `${clientId}/${inv.external_id || row.id}.pdf`
            const { error } = await service.storage.from('invoice-files')
              .upload(path, buf, { contentType: 'application/pdf', upsert: true })
            if (!error) { patch.file_path = path; pdfs++ }
            else { echecs++; console.error('[enrich] archivage PDF impossible', inv.invoice_number, error.message) }
          } else {
            // 403 = URL expirée (30 min chez Pennylane) : la cause la plus
            // fréquente des factures sans document, jusqu'ici totalement muette.
            echecs++
            console.error('[enrich] telechargement PDF refuse', inv.invoice_number, res.status)
          }
        } catch (e) {
          echecs++
          console.error('[enrich] telechargement PDF impossible', inv.invoice_number, e instanceof Error ? e.message : String(e))
        }
      }

      if (Object.keys(patch).length > 0) {
        const { error } = await service.from('invoices').update(patch).eq('id', row.id)
        if (!error) updated++
        // L'échec était avalé : un external_id refusé par l'index unique (deux
        // lignes pour le même document) ou un droit manquant restait invisible.
        else console.error('[enrich] update refusé', inv.invoice_number, error.message)
      }
    }))
  }
  return { pdfs, updated, echecs, sansUrl }
}
