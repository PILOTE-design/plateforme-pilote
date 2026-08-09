// app/api/articles/[id]/reclamation/route.tsx — LE COURRIER DE RÉCLAMATION,
// EN PDF PRÊT À ENVOYER. Lot 126.
//
// Depuis un écart de prix bloqué (« À traiter », mercuriale), un clic produit
// la lettre : le prix convenu, les factures qui le dépassent, le total, la
// demande d'avoir. C'est la brique qui relie le prix bloqué (lot 43) au geste
// du métier — chez Otami, la chaîne s'appelle Négociations → Litiges.
//
// Tout le calcul vit dans `lib/reclamation` (module pur, testé hors ligne),
// avec LES MÊMES règles que l'écran « À traiter » : factures antérieures au
// verrou jamais comptées, dixième de centime, lignes sans quantité comptées à
// part et ÉCRITES dans le courrier. Le PDF ne calcule rien : il pose.
//
// Même mécanique que la fiche atelier : polyfill DOMMatrix, ensureFonts()
// avant renderToBuffer, Plus Jakarta Sans en cache.

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
import { fetchAllPages } from '@/lib/fetch-all'
import {
  ecartsDeLaRef, corpsCourrier, jourFr, eur, prixFr,
  type LigneFacture, type RefBloquee,
} from '@/lib/reclamation'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const NAVY = '#1E3A5F'
const GRAY = '#6b7280'
const INK = '#111827'
const LINE = '#e5e7eb'

