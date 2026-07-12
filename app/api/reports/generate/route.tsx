// ⚠️  Ce fichier doit être nommé route.tsx (supprimer route.ts)
// Dépendances : @react-pdf/renderer, pdf-parse, @anthropic-ai/sdk, resend
if (typeof globalThis.DOMMatrix === 'undefined') {
  ;(globalThis as Record<string, unknown>).DOMMatrix = class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import React from 'react'
import {
  Document, Page, Text, View, Image, StyleSheet, renderToBuffer,
} from '@react-pdf/renderer'
import { Resend } from 'resend'

export const maxDuration = 60

// ─── Types ──────────────────────────────────────────────────────────────────
interface Produit { plu: string; designation: string; ventes: number; montant: number }
interface Famille { id: string; nom: string; total_montant: number; produits: Produit[] }
interface FinancierData { ca_net: number; nb_tickets: number; moyenne_ticket: number }
interface ReportData {
  period_n: string; period_n1: string; week_number: number; year: number
  financier_n: FinancierData; financier_n1: FinancierData
  ventes_n: { total: number; familles: Famille[] }
  ventes_n1: { total: number; familles: Famille[] }
  tops: { designation: string; n: number; ecart: number }[]
  flops: { designation: string; n: number; ecart: number }[]
}
// Données extraites complètes : ReportData + CA par produit (pour l'historisation)
interface ExtractedData extends ReportData {
  prodN: Map<string, number>
  prodN1: Map<string, number>
}
interface Insights { resume: string; insights: string[]; recommendations: string[]; vigilance: string[] }
interface FamRow { nom: string; caN: number; caN1: number | null; ecart: number }
interface WeekStatus { label: string; color: string; light: string; desc: string }
interface ComputedReport {
  data: ReportData
  clientName: string | null
  insights: Insights
  pieBuffer: Buffer
  tops: { designation: string; n: number; ecart: number }[]
  flops: { designation: string; n: number; ecart: number }[]
  famRows: FamRow[]
  caVar: number
  status: WeekStatus
  execSummary: string
}

// ─── Formatters ────────────────────────────────────────────────────────────
// NE PAS utiliser toLocaleString('fr-FR') — produit U+202F que Helvetica rend '/'
const eur = (n: number) => {
  const abs = Math.abs(n)
  const [int, dec] = abs.toFixed(2).split('.')
  const intFmt = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return (n < 0 ? '-' : '') + intFmt + ',' + dec + ' €'
}
const eur0 = (n: number) => {
  const abs = Math.abs(n)
  const intFmt = Math.round(abs).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return (n < 0 ? '-' : '') + intFmt + ' €'
}
const signEur = (n: number) => (n >= 0 ? '+' : '') + eur(n)
const signPct = (n: number) => (n >= 0 ? '+' : '') + (n * 100).toFixed(1) + '%'
const pctStr = (n: number) => (n * 100).toFixed(1) + '%'
const trunc = (s: string, len: number) => (s.length > len ? s.slice(0, len - 1) + '...' : s)

// Nettoie les textes IA : caractères que Helvetica (WinAnsi) rend mal
const sanitize = (s: string) => (s || '')
  .replace(/[‘’ʼ]/g, "'")
  .replace(/[“”«»]/g, '"')
  .replace(/[–—]/g, '-')
  .replace(/…/g, '...')
  .replace(/[   ]/g, ' ')
  .replace(/[▲▼→←➡➔]/g, '')
  .replace(/[^\x00-\xFF]/g, '')
  .trim()
  .slice(0, 320)

// ─── Palette ──────────────────────────────────────────────────────────────
const C = {
  navy:        '#1E3A5F',
  blue:        '#2D5986',
  lightBlue:   '#E8F0FE',
  blueMid:     '#90CAF9',
  orange:      '#FF8C00',
  lightOrange: '#FFF3E0',
  amber:       '#D97706',
  lightAmber:  '#FEF3C7',
  green:       '#2E7D32',
  lightGreen:  '#E6F4EA',
  red:         '#C62828',
  lightRed:    '#FCE8E6',
  gray:        '#F0F4F8',
  grayMid:     '#DCE4EC',
  line:        '#E0E0E0',
  textDark:    '#1A1A1A',
  textMid:     '#444444',
  textLight:   '#888888',
  white:       '#FFFFFF',
}

// ─── Styles ───────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  coverBlueBg:    { backgroundColor: C.navy, padding: 56, paddingBottom: 44, flexGrow: 1 },
  coverTagRow:    { flexDirection: 'row', alignItems: 'center', marginBottom: 44 },
  coverTagDot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: C.orange, marginRight: 6 },
  coverTagText:   { color: C.orange, fontSize: 10, letterSpacing: 4 },
  coverTitle:     { color: C.white, fontSize: 40, fontFamily: 'Helvetica-Bold', lineHeight: 1.15, marginBottom: 10 },
  coverSub:       { color: C.blueMid, fontSize: 13, marginBottom: 30 },
  coverDivider:   { width: 52, height: 3, backgroundColor: C.orange, marginBottom: 24 },
  coverWeek:      { color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 21, marginBottom: 4 },
  coverPeriod:    { color: C.blueMid, fontSize: 11, marginBottom: 26 },
  coverKpiRow:    { flexDirection: 'row', marginTop: 8 },
  coverKpi:       { flex: 1, borderLeftWidth: 2, borderLeftColor: C.orange, paddingLeft: 10, marginRight: 16 },
  coverKpiLabel:  { color: C.blueMid, fontSize: 7.5, letterSpacing: 1.5, marginBottom: 3 },
  coverKpiValue:  { color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 15 },
  coverWhiteBg:   { backgroundColor: C.white, paddingVertical: 30, paddingHorizontal: 56, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  coverLabel:     { color: C.textLight, fontSize: 8, letterSpacing: 2, marginBottom: 3 },
  coverClient:    { color: C.navy, fontFamily: 'Helvetica-Bold', fontSize: 14 },
  coverMeta:      { color: C.textLight, fontSize: 8, marginBottom: 2, textAlign: 'right' },

  page:           { backgroundColor: C.white, paddingTop: 0, paddingBottom: 42, paddingHorizontal: 0 },
  secHeader:      { flexDirection: 'row', alignItems: 'center', backgroundColor: C.navy, paddingVertical: 11, paddingHorizontal: 36, marginBottom: 18 },
  secHeaderNum:   { color: C.orange, fontFamily: 'Helvetica-Bold', fontSize: 11, marginRight: 10, letterSpacing: 1 },
  secHeaderText:  { color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 11, letterSpacing: 1 },
  footer:         { position: 'absolute', bottom: 20, left: 36, right: 36, flexDirection: 'row', justifyContent: 'space-between', borderTopColor: C.line, borderTopWidth: 0.5, paddingTop: 6 },
  footerText:     { fontSize: 7.5, color: C.textLight },

  execBox:        { marginHorizontal: 36, marginBottom: 16, backgroundColor: C.lightBlue, borderLeftWidth: 3, borderLeftColor: C.navy, borderRadius: 4, padding: 12 },
  execLabel:      { fontSize: 7.5, letterSpacing: 1.5, color: C.blue, marginBottom: 4, fontFamily: 'Helvetica-Bold' },
  execText:       { fontSize: 9.5, color: C.textMid, lineHeight: 1.5 },

  kpiRow:         { flexDirection: 'row', paddingHorizontal: 36, marginBottom: 10 },
  kpiBox:         { flex: 1, borderRadius: 6, padding: 14, marginRight: 8 },
  kpiLabel:       { fontSize: 8, letterSpacing: 1, marginBottom: 6 },
  kpiValue:       { fontFamily: 'Helvetica-Bold', fontSize: 17, color: C.white },
  kpiSub:         { fontSize: 9, marginTop: 3 },

  tableWrap:      { paddingHorizontal: 36 },
  tHead:          { flexDirection: 'row', backgroundColor: C.blue, paddingVertical: 7, paddingHorizontal: 8 },
  tHeadCell:      { color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 8 },
  tRow:           { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 8, borderBottomColor: C.line, borderBottomWidth: 0.5 },
  tRowAlt:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 8, backgroundColor: C.gray, borderBottomColor: C.line, borderBottomWidth: 0.5 },
  tTotal:         { flexDirection: 'row', paddingVertical: 7, paddingHorizontal: 8, backgroundColor: C.navy },
  tCell:          { fontSize: 8.5, color: C.textDark },
  tCellB:         { fontSize: 8.5, color: C.textDark, fontFamily: 'Helvetica-Bold' },
  tCellR:         { fontSize: 8.5, color: C.textDark, textAlign: 'right' },
  tCellRB:        { fontSize: 8.5, color: C.textDark, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  tCellGreen:     { fontSize: 8.5, color: C.green, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  tCellRed:       { fontSize: 8.5, color: C.red, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  tTotalCell:     { fontSize: 8.5, color: C.white, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  tTotalCellL:    { fontSize: 8.5, color: C.white, fontFamily: 'Helvetica-Bold' },

  shareBarBg:     { height: 5, backgroundColor: C.grayMid, borderRadius: 2.5, flex: 1, marginLeft: 6, marginRight: 6 },
  shareBarFill:   { height: 5, backgroundColor: C.navy, borderRadius: 2.5 },

  chartWrap:      { alignItems: 'center', paddingHorizontal: 36, marginBottom: 8 },
  chartCaption:   { fontSize: 8, color: C.textLight, textAlign: 'center', marginTop: 4, paddingHorizontal: 36 },

  insightBlock:   { paddingHorizontal: 36 },
  insightRow:     { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 11 },
  insightBullet:  { width: 20, height: 20, borderRadius: 10, backgroundColor: C.navy, alignItems: 'center', justifyContent: 'center', marginRight: 12, flexShrink: 0 },
  recoBullet:     { width: 20, height: 20, borderRadius: 10, backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center', marginRight: 12, flexShrink: 0 },
  bulletNum:      { color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 8 },
  insightText:    { fontSize: 9.5, color: C.textMid, flex: 1, lineHeight: 1.55 },
  vigilanceBox:   { marginHorizontal: 36, marginTop: 4, marginBottom: 14, backgroundColor: C.lightAmber, borderLeftWidth: 3, borderLeftColor: C.amber, borderRadius: 4, padding: 11 },
  vigilanceTitle: { fontSize: 8, letterSpacing: 1.5, color: C.amber, fontFamily: 'Helvetica-Bold', marginBottom: 5 },
  vigilanceText:  { fontSize: 9, color: '#7C4A03', lineHeight: 1.5, marginBottom: 3 },

  topFlopWrap:    { flexDirection: 'row', paddingHorizontal: 36 },
  topFlopLeft:    { flex: 1, marginRight: 10 },
  topFlopRight:   { flex: 1, marginLeft: 10 },
  rankChip:       { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: 6 },
  rankChipText:   { fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.white },

  statusBanner:   { marginHorizontal: 36, borderRadius: 8, padding: 18, marginBottom: 18 },
  statusLabel:    { color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 16, marginBottom: 4, letterSpacing: 0.5 },
  statusDesc:     { color: C.white, fontSize: 9.5, opacity: 0.9, lineHeight: 1.5 },
  recapGrid:      { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 30 },
  recapCard:      { width: '31%', marginHorizontal: '1.16%', marginBottom: 10, backgroundColor: C.gray, borderRadius: 6, padding: 11 },
  recapLabel:     { fontSize: 7, letterSpacing: 1, color: C.textLight, marginBottom: 4 },
  recapValue:     { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.navy },
  recapSub:       { fontSize: 7.5, color: C.textLight, marginTop: 2 },
  actionBox:      { marginHorizontal: 36, marginTop: 8, backgroundColor: C.lightOrange, borderLeftWidth: 3, borderLeftColor: C.orange, borderRadius: 4, padding: 13 },
  actionLabel:    { fontSize: 8, letterSpacing: 1.5, color: C.orange, fontFamily: 'Helvetica-Bold', marginBottom: 5 },
  actionText:     { fontSize: 10, color: '#7A4100', lineHeight: 1.55, fontFamily: 'Helvetica-Bold' },
})

// ─── PDF Sub-components ───────────────────────────────────────────────────

const SecHeader = ({ num, title }: { num: string; title: string }) => (
  <View style={S.secHeader}>
    <Text style={S.secHeaderNum}>{num}</Text>
    <Text style={S.secHeaderText}>{title}</Text>
  </View>
)

const Footer = ({ page, week, year }: { page: number; week: number; year: number }) => (
  <View style={S.footer} fixed>
    <Text style={S.footerText}>PILOTE - Rapport S{week}/{year} - Document confidentiel</Text>
    <Text style={S.footerText}>Page {page} / 7</Text>
  </View>
)

const KpiBox = ({ label, value, sub, bg, subColor }: { label: string; value: string; sub?: string; bg: string; subColor?: string }) => (
  <View style={[S.kpiBox, { backgroundColor: bg }]}>
    <Text style={[S.kpiLabel, { color: `${C.white}99` }]}>{label}</Text>
    <Text style={S.kpiValue}>{value}</Text>
    {sub && <Text style={[S.kpiSub, { color: subColor ?? `${C.white}BB` }]}>{sub}</Text>}
  </View>
)

const ShareBar = ({ pct }: { pct: number }) => (
  <View style={S.shareBarBg}>
    <View style={[S.shareBarFill, { width: `${Math.min(100, Math.max(0, pct * 100)).toFixed(1)}%` }]} />
  </View>
)

// ─── PDF Document ───────────────────────────────────────────────────────────

const PiloteReport = ({ r }: { r: ComputedReport }) => {
  const { data, clientName, insights, pieBuffer, tops, flops, famRows, caVar, status, execSummary } = r
  const { financier_n: fn, financier_n1: fn1, ventes_n: vn, ventes_n1: vn1 } = data
  const generatedOn = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })

  const sortedByEcart = [...famRows].sort((a, b) => b.ecart - a.ecart)
  const bestFam  = sortedByEcart[0]
  const worstFam = sortedByEcart[sortedByEcart.length - 1]
  const topProduct  = tops[0]
  const flopProduct = flops[0]
  const vigilance = insights.vigilance ?? []

  return (
    <Document title={`Rapport S${data.week_number} - ${data.period_n}`} author="PILOTE" language="fr">

      {/* PAGE 1 - COUVERTURE */}
      <Page size="A4" style={{ backgroundColor: C.white }}>
        <View style={S.coverBlueBg}>
          <View style={S.coverTagRow}>
            <View style={S.coverTagDot} />
            <Text style={S.coverTagText}>PILOTE</Text>
          </View>
          <Text style={S.coverTitle}>Rapport{'\n'}Hebdomadaire</Text>
          <Text style={S.coverSub}>Analyse comparative des ventes et pilotage de la performance</Text>
          <View style={S.coverDivider} />
          <Text style={S.coverWeek}>Semaine {data.week_number} - {data.year}</Text>
          <Text style={S.coverPeriod}>{data.period_n}</Text>
          <View style={S.coverKpiRow}>
            <View style={S.coverKpi}>
              <Text style={S.coverKpiLabel}>CA DE LA SEMAINE</Text>
              <Text style={S.coverKpiValue}>{eur0(fn.ca_net)}</Text>
            </View>
            <View style={[S.coverKpi, { borderLeftColor: caVar >= 0 ? '#4CAF50' : '#EF5350' }]}>
              <Text style={S.coverKpiLabel}>VS MEME SEMAINE {data.year - 1}</Text>
              <Text style={[S.coverKpiValue, { color: caVar >= 0 ? '#81C784' : '#EF9A9A' }]}>{signPct(caVar)}</Text>
            </View>
            <View style={S.coverKpi}>
              <Text style={S.coverKpiLabel}>TICKETS</Text>
              <Text style={S.coverKpiValue}>{String(fn.nb_tickets)}</Text>
            </View>
            <View style={S.coverKpi}>
              <Text style={S.coverKpiLabel}>PANIER MOYEN</Text>
              <Text style={S.coverKpiValue}>{eur(fn.moyenne_ticket)}</Text>
            </View>
          </View>
        </View>
        <View style={S.coverWhiteBg}>
          <View>
            {clientName ? (
              <>
                <Text style={S.coverLabel}>CLIENT</Text>
                <Text style={S.coverClient}>{clientName.toUpperCase()}</Text>
              </>
            ) : (
              <Text style={S.coverClient}>BOUCHERIE ARTISANALE</Text>
            )}
          </View>
          <View>
            <Text style={S.coverMeta}>Genere le {generatedOn}</Text>
            <Text style={S.coverMeta}>Periode comparee (N-1) : {data.period_n1}</Text>
            <Text style={S.coverMeta}>7 pages - Analyse IA - Graphique - Synthese de semaine</Text>
          </View>
        </View>
      </Page>

      {/* PAGE 2 - SYNTHESE FINANCIERE */}
      <Page size="A4" style={S.page}>
        <SecHeader num="01" title="SYNTHESE FINANCIERE" />
        <View style={S.execBox}>
          <Text style={S.execLabel}>RESUME EXECUTIF</Text>
          <Text style={S.execText}>{execSummary}</Text>
        </View>
        <Text style={{ paddingHorizontal: 36, fontSize: 9, color: C.textLight, marginBottom: 8 }}>CHIFFRE D'AFFAIRES</Text>
        <View style={S.kpiRow}>
          <KpiBox label="CA SEMAINE N" value={eur(fn.ca_net)} sub={`S${data.week_number} - ${data.year}`} bg={C.navy} />
          <KpiBox label="CA SEMAINE N-1" value={eur(fn1.ca_net)} sub={`S${data.week_number} - ${data.year - 1}`} bg={C.blue} />
          <KpiBox label="VARIATION" value={signPct(caVar)} sub={signEur(fn.ca_net - fn1.ca_net)} bg={caVar >= 0 ? C.green : C.red} />
        </View>
        <Text style={{ paddingHorizontal: 36, fontSize: 9, color: C.textLight, marginTop: 4, marginBottom: 8 }}>TICKETS &amp; PANIER</Text>
        <View style={[S.kpiRow, { marginBottom: 18 }]}>
          <KpiBox label="TICKETS N" value={String(fn.nb_tickets)} sub={`${fn.nb_tickets - fn1.nb_tickets >= 0 ? '+' : ''}${fn.nb_tickets - fn1.nb_tickets} vs N-1`} bg={fn.nb_tickets >= fn1.nb_tickets ? C.green : C.red} />
          <KpiBox label="TICKETS N-1" value={String(fn1.nb_tickets)} sub={`S${data.week_number} - ${data.year - 1}`} bg={C.blue} />
          <KpiBox label="PANIER MOYEN" value={eur(fn.moyenne_ticket)} sub={`N-1 : ${eur(fn1.moyenne_ticket)}`} bg={fn.moyenne_ticket >= fn1.moyenne_ticket ? C.green : C.red} />
        </View>
        <Text style={{ paddingHorizontal: 36, fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: C.navy, marginBottom: 10 }}>Recapitulatif par famille de produits</Text>
        <View style={S.tableWrap}>
          <View style={S.tHead}>
            <Text style={[S.tHeadCell, { flex: 3 }]}>FAMILLE</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>CA N (€)</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>CA N-1 (€)</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>ECART (€)</Text>
            <Text style={[S.tHeadCell, { flex: 1.2, textAlign: 'right' }]}>% CA</Text>
            <Text style={[S.tHeadCell, { flex: 1, textAlign: 'center' }]}>TEND.</Text>
          </View>
          {famRows.map((fam, i) => {
            const w = vn.total ? fam.caN / vn.total : 0
            return (
              <View key={i} style={i % 2 === 0 ? S.tRow : S.tRowAlt}>
                <Text style={[S.tCellB, { flex: 3 }]}>{trunc(fam.nom, 28)}</Text>
                <Text style={[S.tCellR, { flex: 2 }]}>{eur(fam.caN)}</Text>
                <Text style={[S.tCellR, { flex: 2 }]}>{fam.caN1 !== null ? eur(fam.caN1) : '-'}</Text>
                <Text style={[fam.ecart >= 0 ? S.tCellGreen : S.tCellRed, { flex: 2 }]}>{signEur(fam.ecart)}</Text>
                <Text style={[S.tCellRB, { flex: 1.2 }]}>{pctStr(w)}</Text>
                <Text style={[fam.ecart >= 0 ? S.tCellGreen : S.tCellRed, { flex: 1, textAlign: 'center' }]}>{fam.ecart >= 0 ? '+' : '-'}</Text>
              </View>
            )
          })}
          <View style={S.tTotal}>
            <Text style={[S.tTotalCellL, { flex: 3 }]}>TOTAL GENERAL</Text>
            <Text style={[S.tTotalCell, { flex: 2 }]}>{eur(vn.total)}</Text>
            <Text style={[S.tTotalCell, { flex: 2 }]}>{eur(vn1.total)}</Text>
            <Text style={[S.tTotalCell, { flex: 2 }]}>{signEur(vn.total - vn1.total)}</Text>
            <Text style={[S.tTotalCell, { flex: 1.2 }]}>100%</Text>
            <Text style={[S.tTotalCell, { flex: 1, textAlign: 'center' }]}>{vn.total >= vn1.total ? '+' : '-'}</Text>
          </View>
        </View>
        <Footer page={2} week={data.week_number} year={data.year} />
      </Page>

      {/* PAGE 3 - REPARTITION CA */}
      <Page size="A4" style={S.page}>
        <SecHeader num="02" title="REPARTITION DU CA PAR FAMILLE" />
        <View style={S.chartWrap}>
          <Image src={{ data: pieBuffer, format: 'png' }} style={{ width: 490, height: 275 }} />
        </View>
        <Text style={S.chartCaption}>Repartition du CA par famille (€ TTC) - Semaine {data.week_number} {data.year}</Text>
        <View style={[S.tableWrap, { marginTop: 14 }]}>
          <View style={S.tHead}>
            <Text style={[S.tHeadCell, { flex: 2.6 }]}>FAMILLE</Text>
            <Text style={[S.tHeadCell, { flex: 1.8, textAlign: 'right' }]}>CA N (€)</Text>
            <Text style={[S.tHeadCell, { flex: 2.6, textAlign: 'center' }]}>PART DU CA</Text>
            <Text style={[S.tHeadCell, { flex: 1.8, textAlign: 'right' }]}>CA N-1 (€)</Text>
            <Text style={[S.tHeadCell, { flex: 1.4, textAlign: 'right' }]}>EVOL. CA</Text>
          </View>
          {famRows.map((fam, i) => {
            const wN = vn.total ? fam.caN / vn.total : 0
            const evolCA = fam.caN1 ? (fam.caN - fam.caN1) / fam.caN1 : 0
            return (
              <View key={i} style={i % 2 === 0 ? S.tRow : S.tRowAlt}>
                <Text style={[S.tCellB, { flex: 2.6 }]}>{trunc(fam.nom, 24)}</Text>
                <Text style={[S.tCellR, { flex: 1.8 }]}>{eur(fam.caN)}</Text>
                <View style={{ flex: 2.6, flexDirection: 'row', alignItems: 'center' }}>
                  <ShareBar pct={wN} />
                  <Text style={{ fontSize: 8, color: C.textMid, width: 34, textAlign: 'right' }}>{pctStr(wN)}</Text>
                </View>
                <Text style={[S.tCellR, { flex: 1.8 }]}>{fam.caN1 !== null ? eur(fam.caN1) : '-'}</Text>
                <Text style={[fam.caN1 ? (evolCA >= 0 ? S.tCellGreen : S.tCellRed) : S.tCellR, { flex: 1.4 }]}>{fam.caN1 ? signPct(evolCA) : '-'}</Text>
              </View>
            )
          })}
        </View>
        <Footer page={3} week={data.week_number} year={data.year} />
      </Page>

      {/* PAGE 4 - EVOLUTION PAR FAMILLE (tableau trié, sans graphique) */}
      <Page size="A4" style={S.page}>
        <SecHeader num="03" title={`EVOLUTION PAR FAMILLE - ${data.year} vs ${data.year - 1}`} />
        <Text style={{ paddingHorizontal: 36, fontSize: 8.5, color: C.textLight, marginBottom: 12 }}>
          Familles triees du meilleur ecart au moins bon - comparaison avec la meme semaine {data.year - 1}
        </Text>
        <View style={S.tableWrap}>
          <View style={S.tHead}>
            <Text style={[S.tHeadCell, { flex: 3 }]}>FAMILLE</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>CA N (€)</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>CA N-1 (€)</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>ECART (€)</Text>
            <Text style={[S.tHeadCell, { flex: 1.5, textAlign: 'right' }]}>ECART %</Text>
            <Text style={[S.tHeadCell, { flex: 2.6, textAlign: 'center' }]}>POIDS DE L'ECART</Text>
          </View>
          {(() => {
            const maxAbs = Math.max(1, ...sortedByEcart.map(f => Math.abs(f.ecart)))
            return sortedByEcart.map((fam, i) => {
              const ecPct = fam.caN1 ? fam.ecart / fam.caN1 : 0
              const w = Math.abs(fam.ecart) / maxAbs
              return (
                <View key={i} style={i % 2 === 0 ? S.tRow : S.tRowAlt}>
                  <Text style={[S.tCellB, { flex: 3 }]}>{trunc(fam.nom, 28)}</Text>
                  <Text style={[S.tCellR, { flex: 2 }]}>{eur(fam.caN)}</Text>
                  <Text style={[S.tCellR, { flex: 2 }]}>{fam.caN1 !== null ? eur(fam.caN1) : '-'}</Text>
                  <Text style={[fam.ecart >= 0 ? S.tCellGreen : S.tCellRed, { flex: 2 }]}>{signEur(fam.ecart)}</Text>
                  <Text style={[fam.ecart >= 0 ? S.tCellGreen : S.tCellRed, { flex: 1.5 }]}>{fam.caN1 ? signPct(ecPct) : '-'}</Text>
                  <View style={{ flex: 2.6, flexDirection: 'row', alignItems: 'center', paddingLeft: 8 }}>
                    <View style={S.shareBarBg}>
                      <View style={[S.shareBarFill, { width: `${(w * 100).toFixed(1)}%`, backgroundColor: fam.ecart >= 0 ? C.green : C.red }]} />
                    </View>
                  </View>
                </View>
              )
            })
          })()}
        </View>
        <View style={{ marginHorizontal: 36, marginTop: 16, backgroundColor: C.gray, borderRadius: 6, padding: 11 }}>
          <Text style={{ fontSize: 8, color: C.textMid, lineHeight: 1.5 }}>
            Lecture : la barre indique le poids de l'ecart de chaque famille par rapport au plus gros ecart de la semaine (vert = progression, rouge = recul). Les familles en tete expliquent l'essentiel de la variation du CA.
          </Text>
        </View>
        <Footer page={4} week={data.week_number} year={data.year} />
      </Page>

      {/* PAGE 5 - TOP / FLOP */}
      <Page size="A4" style={S.page}>
        <SecHeader num="04" title="CE QUI PROGRESSE - CE QUI DECROCHE" />
        <Text style={{ paddingHorizontal: 36, fontSize: 8.5, color: C.textLight, marginBottom: 12 }}>
          Plus fortes progressions et plus fortes baisses de CA produit vs la meme semaine {data.year - 1} (ecarts calcules sur le CA total de chaque produit)
        </Text>
        <View style={S.topFlopWrap}>
          <View style={S.topFlopLeft}>
            <View style={{ backgroundColor: C.green, paddingVertical: 9, paddingHorizontal: 8, borderTopLeftRadius: 4, borderTopRightRadius: 4 }}>
              <Text style={{ color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 9 }}>TOP PROGRESSIONS</Text>
            </View>
            <View style={{ flexDirection: 'row', backgroundColor: '#F1F5F9', paddingVertical: 5, paddingHorizontal: 8, borderBottomColor: '#CBD5E1', borderBottomWidth: 1 }}>
              <Text style={[S.tHeadCell, { flex: 0.7, color: C.textLight }]}>#</Text>
              <Text style={[S.tHeadCell, { flex: 3, color: C.textMid }]}>PRODUIT</Text>
              <Text style={[S.tHeadCell, { flex: 1.8, textAlign: 'right', color: C.textMid }]}>CA N (€)</Text>
              <Text style={[S.tHeadCell, { flex: 1.4, textAlign: 'right', color: C.textMid }]}>ECART (€)</Text>
            </View>
            {tops.map((t, i) => (
              <View key={i} style={[i % 2 === 0 ? S.tRow : S.tRowAlt, { paddingHorizontal: 8 }]}>
                <View style={{ flex: 0.7, flexDirection: 'row', alignItems: 'center' }}>
                  <View style={[S.rankChip, { backgroundColor: i < 3 ? C.green : C.grayMid }]}>
                    <Text style={[S.rankChipText, i >= 3 ? { color: C.textMid } : {}]}>{i + 1}</Text>
                  </View>
                </View>
                <Text style={[S.tCell, { flex: 3, fontSize: 7.5 }]}>{trunc(t.designation, 24)}</Text>
                <Text style={[S.tCellR, { flex: 1.8, fontSize: 7.5 }]}>{eur(t.n)}</Text>
                <Text style={[S.tCellGreen, { flex: 1.4, fontSize: 7.5 }]}>+{eur0(Math.abs(t.ecart))}</Text>
              </View>
            ))}
            {tops.length === 0 && (
              <View style={S.tRow}><Text style={[S.tCell, { fontSize: 8, color: C.textLight }]}>Aucune progression detectee</Text></View>
            )}
          </View>
          <View style={S.topFlopRight}>
            <View style={{ backgroundColor: C.red, paddingVertical: 9, paddingHorizontal: 8, borderTopLeftRadius: 4, borderTopRightRadius: 4 }}>
              <Text style={{ color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 9 }}>TOP BAISSES</Text>
            </View>
            <View style={{ flexDirection: 'row', backgroundColor: '#F1F5F9', paddingVertical: 5, paddingHorizontal: 8, borderBottomColor: '#CBD5E1', borderBottomWidth: 1 }}>
              <Text style={[S.tHeadCell, { flex: 0.7, color: C.textLight }]}>#</Text>
              <Text style={[S.tHeadCell, { flex: 3, color: C.textMid }]}>PRODUIT</Text>
              <Text style={[S.tHeadCell, { flex: 1.8, textAlign: 'right', color: C.textMid }]}>CA N (€)</Text>
              <Text style={[S.tHeadCell, { flex: 1.4, textAlign: 'right', color: C.textMid }]}>ECART (€)</Text>
            </View>
            {flops.map((f, i) => (
              <View key={i} style={[i % 2 === 0 ? S.tRow : S.tRowAlt, { paddingHorizontal: 8 }]}>
                <View style={{ flex: 0.7, flexDirection: 'row', alignItems: 'center' }}>
                  <View style={[S.rankChip, { backgroundColor: i < 3 ? C.red : C.grayMid }]}>
                    <Text style={[S.rankChipText, i >= 3 ? { color: C.textMid } : {}]}>{i + 1}</Text>
                  </View>
                </View>
                <Text style={[S.tCell, { flex: 3, fontSize: 7.5 }]}>{trunc(f.designation, 24)}</Text>
                <Text style={[S.tCellR, { flex: 1.8, fontSize: 7.5 }]}>{eur(f.n)}</Text>
                <Text style={[S.tCellRed, { flex: 1.4, fontSize: 7.5 }]}>-{eur0(Math.abs(f.ecart))}</Text>
              </View>
            ))}
            {flops.length === 0 && (
              <View style={S.tRow}><Text style={[S.tCell, { fontSize: 8, color: C.textLight }]}>Aucune baisse detectee</Text></View>
            )}
          </View>
        </View>
        <View style={{ marginHorizontal: 36, marginTop: 16, backgroundColor: C.gray, borderRadius: 6, padding: 11 }}>
          <Text style={{ fontSize: 8, color: C.textMid, lineHeight: 1.5 }}>
            Lecture : CA N = total des ventes du produit sur la semaine ; l'ecart compare ce total a la meme semaine de {data.year - 1}. Les produits en tete de progression sont a mettre en avant en vitrine ; les baisses marquees meritent une verification (approvisionnement, prix, presence en rayon).
          </Text>
        </View>
        <Footer page={5} week={data.week_number} year={data.year} />
      </Page>

      {/* PAGE 6 - ANALYSE IA */}
      <Page size="A4" style={S.page}>
        <SecHeader num="05" title="ANALYSE INTELLIGENTE - INSIGHTS CLES" />
        <Text style={{ paddingHorizontal: 36, fontSize: 8.5, color: C.textLight, marginBottom: 14 }}>Analyse generee par intelligence artificielle - Semaine {data.week_number} {data.year}</Text>
        <View style={S.insightBlock}>
          {insights.insights.map((txt, i) => (
            <View key={i} style={S.insightRow}>
              <View style={S.insightBullet}><Text style={S.bulletNum}>{i + 1}</Text></View>
              <Text style={S.insightText}>{txt}</Text>
            </View>
          ))}
        </View>
        {vigilance.length > 0 && (
          <View style={S.vigilanceBox}>
            <Text style={S.vigilanceTitle}>POINTS DE VIGILANCE</Text>
            {vigilance.map((txt, i) => (
              <Text key={i} style={S.vigilanceText}>- {txt}</Text>
            ))}
          </View>
        )}
        <View style={{ marginTop: 10 }}>
          <SecHeader num="06" title="RECOMMANDATIONS POUR LA SEMAINE PROCHAINE" />
          <View style={S.insightBlock}>
            {insights.recommendations.map((txt, i) => (
              <View key={i} style={S.insightRow}>
                <View style={S.recoBullet}><Text style={S.bulletNum}>{i + 1}</Text></View>
                <Text style={S.insightText}>{txt}</Text>
              </View>
            ))}
          </View>
        </View>
        <Footer page={6} week={data.week_number} year={data.year} />
      </Page>

      {/* PAGE 7 - SYNTHESE DE LA SEMAINE */}
      <Page size="A4" style={S.page}>
        <SecHeader num="07" title="SYNTHESE DE LA SEMAINE" />
        <View style={[S.statusBanner, { backgroundColor: status.color }]}>
          <Text style={S.statusLabel}>{status.label}</Text>
          <Text style={S.statusDesc}>{status.desc}</Text>
        </View>
        <Text style={{ paddingHorizontal: 36, fontSize: 9, color: C.textLight, marginBottom: 10 }}>LES CHIFFRES A RETENIR</Text>
        <View style={S.recapGrid}>
          <View style={S.recapCard}>
            <Text style={S.recapLabel}>CA SEMAINE</Text>
            <Text style={S.recapValue}>{eur0(fn.ca_net)}</Text>
            <Text style={S.recapSub}>{signEur(fn.ca_net - fn1.ca_net)} vs {data.year - 1}</Text>
          </View>
          <View style={[S.recapCard, { backgroundColor: caVar >= 0 ? C.lightGreen : C.lightRed }]}>
            <Text style={S.recapLabel}>EVOLUTION</Text>
            <Text style={[S.recapValue, { color: caVar >= 0 ? C.green : C.red }]}>{signPct(caVar)}</Text>
            <Text style={S.recapSub}>vs S{data.week_number} {data.year - 1}</Text>
          </View>
          <View style={S.recapCard}>
            <Text style={S.recapLabel}>PANIER MOYEN</Text>
            <Text style={S.recapValue}>{eur(fn.moyenne_ticket)}</Text>
            <Text style={S.recapSub}>{fn.nb_tickets} tickets ({fn.nb_tickets - fn1.nb_tickets >= 0 ? '+' : ''}{fn.nb_tickets - fn1.nb_tickets})</Text>
          </View>
          <View style={S.recapCard}>
            <Text style={S.recapLabel}>FAMILLE EN FORME</Text>
            <Text style={[S.recapValue, { fontSize: 10.5 }]}>{bestFam ? trunc(bestFam.nom, 20) : '-'}</Text>
            <Text style={[S.recapSub, { color: C.green }]}>{bestFam ? signEur(bestFam.ecart) : ''}</Text>
          </View>
          <View style={S.recapCard}>
            <Text style={S.recapLabel}>FAMILLE EN RETRAIT</Text>
            <Text style={[S.recapValue, { fontSize: 10.5 }]}>{worstFam ? trunc(worstFam.nom, 20) : '-'}</Text>
            <Text style={[S.recapSub, { color: worstFam && worstFam.ecart < 0 ? C.red : C.textLight }]}>{worstFam ? signEur(worstFam.ecart) : ''}</Text>
          </View>
          <View style={S.recapCard}>
            <Text style={S.recapLabel}>PRODUIT VEDETTE</Text>
            <Text style={[S.recapValue, { fontSize: 10.5 }]}>{topProduct ? trunc(topProduct.designation, 20) : '-'}</Text>
            <Text style={[S.recapSub, { color: C.green }]}>{topProduct ? '+' + eur0(Math.abs(topProduct.ecart)) + ' vs N-1' : ''}</Text>
          </View>
        </View>
        <View style={{ marginHorizontal: 36, marginTop: 8, marginBottom: 4, backgroundColor: C.lightBlue, borderLeftWidth: 3, borderLeftColor: C.navy, borderRadius: 4, padding: 12 }}>
          <Text style={S.execLabel}>A RETENIR CETTE SEMAINE</Text>
          <Text style={S.execText}>{insights.resume}</Text>
        </View>
        <View style={S.actionBox}>
          <Text style={S.actionLabel}>ACTION PRIORITAIRE POUR LA SEMAINE PROCHAINE</Text>
          <Text style={S.actionText}>{insights.recommendations[0] ?? 'Poursuivre la dynamique actuelle et surveiller les familles en retrait.'}</Text>
        </View>
        {flopProduct && (
          <Text style={{ paddingHorizontal: 36, marginTop: 12, fontSize: 8, color: C.textLight }}>
            A surveiller aussi : {trunc(flopProduct.designation, 40)} ({'-'}{eur0(Math.abs(flopProduct.ecart))} vs N-1).
          </Text>
        )}
        <Text style={{ paddingHorizontal: 36, marginTop: 18, fontSize: 8, color: C.textLight }}>
          Rapport genere automatiquement par PILOTE le {generatedOn}. Donnees issues de vos exports de caisse (S{data.week_number} {data.year} et S{data.week_number} {data.year - 1}).
        </Text>
        <Footer page={7} week={data.week_number} year={data.year} />
      </Page>

    </Document>
  )
}

// ─── Data extraction ─────────────────────────────────────────────────────────

async function parsePDF(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer())
  const _m = await import('pdf-parse') as any
  const fn = typeof _m.default === 'function' ? _m.default : _m
  if (typeof fn !== 'function') throw new Error('pdf-parse not callable')
  const data = await fn(buffer)
  return data.text
}

