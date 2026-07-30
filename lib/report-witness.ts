// lib/report-witness.ts — TÉMOIN DÉTERMINISTE de l'extraction (contre-lecture nº1).
// Module PUR : aucune IA. Il relit le TEXTE BRUT des fichiers Crisalid pour
// confirmer, sans partager les erreurs de l'extraction IA, deux invariants
// structurels que le format rend lisibles de façon fiable :
//
//   1. la LISTE des familles extraites correspond aux en-têtes « N - NOM » du
//      fichier — aucune famille inventée ni oubliée ;
//   2. le CA de référence (celui du relevé financier) apparaît bien comme total
//      dans le fichier de ventes — les deux fichiers parlent de la même semaine
//      et du même chiffre.
//
// Ce qu'il ne prétend PAS faire : re-sommer les montants produit. pdf-parse
// aplatit les colonnes (« 1600FAB MERGUEZ28.565201.38 € ») et colle quantité et
// montant sans séparateur — leur découpe est ambiguë, un parseur qui prétendrait
// la faire serait faux (mesuré : une somme naïve donne 23 M€). La vérification
// FINE des montants par famille est donc confiée à la contre-lecture IA
// (report-verify), pas à une regex qui ferait semblant.

import { normText } from '@/lib/postes'
import type { CheckResult } from '@/lib/report-checks'

/** Noms de familles lus dans le texte via les en-têtes « N - NOM » (ex
 *  « 6 - CHARCUTERIE »). Dédupliqués (le format répète l'en-tête en pied de
 *  section). Renvoie les libellés d'origine ET leur forme normalisée. */
export function extractFamilyNames(text: string): { labels: string[]; keys: Set<string> } {
  const labels: string[] = []
  const keys = new Set<string>()
  for (const raw of String(text || '').split('\n')) {
    const m = raw.match(/^\s*\d+\s*-\s*(.+?)\s*$/)
    if (!m) continue
    const label = m[1].trim()
    // Un en-tête de famille commence par une lettre (écarte « 28.194... »).
    if (!/^[A-Za-zÀ-ÿ]/.test(label)) continue
    const k = normText(label)
    if (k && !keys.has(k)) { keys.add(k); labels.push(label) }
  }
  return { labels, keys }
}

/** Le montant `ca` (ex 16203.76) apparaît-il, tel quel, dans le texte ? Sert à
 *  confirmer que le fichier de ventes porte le même total que le relevé
 *  financier. On teste le point ET la virgule décimale (selon l'export). */
export function amountPresent(text: string, ca: number): boolean {
  if (!(ca > 0)) return false
  const t = String(text || '')
  const point = ca.toFixed(2)
  const virgule = point.replace('.', ',')
  return t.includes(point) || t.includes(virgule)
}

/** Contrôles TÉMOIN (déterministes) ajoutés à ceux du lot V2. */
export function runWitnessChecks(
  textVentesN: string,
  textVentesN1: string,
  serialized: {
    ventes_n: { familles: { nom: string }[] }
    ventes_n1: { familles: { nom: string }[] }
    financier_n: { ca_net: number }
    financier_n1: { ca_net: number }
  },
): CheckResult[] {
  const checks: CheckResult[] = []

  const integrite = (
    code: string, label: string, text: string, familles: { nom: string }[],
  ): CheckResult => {
    const witness = extractFamilyNames(text)
    if (witness.keys.size === 0) {
      return { code, label, severite: 'info', passe: true, details: 'Format de familles non reconnu dans le texte — contrôle témoin sans objet.' }
    }
    const extraites = new Set(familles.map(f => normText(f.nom)).filter(Boolean))
    const oubliees = [...witness.keys].filter(k => !extraites.has(k))
    const inventees = [...extraites].filter(k => !witness.keys.has(k))
    const passe = oubliees.length === 0 && inventees.length === 0
    const parts: string[] = []
    if (oubliees.length) parts.push(`${oubliees.length} famille(s) présente(s) dans le fichier mais absente(s) de l'extraction`)
    if (inventees.length) parts.push(`${inventees.length} famille(s) extraite(s) qui n'existe(nt) pas dans le fichier`)
    return {
      code, label, severite: 'validation', passe,
      details: passe
        ? `Les ${witness.keys.size} familles du fichier sont toutes extraites, aucune en trop.`
        : parts.join(' ; ') + '.',
    }
  }

  checks.push(integrite('temoin_familles_n', 'Familles N conformes au fichier (témoin)', textVentesN, serialized.ventes_n.familles))
  checks.push(integrite('temoin_familles_n1', 'Familles N-1 conformes au fichier (témoin)', textVentesN1, serialized.ventes_n1.familles))

  const concordance = (
    code: string, label: string, text: string, ca: number,
  ): CheckResult => {
    if (!(ca > 0)) return { code, label, severite: 'info', passe: true, details: 'Pas de CA de référence — contrôle sans objet.' }
    const present = amountPresent(text, ca)
    return {
      code, label, severite: 'validation', passe: present,
      details: present
        ? `Le CA du relevé financier (${ca.toFixed(2)} €) figure aussi dans le fichier de ventes — les deux fichiers concordent.`
        : `Le CA du relevé financier (${ca.toFixed(2)} €) n'apparaît nulle part dans le fichier de ventes — fichiers de semaines différentes, ou total mal lu.`,
    }
  }

  checks.push(concordance('temoin_ca_n', 'Le fichier de ventes N porte le CA financier (témoin)', textVentesN, serialized.financier_n.ca_net))
  checks.push(concordance('temoin_ca_n1', 'Le fichier de ventes N-1 porte le CA financier (témoin)', textVentesN1, serialized.financier_n1.ca_net))

  return checks
}
