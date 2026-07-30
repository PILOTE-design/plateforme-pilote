// ⚠️  Ce fichier doit être nommé route.tsx (supprimer route.ts)
// Dépendances : @react-pdf/renderer, pdf-parse, @anthropic-ai/sdk, resend
if (typeof globalThis.DOMMatrix === 'undefined') {
  ;(globalThis as Record<string, unknown>).DOMMatrix = class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { Resend } from 'resend'
import { computeWeekEconomics } from '@/lib/week-economics'
import { ensureFonts } from './report-fonts'
import { PiloteReport } from './report-pdf'
import { eur0, signPct, trunc } from './report-format'
import { createHash } from 'crypto'
import { parsePDF, extractData, weekFromPeriod } from './report-extract'
import { archiveWeekData } from './report-persist'
import {
  serializeExtraction, storeReportSources, storeExtraction,
  loadExtractionRow, deserializeExtraction, finalizeExtraction,
  type FamilyOverride,
} from './report-trace'
import { runExtractionChecks, statusFromChecks, failedChecksSummary, type ChecksContext } from '@/lib/report-checks'
import { buildFamRows, buildStatus, buildMargeRead, buildExecSummary, generateInsights } from './report-compute'
import { getPieBuffer } from './report-chart'
import type { ComputedReport, ExtractedData } from './report-types'
import type { WeekEconomics } from '@/lib/week-economics'

export const maxDuration = 60

// Le cast contourne le typage de renderToBuffer, qui exige un ReactElement<DocumentProps>
// alors que PiloteReport rend bien un <Document>. Même contournement que dans
// app/api/valorisations/pdf/route.tsx.
async function generatePDF(report: ComputedReport): Promise<Buffer> {
  await ensureFonts()
  return renderToBuffer(React.createElement(PiloteReport, { r: report }) as any)
}

type AuthedProfile = { id: string; delivery_email?: string | null }

/**
 * Produit le rapport à partir d'une extraction DÉJÀ contrôlée — chemin commun aux
 * deux entrées : génération directe (contrôles au vert) et génération après
 * validation humaine (corrections appliquées). Historise, upload (bucket privé),
 * insère la ligne `reports`, clôt la trace et envoie l'email.
 */
async function produceReport(
  serviceSupabase: ReturnType<typeof createServiceClient>,
  profile: AuthedProfile,
  userEmail: string | null,
  clientId: string | null,
  data: ExtractedData,
  opts: { extractionId: string | null; overrides: FamilyOverride[] | null },
): Promise<NextResponse> {
  const famRows = buildFamRows(data.ventes_n, data.ventes_n1)
  const caVar = data.financier_n1.ca_net
    ? (data.financier_n.ca_net - data.financier_n1.ca_net) / data.financier_n1.ca_net
    : 0

  // Le graphique est un CONFORT, pas le rapport : QuickChart en échec (sandbox
  // saturée, timeout 8 s) ne doit pas emporter la génération entière.
  const [insightsResult, pieBuffer] = await Promise.all([
    generateInsights(data, famRows),
    getPieBuffer(data).catch(chartErr => {
      console.error('Graphique QuickChart indisponible, rapport généré sans:', chartErr)
      return null
    }),
  ])

  let clientEmail: string | null = null
  let clientName:  string | null = null
  if (clientId) {
    const { data: client } = await serviceSupabase.from('clients').select('email, name').eq('id', clientId).single()
    if (client) { clientEmail = client.email; clientName = client.name }
  }

  // Économie de la semaine — MÊME moteur que l'onglet Facturation (lib/week-economics).
  let economics: WeekEconomics | null = null
  if (clientId) {
    try {
      economics = await computeWeekEconomics(serviceSupabase, clientId, data.week_number, data.year, {
        ca_total: data.financier_n.ca_net,
        familles: data.ventes_n.familles.map(f => ({ nom: f.nom, montant: f.total_montant })),
      })
    } catch (ecoErr) {
      console.error('Economie hebdo indisponible pour le rapport:', ecoErr)
    }
  }

  // Historisation AVANT le livrable : en cas d'échec, rien n'est produit.
  if (clientId) {
    try {
      await archiveWeekData(serviceSupabase, clientId, data.week_number, data.year, data.financier_n, data.ventes_n.familles, data.prodN, data.prodFamN)
      await archiveWeekData(serviceSupabase, clientId, data.week_number, data.year - 1, data.financier_n1, data.ventes_n1.familles, data.prodN1, data.prodFamN1)
    } catch (archErr) {
      console.error('Historisation impossible:', archErr)
      return NextResponse.json({
        error: "Les donnees de la semaine n'ont pas pu etre enregistrees, le rapport n'a donc pas ete genere (aucun email envoye). "
          + (archErr instanceof Error ? archErr.message : String(archErr)),
      }, { status: 500 })
    }
  }

  const report: ComputedReport = {
    data, clientName, insights: insightsResult,
    pieBuffer,
    tops: data.tops, flops: data.flops, famRows, caVar,
    status: buildStatus(caVar),
    execSummary: buildExecSummary(data, famRows, caVar),
    economics,
    margeRead: buildMargeRead(economics, data.week_number),
  }
  const pdfBuffer = await generatePDF(report)

  // Rapport confidentiel : chemin PAR CLIENT (non devinable), aucune URL publique.
  const fileName = `rapport-s${data.week_number}-${data.year}-${Date.now()}.pdf`
  const filePath = clientId ? `${clientId}/${fileName}` : fileName
  const { error: uploadError } = await serviceSupabase.storage.from('reports').upload(
    filePath, pdfBuffer, { contentType: 'application/pdf', upsert: false },
  )
  if (uploadError) return NextResponse.json({ error: 'Upload: ' + uploadError.message }, { status: 500 })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://getpilote.app'
  const reportsPageUrl = `${appUrl}/dashboard/reports`

  const title = `Analyse S${data.week_number} - ${data.period_n}${clientName ? ' - ' + clientName : ''}`
  const { data: reportRow, error: dbError } = await serviceSupabase.from('reports').insert({
    profile_id: profile.id, title,
    week_number: data.week_number, year: data.year,
    file_url: filePath, file_path: filePath,
    ...(clientId ? { client_id: clientId } : {}),
  }).select('id').single()
  if (dbError) return NextResponse.json({ error: 'DB: ' + dbError.message }, { status: 500 })

  // Clôture de la trace : statut final + rapport lié + corrections humaines.
  if (opts.extractionId) {
    const validated = !!(opts.overrides && opts.overrides.length > 0)
    await finalizeExtraction(serviceSupabase, opts.extractionId, {
      status: validated ? 'validee_humain' : 'generee',
      reportId: reportRow?.id ? String(reportRow.id) : null,
      overrides: opts.overrides,
      validatedBy: validated ? userEmail : null,
    })
  }

  // Email non bloquant.
  try {
    const toEmail = clientEmail || profile.delivery_email || userEmail || ''
    if (toEmail) {
      const resend = new Resend(process.env.RESEND_API_KEY ?? '')
      await resend.emails.send({
        from: 'PILOTE <onboarding@resend.dev>',
        to: toEmail,
        subject: `Rapport hebdomadaire ${title}`,
        html: `<div style="font-family:'Plus Jakarta Sans','Segoe UI',system-ui,-apple-system,sans-serif;max-width:600px;margin:0 auto;background:#ffffff">
  <div style="background:#1E3A5F;padding:36px 40px 32px">
    <div style="font-size:15px;font-weight:800;letter-spacing:4px;color:#ffffff;margin-bottom:22px">PILOTE<span style="color:#FF8C00">.</span></div>
    <div style="font-size:11px;font-weight:600;letter-spacing:2px;color:#c5d2e2;text-transform:uppercase;margin-bottom:6px">Semaine ${data.week_number} · ${data.year}</div>
    <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:800;letter-spacing:-0.5px">Votre rapport hebdomadaire est prêt</h1>
    <div style="width:44px;height:3px;background:#FF8C00;border-radius:2px;margin-top:16px"></div>
  </div>
  <div style="padding:32px 40px;border:1px solid #e4eaf1;border-top:none;border-radius:0 0 12px 12px">
    <p style="color:#111827;font-size:15px;font-weight:700;margin:0 0 6px">${title}</p>
    <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0 0 24px">Marge &amp; coûts réels · Analyse IA · Graphique de répartition · Top &amp; Flop produits · Synthèse de la semaine</p>
    <div style="background:#f2f5f9;border-left:3px solid #1E3A5F;border-radius:6px;padding:14px 16px;margin-bottom:28px">
      <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:#1E3A5F;text-transform:uppercase;margin-bottom:4px">Période analysée</div>
      <div style="color:#374151;font-size:13px">${data.period_n} — comparée à ${data.period_n1}</div>
    </div>
    <div style="text-align:center;margin-bottom:28px">
      <a href="${reportsPageUrl}" style="display:inline-block;background:#1E3A5F;color:#ffffff;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">Consulter mon rapport</a>
    </div>
    <p style="color:#9ca3af;font-size:11px;text-align:center;margin:0;border-top:1px solid #f3f4f6;padding-top:16px">Rapport confidentiel · Généré automatiquement par <span style="font-weight:700;color:#1E3A5F">PILOTE<span style="color:#FF8C00">.</span></span></p>
  </div>
</div>`,
      })
    }
  } catch (emailErr) {
    console.error('Email rapport non envoye:', emailErr)
  }

  return NextResponse.json({
    success: true, title, file_url: reportsPageUrl,
    status: opts.overrides && opts.overrides.length > 0 ? 'validee_humain' : 'genere',
  })
}

/** Corrections humaines reçues de l'écran de validation → liste sûre. */
function parseOverrides(raw: unknown): FamilyOverride[] {
  if (!Array.isArray(raw)) return []
  const out: FamilyOverride[] = []
  for (const o of raw as Record<string, unknown>[]) {
    const cote = o?.cote === 'n1' ? 'n1' : 'n'
    const nom = String(o?.nom ?? '').trim()
    const montant = Number(o?.montant)
    if (nom && Number.isFinite(montant) && montant >= 0) out.push({ cote, nom, montant })
  }
  return out
}

// ─── POST Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non authentifie' }, { status: 401 })
    const { data: profile } = await supabase.from('profiles').select('*').eq('user_id', user.id).single()
    if (!profile) return NextResponse.json({ error: 'Profil introuvable' }, { status: 404 })

    const serviceSupabase = createServiceClient()
    const contentType = req.headers.get('content-type') || ''

    // ══ Mode 2 (lot V3) : génération APRÈS validation humaine ══
    // On repart de l'extraction déjà archivée + corrections — aucune relecture
    // des PDF, aucun nouvel appel IA (déterministe, tient dans les 60 s).
    if (contentType.includes('application/json')) {
      const body = await req.json().catch(() => ({} as Record<string, unknown>))
      const extractionId = String((body as any).extraction_id || '')
      if (!extractionId) return NextResponse.json({ error: 'extraction_id requis' }, { status: 400 })
      const row = await loadExtractionRow(serviceSupabase, extractionId)
      if (!row) return NextResponse.json({ error: 'Extraction introuvable' }, { status: 404 })
      const overrides = parseOverrides((body as any).overrides)
      const data = deserializeExtraction(row.extraction, overrides)
      if (data.financier_n.ca_net <= 0) {
        return NextResponse.json({ error: 'Extraction sans chiffre d\'affaires — regenerez depuis les fichiers.' }, { status: 400 })
      }
      return await produceReport(serviceSupabase, profile, user.email ?? null, row.client_id, data, { extractionId, overrides })
    }

    // ══ Mode 1 : extraction depuis les 4 PDF ══
    const formData = await req.formData()
    const clientId = (formData.get('clientId') as string) || null
    const finN  = formData.get('financier_n')  as File
    const finN1 = formData.get('financier_n1') as File
    const venN  = formData.get('ventes_n')     as File
    const venN1 = formData.get('ventes_n1')    as File
    if (!finN || !finN1 || !venN || !venN1)
      return NextResponse.json({ error: 'Les 4 fichiers PDF sont requis' }, { status: 400 })

    const [tFN, tFN1, tVN, tVN1] = await Promise.all([
      parsePDF(finN), parsePDF(finN1), parsePDF(venN), parsePDF(venN1),
    ])

    const data = await extractData({ fin_n: tFN, fin_n1: tFN1, ventes_n: tVN, ventes_n1: tVN1 })

    // ── Contrôles déterministes (lot V2) — zéro IA, seuils calibrés sur
    // l'historique réel. Le contexte est lu AVANT toute écriture : l'archive N-1
    // de l'an dernier sert de témoin avant écrasement.
    const sha = async (f: File) => createHash('sha256').update(Buffer.from(await f.arrayBuffer())).digest('hex')
    const [hFN, hFN1, hVN, hVN1] = await Promise.all([sha(finN), sha(finN1), sha(venN), sha(venN1)])
    const checksCtx: ChecksContext = {
      fileHashes: { financier_n: hFN, financier_n1: hFN1, ventes_n: hVN, ventes_n1: hVN1 },
      weekN1: weekFromPeriod(data.period_n1),
    }
    if (clientId) {
      const [{ data: hist }, { data: prevN1 }] = await Promise.all([
        serviceSupabase.from('weekly_ca').select('ca_total, week_number, year')
          .eq('client_id', clientId)
          .order('year', { ascending: false }).order('week_number', { ascending: false }).limit(9),
        serviceSupabase.from('weekly_ca').select('ca_total')
          .eq('client_id', clientId)
          .eq('week_number', data.week_number).eq('year', data.year - 1).maybeSingle(),
      ])
      checksCtx.historyCa = (hist || [])
        .filter((r: any) => !(r.week_number === data.week_number && r.year === data.year))
        .map((r: any) => parseFloat(String(r.ca_total)) || 0)
        .filter((n: number) => n > 0)
        .slice(0, 8)
      checksCtx.previousN1 = prevN1 ? { ca_total: parseFloat(String((prevN1 as any).ca_total)) || 0 } : null
    }
    const serialized = serializeExtraction(data)
    const checks = runExtractionChecks(serialized, checksCtx)
    const checksStatus = statusFromChecks(checks)

    // ── Traçabilité (lot V1) — AVANT tout garde-fou : les extractions ratées
    // sont les plus précieuses à archiver. Best-effort, jamais bloquant.
    let extractionId: string | null = null
    try {
      const sourcePaths = await storeReportSources(serviceSupabase, clientId, data.week_number, data.year, {
        financier_n: finN, financier_n1: finN1, ventes_n: venN, ventes_n1: venN1,
      })
      extractionId = await storeExtraction(serviceSupabase, {
        clientId, week: data.week_number, year: data.year,
        files: sourcePaths,
        rawTexts: { financier_n: tFN, financier_n1: tFN1, ventes_n: tVN, ventes_n1: tVN1 },
        extraction: serialized,
        checks, status: checksStatus,
      })
    } catch (traceErr) {
      console.error('Traçabilité extraction indisponible:', traceErr)
    }

    // Garde-fou : aucun CA détecté dans le Relevé Financier = mauvais fichier.
    if (data.financier_n.ca_net <= 0) {
      return NextResponse.json({
        error: 'Aucun chiffre d\'affaires detecte dans le " Releve Financier - Semaine N ". Verifiez que les fichiers ne sont pas inverses : le Releve Financier va dans les 2 premiers champs, les Ventes par familles dans les 2 derniers.',
        checks,
      }, { status: 400 })
    }

    // ── LA PORTE (lot V3) : tant que les contrôles ne sont pas au vert, le
    // rapport N'EST PAS produit. On renvoie de quoi le valider — les chiffres
    // douteux, à côté de leur origine — pour correction sur l'écran admin.
    // Rien n'est historisé, uploadé ni envoyé avant validation.
    if (checksStatus !== 'vert') {
      return NextResponse.json({
        needs_validation: true,
        extraction_id: extractionId,
        status: checksStatus,
        checks,
        week_number: data.week_number,
        year: data.year,
        period_n: data.period_n,
        period_n1: data.period_n1,
        ca_n: data.financier_n.ca_net,
        ca_n1: data.financier_n1.ca_net,
        familles_n: serialized.ventes_n.familles,
        familles_n1: serialized.ventes_n1.familles,
      }, { status: 200 })
    }

    // Contrôles au vert → génération directe, sans friction (cible « 0 minute »).
    return await produceReport(serviceSupabase, profile, user.email ?? null, clientId, data, { extractionId, overrides: null })

  } catch (err: unknown) {
    console.error(err)
    const _e = err instanceof Error ? err : new Error(String(err))
    return NextResponse.json({
      error: _e.message + ' || STACK: ' + (_e.stack || '').replace(/\n/g, ' > ').slice(0, 600),
    }, { status: 500 })
  }
}
