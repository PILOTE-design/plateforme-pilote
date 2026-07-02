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
}
interface Insights { insights: string[]; recommendations: string[] }
interface ComputedReport {
  data: ReportData
  clientName: string | null
  insights: Insights
  pieDataUrl: string
  barDataUrl: string
  tops: { designation: string; n: number; ecart: number }[]
  flops: { designation: string; n: number; ecart: number }[]
  famMap: Map<string, Famille>
  caVar: number
}

// ─── Formatters ───────────────────────────────────────────────────────────────
const eur = (n: number) =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const signEur = (n: number) => (n >= 0 ? '+' : '') + eur(n)
const signPct = (n: number) => (n >= 0 ? '+' : '') + (n * 100).toFixed(1) + '%'
const pctStr = (n: number) => (n * 100).toFixed(1) + '%'
const trunc = (s: string, len: number) => (s.length > len ? s.slice(0, len - 1) + '…' : s)

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

const CHART_COLORS = [
  '#1E3A5F','#FF8C00','#2E7D32','#C62828','#6A1B9A',
  '#00695C','#E65100','#1565C0','#37474F','#F57F17','#558B2F','#AD1457',
]

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  // ── Cover ──
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

  // ── Shared layout ──
  page:           { backgroundColor: C.white, paddingTop: 0, paddingBottom: 40, paddingHorizontal: 0 },
  contentBlock:   { paddingHorizontal: 36, paddingTop: 32 },
  secHeader:      { flexDirection: 'row', alignItems: 'center', backgroundColor: C.navy, paddingVertical: 10, paddingHorizontal: 36, marginBottom: 18 },
  secHeaderDot:   { width: 7, height: 7, borderRadius: 3.5, backgroundColor: C.orange, marginRight: 8 },
  secHeaderText:  { color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 11, letterSpacing: 1 },
  footer:         { position: 'absolute', bottom: 20, left: 36, right: 36, flexDirection: 'row', justifyContent: 'space-between', borderTopColor: C.line, borderTopWidth: 0.5, paddingTop: 6 },
  footerText:     { fontSize: 7.5, color: C.textLight },

  // ── KPI boxes ──
  kpiRow:         { flexDirection: 'row', paddingHorizontal: 36, marginBottom: 10 },
  kpiBox:         { flex: 1, borderRadius: 6, padding: 14, marginRight: 8 },
  kpiLabel:       { fontSize: 8, letterSpacing: 1, marginBottom: 6 },
  kpiValue:       { fontFamily: 'Helvetica-Bold', fontSize: 17, color: C.white },
  kpiSub:         { fontSize: 9, marginTop: 3 },

  // ── Tables ──
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

  // ── Charts ──
  chartWrap:      { alignItems: 'center', paddingHorizontal: 36, marginBottom: 8 },
  chartCaption:   { fontSize: 8, color: C.textLight, textAlign: 'center', marginTop: 4, paddingHorizontal: 36 },

  // ── Insights ──
  insightBlock:   { paddingHorizontal: 36 },
  insightRow:     { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  insightBullet:  { width: 20, height: 20, borderRadius: 10, backgroundColor: C.navy, alignItems: 'center', justifyContent: 'center', marginRight: 12, flexShrink: 0 },
  recoBullet:     { width: 20, height: 20, borderRadius: 10, backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center', marginRight: 12, flexShrink: 0 },
  bulletNum:      { color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 8 },
  insightText:    { fontSize: 9.5, color: C.textMid, flex: 1, lineHeight: 1.55 },

  // ── Top/Flop columns ──
  topFlopWrap:    { flexDirection: 'row', paddingHorizontal: 36 },
  topFlopCol:     { flex: 1 },
  topFlopLeft:    { flex: 1, marginRight: 10 },
  topFlopRight:   { flex: 1, marginLeft: 10 },
  colLabel:       { padding: 7, marginBottom: 6 },
  colLabelGreen:  { padding: 7, marginBottom: 6, backgroundColor: C.lightGreen },
  colLabelRed:    { padding: 7, marginBottom: 6, backgroundColor: C.lightRed },
  colLabelTextG:  { color: C.green, fontFamily: 'Helvetica-Bold', fontSize: 9 },
  colLabelTextR:  { color: C.red, fontFamily: 'Helvetica-Bold', fontSize: 9 },
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
    <Text style={S.footerText}>PILOTE · Rapport S{week}/{year} · Document confidentiel</Text>
    <Text style={S.footerText}>Page {page}</Text>
  </View>
)

const KpiBox = ({
  label, value, sub, bg, subColor,
}: { label: string; value: string; sub?: string; bg: string; subColor?: string }) => (
  <View style={[S.kpiBox, { backgroundColor: bg }]}>
    <Text style={[S.kpiLabel, { color: `${C.white}99` }]}>{label}</Text>
    <Text style={S.kpiValue}>{value}</Text>
    {sub && <Text style={[S.kpiSub, { color: subColor ?? `${C.white}BB` }]}>{sub}</Text>}
  </View>
)

// ─── PDF Document ─────────────────────────────────────────────────────────────

const PiloteReport = ({ r }: { r: ComputedReport }) => {
  const { data, clientName, insights, pieDataUrl, barDataUrl, tops, flops, famMap, caVar } = r
  const { financier_n: fn, financier_n1: fn1, ventes_n: vn, ventes_n1: vn1 } = data
  const generatedOn = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })

  return (
    <Document title={`Rapport S${data.week_number} - ${data.period_n}`} author="PILOTE" language="fr">

      {/* ══ PAGE 1 — COUVERTURE ══════════════════════════════════════════════ */}
      <Page size="A4" style={{ backgroundColor: C.white }}>
        <View style={S.coverBlueBg}>
          <View style={S.coverTagRow}>
            <View style={S.coverTagDot} />
            <Text style={S.coverTagText}>PILOTE</Text>
          </View>
          <Text style={S.coverTitle}>Rapport{'\n'}Hebdomadaire</Text>
          <Text style={S.coverSub}>Analyse comparative des ventes</Text>
          <View style={S.coverDivider} />
          <Text style={S.coverWeek}>Semaine {data.week_number}  ·  {data.year}</Text>
          <Text style={S.coverPeriod}>{data.period_n}</Text>
        </View>
        <View style={S.coverWhiteBg}>
          {clientName && (
            <>
              <Text style={S.coverLabel}>CLIENT</Text>
              <Text style={S.coverClient}>{clientName.toUpperCase()}</Text>
            </>
          )}
          <Text style={S.coverMeta}>Généré le {generatedOn}</Text>
          <Text style={S.coverMeta}>Période comparée (N-1) : {data.period_n1}</Text>
          <Text style={S.coverMeta}>Analyse IA intégrée · Graphiques de répartition · Top & Flop produits</Text>
        </View>
      </Page>

      {/* ══ PAGE 2 — SYNTHÈSE FINANCIÈRE ════════════════════════════════════ */}
      <Page size="A4" style={S.page}>
        <SecHeader title="SYNTHÈSE FINANCIÈRE" />

        {/* KPI Row 1 — Chiffre d'affaires */}
        <Text style={{ paddingHorizontal: 36, fontSize: 9, color: C.textLight, marginBottom: 8 }}>
          CHIFFRE D'AFFAIRES
        </Text>
        <View style={S.kpiRow}>
          <KpiBox label="CA SEMAINE N" value={eur(fn.ca_net)}
            sub={`S${data.week_number} · ${data.year}`} bg={C.navy} />
          <KpiBox label="CA SEMAINE N-1" value={eur(fn1.ca_net)}
            sub={`S${data.week_number} · ${data.year - 1}`} bg={C.blue} />
          <KpiBox
            label="VARIATION" value={signPct(caVar)}
            sub={signEur(fn.ca_net - fn1.ca_net)}
            bg={caVar >= 0 ? C.green : C.red}
          />
        </View>

        {/* KPI Row 2 — Tickets */}
        <Text style={{ paddingHorizontal: 36, fontSize: 9, color: C.textLight, marginTop: 4, marginBottom: 8 }}>
          TICKETS & PANIER
        </Text>
        <View style={[S.kpiRow, { marginBottom: 20 }]}>
          <KpiBox
            label="TICKETS N" value={String(fn.nb_tickets)}
            sub={`${fn.nb_tickets - fn1.nb_tickets >= 0 ? '+' : ''}${fn.nb_tickets - fn1.nb_tickets} vs N-1`}
            bg={fn.nb_tickets >= fn1.nb_tickets ? C.green : C.red}
          />
          <KpiBox label="TICKETS N-1" value={String(fn1.nb_tickets)}
            sub={`S${data.week_number} · ${data.year - 1}`} bg={C.blue} />
          <KpiBox
            label="PANIER MOYEN" value={eur(fn.moyenne_ticket)}
            sub={`N-1 : ${eur(fn1.moyenne_ticket)}`}
            bg={fn.moyenne_ticket >= fn1.moyenne_ticket ? C.green : C.red}
          />
        </View>

        {/* Table familles */}
        <Text style={{ paddingHorizontal: 36, fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: C.navy, marginBottom: 10 }}>
          Récapitulatif par famille de produits
        </Text>
        <View style={S.tableWrap}>
          <View style={S.tHead}>
            <Text style={[S.tHeadCell, { flex: 3 }]}>FAMILLE</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>CA N</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>CA N-1</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>ÉCART</Text>
            <Text style={[S.tHeadCell, { flex: 1.2, textAlign: 'right' }]}>% CA</Text>
            <Text style={[S.tHeadCell, { flex: 1, textAlign: 'center' }]}>TEND.</Text>
          </View>
          {vn.familles.map((fam, i) => {
            const f1 = famMap.get(fam.nom.toUpperCase())
            const ec = fam.total_montant - (f1?.total_montant ?? 0)
            const w = vn.total ? fam.total_montant / vn.total : 0
            const row = i % 2 === 0 ? S.tRow : S.tRowAlt
            return (
              <View key={fam.id} style={row}>
                <Text style={[S.tCellB, { flex: 3 }]}>{trunc(fam.nom, 28)}</Text>
                <Text style={[S.tCellR, { flex: 2 }]}>{eur(fam.total_montant)}</Text>
                <Text style={[S.tCellR, { flex: 2 }]}>{f1 ? eur(f1.total_montant) : '—'}</Text>
                <Text style={[ec >= 0 ? S.tCellGreen : S.tCellRed, { flex: 2 }]}>{signEur(ec)}</Text>
                <Text style={[S.tCellRB, { flex: 1.2 }]}>{pctStr(w)}</Text>
                <Text style={[ec >= 0 ? S.tCellGreen : S.tCellRed, { flex: 1, textAlign: 'center' }]}>
                  {ec >= 0 ? '▲' : '▼'}
                </Text>
              </View>
            )
          })}
          <View style={S.tTotal}>
            <Text style={[S.tTotalCellL, { flex: 3 }]}>TOTAL GÉNÉRAL</Text>
            <Text style={[S.tTotalCell, { flex: 2 }]}>{eur(vn.total)}</Text>
            <Text style={[S.tTotalCell, { flex: 2 }]}>{eur(vn1.total)}</Text>
            <Text style={[S.tTotalCell, { flex: 2 }]}>{signEur(vn.total - vn1.total)}</Text>
            <Text style={[S.tTotalCell, { flex: 1.2 }]}>100%</Text>
            <Text style={[S.tTotalCell, { flex: 1, textAlign: 'center' }]}>
              {vn.total >= vn1.total ? '▲' : '▼'}
            </Text>
          </View>
        </View>

        <Footer page={2} week={data.week_number} year={data.year} />
      </Page>

      {/* ══ PAGE 3 — RÉPARTITION CA (CAMEMBERT) ═════════════════════════════ */}
      <Page size="A4" style={S.page}>
        <SecHeader title="RÉPARTITION DU CA PAR FAMILLE" />
        <View style={S.chartWrap}>
          <Image src={pieDataUrl} style={{ width: 490, height: 300 }} />
        </View>
        <Text style={S.chartCaption}>
          Poids de chaque famille dans le chiffre d'affaires total — Semaine {data.week_number} {data.year}
        </Text>

        {/* Table % CA N vs N-1 */}
        <View style={[S.tableWrap, { marginTop: 14 }]}>
          <View style={S.tHead}>
            <Text style={[S.tHeadCell, { flex: 3 }]}>FAMILLE</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>CA N</Text>
            <Text style={[S.tHeadCell, { flex: 1.5, textAlign: 'right' }]}>% N</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>CA N-1</Text>
            <Text style={[S.tHeadCell, { flex: 1.5, textAlign: 'right' }]}>% N-1</Text>
            <Text style={[S.tHeadCell, { flex: 1.5, textAlign: 'right' }]}>ÉVOL. %</Text>
          </View>
          {vn.familles.map((fam, i) => {
            const f1 = famMap.get(fam.nom.toUpperCase())
            const wN = vn.total ? fam.total_montant / vn.total : 0
            const wN1 = vn1.total && f1 ? f1.total_montant / vn1.total : 0
            const evolPct = wN1 ? (wN - wN1) / wN1 : 0
            return (
              <View key={fam.id} style={i % 2 === 0 ? S.tRow : S.tRowAlt}>
                <Text style={[S.tCellB, { flex: 3 }]}>{trunc(fam.nom, 28)}</Text>
                <Text style={[S.tCellR, { flex: 2 }]}>{eur(fam.total_montant)}</Text>
                <Text style={[S.tCellRB, { flex: 1.5 }]}>{pctStr(wN)}</Text>
                <Text style={[S.tCellR, { flex: 2 }]}>{f1 ? eur(f1.total_montant) : '—'}</Text>
                <Text style={[S.tCellR, { flex: 1.5 }]}>{f1 ? pctStr(wN1) : '—'}</Text>
                <Text style={[evolPct >= 0 ? S.tCellGreen : S.tCellRed, { flex: 1.5 }]}>
                  {f1 ? signPct(evolPct) : '—'}
                </Text>
              </View>
            )
          })}
        </View>

        <Footer page={3} week={data.week_number} year={data.year} />
      </Page>

      {/* ══ PAGE 4 — COMPARAISON N vs N-1 (BARRES) ══════════════════════════ */}
      <Page size="A4" style={S.page}>
        <SecHeader title={`ÉVOLUTION PAR FAMILLE — ${data.year} vs ${data.year - 1}`} />
        <View style={S.chartWrap}>
          <Image src={barDataUrl} style={{ width: 490, height: 360 }} />
        </View>
        <Text style={S.chartCaption}>
          Comparaison du chiffre d'affaires par famille — Semaine {data.week_number} {data.year} vs Semaine {data.week_number} {data.year - 1}
        </Text>

        {/* Résumé textuel des variations */}
        <View style={{ paddingHorizontal: 36, marginTop: 20 }}>
          <Text style={{ fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: C.navy, marginBottom: 10 }}>
            Synthèse des écarts par famille
          </Text>
          <View style={S.tHead}>
            <Text style={[S.tHeadCell, { flex: 3 }]}>FAMILLE</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>CA N</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>CA N-1</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>ÉCART €</Text>
            <Text style={[S.tHeadCell, { flex: 1.5, textAlign: 'right' }]}>ÉCART %</Text>
          </View>
          {vn.familles
            .map(fam => {
              const f1 = famMap.get(fam.nom.toUpperCase())
              const ec = fam.total_montant - (f1?.total_montant ?? 0)
              const ecPct = f1?.total_montant ? ec / f1.total_montant : 0
              return { fam, f1, ec, ecPct }
            })
            .sort((a, b) => b.ec - a.ec)
            .map(({ fam, f1, ec, ecPct }, i) => (
              <View key={fam.id} style={i % 2 === 0 ? S.tRow : S.tRowAlt}>
                <Text style={[S.tCellB, { flex: 3 }]}>{trunc(fam.nom, 28)}</Text>
                <Text style={[S.tCellR, { flex: 2 }]}>{eur(fam.total_montant)}</Text>
                <Text style={[S.tCellR, { flex: 2 }]}>{f1 ? eur(f1.total_montant) : '—'}</Text>
                <Text style={[ec >= 0 ? S.tCellGreen : S.tCellRed, { flex: 2 }]}>{signEur(ec)}</Text>
                <Text style={[ec >= 0 ? S.tCellGreen : S.tCellRed, { flex: 1.5 }]}>
                  {f1 ? signPct(ecPct) : '—'}
                </Text>
              </View>
            ))}
        </View>

        <Footer page={4} week={data.week_number} year={data.year} />
      </Page>

      {/* ══ PAGE 5 — TOP 10 / FLOP 10 ════════════════════════════════════════ */}
      <Page size="A4" style={S.page}>
        <SecHeader title="TOP 10 / FLOP 10 PRODUITS" />

        <View style={S.topFlopWrap}>
          {/* TOP 10 */}
          <View style={S.topFlopLeft}>
            <View style={S.colLabelGreen}>
              <Text style={S.colLabelTextG}>▲  MEILLEURES PROGRESSIONS</Text>
            </View>
            <View style={[S.tHead, { backgroundColor: C.green }]}>
              <Text style={[S.tHeadCell, { flex: 3 }]}>PRODUIT</Text>
              <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>CA N</Text>
              <Text style={[S.tHeadCell, { flex: 1.5, textAlign: 'right' }]}>ÉCART</Text>
            </View>
            {tops.map((t, i) => (
              <View key={i} style={i % 2 === 0 ? S.tRow : S.tRowAlt}>
                <Text style={[S.tCell, { flex: 3, fontSize: 8 }]}>{trunc(t.designation, 24)}</Text>
                <Text style={[S.tCellR, { flex: 2, fontSize: 8 }]}>{eur(t.n)}</Text>
                <Text style={[S.tCellGreen, { flex: 1.5, fontSize: 8 }]}>{signEur(t.ecart)}</Text>
              </View>
            ))}
          </View>

          {/* FLOP 10 */}
          <View style={S.topFlopRight}>
            <View style={S.colLabelRed}>
              <Text style={S.colLabelTextR}>▼  PLUS FORTES BAISSES</Text>
            </View>
            <View style={[S.tHead, { backgroundColor: C.red }]}>
              <Text style={[S.tHeadCell, { flex: 3 }]}>PRODUIT</Text>
              <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>CA N</Text>
              <Text style={[S.tHeadCell, { flex: 1.5, textAlign: 'right' }]}>ÉCART</Text>
            </View>
            {flops.map((f, i) => (
              <View key={i} style={i % 2 === 0 ? S.tRow : S.tRowAlt}>
                <Text style={[S.tCell, { flex: 3, fontSize: 8 }]}>{trunc(f.designation, 24)}</Text>
                <Text style={[S.tCellR, { flex: 2, fontSize: 8 }]}>{eur(f.n)}</Text>
                <Text style={[S.tCellRed, { flex: 1.5, fontSize: 8 }]}>{signEur(f.ecart)}</Text>
              </View>
            ))}
          </View>
        </View>

        <Footer page={5} week={data.week_number} year={data.year} />
      </Page>

      {/* ══ PAGE 6 — ANALYSE IA & RECOMMANDATIONS ═══════════════════════════ */}
      <Page size="A4" style={S.page}>
        <SecHeader title="ANALYSE INTELLIGENTE — INSIGHTS CLÉS" />

        <Text style={{ paddingHorizontal: 36, fontSize: 8.5, color: C.textLight, marginBottom: 16 }}>
          Analyse générée par intelligence artificielle · Semaine {data.week_number} {data.year}
        </Text>

        <View style={S.insightBlock}>
          {insights.insights.map((txt, i) => (
            <View key={i} style={S.insightRow}>
              <View style={S.insightBullet}>
                <Text style={S.bulletNum}>{i + 1}</Text>
              </View>
              <Text style={S.insightText}>{txt}</Text>
            </View>
          ))}
        </View>

        {/* Recommandations */}
        <View style={{ marginTop: 24 }}>
          <SecHeader title="RECOMMANDATIONS POUR LA SEMAINE PROCHAINE" />
          <View style={S.insightBlock}>
            {insights.recommendations.map((txt, i) => (
              <View key={i} style={S.insightRow}>
                <View style={S.recoBullet}>
                  <Text style={S.bulletNum}>{i + 1}</Text>
                </View>
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
  if (typeof fn !== 'function') throw new Error('pdf-parse not callable: ' + typeof _m.default)
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
  throw new Error('Unclosed JSON object in response: ' + text.slice(0, 200))
}

async function extractFinancials(fin_n: string, fin_n1: string): Promise<{
  period_n: string; period_n1: string; week_number: number; year: number
  financier_n: FinancierData; financier_n1: FinancierData
}> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{ role: 'user', content: 'Extrais les donnees financieres CRISALID. Retourne UNIQUEMENT ce JSON sans texte avant/apres:\n{"period_n":"15-21 juin 2026","period_n1":"16-22 juin 2025","week_number":25,"year":2026,"financier_n":{"ca_net":20742.43,"nb_tickets":496,"moyenne_ticket":41.82},"financier_n1":{"ca_net":19316.76,"nb_tickets":453,"moyenne_ticket":42.64}}\n\n=== FINANCIER N ===\n' + fin_n.slice(0, 3000) + '\n=== FINANCIER N-1 ===\n' + fin_n1.slice(0, 3000) }],
  })
  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  return JSON.parse(extractJSONObject(text))
}

