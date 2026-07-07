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

interface ScheduleDetails {
  am_start?: string; am_end?: string
  pm_start?: string; pm_end?: string
}

interface HREmpStat {
  name: string; position: string; contract_type: string
  contract_hours: number; hourly_rate: number
  hours_worked: number
  cost_base: number; cost_hs: number
  cost_dimanche: number; cost_ferie: number; cost_nuit: number; cost_total: number
  is_minor: boolean
}
interface HRData {
  has_data: boolean; total_hours: number; total_cost: number
  ratio_ca: number; employees: HREmpStat[]; alerts: string[]
}

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
  hr: HRData
}

// ─── Formatters ───────────────────────────────────────────────────────────────
const eur = (n: number) => {
  const abs = Math.abs(n)
  const [int, dec] = abs.toFixed(2).split('.')
  const intFmt = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return (n < 0 ? '-' : '') + intFmt + ',' + dec + ' EUR'
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

// ─── HR Page Component ────────────────────────────────────────────────────────

const HRPage = ({ hr, week, year }: { hr: HRData; week: number; year: number }) => {
  const ratioPct = (hr.ratio_ca * 100).toFixed(1)
  const ratioBg = hr.ratio_ca > 0.40 ? C.red : hr.ratio_ca > 0.35 ? C.orange : C.green

  return (
    <>
      <SecHeader title="ANALYSE RH & MASSE SALARIALE" />

      {/* KPI Row */}
      <View style={[S.kpiRow, { marginBottom: 16 }]}>
        <KpiBox label="MASSE SALARIALE" value={eur(hr.total_cost)}
          sub="Brut + majorations CCN 992" bg={C.navy} />
        <KpiBox
          label="RATIO / CA"
          value={`${ratioPct} %`}
          sub={hr.ratio_ca > 0.35 ? 'Seuil 35 % depasse' : 'Objectif < 35 %'}
          bg={ratioBg}
        />
        <KpiBox label="HEURES EQUIPE" value={`${hr.total_hours.toFixed(1)} h`}
          sub="Total heures travaillees" bg={C.blue} />
      </View>

      {/* Table employes */}
      <View style={S.tableWrap}>
        <View style={S.tHead}>
          <Text style={[S.tHeadCell, { flex: 2.2 }]}>EMPLOYE</Text>
          <Text style={[S.tHeadCell, { flex: 1.4 }]}>CONTRAT</Text>
          <Text style={[S.tHeadCell, { flex: 1, textAlign: 'right' }]}>HEURES</Text>
          <Text style={[S.tHeadCell, { flex: 1.4, textAlign: 'right' }]}>BASE</Text>
          <Text style={[S.tHeadCell, { flex: 1, textAlign: 'right' }]}>HS</Text>
          <Text style={[S.tHeadCell, { flex: 1, textAlign: 'right' }]}>DIM.</Text>
          <Text style={[S.tHeadCell, { flex: 1, textAlign: 'right' }]}>FER.</Text>
          <Text style={[S.tHeadCell, { flex: 1, textAlign: 'right' }]}>NUIT</Text>
          <Text style={[S.tHeadCell, { flex: 1.4, textAlign: 'right' }]}>TOTAL</Text>
        </View>
        {hr.employees.map((emp, i) => (
          <View key={i} style={i % 2 === 0 ? S.tRow : S.tRowAlt}>
            <Text style={[S.tCellB, { flex: 2.2 }]}>
              {trunc(emp.name, 18)}{emp.is_minor ? ' (m)' : ''}
            </Text>
            <Text style={[S.tCell, { flex: 1.4 }]}>{emp.contract_type} {emp.contract_hours}h</Text>
            <Text style={[S.tCellR, { flex: 1 }]}>{emp.hours_worked.toFixed(1)}h</Text>
            <Text style={[S.tCellR, { flex: 1.4 }]}>{eur(emp.cost_base)}</Text>
            <Text style={[emp.cost_hs > 0 ? S.tCellRed : S.tCellR, { flex: 1 }]}>
              {emp.cost_hs > 0 ? eur(emp.cost_hs) : '-'}
            </Text>
            <Text style={[S.tCellR, { flex: 1 }]}>
              {emp.cost_dimanche > 0 ? eur(emp.cost_dimanche) : '-'}
            </Text>
            <Text style={[S.tCellR, { flex: 1 }]}>
              {emp.cost_ferie > 0 ? eur(emp.cost_ferie) : '-'}
            </Text>
            <Text style={[S.tCellR, { flex: 1 }]}>
              {emp.cost_nuit > 0 ? eur(emp.cost_nuit) : '-'}
            </Text>
            <Text style={[S.tCellRB, { flex: 1.4 }]}>{eur(emp.cost_total)}</Text>
          </View>
        ))}
        <View style={S.tTotal}>
          <Text style={[S.tTotalCellL, { flex: 2.2 }]}>TOTAL EQUIPE</Text>
          <Text style={[S.tTotalCell, { flex: 1.4 }]}></Text>
          <Text style={[S.tTotalCell, { flex: 1 }]}>{hr.total_hours.toFixed(1)}h</Text>
          <Text style={[S.tTotalCell, { flex: 1.4 }]}></Text>
          <Text style={[S.tTotalCell, { flex: 1 }]}></Text>
          <Text style={[S.tTotalCell, { flex: 1 }]}></Text>
          <Text style={[S.tTotalCell, { flex: 1 }]}></Text>
          <Text style={[S.tTotalCell, { flex: 1 }]}></Text>
          <Text style={[S.tTotalCell, { flex: 1.4 }]}>{eur(hr.total_cost)}</Text>
        </View>
      </View>

      {/* Alertes reglementaires */}
      {hr.alerts.length > 0 && (
        <View style={{ paddingHorizontal: 36, marginTop: 14 }}>
          <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.red, marginBottom: 6 }}>
            ALERTES REGLEMENTAIRES CCN 992
          </Text>
          {hr.alerts.map((a, i) => (
            <Text key={i} style={{ fontSize: 8.5, color: C.textMid, marginBottom: 3 }}>{a}</Text>
          ))}
        </View>
      )}

      {/* Disclaimer legal */}
      <View style={{ paddingHorizontal: 36, marginTop: 14, paddingTop: 10, borderTopColor: C.line, borderTopWidth: 0.5 }}>
        <Text style={{ fontSize: 7.5, color: C.textLight, lineHeight: 1.4 }}>
          Ces donnees sont calculees a titre indicatif a partir du planning PILOTE (CCN Boucherie-Charcuterie IDCC 992).
          Elles ne constituent pas un bulletin de paie officiel. Consultez votre expert-comptable pour la paie definitive.
          Semaine {week} · {year}
        </Text>
      </View>
    </>
  )
}

