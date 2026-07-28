// lib/margin-families.ts — le référentiel de familles/sous-familles de marge,
// personnalisable par client (table margin_families). Il complète le moteur
// hebdo SANS le remplacer : les 3 familles métier restent le pivot de la
// ventilation fournisseur, le référentiel apporte les SOUS-FAMILLES (bœuf,
// veau, porc, agneau, volaille…), les familles d'achat-revente qui éclatent le
// bloc Divers, et les REPÈRES de marge modifiables.
//
// Matching d'un libellé de vente (« VIANDE DE BOEUF ») vers une famille :
//   1. barrière rachat (comme le moteur) : un libellé rachat/revente ne peut
//      viser QUE les familles marquées is_rachat, et réciproquement ;
//   2. les sous-familles (plus spécifiques) sont testées AVANT les racines ;
//   3. une racine de match_stems reconnaît un MOT du libellé par préfixe.
// La partie serveur (ensureMarginFamilies) sème le référentiel par défaut à la
// première lecture — importable UNIQUEMENT côté serveur.

import { isDiversLabel, normText } from '@/lib/postes'

export type MarginFamily = {
  id: string
  parent_id: string | null
  name: string
  name_key: string
  match_stems: string[]
  is_rachat: boolean
  benchmark_lo: number | null
  benchmark_hi: number | null
  position: number
}

type SeedNode = {
  name: string
  stems: string[]
  rachat?: boolean
  bench?: [number, number]
  children?: SeedNode[]
}

/** Semis par défaut — la liste exacte demandée par le client (28/07), repères de
 *  branche sur les 3 métiers (modifiables ensuite ligne à ligne). */
export const DEFAULT_FAMILY_SEED: SeedNode[] = [
  {
    name: 'Boucherie', bench: [35, 45],
    stems: ['bouch', 'viande', 'boeuf', 'veau', 'agneau', 'mouton', 'porc', 'volaille', 'poulet', 'gibier', 'abat', 'triperie'],
    children: [
      { name: 'Viande de bœuf', stems: ['boeuf'] },
      { name: 'Viande de veau', stems: ['veau'] },
      { name: 'Viande de porc', stems: ['porc', 'cochon'] },
      { name: "Viande d'agneau", stems: ['agneau', 'mouton'] },
      { name: 'Viande de volaille', stems: ['volaille', 'poulet', 'canard', 'dinde', 'pintade', 'lapin'] },
    ],
  },
  { name: 'Charcuterie', bench: [40, 55], stems: ['charcut', 'salaison', 'saucis', 'jambon', 'terrine', 'rillette', 'boudin', 'andouill'] },
  { name: 'Traiteur', bench: [50, 65], stems: ['traiteur', 'rotisserie', 'snack', 'sandwich', 'plat'] },
  { name: 'Fruits & légumes', stems: ['fruit', 'legume', 'primeur'] },
  { name: 'Fromages', stems: ['fromage', 'cremerie', 'laitier'] },
  { name: 'Charcuterie rachat', rachat: true, stems: ['charcut', 'salaison', 'saucis', 'jambon'] },
  { name: 'Traiteur rachat', rachat: true, stems: ['traiteur', 'plat', 'snack'] },
  { name: 'Prestation', stems: ['prestation', 'presta'] },
  { name: 'Alcool', stems: ['alcool', 'vin', 'biere', 'champagne', 'spiritueux', 'aperitif', 'cidre'] },
  { name: 'Divers épicerie', stems: ['epicerie', 'conserve', 'condiment', 'sauce', 'confiserie', 'dessert'] },
]

/** Une racine reconnaît-elle un MOT du texte normalisé ? (préfixe, comme le moteur) */
function stemInText(stem: string, normalized: string): boolean {
  return normalized.split(' ').some(w => w.startsWith(stem))
}

/** Racines de matching d'une famille créée par l'utilisateur : les mots
 *  significatifs de son nom (« Volaille label rouge » → volaille, label, rouge). */
export function stemsFromName(name: string): string[] {
  const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'au', 'aux', 'a'])
  return normText(name).split(' ').filter(w => w.length >= 3 && !STOP.has(w)).slice(0, 8)
}

/** Famille (id) d'un libellé de vente, ou null (→ « non rattaché »).
 *  Sous-familles d'abord (plus spécifiques), barrière rachat des deux côtés. */
export function matchFamilyId(label: unknown, families: MarginFamily[]): string | null {
  const n = normText(label)
  if (!n) return null
  const rachat = isDiversLabel(label)
  const candidates = families
    .filter(f => f.is_rachat === rachat)
    .sort((a, b) => (a.parent_id === null ? 1 : 0) - (b.parent_id === null ? 1 : 0) || a.position - b.position)
  for (const f of candidates) {
    if (f.match_stems.some(st => st && stemInText(st, n))) return f.id
  }
  return null
}

/** CA agrégé par famille sur une liste d'entrées {nom, montant} (families_detail).
 *  Renvoie aussi le total non rattaché. Un montant compté dans une SOUS-famille
 *  est AUSSI compté dans sa racine (la sous-famille détaille, elle ne vole pas). */
