/**
 * LA VENTILATION DES ACHATS — une seule fois, pour tout le monde.
 *
 * Module PUR, testable hors ligne. Il ne parle à aucune base : on lui donne les
 * factures, les règles de répartition, le référentiel de familles, et il rend la
 * ventilation.
 *
 * ─── LE TROU ──────────────────────────────────────────────────────────────
 *
 * Le lot 77 a donné à `supplier_rayon_splits` une colonne `parts` : la
 * répartition d'un fournisseur entre AUTANT de familles qu'il en faut —
 * boucherie, charcuterie, traiteur, mais aussi fromages, alcool, prestation,
 * rachat, et les sous-familles. Les anciennes colonnes `pct_*` restent écrites,
 * DÉRIVÉES de `parts`.
 *
 * Sauf que les deux consommateurs — le moteur hebdomadaire et l'écran Marges —
 * lisaient toujours les `pct_*`. Cinq colonnes, repliées en quatre seaux. Un
 * boucher pouvait donc répartir finement son fournisseur, et ne jamais voir le
 * résultat de cette finesse : elle était écrasée à la lecture. La marge par
 * famille s'arrêtait aux trois métiers.
 *
 * ─── UNE SEULE VENTILATION, DEUX LECTURES ─────────────────────────────────
 *
 * Ici, on ventile UNE fois, vers les familles. Les quatre seaux historiques
 * (boucherie, charcuterie, traiteur, divers) en sont DÉDUITS — chaque famille
 * compte dans le seau de sa racine. Ils ne sont donc plus un second calcul qui
 * pourrait diverger : ce sont deux résolutions du même partage.
 *
 * ─── L'ORDRE DES RÈGLES ───────────────────────────────────────────────────
 *
 * 1. La répartition PROPRE À UNE FACTURE prime. Elle vise directement des
 *    familles, sans toucher les autres factures du même fournisseur.
 * 2. Sinon, la règle du FOURNISSEUR : ses `parts` si elles existent, sinon
 *    reprises de ses anciennes colonnes.
 * 3. Sinon, la facture reste NON VENTILÉE. Elle n'est pas répartie au prorata
 *    de quoi que ce soit : un achat qu'on ne sait pas classer se dit, il ne se
 *    devine pas.
 *
 * Dans les cas 1 et 2, les parts sont renormalisées sur leur propre total : une
 * répartition à 80 % répartit bien 100 % de la facture. C'était déjà le
 * comportement des colonnes ; il est conservé.
 */

import { normalizeSupplierName, sameSupplierFamily, supplierSociete } from '@/lib/supplier-memory'
import { partsNormalisees, partsDepuisColonnes, type PartsParFamille } from '@/lib/supplier-parts'

/**
 * Les trois rayons MÉTIER des seaux historiques.
 *
 * Le quatrième seau, « divers », n'est pas un métier : il ne se rattache à
 * aucune famille et n'est jamais redistribué au prorata du chiffre d'affaires —
 * un cageot de tomates n'a rien à faire dans la marge boucherie.
 */
export const RAYONS_METIER = [
  { key: 'boucherie',   label: 'Boucherie' },
  { key: 'charcuterie', label: 'Charcuterie' },
  { key: 'traiteur',    label: 'Traiteur' },
] as const

/** Une facture d'achat, réduite à ce dont la ventilation a besoin. */
export type FactureAchat = {
  id?: string | null
  supplier_name?: string | null
  amount_ht?: number | string | null
}

/** Une règle de répartition fournisseur, telle que la table la porte. */
export type RegleFournisseur = {
  supplier_key?: string | null
  parts?: unknown
  pct_boucherie?: number | string | null
  pct_charcuterie?: number | string | null
  pct_traiteur?: number | string | null
  pct_fruits_et_legumes?: number | string | null
  pct_divers?: number | string | null
}

/** Une famille du référentiel de la boutique. */
export type FamilleRef = {
  id: string
  parent_id?: string | null
  name?: string | null
  name_key?: string | null
  is_rachat?: boolean | null
}

/** Une part visée directement sur une facture (`invoice_family_splits`). */
export type SurchargeFacture = { invoice_id: string; family_id: string; pct: number | string }

export type Ventilation = {
  /** Montant HT ventilé sur chaque famille du référentiel. */
  parFamille: Record<string, number>
  /** Les quatre seaux historiques, DÉDUITS de `parFamille`. */
  parRayon: Record<string, number>
  /** Achats d'un fournisseur sans règle : comptés nulle part, annoncés. */
  nonVentiles: number
  /** Nombre de factures restées non ventilées — pour le dire à l'écran. */
  facturesNonVentilees: number
  total: number
}

const nb = (x: unknown): number => {
  const n = typeof x === 'number' ? x : parseFloat(String(x ?? ''))
  return Number.isFinite(n) ? n : 0
}

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * La règle du fournisseur qui s'applique à ce nom.
 *
 * Clé exacte d'abord ; sinon la clé de la même famille de sociétés la plus
 * LONGUE — la plus spécifique. Exporté parce que l'écran Marges appliquait la
 * même recherche dans son coin : deux copies d'une règle d'appariement finissent
 * toujours par ne plus dire la même chose.
 */
export function regleDuFournisseur(
  regles: RegleFournisseur[] | null | undefined,
  supplierName: unknown,
): RegleFournisseur | null {
  const q = normalizeSupplierName(supplierSociete(String(supplierName ?? '')))
  if (!q) return null
  let meilleure: RegleFournisseur | null = null
  for (const r of regles ?? []) {
    const cle = String(r?.supplier_key ?? '')
    if (!cle) continue
    if (cle === q) return r
    if (sameSupplierFamily(cle, q)
      && (meilleure === null || cle.length > String(meilleure.supplier_key ?? '').length)) meilleure = r
  }
  return meilleure
}