// ─── PDF Document ─────────────────────────────────────────────────────────────

const PiloteReport = ({ r }: { r: ComputedReport }) => {
  const { data, clientName, insights, pieBuffer, barBuffer, tops, flops, famMap, caVar, hr } = r
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
          <Text style={S.coverMeta}>Genere le {generatedOn}</Text>
          <Text style={S.coverMeta}>Periode comparee (N-1) : {data.period_n1}</Text>
          <Text style={S.coverMeta}>
            Analyse IA integree · Graphiques de repartition · Top &amp; Flop produits
            {hr.has_data ? ' · Analyse RH & Masse salariale' : ''}
          </Text>
        </View>
      </Page>

      {/* ══ PAGE 2 — SYNTHESE FINANCIERE ════════════════════════════════════ */}
      <Page size="A4" style={S.page}>
        <SecHeader title="SYNTHESE FINANCIERE" />

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

        <Text style={{ paddingHorizontal: 36, fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: C.navy, marginBottom: 10 }}>
          Recapitulatif par famille de produits
        </Text>
        <View style={S.tableWrap}>
          <View style={S.tHead}>
            <Text style={[S.tHeadCell, { flex: 3 }]}>FAMILLE</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>CA N</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>CA N-1</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>ECART</Text>
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
                <Text style={[ec >= 0 ? S.tCellGreen : S.tCellRed, { flex: 1, textAlign: 'center' }]}>
                  {ec >= 0 ? '+' : '-'}
                </Text>
              </View>
            )
          })}
          <View style={S.tTotal}>
            <Text style={[S.tTotalCellL, { flex: 3 }]}>TOTAL GENERAL</Text>
            <Text style={[S.tTotalCell, { flex: 2 }]}>{eur(vn.total)}</Text>
            <Text style={[S.tTotalCell, { flex: 2 }]}>{eur(vn1.total)}</Text>
            <Text style={[S.tTotalCell, { flex: 2 }]}>{signEur(vn.total - vn1.total)}</Text>
            <Text style={[S.tTotalCell, { flex: 1.2 }]}>100%</Text>
            <Text style={[S.tTotalCell, { flex: 1, textAlign: 'center' }]}>
              {vn.total >= vn1.total ? '+' : '-'}
            </Text>
          </View>
        </View>

        <Footer page={2} week={data.week_number} year={data.year} />
      </Page>

      {/* ══ PAGE 3 — REPARTITION CA (CAMEMBERT) ═════════════════════════════ */}
      <Page size="A4" style={S.page}>
        <SecHeader title="REPARTITION DU CA PAR FAMILLE" />
        <View style={S.chartWrap}>
          <Image src={`data:image/png;base64,${pieBuffer.toString('base64')}`} style={{ width: 490, height: 300 }} />
        </View>
        <Text style={S.chartCaption}>
          Poids de chaque famille dans le chiffre d'affaires total - Semaine {data.week_number} {data.year}
        </Text>

        <View style={[S.tableWrap, { marginTop: 14 }]}>
          <View style={S.tHead}>
            <Text style={[S.tHeadCell, { flex: 3 }]}>FAMILLE</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>CA N</Text>
            <Text style={[S.tHeadCell, { flex: 1.5, textAlign: 'right' }]}>% N</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>CA N-1</Text>
            <Text style={[S.tHeadCell, { flex: 1.5, textAlign: 'right' }]}>% N-1</Text>
            <Text style={[S.tHeadCell, { flex: 1.5, textAlign: 'right' }]}>EVOL. %</Text>
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
                <Text style={[S.tCellR, { flex: 2 }]}>{f1 ? eur(f1.total_montant) : '-'}</Text>
                <Text style={[S.tCellR, { flex: 1.5 }]}>{f1 ? pctStr(wN1) : '-'}</Text>
                <Text style={[evolPct >= 0 ? S.tCellGreen : S.tCellRed, { flex: 1.5 }]}>
                  {f1 ? signPct(evolPct) : '-'}
                </Text>
              </View>
            )
          })}
        </View>

        <Footer page={3} week={data.week_number} year={data.year} />
      </Page>

      {/* ══ PAGE 4 — COMPARAISON N vs N-1 (BARRES) ══════════════════════════ */}
      <Page size="A4" style={S.page}>
        <SecHeader title={`EVOLUTION PAR FAMILLE - ${data.year} vs ${data.year - 1}`} />
        <View style={S.chartWrap}>
          <Image src={`data:image/png;base64,${barBuffer.toString('base64')}`} style={{ width: 490, height: 360 }} />
        </View>
        <Text style={S.chartCaption}>
          Comparaison du chiffre d'affaires par famille - Semaine {data.week_number} {data.year} vs Semaine {data.week_number} {data.year - 1}
        </Text>

        <View style={{ paddingHorizontal: 36, marginTop: 20 }}>
          <Text style={{ fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: C.navy, marginBottom: 10 }}>
            Synthese des ecarts par famille
          </Text>
          <View style={S.tHead}>
            <Text style={[S.tHeadCell, { flex: 3 }]}>FAMILLE</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>CA N</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>CA N-1</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>ECART EUR</Text>
            <Text style={[S.tHeadCell, { flex: 1.5, textAlign: 'right' }]}>ECART %</Text>
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
                <Text style={[S.tCellR, { flex: 2 }]}>{f1 ? eur(f1.total_montant) : '-'}</Text>
                <Text style={[ec >= 0 ? S.tCellGreen : S.tCellRed, { flex: 2 }]}>{signEur(ec)}</Text>
                <Text style={[ec >= 0 ? S.tCellGreen : S.tCellRed, { flex: 1.5 }]}>
                  {f1 ? signPct(ecPct) : '-'}
                </Text>
              </View>
            ))}
        </View>

        <Footer page={4} week={data.week_number} year={data.year} />
      </Page>

      {/* ══ PAGE 5 — CE QUI PROGRESSE / CE QUI DECROCHE ════════════════════ */}
      <Page size="A4" style={S.page}>
        <SecHeader title="CE QUI PROGRESSE - CE QUI DECROCHE" />

        <View style={S.topFlopWrap}>
          <View style={S.topFlopLeft}>
            <View style={{ backgroundColor: C.green, paddingVertical: 9, paddingHorizontal: 8 }}>
              <Text style={{ color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 9, letterSpacing: 0.5 }}>
                CE QUI PROGRESSE
              </Text>
            </View>
            <View style={{ flexDirection: 'row', backgroundColor: '#F1F5F9', paddingVertical: 5, paddingHorizontal: 8, borderBottomColor: '#CBD5E1', borderBottomWidth: 1 }}>
              <Text style={[S.tHeadCell, { flex: 0.4, color: C.textLight }]}>#</Text>
              <Text style={[S.tHeadCell, { flex: 3 }]}>PRODUIT</Text>
              <Text style={[S.tHeadCell, { flex: 1.8, textAlign: 'right' }]}>CA N</Text>
              <Text style={[S.tHeadCell, { flex: 1.2, textAlign: 'right' }]}>EVOL.</Text>
            </View>
            {tops.map((t, i) => {
              const n1 = t.n - t.ecart
              const pct = n1 > 0 ? (t.ecart / n1 * 100) : 100
              return (
                <View key={i} style={[i % 2 === 0 ? S.tRow : S.tRowAlt, { paddingHorizontal: 8, borderBottomColor: '#EEF2F7', borderBottomWidth: 0.6 }]}>
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
              <Text style={{ color: C.white, fontFamily: 'Helvetica-Bold', fontSize: 9, letterSpacing: 0.5 }}>
                CE QUI DECROCHE
              </Text>
            </View>
            <View style={{ flexDirection: 'row', backgroundColor: '#F1F5F9', paddingVertical: 5, paddingHorizontal: 8, borderBottomColor: '#CBD5E1', borderBottomWidth: 1 }}>
              <Text style={[S.tHeadCell, { flex: 0.4, color: C.textLight }]}>#</Text>
              <Text style={[S.tHeadCell, { flex: 3 }]}>PRODUIT</Text>
              <Text style={[S.tHeadCell, { flex: 1.8, textAlign: 'right' }]}>CA N</Text>
              <Text style={[S.tHeadCell, { flex: 1.2, textAlign: 'right' }]}>EVOL.</Text>
            </View>
            {flops.map((f, i) => {
              const n1 = f.n - f.ecart
              const pct = n1 > 0 ? Math.abs(f.ecart / n1 * 100) : 100
              return (
                <View key={i} style={[i % 2 === 0 ? S.tRow : S.tRowAlt, { paddingHorizontal: 8, borderBottomColor: '#EEF2F7', borderBottomWidth: 0.6 }]}>
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

      {/* ══ PAGE 6 — ANALYSE IA & RECOMMANDATIONS ═══════════════════════════ */}
      <Page size="A4" style={S.page}>
        <SecHeader title="ANALYSE INTELLIGENTE - INSIGHTS CLES" />

        <Text style={{ paddingHorizontal: 36, fontSize: 8.5, color: C.textLight, marginBottom: 16 }}>
          Analyse generee par intelligence artificielle · Semaine {data.week_number} {data.year}
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

      {/* ══ PAGE 7 — ANALYSE RH & MASSE SALARIALE (conditionnelle) ══════════ */}
      {hr.has_data && (
        <Page size="A4" style={S.page}>
          <HRPage hr={hr} week={data.week_number} year={data.year} />
          <Footer page={7} week={data.week_number} year={data.year} />
        </Page>
      )}

    </Document>
  )
}

// ─── HR Helpers ───────────────────────────────────────────────────────────────

function parseTimeHR(t: string): number {
  if (!t) return 0
  const parts = t.split(':')
  const h = parseInt(parts[0] ?? '0', 10)
  const m = parseInt(parts[1] ?? '0', 10)
  return h + m / 60
}

function calcHoursFromSchedule(sd: ScheduleDetails | null): number {
  if (!sd) return 0
  let h = 0
  if (sd.am_start && sd.am_end) h += parseTimeHR(sd.am_end) - parseTimeHR(sd.am_start)
  if (sd.pm_start && sd.pm_end) h += parseTimeHR(sd.pm_end) - parseTimeHR(sd.pm_start)
  return Math.max(0, h)
}

function calcBaseCostHR(hours: number, rate: number, contractH: number): { base: number; hs: number } {
  const base = hours * rate
  const overH = Math.max(hours - contractH, 0)
  if (overH === 0) return { base, hs: 0 }
  const hs25 = Math.min(overH, 8)
  const hs50 = Math.max(overH - 8, 0)
  const hs = hs25 * rate * 0.25 + hs50 * rate * 0.50
  return { base, hs }
}

function getEasterHR(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

function getFrenchHolidaysHR(year: number): Set<string> {
  const easter = getEasterHR(year)
  const ms = easter.getTime()
  const DAY = 86400000
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return new Set([
    `${year}-01-01`,
    fmt(new Date(ms + DAY)),
    `${year}-05-01`,
    `${year}-05-08`,
    fmt(new Date(ms + 39 * DAY)),
    fmt(new Date(ms + 50 * DAY)),
    `${year}-07-14`,
    `${year}-08-15`,
    `${year}-11-01`,
    `${year}-11-11`,
    `${year}-12-25`,
  ])
}

function getWeekDatesHR(weekNumber: number, year: number): string[] {
  const jan4 = new Date(year, 0, 4)
  const dow = jan4.getDay() || 7
  const monday = new Date(jan4.getTime() - (dow - 1) * 86400000 + (weekNumber - 1) * 7 * 86400000)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday.getTime() + i * 86400000)
    return d.toISOString().slice(0, 10)
  })
}

function getSeasonalContext(weekNumber: number): string {
  if (weekNumber >= 14 && weekNumber <= 17) return 'Semaine de Paques - pic habituel de +20 a +40 % vs semaine standard.'
  if (weekNumber >= 24 && weekNumber <= 30) return 'Periode estivale - legere hausse attendue (+10 a +15 %).'
  if (weekNumber >= 49 && weekNumber <= 52) return "Fin d'annee - pic majeur attendu (+30 a +50 %)."
  if (weekNumber >= 1 && weekNumber <= 7) return 'Creux de janvier-fevrier - baisse habituelle de -15 a -25 %.'
  return 'Semaine standard - pas de saisonnalite marquee.'
}

// ─── Fetch Planning HR ────────────────────────────────────────────────────────

async function fetchPlanningHR(
  clientId: string | null,
  weekNumber: number,
  year: number,
  caNet: number,
): Promise<HRData> {
  const empty: HRData = { has_data: false, total_hours: 0, total_cost: 0, ratio_ca: 0, employees: [], alerts: [] }
  if (!clientId) return empty

  const supabase = createServiceClient()

  const { data: employees, error: empErr } = await supabase
    .from('employees')
    .select('id, name, position, contract_type, contract_hours, hourly_rate, is_minor')
    .eq('client_id', clientId)

  if (empErr || !employees || employees.length === 0) return empty

  const empIds = (employees as { id: string }[]).map(e => e.id)

  const { data: entries, error: entErr } = await supabase
    .from('planning_entries')
    .select('employee_id, day, hours, type, schedule_details')
    .in('employee_id', empIds)
    .eq('week_number', weekNumber)
    .eq('year', year)

  if (entErr || !entries || entries.length === 0) return empty

  const weekDates = getWeekDatesHR(weekNumber, year)
  const holidays = getFrenchHolidaysHR(year)
  const alerts: string[] = []
  const empStats: HREmpStat[] = []
  let totalHours = 0
  let totalCost = 0

  for (const emp of employees as {
    id: string; name: string; position: string | null
    contract_type: string | null; contract_hours: number | null
    hourly_rate: number | null; is_minor: boolean | null
  }[]) {
    const contractH = emp.contract_hours ?? 35
    const rate = emp.hourly_rate ?? 0
    const empEntries = (entries as {
      employee_id: string; day: number | null; hours: number | null
      type: string | null; schedule_details: ScheduleDetails | null
    }[]).filter(e => e.employee_id === emp.id)

    let weekHours = 0
    let costDimanche = 0, costFerie = 0, costNuit = 0

    for (const entry of empEntries) {
      const t = (entry.type ?? 'travail').toLowerCase()
      if (t === 'conge' || t === 'cp' || t === 'maladie' || t === 'absence') continue

      const dayIdx = entry.day ?? 0
      const hours = entry.hours ?? calcHoursFromSchedule(entry.schedule_details)
      weekHours += hours

      const dayDate = weekDates[dayIdx]

      if (dayIdx === 6) costDimanche += hours * rate * 0.20
      if (dayDate && holidays.has(dayDate)) costFerie += hours * rate * 1.00

      const sd = entry.schedule_details
      if (sd) {
        const slots: [string | undefined, string | undefined][] = [
          [sd.am_start, sd.am_end],
          [sd.pm_start, sd.pm_end],
        ]
        for (const [start, end] of slots) {
          if (!start || !end) continue
          const sh = parseTimeHR(start)
          const eh = parseTimeHR(end)
          const slotH = Math.max(0, eh - sh)
          if (sh < 6) {
            const nightH = Math.min(eh, 6) - sh
            costNuit += Math.max(0, nightH) * rate * 0.25
          }
          if (eh > 21) {
            const nightH = eh - Math.max(sh, 21)
            costNuit += Math.max(0, nightH) * rate * 0.25
          }
          void slotH
        }
      }
    }

    if (weekHours > 48) alerts.push(`${emp.name} : ${weekHours.toFixed(1)}h cette semaine - depassement legal (max 48h)`)
    if ((emp.is_minor ?? false) && weekHours > 35) {
      alerts.push(`${emp.name} (mineur) : ${weekHours.toFixed(1)}h - depassement legal (max 35h)`)
    }

    const { base: costBase, hs: costHs } = calcBaseCostHR(weekHours, rate, contractH)
    const costTotal = costBase + costHs + costDimanche + costFerie + costNuit

    empStats.push({
      name: emp.name,
      position: emp.position ?? 'boucher',
      contract_type: emp.contract_type ?? 'CDI',
      contract_hours: contractH,
      hourly_rate: rate,
      hours_worked: weekHours,
      cost_base: costBase,
      cost_hs: costHs,
      cost_dimanche: costDimanche,
      cost_ferie: costFerie,
      cost_nuit: costNuit,
      cost_total: costTotal,
      is_minor: emp.is_minor ?? false,
    })

    totalHours += weekHours
    totalCost += costTotal
  }

  const ratioCa = caNet > 0 ? totalCost / caNet : 0
  if (ratioCa > 0.40) {
    alerts.push(`Ratio masse salariale : ${(ratioCa * 100).toFixed(1)} % du CA - seuil critique de 40 % depasse`)
  } else if (ratioCa > 0.35) {
    alerts.push(`Ratio masse salariale : ${(ratioCa * 100).toFixed(1)} % du CA - proche du seuil d'alerte (35 %)`)
  }

  return {
    has_data: empStats.length > 0,
    total_hours: totalHours,
    total_cost: totalCost,
    ratio_ca: ratioCa,
    employees: empStats,
    alerts,
  }
}

// ─── Data extraction ──────────────────────────────────────────────────────────

async function parsePDF(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer())
  const _m = await import('pdf-parse') as { default?: (b: Buffer) => Promise<{ text: string }> }
  const fn = typeof _m.default === 'function' ? _m.default : (_m as unknown as (b: Buffer) => Promise<{ text: string }>)
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
  return JSON.parse(extractJSONObject(text)) as {
    period_n: string; period_n1: string; week_number: number; year: number
    financier_n: FinancierData; financier_n1: FinancierData
  }
}

function parseNum(s: string): number {
  return parseFloat(s.trim().replace(/\s/g, '').replace(',', '.')) || 0
}

async function extractVentesData(ventes_text: string): Promise<{ total: number; familles: Famille[] }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{ role: 'user', content: `Extrais les totaux par famille du fichier CRISALID.\nRetourne UNIQUEMENT ces lignes (une par ligne), sans texte avant ou apres:\nTOTAL|20742.43\nVIANDE DE BOEUF|1|3081.17\nCHARCUTERIE|2|2500.00\nPORC|3|1800.50\n\nFormat:\n- 1ere ligne: TOTAL|montant_total\n- Puis une ligne par famille: NOM_FAMILLE|ID|montant_famille\nUtilise le point (.) comme separateur decimal. N'inclus PAS les articles individuels.\n\n${ventes_text.slice(0, 12000)}` }],
  })
  const text = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  let total = 0
  const familles: Famille[] = []
  for (const line of lines) {
    const parts = line.split('|')
    if (parts[0]?.toUpperCase() === 'TOTAL' && parts[1]) {
      total = parseNum(parts[1])
    } else if (parts.length >= 3) {
      const montant = parseNum(parts[2] ?? '0')
      if (montant > 0) {
        familles.push({
          id: parts[1]?.trim() || String(familles.length + 1),
          nom: parts[0]?.trim() ?? '',
          total_montant: montant,
          produits: [],
        })
      }
    }
  }
  return { total, familles }
}

