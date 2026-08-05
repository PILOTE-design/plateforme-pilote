/**
 * CE DOCUMENT EST-IL UN RELEVÉ, ET NON UNE FACTURE ?
 *
 * Module PUR, testable hors ligne.
 *
 * ─── POURQUOI ÇA COMPTE ───────────────────────────────────────────────────
 *
 * Un relevé de compte, un relevé de factures, un échéancier ou un
 * récapitulatif mensuel ne facture RIEN : il rappelle ce qui a déjà été
 * facturé ailleurs. Importé comme une facture, il fait trois dégâts, dans
 * cet ordre de gravité :
 *
 *  1. IL COMPTE L'ARGENT DEUX FOIS. Son montant est la somme de factures
 *     déjà importées. Les achats de la semaine, la marge, le résultat net et
 *     le rapport PDF s'en trouvent tous faussés — du montant du relevé.
 *  2. IL FAUSSE LES PRIX. Un relevé aligne des numéros de facture et des
 *     totaux, pas des articles. La lecture y voit des lignes, en tire des
 *     prix unitaires qui n'en sont pas, et les publie dans la mercuriale.
 *  3. IL COÛTE DE L'ARGENT À CHAQUE LECTURE. Chaque document passe par le
 *     modèle, parfois trois fois (texte, reprise, image). Un relevé
 *     mensuel, c'est une lecture payée tous les mois pour un document dont
 *     on ne veut rien.
 *
 * ─── CE QU'ON A POUR JUGER, ET QUAND ──────────────────────────────────────
 *
 * Au moment de l'import Pennylane, le PDF n'est pas encore lu : on n'a que
 * les métadonnées de l'API — nom du fournisseur, LIBELLÉ du document, numéro
 * de pièce. C'est peu, mais c'est là que le libellé dit le plus souvent ce
 * qu'est le document (« Relevé de factures », « Échéancier », « Situation de
 * compte »).
 *
 * Sur la voie e-mail, le texte du PDF est disponible AVANT l'insertion : on
 * regarde alors aussi les premières lignes du document, là où un émetteur
 * écrit le type de pièce.
 *
 * ─── LA RÈGLE DE PRUDENCE ─────────────────────────────────────────────────
 *
 * On ne cherche le type de document QUE dans le libellé et le texte, JAMAIS
 * dans le nom du fournisseur seul. Un fournisseur peut s'appeler « RELEVÉ
 * SARL » ; refuser toutes ses factures serait pire que le mal — une facture
 * manquante est invisible, alors qu'un relevé importé se voit dans les
 * chiffres.
 *
 * Et les expressions retenues sont des TYPES DE PIÈCE entiers, ancrés sur des
 * limites de mots. « Facture n° 12 — relevé de nos livraisons » n'est pas
 * écarté : « relevé de » y qualifie des livraisons, pas la pièce. On préfère
 * laisser passer un relevé qu'écarter une facture.
 */

/** Ce qui, dans un libellé, nomme un document RÉCAPITULATIF et non une pièce
 *  facturée. Les accents sont retirés avant comparaison : les libellés
 *  d'origine mélangent « RELEVE », « Relevé » et « RELEVÉ ». */
