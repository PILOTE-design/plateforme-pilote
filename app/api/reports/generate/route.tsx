// ⚠️  Ce fichier doit être nommé route.tsx (supprimer route.ts)
// Dépendances à installer : npm install @react-pdf/renderer
// Dépendances à retirer   : npm uninstall exceljs
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

// ─── Types ────────────────────────────────────────────────────────────────────
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
interface Insights { insights: string[]; recommendations: string[] }
interface ComputedReport {
  data: ReportData
  clientName: string | null
  insights: Insights
  pieBuffer: Buffer
  barBuffer: Buffer
  tops: { designation: string; n: number; ecart: number }[]
  flops: { designation: string; n: number; ecart: number }[]
  famMap: Map<string, Famille>
  caVar: number
}

// ─── Formatters ───────────────────────────────────────────────────────────────
// NE PAS utiliser toLocaleString('fr-FR') — produit U+202F que Helvetica rend '/'
const eur = (n: number) => {
  const abs = Math.abs(n)
  const [int, dec] = abs.toFixed(2).split('.')
  const intFmt = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return (n < 0 ? '-' : '') + intFmt + ',' + dec + ' €'
}
const signEur = (n: number) => (n >= 0 ? '+' : '') + eur(n)
const signPct = (n: number) => (n >= 0 ? '+' : '') + (n * 100).toFixed(1) + '%'
const pctStr = (n: number) => (n * 100).toFixed(1) + '%'
const trunc = (s: string, len: number) => (s.length > len ? s.slice(0, len - 1) + '...' : s)

