import type { createServiceClient } from '@/lib/supabase/server'

/**
 * Mémoire de tri fournisseur → catégorie d'un client.
 *
 * Pour chaque fournisseur, retient la catégorie de sa facture la plus récente
 * (clé insensible à la casse et aux espaces). Le boucher classe « DAVID MASTER »
 * une fois : tous les imports suivants (syncs Pennylane/Sage/Cegid/EBP, email)
 * reprennent sa catégorie au lieu de celle devinée par le connecteur.
 *
 * La correspondance se fait par FAMILLE de noms : « DAVID MASTER SAS »,
 * « David Master 2 »… commencent par « DAVID MASTER » (limite de mot) →
 * ils sont classés avec lui, qu'importe ce qui est écrit après.
 *
 * Utilisée par les imports connecteurs (billing-integrations/sync et sync-all),
 * l'import email (invoices/inbound) et la règle globale (PATCH /api/invoices).
 * Le pré-remplissage du formulaire (GET /api/invoices?suppliers=1) garde sa propre
 * requête car il renvoie aussi la TVA et le nom d'origine.
 */

/** Normalise un nom fournisseur pour comparaison : casse, espaces superflus */
export function normalizeSupplierName(name: string): string {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Même famille de fournisseur : noms égaux, ou l'un est le début de l'autre
 * en s'arrêtant sur une limite de mot. « DAVID MASTER » couvre « DAVID MASTER SAS »
 * mais pas « DAVID MASTERCLASS » (pas de limite de mot après le préfixe).
 */
export function sameSupplierFamily(a: string, b: string): boolean {
  const na = normalizeSupplierName(a)
  const nb = normalizeSupplierName(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na]
  return long.startsWith(short) && !/[\p{L}\p{N}]/u.test(long.charAt(short.length))
}

export async function loadSupplierCategories(
  serviceSupabase: ReturnType<typeof createServiceClient>,
  clientId: string,
): Promise<Map<string, string>> {
  const { data } = await serviceSupabase
    .from('invoices').select('supplier_name, category, invoice_date')
    .eq('client_id', clientId).order('invoice_date', { ascending: false })
  const map = new Map<string, string>()
  for (const r of data || []) {
    const key = normalizeSupplierName(r.supplier_name)
    if (key && !map.has(key)) map.set(key, r.category as string) // trié desc → 1re occurrence = plus récente
  }
  return map
}

/**
 * Catégorie mémorisée pour un fournisseur, ou null s'il est inconnu.
 * Correspondance exacte d'abord, sinon par famille de noms — le nom connu
 * le plus long compatible l'emporte (« DAVID MASTER » avant « DAVID »).
 */
export function rememberedCategory(map: Map<string, string>, supplierName: string): string | null {
  const q = normalizeSupplierName(supplierName)
  if (!q) return null
  const exact = map.get(q)
  if (exact) return exact
  let bestKey: string | null = null
  for (const key of map.keys()) {
    if (sameSupplierFamily(key, q) && (bestKey === null || key.length > bestKey.length)) bestKey = key
  }
  return bestKey !== null ? map.get(bestKey) ?? null : null
}
