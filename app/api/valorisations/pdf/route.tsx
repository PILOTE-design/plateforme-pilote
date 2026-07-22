import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import React from 'react'

export const runtime = 'nodejs'
export const maxDuration = 30

// Fiche de valorisation synthétique (1 page). Données calculées envoyées par le client ;
// aucune donnée sensible côté serveur, juste un rendu PDF aux couleurs PILOTE.

const NAVY = '#1E3A5F'
const NAVY_800 = '#162c49'
const ORANGE = '#FF8C00'
const GREY = '#6b7280'
const GREY_LIGHT = '#9ca3af'
const CARD_BG = '#f2f5f9'

const S = StyleSheet.create({
  page: { paddingTop: 44, paddingBottom: 48, paddingHorizontal: 44, fontSize: 10, color: '#1f2937', fontFamily: 'Helvetica' },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  brand: { fontSize: 22, fontFamily: 'Helvetica-Bold', color: NAVY, letterSpacing: 1 },
  brandSub: { fontSize: 10, color: GREY, marginTop: 2 },
  genDate: { fontSize: 8, color: GREY_LIGHT, textAlign: 'right' },
  rule: { height: 2, backgroundColor: ORANGE, marginTop: 10, marginBottom: 22, borderRadius: 1 },

  beteName: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: NAVY_800 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  metaItem: { marginRight: 22, marginBottom: 4 },
  metaLabel: { fontSize: 7.5, color: GREY_LIGHT, textTransform: 'uppercase', letterSpacing: 0.5 },
  metaValue: { fontSize: 10.5, color: '#111827', fontFamily: 'Helvetica-Bold', marginTop: 1 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 26, marginHorizontal: -5 },
  card: { width: '33.333%', paddingHorizontal: 5, marginBottom: 10 },
  cardInner: { backgroundColor: CARD_BG, borderRadius: 8, padding: 12, height: 62, justifyContent: 'center' },
  cardInnerHi: { backgroundColor: NAVY, borderRadius: 8, padding: 12, height: 62, justifyContent: 'center' },
  cardLabel: { fontSize: 7.5, color: GREY, textTransform: 'uppercase', letterSpacing: 0.5 },
  cardLabelHi: { fontSize: 7.5, color: '#c5d2e2', textTransform: 'uppercase', letterSpacing: 0.5 },
  cardValue: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: NAVY_800, marginTop: 3 },
  cardValueHi: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: '#ffffff', marginTop: 3 },
  cardSub: { fontSize: 7.5, color: GREY_LIGHT, marginTop: 2 },
  cardSubHi: { fontSize: 7.5, color: '#c5d2e2', marginTop: 2 },

  notesBox: { marginTop: 18, backgroundColor: '#f2f5f9', borderRadius: 8, padding: 12 },
  notesLabel: { fontSize: 7.5, color: NAVY_800, textTransform: 'uppercase', letterSpacing: 0.5, fontFamily: 'Helvetica-Bold' },
  notesText: { fontSize: 10, color: '#374151', marginTop: 3, lineHeight: 1.4 },

  footer: { position: 'absolute', bottom: 26, left: 44, right: 44, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#e4eaf1', paddingTop: 8 },
  footerText: { fontSize: 7.5, color: GREY_LIGHT },
})

function eur(n: number) {
  return (Number(n) || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
}

type Payload = {
  animalLabel?: string
  breedName?: string
  purchaseDate?: string
  lotNumber?: string | null
  quantity?: number
  isHalf?: boolean
  carcassWeight?: number
  purchasePerKg?: number
  sellableWeight?: number
  totalCost?: number
  totalRevenue?: number
  marginPct?: number
  coefficient?: number
  notes?: string | null
  generatedAt?: string
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={S.metaItem}>
      <Text style={S.metaLabel}>{label}</Text>
      <Text style={S.metaValue}>{value}</Text>
    </View>
  )
}

