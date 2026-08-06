// lib/reparation-lecture.ts — RÉPARER UNE LECTURE QUI NE BOUCLE PAS, TOUT SEUL.
//
// Module PUR, testable hors ligne. Aucune IA, aucun accès base, aucune saisie
// humaine. Le total est connu ; les montants du document sont sur la page ;
// l'écart est un nombre. C'est un problème d'arithmétique, pas de jugement.
//
// ─── POURQUOI DÉTERMINISTE ET PAS UNE PASSE DE PLUS DU MODÈLE ─────────────
//
// Redemander au modèle, c'est espérer qu'il tombe juste cette fois-ci : on l'a
// déjà fait deux fois avant d'arriver ici, et la lecture image en dernier
// recours. Une troisième supplication ne change pas la nature du problème.
//
// Alors qu'à ce stade on sait exactement ce qui cloche : il manque (ou il y a
// en trop) une somme PRÉCISE. Le document porte tous ses montants en clair. On
// cherche donc, dans le texte, ce qui explique l'écart — et le total tranche.
// « Arbitré par l'arithmétique, jamais par une seconde IA », comme le
// processeur de secours des factures.
//
// ─── LES QUATRE RÉPARATIONS, PAR ORDRE DE COÛT ────────────────────────────
//
//  1. UNE LIGNE OUBLIÉE (coût 1) — un montant du document, absent des lignes
//     lues, vaut exactement l'écart manquant. C'est le cas le plus fréquent :
//     une ligne de bas de page, une ligne à cheval sur deux pages.
//  2. UNE LIGNE COMPTÉE DEUX FOIS (coût 1) — l'écart en trop vaut exactement
//     un montant présent en double dans les lignes lues. Le cas DAT-SCHAUB
//     (plusieurs factures dans un même PDF) et celui d'un bloc réimprimé.
//  3. UN MONTANT MAL DÉCOUPÉ (coût 1) — remplacer le montant d'UNE ligne lue
//     par un montant du document fait boucler. La colonne a été lue de travers.
//  4. DEUX LIGNES OUBLIÉES (coût 2) — la somme de deux montants du document,
//     tous deux absents des lignes lues, vaut l'écart. On s'arrête à DEUX :
//     au-delà, la combinatoire trouve à peu près n'importe quelle somme, et
//     une réparation qui trouve toujours une solution n'en est plus une.
//
// ─── CE QU'ON NE FAIT PAS ─────────────────────────────────────────────────
//
// On ne fabrique JAMAIS un montant qui n'est pas écrit sur le document. Toute
// ligne ajoutée porte un montant lu dans le texte, et la désignation de la
// ligne de texte qui le porte. Inventer un montant pour faire tomber le compte,
// c'est exactement l'exemple faux qu'on cherche à ne jamais ranger.
//
// ─── L'AMBIGUÏTÉ ──────────────────────────────────────────────────────────
//
// Plusieurs réparations peuvent boucler. La règle, choisie par le client : LA
// PLUS SIMPLE gagne — celle qui touche le moins de lignes. Une ligne ajoutée
// passe avant trois.
//
// Mais quand deux réparations DIFFÉRENTES ont le MÊME coût, « la plus simple »
// ne désigne plus rien : il n'y a pas de plus simple, il y a deux candidates et
// aucune raison de préférer l'une. On refuse alors, en le disant. Ce n'est pas
// contourner la règle, c'est constater qu'elle ne tranche pas.

export type LigneLecture = {
  designation: string
  article_code: string | null
  quantity: number | null
  unit: string | null
  unit_price_ht: number | null
  amount_ht: number
  tva_rate: number | null
  weight_kg: number | null
}

/** Un montant trouvé dans le texte, avec la ligne qui le portait. */
export type MontantTexte = {
  valeur: number
  /** La ligne du document, pour donner une désignation à une ligne ajoutée */
  ligne: string
}