async function extractVentesData(ventes_text: string): Promise<{ total: number; familles: Famille[] }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8192,
    messages: [{ role: 'user', content: "Extrais les ventes CRISALID en format compact. Retourne UNIQUEMENT ce JSON (pas d'autre texte):\n{\"total\":20742.43,\"f\":[[\"VIANDE DE BOEUF\",\"1\",3081.17,[[\"112\",\"STEAK HACHE\",31.798,634.37],[\"113\",\"BAVETTE\",5.234,156.75]]],[\"BOEUF ELABORE\",\"2\",425.00,[[\"201\",\"BOURGUIGNON\",8.5,425.00]]]]}\n\nFormat: {\"total\":X,\"f\":[[\"NOM_FAMILLE\",\"ID\",total_montant,[[\"PLU\",\"DESIGNATION\",ventes,montant],...]],...]}\nIMPORTANT: Inclus TOUTES les familles et TOUS les articles sans exception. Ne tronque pas.\n\n" + ventes_text }],
  })
  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  type C = { total: number; f: [string, string, number, [string, string, number, number][]][] }
  const compact: C = JSON.parse(extractJSONObject(text))
  return {
    total: compact.total,
    familles: compact.f.map(([nom, id, total_montant, produits]) => ({
      id, nom, total_montant,
      produits: (produits || []).map(([plu, designation, ventes, montant]) => ({ plu, designation, ventes, montant })),
    })),
  }
}

