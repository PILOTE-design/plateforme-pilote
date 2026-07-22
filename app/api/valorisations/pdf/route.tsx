import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import React from 'react'

export const runtime = 'nodejs'
export const maxDuration = 30

// Fiche de valorisation DÉTAILLÉE (chaque pièce saisie, groupée par catégorie).
// Données calculées envoyées par le client ; rendu aux couleurs PILOTE.

const NAVY = '#1E3A5F'
const NAVY_800 = '#162c49'
const ORANGE = '#FF8C00'
const GREY = '#6b7280'
const GREY_LIGHT = '#9ca3af'
const CARD_BG = '#f2f5f9'
const BORDER = '#e4eaf1'

const CATEGORY_LABELS: Record<string, string> = {
  premier: '1er choix', deuxieme: '2e choix', troisieme: 'Divers', abat: 'Abats', os: 'Os valorisables',
}
const CATEGORY_ORDER = ['premier', 'deuxieme', 'troisieme', 'abat', 'os']

const S = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 46, paddingHorizontal: 40, fontSize: 9.5, color: '#1f2937', fontFamily: 'Helvetica' },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  brand: { fontSize: 21, fontFamily: 'Helvetica-Bold', color: NAVY, letterSpacing: 1 },
  brandSub: { fontSize: 9.5, color: GREY, marginTop: 2 },
  genDate: { fontSize: 8, color: GREY_LIGHT, textAlign: 'right' },
  rule: { height: 2, backgroundColor: ORANGE, marginTop: 9, marginBottom: 16, borderRadius: 1 },

  beteName: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: NAVY_800 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 7 },
  metaItem: { marginRight: 20, marginBottom: 4 },
  metaLabel: { fontSize: 7, color: GREY_LIGHT, textTransform: 'uppercase', letterSpacing: 0.5 },
  metaValue: { fontSize: 10, color: '#111827', fontFamily: 'Helvetica-Bold', marginTop: 1 },

  kpiRow: { flexDirection: 'row', marginTop: 14, marginHorizontal: -4 },
  kpi: { flex: 1, marginHorizontal: 4, backgroundColor: CARD_BG, borderRadius: 6, padding: 9 },
  kpiHi: { flex: 1, marginHorizontal: 4, backgroundColor: NAVY, borderRadius: 6, padding: 9 },
  kpiLabel: { fontSize: 7, color: GREY, textTransform: 'uppercase', letterSpacing: 0.4 },
  kpiLabelHi: { fontSize: 7, color: '#c5d2e2', textTransform: 'uppercase', letterSpacing: 0.4 },
  kpiValue: { fontSize: 13.5, fontFamily: 'Helvetica-Bold', color: NAVY_800, marginTop: 3 },
  kpiValueHi: { fontSize: 13.5, fontFamily: 'Helvetica-Bold', color: '#ffffff', marginTop: 3 },

  lotLine: { marginTop: 10, fontSize: 9, color: GREY, backgroundColor: '#f9fafb', borderRadius: 6, padding: 8 },
  lotStrong: { color: NAVY_800, fontFamily: 'Helvetica-Bold' },

  sectionTitle: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: NAVY_800, marginTop: 18, marginBottom: 6 },
  catHeader: { flexDirection: 'row', backgroundColor: '#eef2f7', borderRadius: 4, paddingVertical: 4, paddingHorizontal: 6, marginTop: 8 },
  catHeaderText: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: NAVY, flex: 1 },
  catHeaderTot: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: NAVY },

  thRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER, paddingBottom: 3, paddingHorizontal: 6, marginTop: 4 },
  th: { fontSize: 7, color: GREY_LIGHT, textTransform: 'uppercase', letterSpacing: 0.4 },
  row: { flexDirection: 'row', paddingVertical: 3, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: '#f1f5f9' },
  cName: { flex: 1, fontSize: 9, color: '#1f2937' },
  cNum: { width: 70, fontSize: 9, color: '#374151', textAlign: 'right' },
  cNumStrong: { width: 80, fontSize: 9, fontFamily: 'Helvetica-Bold', color: NAVY_800, textAlign: 'right' },

  totalRow: { flexDirection: 'row', marginTop: 8, borderTopWidth: 1.5, borderTopColor: NAVY, paddingTop: 6, paddingHorizontal: 6 },
  totalLabel: { flex: 1, fontSize: 10, fontFamily: 'Helvetica-Bold', color: NAVY_800 },
  totalVal: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: NAVY_800 },

  footer: { position: 'absolute', bottom: 24, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 7 },
  footerText: { fontSize: 7.5, color: GREY_LIGHT },
})