// ─── Palette ──────────────────────────────────────────────────────────────────
const C = {
  navy:        '#1E3A5F',
  blue:        '#2D5986',
  lightBlue:   '#E8F0FE',
  blueMid:     '#90CAF9',
  orange:      '#FF8C00',
  green:       '#2E7D32',
  lightGreen:  '#E6F4EA',
  red:         '#C62828',
  lightRed:    '#FCE8E6',
  gray:        '#F0F4F8',
  line:        '#E0E0E0',
  textDark:    '#1A1A1A',
  textMid:     '#444444',
  textLight:   '#888888',
  white:       '#FFFFFF',
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  coverBlueBg:    { backgroundColor: C.navy, padding: 56, paddingBottom: 48, flexGrow: 1 },
  coverTagRow:    { flexDirection: 'row', alignItems: 'center', marginBottom: 40 },
  coverTagDot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: C.orange, marginRight: 6 },
  coverTagText:   { color: C.orange, fontSize: 10, letterSpacing: 4 },
  coverTitle:     { color: C.white, fontSize: 38, fontFamily: 'Helvetica-Bold', lineHeight: 1.2, marginBottom: 10 },
  coverSub:       { color: C.blueMid, fontSize: 13, marginBottom: 28 },
  coverDivider:   { width: 48, height: 3, backgroundColor: C.orange, marginBottom: 22 },
  coverWeek:      { color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 20, marginBottom: 4 },
  coverPeriod:    { color: C.blueMid, fontSize: 11 },
  coverWhiteBg:   { backgroundColor: C.white, padding: 40 },
  coverLabel:     { color: C.textLight, fontSize: 9, letterSpacing: 2, marginBottom: 4 },
  coverClient:    { color: C.navy, fontFamily: 'Helvetica-Bold', fontSize: 15, marginBottom: 14 },
  coverMeta:      { color: C.textLight, fontSize: 9, marginBottom: 2 },
  page:           { backgroundColor: C.white, paddingTop: 0, paddingBottom: 40, paddingHorizontal: 0 },
  contentBlock:   { paddingHorizontal: 36, paddingTop: 32 },
  secHeader:      { flexDirection: 'row', alignItems: 'center', backgroundColor: C.navy, paddingVertical: 10, paddingHorizontal: 36, marginBottom: 18 },
  secHeaderDot:   { width: 7, height: 7, borderRadius: 3.5, backgroundColor: C.orange, marginRight: 8 },
  secHeaderText:  { color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 11, letterSpacing: 1 },
  footer:         { position: 'absolute', bottom: 20, left: 36, right: 36, flexDirection: 'row', justifyContent: 'space-between', borderTopColor: C.line, borderTopWidth: 0.5, paddingTop: 6 },
  footerText:     { fontSize: 7.5, color: C.textLight },
  kpiRow:         { flexDirection: 'row', paddingHorizontal: 36, marginBottom: 10 },
  kpiBox:         { flex: 1, borderRadius: 6, padding: 14, marginRight: 8 },
  kpiLabel:       { fontSize: 8, letterSpacing: 1, marginBottom: 6 },
  kpiValue:       { fontFamily: 'Helvetica-Bold', fontSize: 17, color: C.white },
  kpiSub:         { fontSize: 9, marginTop: 3 },
  tableWrap:      { paddingHorizontal: 36 },
  tHead:          { flexDirection: 'row', backgroundColor: C.blue, paddingVertical: 7, paddingHorizontal: 8 },
  tHeadCell:      { color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 8 },
  tRow:           { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 8, borderBottomColor: C.line, borderBottomWidth: 0.5 },
  tRowAlt:        { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 8, backgroundColor: C.gray, borderBottomColor: C.line, borderBottomWidth: 0.5 },
  tTotal:         { flexDirection: 'row', paddingVertical: 7, paddingHorizontal: 8, backgroundColor: C.navy },
  tCell:          { fontSize: 8.5, color: C.textDark },
  tCellB:         { fontSize: 8.5, color: C.textDark, fontFamily: 'Helvetica-Bold' },
  tCellR:         { fontSize: 8.5, color: C.textDark, textAlign: 'right' },
  tCellRB:        { fontSize: 8.5, color: C.textDark, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  tCellGreen:     { fontSize: 8.5, color: C.green, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  tCellRed:       { fontSize: 8.5, color: C.red, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  tTotalCell:     { fontSize: 8.5, color: C.white, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  tTotalCellL:    { fontSize: 8.5, color: C.white, fontFamily: 'Helvetica-Bold' },
  chartWrap:      { alignItems: 'center', paddingHorizontal: 36, marginBottom: 8 },
  chartCaption:   { fontSize: 8, color: C.textLight, textAlign: 'center', marginTop: 4, paddingHorizontal: 36 },
  insightBlock:   { paddingHorizontal: 36 },
  insightRow:     { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  insightBullet:  { width: 20, height: 20, borderRadius: 10, backgroundColor: C.navy, alignItems: 'center', justifyContent: 'center', marginRight: 12, flexShrink: 0 },
  recoBullet:     { width: 20, height: 20, borderRadius: 10, backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center', marginRight: 12, flexShrink: 0 },
  bulletNum:      { color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 8 },
  insightText:    { fontSize: 9.5, color: C.textMid, flex: 1, lineHeight: 1.55 },
  topFlopWrap:    { flexDirection: 'row', paddingHorizontal: 36 },
  topFlopLeft:    { flex: 1, marginRight: 10 },
  topFlopRight:   { flex: 1, marginLeft: 10 },
})

// ─── PDF Sub-components ───────────────────────────────────────────────────────

const SecHeader = ({ title }: { title: string }) => (
  <View style={S.secHeader}>
    <View style={S.secHeaderDot} />
    <Text style={S.secHeaderText}>{title}</Text>
  </View>
)

const Footer = ({ page, week, year }: { page: number; week: number; year: number }) => (
  <View style={S.footer} fixed>
    <Text style={S.footerText}>PILOTE - Rapport S{week}/{year} - Document confidentiel</Text>
    <Text style={S.footerText}>Page {page}</Text>
  </View>
)

const KpiBox = ({ label, value, sub, bg, subColor }: { label: string; value: string; sub?: string; bg: string; subColor?: string }) => (
  <View style={[S.kpiBox, { backgroundColor: bg }]}>
    <Text style={[S.kpiLabel, { color: `${C.white}99` }]}>{label}</Text>
    <Text style={S.kpiValue}>{value}</Text>
    {sub && <Text style={[S.kpiSub, { color: subColor ?? `${C.white}BB` }]}>{sub}</Text>}
  </View>
)

// ─── PDF Document ─────────────────────────────────────────────────────────────

const PiloteReport = ({ r }: { r: ComputedReport }) => {
  const { data, clientName, insights, pieBuffer, barBuffer, tops, flops, famMap, caVar } = r
  const { financier_n: fn, financier_n1: fn1, ventes_n: vn, ventes_n1: vn1 } = data
  const generatedOn = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })

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
          <Text style={S.coverSub}>Analyse comparative des ventes</Text>
          <View style={S.coverDivider} />
          <Text style={S.coverWeek}>Semaine {data.week_number} - {data.year}</Text>
          <Text style={S.coverPeriod}>{data.period_n}</Text>
        </View>
        <View style={S.coverWhiteBg}>
          {clientName && (
            <>
              <Text style={S.coverLabel}>CLIENT</Text>
              <Text style={S.coverClient}>{clientName.toUpperCase()}</Text>
            </>
          )}
          <Text style={S.coverMeta}>Genere le {generatedOn}</Text>
          <Text style={S.coverMeta}>Periode comparee (N-1) : {data.period_n1}</Text>
          <Text style={S.coverMeta}>Analyse IA integree - Graphiques de repartition - Top &amp; Flop produits</Text>
        </View>
      </Page>

      {/* PAGE 2 - SYNTHESE FINANCIERE */}
      <Page size="A4" style={S.page}>
        <SecHeader title="SYNTHESE FINANCIERE" />
        <Text style={{ paddingHorizontal: 36, fontSize: 9, color: C.textLight, marginBottom: 8 }}>CHIFFRE D'AFFAIRES</Text>
        <View style={S.kpiRow}>
          <KpiBox label="CA SEMAINE N" value={eur(fn.ca_net)} sub={`S${data.week_number} - ${data.year}`} bg={C.navy} />
          <KpiBox label="CA SEMAINE N-1" value={eur(fn1.ca_net)} sub={`S${data.week_number} - ${data.year - 1}`} bg={C.blue} />
          <KpiBox label="VARIATION" value={signPct(caVar)} sub={signEur(fn.ca_net - fn1.ca_net)} bg={caVar >= 0 ? C.green : C.red} />
        </View>
        <Text style={{ paddingHorizontal: 36, fontSize: 9, color: C.textLight, marginTop: 4, marginBottom: 8 }}>TICKETS &amp; PANIER</Text>
        <View style={[S.kpiRow, { marginBottom: 20 }]}>
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
          {vn.familles.map((fam, i) => {
            const f1 = famMap.get(fam.nom.toUpperCase())
            const ec = fam.total_montant - (f1?.total_montant ?? 0)
            const w = vn.total ? fam.total_montant / vn.total : 0
            return (
              <View key={fam.id} style={i % 2 === 0 ? S.tRow : S.tRowAlt}>
                <Text style={[S.tCellB, { flex: 3 }]}>{trunc(fam.nom, 28)}</Text>
                <Text style={[S.tCellR, { flex: 2 }]}>{eur(fam.total_montant)}</Text>
                <Text style={[S.tCellR, { flex: 2 }]}>{f1 ? eur(f1.total_montant) : '-'}</Text>
                <Text style={[ec >= 0 ? S.tCellGreen : S.tCellRed, { flex: 2 }]}>{signEur(ec)}</Text>
                <Text style={[S.tCellRB, { flex: 1.2 }]}>{pctStr(w)}</Text>
                <Text style={[ec >= 0 ? S.tCellGreen : S.tCellRed, { flex: 1, textAlign: 'center' }]}>{ec >= 0 ? '+' : '-'}</Text>
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
        <SecHeader title="REPARTITION DU CA PAR FAMILLE" />
        <View style={S.chartWrap}>
          {/* outlabeledPie 820x460 -> 490x275 dans le PDF */}
          <Image src={{ data: pieBuffer, format: 'png' }} style={{ width: 490, height: 275 }} />
        </View>
        <Text style={S.chartCaption}>Repartition du CA par famille (€ TTC) — Semaine {data.week_number} {data.year}</Text>
        <View style={[S.tableWrap, { marginTop: 14 }]}>
          <View style={S.tHead}>
            <Text style={[S.tHeadCell, { flex: 3 }]}>FAMILLE</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>CA N (€)</Text>
            <Text style={[S.tHeadCell, { flex: 1.5, textAlign: 'right' }]}>% CA N</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>CA N-1 (€)</Text>
            <Text style={[S.tHeadCell, { flex: 1.5, textAlign: 'right' }]}>% CA N-1</Text>
            <Text style={[S.tHeadCell, { flex: 1.5, textAlign: 'right' }]}>EVOL. CA</Text>
          </View>
          {vn.familles.map((fam, i) => {
            const f1 = famMap.get(fam.nom.toUpperCase())
            const wN = vn.total ? fam.total_montant / vn.total : 0
            const wN1 = vn1.total && f1 ? f1.total_montant / vn1.total : 0
            const evolCA = f1?.total_montant ? (fam.total_montant - f1.total_montant) / f1.total_montant : 0
            return (
              <View key={fam.id} style={i % 2 === 0 ? S.tRow : S.tRowAlt}>
                <Text style={[S.tCellB, { flex: 3 }]}>{trunc(fam.nom, 28)}</Text>
                <Text style={[S.tCellR, { flex: 2 }]}>{eur(fam.total_montant)}</Text>
                <Text style={[S.tCellRB, { flex: 1.5 }]}>{pctStr(wN)}</Text>
                <Text style={[S.tCellR, { flex: 2 }]}>{f1 ? eur(f1.total_montant) : '-'}</Text>
                <Text style={[S.tCellR, { flex: 1.5 }]}>{f1 ? pctStr(wN1) : '-'}</Text>
                <Text style={[f1 ? (evolCA >= 0 ? S.tCellGreen : S.tCellRed) : S.tCellR, { flex: 1.5 }]}>{f1 ? signPct(evolCA) : '-'}</Text>
              </View>
            )
          })}
        </View>
        <Footer page={3} week={data.week_number} year={data.year} />
      </Page>

      {/* PAGE 4 - COMPARAISON N vs N-1 */}
      <Page size="A4" style={S.page}>
        <SecHeader title={`EVOLUTION PAR FAMILLE - ${data.year} vs ${data.year - 1}`} />
        <View style={S.chartWrap}>
          <Image src={{ data: barBuffer, format: 'png' }} style={{ width: 490, height: 360 }} />
        </View>
        <Text style={S.chartCaption}>Comparaison du CA par famille (€ TTC) - S{data.week_number} {data.year} vs S{data.week_number} {data.year - 1}</Text>
        <View style={{ paddingHorizontal: 36, marginTop: 20 }}>
          <Text style={{ fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: C.navy, marginBottom: 10 }}>Synthese des ecarts par famille</Text>
          <View style={S.tHead}>
            <Text style={[S.tHeadCell, { flex: 3 }]}>FAMILLE</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>CA N (€)</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>CA N-1 (€)</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>ECART (€)</Text>
            <Text style={[S.tHeadCell, { flex: 1.5, textAlign: 'right' }]}>ECART %</Text>
          </View>
          {vn.familles.map(fam => ({ fam, f1: famMap.get(fam.nom.toUpperCase()), ec: fam.total_montant - (famMap.get(fam.nom.toUpperCase())?.total_montant ?? 0) }))
            .sort((a, b) => b.ec - a.ec)
            .map(({ fam, f1, ec }, i) => {
              const ecPct = f1?.total_montant ? ec / f1.total_montant : 0
              return (
                <View key={fam.id} style={i % 2 === 0 ? S.tRow : S.tRowAlt}>
                  <Text style={[S.tCellB, { flex: 3 }]}>{trunc(fam.nom, 28)}</Text>
                  <Text style={[S.tCellR, { flex: 2 }]}>{eur(fam.total_montant)}</Text>
                  <Text style={[S.tCellR, { flex: 2 }]}>{f1 ? eur(f1.total_montant) : '-'}</Text>
                  <Text style={[ec >= 0 ? S.tCellGreen : S.tCellRed, { flex: 2 }]}>{signEur(ec)}</Text>
                  <Text style={[ec >= 0 ? S.tCellGreen : S.tCellRed, { flex: 1.5 }]}>{f1 ? signPct(ecPct) : '-'}</Text>
                </View>
              )
            })}
        </View>
        <Footer page={4} week={data.week_number} year={data.year} />
      </Page>

      {/* PAGE 5 - TOP / FLOP */}
      <Page size="A4" style={S.page}>
        <SecHeader title="CE QUI PROGRESSE - CE QUI DECROCHE" />
        <View style={S.topFlopWrap}>
          <View style={S.topFlopLeft}>
            <View style={{ backgroundColor: C.green, paddingVertical: 9, paddingHorizontal: 8 }}>
              <Text style={{ color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 9 }}>CE QUI PROGRESSE</Text>
            </View>
            <View style={{ flexDirection: 'row', backgroundColor: '#F1F5F9', paddingVertical: 5, paddingHorizontal: 8, borderBottomColor: '#CBD5E1', borderBottomWidth: 1 }}>
              <Text style={[S.tHeadCell, { flex: 0.4, color: C.textLight }]}>#</Text>
              <Text style={[S.tHeadCell, { flex: 3 }]}>PRODUIT</Text>
              <Text style={[S.tHeadCell, { flex: 1.8, textAlign: 'right' }]}>CA N (€)</Text>
              <Text style={[S.tHeadCell, { flex: 1.2, textAlign: 'right' }]}>EVOL.</Text>
            </View>
            {tops.map((t, i) => {
              const n1 = t.n - t.ecart
              const pct = n1 > 0 ? (t.ecart / n1 * 100) : 100
              return (
                <View key={i} style={[i % 2 === 0 ? S.tRow : S.tRowAlt, { paddingHorizontal: 8 }]}>
                  <Text style={[S.tCell, { flex: 0.4, fontSize: 7.5, color: C.textLight }]}>{i + 1}</Text>
                  <Text style={[S.tCell, { flex: 3, fontSize: 7.5 }]}>{trunc(t.designation, 24)}</Text>
                  <Text style={[S.tCellR, { flex: 1.8, fontSize: 7.5 }]}>{eur(t.n)}</Text>
                  <Text style={[S.tCellGreen, { flex: 1.2, fontSize: 8, textAlign: 'right' }]}>+{pct.toFixed(0)}%</Text>
                </View>
              )
            })}
          </View>
          <View style={S.topFlopRight}>
            <View style={{ backgroundColor: C.red, paddingVertical: 9, paddingHorizontal: 8 }}>
              <Text style={{ color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 9 }}>CE QUI DECROCHE</Text>
            </View>
            <View style={{ flexDirection: 'row', backgroundColor: '#F1F5F9', paddingVertical: 5, paddingHorizontal: 8, borderBottomColor: '#CBD5E1', borderBottomWidth: 1 }}>
              <Text style={[S.tHeadCell, { flex: 0.4, color: C.textLight }]}>#</Text>
              <Text style={[S.tHeadCell, { flex: 3 }]}>PRODUIT</Text>
              <Text style={[S.tHeadCell, { flex: 1.8, textAlign: 'right' }]}>CA N (€)</Text>
              <Text style={[S.tHeadCell, { flex: 1.2, textAlign: 'right' }]}>EVOL.</Text>
            </View>
            {flops.map((f, i) => {
              const n1 = f.n - f.ecart
              const pct = n1 > 0 ? Math.abs(f.ecart / n1 * 100) : 100
              return (
                <View key={i} style={[i % 2 === 0 ? S.tRow : S.tRowAlt, { paddingHorizontal: 8 }]}>
                  <Text style={[S.tCell, { flex: 0.4, fontSize: 7.5, color: C.textLight }]}>{i + 1}</Text>
                  <Text style={[S.tCell, { flex: 3, fontSize: 7.5 }]}>{trunc(f.designation, 24)}</Text>
                  <Text style={[S.tCellR, { flex: 1.8, fontSize: 7.5 }]}>{eur(f.n)}</Text>
                  <Text style={[S.tCellRed, { flex: 1.2, fontSize: 8, textAlign: 'right' }]}>-{pct.toFixed(0)}%</Text>
                </View>
              )
            })}
          </View>
        </View>
        <Footer page={5} week={data.week_number} year={data.year} />
      </Page>

      {/* PAGE 6 - ANALYSE IA */}
      <Page size="A4" style={S.page}>
        <SecHeader title="ANALYSE INTELLIGENTE - INSIGHTS CLES" />
        <Text style={{ paddingHorizontal: 36, fontSize: 8.5, color: C.textLight, marginBottom: 16 }}>Analyse generee par intelligence artificielle - Semaine {data.week_number} {data.year}</Text>
        <View style={S.insightBlock}>
          {insights.insights.map((txt, i) => (
            <View key={i} style={S.insightRow}>
              <View style={S.insightBullet}><Text style={S.bulletNum}>{i + 1}</Text></View>
              <Text style={S.insightText}>{txt}</Text>
            </View>
          ))}
        </View>
        <View style={{ marginTop: 24 }}>
          <SecHeader title="RECOMMANDATIONS POUR LA SEMAINE PROCHAINE" />
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

    </Document>
  )
}

// ─── Data extraction ──────────────────────────────────────────────────────────

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

async function extractTopFlop(textN: string, textN1: string): Promise<{
  tops: { designation: string; n: number; ecart: number }[]
  flops: { designation: string; n: number; ecart: number }[]
}> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })
  const r = await client.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 2048,
    messages: [{ role: 'user', content: `Compare les ventes N vs N-1. Top 10 progressions et Top 10 baisses en euros.\nRetourne UNIQUEMENT ce JSON:\n{"tops":[{"d":"NOM","n":634.37,"e":150.00}],"flops":[{"d":"NOM","n":100.00,"e":-80.00}]}\n\n=== VENTES N ===\n${textN.slice(0, 3000)}\n\n=== VENTES N-1 ===\n${textN1.slice(0, 3000)}` }],
  })
  try {
    type R = { tops: { d: string; n: number; e: number }[]; flops: { d: string; n: number; e: number }[] }
    const parsed: R = JSON.parse(extractJSONObject(r.content[0].type === 'text' ? r.content[0].text : ''))
    return {
      tops:  (parsed.tops  || []).slice(0, 10).map(x => ({ designation: x.d, n: x.n, ecart: x.e })),
      flops: (parsed.flops || []).slice(0, 10).map(x => ({ designation: x.d, n: x.n, ecart: x.e })),
    }
  } catch { return { tops: [], flops: [] } }
}

