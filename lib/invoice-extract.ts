// lib/invoice-extract.ts — LE MOTEUR de lecture d'une facture fournisseur.
//
// Sorti du module de route au lot A (31/07) pour une raison précise : un
// `route.ts` Next n'exporte que ses verbes HTTP, si bien que le prompt et
// l'extracteur y étaient enfermés. Impossible, dès lors, de les REJOUER sur un
// texte archivé — donc impossible de mesurer l'effet d'un changement de prompt.
// Ici, le moteur est appelable par la route de lecture ET par la route
// d'évaluation (/api/admin/invoice-eval), qui rejoue exactement le même code.
//
// L'IA n'effectue AUCUN calcul : elle relit des montants tels qu'écrits. Tous
// les contrôles — somme des lignes contre total, quantité × prix contre montant
// — sont faits en code, dans la route, sur ce que ce module a produit.

import Anthropic from '@anthropic-ai/sdk'

/** Version du prompt d'extraction. À INCRÉMENTER à chaque modification : c'est
 *  elle qui permet de dire « avant / après » sur le corpus, et donc de refuser
 *  un changement qui dégrade au lieu de le découvrir en production. */
export const PROMPT_LIGNES_VERSION = '2026-08-01-d-libelle-seul'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'MISSING_ANTHROPIC_KEY' })

export type ExtractedLine = {
  designation: string
  article_code: string | null
  quantity: number | null
  unit: string | null
  unit_price_ht: number | null
  amount_ht: number
  tva_rate: number | null
  /** POIDS FACTURÉ en kilos, quand la facture porte une colonne de poids
   *  DISTINCTE du nombre de colis.
   *
   *  Une facture de boucherie aligne trois nombres par ligne : le nombre de
   *  colis, le poids, et le prix au kilo. Le format n'en acceptait qu'un seul,
   *  et l'IA y mettait le nombre de colis — si bien que le contrôle
   *  « quantité × prix = montant » échouait sur des lignes parfaitement lues,
   *  et que le prix, juste, partait en quarantaine. Mesuré le 31/07 : 32 prix
   *  refusés sur des factures dont la somme tombait au centime près. */
  weight_kg: number | null
}

