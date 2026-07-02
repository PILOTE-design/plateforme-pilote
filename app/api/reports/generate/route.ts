if (typeof globalThis.DOMMatrix === "undefined") { (globalThis as Record<string, unknown>).DOMMatrix = class DOMMatrix { a=1;b=0;c=0;d=1;e=0;f=0 } }

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import ExcelJS from 'exceljs'
import { Resend } from 'resend'

export const maxDuration = 60

interface Produit { plu: string; designation: string; ventes: number; montant: number }
interface Famille { id: string; nom: string; total_montant: number; produits: Produit[] }
interface FinancierData { ca_net: number; nb_tickets: number; moyenne_ticket: number }
interface ReportData {
period_n: string; period_n1: string; week_number: number; year: number
financier_n: FinancierData; financier_n1: FinancierData
ventes_n: { total: number; familles: Famille[] }
ventes_n1: { total: number; familles: Famille[] }
}

async function parsePDF(file: File): Promise<string> {
const buffer = Buffer.from(await file.arrayBuffer())
const _m = await import('pdf-parse') as any
const fn = typeof _m.default === 'function' ? _m.default : _m
if (typeof fn !== 'function') throw new Error('pdf-parse not callable: ' + typeof _m.default)
const data = await fn(buffer)
return data.text
}

async function extractData(texts: { fin_n: string; fin_n1: string; ventes_n: string; ventes_n1: string }): Promise<ReportData> {
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })
const prompt = `Tu es un extracteur de donnees de caisse CRISALID. Extrais les donnees des 4 rapports et retourne UNIQUEMENT un JSON valide.

Structure JSON attendue :
{
"period_n": "15-21 juin 2026",
"period_n1": "16-22 juin 2025",
"week_number": 25,
"year": 2026,
"financier_n": { "ca_net": 20742.43, "nb_tickets": 496, "moyenne_ticket": 41.82 },
"financier_n1": { "ca_net": 19316.76, "nb_tickets": 453, "moyenne_ticket": 42.64 },
"ventes_n": { "total": 20742.43, "familles": [{ "id": "1", "nom": "VIANDE DE BOEUF", "total_montant": 3081.17, "produits": [{ "plu": "112", "designation": "STEAK HACHE", "ventes": 31.798, "montant": 634.37 }] }] },
"ventes_n1": { "total": 19316.76, "familles": [] }
}

=== FINANCIER N ===
${texts.fin_n.slice(0, 2500)}
=== FINANCIER N-1 ===
${texts.fin_n1.slice(0, 2500)}
=== VENTES N ===
${texts.ventes_n.slice(0, 7000)}
=== VENTES N-1 ===
${texts.ventes_n1.slice(0, 7000)}`

const response = await client.messages.create({
model: 'claude-haiku-4-5-20251001',
max_tokens: 8000,
messages: [{ role: 'user', content: prompt }],
})
const text = response.content[0].type === 'text' ? response.content[0].text : ''
return JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim())
}

async function generateExcel(data: ReportData): Promise<Buffer> {
const wb = new ExcelJS.Workbook()
const hFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }
const sFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D5986' } }
const aFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F4F8' } }
const gFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F4EA' } }
const rFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE8E6' } }
const tFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF8C00' } }
const wb2: Partial<ExcelJS.Font> = { color: { argb: 'FFFFFFFF' }, bold: true }
const ef = '#,##0.00 "€"'; const pf = '+0.0%;-0.0%;0.0%'
const { financier_n: fn, financier_n1: fn1, ventes_n: vn, ventes_n1: vn1 } = data
const famMap = new Map<string, Famille>()
for (const f of vn1.familles) famMap.set(f.nom.toUpperCase(), f)
const prodMap = new Map<string, Produit>()
for (const f of vn1.familles) for (const p of f.produits) prodMap.set(p.plu, p)

