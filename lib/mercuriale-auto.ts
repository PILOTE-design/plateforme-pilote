// lib/mercuriale-auto.ts — association AUTOMATIQUE des réfs « sans ressemblance ».
//
// Demande client (29/07) : inutile d'associer chaque réf à la main. Seuls les
// produits qui SE RESSEMBLENT (« FILET DE POULET LR 3,2 » / « FILET DE POULET
// ML 2,5KG ») méritent un regroupement manuel ; une réf qui ne ressemble à rien
// devient d'office son propre article générique, prix utilisable immédiatement
// dans les fiches recettes.
//
// La ressemblance se juge sur la CLÉ DE RAPPROCHEMENT : les deux premiers mots
// significatifs du libellé (sans nombres, unités, ni codes courts LR/ML/SV…).
// Deux réfs à la même clé — ou une réf à la clé d'un générique existant —
// restent en file « À rapprocher ». Les lignes NON-PRODUIT (taxes, remises,
// licences, entretien…) ne sont jamais associées d'office non plus.
//
// `ensureAutoGenerics` est appelée en tête de GET /api/mercuriale (rattrapage
// paresseux, comme ensureMarginFamilies) : idempotente, silencieuse quand il
// n'y a rien à faire. Les réfs volontairement dissociées (articles.no_auto)
// ne sont JAMAIS réassociées automatiquement.

