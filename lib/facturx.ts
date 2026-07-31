// lib/facturx.ts — LIRE LA FACTURE PLUTÔT QUE LA DEVINER.
//
// Depuis le 1er septembre 2026, toute entreprise française doit pouvoir RECEVOIR
// des factures électroniques, et les grandes entreprises et ETI doivent en
// ÉMETTRE. Un PDF ordinaire ne compte plus comme une facture électronique : le
// document doit porter un jeu de données STRUCTURÉES lisible par une machine.
// Trois formats sont retenus — Factur-X (un PDF avec son XML embarqué), UBL et
// CII (des XML purs).
//
// Ce que ça change ici, et c'est considérable : quand le XML est là, la
// quantité, l'unité, le prix unitaire et le montant de chaque ligne sont des
// CHAMPS NOMMÉS. Plus de lecture au jugé, plus de colonne à deviner, plus de
// prix mis en quarantaine parce que le contrôle ne retombe pas sur ses pieds —
// et l'unité est même normalisée (KGM = kilo, H87 = pièce), ce qui règle d'un
// coup le problème du colis compté pour un kilo.
//
// Module PUR : aucune dépendance nouvelle. L'XML embarqué se sort du PDF avec
// le zlib de Node, et les champs se lisent avec un extracteur de balises
// insensible aux préfixes de namespace (ram:, cbc:, cac:… varient d'un émetteur
// à l'autre). Un XML absent ou incompréhensible ne casse rien : on rend null et
// la lecture IA reprend la main.

import { inflateSync, inflateRawSync } from 'zlib'

/** Une ligne de facture telle que le XML la déclare — aucune interprétation. */
export type LigneFacturX = {
  designation: string
  article_code: string | null
  /** Quantité facturée, dans l'unité déclarée. */
  quantity: number | null
  /** Unité normalisée en vocabulaire PILOTE : 'kg', 'piece', ou le code brut. */
  unit: string | null
  /** Poids en kilos quand la quantité EST un poids — l'unité le dit. */
  weight_kg: number | null
  unit_price_ht: number | null
  amount_ht: number
  tva_rate: number | null
}

export type FactureXml = {
  /** 'cii' (Factur-X / ZUGFeRD / CII) ou 'ubl'. */
  profil: 'cii' | 'ubl'
  lines: LigneFacturX[]
  /** Total HT déclaré par le document, quand il y figure. */
  total_ht: number | null
  invoice_number: string | null
  delivery_date: string | null
  due_date: string | null
}

/** Codes d'unité UN/ECE Rec. 20 rencontrés sur les factures alimentaires.
 *  KGM = kilogramme, GRM = gramme, H87/C62/EA/PCE = pièce, LTR = litre. */
const UNITES: Record<string, 'kg' | 'piece' | 'g' | 'l'> = {
  KGM: 'kg', KG: 'kg',
  GRM: 'g', GR: 'g',
  H87: 'piece', C62: 'piece', EA: 'piece', PCE: 'piece', PR: 'piece', NAR: 'piece',
  LTR: 'l', LTM: 'l',
}

const nombre = (s: string | null): number | null => {
  if (s === null) return null
  const n = parseFloat(String(s).trim().replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** Contenu du PREMIER élément portant ce nom local, préfixe de namespace ignoré. */
function balise(xml: string, nom: string): string | null {
  const re = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${nom}\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${nom}>`, 'i')
  const m = xml.match(re)
  return m ? m[1].trim() : null
}

/** Tous les blocs portant ce nom local. */
function balises(xml: string, nom: string): string[] {
  const re = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${nom}\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${nom}>`, 'gi')
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) out.push(m[1])
  return out
}

/** Valeur d'un attribut sur la PREMIÈRE balise de ce nom (ex. unitCode). */
function attribut(xml: string, nom: string, attr: string): string | null {
  const re = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${nom}\\b[^>]*\\b${attr}\\s*=\\s*"([^"]*)"`, 'i')
  const m = xml.match(re)
  return m ? m[1] : null
}

