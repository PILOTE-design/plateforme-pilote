// app/api/admin/extraction-eval/route.ts — MESURE de l'exactitude de l'extraction (lot V5).
//
// « 100 % » n'est plus proclamé, il est MESURÉ. Chaque extraction de référence
// (validée par un humain, ou passée tous contrôles au vert) a un texte source
// archivé (lot V1) ET des chiffres qu'on sait justes. Cette route REJOUE
// l'extracteur COURANT sur ces textes et compte, chiffre par chiffre, ce qui
// coïncide avec la référence. Le taux obtenu est la fiabilité réelle du couple
// (prompt, modèle) courant. Règle d'exploitation : aucun changement de prompt ou
// de modèle ne se livre si ce taux régresse — on le relance avant/après.
//
// Réservé aux administrateurs. Le replay appelle l'IA (plusieurs requêtes Haiku
// par cas) : le lot est BORNÉ pour tenir dans la fenêtre 60 s de Vercel, et les
// cas non traités sont annoncés (jamais tronqués en silence).

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/admins'
import { extractData } from '../../reports/generate/report-extract'
import {
  serializeExtraction, deserializeExtraction,
  EXTRACTION_MODEL, EXTRACTION_PROMPT_VERSION,
  type StoredExtraction, type FamilyOverride,
} from '../../reports/generate/report-trace'
import { compareExtraction, aggregateCorpus, type CasEval } from '@/lib/extraction-eval'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

/** Une extraction n'est une VÉRITÉ de référence que si un humain l'a validée, ou
 *  si elle est passée tous contrôles au vert. Une « a_valider » n'en est pas une
 *  (sauf demande explicite via include_pending, pour exercer l'outil). */
const STATUTS_REFERENCE = ['validee_humain', 'generee'] as const

type RawTexts = { financier_n?: string; financier_n1?: string; ventes_n?: string; ventes_n1?: string }

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Non autorise' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const rawIds = (body as { ids?: unknown }).ids
  const ids = Array.isArray(rawIds) ? rawIds.filter((x: unknown): x is string => typeof x === 'string') : []
  const includePending = (body as { include_pending?: unknown }).include_pending === true
  const limit = Math.min(Math.max(Number((body as { limit?: unknown }).limit) || 3, 1), 5)

  const service = createServiceClient()
  const statuts = includePending ? [...STATUTS_REFERENCE, 'a_valider'] : [...STATUTS_REFERENCE]

  let query = service.from('report_extractions')
    .select('id, week_number, year, extraction, human_overrides, status, raw_texts')
    .not('raw_texts', 'is', null)
  query = ids.length ? query.in('id', ids) : query.in('status', statuts)
  query = query
    .order('validated_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
  const { data: rows, error } = await query.limit(60)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const corpus = rows ?? []
  // Sans ids explicites, on borne au lot ; avec ids, l'appelant a déjà choisi.
  const aTraiter = ids.length ? corpus : corpus.slice(0, limit)

  const cas: CasEval[] = []
  const erreurs: { id: string; semaine: number; annee: number; erreur: string }[] = []
  for (const row of aTraiter) {
    const raw = (row.raw_texts ?? {}) as RawTexts
    try {
      if (!raw.financier_n || !raw.ventes_n) {
        erreurs.push({ id: row.id, semaine: row.week_number, annee: row.year, erreur: 'Textes bruts incomplets (archive antérieure au lot V1 ?).' })
        continue
      }
      const overrides = (Array.isArray(row.human_overrides) ? row.human_overrides : []) as FamilyOverride[]
      // ATTENDU = la vérité de référence : extraction stockée + corrections
      // humaines, telle que le rapport l'a réellement utilisée (même chemin que
      // la génération, aucune divergence de calcul possible).
      const attendu = serializeExtraction(deserializeExtraction(row.extraction as StoredExtraction, overrides))
      // OBTENU = ré-extraction du MÊME texte source par l'extracteur COURANT.
      const obtenu = serializeExtraction(await extractData({
        fin_n: raw.financier_n, fin_n1: raw.financier_n1 ?? '',
        ventes_n: raw.ventes_n, ventes_n1: raw.ventes_n1 ?? '',
      }))
      cas.push(compareExtraction(row.id, row.week_number, row.year, attendu, obtenu))
    } catch (e) {
      erreurs.push({ id: row.id, semaine: row.week_number, annee: row.year, erreur: e instanceof Error ? e.message : String(e) })
    }
  }

  const resultat = aggregateCorpus(cas)
  return NextResponse.json({
    exactitude: resultat.exactitude,
    exacts: resultat.exacts,
    total_chiffres: resultat.total_chiffres,
    cas_evalues: resultat.cas,
    corpus_total: corpus.length,
    restants: Math.max(0, corpus.length - aTraiter.length),
    model_courant: EXTRACTION_MODEL,
    prompt_version_courant: EXTRACTION_PROMPT_VERSION,
    reference: ids.length ? 'ids' : includePending ? 'corpus+en_attente' : 'corpus_valide',
    par_cas: resultat.par_cas,
    erreurs,
  })
}