/**
 * Le seau historique de chaque famille : sa racine décide.
 *
 * `estRayon(racine)` est fourni par l'appelant — c'est la reconnaissance floue
 * de `lib/postes` (« boucher » ≈ « boucherie »), qui dépend des libellés de
 * vente de la boutique et n'a donc rien à faire dans un module pur.
 *
 * Une famille de RACHAT ne relève d'aucun métier, où que pointe sa racine :
 * revendre de la charcuterie achetée toute faite n'est pas de la charcuterie.
 */
export function seauxDesFamilles(
  familles: FamilleRef[] | null | undefined,
  estRayon: (racine: FamilleRef) => string | null,
): Map<string, string> {
  const parId = new Map<string, FamilleRef>((familles ?? []).map(f => [String(f.id), f]))
  const out = new Map<string, string>()
  for (const f of familles ?? []) {
    const racine = f.parent_id ? (parId.get(String(f.parent_id)) ?? f) : f
    let seau = 'divers'
    if (!racine.is_rachat && !f.is_rachat) seau = estRayon(racine) ?? 'divers'
    out.set(String(f.id), seau)
  }
  return out
}

/**
 * La ventilation d'un lot de factures.
 *
 * `familles` sert à valider les identifiants de parts : une part qui vise une
 * famille supprimée est écartée plutôt que comptée sur un identifiant fantôme.
 */
export function ventilationAchats(
  factures: FactureAchat[] | null | undefined,
  regles: RegleFournisseur[] | null | undefined,
  familles: FamilleRef[] | null | undefined,
  surcharges: SurchargeFacture[] | null | undefined,
  seaux: Map<string, string>,
): Ventilation {
  const listeFamilles = (familles ?? []) as { id: string; name_key?: string | null; parent_id?: string | null }[]
  const idsConnus = new Set(listeFamilles.map(f => String(f.id)))

  // Les parts visées directement sur une facture, groupées par facture.
  const parFacture = new Map<string, PartsParFamille>()
  for (const s of surcharges ?? []) {
    const fid = String(s?.family_id ?? '')
    if (!fid || !idsConnus.has(fid)) continue
    const cle = String(s.invoice_id)
    const seau = parFacture.get(cle) ?? {}
    seau[fid] = (seau[fid] ?? 0) + nb(s.pct)
    parFacture.set(cle, seau)
  }

  // Les parts d'une règle fournisseur, calculées une fois par règle.
  const partsDeRegle = new Map<RegleFournisseur, PartsParFamille>()
  const partsDe = (r: RegleFournisseur): PartsParFamille => {
    const dejaVu = partsDeRegle.get(r)
    if (dejaVu) return dejaVu
    // `parts` d'abord ; les anciennes colonnes ne servent que de reprise, pour
    // les règles écrites avant que la colonne n'existe.
    const brut = r.parts && typeof r.parts === 'object'
      ? partsNormalisees(r.parts, listeFamilles as never)
      : partsDepuisColonnes(r as never, listeFamilles as never)
    partsDeRegle.set(r, brut)
    return brut
  }

  const parFamille: Record<string, number> = {}
  const parRayon: Record<string, number> = { boucherie: 0, charcuterie: 0, traiteur: 0, divers: 0 }
  let nonVentiles = 0
  let facturesNonVentilees = 0
  let total = 0

  for (const f of factures ?? []) {
    const montant = nb(f?.amount_ht)
    if (!montant) continue
    total += montant

    const surcharge = f?.id ? parFacture.get(String(f.id)) : undefined
    const parts = surcharge && Object.keys(surcharge).length > 0
      ? surcharge
      : partsDe(regleDuFournisseur(regles, f?.supplier_name) ?? {})

    const somme = Object.values(parts).reduce((s, p) => s + p, 0)
    if (somme <= 0) { nonVentiles += montant; facturesNonVentilees++; continue }

    for (const [fid, part] of Object.entries(parts)) {
      if (part <= 0) continue
      const montantFamille = montant * (part / somme)
      parFamille[fid] = (parFamille[fid] ?? 0) + montantFamille
      const seau = seaux.get(fid) ?? 'divers'
      parRayon[seau] = (parRayon[seau] ?? 0) + montantFamille
    }
  }

  for (const k of Object.keys(parFamille)) parFamille[k] = r2(parFamille[k])
  for (const k of Object.keys(parRayon)) parRayon[k] = r2(parRayon[k])

  return {
    parFamille, parRayon,
    nonVentiles: r2(nonVentiles),
    facturesNonVentilees,
    total: r2(total),
  }
}

/**
 * Les achats d'une famille, SES SOUS-FAMILLES COMPRISES.
 *
 * Une sous-famille compte dans sa racine — c'est déjà la règle du chiffre
 * d'affaires (`caByFamily`). Sans ça, la marge d'une racine comparerait un CA
 * qui inclut ses enfants à des achats qui les excluent : un taux de marge faux,
 * dans le sens flatteur.
 */
export function achatsDeLaFamille(
  parFamille: Record<string, number>,
  familles: FamilleRef[] | null | undefined,
  familleId: string,
): number {
  let total = nb(parFamille[familleId])
  for (const f of familles ?? []) {
    if (String(f.parent_id ?? '') === String(familleId)) total += nb(parFamille[String(f.id)])
  }
  return r2(total)
}
