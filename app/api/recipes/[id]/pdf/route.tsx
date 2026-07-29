// Fiche recette ATELIER en PDF — pour le classeur de fabrication des employés.
//
// AUCUNE donnée financière n'y figure : ni coût, ni prix de vente, ni marge,
// ni coefficient, ni taux horaire. Uniquement ce qu'il faut pour FABRIQUER :
// ingrédients (net / brut / perte), étapes chronométrées, temps total, paliers
// de quantité (« pour 20 : ×1,8 »), qui fabrique, notes.
//
// Même mécanique que le rapport hebdo : polices Plus Jakarta Sans mises en
// cache (report-fonts), ensureFonts() AVANT renderToBuffer, polyfill DOMMatrix.
if (typeof globalThis.DOMMatrix === 'undefined') {
  ;(globalThis as Record<string, unknown>).DOMMatrix = class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
  }
}

import { NextRequest, NextResponse } from 'next/server'
import React from 'react'
import { renderToBuffer, Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { ensureFonts, FONT_FAMILY } from '@/app/api/reports/generate/report-fonts'
import {
  costIngredients, parseStoredSteps, parseStoredTiers, recipeTotalMinutes,
  type GenericInfo, type IngredientRow,
} from '@/lib/recipes'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const NAVY = '#1E3A5F'
const NAVY_50 = '#f2f5f9'
const NAVY_100 = '#e4eaf1'
const GRAY = '#6b7280'
const GRAY_LIGHT = '#9ca3af'

const s = StyleSheet.create({
  page: { backgroundColor: '#ffffff', paddingTop: 34, paddingBottom: 40, paddingHorizontal: 36, fontFamily: FONT_FAMILY, fontSize: 9, color: '#111827' },
  band: { position: 'absolute', top: 0, left: 0, right: 0, height: 6, backgroundColor: NAVY },
  kicker: { fontSize: 8, fontWeight: 700, color: GRAY_LIGHT, letterSpacing: 1.6, textTransform: 'uppercase' },
  title: { fontSize: 20, fontWeight: 800, color: NAVY, marginTop: 2 },
  chip: { fontSize: 7.5, fontWeight: 700, color: NAVY, backgroundColor: NAVY_50, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2.5, textTransform: 'uppercase', letterSpacing: 0.8 },
  metaRow: { flexDirection: 'row', gap: 14, marginTop: 8, marginBottom: 14 },
  metaBox: { backgroundColor: NAVY_50, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, flexGrow: 1 },
  metaLabel: { fontSize: 6.5, fontWeight: 700, color: GRAY_LIGHT, textTransform: 'uppercase', letterSpacing: 1 },
  metaValue: { fontSize: 11, fontWeight: 800, color: NAVY, marginTop: 1.5 },
  h2: { fontSize: 8, fontWeight: 700, color: GRAY_LIGHT, textTransform: 'uppercase', letterSpacing: 1.4, marginBottom: 5 },
  cols: { flexDirection: 'row', gap: 16 },
  colIng: { width: '54%' },
  colSteps: { width: '46%' },
  th: { flexDirection: 'row', backgroundColor: NAVY, borderTopLeftRadius: 6, borderTopRightRadius: 6, paddingVertical: 4.5, paddingHorizontal: 8 },
  thText: { fontSize: 7, fontWeight: 700, color: '#ffffff', textTransform: 'uppercase', letterSpacing: 0.6 },
  tr: { flexDirection: 'row', borderBottomWidth: 0.75, borderBottomColor: NAVY_100, paddingVertical: 4.5, paddingHorizontal: 8 },
  trAlt: { backgroundColor: '#fafbfc' },
  cellName: { width: '46%', fontSize: 9, fontWeight: 600 },
  cellQty: { width: '18%', fontSize: 9, textAlign: 'right', fontWeight: 700 },
  cellBrut: { width: '20%', fontSize: 9, textAlign: 'right' },
  cellLoss: { width: '16%', fontSize: 8.5, textAlign: 'right', color: GRAY },
  tag: { fontSize: 6, fontWeight: 700, color: '#1d4ed8', backgroundColor: '#eff6ff', borderRadius: 3, paddingHorizontal: 3, paddingVertical: 1, marginLeft: 4 },
  step: { flexDirection: 'row', gap: 7, marginBottom: 6 },
  stepNum: { width: 15, height: 15, borderRadius: 8, backgroundColor: NAVY_50, color: NAVY, fontSize: 8.5, fontWeight: 800, textAlign: 'center', paddingTop: 2.5 },
  stepText: { flex: 1, fontSize: 9, lineHeight: 1.45 },
  stepMin: { fontSize: 8.5, fontWeight: 700, color: NAVY, minWidth: 34, textAlign: 'right' },
  totalBar: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: NAVY, borderRadius: 6, paddingVertical: 5.5, paddingHorizontal: 9, marginTop: 4 },
  totalLabel: { fontSize: 7.5, fontWeight: 700, color: '#ffffffaa', textTransform: 'uppercase', letterSpacing: 0.8 },
  totalValue: { fontSize: 10, fontWeight: 800, color: '#ffffff' },
  tiersRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 5 },
  tierBox: { borderWidth: 1, borderColor: NAVY_100, borderRadius: 8, paddingVertical: 5.5, paddingHorizontal: 10, alignItems: 'center' },
  tierBoxBase: { backgroundColor: NAVY_50, borderColor: NAVY_50 },
  tierQty: { fontSize: 9.5, fontWeight: 800, color: NAVY },
  tierTime: { fontSize: 8.5, color: '#374151', marginTop: 1 },
  tierMult: { fontSize: 7, color: GRAY_LIGHT, marginTop: 0.5 },
  notes: { marginTop: 12, backgroundColor: NAVY_50, borderRadius: 8, padding: 9 },
  notesText: { fontSize: 8.5, lineHeight: 1.5, color: '#374151' },
  footer: { position: 'absolute', bottom: 16, left: 36, right: 36, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 0.75, borderTopColor: NAVY_100, paddingTop: 6 },
  footerText: { fontSize: 7, color: GRAY_LIGHT },
})

