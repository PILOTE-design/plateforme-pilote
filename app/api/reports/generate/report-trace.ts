// Traçabilité de l'extraction (lot V1) — rien ne se vérifie sans trace.
//
// Jusqu'ici les 4 PDF Crisalid étaient parsés puis JETÉS : quand un chiffre du
// rapport semblait faux, il n'existait plus aucun moyen de le confronter à sa
// source. Ce module archive, pour chaque tentative de génération :
//   1. les 4 PDF dans le bucket PRIVÉ `report-sources` (chemin par client) ;
//   2. le texte brut pdf-parse de chaque fichier ;
//   3. les chiffres extraits, sérialisés tels quels ;
//   4. (lot V2) le résultat de chaque contrôle et le statut.
// Chaque ligne de `report_extractions` est aussi un futur cas du corpus de
// référence (lot V5) : texte source → chiffres validés.
//
// Best-effort ASSUMÉ à ce stade : un échec de traçabilité est loggé mais ne
// bloque jamais la génération (zéro régression pour la boucherie en prod).
// À partir du flux en deux temps (lot V3), l'extraction stockée devient la
// pièce d'identité du rapport et cesse d'être optionnelle.

import type { createServiceClient } from '@/lib/supabase/server'
import type { ExtractedData, Famille, FinancierData } from './report-types'
import { computeTopFlop } from './report-extract'

type ServiceClient = ReturnType<typeof createServiceClient>

/** Version du jeu de prompts d'extraction — à incrémenter à CHAQUE modification
 *  d'un prompt de report-extract.ts, pour que le corpus (lot V5) sache quelles
 *  extractions comparer entre elles. */
export const EXTRACTION_PROMPT_VERSION = '2026-07-30'
export const EXTRACTION_MODEL = 'claude-haiku-4-5-20251001'

export type SourceKind = 'financier_n' | 'financier_n1' | 'ventes_n' | 'ventes_n1'

/** Extraction sérialisée — tout ce qu'il faut pour re-vérifier ou régénérer un
 *  rapport sans retoucher aux PDF. Les produits sont stockés en entier :
 *  l'extraction est plafonnée aux ~60 plus gros par fichier, le volume est faible. */
export type StoredExtraction = {
  period_n: string
  period_n1: string
  week_number: number
  year: number
  financier_n: FinancierData
  financier_n1: FinancierData
  ventes_n: { total: number; familles: { id: string; nom: string; montant: number }[] }
  ventes_n1: { total: number; familles: { id: string; nom: string; montant: number }[] }
  produits_n: Record<string, number>
  produits_n1: Record<string, number>
  familles_produits_n: Record<string, string>
  familles_produits_n1: Record<string, string>
  /** Corrections appliquées pendant l'extraction (cf. report-checks) */
  notes: string[]
}

export function serializeExtraction(d: ExtractedData): StoredExtraction {
  const fam = (v: { total: number; familles: { id: string; nom: string; total_montant: number }[] }) => ({
    total: v.total,
    familles: v.familles.map(f => ({ id: f.id, nom: f.nom, montant: f.total_montant })),
  })
  return {
    period_n: d.period_n,
    period_n1: d.period_n1,
    week_number: d.week_number,
    year: d.year,
    financier_n: d.financier_n,
    financier_n1: d.financier_n1,
    ventes_n: fam(d.ventes_n),
    ventes_n1: fam(d.ventes_n1),
    produits_n: Object.fromEntries(d.prodN),
    produits_n1: Object.fromEntries(d.prodN1),
    familles_produits_n: Object.fromEntries(d.prodFamN),
    familles_produits_n1: Object.fromEntries(d.prodFamN1),
    notes: d.notes ?? [],
  }
}

/** Archive les 4 PDF sources dans le bucket privé `report-sources`.
 *  Chemin : {client|sans-client}/{année}-S{semaine}/{horodatage}-{type}.pdf.
 *  Best-effort fichier par fichier : un upload en échec est loggé, les autres
 *  continuent — renvoie les chemins réellement écrits. */
export async function storeReportSources(
  service: ServiceClient,
  clientId: string | null,
  week: number,
  year: number,
  files: Partial<Record<SourceKind, File>>,
): Promise<Partial<Record<SourceKind, string>>> {
  const ts = Date.now()
  const base = `${clientId ?? 'sans-client'}/${year}-S${week}`
  const paths: Partial<Record<SourceKind, string>> = {}
  for (const [kind, file] of Object.entries(files) as [SourceKind, File][]) {
    if (!file) continue
    try {
      const path = `${base}/${ts}-${kind}.pdf`
      const buffer = Buffer.from(await file.arrayBuffer())
      const { error } = await service.storage.from('report-sources')
        .upload(path, buffer, { contentType: 'application/pdf', upsert: false })
      if (error) { console.error(`[trace] archivage ${kind} impossible:`, error.message); continue }
      paths[kind] = path
    } catch (e) {
      console.error(`[trace] archivage ${kind} impossible:`, e instanceof Error ? e.message : e)
    }
  }
  return paths
}

/** Enregistre la trace d'une extraction. Renvoie l'id de la ligne, ou null en
 *  cas d'échec (loggé, jamais bloquant à ce stade). */
