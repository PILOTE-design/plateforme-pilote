// report-verify.ts — CONTRE-LECTURE IA (contre-lecture nº2).
//
// Une deuxième passe qui NE PARTAGE PAS les erreurs de la première. Là où
// l'extraction lit tout le fichier et en tire des montants, le vérificateur
// reçoit le texte brut ET les totaux déjà extraits, et n'a qu'UNE tâche :
// retrouver le total de chaque famille dans le texte et dire s'il correspond.
// Un prompt focalisé « vérifie, ne ré-extrais pas » attrape ce que la première
// lecture a manqué — par exemple un code article (PLU) pris pour un montant.
//
// L'IA est utilisée ici précisément pour ce que la regex ne sait pas faire :
// désambiguïser le collage quantité/montant du texte pdf-parse.
//
// Best-effort et borné : un échec, un timeout ou une clé absente ne bloquent
// jamais — la contre-lecture rend alors un contrôle « info » neutre. Elle ne
// REMPLACE pas les contrôles déterministes (V2) et le témoin (V4), elle s'ajoute.

import Anthropic from '@anthropic-ai/sdk'
import type { CheckResult } from '@/lib/report-checks'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'MISSING_ANTHROPIC_KEY' })

/** Écart, par famille, entre le montant extrait et le montant relu. */
export type VerifyDivergence = { nom: string; extrait: number; relu: number; ecart: number }

function parseNum(s: string): number {
  const n = parseFloat(String(s ?? '').trim().replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

/**
 * Contre-lit les totaux de famille d'un fichier de ventes. Renvoie UN
 * CheckResult (sévérité « validation ») listant les divergences trouvées, prêt
 * à rejoindre les autres contrôles. Ne lève jamais.
 */
export async function verifyFamiliesCheck(
  rawVentes: string,
  familles: { nom: string; montant: number }[],
  caCaisse: number,
  code = 'contre_lecture_familles_n',
  label = 'Contre-lecture indépendante des familles N',
): Promise<CheckResult> {
  if (!rawVentes || familles.length === 0) {
    return { code, label, severite: 'info', passe: true, details: 'Rien à contre-lire.' }
  }
  const liste = familles.map(f => `${f.nom}|${f.montant.toFixed(2)}`).join('\n')
  const prompt = `Tu VÉRIFIES une extraction déjà faite, tu ne la refais pas. Voici le texte brut d'un fichier de ventes de boucherie (logiciel de caisse), puis les totaux par famille qu'un premier système en a tirés.

Pour CHAQUE famille de la liste, retrouve son TOTAL DE SECTION dans le texte (le montant total des ventes de la famille, en euros) et compare-le au montant fourni. Attention aux pièges du texte : un code article (PLU, souvent 3-4 chiffres) collé au libellé ou au montant NE DOIT JAMAIS être pris pour un montant ; la quantité de ventes n'est pas le montant ; le montant a deux décimales.

Total encaissé de la semaine (référence) : ${caCaisse.toFixed(2)} EUR — aucun total de famille ne peut le dépasser.

Réponds UNIQUEMENT par des lignes, une par famille en écart (ignore les familles correctes) :
ECART|NOM DE LA FAMILLE|MONTANT_CORRECT
Si tout est correct, réponds exactement : OK

=== TOTAUX EXTRAITS ===
${liste}

=== TEXTE DU FICHIER ===
${rawVentes.slice(0, 12000)}`

  try {
    const r = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 700,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = r.content[0]?.type === 'text' ? r.content[0].text : ''
    const montantByNom = new Map(familles.map(f => [f.nom.trim().toUpperCase(), f.montant]))
    const divergences: VerifyDivergence[] = []
    for (const line of text.split('\n')) {
      const t = line.trim()
      if (!t.toUpperCase().startsWith('ECART|')) continue
      const parts = t.split('|')
      if (parts.length < 3) continue
      const nom = parts[1].trim()
      const relu = parseNum(parts[2])
      if (!Number.isFinite(relu)) continue
      const extrait = montantByNom.get(nom.toUpperCase())
      if (extrait === undefined) continue
      if (Math.abs(relu - extrait) > 0.5) divergences.push({ nom, extrait, relu, ecart: +(relu - extrait).toFixed(2) })
    }
    if (divergences.length === 0) {
      return { code, label, severite: 'validation', passe: true, details: 'La contre-lecture confirme tous les totaux de famille.' }
    }
    const detail = divergences
      .map(d => `${d.nom} : extrait ${d.extrait.toFixed(2)} €, relu ${d.relu.toFixed(2)} € (corriger de ${d.ecart >= 0 ? '+' : ''}${d.ecart.toFixed(2)} €)`)
      .join(' ; ')
    return { code, label, severite: 'validation', passe: false, details: `Contre-lecture en désaccord — ${detail}.` }
  } catch (e) {
    console.error('[verify] contre-lecture indisponible:', e instanceof Error ? e.message : e)
    return { code, label, severite: 'info', passe: true, details: 'Contre-lecture indépendante indisponible (réessayez) — les contrôles déterministes restent en vigueur.' }
  }
}