import { normText } from '@/lib/postes'
import type { createServiceClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceClient>

const STOPWORDS = new Set(['de', 'du', 'des', 'le', 'la', 'les', 'au', 'aux', 'en', 'et', 'sous', 'sans', 'avec', 'pour', 'par'])
const UNIT_WORDS = new Set([
  'kg', 'kgs', 'kilo', 'kilos', 'gr', 'grs', 'mg', 'cl', 'ml', 'litre', 'litres',
  'pce', 'pcs', 'piece', 'pieces', 'unite', 'unites', 'uvc', 'lot', 'lots',
  'colis', 'carton', 'cartons', 'sac', 'sacs', 'sachet', 'sachets', 'caisse',
  'barquette', 'barquettes', 'boite', 'boites', 'bte', 'rouleau', 'rouleaux',
  'env', 'environ', 'vrac', 'vide', 'frais', 'surgele', 'surgeles',
])

/** Tronc « produit » d'un libellé : tokens significatifs (≥ 3 lettres), sans
 *  nombres, unités, formats ni mots-outils — « FILET DE POULET LR 3,2 » et
 *  « FILET DE POULET ML 2,5KG » donnent tous deux « filet poulet ». Un tronc
 *  vide retombe sur le libellé normalisé complet (aucun regroupement hasardeux). */
export function articleStem(name: string): string {
  const tokens = normText(name)
    .split(' ')
    .filter(t => t.length > 2 && !/\d/.test(t) && !STOPWORDS.has(t) && !UNIT_WORDS.has(t))
  return tokens.join(' ') || normText(name)
}

/** CLÉ DE RAPPROCHEMENT : les deux premiers mots significatifs du tronc.
 *  Vérifié sur les réfs réelles : « FILET DE POULET GASTRON », « FILET DE
 *  POULET REGION » et « FILET DE POULET S/ATMO » ont des troncs différents mais
 *  la même clé « filet poulet » — c'est bien le même produit à rapprocher.
 *  Deux mots (pas un) : « tomate cerise » et « tomate grappe » restent séparés. */
export function stemKey(name: string): string {
  return articleStem(name).split(' ').slice(0, 2).join(' ')
}

// Mots qui trahissent une ligne NON-PRODUIT (taxes, remises, frais, licences,
// entretien…) arrivée dans les articles malgré la reconnaissance de nature.
// Jugés sur les TOKENS du tronc (égalité stricte, jamais de sous-chaîne :
// « porto » ne déclenche pas « port »). Ces lignes ne sont JAMAIS associées
// automatiquement — elles restent en bas de file, repliées, associables à la main.
const NON_PRODUCT_WORDS = new Set([
  'taxe', 'taxes', 'remise', 'remises', 'ristourne', 'avoir', 'acompte',
  'forfait', 'frais', 'port', 'transport', 'consigne', 'cotisation',
  'interbev', 'inaporc', 'licence', 'licences', 'location', 'abonnement',
  'intranet', 'application', 'logiciel', 'portefeuille', 'subvention',
  'subventions', 'participation', 'degraissant', 'desinfectant', 'detergent',
  'lavage', 'nettoyant', 'plonge',
])

/** Ligne non-produit ? (taxe, remise, licence, produit d'entretien…) */
export function isNonProduct(name: string): boolean {
  return articleStem(name).split(' ').some(t => NON_PRODUCT_WORDS.has(t))
}

const KG_UNITS = new Set(['kg', 'kgs', 'kilo', 'kilos'])
// Une unité d'achat « contenant » (colis, bidon, barquette…) se compte comme une
// PIÈCE : le prix facturé est par contenant, jamais par kg.
const PIECE_UNITS = new Set([
  'piece', 'pieces', 'pi', 'pce', 'pcs', 'unite', 'unites', 'u', 'uvc',
  'col', 'colis', 'carton', 'cartons', 'boite', 'boites', 'bte',
  'bqt', 'barquette', 'barquettes', 'bidon', 'bidons', 'sac', 'sacs',
  'sachet', 'sachets', 'seau', 'seaux', 'pot', 'pots', 'rouleau', 'rouleaux',
  'fut', 'futs', 'caisse', 'caisses', 'brique', 'briques', 'bouteille',
  'bouteilles', 'l', 'litre', 'litres', 'lot', 'lots',
])

/** Nature de l'unité facturée d'une réf : kg, pièce/contenant, ou null si
 *  illisible (champ vide, valeur parasite) — null = on ne juge pas. */
export function unitKind(unit: string | null | undefined): 'kg' | 'piece' | null {
  const u = normText(unit ?? '')
  if (!u) return null
  if (KG_UNITS.has(u)) return 'kg'
  if (PIECE_UNITS.has(u)) return 'piece'
  return null
}

/** Unité de base devinée depuis l'unité facturée d'une réf (repli : kg — la
 *  matière d'une boucherie se pèse). Modifiable ensuite sur le générique. */
export function guessBaseUnit(unit: string | null): 'kg' | 'piece' {
  return unitKind(unit) ?? 'kg'
}

/** « FILET DE POULET » → « Filet de poulet » */
export function titleize(name: string): string {
  const t = name.trim().replace(/\s+/g, ' ')
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : t
}

/**
 * Associe d'office chaque réf « sans ressemblance » à son propre générique.
 * Une réf reste en file uniquement si : une AUTRE réf libre partage sa clé de
 * rapprochement (deux premiers mots significatifs), un générique existant la
 * partage (association suggérée), la ligne est non-produit (taxe, remise…), ou
 * elle a été dissociée volontairement (no_auto). Erreurs loguées, jamais
 * bloquantes : la réf reste alors simplement dans la file.
 */
export async function ensureAutoGenerics(service: ServiceClient, clientId: string): Promise<void> {
  const [{ data: generics, error: gErr }, { data: freeRefs, error: aErr }] = await Promise.all([
    service.from('generic_articles').select('id, name').eq('client_id', clientId).eq('active', true),
    service.from('articles').select('id, name, unit').eq('client_id', clientId).is('generic_id', null).eq('no_auto', false).eq('ignored', false),
  ])
  if (gErr || aErr) { console.error('[mercuriale auto] lecture', gErr?.message || aErr?.message); return }
  if (!freeRefs || freeRefs.length === 0) return

  const genericKeys = new Set((generics || []).map(g => stemKey(String(g.name))))
  const genericIdByNameKey = new Map((generics || []).map(g => [normText(String(g.name)), String(g.id)]))

  // Groupes de réfs libres par clé de rapprochement : 2+ = ressemblance = manuel.
  const byKey = new Map<string, { id: string; name: string; unit: string | null }[]>()
  for (const r of freeRefs) {
    if (isNonProduct(String(r.name))) continue
    const key = stemKey(String(r.name))
    const arr = byKey.get(key) || []
    arr.push({ id: String(r.id), name: String(r.name), unit: (r.unit as string | null) ?? null })
    byKey.set(key, arr)
  }

  // Candidats à l'auto-association : seuls sur leur clé, clé inconnue des génériques.
  const candidates: { id: string; name: string; unit: string | null; nameKey: string }[] = []
  for (const [key, refs] of byKey) {
    if (refs.length > 1) continue
    if (genericKeys.has(key)) continue
    const ref = refs[0]
    candidates.push({ ...ref, nameKey: normText(ref.name) })
  }
  if (candidates.length === 0) return

  // Un candidat dont le NOM exact est déjà un générique actif s'y associe
  // directement (pas de doublon) ; les autres reçoivent un générique neuf.
  const toCreate = candidates.filter(c => !genericIdByNameKey.has(c.nameKey))
  if (toCreate.length > 0) {
    const { data: created, error: insErr } = await service.from('generic_articles')
      .insert(toCreate.map(c => ({
        client_id: clientId,
        name: titleize(c.name),
        name_key: c.nameKey,
        base_unit: guessBaseUnit(c.unit),
        category: 'ingredient',
        default_loss_pct: 0,
        auto_created: true,
      })))
      .select('id, name_key')
    if (insErr || !created) {
      // Conflit inattendu (name_key) : on ne casse pas la page — la file reste visible.
      console.error('[mercuriale auto] création génériques', insErr?.message)
      return
    }
    for (const g of created) genericIdByNameKey.set(String(g.name_key), String(g.id))
  }

  // Rattachement des réfs, par paquets (jamais de séquentiel long dans un GET).
  const CHUNK = 10
  for (let i = 0; i < candidates.length; i += CHUNK) {
    await Promise.all(candidates.slice(i, i + CHUNK).map(async c => {
      const gid = genericIdByNameKey.get(c.nameKey)
      if (!gid) return
      const { error } = await service.from('articles')
        .update({ generic_id: gid })
        .eq('id', c.id).eq('client_id', clientId)
      if (error) console.error('[mercuriale auto] association', c.name, error.message)
    }))
  }
}