export async function storeExtraction(
  service: ServiceClient,
  args: {
    clientId: string | null
    week: number
    year: number
    files: Partial<Record<SourceKind, string>>
    rawTexts: Record<SourceKind, string>
    extraction: StoredExtraction
    checks: unknown[] | null
    status: string
    /** Moteur ayant produit ces chiffres (lot V6) : « crisalid-coordonnees-v1 »
     *  pour la lecture déterministe, sinon le modèle IA par défaut. Sert à savoir,
     *  a posteriori, si un rapport a été extrait sans IA ou par repli IA. */
    model?: string
  },
): Promise<string | null> {
  const { data, error } = await service.from('report_extractions').insert({
    client_id: args.clientId,
    week_number: args.week,
    year: args.year,
    files: args.files,
    raw_texts: args.rawTexts,
    extraction: args.extraction,
    checks: args.checks,
    status: args.status,
    model: args.model ?? EXTRACTION_MODEL,
    prompt_version: EXTRACTION_PROMPT_VERSION,
  }).select('id').single()
  if (error) { console.error('[trace] enregistrement extraction impossible:', error.message); return null }
  return data ? String(data.id) : null
}

/** Relie la trace au rapport généré, une fois la ligne `reports` créée. */
export async function linkExtractionToReport(
  service: ServiceClient,
  extractionId: string,
  reportId: string,
): Promise<void> {
  const { error } = await service.from('report_extractions')
    .update({ report_id: reportId }).eq('id', extractionId)
  if (error) console.error('[trace] liaison extraction→rapport impossible:', error.message)
}

// ─── Flux en deux temps (lot V3) : générer À PARTIR d'une extraction stockée ───
//
// Quand les contrôles laissent l'extraction « à valider », le rapport n'est pas
// produit tout de suite. L'écran admin corrige les familles fautives, puis
// rappelle la génération à partir de la MÊME extraction (rechargée ici) : aucune
// relecture des PDF, donc aucun nouvel appel IA (déterministe, et on tient dans
// la fenêtre 60 s de Vercel).

export type StoredExtractionRow = {
  id: string
  client_id: string | null
  week_number: number
  year: number
  extraction: StoredExtraction
  status: string
}

/** Recharge une extraction archivée par son id (client vérifié par l'appelant). */
export async function loadExtractionRow(
  service: ServiceClient,
  extractionId: string,
): Promise<StoredExtractionRow | null> {
  const { data, error } = await service.from('report_extractions')
    .select('id, client_id, week_number, year, extraction, status')
    .eq('id', extractionId).maybeSingle()
  if (error) { console.error('[trace] rechargement extraction impossible:', error.message); return null }
  return (data as StoredExtractionRow | null) ?? null
}

/** Corrections humaines d'un montant de famille, par côté. */
export type FamilyOverride = { cote: 'n' | 'n1'; nom: string; montant: number }

/** Reconstruit un ExtractedData complet depuis l'extraction stockée, en
 *  appliquant d'éventuelles corrections de familles. Les tops/flops sont
 *  RECALCULÉS en code depuis les produits (zéro IA, zéro écart). */
export function deserializeExtraction(s: StoredExtraction, overrides: FamilyOverride[] = []): ExtractedData {
  const applyOne = (cote: 'n' | 'n1', familles: { id: string; nom: string; montant: number }[]): Famille[] => {
    const ovByNom = new Map(overrides.filter(o => o.cote === cote).map(o => [o.nom, o.montant]))
    return familles.map(f => ({
      id: f.id, nom: f.nom,
      total_montant: ovByNom.has(f.nom) ? ovByNom.get(f.nom)! : f.montant,
      produits: [],
    }))
  }
  const prodN = new Map<string, number>(Object.entries(s.produits_n))
  const prodN1 = new Map<string, number>(Object.entries(s.produits_n1))
  const prodFamN = new Map<string, string>(Object.entries(s.familles_produits_n))
  const prodFamN1 = new Map<string, string>(Object.entries(s.familles_produits_n1))
  const ventesN = { total: s.ventes_n.total, familles: applyOne('n', s.ventes_n.familles) }
  const ventesN1 = { total: s.ventes_n1.total, familles: applyOne('n1', s.ventes_n1.familles) }
  const topFlop = computeTopFlop(prodN, prodN1, ventesN.total, ventesN1.total)
  return {
    period_n: s.period_n, period_n1: s.period_n1,
    week_number: s.week_number, year: s.year,
    financier_n: s.financier_n, financier_n1: s.financier_n1,
    ventes_n: ventesN, ventes_n1: ventesN1,
    tops: topFlop.tops, flops: topFlop.flops,
    prodN, prodN1, prodFamN, prodFamN1,
    notes: s.notes ?? [],
  }
}

/** Clôt une extraction : statut final, rapport lié, corrections humaines et
 *  contrôles re-calculés après correction (pour l'audit). */
export async function finalizeExtraction(
  service: ServiceClient,
  extractionId: string,
  args: { status: string; reportId?: string | null; overrides?: FamilyOverride[] | null; checks?: unknown[] | null; validatedBy?: string | null },
): Promise<void> {
  const patch: Record<string, unknown> = { status: args.status }
  if (args.reportId) patch.report_id = args.reportId
  if (args.overrides && args.overrides.length > 0) patch.human_overrides = args.overrides
  if (args.checks) patch.checks = args.checks
  if (args.status === 'validee_humain') {
    patch.validated_at = new Date().toISOString()
    if (args.validatedBy) patch.validated_by = args.validatedBy
  }
  const { error } = await service.from('report_extractions').update(patch).eq('id', extractionId)
  if (error) console.error('[trace] clôture extraction impossible:', error.message)
}
