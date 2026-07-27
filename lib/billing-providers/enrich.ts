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

export async function enrichInvoicesAfterSync(
  service: Service,
  clientId: string,
  invoices: ProviderInvoice[],
): Promise<{ pdfs: number; updated: number }> {
  let pdfs = 0
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

      if (inv.file_url && !row.file_path) {
        try {
          const res = await fetch(inv.file_url, { signal: AbortSignal.timeout(10000) })
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer())
            const path = `${clientId}/${inv.external_id || row.id}.pdf`
            const { error } = await service.storage.from('invoice-files')
              .upload(path, buf, { contentType: 'application/pdf', upsert: true })
            if (!error) { patch.file_path = path; pdfs++ }
          }
        } catch {
          // Pas de PDF cette fois : l'extraction marquera no_file. La sync, elle,
          // n'échoue JAMAIS pour un fichier — les montants sont déjà en base.
        }
      }

      if (Object.keys(patch).length > 0) {
        const { error } = await service.from('invoices').update(patch).eq('id', row.id)
        if (!error) updated++
      }
    }))
  }
  return { pdfs, updated }
}