async function extractTopFlop(textN: string, textN1: string): Promise<{
  tops: { designation: string; n: number; ecart: number }[]
  flops: { designation: string; n: number; ecart: number }[]
}> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{ role: 'user', content: `Compare les ventes produit par produit entre N et N-1. Identifie les 10 articles avec la plus forte progression et les 10 avec la plus forte baisse en euros.\nRetourne UNIQUEMENT ce JSON:\n{"tops":[{"d":"NOM PRODUIT","n":634.37,"e":150.00}],"flops":[{"d":"NOM PRODUIT","n":100.00,"e":-80.00}]}\nFormat: {"tops":[{"d":"designation","n":montant_N,"e":ecart_positif},...x10],"flops":[{"d":"designation","n":montant_N,"e":ecart_negatif},...x10]}\n\n=== VENTES N ===\n${textN.slice(0, 8000)}\n\n=== VENTES N-1 ===\n${textN1.slice(0, 8000)}` }],
  })
  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  try {
    type R = { tops: { d: string; n: number; e: number }[]; flops: { d: string; n: number; e: number }[] }
    const r: R = JSON.parse(extractJSONObject(text)) as R
    return {
      tops:  (r.tops  || []).slice(0, 10).map(x => ({ designation: x.d, n: x.n, ecart: x.e })),
      flops: (r.flops || []).slice(0, 10).map(x => ({ designation: x.d, n: x.n, ecart: x.e })),
    }
  } catch {
    return { tops: [], flops: [] }
  }
}