function Kpi({ label, value, sub, hi }: { label: string; value: string; sub?: string; hi?: boolean }) {
  return (
    <View style={S.card}>
      <View style={hi ? S.cardInnerHi : S.cardInner}>
        <Text style={hi ? S.cardLabelHi : S.cardLabel}>{label}</Text>
        <Text style={hi ? S.cardValueHi : S.cardValue}>{value}</Text>
        {sub ? <Text style={hi ? S.cardSubHi : S.cardSub}>{sub}</Text> : null}
      </View>
    </View>
  )
}

function ValoDoc({ p }: { p: Payload }) {
  const cost = Number(p.totalCost) || 0
  const rev = Number(p.totalRevenue) || 0
  const marge = rev - cost
  const qty = Number(p.quantity) || 1
  const qtyLabel = qty > 1
    ? `${qty} ${p.isHalf ? 'demis' : 'animaux'}`
    : (p.isHalf ? '1 demi' : '1 animal')
  const dateStr = p.purchaseDate
    ? new Date(p.purchaseDate).toLocaleDateString('fr-FR')
    : '—'
  const genStr = p.generatedAt
    ? new Date(p.generatedAt).toLocaleDateString('fr-FR')
    : ''

  return (
    <Document>
      <Page size="A4" style={S.page}>
        <View style={S.headRow}>
          <View>
            <Text style={S.brand}>PILOTE</Text>
            <Text style={S.brandSub}>Fiche de valorisation</Text>
          </View>
          {genStr ? <Text style={S.genDate}>Généré le {genStr}</Text> : null}
        </View>
        <View style={S.rule} />

        <Text style={S.beteName}>{p.breedName || p.animalLabel || 'Valorisation'}</Text>
        <View style={S.metaRow}>
          {p.animalLabel ? <Meta label="Espèce" value={p.animalLabel} /> : null}
          <Meta label="Date d'achat" value={dateStr} />
          {p.lotNumber ? <Meta label="N° de lot" value={String(p.lotNumber)} /> : null}
          <Meta label="Quantité" value={qtyLabel} />
          {p.carcassWeight ? <Meta label="Carcasse / animal" value={`${p.carcassWeight} kg`} /> : null}
          {p.purchasePerKg ? <Meta label="Achat" value={`${p.purchasePerKg} €/kg`} /> : null}
        </View>

        <View style={S.grid}>
          <Kpi label="Coût total" value={eur(cost)} sub="achat + charges + main d'œuvre" />
          <Kpi label="CA estimé" value={eur(rev)} sub={p.coefficient ? `coeff. x${Number(p.coefficient).toFixed(3)}` : undefined} hi />
          <Kpi label="Marge brute" value={eur(marge)} sub={`${(Number(p.marginPct) || 0).toFixed(1)} % de marge`} />
          <Kpi label="Taux de marge" value={`${(Number(p.marginPct) || 0).toFixed(1)} %`} />
          <Kpi label="Coefficient" value={`x${(Number(p.coefficient) || 1).toFixed(3)}`} />
          {p.sellableWeight
            ? <Kpi label="Poids vendable" value={`${Number(p.sellableWeight).toFixed(1)} kg`} />
            : <Kpi label="Carcasse / animal" value={p.carcassWeight ? `${p.carcassWeight} kg` : '—'} />}
        </View>

        {p.notes ? (
          <View style={S.notesBox}>
            <Text style={S.notesLabel}>Notes</Text>
            <Text style={S.notesText}>{p.notes}</Text>
          </View>
        ) : null}

        <View style={S.footer} fixed>
          <Text style={S.footerText}>Prix indicatifs, hors taxes — outil d'aide à la décision.</Text>
          <Text style={S.footerText}>Généré par PILOTE</Text>
        </View>
      </Page>
    </Document>
  )
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  let p: Payload
  try { p = await req.json() } catch { return NextResponse.json({ error: 'Requête invalide' }, { status: 400 }) }

  const buffer = await renderToBuffer(React.createElement(ValoDoc, { p }))
  const name = `valorisation-${(p.breedName || 'lot').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.pdf`

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  })
}
