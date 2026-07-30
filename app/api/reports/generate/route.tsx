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
import { parsePDF, extractData } from './report-extract'
import { archiveWeekData } from './report-persist'
import { buildFamRows, buildStatus, buildMargeRead, buildExecSummary, generateInsights } from './report-compute'
import { getPieBuffer } from './report-chart'
import type { ComputedReport, ReportData } from './report-types'
import type { WeekEconomics } from '@/lib/week-economics'

export const maxDuration = 60

// Le cast contourne le typage de renderToBuffer, qui exige un ReactElement<DocumentProps>
// alors que PiloteReport rend bien un <Document>. Même contournement que dans
// app/api/valorisations/pdf/route.tsx.
async function generatePDF(report: ComputedReport): Promise<Buffer> {
  await ensureFonts()
  return renderToBuffer(React.createElement(PiloteReport, { r: report }) as any)
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

    // Garde-fou : si aucun CA n'est detecte dans le Releve Financier, le fichier est
    // probablement le mauvais (souvent une inversion Financier <-> Ventes par familles)
    if (data.financier_n.ca_net <= 0) {
      return NextResponse.json({
        error: 'Aucun chiffre d\'affaires detecte dans le " Releve Financier - Semaine N ". Verifiez que les fichiers ne sont pas inverses : le Releve Financier va dans les 2 premiers champs, les Ventes par familles dans les 2 derniers.',
      }, { status: 400 })
    }

    const famRows = buildFamRows(data.ventes_n, data.ventes_n1)
    const caVar = data.financier_n1.ca_net
      ? (data.financier_n.ca_net - data.financier_n1.ca_net) / data.financier_n1.ca_net
      : 0

    const [insightsResult, pieBuffer] = await Promise.all([
      generateInsights(data, famRows),
      getPieBuffer(data),
    ])

    let clientEmail: string | null = null
    let clientName:  string | null = null
    if (clientId) {
      const { data: client } = await serviceSupabase.from('clients').select('email, name').eq('id', clientId).single()
      if (client) { clientEmail = client.email; clientName = client.name }
    }

    // Économie de la semaine — MÊME moteur que l'onglet Facturation (lib/week-economics).
    // Le CA lui est passé tel qu'archiveWeekData l'écrira quelques lignes plus bas dans
    // weekly_ca (ca_net + familles), pour que le PDF et l'écran affichent le même total.
    // Non bloquant : un rapport doit sortir même si cette partie échoue.
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

    // Historisation AVANT le livrable : archiveWeekData remonte désormais les erreurs
    // Supabase (elle les avalait, et une semaine pouvait disparaître de weekly_ca en
    // silence). La placer ici évite l'état bâtard « PDF uploadé + email parti + 500 à
    // l'écran » : en cas d'échec, rien n'est produit et le message est explicite.
    if (clientId) {
      try {
        // Semaine N ET semaine N-1 (même semaine, année précédente).
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

    // Rapport confidentiel (CA, marges, masse salariale) : chemin PAR CLIENT (non
    // devinable) et AUCUNE URL publique n'est générée. Le bucket `reports` est
    // privé ; le PDF est servi par URL signée courte à l'affichage (espace client
    // et espace admin). On stocke le CHEMIN de l'objet, jamais un lien public.
    const fileName = `rapport-s${data.week_number}-${data.year}-${Date.now()}.pdf`
    const filePath = clientId ? `${clientId}/${fileName}` : fileName
    const { error: uploadError } = await serviceSupabase.storage.from('reports').upload(
      filePath, pdfBuffer, { contentType: 'application/pdf', upsert: false },
    )
    if (uploadError) return NextResponse.json({ error: 'Upload: ' + uploadError.message }, { status: 500 })

    // L'email pointe vers l'espace client (page rapports), jamais vers un lien
    // direct : le rapport ne se télécharge qu'authentifié.
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://getpilote.app'
    const reportsPageUrl = `${appUrl}/dashboard/reports`

    const title = `Analyse S${data.week_number} - ${data.period_n}${clientName ? ' - ' + clientName : ''}`
    const { error: dbError } = await serviceSupabase.from('reports').insert({
      profile_id: profile.id, title,
      week_number: data.week_number, year: data.year,
      file_url: filePath, file_path: filePath,
      ...(clientId ? { client_id: clientId } : {}),
    })
    if (dbError) return NextResponse.json({ error: 'DB: ' + dbError.message }, { status: 500 })

    // Email non bloquant : un echec Resend ne doit ni planter ni ralentir la generation
    try {
      const toEmail = clientEmail || profile.delivery_email || user.email || ''
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

    return NextResponse.json({ success: true, title, file_url: reportsPageUrl })

  } catch (err: unknown) {
    console.error(err)
    const _e = err instanceof Error ? err : new Error(String(err))
    return NextResponse.json({
      error: _e.message + ' || STACK: ' + (_e.stack || '').replace(/\n/g, ' > ').slice(0, 600),
    }, { status: 500 })
  }
}