async function extractData(texts: { fin_n: string; fin_n1: string; ventes_n: string; ventes_n1: string }): Promise<ReportData> {
  const [financials, ventes_n, ventes_n1, topFlop] = await Promise.all([
    extractFinancials(texts.fin_n, texts.fin_n1),
    extractVentesData(texts.ventes_n),
    extractVentesData(texts.ventes_n1),
    extractTopFlop(texts.ventes_n, texts.ventes_n1),
  ])
  return {
    period_n: financials.period_n, period_n1: financials.period_n1,
    week_number: financials.week_number, year: financials.year,
    financier_n: financials.financier_n, financier_n1: financials.financier_n1,
    ventes_n, ventes_n1, tops: topFlop.tops, flops: topFlop.flops,
  }
}

async function generateInsights(data: ReportData): Promise<Insights> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })
  const fn = data.financier_n, fn1 = data.financier_n1
  const caVar = fn1.ca_net ? ((fn.ca_net - fn1.ca_net) / fn1.ca_net * 100).toFixed(1) : '0'
  const famMapI = new Map<string, Famille>()
  for (const f of data.ventes_n1.familles) famMapI.set(f.nom.toUpperCase(), f)
  const famSummary = data.ventes_n.familles.map(f => {
    const f1 = famMapI.get(f.nom.toUpperCase())
    const ec = f.total_montant - (f1?.total_montant ?? 0)
    const pctCA = data.ventes_n.total ? (f.total_montant / data.ventes_n.total * 100).toFixed(1) : '0'
    return `${f.nom} : ${f.total_montant.toFixed(0)} EUR (${pctCA}% du CA), ecart N-1 : ${ec >= 0 ? '+' : ''}${ec.toFixed(0)} EUR`
  }).join('\n')
  const r = await client.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 1024,
    messages: [{ role: 'user', content: `Tu es expert en analyse de ventes pour une boucherie artisanale. Genere des insights concis et des recommandations en francais professionnel.\n\nDONNEES SEMAINE ${data.week_number} (${data.period_n}) :\nCA N : ${fn.ca_net.toFixed(2)} EUR | CA N-1 : ${fn1.ca_net.toFixed(2)} EUR | Variation : ${caVar}%\nTickets N : ${fn.nb_tickets} | Panier moyen N : ${fn.moyenne_ticket.toFixed(2)} EUR\n\nVENTES PAR FAMILLE :\n${famSummary}\n\nRetourne UNIQUEMENT ce JSON:\n{"insights":["insight 1","insight 2","insight 3","insight 4","insight 5"],"recommendations":["reco 1","reco 2","reco 3"]}\n\nInsights : faits precis avec chiffres. Recommandations : actions concretes boucherie. Tout en francais, une phrase par bullet.` }],
  })
  try {
    return JSON.parse(extractJSONObject(r.content[0].type === 'text' ? r.content[0].text : ''))
  } catch {
    return { insights: ['Analyse non disponible.'], recommendations: ['Contactez votre conseiller PILOTE.'] }
  }
}