function extractJSONObject(text: string): string {
  const start = text.indexOf('{')
  if (start === -1) throw new Error('No JSON object found in response')
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(start, i + 1) }
  }
  throw new Error('Unclosed JSON')
}

async function extractFinancials(fin_n: string, fin_n1: string): Promise<{
  period_n: string; period_n1: string; week_number: number; year: number
  financier_n: FinancierData; financier_n1: FinancierData
}> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })
  const r = await client.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 512,
    messages: [{ role: 'user', content: 'Extrais les donnees financieres CRISALID. Retourne UNIQUEMENT ce JSON:\n{"period_n":"15-21 juin 2026","period_n1":"16-22 juin 2025","week_number":25,"year":2026,"financier_n":{"ca_net":20742.43,"nb_tickets":496,"moyenne_ticket":41.82},"financier_n1":{"ca_net":19316.76,"nb_tickets":453,"moyenne_ticket":42.64}}\n\n=== FINANCIER N ===\n' + fin_n.slice(0, 3000) + '\n=== FINANCIER N-1 ===\n' + fin_n1.slice(0, 3000) }],
  })
  return JSON.parse(extractJSONObject(r.content[0].type === 'text' ? r.content[0].text : ''))
}

// ─── Semaine ISO deterministe ─────────────────────────────────────────────────
// La semaine du rapport est TOUJOURS calculee en code a partir des dates de la
// periode extraite (ex: "29 juin - 5 juillet 2026" => S27), jamais par l'IA.
// C'est cette semaine qui alimente weekly_ca, le dashboard et la facturation.