async function extractData(texts: {
  fin_n: string; fin_n1: string; ventes_n: string; ventes_n1: string
}): Promise<ReportData> {
  const [financials, ventes_n, ventes_n1] = await Promise.all([
    extractFinancials(texts.fin_n, texts.fin_n1),
    extractVentesData(texts.ventes_n),
    extractVentesData(texts.ventes_n1),
  ])
  return {
    period_n: financials.period_n, period_n1: financials.period_n1,
    week_number: financials.week_number, year: financials.year,
    financier_n: financials.financier_n, financier_n1: financials.financier_n1,
    ventes_n, ventes_n1,
  }
}

// ─── Claude Sonnet — Insights bullet-points ───────────────────────────────────

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
    return `${f.nom} : ${f.total_montant.toFixed(0)} € (${pctCA}% du CA), écart N-1 : ${ec >= 0 ? '+' : ''}${ec.toFixed(0)} €`
  }).join('\n')

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `Tu es expert en analyse de ventes pour une boucherie artisanale. Génère des insights concis et des recommandations en français professionnel.

DONNÉES SEMAINE ${data.week_number} (${data.period_n}) :
CA N : ${fn.ca_net.toFixed(2)} € | CA N-1 : ${fn1.ca_net.toFixed(2)} € | Variation : ${caVar}%
Tickets N : ${fn.nb_tickets} | Panier moyen N : ${fn.moyenne_ticket.toFixed(2)} € | Panier moyen N-1 : ${fn1.moyenne_ticket.toFixed(2)} €

VENTES PAR FAMILLE :
${famSummary}

Retourne UNIQUEMENT ce JSON sans aucun texte avant ou après :
{"insights":["insight 1","insight 2","insight 3","insight 4","insight 5"],"recommendations":["reco 1","reco 2","reco 3"]}

Règles :
• Insights : faits précis avec chiffres (ex. "Le CA progresse de X %, tiré par la famille…")
• Recommandations : actions concrètes spécifiques à la boucherie (ex. "Mettre en avant…", "Renforcer le stock de…")
• Tout en français, ton direct et professionnel, une phrase par bullet`,
    }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  try {
    return JSON.parse(extractJSONObject(text))
  } catch {
    return {
      insights: ['Analyse non disponible pour cette semaine.'],
      recommendations: ['Contactez votre conseiller PILOTE pour une analyse personnalisée.'],
    }
  }
}