// ─── QuickChart ───────────────────────────────────────────────────────────────
// REGLES ABSOLUES QuickChart :
// 1. Aucun caractere non-ASCII dans la config JSON
// 2. ticks.callback interdit — crash Chart.js 2.9.4 dans le sandbox
// 3. title.text doit etre une string simple (pas un array)
// 4. outlabeledPie : leader lines vers les labels externes
// 5. PIE = TOUTES les familles (pas de groupement) — le dashboard fait le top4+Autres

async function getChartBuffers(data: ReportData): Promise<{ pieBuffer: Buffer; barBuffer: Buffer }> {
  const famMapC = new Map<string, Famille>()
  for (const f of data.ventes_n1.familles) famMapC.set(f.nom.toUpperCase(), f)

  // Strip diacritics + non-ASCII (QuickChart sandbox rule)
  const toAscii = (s: string) =>
    s.normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\x00-\x7F]/g, '?')

  // Toutes les familles (bar + pie)
  const famNames = data.ventes_n.familles.map(f => trunc(toAscii(f.nom), 18))
  const famCA    = data.ventes_n.familles.map(f => +f.total_montant.toFixed(2))
  const famCA1   = data.ventes_n.familles.map(f => +(famMapC.get(f.nom.toUpperCase())?.total_montant ?? 0).toFixed(2))

  // Palette 10 couleurs distinctes pour le camembert (toutes familles)
  const donutPalette = [
    '#1E3A5F', '#DC2626', '#D97706', '#059669',
    '#7C3AED', '#0891B2', '#BE185D', '#65A30D', '#9333EA', '#F59E0B',
  ].slice(0, famNames.length)

  // outlabeledPie : leader lines + label + % pour chaque famille
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

  const barConfig = {
    type: 'bar',
    data: {
      labels: famNames,
      datasets: [
        { label: `N-1 (${data.year - 1})`, data: famCA1, backgroundColor: '#94A3B8', barThickness: 24 },
        { label: `N (${data.year})`, data: famCA, backgroundColor: '#2563EB', barThickness: 24 },
      ],
    },
    options: {
      title: { display: true, text: `CA par famille - S${data.week_number} ${data.year} vs ${data.year - 1} - en EUR`, fontSize: 13, fontColor: '#1E293B', fontStyle: 'bold', padding: 14 },
      legend: { position: 'top', labels: { fontSize: 11, padding: 18, boxWidth: 14, fontColor: '#1E293B' } },
      layout: { padding: { top: 20, bottom: 8, left: 8, right: 8 } },
      scales: {
        xAxes: [{ ticks: { fontSize: 10, fontColor: '#1E293B', fontStyle: 'bold' }, gridLines: { display: false } }],
        yAxes: [{
          ticks: { beginAtZero: true, fontSize: 9, fontColor: '#64748B', maxTicksLimit: 6 },
          gridLines: { color: '#E8EDF3', drawBorder: false, lineWidth: 0.8 },
        }],
      },
      plugins: { datalabels: { display: false } },
    },
  }

  const pieBody = JSON.stringify({ chart: pieConfig, width: 820, height: 460, backgroundColor: 'white', version: '2.9.4' })
  const barBody = JSON.stringify({ chart: barConfig, width: 720, height: 470, backgroundColor: 'white', version: '2.9.4' })

  const QC = 'https://quickchart.io/chart'
  const [pieRes, barRes] = await Promise.all([
    fetch(QC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: pieBody }),
    fetch(QC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: barBody }),
  ])

  if (!pieRes.ok) {
    const ct = pieRes.headers.get('content-type') || ''
    const body = ct.includes('image') ? '[binary image]' : (await pieRes.text()).slice(0, 300)
    throw new Error(`QuickChart pie ${pieRes.status} | ${body}`)
  }
  if (!barRes.ok) {
    const ct = barRes.headers.get('content-type') || ''
    const body = ct.includes('image') ? '[binary image]' : (await barRes.text()).slice(0, 300)
    throw new Error(`QuickChart bar ${barRes.status} | ${body}`)
  }

  const [pieBuffer, barBuffer] = await Promise.all([
    pieRes.arrayBuffer().then(ab => Buffer.from(ab)),
    barRes.arrayBuffer().then(ab => Buffer.from(ab)),
  ])
  return { pieBuffer, barBuffer }
}

