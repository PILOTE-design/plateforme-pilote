/**
 * LE PONT entre la valorisation carcasse et la mercuriale.
 *
 * Un morceau de découpe est un ingrédient comme un autre : il a juste une autre
 * PROVENANCE qu'une facture fournisseur. Ce module fabrique cette provenance —
 * il lit la dernière découpe de chaque espèce, répartit son coût avec le moteur
 * du lot 52, et rend un prix au kg par pièce.
 *
 * Deux partis pris, alignés sur le reste du projet :
 *
 *  · RIEN N'EST STOCKÉ. Le prix d'un morceau ne s'écrit jamais sur l'article
 *    générique : il se relit à chaque affichage, exactement comme le prix
 *    mercuriale se relit de la dernière facture. Le boucher corrige un prix de
 *    référence ou saisit une nouvelle carcasse, et toutes les fiches qui
 *    utilisent ce morceau suivent — sans qu'on ait rien à re-synchroniser.
 *
 *  · LE GÉNÉRIQUE, LUI, EST BIEN CRÉÉ. C'est un objet de nomenclature, pas une
 *    donnée dérivée : le boucher doit pouvoir le chercher, le renommer, le
 *    ranger dans une famille, le poser dans une fiche. Il porte
 *    `valorisation_cut_id`, qui dit d'où viendra son prix.
 */

import type { createServiceClient } from '@/lib/supabase/server'
import { CUTS_BY_ANIMAL, ANIMAL_TYPES, repartitionCarcasse, type AnimalType, type Cut } from '@/lib/valorisation'
import type { GenericInfo } from '@/lib/recipes'

/** Prix d'un morceau, avec sa provenance — même forme que ce que la mercuriale
 *  rend pour un prix de facture, pour que les écrans n'aient rien à distinguer. */
export type PrixMorceau = {
  /** Coût de revient au kg, HT */
  price: number
  /** Date de l'achat de la carcasse */
  date: string
  /** « Bœuf du 20/07/2026 » — ce qui répond à « d'où sort ce chiffre » */
  refName: string
  refSupplier: string | null
  /** Coût saisi à la main par le boucher plutôt que réparti */
  force: boolean
}

/** Le nom sous lequel une pièce apparaît dans la mercuriale. Le suffixe est
 *  volontaire : dans une liste où tout le reste vient d'une facture, « Paleron »
 *  seul laisserait croire à un article acheté. */
export const nomGeneriqueMorceau = (cut: Cut) => `${cut.name} — découpe`