// ─── QuickChart — Graphiques PNG ─────────────────────────────────────────────

async function getChartBuffers(data: ReportData): Promise<{ pieBuffer: Buffer; barBuffer: Buffer }> {
  const famMapC = new Map<string, Famille>()
  for (const f of data.ventes_n1.familles) famMapC.set(f.nom.toUpperCase(), f)
  const famNames  = data.ventes_n.familles.map(f => trunc(f.nom, 22))
  const famCA     = data.ventes_n.familles.map(f => +f.total_montant.toFixed(2))
  const famCA1    = data.ventes_n.familles.map(f => +(famMapC.get(f.nom.toUpperCase())?.total_montant ?? 0).toFixed(2))
  const bgColors  = CHART_COLORS.slice(0, famNames.length)

  const pieConfig = {
    type: 'doughnut',
    data: {
      labels: famNames,
      datasets: [{ data: famCA, backgroundColor: bgColors, borderWidth: 2, borderColor: '#FFFFFF' }],
    },
    options: {
      legend: { position: 'right', labels: { fontSize: 11, padding: 14, boxWidth: 14 } },
      title: {
        display: true,
        text: `Répartition CA par famille — S${data.week_number} ${data.year}`,
        fontSize: 13, fontColor: '#1E3A5F', padding: 16,
      },
      cutoutPercentage: 50,
    },
  }

  const barConfig = {
    type: 'horizontalBar',
    data: {
      labels: famNames,
      datasets: [
        { label: `N (${data.year})`,     data: famCA,  backgroundColor: '#1E3A5F', barThickness: 13 },
        { label: `N-1 (${data.year-1})`, data: famCA1, backgroundColor: '#90CAF9', barThickness: 13 },
      ],
    },
    options: {
      title: {
        display: true,
        text: `CA par famille — N vs N-1`,
        fontSize: 13, fontColor: '#1E3A5F', padding: 14,
      },
      legend: { position: 'top', labels: { fontSize: 11 } },
      scales: {
        xAxes: [{
          ticks: { fontSize: 10 },
          gridLines: { color: '#E0E0E0' },
        }],
        yAxes: [{ ticks: { fontSize: 10 } }],
      },
    },
  }

  const QC = 'https://quickchart.io/chart'
  const [pieRes, barRes] = await Promise.all([
    fetch(QC, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chart: pieConfig, width: 720, height: 370, backgroundColor: 'white', version: '2.9.4' }) }),
    fetch(QC, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chart: barConfig, width: 720, height: 480, backgroundColor: 'white', version: '2.9.4' }) }),
  ])

  if (!pieRes.ok) throw new Error('QuickChart pie: ' + await pieRes.text())
  if (!barRes.ok) throw new Error('QuickChart bar: ' + await barRes.text())

  const [pieBuffer, barBuffer] = await Promise.all([
    pieRes.arrayBuffer().then(ab => Buffer.from(ab)),
    barRes.arrayBuffer().then(ab => Buffer.from(ab)),
  ])
  return { pieBuffer, barBuffer }
}