async function extractData(texts: {
  fin_n: string; fin_n1: string; ventes_n: string; ventes_n1: string
}): Promise<ReportData> {
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
    ventes_n, ventes_n1,
    tops: topFlop.tops,
    flops: topFlop.flops,
  }
}

// ─── Claude Sonnet — Insights enrichis boucher + RH ──────────────────────────

async function generateInsights(data: ReportData, hr: HRData): Promise<Insights> {
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

  const seasonalCtx = getSeasonalContext(data.week_number)

  const hrCtx = hr.has_data
    ? `\nDONNEES RH :\nMasse salariale : ${hr.total_cost.toFixed(0)} EUR | Ratio CA : ${(hr.ratio_ca * 100).toFixed(1)}% (seuil alerte 35%) | Heures equipe : ${hr.total_hours.toFixed(1)}h\nAlertes RH : ${hr.alerts.length > 0 ? hr.alerts.join('; ') : 'Aucune'}`
    : ''

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    messages: [{
      role: 'user',
      content: `Tu es expert en gestion et analyse pour une boucherie artisanale francaise. Genere des insights precis et des recommandations actionnables en francais professionnel.\n\nDONNEES SEMAINE ${data.week_number} (${data.period_n}) :\nCA N : ${fn.ca_net.toFixed(2)} EUR | CA N-1 : ${fn1.ca_net.toFixed(2)} EUR | Variation : ${caVar}%\nTickets N : ${fn.nb_tickets} | Panier moyen N : ${fn.moyenne_ticket.toFixed(2)} EUR | Panier moyen N-1 : ${fn1.moyenne_ticket.toFixed(2)} EUR\n\nVENTES PAR FAMILLE :\n${famSummary}\n\nCONTEXTE SAISONNIER : ${seasonalCtx}\n${hrCtx}\n\nBENCHMARKS SECTORIELS (boucherie artisanale CCN 992) :\n- Marge brute cible : 35-45% (viande), 40-55% (charcuterie maison), 50-65% (traiteur)\n- Ratio masse salariale cible : < 35% du CA (alerte a 40%)\n- Mix CA ideal : Boucherie 55-60%, Charcuterie 20-25%, Traiteur 15-20%\n\nRetourne UNIQUEMENT ce JSON sans aucun texte avant ou apres :\n{"insights":["insight 1","insight 2","insight 3","insight 4","insight 5"],"recommendations":["reco 1","reco 2","reco 3"]}\n\nRegles :\n- Insights : faits precis chiffres, integre la saisonnalite si pertinent, compare aux benchmarks sectoriels\n- Recommandations : actions concretes et specifiques${hr.has_data && hr.ratio_ca > 0.35 ? '. IMPORTANT: inclure une recommandation RH car ratio masse salariale > 35%.' : ''}\n- Ton direct et professionnel, une phrase par bullet, tout en francais`,
    }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  try {
    return JSON.parse(extractJSONObject(text)) as Insights
  } catch {
    return {
      insights: ['Analyse non disponible pour cette semaine.'],
      recommendations: ['Contactez votre conseiller PILOTE pour une analyse personnalisee.'],
    }
  }
}

// ─── QuickChart — Graphiques PNG ─────────────────────────────────────────────

async function getChartBuffers(data: ReportData): Promise<{ pieBuffer: Buffer; barBuffer: Buffer }> {
  const famMapC = new Map<string, Famille>()
  for (const f of data.ventes_n1.familles) famMapC.set(f.nom.toUpperCase(), f)
  const famNames = data.ventes_n.familles.map(f => trunc(f.nom, 18))
  const famCA    = data.ventes_n.familles.map(f => +f.total_montant.toFixed(2))
  const famCA1   = data.ventes_n.familles.map(f => +(famMapC.get(f.nom.toUpperCase())?.total_montant ?? 0).toFixed(2))

  const donutPalette = ['#1E40AF','#2563EB','#3B82F6','#60A5FA','#93C5FD','#BFDBFE','#DBEAFE','#EFF6FF','#172554','#1D4ED8']
    .slice(0, famNames.length)

  const pieConfig = {
    type: 'doughnut',
    data: {
      labels: famNames,
      datasets: [{ data: famCA, backgroundColor: donutPalette, borderWidth: 3, borderColor: '#FFFFFF' }],
    },
    options: {
      cutoutPercentage: 55,
      legend: { position: 'right', labels: { fontSize: 11, padding: 14, boxWidth: 14, fontColor: '#1E293B' } },
      title: { display: true, text: "D'ou vient votre CA ?", fontSize: 14, fontColor: '#1E293B', fontStyle: 'bold', padding: 18 },
      plugins: {
        datalabels: {
          display: true,
          formatter: 'function(value,ctx){var d=ctx.chart.data.datasets[0].data;var t=d.reduce(function(a,b){return a+b;},0);var p=value/t*100;return p<5?"":p.toFixed(0)+"%";}',
          color: 'white',
          font: { size: 11, weight: 'bold' },
        },
      },
    },
  }

  const barConfig = {
    type: 'bar',
    data: {
      labels: famNames,
      datasets: [
        { label: `Annee prec. (${data.year - 1})`, data: famCA1, backgroundColor: '#94A3B8', barThickness: 24 },
        { label: `Cette annee (${data.year})`, data: famCA, backgroundColor: '#2563EB', barThickness: 24 },
      ],
    },
    options: {
      title: { display: true, text: [`Comparatif des ventes par rayon`, `Semaine ${data.week_number} · ${data.year} vs ${data.year - 1}`], fontSize: 14, fontColor: '#1E293B', fontStyle: 'bold', padding: 18 },
      legend: { position: 'top', labels: { fontSize: 11, padding: 18, boxWidth: 14, fontColor: '#1E293B' } },
      layout: { padding: { top: 24, bottom: 10, left: 10, right: 10 } },
      scales: {
        xAxes: [{ ticks: { fontSize: 11, fontColor: '#1E293B', fontStyle: 'bold' }, gridLines: { display: false } }],
        yAxes: [{ ticks: { beginAtZero: true, fontSize: 9, fontColor: '#64748B' }, gridLines: { color: '#E8EDF3', drawBorder: false, lineWidth: 0.8 } }],
      },
      plugins: {
        datalabels: {
          display: true, anchor: 'start', align: 'end', offset: 2, clamp: true,
          formatter: "function(v){if(v<100)return '';return v>=1000?(v/1000).toFixed(1)+'k':String(Math.round(v));}",
          font: { size: 8, weight: 'bold' }, color: 'white',
        },
      },
    },
  }

  const QC = 'https://quickchart.io/chart'
  const [pieRes, barRes] = await Promise.all([
    fetch(QC, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chart: pieConfig, width: 720, height: 370, backgroundColor: 'white', version: '2.9.4' }) }),
    fetch(QC, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chart: barConfig, width: 720, height: 470, backgroundColor: 'white', version: '2.9.4' }) }),
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

