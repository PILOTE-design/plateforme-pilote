// lib/invoice-layouts.ts — la bibliothèque d'exemples de factures VÉRIFIÉS.
//
// Ce qui fait échouer une lecture n'est presque jamais le vocabulaire : c'est la
// MISE EN PAGE. Trois exemples mesurés le 01/08, sur trois fournisseurs :
//
//   DAVID MASTER   « … 3  4,003  22,550  22,550  90,27  1 »  montant AVANT le code TVA
//   LA VIANDE CHA. « … 1  1  21,800  13,000  1  283,40 »     montant APRÈS le code TVA
//   AURIBAULT OIRY « F A : 0 . 8 8 Ä »                        couche texte espacée
//
// Aucune règle générale ne couvre les trois. Un EXEMPLE JUSTE de la même
// disposition, si — et c'est ce que ce module fournit.
//
// Deux principes tiennent tout :
//
//   · N'entre dans la bibliothèque qu'une lecture dont la somme des lignes tombe
//     sur le total AU CENTIME. Elle ne peut donc pas s'empoisonner d'elle-même :
//     le total vient de la comptabilité, pas de nous.
//   · On ne SERT PAS toute la bibliothèque à chaque appel. On sert au plus deux
//     exemples, choisis : celui du même fournisseur d'abord, puis le plus proche
//     par sa ligne d'en-tête. Empiler cinquante exemples génériques coûterait du
//     contexte pour disperser l'attention du modèle sur des mises en page qu'il
//     n'a pas sous les yeux.

import { normText } from '@/lib/postes'