const MONTHS_FR: Record<string, number> = {
  janvier: 0, fevrier: 1, mars: 2, avril: 3, mai: 4, juin: 5,
  juillet: 6, aout: 7, septembre: 8, octobre: 9, novembre: 10, decembre: 11,
}

function isoWeekOf(d: Date): { week: number; year: number } {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return { week: Math.ceil((((t.getTime() - yearStart.getTime()) / 86400000) + 1) / 7), year: t.getUTCFullYear() }
}

function weekFromPeriod(period: string): { week: number; year: number } | null {
  try {
    const p = (period || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    const years = p.match(/20\d{2}/g) || []
    if (years.length === 0) return null
    let year = parseInt(years[0])
    const dayMatch = p.match(/(\d{1,2})(?!\d)/)
    if (!dayMatch) return null
    const day = parseInt(dayMatch[1])
    if (day < 1 || day > 31) return null
    // Premier nom de mois present dans la chaine = mois du jour de debut
    let monthIdx: number | null = null
    let firstPos = Infinity
    for (const [name, idx] of Object.entries(MONTHS_FR)) {
      const pos = p.indexOf(name)
      if (pos !== -1 && pos < firstPos) { firstPos = pos; monthIdx = idx }
    }
    if (monthIdx === null) return null
    // Periode dec -> janv ou seule l'annee de fin est affichee
    if (years.length === 1 && monthIdx === 11 && p.includes('janv')) year -= 1
    const start = new Date(Date.UTC(year, monthIdx, day))
    if (isNaN(start.getTime())) return null
    return isoWeekOf(start)
  } catch {
    return null
  }
}

function parseNum(s: string): number {
  return parseFloat(s.trim().replace(/\s/g, '').replace(',', '.')) || 0
}

async function extractVentesData(ventes_text: string): Promise<{ total: number; familles: Famille[] }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })
  const r = await client.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 2048,
    // Slice 12000 chars pour capturer TOUTES les familles (pas seulement les grandes)
    messages: [{ role: 'user', content: `Extrais les totaux par famille du fichier CRISALID.\nRetourne UNIQUEMENT ces lignes (une par ligne):\nTOTAL|20742.43\nVIANDE DE BOEUF|1|3081.17\nCHARCUTERIE|2|2500.00\n\nFormat: 1ere ligne TOTAL|montant, puis NOM|ID|montant par famille. Point comme separateur decimal.\n\n${ventes_text.slice(0, 12000)}` }],
  })
  const text = r.content[0].type === 'text' ? r.content[0].text.trim() : ''
  const lines = text.split('\n').map((l: string) => l.trim()).filter((l: string) => l)
  let total = 0
  const familles: Famille[] = []
  for (const line of lines) {
    const parts = line.split('|')
    if (parts[0].toUpperCase() === 'TOTAL' && parts[1]) total = parseNum(parts[1])
    else if (parts.length >= 3) {
      const montant = parseNum(parts[2])
      if (montant > 0) familles.push({ id: parts[1]?.trim() || String(familles.length + 1), nom: parts[0].trim(), total_montant: montant, produits: [] })
    }
  }
  return { total, familles }
}

