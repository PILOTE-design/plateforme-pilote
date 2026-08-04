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

/** Part MINIMALE du poids de carcasse qui doit être pesée pour qu'on accepte de
 *  répartir son coût. En dessous, la saisie est inachevée et le coût au kilo
 *  qu'on en tirerait serait faux — on préfère ne rien publier. */
export const SEUIL_COUVERTURE = 0.4

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
    .select('id, client_id, profile_id, animal_type, purchase_date, total_cost, carcass_weight, cut_weights')
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
      .select('id, client_id, profile_id, animal_type, purchase_date, total_cost, carcass_weight, cut_weights')
      .eq('profile_id', profileIdFallback)
      .order('purchase_date', { ascending: false })
    lignes = (repli as Row[] | null) ?? []
  }
  if (lignes.length === 0) return out

  // Les prix de référence et les coûts forcés du boucher — une ligne par
  // PROFIL, structurée { espèce: { pièce: valeur } }.
  //
  // C'est le profil qui a SAISI la carcasse qui fait foi, pas celui qui regarde
  // l'écran. L'inverse — prendre d'abord le compte connecté — faisait qu'un
  // deuxième login de la même boucherie, ou un administrateur en entretien,
  // lisait des prix de référence vides et surtout ignorait les COÛTS FORCÉS à
  // la main : le chiffre affiché n'était plus celui que le boucher avait posé.
  // `profileIdFallback` redevient ce que son nom dit : un repli.
  type Prefs = Record<string, Record<string, number | string>>
  const cachePrefs = new Map<string, { prix: Prefs; forces: Prefs }>()
  const prefsDuProfil = async (profil: string): Promise<{ prix: Prefs; forces: Prefs }> => {
    const vide = { prix: {} as Prefs, forces: {} as Prefs }
    if (!profil) return vide
    const enCache = cachePrefs.get(profil)
    if (enCache) return enCache
    const { data: pref } = await service
      .from('valorisation_prices').select('prices, cost_overrides').eq('profile_id', profil).maybeSingle()
    const p = pref as Row | null
    const lu = p
      ? { prix: ((p.prices as Prefs) || {}), forces: ((p.cost_overrides as Prefs) || {}) }
      : vide
    cachePrefs.set(profil, lu)
    return lu
  }

  // Une seule découpe par espèce : la plus récente. Les lignes arrivent triées
  // par date décroissante, la première rencontrée est donc la bonne.
  const vue = new Set<string>()
  for (const v of lignes) {
    const espece = String(v.animal_type || '') as AnimalType
    if (!ANIMAL_TYPES.includes(espece) || vue.has(espece)) continue
    vue.add(espece)

    // ── LA CARCASSE EST-ELLE ASSEZ PESÉE POUR QU'ON RÉPARTISSE SON COÛT ? ──
    //
    // Le coût total se répartit sur les pièces PESÉES. C'est la bonne règle
    // quand la découpe est saisie : le prix de la bête se porte sur ce qui se
    // vend, les os et les chutes n'ayant pas de coût propre. Mais si le boucher
    // n'a saisi que deux poids sur cent vingt-trois, la totalité du prix tombe
    // sur ces deux pièces — et le kilo devient onze fois trop cher.
    //
    // Mesuré en production le 04/08/2026 : une carcasse de 520 kg à 3 270 €
    // avec 46 kg pesés (9 %) publiait « Jarret avec os — découpe » à
    // 65,62 €/kg. Un jarret vaut le sixième de ça. Rien à l'écran ne le disait,
    // et ce prix serait entré tel quel dans le coût de revient d'une fiche.
    //
    // Le plancher est PONDÉRAL, pas économique : la part du poids carcasse
    // effectivement pesée. Il est posé BAS — 40 % — franchement sous tout
    // rendement commercial réel (65 à 75 % en bœuf), pour ne refuser qu'une
    // saisie manifestement inachevée et jamais une découpe honnête. Sans poids
    // de carcasse saisi, il n'y a rien à comparer : on publie, comme avant.
    const poidsCarcasse = Number(v.carcass_weight) || 0
    const poidsPeses = Object.values((v.cut_weights as Record<string, unknown> | null) ?? {})
      .reduce<number>((s, x) => { const n = Number(x); return s + (Number.isFinite(n) && n > 0 ? n : 0) }, 0)
    if (poidsCarcasse > 0 && poidsPeses < poidsCarcasse * SEUIL_COUVERTURE) {
      console.warn(`[valorisation-source] découpe ${String(v.id)} trop peu pesée `
        + `(${poidsPeses.toFixed(1)} kg sur ${poidsCarcasse.toFixed(1)} kg) : coûts non publiés`)
      continue
    }

    const prefs = await prefsDuProfil(String(v.profile_id || '') || profileIdFallback || '')
    const repartition = repartitionCarcasse({
      cuts: CUTS_BY_ANIMAL[espece],
      poids: (v.cut_weights as Record<string, number> | null) ?? null,
      coutTotalHT: Number(v.total_cost) || 0,
      prixRef: prefs.prix[espece] ?? null,
      coutsForces: prefs.forces[espece] ?? null,
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
 * Appelé depuis DEUX endroits, et c'est voulu : à l'enregistrement d'une
 * carcasse — le geste qui crée les morceaux — et à l'ouverture des fiches
 * recettes, qui rattrape les découpes antérieures. Le seul déclencheur d'avant
 * — cette liste — laissait une boucherie avec 43 pièces pesées et aucun morceau
 * dans son catalogue, mesuré le 04/08/2026.
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

  // TOUS les génériques actifs, pas seulement ceux de découpe : la base porte un
  // index unique sur (client_id, name_key), et un morceau qui porterait le nom
  // d'un article déjà au catalogue le heurterait.
  const { data: existants, error } = await service
    .from('generic_articles')
    .select('id, valorisation_cut_id, name_key')
    .eq('client_id', clientId)
    .eq('active', true)
  if (error) {
    console.error('[valorisation-source] génériques illisibles:', error.message)
    return 0
  }
  const lignes = (existants as Row[] | null) ?? []
  const deja = new Set(lignes.filter(r => r.valorisation_cut_id).map(r => String(r.valorisation_cut_id)))
  const clesPrises = new Set(lignes.map(r => String(r.name_key ?? '')))

  const aCreer: Row[] = []
  for (const t of ANIMAL_TYPES) {
    for (const cut of CUTS_BY_ANIMAL[t]) {
      if (!couts.has(cut.id) || deja.has(cut.id)) continue
      deja.add(cut.id)
      const nom = nomLibre(cut, t, clesPrises)
      clesPrises.add(nom.toLowerCase())
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

  // UNE LIGNE À LA FOIS, et non plus le lot entier.
  //
  // L'insertion groupée est tout-ou-rien : une seule ligne refusée par la base
  // en emportait quarante et une autres, `console.error`, et la fonction rendait
  // zéro. C'est ce qui est arrivé en production le 04/08/2026 — la boucherie
  // avait 43 pièces pesées et pas un seul morceau au catalogue. Le déclencheur
  // du lot 63 marchait ; c'est l'écriture qui échouait, en silence.
  //
  // Une pièce qui résiste ne coûte donc plus que sa propre place. Le nombre
  // rendu est celui des morceaux RÉELLEMENT créés, jamais celui des tentatives.
  let crees = 0
  for (const ligne of aCreer) {
    const { error: insErr } = await service.from('generic_articles').insert(ligne)
    if (insErr) {
      console.error(`[valorisation-source] morceau « ${String(ligne.name)} » non créé :`, insErr.message)
      continue
    }
    crees++
  }
  return crees
}

/** Un nom de morceau qui ne heurte aucun nom déjà pris.
 *
 *  La nomenclature donne LE MÊME nom à des pièces différentes — treize cas, dont
 *  « Jarret avec os », porté à la fois par `jarret_avec_os` et `jarret_semelle`
 *  du bœuf. Deux morceaux de la même carcasse produisaient donc la même clé, et
 *  l'index unique de la base refusait l'écriture.
 *
 *  On garde le nom de la nomenclature — c'est celui que le boucher lit sur son
 *  écran de valorisation — et on ne s'en écarte QUE s'il est déjà pris : le
 *  libellé se dérive alors de l'identifiant de la pièce, qui est unique par
 *  construction (« jarret_semelle » → « Jarret semelle »), puis, en tout dernier
 *  recours, de l'espèce. Jamais de suffixe numérique : « Jarret avec os 2 » ne
 *  dirait à personne de quel morceau il s'agit. */
function nomLibre(cut: Cut, espece: AnimalType, prises: Set<string>): string {
  const candidats = [
    nomGeneriqueMorceau(cut),
    `${libelleDepuisId(cut.id)} — découpe`,
    `${cut.name} (${ESPECE_FR[espece].toLowerCase()}) — découpe`,
    `${libelleDepuisId(cut.id)} (${ESPECE_FR[espece].toLowerCase()}) — découpe`,
  ]
  for (const c of candidats) if (!prises.has(c.toLowerCase())) return c
  return candidats[candidats.length - 1]
}

/** « jarret_semelle » → « Jarret semelle ». Les préfixes d'espèce et de groupe
 *  qui structurent les identifiants (`b2_`, `veau_`, `capa_`…) sont retirés :
 *  ils rangent la nomenclature, ils ne nomment pas la pièce. */
function libelleDepuisId(id: string): string {
  const sansPrefixe = String(id)
    .replace(/^(b2|capa|art8|boeuf|veau|agneau|porc|volaille)_/, '')
    .replace(/_/g, ' ')
    .trim()
  if (!sansPrefixe) return String(id)
  return sansPrefixe.charAt(0).toUpperCase() + sansPrefixe.slice(1)
}