type ServiceClient = {
  from: (table: string) => any // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Un exemple servi au modèle : le texte d'origine et la lecture juste. */
export type ExempleFacture = {
  supplier_key: string
  header_signature: string
  sample_text: string
  sample_output: string
}

/** Taille de l'extrait conservé — assez pour porter l'en-tête et quelques
 *  lignes, jamais la facture entière : c'est la DISPOSITION qu'on montre. */
const EXTRAIT_MAX = 1600
const SORTIE_MAX = 1200
/** Au plus deux exemples servis : au-delà, le contexte coûte plus qu'il ne rend. */
const EXEMPLES_MAX = 2

/** Mots qui trahissent une ligne d'en-tête de tableau de facture. */
const MOTS_ENTETE = ['designation', 'libelle', 'article', 'quantite', 'qte', 'poids', 'montant', 'prix', 'pu', 'tva', 'unite', 'reference', 'code', 'nombre', 'colis']

/**
 * La SIGNATURE d'une mise en page : sa ligne d'en-tête de colonnes, réduite aux
 * mots qui la caractérisent et triés. Deux factures qui partagent leur signature
 * se lisent de la même façon, même si elles viennent de fournisseurs différents —
 * c'est ce qui permet de servir un exemple utile à un fournisseur jamais vu.
 */
export function signatureEntete(texte: string): string {
  let meilleure = ''
  let meilleurScore = 0
  for (const brute of texte.split('\n').slice(0, 200)) {
    const l = normText(brute)
    if (l.length < 12 || l.length > 200) continue
    const mots = l.split(/\s+/).filter(Boolean)
    const touches = new Set(mots.filter(m => MOTS_ENTETE.includes(m)))
    // Une vraie ligne d'en-tête aligne au moins trois de ces mots ET ne porte
    // presque pas de chiffres — sinon c'est une ligne d'article.
    const chiffres = (l.match(/\d/g) || []).length
    const score = touches.size - (chiffres > 6 ? 2 : 0)
    if (touches.size >= 3 && score > meilleurScore) {
      meilleurScore = score
      meilleure = [...touches].sort().join(' ')
    }
  }
  return meilleure
}

/** Proximité de deux signatures : part des mots communs (indice de Jaccard). */
function proximite(a: string, b: string): number {
  if (!a || !b) return 0
  const A = new Set(a.split(' ').filter(Boolean))
  const B = new Set(b.split(' ').filter(Boolean))
  if (A.size === 0 || B.size === 0) return 0
  let communs = 0
  A.forEach(m => { if (B.has(m)) communs++ })
  return communs / (A.size + B.size - communs)
}

/**
 * Choisit les exemples à servir pour lire CE texte, chez CE fournisseur.
 *
 * L'ordre n'est pas négociable : le même fournisseur d'abord — sa facture
 * précédente est, par construction, la meilleure indication de la suivante —
 * puis les mises en page proches. Un exemple sans rapport n'est jamais servi :
 * mieux vaut aucune consigne d'exemple qu'une consigne trompeuse.
 */
export async function choisirExemples(
  service: ServiceClient,
  clientId: string,
  supplierKey: string,
  texte: string,
): Promise<ExempleFacture[]> {
  // Deux gisements : les exemples de CETTE boucherie (moissonnés sur ses propres
  // factures), et les exemples PARTAGÉS — importés par l'administrateur pour
  // toute la plateforme. Un extrait moissonné porte les prix d'achat de sa
  // boucherie : il n'est jamais servi à une autre ; un extrait partagé a été
  // donné exprès.
  const { data, error } = await service.from('invoice_layouts')
    .select('supplier_key, header_signature, sample_text, sample_output')
    .or(`client_id.eq.${clientId},shared.eq.true`)
    .order('updated_at', { ascending: false })
    .limit(200)
  if (error || !data || data.length === 0) return []

  const signature = signatureEntete(texte)
  const notes = (data as ExempleFacture[]).map(e => ({
    e,
    note: (e.supplier_key === supplierKey ? 10 : 0) + proximite(signature, e.header_signature),
  }))
  return notes
    // 0,34 de recouvrement = un tiers des mots d'en-tête en commun. En dessous,
    // l'exemple parle d'une autre mise en page : on préfère n'en servir aucun.
    .filter(x => x.note >= 10 || x.note >= 0.34)
    .sort((a, b) => b.note - a.note)
    .slice(0, EXEMPLES_MAX)
    .map(x => x.e)
}

/** Met les exemples au format du prompt. Vide si aucun : la consigne ne doit
 *  jamais annoncer un exemple qui n'existe pas. */
export function consigneExemples(exemples: ExempleFacture[]): string {
  if (exemples.length === 0) return ''
  const blocs = exemples.map((e, i) => `--- EXEMPLE ${i + 1} — extrait d'une facture de mise en page comparable :
${e.sample_text}
--- Lecture CORRECTE de cet extrait (sa somme tombe au centime sur le total de la facture) :
${e.sample_output}`).join('\n\n')
  return `Voici ${exemples.length === 1 ? 'un exemple VÉRIFIÉ' : 'des exemples VÉRIFIÉS'} de facture${exemples.length > 1 ? 's' : ''} déjà lue${exemples.length > 1 ? 's' : ''} correctement. Sers-t'en pour comprendre où sont les colonnes — PAS pour recopier des montants : les chiffres de la facture à lire sont les siens.

${blocs}

FIN DES EXEMPLES. La facture à lire commence plus bas.

`
}

/**
 * Range une lecture RÉUSSIE dans la bibliothèque.
 *
 * N'accepte qu'une lecture dont la somme tombe au centime sur le total : c'est
 * la seule barrière, et elle suffit, parce que le total ne vient pas de nous.
 * Une facture d'une seule ligne n'apprend rien d'une mise en page — on l'écarte.
 * Erreurs avalées : la bibliothèque est un bonus, jamais un point de panne du
 * chemin de lecture.
 */
export async function rangerExemple(
  service: ServiceClient,
  params: {
    clientId: string
    supplierKey: string
    /** Facture d'origine — null pour un exemple importé, qui n'en a pas. */
    invoiceId: string | null
    texte: string
    lignes: { designation: string; article_code: string | null; quantity: number | null; unit: string | null; unit_price_ht: number | null; amount_ht: number; tva_rate: number | null; weight_kg: number | null }[]
    totalHT: number
    promptVersion: string
    /** Vrai pour un exemple DONNÉ à la plateforme (import administrateur) :
     *  servi à toutes les boucheries. Absent = moissonné, propre à la fiche.
     *  Sur un exemple existant, l'absence NE retire PAS le partage : l'upsert
     *  n'écrit que les colonnes fournies. */
    shared?: boolean
  },
): Promise<void> {
  const { lignes, totalHT } = params
  if (lignes.length < 2 || totalHT === 0) return
  const somme = lignes.reduce((s, l) => s + l.amount_ht, 0)
  if (Math.abs(somme - totalHT) > 0.02) return

  const n = (v: number | null) => (v === null || v === undefined ? '' : String(v))
  const sortie = lignes
    .map(l => `L|${l.designation}|${l.article_code ?? ''}|${n(l.quantity)}|${l.unit ?? ''}|${n(l.unit_price_ht)}|${l.amount_ht}|${n(l.tva_rate)}|${n(l.weight_kg)}`)
    .join('\n')
    .slice(0, SORTIE_MAX)

  // L'extrait part de la ligne d'en-tête quand on la retrouve : c'est la partie
  // du document qui porte l'information de disposition.
  const signature = signatureEntete(params.texte)
  let debut = 0
  if (signature) {
    const mots = signature.split(' ')
    const lignesTexte = params.texte.split('\n')
    let curseur = 0
    for (const l of lignesTexte) {
      const nl = normText(l)
      if (mots.filter(m => nl.includes(m)).length >= 3) { debut = Math.max(0, curseur - 80); break }
      curseur += l.length + 1
    }
  }

  try {
    await service.from('invoice_layouts').upsert({
      client_id: params.clientId,
      supplier_key: params.supplierKey,
      header_signature: signature,
      sample_text: params.texte.slice(debut, debut + EXTRAIT_MAX),
      sample_output: sortie,
      source_invoice_id: params.invoiceId,
      lines_count: lignes.length,
      total_ht: totalHT,
      prompt_version: params.promptVersion,
      updated_at: new Date().toISOString(),
      ...(params.shared === true ? { shared: true } : {}),
    }, { onConflict: 'client_id,supplier_key,header_signature' })
  } catch (e) {
    console.error('[invoice-layouts] rangement impossible:', e instanceof Error ? e.message : e)
  }
}