/** Extrait le CA TOTAL par produit d'un fichier ventes CRISALID.
 *  IMPORTANT : on extrait N et N-1 séparément puis on calcule les écarts en code —
 *  l'IA ne fait AUCUNE comparaison ni aucun calcul, elle ne peut donc pas se tromper d'écart. */
async function extractProductAmounts(text: string): Promise<Map<string, number>> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })
  const r = await client.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 4000,
    messages: [{ role: 'user', content: `Extrais du fichier de ventes CRISALID le CA TOTAL de CHAQUE produit sur la semaine.\n` +
      `ATTENTION CRITIQUE : la valeur a extraire est le MONTANT TOTAL en euros des ventes du produit (colonne montant/total/CA), JAMAIS le prix unitaire, JAMAIS le prix au kilo, JAMAIS la quantite.\n` +
      `Un produit courant fait typiquement des dizaines a des centaines d'euros de CA hebdomadaire.\n` +
      `Ignore les lignes de famille/sous-total/total general : uniquement les produits individuels.\n` +
      `Retourne UNIQUEMENT des lignes au format NOM|MONTANT (point decimal, une ligne par produit, aucun autre texte) :\n` +
      `STEAK HACHE|412.35\nROTI DE PORC|187.20\n\n${text.slice(0, 12000)}` }],
  })
  const out = new Map<string, number>()
  const raw = r.content[0].type === 'text' ? r.content[0].text : ''
  for (const line of raw.split('\n')) {
    const parts = line.trim().split('|')
    if (parts.length < 2) continue
    const name = parts[0].trim().toUpperCase()
    const amount = parseNum(parts[1])
    if (name && name !== 'TOTAL' && amount > 0) out.set(name, (out.get(name) ?? 0) + amount)
  }
  return out
}