const EXPRESSIONS: Array<{ motif: RegExp; nom: string }> = [
  { motif: /\breleve\s+de\s+(compte|factures?|situation)\b/, nom: 'relevé de compte' },
  { motif: /\breleve\s+(mensuel|hebdomadaire|periodique|client|fournisseur)\b/, nom: 'relevé périodique' },
  { motif: /\breleve\s+n[°o]?\s*\d/, nom: 'relevé numéroté' },
  { motif: /\b(extrait|situation)\s+de\s+compte\b/, nom: 'situation de compte' },
  { motif: /\becheancier\b/, nom: 'échéancier' },
  // L'apostrophe arrive dans les trois graphies : droite, typographique, ou
  // remplacée par une espace. `sansAccents` ne la normalise pas.
  { motif: /\bavis\s+d['’ʼ ]?echeance\b/, nom: 'avis d’échéance' },
  { motif: /\bbordereau\s+recapitulatif\b/, nom: 'bordereau récapitulatif' },
  { motif: /\brecapitulatif\s+(mensuel|des\s+factures|de\s+factures|hebdomadaire|periodique)\b/, nom: 'récapitulatif' },
  { motif: /\bdecompte\s+(mensuel|des\s+factures|de\s+factures)\b/, nom: 'décompte' },
  { motif: /\b(account|monthly)\s+statement\b/, nom: 'statement' },
  { motif: /\bstatement\s+of\s+account\b/, nom: 'statement of account' },
]

/** Un libellé qui n'est QUE le mot « relevé », éventuellement daté. C'est le
 *  cas le plus fréquent et le moins ambigu : personne n'intitule une facture
 *  « Relevé ». Traité à part pour ne pas avoir à attraper « relevé » seul au
 *  milieu d'une phrase, où il veut souvent dire autre chose. */
const LIBELLE_RELEVE_SEUL = /^\s*releve(s)?\b[\s\-–—:]*(du|de|au|mensuel|periode)?[\s\d\/.:-]*$/

/** Retire les accents et met en minuscules — les libellés arrivent dans
 *  toutes les casses et toutes les orthographes. */
export function sansAccents(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export type VerdictReleve = {
  /** Vrai : ce document n'est pas une facture d'achat, il ne doit pas entrer. */
  releve: boolean
  /** Le type reconnu, en français, pour l'écrire au boucher. null sinon. */
  motif: string | null
  /** Ce qui a déclenché la reconnaissance — libellé ou texte du document. */
  ou: 'libelle' | 'texte' | null
}

const RIEN: VerdictReleve = { releve: false, motif: null, ou: null }

function chercher(texte: string): { motif: string } | null {
  const t = sansAccents(texte)
  if (!t) return null
  if (LIBELLE_RELEVE_SEUL.test(t)) return { motif: 'relevé' }
  for (const e of EXPRESSIONS) if (e.motif.test(t)) return { motif: e.nom }
  return null
}

/**
 * Le verdict sur un document, AVANT son insertion.
 *
 * `libelle` : le libellé du document tel que la plateforme comptable le
 * donne (Pennylane : `label`). C'est le témoin principal.
 *
 * `texte` : les premières lignes du PDF, quand on les a déjà (voie e-mail).
 * Seul le DÉBUT est regardé — un relevé s'annonce dans son en-tête, alors
 * qu'une facture ordinaire peut très bien citer « relevé » au milieu de ses
 * conditions de règlement.
 */
export function verdictReleve(args: {
  libelle?: string | null
  texte?: string | null
}): VerdictReleve {
  const parLibelle = chercher(args.libelle ?? '')
  if (parLibelle) return { releve: true, motif: parLibelle.motif, ou: 'libelle' }

  const texte = String(args.texte ?? '')
  if (texte) {
    // L'en-tête seulement : 400 caractères, soit largement le bloc de titre.
    const parTexte = chercher(texte.slice(0, 400))
    if (parTexte) return { releve: true, motif: parTexte.motif, ou: 'texte' }
  }
  return RIEN
}

/** La phrase à écrire au boucher, en français. Elle vit ici pour être la même
 *  dans le bilan de synchronisation et dans le journal d'import e-mail. */
export function phraseReleve(v: VerdictReleve, supplier?: string | null): string {
  const qui = supplier ? ` de ${String(supplier).trim()}` : ''
  return `Document${qui} reconnu comme un ${v.motif ?? 'relevé'} : non importé.`
    + ` Un relevé récapitule des factures déjà comptées — l'importer les compterait deux fois`
    + ` et ses lignes ne portent pas de vrais prix.`
}