export type Reparation = {
  /** Ce qu'on a fait, en un mot — repris tel quel dans le motif affiché */
  nature: 'ligne_oubliee' | 'doublon_retire' | 'montant_corrige' | 'lignes_oubliees'
  /** Nombre de lignes touchées : c'est le COÛT qui départage */
  cout: number
  lignes: LigneLecture[]
  /** La phrase qui dit ce qui a été fait, en français */
  detail: string
}

export type Verdict =
  | { repare: true; reparation: Reparation }
  | { repare: false; motif: string; candidates: number }

/** Tolérance de bouclage — la même que partout ailleurs dans la chaîne. */
export const TOL_EUR = 0.02

/** Montant maximal qu'on accepte de recoller : au-delà, ce n'est plus une
 *  ligne oubliée, c'est une lecture ratée qu'il faut regarder. */
export const REPARATION_MAX_EUR = 100000

const r2 = (n: number) => Math.round(n * 100) / 100

export function somme(lignes: LigneLecture[]): number {
  return r2(lignes.reduce((s, l) => s + (Number(l.amount_ht) || 0), 0))
}

/**
 * Tous les montants écrits dans le texte, avec leur ligne d'origine.
 *
 * On ne retient que les nombres à DEUX DÉCIMALES : un montant de facture en
 * porte toujours deux, une quantité ou un poids rarement. Sans cette borne, le
 * « 12,5 » d'une colonne de poids deviendrait un candidat de ligne oubliée, et
 * on rangerait un exemple qui apprend à lire un poids comme un montant.
 */
export function montantsDuTexte(texte: string): MontantTexte[] {
  const out: MontantTexte[] = []
  const vus = new Set<string>()
  const ajouter = (valeur: number, ligne: string) => {
    if (!Number.isFinite(valeur) || valeur <= 0) return
    const v = r2(valeur)
    const cle = `${v.toFixed(2)}|${ligne}`
    if (vus.has(cle)) return
    vus.add(cle)
    out.push({ valeur: v, ligne })
  }

  for (const brute of String(texte).split('\n')) {
    const ligne = brute.trim()
    if (!ligne) continue

    // DEUX LECTURES D'UN « 12 111,25 », ET ON NE TRANCHE PAS ICI.
    //
    // Sur « BOYAU MOUTON 24/26 12 111,25 », l'espace sépare une quantité d'un
    // montant : 111,25 €. Sur « CARTE 12 111,25 », il sépare les milliers :
    // 12 111,25 €. Rien dans la ligne ne le dit — c'est exactement l'ambiguïté
    // compteur/montant du relevé financier, sous un autre visage.
    //
    // On produit donc les DEUX candidats, et c'est le TOTAL qui tranchera :
    // une seule des deux lectures fera boucler la facture. Choisir ici serait
    // deviner ; proposer les deux, c'est laisser l'arithmétique décider.
    //
    // (`\s` couvre l'espace insécable, séparateur de milliers habituel d'un PDF
    // français : l'écrire en clair dans la classe serait redondant et fragile.)
    for (const m of ligne.matchAll(/(?<![\d.,])(\d{1,3}(?:\s\d{3})+)[.,](\d{2})(?![\d.,])/g)) {
      ajouter(parseFloat(`${m[1].replace(/\s/g, '')}.${m[2]}`), ligne)
    }
    for (const m of ligne.matchAll(/(?<![\d.,])(\d+)[.,](\d{2})(?![\d.,])/g)) {
      ajouter(parseFloat(`${m[1]}.${m[2]}`), ligne)
    }
  }
  return out
}

/** La désignation qu'on donne à une ligne récupérée : le début de sa ligne de
 *  texte, débarrassé des nombres. Jamais un libellé inventé — si le texte n'en
 *  porte pas, la ligne n'est pas récupérable, et on le dit plutôt que de ranger
 *  « Ligne 4 » comme désignation. */
