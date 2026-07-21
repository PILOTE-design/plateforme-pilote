import type { createServiceClient } from '@/lib/supabase/server'

/**
 * Mémoire de tri fournisseur → catégorie d'un client.
 *
 * Pour chaque fournisseur, retient la catégorie de sa facture la plus récente
 * (clé insensible à la casse et aux espaces). Le boucher classe « DAVID MASTER »
 * une fois : tous les imports suivants (syncs Pennylane/Sage/Cegid/EBP, email)
 * reprennent sa catégorie au lieu de celle devinée par le connecteur.
 *
 * Utilisée par les imports connecteurs (billing-integrations/sync et sync-all).
 * Le pré-remplissage du formulaire (GET /api/invoices?suppliers=1) garde sa propre
 * requête car il renvoie aussi la TVA et le nom d'origine.
 */
export async function loadSupplierCategories(
  serviceSupabase: ReturnType<typeof createServiceClient>,
  clientId: string,
): Promise<Map<string, string>> {
  const { data } = await serviceSupabase
    .from('invoices').select('supplier_name, category, invoice_date')
    .eq('client_id', clientId).order('invoice_date', { ascending: false })
  const map = new Map<string, string>()
  for (const r of data || []) {
    const key = String(r.supplier_name || '').trim().toLowerCase()
    if (key && !map.has(key)) map.set(key, r.category as string) // trié desc → 1re occurrence = plus récente
  }
  return map
}

/** Catégorie mémorisée pour un fournisseur, ou null s'il est inconnu */
export function rememberedCategory(map: Map<string, string>, supplierName: string): string | null {
  return map.get(String(supplierName || '').trim().toLowerCase()) ?? null
}