/** Calcule les tops/flops en code a partir des CA produits N et N-1 (zero IA, zero erreur de calcul) */
function computeTopFlop(prodN: Map<string, number>, prodN1: Map<string, number>): {
  tops: { designation: string; n: number; ecart: number }[]
  flops: { designation: string; n: number; ecart: number }[]
} {
  const names = new Set<string>([...prodN.keys(), ...prodN1.keys()])
  const diffs: { designation: string; n: number; ecart: number }[] = []
  for (const name of names) {
    const n  = prodN.get(name)  ?? 0
    const n1 = prodN1.get(name) ?? 0
    diffs.push({ designation: name, n, ecart: +(n - n1).toFixed(2) })
  }
  const tops  = diffs.filter(d => d.ecart > 0).sort((a, b) => b.ecart - a.ecart).slice(0, 10)
  const flops = diffs.filter(d => d.ecart < 0).sort((a, b) => a.ecart - b.ecart).slice(0, 10)
  return { tops, flops }
}

async function extractData(texts: { fin_n: string; fin_n1: string; ventes_n: string; ventes_n1: string }): Promise<ExtractedData> {
  const [financials, ventes_n, ventes_n1, prodN, prodN1] = await Promise.all([
    extractFinancials(texts.fin_n, texts.fin_n1),
    extractVentesData(texts.ventes_n),
    extractVentesData(texts.ventes_n1),
    extractProductAmounts(texts.ventes_n),
    extractProductAmounts(texts.ventes_n1),
  ])
  const topFlop = computeTopFlop(prodN, prodN1)
  // Semaine ISO recalculee en code depuis les dates de la periode — la valeur IA
  // ne sert que de secours si la periode est illisible
  const isoFixed = weekFromPeriod(financials.period_n)
  return {
    period_n: financials.period_n, period_n1: financials.period_n1,
    week_number: isoFixed?.week ?? financials.week_number,
    year: isoFixed?.year ?? financials.year,
    financier_n: financials.financier_n, financier_n1: financials.financier_n1,
    ventes_n, ventes_n1, tops: topFlop.tops, flops: topFlop.flops,
    prodN, prodN1,
  }
}

