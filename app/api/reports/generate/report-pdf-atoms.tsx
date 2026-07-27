// Briques de mise en page réutilisées par les 8 pages du rapport.
import React from 'react'
import { Text, View } from '@react-pdf/renderer'
import { C, S } from './report-theme'

// ─── PDF Sub-components ─────────────────────────────────────────────

export const SecHeader = ({ num, title }: { num: string; title: string }) => (
  <View style={S.secHeader}>
    <Text style={S.secHeaderNum}>{num}</Text>
    <Text style={S.secHeaderText}>{title}</Text>
  </View>
)

// Le numéro de page est rendu par react-pdf, pas codé en dur : le document peut
// déborder sur une 9e page (5 insights longs + alertes) et le pied affichait alors
// « Page 7 / 8 » deux fois de suite, sur un document annoncé à 8 pages.
export const Footer = ({ week, year }: { week: number; year: number }) => (
  <View style={S.footer} fixed>
    <Text style={S.footerText}>PILOTE - Rapport S{week}/{year} - Document confidentiel</Text>
    <Text
      style={S.footerText}
      render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`}
    />
  </View>
)

export const KpiBox = ({ label, value, sub, bg, subColor }: { label: string; value: string; sub?: string; bg: string; subColor?: string }) => (
  <View style={[S.kpiBox, { backgroundColor: bg }]}>
    <Text style={[S.kpiLabel, { color: `${C.white}99` }]}>{label}</Text>
    <Text style={S.kpiValue}>{value}</Text>
    {sub && <Text style={[S.kpiSub, { color: subColor ?? `${C.white}BB` }]}>{sub}</Text>}
  </View>
)

export const ShareBar = ({ pct }: { pct: number }) => (
  <View style={S.shareBarBg}>
    <View style={[S.shareBarFill, { width: `${Math.min(100, Math.max(0, pct * 100)).toFixed(1)}%` }]} />
  </View>
)