// ─── PDF rendering ────────────────────────────────────────────────────────────

async function generatePDF(report: ComputedReport): Promise<Buffer> {
  const element = React.createElement(PiloteReport, { r: report })
  return renderToBuffer(element)
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

    // 1. Parse PDFs (parallel)
    const [tFN, tFN1, tVN, tVN1] = await Promise.all([
      parsePDF(finN), parsePDF(finN1), parsePDF(venN), parsePDF(venN1),
    ])

    // 2. Extract structured data (3 Haiku calls parallel)
    const data = await extractData({ fin_n: tFN, fin_n1: tFN1, ventes_n: tVN, ventes_n1: tVN1 })

    // 3. Insights + Charts in parallel (Sonnet + 2 QuickChart)
    const [insightsResult, chartsResult] = await Promise.all([
      generateInsights(data),
      getChartBuffers(data),
    ])

    // 4. Pre-compute derived data
    const famMap = new Map<string, Famille>()
    for (const f of data.ventes_n1.familles) famMap.set(f.nom.toUpperCase(), f)
    const prodMap = new Map<string, Produit>()
    for (const f of data.ventes_n1.familles) for (const p of f.produits) prodMap.set(p.plu, p)

    const comps: { designation: string; n: number; ecart: number }[] = []
    for (const fam of data.ventes_n.familles) {
      for (const p of fam.produits) {
        const p1 = prodMap.get(p.plu)
        if (p1) comps.push({ designation: p.designation, n: p.montant, ecart: p.montant - p1.montant })
      }
    }
    const tops  = [...comps].sort((a, b) => b.ecart - a.ecart).slice(0, 10)
    const flops = [...comps].sort((a, b) => a.ecart - b.ecart).slice(0, 10)
    const caVar = data.financier_n1.ca_net
      ? (data.financier_n.ca_net - data.financier_n1.ca_net) / data.financier_n1.ca_net
      : 0

    // 5. Get client info
    let clientEmail: string | null = null
    let clientName:  string | null = null
    if (clientId) {
      const { data: client } = await serviceSupabase.from('clients').select('email, name').eq('id', clientId).single()
      if (client) { clientEmail = client.email; clientName = client.name }
    }

    // 6. Build ComputedReport + generate PDF
    const report: ComputedReport = {
      data, clientName, insights: insightsResult,
      pieDataUrl: `data:image/png;base64,${chartsResult.pieBuffer.toString('base64')}`,
      barDataUrl: `data:image/png;base64,${chartsResult.barBuffer.toString('base64')}`,
      tops, flops, famMap, caVar,
    }
    const pdfBuffer = await generatePDF(report)

    // 7. Upload to Supabase storage
    const fileName = `rapport-s${data.week_number}-${data.year}-${Date.now()}.pdf`
    const { error: uploadError } = await serviceSupabase.storage.from('reports').upload(
      fileName, pdfBuffer, { contentType: 'application/pdf', upsert: false },
    )
    if (uploadError) return NextResponse.json({ error: 'Upload: ' + uploadError.message }, { status: 500 })

    const { data: urlData } = serviceSupabase.storage.from('reports').getPublicUrl(fileName)
    const fileUrl = urlData.publicUrl

    // 8. Save to DB
    const title = `Analyse S${data.week_number} - ${data.period_n}${clientName ? ' — ' + clientName : ''}`
    const { error: dbError } = await serviceSupabase.from('reports').insert({
      profile_id: profile.id, title,
      week_number: data.week_number, year: data.year,
      file_url: fileUrl,
      ...(clientId ? { client_id: clientId } : {}),
    })
    if (dbError) return NextResponse.json({ error: 'DB: ' + dbError.message }, { status: 500 })

    // 9. Email
    const toEmail = clientEmail || profile.delivery_email || user.email || ''
    const resend = new Resend(process.env.RESEND_API_KEY ?? '')
    await resend.emails.send({
      from: 'PILOTE <onboarding@resend.dev>',
      to: toEmail,
      subject: `Rapport hebdomadaire ${title}`,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#1E3A5F;padding:32px 40px">
          <div style="color:#FF8C00;font-size:11px;letter-spacing:4px;margin-bottom:10px">PILOTE</div>
          <h2 style="color:#FFFFFF;margin:0;font-size:22px">Votre rapport est prêt</h2>
        </div>
        <div style="padding:32px 40px;border:1px solid #E0E0E0;border-top:none">
          <p style="color:#444;margin-top:0"><strong>${title}</strong></p>
          <p style="color:#666;font-size:14px">6 pages · Analyse IA · Graphiques de répartition · Top &amp; Flop produits</p>
          <div style="margin:28px 0;text-align:center">
            <a href="${fileUrl}"
               style="background:#1E3A5F;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px">
              Télécharger le rapport PDF
            </a>
          </div>
          <p style="color:#999;font-size:11px;text-align:center">Rapport confidentiel · Généré automatiquement par PILOTE</p>
        </div>
      </div>`,
    })

    return NextResponse.json({ success: true, title, file_url: fileUrl })

  } catch (err: unknown) {
    console.error(err)
    const _e = err instanceof Error ? err : new Error(String(err))
    return NextResponse.json({
      error: _e.message + ' || STACK: ' + (_e.stack || '').replace(/\n/g, ' > ').slice(0, 600),
    }, { status: 500 })
  }
}
