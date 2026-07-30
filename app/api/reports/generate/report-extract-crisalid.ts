// report-extract-crisalid.ts — LECTURE DÉTERMINISTE des PDF Crisalid (zéro IA).
//
// Pourquoi ce module existe : un PDF Crisalid n'est pas une image, chaque nombre
// y a une position (x, y). `pdf-parse` rend un texte plat qui COLLE les colonnes
// (« 1600FAB MERGUEZ28.565201.38 € ») ; l'IA doit alors DEVINER où couper, et se
// trompe (mesuré : une ventilation gonflée de +1600 € sur un rapport réel). Ici
// on relit le même PDF PAR COORDONNÉES : on reconstruit les vraies colonnes
// PLU │ désignation │ TVA │ quantité │ montant, et on lit chaque montant dans SA
// colonne, exactement. Sur un format à mise en page fixe, c'est déterministe :
// même fichier → mêmes chiffres, à chaque fois.
//
// Aucune dépendance nouvelle : on réutilise le `pdfjs` déjà embarqué par
// `pdf-parse` (déjà présent dans le projet) via son hook `pagerender`, qui donne
// accès aux items de texte AVEC leurs coordonnées.
//
// Ce module PRODUIT le même ExtractedData que l'extraction IA (report-extract),
// pour être un remplaçant transparent. Il expose un signal `ok` : si le format
// n'est pas reconnu ou si la lecture n'est pas cohérente, l'appelant retombe sur
// l'extraction IA (repli automatique — jamais pire qu'aujourd'hui).

import type { ExtractedData, Famille, FinancierData, Produit } from './report-types'

// ─── Bas niveau : PDF → lignes reconstruites par coordonnées ───────────────────

type Item = { x: number; y: number; str: string }

async function toBuffer(input: File | Buffer): Promise<Buffer> {
  if (Buffer.isBuffer(input)) return input
  return Buffer.from(await input.arrayBuffer())
}

function rowText(row: Item[]): string {
  return row.sort((a, b) => a.x - b.x).map(i => i.str).join(' ').replace(/\s+/g, ' ').trim()
}

/** Lit un PDF et renvoie ses lignes, reconstruites par regroupement des items sur
 *  un même y (tolérance 2,5 pt : les montants alignés à droite tombent sur un y
 *  légèrement décalé), triés par x. C'est la brique qui rend les colonnes lisibles. */
export async function crisalidPdfToLines(input: File | Buffer): Promise<string[]> {
  const buffer = await toBuffer(input)
  const _m = (await import('pdf-parse')) as any
  const fn = typeof _m.default === 'function' ? _m.default : _m
  if (typeof fn !== 'function') throw new Error('pdf-parse not callable')
  const lines: string[] = []
  await fn(buffer, {
    // pagerender reçoit la page pdfjs : on accède aux coordonnées, on ne se sert
    // pas du texte plat concaténé par défaut (d'où le return '').
    pagerender: async (pageData: any) => {
      const tc = await pageData.getTextContent()
      const items: Item[] = tc.items
        .map((it: any) => ({ x: it.transform[4], y: it.transform[5], str: String(it.str) }))
        .sort((a: Item, b: Item) => b.y - a.y || a.x - b.x)
      let cur: Item[] = []
      let curY: number | null = null
      for (const it of items) {
        if (curY === null || Math.abs(it.y - curY) <= 2.5) {
          cur.push(it)
          if (curY === null) curY = it.y
        } else {
          lines.push(rowText(cur))
          cur = [it]
          curY = it.y
        }
      }
      if (cur.length) lines.push(rowText(cur))
      return ''
    },
  })
  return lines
}

// ─── Nombres ───────────────────────────────────────────────────────────────────

