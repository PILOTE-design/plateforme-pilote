import Anthropic from '@anthropic-ai/sdk'
import type { ProviderInvoice } from './types'

/**
 * Classification intelligente des charges fixes par IA (Claude Haiku).
 * Lit la liste des factures importées et décide pour chacune si c'est une charge fixe
 * (loyer, assurance, énergie, abonnements…) et sur quelle période elle court.
 * En cas d'échec ou de timeout (6 s), la détection par mots-clés déjà appliquée est conservée.
 */
export async function classifyFixedCharges(invoices: ProviderInvoice[]): Promise<ProviderInvoice[]> {
  if (!process.env.ANTHROPIC_API_KEY || invoices.length === 0) return invoices
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const list = invoices.map((inv, i) => `${i}|${inv.supplier_name}|${inv.amount_ht.toFixed(2)} EUR`).join('\n')
    const r = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `Tu classifies les factures fournisseurs d'une boucherie artisanale francaise.\n` +
          `Une CHARGE FIXE est une depense recurrente independante de l'activite : loyer, assurance, mutuelle, energie (EDF, Engie...), eau, redevances et taxes de collectivites, telecom/internet, abonnements et logiciels (Pennylane, Swile...), leasing/credit-bail, location-entretien de vetements ou linge professionnel (Initial, Elis...), maintenance recurrente, honoraires comptables, frais bancaires, cotisations.\n` +
          `N'EST PAS une charge fixe : achats de viande, volaille, charcuterie, epicerie, boissons, emballages, marchandises, carburant, outillage ou materiel ponctuel, travaux, dons.\n\n` +
          `FACTURES (index|fournisseur|montant) :\n${list}\n\n` +
          `Reponds UNIQUEMENT avec ce JSON, en listant seulement les index qui SONT des charges fixes.\n` +
          `p = duree couverte estimee en jours : 30 (mensuel, defaut), 91 (trimestriel), 182 (semestriel), 365 (annuel).\n` +
          `{"fixed":[{"i":0,"p":30},{"i":4,"p":365}]}`,
      }],
    }, { signal: AbortSignal.timeout(6000) })
    const text = r.content[0].type === 'text' ? r.content[0].text : ''
    const start = text.indexOf('{')
    const end   = text.lastIndexOf('}')
    if (start === -1 || end === -1) return invoices
    const parsed = JSON.parse(text.slice(start, end + 1)) as { fixed?: { i: number; p?: number }[] }
    const fixedMap = new Map<number, number>()
    for (const f of parsed.fixed ?? []) {
      if (typeof f.i === 'number') fixedMap.set(f.i, f.p && f.p > 0 ? f.p : 30)
    }
    return invoices.map((inv, i) => {
      if (fixedMap.has(i)) {
        const p = fixedMap.get(i)!
        return {
          ...inv,
          is_fixed_charge: true,
          period_days: p,
          prorata_ht: Math.round((inv.amount_ht * 7 / p) * 100) / 100,
        }
      }
      // L'IA ne l'a pas classée fixe : on conserve néanmoins un éventuel true issu des mots-clés (union prudente)
      return inv
    })
  } catch {
    // Timeout, clé absente ou réponse invalide : la détection par mots-clés reste en place
    return invoices
  }
}