// ─── Historisation caisse ─────────────────────────────────────────────────────
// A chaque generation : archive CA + familles + tickets (weekly_ca) et CA par
// produit (weekly_sales_products) pour N ET N-1. A terme : comparaison N-1 sans
// fichiers et tendances produits multi-semaines.

async function archiveWeekData(
  serviceSupabase: ReturnType<typeof createServiceClient>,
  clientId: string,
  week: number,
  year: number,
  fin: FinancierData,
  familles: Famille[],
  produits: Map<string, number>,
) {
  const familiesDetail = familles.map((f: Famille) => ({ nom: f.nom, montant: f.total_montant }))
  await serviceSupabase.from('weekly_ca').delete()
    .eq('client_id', clientId).eq('week_number', week).eq('year', year)
  await serviceSupabase.from('weekly_ca').insert({
    client_id: clientId,
    week_number: week,
    year,
    ca_total: fin.ca_net,
    families_detail: familiesDetail,
    nb_tickets: fin.nb_tickets,
    moyenne_ticket: fin.moyenne_ticket,
  })

  await serviceSupabase.from('weekly_sales_products').delete()
    .eq('client_id', clientId).eq('week_number', week).eq('year', year)
  const rows = [...produits.entries()].map(([product, amount]) => ({
    client_id: clientId, week_number: week, year, product, amount,
  }))
  if (rows.length > 0) await serviceSupabase.from('weekly_sales_products').insert(rows)
}