const s = StyleSheet.create({
  page: { fontFamily: FONT_FAMILY, fontSize: 10, color: INK, padding: 48, lineHeight: 1.5 },
  boutique: { fontSize: 13, fontWeight: 700, color: NAVY },
  date: { fontSize: 9, color: GRAY, marginTop: 2 },
  dest: { marginTop: 22, marginLeft: 250 },
  destNom: { fontSize: 11, fontWeight: 700 },
  objet: { marginTop: 26, fontSize: 10.5, fontWeight: 700 },
  para: { marginTop: 10, fontSize: 10, textAlign: 'justify' },
  table: { marginTop: 12, borderWidth: 1, borderColor: LINE, borderRadius: 4 },
  tr: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: LINE, paddingVertical: 4, paddingHorizontal: 8 },
  th: { flexDirection: 'row', backgroundColor: '#f9fafb', paddingVertical: 5, paddingHorizontal: 8 },
  thText: { fontSize: 8, fontWeight: 700, color: GRAY, textTransform: 'uppercase' },
  cell: { fontSize: 9 },
  total: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: NAVY, paddingVertical: 6, paddingHorizontal: 8, backgroundColor: '#f8fafc' },
  reserve: { marginTop: 8, fontSize: 8.5, color: GRAY, fontStyle: 'italic' },
  signature: { marginTop: 28, marginLeft: 250 },
  pied: { position: 'absolute', bottom: 24, left: 48, right: 48, fontSize: 7.5, color: GRAY, textAlign: 'center' },
})

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const { data: article } = await service.from('articles')
    .select('id, name, unit, supplier_name, blocked_price_ht, blocked_at, conversion_factor')
    .eq('id', params.id).eq('client_id', clientId).maybeSingle()
  if (!article) return NextResponse.json({ error: 'Référence introuvable' }, { status: 404 })
  if (article.blocked_price_ht === null || !(Number(article.blocked_price_ht) > 0)) {
    return NextResponse.json({ error: 'Cette référence n’a pas de prix bloqué : rien à réclamer.' }, { status: 400 })
  }

  const { data: boutique } = await service.from('clients')
    .select('name').eq('id', clientId).maybeSingle()

  // Les lignes de facture de CETTE réf — paginées (plafond PostgREST, lot 93),
  // avec le numéro et la date portés par la facture.
  const lignesPage = await fetchAllPages<Record<string, unknown>>(apres => {
    let q = service.from('invoice_lines')
      .select('id, unit_price_ht, quantity, invoices!inner(invoice_number, invoice_date, client_id)')
      .eq('article_id', params.id)
      .eq('invoices.client_id', clientId)
    if (apres) q = q.gt('id', apres)
    return q.order('id', { ascending: true })
  })
  if (lignesPage.erreur || lignesPage.tronque) {
    // Un courrier bâti sur une lecture incomplète réclamerait un total faux —
    // en notre faveur ou en la sienne, les deux sont inacceptables signés.
    return NextResponse.json({ error: 'Lecture incomplète des factures : le courrier n’a pas été produit, pour ne pas réclamer un total faux.' }, { status: 503 })
  }

  const lignes: LigneFacture[] = lignesPage.rows.map(l => {
    const inv = (l as { invoices?: { invoice_number?: unknown; invoice_date?: unknown } }).invoices
    return {
      date: String(inv?.invoice_date ?? ''),
      unit_price_ht: l.unit_price_ht !== null && l.unit_price_ht !== undefined ? Number(l.unit_price_ht) : null,
      quantity: l.quantity !== null && l.quantity !== undefined ? Number(l.quantity) : null,
      invoice_number: inv?.invoice_number ? String(inv.invoice_number) : null,
    }
  })

  const ref: RefBloquee = {
    name: String(article.name),
    unit: article.unit ?? null,
    blocked_price_ht: Number(article.blocked_price_ht),
    blocked_at: article.blocked_at ? String(article.blocked_at) : null,
    conversion_factor: article.conversion_factor !== null && article.conversion_factor !== undefined
      ? Number(article.conversion_factor) : null,
  }

  const reclamation = ecartsDeLaRef(ref, lignes)
  if (reclamation.ecarts.length === 0) {
    return NextResponse.json({ error: 'Aucun écart depuis le verrou : rien à réclamer sur cette référence.' }, { status: 400 })
  }

  const nomBoutique = String(boutique?.name ?? 'Votre boucherie')
  const fournisseur = String(article.supplier_name ?? 'Votre fournisseur')
  const aujourdHui = new Date().toISOString().slice(0, 10)
  const corps = corpsCourrier({ boutique: nomBoutique, fournisseur, ref, reclamation, date: aujourdHui })
  const uniteBase = (() => {
    const t = String(ref.unit ?? '').trim().toLowerCase()
    if (t === '' || t === 'piece' || t === 'pièce' || t === 'pi') return 'pièce'
    if (t === 'l') return 'L'
    return t
  })()

  await ensureFonts()

  const doc = (
    <Document title={corps.objet} author={nomBoutique}>
      <Page size="A4" style={s.page}>
        <View>
          <Text style={s.boutique}>{nomBoutique}</Text>
          <Text style={s.date}>Le {jourFr(aujourdHui)}</Text>
        </View>

        <View style={s.dest}>
          <Text style={s.destNom}>{fournisseur}</Text>
          <Text style={{ fontSize: 9, color: GRAY }}>Service commercial</Text>
        </View>

        <Text style={s.objet}>Objet : {corps.objet}</Text>

        {corps.paragraphes.map((p, i) => (
          <Text key={i} style={s.para}>{p}</Text>
        ))}

        <View style={s.table}>
          <View style={s.th}>
            <Text style={[s.thText, { width: '18%' }]}>Date</Text>
            <Text style={[s.thText, { width: '26%' }]}>Facture</Text>
            <Text style={[s.thText, { width: '14%', textAlign: 'right' }]}>Quantité</Text>
            <Text style={[s.thText, { width: '14%', textAlign: 'right' }]}>Facturé</Text>
            <Text style={[s.thText, { width: '14%', textAlign: 'right' }]}>Convenu</Text>
            <Text style={[s.thText, { width: '14%', textAlign: 'right' }]}>Écart HT</Text>
          </View>
          {reclamation.ecarts.map((e, i) => (
            <View key={i} style={s.tr} wrap={false}>
              <Text style={[s.cell, { width: '18%' }]}>{jourFr(e.date)}</Text>
              <Text style={[s.cell, { width: '26%' }]}>{e.invoice_number ?? '—'}</Text>
              <Text style={[s.cell, { width: '14%', textAlign: 'right' }]}>{e.qte !== null ? `${e.qte.toLocaleString('fr-FR')} ${uniteBase}` : 'non lue'}</Text>
              <Text style={[s.cell, { width: '14%', textAlign: 'right' }]}>{prixFr(e.paye)}</Text>
              <Text style={[s.cell, { width: '14%', textAlign: 'right' }]}>{prixFr(ref.blocked_price_ht)}</Text>
              <Text style={[s.cell, { width: '14%', textAlign: 'right', fontWeight: 700 }]}>{e.ecart_ht !== null ? eur(e.ecart_ht) : '—'}</Text>
            </View>
          ))}
          {reclamation.total_ht > 0 ? (
            <View style={s.total}>
              <Text style={{ fontSize: 9.5, fontWeight: 700, width: '86%' }}>Total de l’avoir demandé</Text>
              <Text style={{ fontSize: 9.5, fontWeight: 700, width: '14%', textAlign: 'right', color: NAVY }}>{eur(reclamation.total_ht)}</Text>
            </View>
          ) : null}
        </View>

        {corps.reserve ? <Text style={s.reserve}>{corps.reserve}</Text> : null}

        <Text style={s.para}>{corps.demande}</Text>
        <Text style={s.para}>Nous vous prions d’agréer, Madame, Monsieur, nos salutations distinguées.</Text>

        <View style={s.signature}>
          <Text style={{ fontSize: 10, fontWeight: 700 }}>{nomBoutique}</Text>
        </View>

        <Text style={s.pied} fixed>
          Courrier préparé avec PILOTE — les montants proviennent des factures citées, aux conditions convenues au {ref.blocked_at ? jourFr(ref.blocked_at) : 'jour du blocage du prix'}.
        </Text>
      </Page>
    </Document>
  )

  const buffer = await renderToBuffer(doc)
  const nomFichier = `reclamation-${String(article.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}-${aujourdHui}.pdf`
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${nomFichier}"`,
      'Cache-Control': 'no-store',
    },
  })
}