export function parseNum(s: string): number | null {
  const n = parseFloat(String(s ?? '').trim().replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export function parseDate(s: string): string | null {
  const m = String(s ?? '').match(/(\d{4})-(\d{2})-(\d{2})|(\d{2})\/(\d{2})\/(\d{4})/)
  if (!m) return null
  return m[1] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[6]}-${m[5]}-${m[4]}`
}

/** Le PDF → lignes produits + dates, format pipe (une ligne par article, robuste
 *  aux JSON mal fermés). L'IA n'effectue AUCUN calcul : les montants sont relus
 *  tels quels et vérifiés en code contre le total connu de la facture. */
export const TEXTE_MAX = 60000   // au-delà, le texte est découpé en tranches, jamais coupé net
export const LIGNES_MAX = 400    // plafond de sécurité, atteint = signalé (jamais silencieux)

/** Une passe d'extraction sur un morceau de texte. `tronque` dit si la RÉPONSE
 *  de l'IA a été coupée par le plafond de tokens — auquel cas il manque des
 *  lignes, et la facture ne doit surtout pas être déclarée incohérente sur
 *  cette base : c'est notre lecture qui est incomplète, pas le document. */
/** Le prompt d'extraction — partagé par la lecture TEXTE et la lecture IMAGE :
 *  les deux doivent produire exactement le même format, sinon les garde-fous
 *  déterministes en aval ne s'appliquent pas de la même façon. */
export function promptExtraction(totalHT: number, pdfText: string): string {
  return `Voici le texte d'une facture fournisseur de boucherie. Total HT connu : ${totalHT.toFixed(2)} EUR.
COMMENCE par qualifier la facture :
NATURE|matiere      si elle facture des ingrédients alimentaires ou des consommables de production (viande, charcuterie, épicerie, boissons, emballages, barquettes…)
NATURE|hors_matiere si elle facture autre chose : matériel, équipement, entretien, services, logiciels, abonnements, avantages salariés, énergie, transport seul, honoraires.
Si NATURE est hors_matiere, n'écris AUCUNE ligne L| — la facture ne nourrit pas la mercuriale.

Sinon, extrais CHAQUE ligne d'article facturé. Retourne UNIQUEMENT des lignes aux formats suivants, sans autre texte :

NATURE|matiere
LIVRAISON|2026-07-21
ECHEANCE|2026-08-20
L|DESIGNATION|CODE|QUANTITE|UNITE|PRIX_UNITAIRE_HT|MONTANT_HT|TAUX_TVA|POIDS_KG

Exemples :
L|ECHINE DE PORC SANS OS|4521|12.4|kg|5.80|71.92|5.5|
L|JAMBON SEC BAYONNE|8842|2|pièce|14.97|224.73|5.5|15.012
L|SALADE PIEMONTAISE 2.8KG|3310|1|colis|6.00|16.80|5.5|2.8
L|BARQUETTE 500G x100|EMB-102|2|colis|18.50|37.00|20|
L|REMISE COMMERCIALE||||-12.00|-12.00|5.5|

Une ligne de facture porte SOUVENT cinq à sept nombres. Exemple réel, avec son en-tête de colonnes :
« Code | Désignation | UF | Nb. Pièces | Poids Net | P.U Brut | P.U Net | Montant HT | T »
« 000233  SAUCISSON SEC ROND D'AUVERGNE  KG  3  4,003  22,550  22,550  90,27  1 »
se lit : L|SAUCISSON SEC ROND D'AUVERGNE|000233|3|kg|22.550|90.27|5.5|4.003
Le MONTANT est 90,27 — le nombre de la colonne « Montant HT », PAS 3 × 22,550 = 67,65.
Le dernier nombre (1) est un code de TVA interne, pas un taux : ne le recopie jamais en TAUX_TVA.

Règles STRICTES :
- MONTANT_HT = le montant HT tel qu'ÉCRIT sur la ligne, celui de la dernière colonne monétaire. Il figure TEL QUEL dans le texte. Ne le recalcule JAMAIS, sous aucun prétexte.
- N'ajuste JAMAIS un montant pour qu'il colle à QUANTITE × PRIX_UNITAIRE. Sur ces factures le produit ne tombe très souvent PAS juste, parce que le prix est au kilo et la quantité en colis. Ce n'est pas une erreur à corriger : c'est exactement pour ça que la colonne POIDS_KG existe. Recopie chaque nombre à sa place et laisse-les en désaccord apparent.
- TAUX_TVA = un taux en pourcentage (5.5, 10, 20). Un « 1 », « 2 » ou « 3 » en fin de ligne est un code de TVA du fournisseur : laisse alors TAUX_TVA vide.
- DESIGNATION = le libellé de l'article SEUL. N'y inclus jamais les nombres qui l'entourent dans le texte : ni le nombre de colis, ni le poids, ni le prix. « 2.0 kg FILET DE POULET S/ATMO » se note FILET DE POULET S/ATMO. Ces nombres ont leurs colonnes.
- CODE = référence article du fournisseur si présente, sinon vide.
- QUANTITE et PRIX_UNITAIRE_HT vides s'ils ne figurent pas sur la facture — ne JAMAIS les inventer.
- UNITE = kg, pièce, colis, L… telle qu'écrite.
- POIDS_KG : ces factures portent SOUVENT DEUX nombres par ligne — le nombre de colis (ou de pièces) ET le poids facturé. Quand c'est le cas, mets le nombre de colis en QUANTITE et le POIDS EN KILOS dans POIDS_KG, et le prix au kilo en PRIX_UNITAIRE_HT. Exemple : « 2 pce · 15,012 kg · 14,97 €/kg · 224,73 € » donne QUANTITE=2, POIDS_KG=15.012, PRIX_UNITAIRE_HT=14.97.
- POIDS_KG reste VIDE si la facture ne montre qu'un seul nombre (la quantité EST le poids, ou l'article se vend à la pièce). Ne jamais le déduire ni le calculer : uniquement s'il est ÉCRIT.
- Point décimal. Une ligne L| par article, remises et consignes comprises (montants négatifs autorisés).
- Ignorer les sous-totaux, totaux, TVA récapitulative, frais de port SI déjà comptés ailleurs.
- LIVRAISON = date de LIVRAISON de la marchandise (mentions « livré le », « date de livraison », « expédition », « bon de livraison / BL »). ECHEANCE = date limite de PAIEMENT (« à régler avant le », « échéance », « date d'échéance », « payable au »). Ces deux dates sont DIFFÉRENTES : ne jamais recopier l'échéance en LIVRAISON. Si une seule figure sur la facture, ne renseigner QUE celle-là. Format AAAA-MM-JJ, ligne absente si introuvable.
${pdfText ? `\nTexte de la facture :\n${pdfText}` : '\nLa facture est le document joint : lis-le directement.'}`
}

/** Analyse la réponse de l'IA (format pipe) — commune aux deux modes de lecture. */
export function parseReponse(raw: string): {
  lines: ExtractedLine[]; delivery_date: string | null; due_date: string | null; nature: 'matiere' | 'hors_matiere'
} {
  const lines: ExtractedLine[] = []
  let delivery_date: string | null = null
  let due_date: string | null = null
  let nature: 'matiere' | 'hors_matiere' = 'matiere'
  for (const l of raw.split('\n')) {
    const t = l.trim()
    if (t.startsWith('NATURE|')) { if (t.slice(7).trim() === 'hors_matiere') nature = 'hors_matiere'; continue }
    if (t.startsWith('LIVRAISON|')) { delivery_date = parseDate(t.slice(10)); continue }
    if (t.startsWith('ECHEANCE|')) { due_date = parseDate(t.slice(9)); continue }
    if (!t.startsWith('L|')) continue
    const p = t.slice(2).split('|')
    if (p.length < 6) continue
    const designation = p[0]?.trim()
    const amount = parseNum(p[5] ?? '')
    if (!designation || amount === null || amount === 0) continue
    lines.push({
      designation: designation.slice(0, 120),
      article_code: p[1]?.trim() ? p[1].trim().slice(0, 40) : null,
      quantity: parseNum(p[2] ?? ''),
      unit: p[3]?.trim() ? p[3].trim().toLowerCase().slice(0, 12) : null,
      unit_price_ht: parseNum(p[4] ?? ''),
      amount_ht: amount,
      tva_rate: parseNum(p[6] ?? ''),
      // Colonne ajoutée en fin de format : les réponses au format précédent
      // (sept champs) restent lisibles telles quelles, poids simplement absent.
      // Un poids nul ou négatif n'a pas de sens et vaut « non renseigné ».
      weight_kg: (() => { const w = parseNum(p[7] ?? ''); return w !== null && w > 0 ? w : null })(),
    })
  }
  return { lines: lines.slice(0, LIGNES_MAX), delivery_date, due_date, nature }
}

/** Une passe d'extraction sur un morceau de TEXTE. `tronque` dit si la réponse
 *  de l'IA a été coupée par le plafond de tokens — auquel cas il manque des
 *  lignes, et la facture ne doit surtout pas être déclarée incohérente sur
 *  cette base : c'est notre lecture qui est incomplète, pas le document. */
export async function extractLines(pdfText: string, totalHT: number): Promise<{
  lines: ExtractedLine[]; delivery_date: string | null; due_date: string | null
  nature: 'matiere' | 'hors_matiere'; tronque: boolean
}> {
  const r = await anthropic.messages.create({
    // 3000 tokens plafonnaient la sortie vers 80-110 lignes : au-delà la réponse
    // était coupée en silence, la somme ne bouclait plus, et TOUTE la facture
    // partait en quarantaine. Le budget suit désormais le plafond de lignes.
    model: 'claude-haiku-4-5-20251001', max_tokens: 16000,
    // Lire une facture n'est pas un exercice de style : c'est de la
    // transcription. À température par défaut, deux lectures du MÊME texte
    // donnaient deux résultats — mesuré le 01/08, où une facture est passée de
    // 100 % à 18 % d'un rejeu à l'autre sans qu'une ligne de code ait bougé.
    // Une mesure qui varie toute seule ne prouve rien.
    temperature: 0,
    messages: [{ role: 'user', content: promptExtraction(totalHT, pdfText) }],
  })
  const raw = r.content[0]?.type === 'text' ? r.content[0].text : ''
  return { ...parseReponse(raw), tronque: r.stop_reason === 'max_tokens' }
}

/** Lecture complète d'un document, quelle que soit sa longueur.
 *  Une facture récapitulative de viande dépasse largement 15 000 caractères :
 *  couper le texte revenait à perdre les dernières lignes ET à faire échouer le
 *  contrôle de cohérence, donc à jeter les prix des lignes correctement lues.
 *  Ici le texte est découpé en tranches sur des frontières de ligne, chaque
 *  tranche est extraite, et les résultats sont concaténés. */
export async function extractLinesLong(pdfText: string, totalHT: number) {
  if (pdfText.length <= TEXTE_MAX) return extractLines(pdfText, totalHT)

  const morceaux: string[] = []
  let reste = pdfText
  while (reste.length > 0) {
    if (reste.length <= TEXTE_MAX) { morceaux.push(reste); break }
    const coupe = reste.lastIndexOf('\n', TEXTE_MAX)
    const at = coupe > TEXTE_MAX / 2 ? coupe : TEXTE_MAX
    morceaux.push(reste.slice(0, at))
    reste = reste.slice(at)
  }

  const lines: ExtractedLine[] = []
  let delivery_date: string | null = null
  let due_date: string | null = null
  let nature: 'matiere' | 'hors_matiere' = 'matiere'
  let tronque = false
  for (const [i, m] of morceaux.entries()) {
    const r = await extractLines(m, totalHT)
    lines.push(...r.lines)
    if (r.delivery_date && !delivery_date) delivery_date = r.delivery_date
    if (r.due_date && !due_date) due_date = r.due_date
    // La nature se juge sur la PREMIÈRE tranche : c'est là que vit l'en-tête
    if (i === 0) nature = r.nature
    if (r.tronque) tronque = true
  }
  return { lines: lines.slice(0, LIGNES_MAX), delivery_date, due_date, nature, tronque }
}

/** Lecture d'un PDF SANS couche texte (scan, photo) : le document est envoyé
 *  tel quel à l'IA, qui le regarde au lieu de lire un texte inexistant.
 *  Chemin de REPLI, jamais nominal : il ne se déclenche que sur les documents
 *  dont on a mesuré qu'ils n'ont pas de texte, donc le surcoût reste borné aux
 *  fournisseurs qui envoient des scans. Si le modèle n'accepte pas le document,
 *  l'appel lève — et l'appelant marque « scan illisible » avec le motif, ce qui
 *  reste très supérieur à l'« erreur » muette d'avant. */
export async function extractLinesVision(buffer: Buffer, totalHT: number): Promise<{
  lines: ExtractedLine[]; delivery_date: string | null; due_date: string | null
  nature: 'matiere' | 'hors_matiere'; tronque: boolean
}> {
  const r = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 16000,
    // Même raison qu'en lecture texte : transcription, pas création.
    temperature: 0,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') },
        } as unknown as { type: 'text'; text: string },
        { type: 'text', text: promptExtraction(totalHT, '') },
      ],
    }],
  })
  const raw = r.content[0]?.type === 'text' ? r.content[0].text : ''
  return { ...parseReponse(raw), tronque: r.stop_reason === 'max_tokens' }
}