async function generatePDF(report: ComputedReport): Promise<Buffer> {
  return renderToBuffer(React.createElement(PiloteReport, { r: report }))
}

// ─── POST Handler ─────────────────────────────────────────────────────────────

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

    const [insightsResult, chartsResult] = await Promise.all([
      generateInsights(data),
      getChartBuffers(data),
    ])

    const famMap = new Map<string, Famille>()
    for (const f of data.ventes_n1.familles) famMap.set(f.nom.toUpperCase(), f)
    const caVar = data.financier_n1.ca_net
      ? (data.financier_n.ca_net - data.financier_n1.ca_net) / data.financier_n1.ca_net
      : 0

    let clientEmail: string | null = null
    let clientName:  string | null = null
    if (clientId) {
      const { data: client } = await serviceSupabase.from('clients').select('email, name').eq('id', clientId).single()
      if (client) { clientEmail = client.email; clientName = client.name }
    }

    const report: ComputedReport = {
      data, clientName, insights: insightsResult,
      pieBuffer: chartsResult.pieBuffer, barBuffer: chartsResult.barBuffer,
      tops: data.tops, flops: data.flops, famMap, caVar,
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
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto"><div style="background:#1E3A5F;padding:32px 40px"><div style="color:#FF8C00;font-size:11px;letter-spacing:4px;margin-bottom:10px">PILOTE</div><h2 style="color:#FFFFFF;margin:0;font-size:22px">Votre rapport est pret</h2></div><div style="padding:32px 40px;border:1px solid #E0E0E0;border-top:none"><p style="color:#444;margin-top:0"><strong>${title}</strong></p><p style="color:#666;font-size:14px">6 pages - Analyse IA - Graphiques - Top &amp; Flop produits</p><div style="margin:28px 0;text-align:center"><a href="${fileUrl}" style="background:#1E3A5F;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px">Telecharger le rapport PDF</a></div><p style="color:#999;font-size:11px;text-align:center">Rapport confidentiel - Genere automatiquement par PILOTE</p></div></div>`,
    })

    if (clientId) {
      // Stocker TOUTES les familles (slice 12000 garantit qu'elles sont toutes extraites)
      const familiesDetail = data.ventes_n.familles.map((f: Famille) => ({ nom: f.nom, montant: f.total_montant }))
      await serviceSupabase.from('weekly_ca').delete()
        .eq('client_id', clientId).eq('week_number', data.week_number).eq('year', data.year)
      await serviceSupabase.from('weekly_ca').insert({
        client_id: clientId,
        week_number: data.week_number,
        year: data.year,
        ca_total: data.financier_n.ca_net,
        families_detail: familiesDetail,
      })
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