/** Date au format AAAAMMJJ (CII, format 102) ou AAAA-MM-JJ (UBL) → AAAA-MM-JJ. */
function dateIso(s: string | null): string | null {
  if (!s) return null
  const t = s.trim()
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = t.match(/(\d{4})(\d{2})(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

function unite(code: string | null): { unit: string | null; kg: (q: number | null) => number | null } {
  const c = (code ?? '').trim().toUpperCase()
  const u = UNITES[c]
  if (u === 'kg') return { unit: 'kg', kg: q => q }
  if (u === 'g') return { unit: 'g', kg: q => (q === null ? null : q / 1000) }
  if (u === 'piece') return { unit: 'piece', kg: () => null }
  if (u === 'l') return { unit: 'l', kg: () => null }
  return { unit: c ? c.toLowerCase() : null, kg: () => null }
}

/** CII — Factur-X, ZUGFeRD, et le CII pur. */
function lireCII(xml: string): FactureXml | null {
  const blocs = balises(xml, 'IncludedSupplyChainTradeLineItem')
  if (blocs.length === 0) return null
  const lines: LigneFacturX[] = []
  for (const b of blocs) {
    const produit = balise(b, 'SpecifiedTradeProduct') ?? b
    const designation = (balise(produit, 'Name') ?? '').replace(/\s+/g, ' ').trim()
    const code = balise(produit, 'SellerAssignedID') ?? balise(produit, 'GlobalID')
    const qte = nombre(balise(b, 'BilledQuantity'))
    const u = unite(attribut(b, 'BilledQuantity', 'unitCode'))
    // Prix NET d'abord (remises déduites) — c'est celui qui a été payé. À défaut,
    // le prix brut. Un prix affiché « pour 10 kg » porte une BasisQuantity : le
    // ramener à l'unité, sans quoi la mercuriale publierait un prix dix fois trop
    // gros sans le savoir.
    const blocNet = balise(b, 'NetPriceProductTradePrice')
    const blocBrut = balise(b, 'GrossPriceProductTradePrice')
    const blocPrix = blocNet ?? blocBrut
    let prix = blocPrix ? nombre(balise(blocPrix, 'ChargeAmount')) : null
    if (blocPrix && prix !== null) {
      const base = nombre(balise(blocPrix, 'BasisQuantity'))
      if (base !== null && base > 0 && base !== 1) prix = +(prix / base).toFixed(6)
    }
    const montant = nombre(balise(b, 'LineTotalAmount'))
    if (!designation || montant === null) continue
    lines.push({
      designation: designation.slice(0, 120),
      article_code: code ? code.trim().slice(0, 40) : null,
      quantity: qte,
      unit: u.unit,
      weight_kg: u.kg(qte),
      unit_price_ht: prix,
      amount_ht: montant,
      tva_rate: nombre(balise(b, 'RateApplicablePercent')),
    })
  }
  if (lines.length === 0) return null
  const reglement = balise(xml, 'ApplicableHeaderTradeSettlement') ?? xml
  const livraison = balise(xml, 'ApplicableHeaderTradeDelivery') ?? ''
  const doc = balise(xml, 'ExchangedDocument') ?? xml
  const totalBloc = balise(reglement, 'SpecifiedTradeSettlementHeaderMonetarySummation') ?? reglement
  return {
    profil: 'cii',
    lines,
    total_ht: nombre(balise(totalBloc, 'TaxBasisTotalAmount')) ?? nombre(balise(totalBloc, 'LineTotalAmount')),
    invoice_number: balise(doc, 'ID'),
    delivery_date: dateIso(balise(livraison, 'DateTimeString')),
    due_date: dateIso(balise(balise(reglement, 'SpecifiedTradePaymentTerms') ?? '', 'DateTimeString')),
  }
}

/** UBL — Invoice et CreditNote. */
function lireUBL(xml: string): FactureXml | null {
  const blocs = [...balises(xml, 'InvoiceLine'), ...balises(xml, 'CreditNoteLine')]
  if (blocs.length === 0) return null
  const lines: LigneFacturX[] = []
  for (const b of blocs) {
    const item = balise(b, 'Item') ?? b
    const designation = (balise(item, 'Name') ?? balise(item, 'Description') ?? '').replace(/\s+/g, ' ').trim()
    const code = balise(balise(item, 'SellersItemIdentification') ?? '', 'ID')
    const nomQte = balise(b, 'InvoicedQuantity') !== null ? 'InvoicedQuantity' : 'CreditedQuantity'
    const qte = nombre(balise(b, nomQte))
    const u = unite(attribut(b, nomQte, 'unitCode'))
    const blocPrix = balise(b, 'Price')
    let prix = blocPrix ? nombre(balise(blocPrix, 'PriceAmount')) : null
    if (blocPrix && prix !== null) {
      const base = nombre(balise(blocPrix, 'BaseQuantity'))
      if (base !== null && base > 0 && base !== 1) prix = +(prix / base).toFixed(6)
    }
    const montant = nombre(balise(b, 'LineExtensionAmount'))
    if (!designation || montant === null) continue
    lines.push({
      designation: designation.slice(0, 120),
      article_code: code ? code.trim().slice(0, 40) : null,
      quantity: qte,
      unit: u.unit,
      weight_kg: u.kg(qte),
      unit_price_ht: prix,
      amount_ht: montant,
      tva_rate: nombre(balise(balise(item, 'ClassifiedTaxCategory') ?? '', 'Percent')),
    })
  }
  if (lines.length === 0) return null
  const totaux = balise(xml, 'LegalMonetaryTotal') ?? xml
  return {
    profil: 'ubl',
    lines,
    total_ht: nombre(balise(totaux, 'TaxExclusiveAmount')) ?? nombre(balise(totaux, 'LineExtensionAmount')),
    invoice_number: balise(xml, 'ID'),
    delivery_date: dateIso(balise(balise(xml, 'Delivery') ?? '', 'ActualDeliveryDate')),
    due_date: dateIso(balise(xml, 'DueDate')),
  }
}

/** Lit un XML de facture, quel que soit son profil. null si ce n'en est pas un. */
export function lireFactureXml(xml: string): FactureXml | null {
  if (!xml || xml.length < 40) return null
  return lireCII(xml) ?? lireUBL(xml)
}

/** Ce XML ressemble-t-il à une facture structurée ? */
function estFactureXml(s: string): boolean {
  return /CrossIndustryInvoice|<(?:[A-Za-z0-9_.-]+:)?Invoice\b|<(?:[A-Za-z0-9_.-]+:)?CreditNote\b/i.test(s)
}

/** Nombre maximal de flux inspectés dans un PDF, et taille au-delà de laquelle
 *  un flux n'est pas une pièce jointe XML (ce sont des images). */
const FLUX_MAX = 120
const FLUX_TAILLE_MAX = 4 * 1024 * 1024

/**
 * Sort le XML embarqué d'un PDF Factur-X / ZUGFeRD.
 *
 * Pas de bibliothèque PDF : on parcourt les flux du document, on tente de les
 * décompresser, et on garde celui qui ressemble à une facture. C'est peu
 * élégant mais c'est ROBUSTE — cela ne dépend ni de la table des objets, ni du
 * nom donné à la pièce jointe, qui varie (factur-x.xml, zugferd-invoice.xml,
 * xrechnung.xml, factur-x.xml renommé par l'émetteur…).
 *
 * Renvoie null dès que le document n'en contient pas : la lecture IA reprend
 * alors la main, exactement comme avant.
 */
export function extraireXmlDuPdf(pdf: Buffer): string | null {
  if (!pdf || pdf.length < 100) return null
  // Le XML peut être stocké SANS compression : on regarde d'abord le document nu.
  const brut = pdf.toString('latin1')
  if (brut.length < 30 * 1024 * 1024) {
    const direct = brut.match(/<\?xml[\s\S]{0,80}?\?>[\s\S]*?<\/(?:[A-Za-z0-9_.-]+:)?(?:CrossIndustryInvoice|Invoice|CreditNote)>/i)
    if (direct && estFactureXml(direct[0])) return Buffer.from(direct[0], 'latin1').toString('utf8')
  }

  const debut = Buffer.from('stream')
  const fin = Buffer.from('endstream')
  let i = 0, vus = 0
  while (vus < FLUX_MAX) {
    const d = pdf.indexOf(debut, i)
    if (d < 0) break
    const f = pdf.indexOf(fin, d)
    if (f < 0) break
    i = f + fin.length
    vus++
    // Sauter le saut de ligne qui suit « stream » (CRLF, LF, ou rien)
    let s = d + debut.length
    if (pdf[s] === 0x0d) s++
    if (pdf[s] === 0x0a) s++
    if (f - s <= 0 || f - s > FLUX_TAILLE_MAX) continue
    const flux = pdf.subarray(s, f)
    for (const decompresse of [
      () => inflateSync(flux),
      () => inflateRawSync(flux),
      () => flux,
    ]) {
      let texte: string
      try {
        const out = decompresse()
        if (out.length > FLUX_TAILLE_MAX) continue
        texte = out.toString('utf8')
      } catch {
        continue
      }
      if (texte.includes('<') && estFactureXml(texte)) return texte
    }
  }
  return null
}

/** Le chemin complet : un PDF entre, une facture structurée sort — ou null. */
export function lireFacturX(pdf: Buffer): FactureXml | null {
  const xml = extraireXmlDuPdf(pdf)
  return xml ? lireFactureXml(xml) : null
}