const JOUR_FR = (d: string) => {
  const t = String(d || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const [a, m, j] = t.split('-')
  return `${j}/${m}/${a}`
}

const ESPECE_FR: Record<AnimalType, string> = {
  boeuf: 'Bœuf', veau: 'Veau', agneau: 'Agneau', porc: 'Porc', volaille: 'Volaille',
}

type Row = Record<string, unknown>

/**
 * Coût au kg de chaque morceau, pour un client, d'après sa DERNIÈRE découpe de
 * chaque espèce.
 *
 * Pourquoi la dernière et pas une moyenne : c'est la règle déjà en vigueur pour
 * la mercuriale (le prix d'un générique est celui de la facture la plus
 * récente). Deux règles de prix différentes dans le même tableau seraient
 * impossibles à expliquer au boucher.
 *
 * `profileIdFallback` couvre les valorisations enregistrées avant que la
 * colonne `client_id` existe et dont le rattachement n'aurait pas été repris.
 */
export async function coutsMorceauxDuClient(
  service: ReturnType<typeof createServiceClient>,
  clientId: string,
  profileIdFallback?: string | null,
): Promise<Map<string, PrixMorceau>> {
  const out = new Map<string, PrixMorceau>()

  const { data, error } = await service
    .from('valorisations')
    .select('id, client_id, profile_id, animal_type, purchase_date, total_cost, cut_weights')
    .eq('client_id', clientId)
    .order('purchase_date', { ascending: false })
  let lignes = (data as Row[] | null) ?? []
  if (error) {
    console.error('[valorisation-source] lecture impossible:', error.message)
    return out
  }
  if (lignes.length === 0 && profileIdFallback) {
    const { data: repli } = await service
      .from('valorisations')
      .select('id, client_id, profile_id, animal_type, purchase_date, total_cost, cut_weights')
      .eq('profile_id', profileIdFallback)
      .order('purchase_date', { ascending: false })
    lignes = (repli as Row[] | null) ?? []
  }
  if (lignes.length === 0) return out

  // Les prix de référence et les coûts forcés du boucher — une ligne par
  // profil, structurée { espèce: { pièce: valeur } }.
  const profil = profileIdFallback || String(lignes[0].profile_id || '')
  let prixRefParEspece: Record<string, Record<string, number | string>> = {}
  let coutsForcesParEspece: Record<string, Record<string, number | string>> = {}
  if (profil) {
    const { data: pref } = await service
      .from('valorisation_prices').select('prices, cost_overrides').eq('profile_id', profil).maybeSingle()
    const p = pref as Row | null
    if (p) {
      prixRefParEspece = (p.prices as typeof prixRefParEspece) || {}
      coutsForcesParEspece = (p.cost_overrides as typeof coutsForcesParEspece) || {}
    }
  }

  // Une seule découpe par espèce : la plus récente. Les lignes arrivent triées
  // par date décroissante, la première rencontrée est donc la bonne.
  const vue = new Set<string>()
  for (const v of lignes) {
    const espece = String(v.animal_type || '') as AnimalType
    if (!ANIMAL_TYPES.includes(espece) || vue.has(espece)) continue
    vue.add(espece)

    const repartition = repartitionCarcasse({
      cuts: CUTS_BY_ANIMAL[espece],
      poids: (v.cut_weights as Record<string, number> | null) ?? null,
      coutTotalHT: Number(v.total_cost) || 0,
      prixRef: prixRefParEspece[espece] ?? null,
      coutsForces: coutsForcesParEspece[espece] ?? null,
    })
    const date = String(v.purchase_date || '').slice(0, 10)
    for (const m of repartition.morceaux) {
      // Un morceau sans coût (déchets, ou carcasse sans prix de référence) n'a
      // rien à donner : on ne pose pas un zéro qui se lirait « gratuit ».
      if (m.cout_kg_ht === null || m.cout_kg_ht <= 0) continue
      out.set(m.cut_id, {
        price: m.cout_kg_ht,
        date,
        refName: `${ESPECE_FR[espece]} du ${JOUR_FR(date)}`,
        refSupplier: null,
        force: m.force,
      })
    }
  }
  return out
}

/**
 * Pose les prix de découpe sur la carte des génériques, APRÈS `buildGenericMap`.
 *
 * Volontairement ici et non dans `lib/recipes` : le moteur des fiches n'a pas à
 * connaître la valorisation, et une troisième source de prix greffée dans
 * `buildGenericMap` aurait obligé chacun de ses appelants à changer. Un
 * générique de découpe n'a de toute façon jamais de réf fournisseur — il n'y a
 * donc rien à arbitrer : ce qui vient de la carcasse écrase.
 *
 * `generics` doit avoir été lu AVEC la colonne `valorisation_cut_id`. Sans
 * elle, la fonction ne fait simplement rien — pas d'erreur, pas de prix inventé.
 */
export function appliquerCoutsDecoupe(
  map: Map<string, GenericInfo>,
  generics: Array<Record<string, unknown>>,
  couts: Map<string, PrixMorceau>,
): void {
  if (couts.size === 0) return
  for (const g of generics) {
    const cutId = g.valorisation_cut_id
    if (typeof cutId !== 'string' || !cutId) continue
    const prix = couts.get(cutId)
    const info = map.get(String(g.id))
    if (!prix || !info) continue
    info.price_ht = prix.price
    info.price_date = prix.date
    info.ref_name = prix.refName
    info.ref_supplier = prix.refSupplier
  }
}

/**
 * Crée les articles génériques manquants pour les morceaux effectivement
 * découpés — rattrapage PARESSEUX et IDEMPOTENT, sur le modèle de
 * `ensureAutoGenerics` de la mercuriale.
 *
 * Ne crée que les pièces qui ont un poids ET un coût : ouvrir la mercuriale sur
 * 121 lignes vides parce qu'une nomenclature existe ne rendrait service à
 * personne. Ne renomme jamais un générique existant — le boucher a le droit de
 * l'appeler comme il veut.
 *
 * Tolérant à l'échec : c'est un confort, jamais une condition pour afficher une
 * fiche. Rend le nombre de génériques créés.
 */
export async function ensureGeneriquesDecoupe(
  service: ReturnType<typeof createServiceClient>,
  clientId: string,
  couts: Map<string, PrixMorceau>,
): Promise<number> {
  if (couts.size === 0) return 0

  const { data: existants, error } = await service
    .from('generic_articles')
    .select('id, valorisation_cut_id')
    .eq('client_id', clientId)
    .not('valorisation_cut_id', 'is', null)
  if (error) {
    console.error('[valorisation-source] génériques illisibles:', error.message)
    return 0
  }
  const deja = new Set(((existants as Row[] | null) ?? []).map(r => String(r.valorisation_cut_id)))

  const aCreer: Row[] = []
  for (const t of ANIMAL_TYPES) {
    for (const cut of CUTS_BY_ANIMAL[t]) {
      if (!couts.has(cut.id) || deja.has(cut.id)) continue
      deja.add(cut.id)
      const nom = nomGeneriqueMorceau(cut)
      aCreer.push({
        client_id: clientId,
        name: nom,
        name_key: nom.toLowerCase(),
        // La découpe se compte au kilo, toujours — c'est l'unité des poids
        // saisis sur la carcasse comme celle du coût réparti.
        base_unit: 'kg',
        category: 'ingredient',
        default_loss_pct: 0,
        active: true,
        auto_created: true,
        valorisation_cut_id: cut.id,
      })
    }
  }
  if (aCreer.length === 0) return 0

  const { error: insErr } = await service.from('generic_articles').insert(aCreer)
  if (insErr) {
    console.error('[valorisation-source] création des génériques de découpe impossible:', insErr.message)
    return 0
  }
  return aCreer.length
}
