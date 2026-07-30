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
import type { ExtractedData, FinancierData } from './report-types'

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
    model: EXTRACTION_MODEL,
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