const ws1 = wb.addWorksheet('Synthese')
ws1.columns = [{ width: 32 }, { width: 16 }, { width: 16 }, { width: 14 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }]
ws1.mergeCells('A1:H1')
const c1 = ws1.getCell('A1')
c1.value = `ANALYSE COMPARATIVE - SEMAINE ${data.week_number} (${data.year} vs ${data.year - 1})`
c1.font = { ...wb2, size: 13 }; c1.fill = hFill; c1.alignment = { horizontal: 'center' }
ws1.mergeCells('A2:H2')
ws1.getCell('A2').value = `N : ${data.period_n} | N-1 : ${data.period_n1}`
ws1.getCell('A2').alignment = { horizontal: 'center' }
ws1.mergeCells('A3:B3'); ws1.mergeCells('C3:D3'); ws1.mergeCells('E3:F3'); ws1.mergeCells('G3:H3')
const kd: [string, string, string][] = [
[`A3`, `CA N : ${fn.ca_net.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}`, 'FF1E3A5F'],
[`C3`, `CA N-1 : ${fn1.ca_net.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}`, 'FF2D5986'],
[`E3`, `Tickets : ${fn.nb_tickets} (${fn.nb_tickets - fn1.nb_tickets > 0 ? '+' : ''}${fn.nb_tickets - fn1.nb_tickets})`, 'FF00695C'],
[`G3`, `Panier moy. : ${fn.moyenne_ticket.toFixed(2)} EUR`, 'FF4A148C'],
]
for (const [cell, val, color] of kd) {
const c = ws1.getCell(cell); c.value = val
c.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 11 }
c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } }
c.alignment = { horizontal: 'center', vertical: 'middle' }
}
ws1.getRow(3).height = 32
const hr = ws1.addRow([`Famille`, `CA N ${data.year}`, `CA N-1 ${data.year - 1}`, `Ecart`, `Ecart %`, `Poids N`, `Poids N-1`, `Tendance`])
hr.eachCell((c: any) => { c.fill = sFill; c.font = wb2; c.alignment = { horizontal: 'center' } })
let ri = 0
for (const fam of vn.familles) {
const f1m = famMap.get(fam.nom.toUpperCase())
const m1 = f1m?.total_montant ?? 0
const ec = fam.total_montant - m1
const row = ws1.addRow([`${fam.id} - ${fam.nom}`, fam.total_montant, m1 || null, ec, m1 ? ec / m1 : 0, vn.total ? fam.total_montant / vn.total : 0, vn1.total && m1 ? m1 / vn1.total : 0, ec >= 0 ? 'HAUSSE' : 'BAISSE'])
row.getCell(1).font = { bold: true }
row.getCell(2).numFmt = ef; row.getCell(3).numFmt = ef; row.getCell(4).numFmt = ef
row.getCell(5).numFmt = pf; row.getCell(6).numFmt = '0.0%'; row.getCell(7).numFmt = '0.0%'
row.getCell(8).font = { bold: true, color: { argb: ec >= 0 ? 'FF2E7D32' : 'FFC62828' } }
row.getCell(8).alignment = { horizontal: 'center' }
if (ri % 2 === 0) row.eachCell((c: any) => { c.fill = aFill })
if (ec > 0) row.getCell(4).fill = gFill
if (ec < 0) row.getCell(4).fill = rFill
ri++
}
const tr = ws1.addRow(['TOTAL GENERAL', vn.total, vn1.total, vn.total - vn1.total, vn1.total ? (vn.total - vn1.total) / vn1.total : 0, 1, 1, vn.total >= vn1.total ? 'HAUSSE' : 'BAISSE'])
tr.eachCell((c: any) => { c.fill = tFill; c.font = wb2 })
tr.getCell(2).numFmt = ef; tr.getCell(3).numFmt = ef; tr.getCell(4).numFmt = ef; tr.getCell(5).numFmt = pf

const ws2 = wb.addWorksheet('Detail Produits')
ws2.columns = [{ width: 8 }, { width: 36 }, { width: 14 }, { width: 16 }, { width: 16 }, { width: 14 }]
ws2.mergeCells('A1:F1')
const d1 = ws2.getCell('A1')
d1.value = `DETAIL PRODUITS - Semaine ${data.week_number}`; d1.font = { ...wb2, size: 12 }; d1.fill = hFill; d1.alignment = { horizontal: 'center' }
for (const fam of vn.familles) {
const fr = ws2.addRow([`${fam.id} - ${fam.nom}`, '', '', '', '', ''])
ws2.mergeCells(`A${fr.number}:F${fr.number}`)
fr.getCell(1).fill = sFill; fr.getCell(1).font = wb2
ws2.addRow(['PLU', 'Designation', 'Ventes', 'Montant N', 'Montant N-1', 'Ecart']).eachCell((c: any) => {
c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FE' } }; c.font = { bold: true }
})
let i = 0
for (const p of fam.produits) {
const p1 = prodMap.get(p.plu); const m1 = p1?.montant ?? null; const ec = m1 !== null ? p.montant - m1 : null
const row = ws2.addRow([p.plu, p.designation, p.ventes, p.montant, m1, ec])
row.getCell(4).numFmt = ef
if (m1 !== null) row.getCell(5).numFmt = ef
if (ec !== null) { row.getCell(6).numFmt = ef; row.getCell(6).fill = ec >= 0 ? gFill : rFill }
if (i % 2 === 0) { row.getCell(1).fill = aFill; row.getCell(2).fill = aFill; row.getCell(3).fill = aFill }
i++
}
ws2.addRow([])
}