const ADMIN_EMAIL = 'nouvion.theo51@gmail.com'

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non authentifie' }, { status: 401 })
    if (user.email !== ADMIN_EMAIL) return NextResponse.json({ error: "Acces refuse - reserve a l'administrateur" }, { status: 403 })
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

    // 3. Fetch HR data from planning
    const hr = await fetchPlanningHR(clientId, data.week_number, data.year, data.financier_n.ca_net)

    // 4. Insights (Sonnet enrichi) + Charts in parallel
    const [insightsResult, chartsResult] = await Promise.all([
      generateInsights(data, hr),
      getChartBuffers(data),
    ])

    // 5. Pre-compute derived data
    const famMap = new Map<string, Famille>()
    for (const f of data.ventes_n1.familles) famMap.set(f.nom.toUpperCase(), f)
    const tops  = data.tops
    const flops = data.flops
    const caVar = data.financier_n1.ca_net
      ? (data.financier_n.ca_net - data.financier_n1.ca_net) / data.financier_n1.ca_net
      : 0

    // 6. Get client info
    let clientEmail: string | null = null
    let clientName:  string | null = null
    if (clientId) {
      const { data: client } = await serviceSupabase.from('clients').select('email, name').eq('id', clientId).single()
      if (client) {
        clientEmail = (client as { email: string; name: string }).email
        clientName  = (client as { email: string; name: string }).name
      }
    }

    // 7. Build ComputedReport + generate PDF
    const report: ComputedReport = {
      data, clientName, insights: insightsResult,
      pieBuffer: chartsResult.pieBuffer,
      barBuffer: chartsResult.barBuffer,
      tops, flops, famMap, caVar, hr,
    }
    const pdfBuffer = await generatePDF(report)

    // 8. Upload to Supabase storage
    const sanitized = (clientName || 'Rapport').replace(/[^a-zA-Z0-9\s-]/g, '').trim()
    const fileName = `Semaine ${data.week_number} ${data.year} - ${sanitized}.pdf`
    const { error: uploadError } = await serviceSupabase.storage.from('reports').upload(
      fileName, pdfBuffer, { contentType: 'application/pdf', upsert: true },
    )
    if (uploadError) return NextResponse.json({ error: 'Upload: ' + uploadError.message }, { status: 500 })

    const { data: urlData } = serviceSupabase.storage.from('reports').getPublicUrl(fileName)
    const fileUrl = urlData.publicUrl

    // 9. Save to DB
    const title = `Analyse S${data.week_number} - ${data.period_n}${clientName ? ' - ' + clientName : ''}`
    const { error: dbError } = await serviceSupabase.from('reports').insert({
      profile_id: profile.id, title,
      week_number: data.week_number, year: data.year,
      file_url: fileUrl,
      ...(clientId ? { client_id: clientId } : {}),
    })
    if (dbError) return NextResponse.json({ error: 'DB: ' + dbError.message }, { status: 500 })

    // 10. Email
    const toEmail = clientEmail || (profile as { delivery_email?: string }).delivery_email || user.email || ''
    const resend = new Resend(process.env.RESEND_API_KEY ?? '')
    await resend.emails.send({
      from: 'PILOTE <onboarding@resend.dev>',
      to: toEmail,
      subject: `Rapport hebdomadaire ${title}`,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#1E3A5F;padding:32px 40px">
          <div style="color:#FF8C00;font-size:11px;letter-spacing:4px;margin-bottom:10px">PILOTE</div>
          <h2 style="color:#FFFFFF;margin:0;font-size:22px">Votre rapport est pret</h2>
        </div>
        <div style="padding:32px 40px;border:1px solid #E0E0E0;border-top:none">
          <p style="color:#444;margin-top:0"><strong>${title}</strong></p>
          <p style="color:#666;font-size:14px">${hr.has_data ? '7' : '6'} pages · Analyse IA · Graphiques de repartition · Top &amp; Flop produits${hr.has_data ? ' · Masse salariale CCN 992' : ''}</p>
          <div style="margin:28px 0;text-align:center">
            <a href="${fileUrl}"
               style="background:#1E3A5F;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px">
              Telecharger le rapport PDF
            </a>
          </div>
          <p style="color:#999;font-size:11px;text-align:center">Rapport confidentiel · Genere automatiquement par PILOTE</p>
        </div>
      </div>`,
    })

    return NextResponse.json({ success: true, title, file_url: fileUrl, hr_included: hr.has_data })

  } catch (err: unknown) {
    console.error(err)
    const _e = err instanceof Error ? err : new Error(String(err))
    return NextResponse.json({
      error: _e.message + ' || STACK: ' + (_e.stack || '').replace(/\n/g, ' > ').slice(0, 600),
    }, { status: 500 })
  }
}