// ─── Calculs métier ────────────────────────────────────────────────────────────

/** Familles fusionnées N/N-1, triées par CA N desc, plafonnées à 12 lignes (le reste en AUTRES) */
function buildFamRows(vn: { total: number; familles: Famille[] }, vn1: { total: number; familles: Famille[] }, max = 12): FamRow[] {
  const map1 = new Map<string, number>()
  for (const f of vn1.familles) map1.set(f.nom.toUpperCase(), f.total_montant)
  const rows: FamRow[] = vn.familles
    .map(f => {
      const caN1 = map1.has(f.nom.toUpperCase()) ? map1.get(f.nom.toUpperCase())! : null
      return { nom: f.nom, caN: f.total_montant, caN1, ecart: f.total_montant - (caN1 ?? 0) }
    })
    .sort((a, b) => b.caN - a.caN)
  if (rows.length <= max) return rows
  const head = rows.slice(0, max - 1)
  const tail = rows.slice(max - 1)
  const caN  = tail.reduce((s, r) => s + r.caN, 0)
  const caN1 = tail.reduce((s, r) => s + (r.caN1 ?? 0), 0)
  head.push({ nom: 'AUTRES FAMILLES', caN, caN1: caN1 > 0 ? caN1 : null, ecart: caN - caN1 })
  return head
}

/** Statut de semaine selon les seuils métier boucherie (analyse N vs N-1) */
function buildStatus(caVar: number): WeekStatus {
  const v = caVar * 100
  if (v > 10)  return { label: 'SEMAINE EN FORTE PROGRESSION', color: '#2E7D32', light: '#E6F4EA', desc: 'Le CA progresse nettement par rapport a la meme semaine l\'an dernier. Capitalisez sur cette dynamique : notez ce qui a change (meteo, evenements, offres) pour pouvoir le reproduire.' }
  if (v > 0)   return { label: 'SEMAINE EN PROGRESSION', color: '#43A047', light: '#E6F4EA', desc: 'Le CA est en hausse par rapport a la meme semaine l\'an dernier. La trajectoire est bonne : surveillez les familles en retrait pour transformer cette progression en tendance.' }
  if (v > -5)  return { label: 'SEMAINE STABLE - A SURVEILLER', color: '#D97706', light: '#FEF3C7', desc: 'Le CA est en leger retrait par rapport a la meme semaine l\'an dernier. Rien d\'alarmant, mais identifiez les familles et produits qui decrochent pour reagir vite.' }
  return { label: 'SEMAINE EN RECUL', color: '#C62828', light: '#FCE8E6', desc: 'Le CA recule sensiblement par rapport a la meme semaine l\'an dernier. Verifiez la comparabilite des semaines (jours feries, fermetures) puis concentrez-vous sur les recommandations page 6.' }
}

/** Résumé exécutif calculé (independant de l'IA — toujours disponible) */
function buildExecSummary(data: ReportData, famRows: FamRow[], caVar: number): string {
  const fn = data.financier_n, fn1 = data.financier_n1
  const sorted = [...famRows].sort((a, b) => b.ecart - a.ecart)
  const best = sorted[0], worst = sorted[sorted.length - 1]
  const dTickets = fn.nb_tickets - fn1.nb_tickets
  const panierUp = fn.moyenne_ticket >= fn1.moyenne_ticket
  const p1 = caVar >= 0
    ? `CA de ${eur0(fn.ca_net)} sur la semaine ${data.week_number}, en progression de ${(caVar * 100).toFixed(1)}% par rapport a la meme semaine ${data.year - 1}.`
    : `CA de ${eur0(fn.ca_net)} sur la semaine ${data.week_number}, en retrait de ${Math.abs(caVar * 100).toFixed(1)}% par rapport a la meme semaine ${data.year - 1}.`
  const p2 = `${dTickets >= 0 ? dTickets + ' tickets de plus' : Math.abs(dTickets) + ' tickets de moins'} qu'en ${data.year - 1}, avec un panier moyen ${panierUp ? 'en hausse' : 'en baisse'} a ${eur(fn.moyenne_ticket)}.`
  const p3 = best && worst && best !== worst
    ? `${trunc(best.nom, 24)} tire la performance (${signEur(best.ecart)}) tandis que ${trunc(worst.nom, 24)} recule (${signEur(worst.ecart)}).`
    : ''
  return sanitize(`${p1} ${p2} ${p3}`.trim())
}

async function generateInsights(data: ReportData, famRows: FamRow[]): Promise<Insights> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })
  const fn = data.financier_n, fn1 = data.financier_n1
  const caVar = fn1.ca_net ? ((fn.ca_net - fn1.ca_net) / fn1.ca_net * 100).toFixed(1) : '0'
  const famSummary = famRows.map(f => {
    const pctCA = data.ventes_n.total ? (f.caN / data.ventes_n.total * 100).toFixed(1) : '0'
    return `${f.nom} : ${f.caN.toFixed(0)} EUR (${pctCA}% du CA), ecart N-1 : ${f.ecart >= 0 ? '+' : ''}${f.ecart.toFixed(0)} EUR`
  }).join('\n')
  const topsStr  = data.tops.slice(0, 5).map(t => `${t.designation} (+${Math.abs(t.ecart).toFixed(0)} EUR)`).join(', ')
  const flopsStr = data.flops.slice(0, 5).map(f => `${f.designation} (${f.ecart.toFixed(0)} EUR)`).join(', ')
  const r = await client.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 1400,
    messages: [{ role: 'user', content: `Tu es expert en analyse de ventes pour une boucherie artisanale francaise. Ton : positif d'abord, chiffre et concret, actionnable, respectueux du metier (le boucher connait son metier, tu confirmes et enrichis).\n\nDONNEES SEMAINE ${data.week_number} (${data.period_n}) :\nCA N : ${fn.ca_net.toFixed(2)} EUR | CA N-1 : ${fn1.ca_net.toFixed(2)} EUR | Variation : ${caVar}%\nTickets N : ${fn.nb_tickets} (N-1 : ${fn1.nb_tickets}) | Panier moyen N : ${fn.moyenne_ticket.toFixed(2)} EUR (N-1 : ${fn1.moyenne_ticket.toFixed(2)} EUR)\n\nVENTES PAR FAMILLE :\n${famSummary}\n\nTOP PRODUITS EN PROGRESSION : ${topsStr || 'n/a'}\nPRODUITS EN BAISSE : ${flopsStr || 'n/a'}\n\nRappels metier : une semaine avec jour ferie fait mecaniquement -15 a -20% de CA ; saisonnalite boucherie (pic Paques S15-16, ete, fetes S50-51, creux janvier-fevrier) ; le traiteur a la meilleure marge (50-65%) ; variation > +-25% sans explication saisonniere = a investiguer.\n\nRetourne UNIQUEMENT ce JSON :\n{"resume":"2 phrases max qui resument la semaine","insights":["insight 1","insight 2","insight 3","insight 4","insight 5"],"vigilance":["point de vigilance 1","point de vigilance 2"],"recommendations":["reco 1","reco 2","reco 3"]}\n\nInsights : faits precis avec chiffres (une phrase chacun). Vigilance : risques ou anomalies a surveiller (2 max, une phrase). Recommandations : actions concretes de boucherie pour la semaine prochaine, la premiere etant LA priorite. Tout en francais.` }],
  })
  try {
    const parsed = JSON.parse(extractJSONObject(r.content[0].type === 'text' ? r.content[0].text : ''))
    return {
      resume:          sanitize(parsed.resume || ''),
      insights:        (parsed.insights || []).slice(0, 5).map(sanitize).filter(Boolean),
      vigilance:       (parsed.vigilance || []).slice(0, 2).map(sanitize).filter(Boolean),
      recommendations: (parsed.recommendations || []).slice(0, 3).map(sanitize).filter(Boolean),
    }
  } catch {
    return {
      resume: 'Analyse indisponible cette semaine.',
      insights: ['Analyse non disponible.'],
      vigilance: [],
      recommendations: ['Contactez votre conseiller PILOTE.'],
    }
  }
}