function eur(n: number) {
  return (Number(n) || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
}
function kg(n: number) {
  return `${(Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} kg`
}

type Piece = { name: string; category?: string; weight: number; price: number; revenue: number }
type Payload = {
  animalLabel?: string
  breedName?: string
  purchaseDate?: string
  lotNumber?: string | null
  quantity?: number
  isHalf?: boolean
  carcassWeight?: number
  purchasePerKg?: number
  costPerBete?: number
  revenuePerBete?: number
  marginPct?: number
  coefficient?: number
  notes?: string | null
  pieces?: Piece[]
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

function ValoDoc({ p }: { p: Payload }) {
  const costB = Number(p.costPerBete) || 0
  const revB = Number(p.revenuePerBete) || 0
  const margeB = revB - costB
  const qty = Number(p.quantity) || 1
  const unit = p.isHalf ? 'demi' : 'animal'
  const qtyLabel = qty > 1 ? `${qty} ${p.isHalf ? 'demis' : 'animaux'}` : `1 ${unit}`
  const dateStr = p.purchaseDate ? new Date(p.purchaseDate).toLocaleDateString('fr-FR') : '—'
  const genStr = p.generatedAt ? new Date(p.generatedAt).toLocaleDateString('fr-FR') : ''

  const pieces = (p.pieces || []).filter(pc => (Number(pc.weight) || 0) > 0 || (Number(pc.revenue) || 0) > 0)
  // Regroupement par catégorie, dans l'ordre métier
  const byCat = new Map<string, Piece[]>()
  for (const pc of pieces) {
    const c = pc.category && CATEGORY_LABELS[pc.category] ? pc.category : 'troisieme'
    if (!byCat.has(c)) byCat.set(c, [])
    byCat.get(c)!.push(pc)
  }
  const cats = CATEGORY_ORDER.filter(c => byCat.has(c))
  const grandWeight = pieces.reduce((s, pc) => s + (Number(pc.weight) || 0), 0)
  const grandRev = pieces.reduce((s, pc) => s + (Number(pc.revenue) || 0), 0)

  return (
    <Document>
      <Page size="A4" style={S.page}>
        <View style={S.headRow}>
          <View>
            <Text style={S.brand}>PILOTE</Text>
            <Text style={S.brandSub}>Fiche de valorisation détaillée</Text>
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
          {p.carcassWeight ? <Meta label={`Carcasse / ${unit}`} value={`${p.carcassWeight} kg`} /> : null}
          {p.purchasePerKg ? <Meta label="Achat" value={`${p.purchasePerKg} €/kg`} /> : null}
        </View>

        <View style={S.kpiRow}>
          <View style={S.kpi}><Text style={S.kpiLabel}>Coût / {unit}</Text><Text style={S.kpiValue}>{eur(costB)}</Text></View>
          <View style={S.kpiHi}><Text style={S.kpiLabelHi}>CA estimé / {unit}</Text><Text style={S.kpiValueHi}>{eur(revB)}</Text></View>
          <View style={S.kpi}><Text style={S.kpiLabel}>Marge brute</Text><Text style={S.kpiValue}>{eur(margeB)}</Text></View>
          <View style={S.kpi}><Text style={S.kpiLabel}>Taux marge</Text><Text style={S.kpiValue}>{(Number(p.marginPct) || 0).toFixed(1)} %</Text></View>
          <View style={S.kpi}><Text style={S.kpiLabel}>Coefficient</Text><Text style={S.kpiValue}>x{(Number(p.coefficient) || 1).toFixed(3)}</Text></View>
        </View>

        {qty > 1 && (
          <Text style={S.lotLine}>
            Lot de <Text style={S.lotStrong}>{qtyLabel}</Text> — coût total <Text style={S.lotStrong}>{eur(costB * qty)}</Text>, CA estimé total <Text style={S.lotStrong}>{eur(revB * qty)}</Text>, marge <Text style={S.lotStrong}>{eur(margeB * qty)}</Text>.
          </Text>
        )}

        <Text style={S.sectionTitle}>Détail par pièce ({p.isHalf ? 'par demi' : 'par animal'})</Text>

        {pieces.length === 0 ? (
          <Text style={{ fontSize: 9, color: GREY_LIGHT, marginTop: 6 }}>Aucune pièce saisie.</Text>
        ) : (
          cats.map(c => {
            const list = byCat.get(c)!.slice().sort((a, b) => (Number(b.revenue) || 0) - (Number(a.revenue) || 0))
            const catRev = list.reduce((s, pc) => s + (Number(pc.revenue) || 0), 0)
            return (
              <View key={c} wrap={false}>
                <View style={S.catHeader}>
                  <Text style={S.catHeaderText}>{CATEGORY_LABELS[c]}</Text>
                  <Text style={S.catHeaderTot}>{eur(catRev)}</Text>
                </View>
                <View style={S.thRow}>
                  <Text style={[S.th, { flex: 1 }]}>Pièce</Text>
                  <Text style={[S.th, { width: 70, textAlign: 'right' }]}>Poids</Text>
                  <Text style={[S.th, { width: 70, textAlign: 'right' }]}>Prix €/kg</Text>
                  <Text style={[S.th, { width: 80, textAlign: 'right' }]}>CA estimé</Text>
                </View>
                {list.map((pc, i) => (
                  <View key={i} style={S.row}>
                    <Text style={S.cName}>{pc.name}</Text>
                    <Text style={S.cNum}>{kg(pc.weight)}</Text>
                    <Text style={S.cNum}>{eur(pc.price)}</Text>
                    <Text style={S.cNumStrong}>{eur(pc.revenue)}</Text>
                  </View>
                ))}
              </View>
            )
          })
        )}

        {pieces.length > 0 && (
          <View style={S.totalRow}>
            <Text style={S.totalLabel}>Total {p.isHalf ? '/ demi' : '/ animal'}</Text>
            <Text style={[S.cNum, { width: 70 }]}>{kg(grandWeight)}</Text>
            <Text style={[S.cNum, { width: 70 }]}> </Text>
            <Text style={[S.totalVal, { width: 80, textAlign: 'right' }]}>{eur(grandRev)}</Text>
          </View>
        )}

        {p.notes ? (
          <View style={{ marginTop: 14, backgroundColor: CARD_BG, borderRadius: 6, padding: 10 }}>
            <Text style={{ fontSize: 7, color: NAVY_800, textTransform: 'uppercase', letterSpacing: 0.5, fontFamily: 'Helvetica-Bold' }}>Notes</Text>
            <Text style={{ fontSize: 9, color: '#374151', marginTop: 3, lineHeight: 1.4 }}>{p.notes}</Text>
          </View>
        ) : null}

        <View style={S.footer} fixed>
          <Text style={S.footerText}>Prix indicatifs, hors taxes — outil d'aide à la décision.</Text>
          <Text style={S.footerText} render={({ pageNumber, totalPages }) => `PILOTE · ${pageNumber}/${totalPages}`} />
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
