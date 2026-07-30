// lib/extraction-eval.ts — SCORE D'EXACTITUDE de l'extraction (lot V5).
//
// Module PUR : zéro IA, zéro base — testable seul. Il compare deux jeux de
// chiffres et compte, champ par champ, ceux qui coïncident :
//   · ATTENDU = la vérité de référence — une extraction VALIDÉE (confirmée par un
//     humain, corrections appliquées, ou passée tous contrôles au vert) ;
//   · OBTENU  = la ré-extraction du MÊME texte source par l'extracteur courant.
//
// C'est ce qui transforme « 100 % » d'une promesse en une MESURE. Tant que le
// corpus de référence n'existe pas, personne ne peut dire si l'extraction est
// fiable — on ne fait que l'espérer. Avec lui, on le CHIFFRE : rejouer
// l'extracteur sur des cas dont on connaît la bonne réponse, et compter les
// chiffres justes. Un changement de prompt ou de modèle qui fait BAISSER ce taux
// est une régression — à refuser avant d'être livrée, pas à découvrir en prod.

import { normText } from '@/lib/postes'

/** Tolérance par défaut, en euros : deux montants à moins d'un centime l'un de
 *  l'autre sont « justes » (l'extraction et sa relecture n'arrondissent pas
 *  forcément à l'identique). Les comptes entiers (tickets) se comparent à 0. */
export const EPS_EUR = 0.01

export type ChampEcart = {
  /** Libellé lisible du chiffre comparé (ex. « CA net N », « Famille N — CHARCUTERIE »). */
  champ: string
  attendu: number
  /** null = le chiffre attendu n'a PAS été retrouvé dans la ré-extraction (oubli). */
  obtenu: number | null
  /** Écart absolu en valeur ; si obtenu est null, vaut la totalité de l'attendu. */
  ecart: number
  ok: boolean
}

export type CasEval = {
  extraction_id: string
  semaine: number
  annee: number
  /** Nombre de chiffres comparés. */
  total: number
  exacts: number
  /** exacts / total, dans [0, 1]. */
  exactitude: number
  /** Uniquement les champs en écart (les justes ne sont pas listés). */
  divergences: ChampEcart[]
}

export type CorpusEval = {
  cas: number
  total_chiffres: number
  exacts: number
  /** Exactitude agrégée sur TOUS les chiffres du corpus (pas la moyenne des cas :
   *  un cas avec plus de familles pèse plus lourd, ce qui est voulu). */
  exactitude: number
  par_cas: CasEval[]
}

/** Forme minimale comparée — un sur-ensemble StoredExtraction la satisfait
 *  structurellement, donc on peut passer directement une extraction sérialisée. */
export type EvalExtraction = {
  financier_n: { ca_net: number; nb_tickets: number; moyenne_ticket: number }
  financier_n1: { ca_net: number; nb_tickets: number; moyenne_ticket: number }
  ventes_n: { total: number; familles: { nom: string; montant: number }[] }
  ventes_n1: { total: number; familles: { nom: string; montant: number }[] }
}

function champ(nom: string, attendu: number, obtenu: number | null, eps = EPS_EUR): ChampEcart {
  const ok = obtenu !== null && Math.abs(obtenu - attendu) <= eps
  const ecart = obtenu === null ? Math.abs(attendu) : Math.abs(obtenu - attendu)
  return { champ: nom, attendu, obtenu, ecart: +ecart.toFixed(2), ok }
}

function comparerFamilles(
  cote: 'N' | 'N-1',
  attendu: { nom: string; montant: number }[],
  obtenu: { nom: string; montant: number }[],
): ChampEcart[] {
  const out: ChampEcart[] = []
  const obtParNom = new Map(obtenu.map(f => [normText(f.nom), f.montant]))
  const vues = new Set<string>()
  for (const f of attendu) {
    const k = normText(f.nom)
    vues.add(k)
    out.push(champ(`Famille ${cote} — ${f.nom}`, f.montant, obtParNom.has(k) ? obtParNom.get(k)! : null))
  }
  // Familles présentes dans la ré-extraction mais ABSENTES de la référence :
  // un chiffre inventé est une faute au même titre qu'un oubli.
  for (const f of obtenu) {
    const k = normText(f.nom)
    if (!vues.has(k)) {
      out.push({ champ: `Famille ${cote} — ${f.nom} (en trop)`, attendu: 0, obtenu: f.montant, ecart: +Math.abs(f.montant).toFixed(2), ok: false })
    }
  }
  return out
}

/** Compare une extraction de référence à sa ré-extraction et renvoie le détail
 *  chiffre par chiffre + le taux d'exactitude du cas. */
export function compareExtraction(
  extractionId: string, semaine: number, annee: number,
  attendu: EvalExtraction, obtenu: EvalExtraction,
): CasEval {
  const champs: ChampEcart[] = [
    // Les chiffres-rois du rapport : les CA.
    champ('CA net N', attendu.financier_n.ca_net, obtenu.financier_n.ca_net),
    champ('CA net N-1', attendu.financier_n1.ca_net, obtenu.financier_n1.ca_net),
    // Invariants de caisse (tickets exacts, panier au centime).
    champ('Tickets N', attendu.financier_n.nb_tickets, obtenu.financier_n.nb_tickets, 0),
    champ('Panier moyen N', attendu.financier_n.moyenne_ticket, obtenu.financier_n.moyenne_ticket),
    champ('Tickets N-1', attendu.financier_n1.nb_tickets, obtenu.financier_n1.nb_tickets, 0),
    champ('Panier moyen N-1', attendu.financier_n1.moyenne_ticket, obtenu.financier_n1.moyenne_ticket),
    // Total des ventes par familles, chaque côté.
    champ('Total ventes N', attendu.ventes_n.total, obtenu.ventes_n.total),
    champ('Total ventes N-1', attendu.ventes_n1.total, obtenu.ventes_n1.total),
    ...comparerFamilles('N', attendu.ventes_n.familles, obtenu.ventes_n.familles),
    ...comparerFamilles('N-1', attendu.ventes_n1.familles, obtenu.ventes_n1.familles),
  ]
  const exacts = champs.filter(c => c.ok).length
  const total = champs.length
  return {
    extraction_id: extractionId, semaine, annee,
    total, exacts,
    exactitude: total ? exacts / total : 1,
    divergences: champs.filter(c => !c.ok),
  }
}

/** Agrège les cas en un score de corpus. L'exactitude globale est calculée sur
 *  le TOTAL des chiffres (un cas plus riche pèse plus), pas comme une moyenne
 *  des taux par cas. */
export function aggregateCorpus(cas: CasEval[]): CorpusEval {
  const total_chiffres = cas.reduce((s, c) => s + c.total, 0)
  const exacts = cas.reduce((s, c) => s + c.exacts, 0)
  return {
    cas: cas.length,
    total_chiffres,
    exacts,
    exactitude: total_chiffres ? exacts / total_chiffres : 1,
    par_cas: cas,
  }
}