function num(s: string): number {
  const n = parseFloat(String(s).replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

// ─── Dates / semaine ISO (déterministe, sans IA) ───────────────────────────────

const MOIS_ABBR: Record<string, { idx: number; plein: string }> = {
  janv: { idx: 0, plein: 'janvier' }, fevr: { idx: 1, plein: 'février' }, mars: { idx: 2, plein: 'mars' },
  avr: { idx: 3, plein: 'avril' }, mai: { idx: 4, plein: 'mai' }, juin: { idx: 5, plein: 'juin' },
  juil: { idx: 6, plein: 'juillet' }, aout: { idx: 7, plein: 'août' }, sept: { idx: 8, plein: 'septembre' },
  oct: { idx: 9, plein: 'octobre' }, nov: { idx: 10, plein: 'novembre' }, dec: { idx: 11, plein: 'décembre' },
}

function moisFromLabel(label: string): { idx: number; plein: string } | null {
  const k = label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '')
  // essai par préfixe : « juil » ⊂ « juillet », « fevrier » commence par « fevr »…
  for (const [abbr, v] of Object.entries(MOIS_ABBR)) {
    if (k.startsWith(abbr) || abbr.startsWith(k.slice(0, 4))) return v
  }
  return null
}

function isoWeek(d: Date): { week: number; year: number } {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return { week: Math.ceil((((t.getTime() - yearStart.getTime()) / 86400000) + 1) / 7), year: t.getUTCFullYear() }
}

type Periode = { texte: string; start: Date | null }

/** Reconstruit la période depuis la ligne « du … <j> <mois> <aaaa> … au … <j> <mois> <aaaa> ».
 *  Renvoie un libellé lisible en mois PLEIN (pour l'affichage ET pour rester
 *  lisible par weekFromPeriod en aval) + la date de début (pour la semaine ISO). */
function parsePeriode(lines: string[]): Periode {
  const ligne = lines.find(l => /^du\s+/i.test(l) && /\bau\b/i.test(l)) || ''
  const dates = [...ligne.matchAll(/(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\.?\s+(20\d{2})/g)]
  if (dates.length >= 1) {
    const [, d1, m1, y1] = dates[0]
    const mo1 = moisFromLabel(m1)
    const start = mo1 ? new Date(Date.UTC(parseInt(y1), mo1.idx, parseInt(d1))) : null
    let texte = ''
    if (dates.length >= 2 && mo1) {
      const [, d2, m2, y2] = dates[1]
      const mo2 = moisFromLabel(m2)
      texte = (mo2 && (mo2.idx !== mo1.idx || y2 !== y1))
        ? `${parseInt(d1)} ${mo1.plein} - ${parseInt(d2)} ${mo2.plein} ${y2}`
        : `${parseInt(d1)} - ${parseInt(d2)} ${mo1.plein} ${y1}`
    } else if (mo1) {
      texte = `${parseInt(d1)} ${mo1.plein} ${y1}`
    }
    return { texte, start }
  }
  return { texte: '', start: null }
}

// ─── Relevé financier ──────────────────────────────────────────────────────────

/** Extrait le CA net (TTC), le nombre de tickets et le panier moyen du relevé
 *  financier. Prend TOUJOURS la colonne de GAUCHE (« Chiffre d'Affaires »), soit
 *  la première valeur de chaque ligne — la colonne de droite est le « Hors CA ». */
export function parseFinancier(lines: string[]): { fin: FinancierData; periode: Periode } | null {
  let ca = NaN, tickets = NaN, panier = NaN
  for (const ln of lines) {
    if (Number.isNaN(ca)) {
      const m = ln.match(/^Net\s+([\d\s.,]+?)\s*€/i)          // « Net 16203.76 € … » (pas « Net Hors-Taxes »)
      if (m) ca = num(m[1])
    }
    if (Number.isNaN(tickets)) {
      const m = ln.match(/^Nb\s+Tickets\s+(\d[\d\s]*)/i)      // « Nb Tickets 426 … »
      if (m) tickets = Math.round(num(m[1]))
    }
    if (Number.isNaN(panier)) {
      const m = ln.match(/^Moyenne\s+Tickets\s+([\d\s.,]+?)\s*€/i)  // « Moyenne Tickets 38.04 € … »
      if (m) panier = num(m[1])
    }
  }
  if (!(ca > 0)) return null
  return {
    fin: {
      ca_net: ca,
      nb_tickets: Number.isFinite(tickets) ? tickets : 0,
      moyenne_ticket: Number.isFinite(panier) ? panier : 0,
    },
    periode: parsePeriode(lines),
  }
}

// ─── Ventes par familles ───────────────────────────────────────────────────────

const RE_FAMILLE = /^(\d+)\s*-\s*([A-Za-zÀ-ÿ].*?)\s*$/          // « 1 - VIANDE DE BOEUF » (sans €)
const RE_PRODUIT = /^(\d+)\s+(.+?)\s+([\d.,]+)\s*%\s+([\d.,]+)\s+([\d\s.,]+?)\s*€\s*$/  // PLU dés. TVA qty montant €
const RE_TOTAL_SECTION = /^\d+\s+r[ée]f[ée]rences?\(s\)\s+[\d\s.,]+?\s+([\d\s.,]+?)\s*€\s*$/  // « 16 références(s) 108.181 3072.68 € »
const RE_TOTAL_GENERAL = /total\s+g[ée]n[ée]ral/i

export type VentesParse = {
  total: number
  familles: Famille[]
  prod: Map<string, number>
  prodFam: Map<string, string>
}

export function parseVentes(lines: string[]): VentesParse | null {
  const familles: Famille[] = []
  const prod = new Map<string, number>()
  const prodFam = new Map<string, string>()
  let cur: Famille | null = null
  let grandTotal = NaN
  let apresTotalGeneral = false

  for (const ln of lines) {
    if (RE_TOTAL_GENERAL.test(ln)) { apresTotalGeneral = true; cur = null; continue }

    const mTot = ln.match(RE_TOTAL_SECTION)
    if (mTot) {
      const montant = num(mTot[1])
      if (apresTotalGeneral) grandTotal = montant
      else if (cur) cur.total_montant = montant
      continue
    }

    const mProd = ln.match(RE_PRODUIT)
    if (mProd && cur) {
      const [, plu, designation, , qty, montant] = mProd
      const p: Produit = { plu: plu.trim(), designation: designation.trim(), ventes: num(qty), montant: num(montant) }
      if (Number.isFinite(p.montant)) {
        cur.produits.push(p)
        const key = p.designation.toUpperCase()
        if (key && p.montant > 0) {
          prod.set(key, (prod.get(key) ?? 0) + p.montant)
          if (!prodFam.has(key)) prodFam.set(key, cur.nom.toUpperCase())
        }
      }
      continue
    }

    // En-tête de famille : « N - NOM », jamais une ligne contenant « € »
    // (sinon on capterait un produit dont la désignation contient « - »).
    if (!ln.includes('€')) {
      const mFam = ln.match(RE_FAMILLE)
      if (mFam && !/^PLU\b/i.test(mFam[2])) {
        cur = { id: mFam[1], nom: mFam[2].trim(), total_montant: 0, produits: [] }
        familles.push(cur)
        continue
      }
    }
  }

  // Ne garder que les familles réellement totalisées (une section sans ligne
  // « références(s) » est un faux positif d'en-tête).
  const retenues = familles.filter(f => f.total_montant > 0)
  if (retenues.length === 0 || !(grandTotal > 0)) return null
  return { total: grandTotal, familles: retenues, prod, prodFam }
}

// ─── Orchestrateur ─────────────────────────────────────────────────────────────

export type CrisalidExtraction =
  | { ok: true; data: ExtractedData }
  | { ok: false; reason: string }

/** Tolérance de cohérence interne : la somme des familles doit égaler le Total
 *  général du fichier. Au-delà, on ne fait pas confiance à la lecture et on
 *  laisse l'appelant retomber sur l'IA. */
const TOL_COHERENCE_EUR = 0.5

function computeTopFlopLocal(
  prodN: Map<string, number>, prodN1: Map<string, number>,
): { tops: { designation: string; n: number; ecart: number }[]; flops: { designation: string; n: number; ecart: number }[] } {
  // Lecture déterministe = couverture COMPLÈTE (tous les produits lus, aucun
  // plafond de tokens) : une absence vaut donc vraiment zéro, le classement est fiable.
  const names = new Set<string>([...prodN.keys(), ...prodN1.keys()])
  const diffs: { designation: string; n: number; ecart: number }[] = []
  for (const name of names) {
    const n = prodN.get(name) ?? 0
    const n1 = prodN1.get(name) ?? 0
    diffs.push({ designation: name, n, ecart: +(n - n1).toFixed(2) })
  }
  return {
    tops: diffs.filter(d => d.ecart > 0).sort((a, b) => b.ecart - a.ecart).slice(0, 10),
    flops: diffs.filter(d => d.ecart < 0).sort((a, b) => a.ecart - b.ecart).slice(0, 10),
  }
}

/** Lit les 4 PDF Crisalid par coordonnées et produit un ExtractedData complet.
 *  Renvoie { ok:false } (sans lever) dès qu'un fichier n'est pas reconnu ou que
 *  la cohérence interne n'est pas au rendez-vous — l'appelant bascule alors sur
 *  l'extraction IA. Best-effort : toute exception est convertie en { ok:false }. */
export async function extractDataCrisalid(files: {
  finN: File | Buffer; finN1: File | Buffer; venN: File | Buffer; venN1: File | Buffer
}): Promise<CrisalidExtraction> {
  try {
    const [lFinN, lFinN1, lVenN, lVenN1] = await Promise.all([
      crisalidPdfToLines(files.finN), crisalidPdfToLines(files.finN1),
      crisalidPdfToLines(files.venN), crisalidPdfToLines(files.venN1),
    ])

    const finN = parseFinancier(lFinN)
    const finN1 = parseFinancier(lFinN1)
    const venN = parseVentes(lVenN)
    const venN1 = parseVentes(lVenN1)

    if (!finN) return { ok: false, reason: 'Relevé financier N non reconnu (format Crisalid attendu).' }
    if (!finN1) return { ok: false, reason: 'Relevé financier N-1 non reconnu.' }
    if (!venN) return { ok: false, reason: 'Fichier ventes N non reconnu.' }
    if (!venN1) return { ok: false, reason: 'Fichier ventes N-1 non reconnu.' }

    // Cohérence interne : somme des familles == Total général (chaque côté).
    const sN = venN.familles.reduce((s, f) => s + f.total_montant, 0)
    const sN1 = venN1.familles.reduce((s, f) => s + f.total_montant, 0)
    if (Math.abs(sN - venN.total) > TOL_COHERENCE_EUR)
      return { ok: false, reason: `Ventes N incohérentes : familles ${sN.toFixed(2)} ≠ Total général ${venN.total.toFixed(2)}.` }
    if (Math.abs(sN1 - venN1.total) > TOL_COHERENCE_EUR)
      return { ok: false, reason: `Ventes N-1 incohérentes : familles ${sN1.toFixed(2)} ≠ Total général ${venN1.total.toFixed(2)}.` }

    const iso = finN.periode.start ? isoWeek(finN.periode.start) : null
    const topFlop = computeTopFlopLocal(venN.prod, venN1.prod)

    const data: ExtractedData = {
      period_n: finN.periode.texte,
      period_n1: finN1.periode.texte,
      week_number: iso?.week ?? 0,
      year: iso?.year ?? 0,
      financier_n: finN.fin,
      financier_n1: finN1.fin,
      ventes_n: { total: venN.total, familles: venN.familles },
      ventes_n1: { total: venN1.total, familles: venN1.familles },
      tops: topFlop.tops,
      flops: topFlop.flops,
      prodN: venN.prod,
      prodN1: venN1.prod,
      prodFamN: venN.prodFam,
      prodFamN1: venN1.prodFam,
      notes: [], // lecture déterministe propre : aucune correction, aucune note
    }
    if (!(iso)) return { ok: false, reason: 'Période illisible — semaine ISO non calculable.' }
    return { ok: true, data }
  } catch (e) {
    return { ok: false, reason: 'Lecture déterministe indisponible : ' + (e instanceof Error ? e.message : String(e)) }
  }
}
