// lib/mercuriale-auto.ts — association AUTOMATIQUE des réfs « sans ressemblance ».
//
// Demande client (29/07) : inutile d'associer chaque réf à la main. Seuls les
// produits qui SE RESSEMBLENT (« FILET DE POULET LR 3,2 » / « FILET DE POULET
// ML 2,5KG ») méritent un regroupement manuel ; une réf qui ne ressemble à rien
// devient d'office son propre article générique, prix utilisable immédiatement
// dans les fiches recettes.
//
// La ressemblance se juge sur le TRONC du libellé : tokens significatifs, sans
// nombres, unités, ni codes courts (LR, ML, SV…). Deux réfs au même tronc — ou
// une réf au tronc d'un générique existant — restent en file « À rapprocher ».
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

/** Unité de base devinée depuis l'unité facturée d'une réf (repli : kg — la
 *  matière d'une boucherie se pèse). Modifiable ensuite sur le générique. */
export function guessBaseUnit(unit: string | null): 'kg' | 'piece' {
  const u = (unit || '').toLowerCase()
  if (/kg|kilo/.test(u)) return 'kg'
  if (/pi[eè]ce|pce|pcs|unit|uvc|^u$/.test(u)) return 'piece'
  return 'kg'
}

/** « FILET DE POULET » → « Filet de poulet » */
export function titleize(name: string): string {
  const t = name.trim().replace(/\s+/g, ' ')
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : t
}

/**
 * Associe d'office chaque réf « sans ressemblance » à son propre générique.
 * Une réf reste en file uniquement si : une AUTRE réf libre partage son tronc,
 * un générique existant partage son tronc (association suggérée), ou elle a été
 * dissociée volontairement (no_auto). Erreurs loguées, jamais bloquantes : la
 * réf reste alors simplement dans la file.
 */
export async function ensureAutoGenerics(service: ServiceClient, clientId: string): Promise<void> {
  const [{ data: generics, error: gErr }, { data: freeRefs, error: aErr }] = await Promise.all([
    service.from('generic_articles').select('id, name').eq('client_id', clientId).eq('active', true),
    service.from('articles').select('id, name, unit').eq('client_id', clientId).is('generic_id', null).eq('no_auto', false),
  ])
  if (gErr || aErr) { console.error('[mercuriale auto] lecture', gErr?.message || aErr?.message); return }
  if (!freeRefs || freeRefs.length === 0) return

  const genericStems = new Set((generics || []).map(g => articleStem(String(g.name))))
  const genericIdByNameKey = new Map((generics || []).map(g => [normText(String(g.name)), String(g.id)]))

  // Groupes de réfs libres par tronc : un groupe de 2+ = ressemblance = manuel.
  const byStem = new Map<string, { id: string; name: string; unit: string | null }[]>()
  for (const r of freeRefs) {
    const stem = articleStem(String(r.name))
    const arr = byStem.get(stem) || []
    arr.push({ id: String(r.id), name: String(r.name), unit: (r.unit as string | null) ?? null })
    byStem.set(stem, arr)
  }

  // Candidats à l'auto-association : seuls dans leur tronc, tronc inconnu des génériques.
  const candidates: { id: string; name: string; unit: string | null; nameKey: string }[] = []
  for (const [stem, refs] of byStem) {
    if (refs.length > 1) continue
    if (genericStems.has(stem)) continue
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