export function caByFamily(
  entries: Array<{ nom?: unknown; montant?: unknown }>,
  families: MarginFamily[],
): { byId: Map<string, number>; nonRattache: number } {
  const byId = new Map<string, number>()
  const parentOf = new Map(families.map(f => [f.id, f.parent_id]))
  let nonRattache = 0
  for (const e of entries) {
    const montant = Number(e?.montant) || 0
    if (!montant) continue
    const id = matchFamilyId(e?.nom, families)
    if (!id) { nonRattache += montant; continue }
    byId.set(id, (byId.get(id) || 0) + montant)
    const parent = parentOf.get(id)
    if (parent) byId.set(parent, (byId.get(parent) || 0) + montant)
  }
  return { byId, nonRattache }
}

/** Charge le référentiel de VENTE du client (kind='vente'), en le SEMANT à la
 *  première lecture. Serveur uniquement (service role). Idempotent. */
export async function ensureMarginFamilies(service: any, clientId: string): Promise<MarginFamily[]> {
  const sel = 'id, parent_id, name, name_key, match_stems, is_rachat, benchmark_lo, benchmark_hi, position'
  const { data: existing } = await service.from('margin_families')
    .select(sel).eq('client_id', clientId).eq('active', true).eq('kind', 'vente')
    .order('position').order('name')
  if (existing && existing.length > 0) return normalizeRows(existing)

  // Semis : racines d'abord (pour obtenir les ids), puis sous-familles.
  let pos = 0
  const rootsPayload = DEFAULT_FAMILY_SEED.map(n => ({
    client_id: clientId, parent_id: null, name: n.name, name_key: normText(n.name),
    match_stems: n.stems, is_rachat: !!n.rachat,
    benchmark_lo: n.bench?.[0] ?? null, benchmark_hi: n.bench?.[1] ?? null,
    position: pos++,
  }))
  const { data: roots, error } = await service.from('margin_families')
    .insert(rootsPayload).select('id, name_key')
  if (error || !roots) return [] // best-effort : la page affichera sans référentiel

  const idByKey = new Map((roots as any[]).map(r => [r.name_key, r.id]))
  const childrenPayload = DEFAULT_FAMILY_SEED.flatMap(n =>
    (n.children || []).map(c => ({
      client_id: clientId, parent_id: idByKey.get(normText(n.name)) ?? null,
      name: c.name, name_key: normText(c.name),
      match_stems: c.stems, is_rachat: !!c.rachat,
      benchmark_lo: null, benchmark_hi: null,
      position: pos++,
    })),
  ).filter(c => c.parent_id !== null)
  if (childrenPayload.length > 0) await service.from('margin_families').insert(childrenPayload)

  const { data: seeded } = await service.from('margin_families')
    .select(sel).eq('client_id', clientId).eq('active', true).eq('kind', 'vente')
    .order('position').order('name')
  return normalizeRows(seeded || [])
}

/** Familles de CHARGES personnalisables (kind='charge') — classent les factures
 *  de charges fixes/récurrentes (invoices.charge_family_id). Semées au premier
 *  passage, modifiables ensuite via /api/margin-families. */
export const DEFAULT_CHARGE_FAMILY_SEED = [
  'Loyer & immobilier', 'Énergie', 'Assurances', 'Abonnements & logiciels',
  'Véhicules & carburant', 'Frais bancaires', 'Emballages & consommables', 'Autres charges',
]

export async function ensureChargeFamilies(service: any, clientId: string): Promise<MarginFamily[]> {
  const sel = 'id, parent_id, name, name_key, match_stems, is_rachat, benchmark_lo, benchmark_hi, position'
  const { data: existing } = await service.from('margin_families')
    .select(sel).eq('client_id', clientId).eq('active', true).eq('kind', 'charge')
    .order('position').order('name')
  if (existing && existing.length > 0) return normalizeRows(existing)

  const payload = DEFAULT_CHARGE_FAMILY_SEED.map((name, i) => ({
    client_id: clientId, parent_id: null, name, name_key: normText(name),
    match_stems: stemsFromName(name), is_rachat: false, kind: 'charge',
    benchmark_lo: null, benchmark_hi: null, position: 100 + i,
  }))
  const { error } = await service.from('margin_families').insert(payload)
  if (error) return [] // best-effort

  const { data: seeded } = await service.from('margin_families')
    .select(sel).eq('client_id', clientId).eq('active', true).eq('kind', 'charge')
    .order('position').order('name')
  return normalizeRows(seeded || [])
}

function normalizeRows(rows: any[]): MarginFamily[] {
  return rows.map(r => ({
    id: String(r.id),
    parent_id: r.parent_id ? String(r.parent_id) : null,
    name: String(r.name ?? ''),
    name_key: String(r.name_key ?? ''),
    match_stems: Array.isArray(r.match_stems) ? r.match_stems.map(String) : [],
    is_rachat: !!r.is_rachat,
    benchmark_lo: r.benchmark_lo != null ? Number(r.benchmark_lo) : null,
    benchmark_hi: r.benchmark_hi != null ? Number(r.benchmark_hi) : null,
    position: Number(r.position) || 0,
  }))
}