const fmtQty = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 3 })
const unitFr = (u: string | null) => (u === 'piece' ? 'pièce' : u || '')
function fmtMin(m: number): string {
  const r = Math.round(m)
  if (r < 60) return `${(Math.round(m * 10) / 10).toLocaleString('fr-FR')} min`
  return `${Math.floor(r / 60)} h ${String(r % 60).padStart(2, '0')}`
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    const service = createServiceClient()
    const clientId = await resolveClientId(service, user.id, user.email)
    if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

    const [{ data: recipe }, { data: ings }, { data: generics }, { data: clientRow }] = await Promise.all([
      service.from('recipes').select('*').eq('id', params.id).eq('client_id', clientId).maybeSingle(),
      service.from('recipe_ingredients').select('*').eq('client_id', clientId).eq('recipe_id', params.id).order('position'),
      service.from('generic_articles').select('id, name, base_unit, category, default_loss_pct').eq('client_id', clientId),
      service.from('clients').select('name').eq('id', clientId).maybeSingle(),
    ])
    if (!recipe) return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 })

    // Quantités et catégories SANS AUCUN PRIX : la carte des génériques est
    // construite avec price_ht null — costIngredients ne sert ici qu'aux
    // conversions (g→kg) et aux quantités brutes (perte comprise).
    const genericById = new Map<string, GenericInfo>((generics || []).map((g: Record<string, unknown>) => [String(g.id), {
      id: String(g.id), name: String(g.name ?? ''),
      base_unit: g.base_unit === 'piece' ? 'piece' as const : 'kg' as const,
      category: g.category === 'emballage' ? 'emballage' as const : 'ingredient' as const,
      default_loss_pct: Number(g.default_loss_pct) || 0,
      price_ht: null,
    }]))
    const costed = costIngredients((ings || []) as IngredientRow[], new Map(), genericById)
    const steps = parseStoredSteps(recipe.fabrication_steps)
    const tiers = parseStoredTiers(recipe.time_tiers)
    const totalMin = recipeTotalMinutes(recipe)
    const baseQty = Number(recipe.yield_qty) || 0
    const unite = String(recipe.yield_unit || 'unités')

    let employeeName: string | null = null
    if (recipe.employee_id) {
      const { data: emp } = await service.from('employees').select('name').eq('id', recipe.employee_id).eq('client_id', clientId).maybeSingle()
      employeeName = emp?.name ?? null
    }

    const datePrint = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    const doc = (
      <Document title={`Fiche recette — ${recipe.name}`}>
        <Page size="A4" style={s.page}>
          <View style={s.band} fixed />

          {/* En-tête */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flexShrink: 1, paddingRight: 10 }}>
              <Text style={s.kicker}>Fiche recette · atelier</Text>
              <Text style={s.title}>{String(recipe.name)}</Text>
            </View>
            {recipe.category ? <Text style={s.chip}>{String(recipe.category)}</Text> : null}
          </View>

          {/* Repères de fabrication */}
          <View style={s.metaRow}>
            <View style={s.metaBox}>
              <Text style={s.metaLabel}>Base du batch</Text>
              <Text style={s.metaValue}>{baseQty > 0 ? `${fmtQty(baseQty)} ${unite}` : '—'}</Text>
            </View>
            <View style={s.metaBox}>
              <Text style={s.metaLabel}>Temps total</Text>
              <Text style={s.metaValue}>{totalMin > 0 ? fmtMin(totalMin) : '—'}</Text>
            </View>
            <View style={s.metaBox}>
              <Text style={s.metaLabel}>Fabriqué par</Text>
              <Text style={s.metaValue}>{employeeName ?? 'Équipe'}</Text>
            </View>
          </View>

          {/* Double tableau : ingrédients à gauche, étapes à droite */}
          <View style={s.cols}>
            <View style={s.colIng}>
              <Text style={s.h2}>Ingrédients{baseQty > 0 ? ` — pour ${fmtQty(baseQty)} ${unite}` : ''}</Text>
              <View style={s.th}>
                <Text style={[s.thText, { width: '46%' }]}>Ingrédient</Text>
                <Text style={[s.thText, { width: '18%', textAlign: 'right' }]}>Net</Text>
                <Text style={[s.thText, { width: '20%', textAlign: 'right' }]}>À sortir</Text>
                <Text style={[s.thText, { width: '16%', textAlign: 'right' }]}>Perte</Text>
              </View>
              {costed.map((ing, i) => {
                const loss = Number(ing.loss_pct) || 0
                const u = ing.generic_id ? (ing.qty_unit === 'piece' ? 'pièce' : ing.qty_unit || '') : (ing.unit || '')
                const uBrut = ing.generic_id ? unitFr(ing.qty_unit === 'g' ? 'kg' : ing.qty_unit) : u
                return (
                  <View key={i} style={i % 2 === 1 ? [s.tr, s.trAlt] : s.tr} wrap={false}>
                    <View style={[s.cellName, { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }]}>
                      <Text>{ing.label}</Text>
                      {ing.categorie === 'emballage' ? <Text style={s.tag}>EMBALLAGE</Text> : null}
                    </View>
                    <Text style={s.cellQty}>{fmtQty(Number(ing.quantity) || 0)} {u}</Text>
                    <Text style={s.cellBrut}>{loss > 0 ? `${fmtQty(ing.qty_brute)} ${uBrut}` : '—'}</Text>
                    <Text style={s.cellLoss}>{loss > 0 ? `${loss.toLocaleString('fr-FR')} %` : '—'}</Text>
                  </View>
                )
              })}
              {costed.length === 0 ? <Text style={{ fontSize: 8.5, color: GRAY_LIGHT, marginTop: 6 }}>Aucun ingrédient renseigné.</Text> : null}
            </View>

            <View style={s.colSteps}>
              <Text style={s.h2}>Étapes de fabrication</Text>
              {steps.length === 0 ? (
                <Text style={{ fontSize: 8.5, color: GRAY_LIGHT }}>Procédé non renseigné — à compléter sur la fiche.</Text>
              ) : steps.map((st, i) => (
                <View key={i} style={s.step} wrap={false}>
                  <Text style={s.stepNum}>{i + 1}</Text>
                  <Text style={s.stepText}>{st.text}</Text>
                  <Text style={s.stepMin}>{st.minutes !== null ? `${st.minutes.toLocaleString('fr-FR')} min` : ''}</Text>
                </View>
              ))}
              {totalMin > 0 ? (
                <View style={s.totalBar}>
                  <Text style={s.totalLabel}>Temps total</Text>
                  <Text style={s.totalValue}>{fmtMin(totalMin)}</Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* Paliers de quantité */}
          {tiers.length > 0 && baseQty > 0 ? (
            <View style={{ marginTop: 14 }}>
              <Text style={s.h2}>Quantités produites — temps correspondant</Text>
              <View style={s.tiersRow}>
                <View style={[s.tierBox, s.tierBoxBase]}>
                  <Text style={s.tierQty}>{fmtQty(baseQty)} {unite}</Text>
                  <Text style={s.tierTime}>{fmtMin(totalMin)}</Text>
                  <Text style={s.tierMult}>base</Text>
                </View>
                {tiers.map((t, i) => (
                  <View key={i} style={s.tierBox}>
                    <Text style={s.tierQty}>{fmtQty(t.qty)} {unite}</Text>
                    <Text style={s.tierTime}>{fmtMin(totalMin * t.mult)}</Text>
                    <Text style={s.tierMult}>{`×${t.mult.toLocaleString('fr-FR')}`}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* Notes */}
          {recipe.notes ? (
            <View style={s.notes}>
              <Text style={[s.h2, { marginBottom: 3 }]}>Notes</Text>
              <Text style={s.notesText}>{String(recipe.notes)}</Text>
            </View>
          ) : null}

          <View style={s.footer} fixed>
            <Text style={s.footerText}>{clientRow?.name ? `${clientRow.name} · ` : ''}Fiche atelier — sans données financières</Text>
            <Text style={s.footerText}>Imprimée le {datePrint} · PILOTE</Text>
          </View>
        </Page>
      </Document>
    )

    await ensureFonts()
    // Même contournement de typage que reports/generate et valorisations/pdf.
    const buffer = await renderToBuffer(doc as React.ReactElement<never>)
    const slug = String(recipe.name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'recette'
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="fiche-${slug}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    console.error('[fiche pdf]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Génération du PDF impossible — réessayez.' }, { status: 500 })
  }
}