// ─── QuickChart ───────────────────────────────────────────────────────────────────
// REGLES ABSOLUES QuickChart :
// 1. Aucun caractere non-ASCII dans la config JSON
// 2. ticks.callback interdit — crash Chart.js 2.9.4 dans le sandbox
// 3. title.text doit etre une string simple (pas un array)
// 4. outlabeledPie : leader lines vers les labels externes
// 5. PIE = TOUTES les familles (pas de groupement) — le dashboard fait le top4+Autres

async function getPieBuffer(data: ReportData): Promise<Buffer> {
  // Strip diacritics + non-ASCII (QuickChart sandbox rule)
  const toAscii = (s: string) =>
    s.normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\x00-\x7F]/g, '?')

  const famNames = data.ventes_n.familles.map(f => trunc(toAscii(f.nom), 18))
  const famCA    = data.ventes_n.familles.map(f => +f.total_montant.toFixed(2))

  const donutPalette = [
    '#1E3A5F', '#DC2626', '#D97706', '#059669',
    '#7C3AED', '#0891B2', '#BE185D', '#65A30D', '#9333EA', '#F59E0B',
  ].slice(0, famNames.length)

  const pieConfig = {
    type: 'outlabeledPie',
    data: {
      labels: famNames,
      datasets: [{
        data: famCA,
        backgroundColor: donutPalette,
        borderWidth: 2,
        borderColor: '#FFFFFF',
      }],
    },
    options: {
      title: {
        display: true,
        text: 'Repartition CA - S' + data.week_number + ' ' + data.year,
        fontSize: 14,
        fontColor: '#1E293B',
        fontStyle: 'bold',
        padding: 14,
      },
      legend: { display: false },
      plugins: {
        datalabels: { display: false },
        outlabels: {
          text: '%l\n%p',
          color: 'white',
          stretch: 38,
          font: { resizable: true, minSize: 8, maxSize: 12, size: 11, weight: 'bold' },
          padding: { top: 4, bottom: 4, left: 7, right: 7 },
          borderRadius: 4,
        },
      },
    },
  }

  const pieBody = JSON.stringify({ chart: pieConfig, width: 820, height: 460, backgroundColor: 'white', version: '2.9.4' })

  const pieRes = await fetch('https://quickchart.io/chart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: pieBody })

  if (!pieRes.ok) {
    const ct = pieRes.headers.get('content-type') || ''
    const body = ct.includes('image') ? '[binary image]' : (await pieRes.text()).slice(0, 300)
    throw new Error(`QuickChart pie ${pieRes.status} | ${body}`)
  }

  return Buffer.from(await pieRes.arrayBuffer())
}

async function generatePDF(report: ComputedReport): Promise<Buffer> {
  return renderToBuffer(React.createElement(PiloteReport, { r: report }))
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

    const report: ComputedReport = {
      data, clientName, insights: insightsResult,
      pieBuffer,
      tops: data.tops, flops: data.flops, famRows, caVar,
      status: buildStatus(caVar),
      execSummary: buildExecSummary(data, famRows, caVar),
    }
    const pdfBuffer = await generatePDF(report)

    const fileName = `rapport-s${data.week_number}-${data.year}-${Date.now()}.pdf`
    const { error: uploadError } = await serviceSupabase.storage.from('reports').upload(
      fileName, pdfBuffer, { contentType: 'application/pdf', upsert: false },
    )
    if (uploadError) return NextResponse.json({ error: 'Upload: ' + uploadError.message }, { status: 500 })

    const { data: urlData } = serviceSupabase.storage.from('reports').getPublicUrl(fileName)
    const fileUrl = urlData.publicUrl

    const title = `Analyse S${data.week_number} - ${data.period_n}${clientName ? ' - ' + clientName : ''}`
    const { error: dbError } = await serviceSupabase.from('reports').insert({
      profile_id: profile.id, title,
      week_number: data.week_number, year: data.year,
      file_url: fileUrl,
      ...(clientId ? { client_id: clientId } : {}),
    })
    if (dbError) return NextResponse.json({ error: 'DB: ' + dbError.message }, { status: 500 })

    const toEmail = clientEmail || profile.delivery_email || user.email || ''
    const resend = new Resend(process.env.RESEND_API_KEY ?? '')
    await resend.emails.send({
      from: 'PILOTE <onboarding@resend.dev>',
      to: toEmail,
      subject: `Rapport hebdomadaire ${title}`,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto"><div style="background:#1E3A5F;padding:32px 40px"><div style="color:#FF8C00;font-size:11px;letter-spacing:4px;margin-bottom:10px">PILOTE</div><h2 style="color:#FFFFFF;margin:0;font-size:22px">Votre rapport est pret</h2></div><div style="padding:32px 40px;border:1px solid #E0E0E0;border-top:none"><p style="color:#444;margin-top:0"><strong>${title}</strong></p><p style="color:#666;font-size:14px">7 pages - Analyse IA - Graphique - Top &amp; Flop produits - Synthese de la semaine</p><div style="margin:28px 0;text-align:center"><a href="${fileUrl}" style="background:#1E3A5F;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px">Telecharger le rapport PDF</a></div><p style="color:#999;font-size:11px;text-align:center">Rapport confidentiel - Genere automatiquement par PILOTE</p></div></div>`,
    })

    if (clientId) {
      // Historisation : semaine N ET semaine N-1 (meme semaine, annee precedente).
      // Le CA hebdo se met a jour automatiquement, et l'historique produits permettra
      // a terme la comparaison N-1 sans fichiers + les tendances multi-semaines.
      await archiveWeekData(serviceSupabase, clientId, data.week_number, data.year, data.financier_n, data.ventes_n.familles, data.prodN)
      await archiveWeekData(serviceSupabase, clientId, data.week_number, data.year - 1, data.financier_n1, data.ventes_n1.familles, data.prodN1)
    }

    return NextResponse.json({ success: true, title, file_url: fileUrl })

  } catch (err: unknown) {
    console.error(err)
    const _e = err instanceof Error ? err : new Error(String(err))
    return NextResponse.json({
      error: _e.message + ' || STACK: ' + (_e.stack || '').replace(/\n/g, ' > ').slice(0, 600),
    }, { status: 500 })
  }
}