export function designationDeLaLigne(ligne: string): string | null {
  const mots = ligne
    .replace(/[\d.,€%]+/g, ' ')
    // Ce que les nombres laissent derrière eux : le « / » de « 24/26 », les
    // tirets de séparation, les deux-points d'un libellé. Sans ce nettoyage une
    // désignation ressort en « BOYAU MOUTON / » — un libellé qu'on rangerait
    // dans la bibliothèque et que la production réapprendrait tel quel.
    .replace(/[/\\|:;·—–-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (mots.length < 3) return null
  return mots.slice(0, 120)
}

function ligneDepuisMontant(m: MontantTexte): LigneLecture | null {
  const designation = designationDeLaLigne(m.ligne)
  if (!designation) return null
  return {
    designation,
    article_code: null,
    quantity: null,
    unit: null,
    unit_price_ht: null,
    amount_ht: m.valeur,
    tva_rate: null,
    weight_kg: null,
  }
}

/** Deux réparations sont-elles la même ? On compare les montants finaux, qui
 *  sont ce qui compte pour l'exemple rangé. */
function memeResultat(a: Reparation, b: Reparation): boolean {
  const cle = (r: Reparation) => r.lignes.map(l => l.amount_ht.toFixed(2)).sort().join('|')
  return cle(a) === cle(b)
}

/**
 * LE RÉPARATEUR. Rend la lecture corrigée, ou dit pourquoi il ne peut pas.
 *
 * `lignes` est la lecture telle qu'elle est sortie de la chaîne, `texte` le
 * document, `total` l'arbitre.
 */
export function reparer(lignes: LigneLecture[], texte: string, total: number): Verdict {
  if (!(total > 0)) return { repare: false, motif: 'aucun total : rien à arbitrer', candidates: 0 }

  const depart = somme(lignes)
  const ecart = r2(depart - total)
  if (Math.abs(ecart) <= TOL_EUR) {
    return { repare: false, motif: 'la lecture bouclait déjà', candidates: 0 }
  }
  if (Math.abs(ecart) > REPARATION_MAX_EUR) {
    return { repare: false, motif: `écart de ${Math.abs(ecart).toFixed(2)} € : trop large pour une ligne oubliée`, candidates: 0 }
  }

  const montants = montantsDuTexte(texte)
  const dejaLus = new Map<string, number>()
  for (const l of lignes) {
    const k = (Number(l.amount_ht) || 0).toFixed(2)
    dejaLus.set(k, (dejaLus.get(k) ?? 0) + 1)
  }
  /** Combien de fois ce montant est déjà dans les lignes lues. */
  const compteLu = (v: number) => dejaLus.get(v.toFixed(2)) ?? 0

  const candidates: Reparation[] = []
  const manque = ecart < 0            // il manque de l'argent : une ligne oubliée
  const cible = r2(Math.abs(ecart))

  // ── 1. UNE LIGNE OUBLIÉE ────────────────────────────────────────────────
  if (manque) {
    const vus = new Set<string>()
    for (const m of montants) {
      if (Math.abs(m.valeur - cible) > TOL_EUR) continue
      // Le montant doit être ABSENT des lignes lues, sinon on ajouterait un
      // doublon de ce qui est déjà compté.
      if (compteLu(m.valeur) > 0) continue
      const cle = `${m.valeur.toFixed(2)}|${m.ligne}`
      if (vus.has(cle)) continue
      vus.add(cle)
      const ajout = ligneDepuisMontant(m)
      if (!ajout) continue
      candidates.push({
        nature: 'ligne_oubliee',
        cout: 1,
        lignes: [...lignes, ajout],
        detail: `ligne oubliée récupérée dans le document : « ${ajout.designation} » pour ${ajout.amount_ht.toFixed(2)} €`,
      })
    }
  }

  // ── 2. UNE LIGNE COMPTÉE DEUX FOIS ──────────────────────────────────────
  if (!manque) {
    const vus = new Set<string>()
    for (let i = 0; i < lignes.length; i++) {
      const v = Number(lignes[i].amount_ht) || 0
      if (Math.abs(v - cible) > TOL_EUR) continue
      if (compteLu(v) < 2) continue          // retirer une ligne UNIQUE serait perdre une vraie ligne
      const cle = v.toFixed(2)
      if (vus.has(cle)) continue
      vus.add(cle)
      candidates.push({
        nature: 'doublon_retire',
        cout: 1,
        lignes: lignes.filter((_, j) => j !== i),
        detail: `ligne comptée deux fois retirée : « ${lignes[i].designation} » pour ${v.toFixed(2)} €`,
      })
    }
  }

  // ── 3. UN MONTANT MAL DÉCOUPÉ ───────────────────────────────────────────
  // Remplacer le montant d'UNE ligne par un montant écrit sur le document.
  {
    const vus = new Set<string>()
    for (let i = 0; i < lignes.length; i++) {
      const v = Number(lignes[i].amount_ht) || 0
      const voulu = r2(v - ecart)            // ce que cette ligne devrait valoir
      if (voulu <= 0) continue
      const trouve = montants.find(m => Math.abs(m.valeur - voulu) <= TOL_EUR)
      if (!trouve) continue                   // le bon montant doit être ÉCRIT quelque part
      const cle = `${i}|${voulu.toFixed(2)}`
      if (vus.has(cle)) continue
      vus.add(cle)
      candidates.push({
        nature: 'montant_corrige',
        cout: 1,
        lignes: lignes.map((l, j) => j === i ? { ...l, amount_ht: r2(trouve.valeur) } : l),
        detail: `montant repris sur le document : « ${lignes[i].designation} » passe de ${v.toFixed(2)} € à ${trouve.valeur.toFixed(2)} €`,
      })
    }
  }

  // ── 4. DEUX LIGNES OUBLIÉES ─────────────────────────────────────────────
  // Cherché seulement si rien de moins cher n'a marché : c'est le plus lent et
  // le plus permissif, donc le dernier servi. Et on s'arrête à deux — avec
  // trois montants libres, une combinaison finit toujours par tomber juste.
  if (manque && candidates.length === 0) {
    const libres = montants.filter(m => compteLu(m.valeur) === 0 && ligneDepuisMontant(m) !== null)
    // Borne dure : au-delà, la combinatoire explose et le résultat n'a plus de
    // sens (on finirait par trouver n'importe quelle somme).
    const MAX = 60
    const pool = libres.slice(0, MAX)
    for (let i = 0; i < pool.length && candidates.length === 0; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        if (Math.abs(pool[i].valeur + pool[j].valeur - cible) > TOL_EUR) continue
        const a = ligneDepuisMontant(pool[i])!
        const b = ligneDepuisMontant(pool[j])!
        candidates.push({
          nature: 'lignes_oubliees',
          cout: 2,
          lignes: [...lignes, a, b],
          detail: `deux lignes oubliées récupérées : « ${a.designation} » (${a.amount_ht.toFixed(2)} €) et « ${b.designation} » (${b.amount_ht.toFixed(2)} €)`,
        })
      }
    }
  }

  // ── LE VERDICT ──────────────────────────────────────────────────────────
  // Toute candidate doit VRAIMENT boucler : on ne se fie pas au raisonnement
  // qui l'a produite, on recompte.
  const valides = candidates.filter(c => Math.abs(somme(c.lignes) - total) <= TOL_EUR)
  if (valides.length === 0) {
    return {
      repare: false,
      motif: manque
        ? `il manque ${cible.toFixed(2)} € et aucun montant du document n’explique cet écart`
        : `il y a ${cible.toFixed(2)} € en trop et aucune ligne en double n’explique cet écart`,
      candidates: 0,
    }
  }

  valides.sort((a, b) => a.cout - b.cout)
  const meilleure = valides[0]
  // LA PLUS SIMPLE GAGNE. Mais si deux réparations de MÊME coût aboutissent à
  // des lignes différentes, « la plus simple » ne désigne plus rien : il n'y a
  // pas de raison de préférer l'une, et en choisir une au hasard rangerait
  // peut-être un exemple faux dans une bibliothèque partagée.
  const exAequo = valides.filter(c => c.cout === meilleure.cout && !memeResultat(c, meilleure))
  if (exAequo.length > 0) {
    return {
      repare: false,
      motif: `${exAequo.length + 1} réparations différentes bouclent aussi bien l’une que l’autre : impossible de savoir laquelle est vraie`,
      candidates: valides.length,
    }
  }

  return { repare: true, reparation: meilleure }
}