const ws3 = wb.addWorksheet('Top et Flop')
ws3.columns = [{ width: 30 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 2 }, { width: 30 }, { width: 14 }, { width: 14 }, { width: 14 }]
ws3.mergeCells('A1:I1')
const tf = ws3.getCell('A1')
tf.value = `TOP et FLOP - Semaine ${data.week_number}`; tf.font = { ...wb2, size: 12 }; tf.fill = hFill; tf.alignment = { horizontal: 'center' }
const comps: { plu: string; designation: string; n: number; n1: number; ecart: number }[] = []
for (const fam of vn.familles) for (const p of fam.produits) {
const p1 = prodMap.get(p.plu)
if (p1) comps.push({ plu: p.plu, designation: p.designation, n: p.montant, n1: p1.montant, ecart: p.montant - p1.montant })
}
const tops = [...comps].sort((a, b) => b.ecart - a.ecart).slice(0, 10)
const flops = [...comps].sort((a, b) => a.ecart - b.ecart).slice(0, 10)
ws3.addRow([])
const hrow = ws3.addRow(['TOP 10 - Plus fortes hausses', '', '', '', '', 'FLOP 10 - Plus fortes baisses', '', '', ''])
ws3.mergeCells(`A${hrow.number}:D${hrow.number}`); ws3.mergeCells(`F${hrow.number}:I${hrow.number}`)
hrow.getCell(1).fill = gFill; hrow.getCell(1).font = { bold: true }
hrow.getCell(6).fill = rFill; hrow.getCell(6).font = { bold: true }
ws3.addRow(['Produit', 'N', 'N-1', 'Ecart', '', 'Produit', 'N', 'N-1', 'Ecart']).eachCell((c: any) => { c.font = { bold: true }; c.fill = aFill })
for (let i = 0; i < Math.max(tops.length, flops.length); i++) {
const t = tops[i], fl = flops[i]
const row = ws3.addRow([
t ? `${t.plu} - ${t.designation}` : '', t ? t.n : '', t ? t.n1 : '', t ? t.ecart : '',
'', fl ? `${fl.plu} - ${fl.designation}` : '', fl ? fl.n : '', fl ? fl.n1 : '', fl ? fl.ecart : ''
])
if (t) { row.getCell(2).numFmt = ef; row.getCell(3).numFmt = ef; row.getCell(4).numFmt = ef; row.getCell(4).fill = gFill }
if (fl) { row.getCell(7).numFmt = ef; row.getCell(8).numFmt = ef; row.getCell(9).numFmt = ef; row.getCell(9).fill = rFill }
}
return wb.xlsx.writeBuffer() as Promise<Buffer>
}

export async function POST(req: NextRequest) {
try {
const supabase = createClient()
const { data: { user } } = await supabase.auth.getUser()
if (!user) return NextResponse.json({ error: 'Non authentifie' }, { status: 401 })
const { data: profile } = await supabase.from('profiles').select('*').eq('user_id', user.id).single()
if (!profile) return NextResponse.json({ error: 'Profil introuvable' }, { status: 404 })
const formData = await req.formData()
const clientId = (formData.get('clientId') as string) || null
const finN = formData.get('financier_n') as File
const finN1 = formData.get('financier_n1') as File
const venN = formData.get('ventes_n') as File
const venN1 = formData.get('ventes_n1') as File
if (!finN || !finN1 || !venN || !venN1)
return NextResponse.json({ error: 'Les 4 fichiers PDF sont requis' }, { status: 400 })
const [tFN, tFN1, tVN, tVN1] = await Promise.all([parsePDF(finN), parsePDF(finN1), parsePDF(venN), parsePDF(venN1)])
const data = await extractData({ fin_n: tFN, fin_n1: tFN1, ventes_n: tVN, ventes_n1: tVN1 })
const excelBuffer = await generateExcel(data)
const fileName = `rapport-s${data.week_number}-${data.year}-${Date.now()}.xlsx`
const { error: uploadError } = await supabase.storage.from('reports').upload(fileName, excelBuffer, {
contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', upsert: false,
})
if (uploadError) return NextResponse.json({ error: 'Upload: ' + uploadError.message }, { status: 500 })
const { data: urlData } = supabase.storage.from('reports').getPublicUrl(fileName)
const fileUrl = urlData.publicUrl
let clientEmail: string | null = null
let clientName: string | null = null
if (clientId) {
const { data: client } = await supabase.from('clients').select('email, name').eq('id', clientId).single()
if (client) { clientEmail = client.email; clientName = client.name }
}
const title = `Analyse S${data.week_number} - ${data.period_n}${clientName ? ` — ${clientName}` : ''}`
const { error: dbError } = await supabase.from('reports').insert({
profile_id: profile.id, title, week_number: data.week_number, year: data.year, file_url: fileUrl,
...(clientId ? { client_id: clientId } : {}),
})
if (dbError) return NextResponse.json({ error: 'DB: ' + dbError.message }, { status: 500 })
const toEmail = clientEmail || profile.delivery_email || user.email || ''
const resend = new Resend(process.env.RESEND_API_KEY ?? '')
await resend.emails.send({
from: 'PILOTE <onboarding@resend.dev>',
to: toEmail,
subject: `Rapport hebdomadaire ${title}`,
html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto"><h2 style="color:#1E3A5F">Votre rapport est pret</h2><p><strong>${title}</strong></p><div style="margin:24px 0;text-align:center"><a href="${fileUrl}" style="background:#1E3A5F;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold">Telecharger Excel</a></div></div>`,
})
return NextResponse.json({ success: true, title, file_url: fileUrl })
} catch (err: unknown) {
console.error(err)
const _e = err instanceof Error ? err : new Error(String(err))
return NextResponse.json({ error: _e.message + ' || STACK: ' + (_e.stack||'').replace(/\n/g,' > ').slice(0,600) }, { status: 500 })
}
}
