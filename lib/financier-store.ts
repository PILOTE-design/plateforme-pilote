// lib/financier-store.ts — ÉCRIRE ET RELIRE LES RELEVÉS FINANCIERS.
//
// La lecture d'un relevé est PURE (lib/financier-jour) ; ce module-ci est le
// seul endroit qui la range en base. Deux entrées possibles aujourd'hui — le
// canal e-mail et, demain, un dépôt manuel — pour une seule écriture : une
// deuxième copie de ces règles finirait par diverger de la première.
//
// IDEMPOTENCE. Deux protections, parce que les deux cas arrivent :
//   · le MÊME mail relivré par Resend (rejeu après un 4xx) → `email_id` ;
//   · le MÊME relevé renvoyé à la main par le boucher, dans un autre mail →
//     clé (client, période). Sans elle, le CA du jour doublerait.
// Dans les deux cas on MET À JOUR la ligne existante : le second envoi est
// souvent une correction de caisse, et la version la plus récente doit gagner.

import type { createServiceClient } from '@/lib/supabase/server'
import { verdictEnregistrement, type LectureFinancier } from '@/lib/financier-jour'

type ServiceClient = ReturnType<typeof createServiceClient>

export type SourceFinancier = 'email' | 'manuel' | 'rapport_pdf'

export type EnregistrementFinancier = {
  ok: boolean
  /** Ce qui s'est passé, en clair — repris tel quel dans la réponse du webhook
   *  et dans les journaux. Un import silencieux est pire qu'un refus dit. */
  motif: string
  /** Renseigné quand la ligne a été écrite */
  id?: string
  jourUnique?: boolean
}

/** Range un relevé lu. Ne lève jamais : supabase-js ne lève pas, et un webhook
 *  qui casse fait réessayer Resend en boucle. */
export async function enregistrerFinancier(
  supabase: ServiceClient,
  clientId: string,
  lecture: LectureFinancier,
  options: { source: SourceFinancier; filePath?: string | null; emailId?: string | null },
): Promise<EnregistrementFinancier> {
  const verdict = verdictEnregistrement(lecture)
  if (!verdict.enregistrable) return { ok: false, motif: verdict.motif }

  const ligne = {
    client_id: clientId,
    date_debut: lecture.debut,
    date_fin: lecture.fin,
    nb_jours: lecture.nbJours,
    ca_ttc: lecture.caTtc,
    nb_tickets: lecture.nbTickets,
    panier_moyen: lecture.panierMoyen,
    reglements: lecture.reglements,
    reglements_lus: lecture.reglementsLus,
    ecart_reglements: lecture.ecartReglements,
    motif_reglements: lecture.motifReglements,
    source: options.source,
    file_path: options.filePath ?? null,
    email_id: options.emailId ?? null,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('financier_jours')
    .upsert(ligne, { onConflict: 'client_id,date_debut,date_fin' })
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, motif: `enregistrement impossible : ${error.message}` }

  const periode = lecture.nbJours === 1
    ? `journée du ${lecture.debut}`
    : `période du ${lecture.debut} au ${lecture.fin} (${lecture.nbJours} jours)`
  const ventilation = lecture.reglements
    ? `règlements ventilés (${Object.keys(lecture.reglements).length} modes)`
    : `sans ventilation publiable — ${lecture.motifReglements ?? 'motif inconnu'}`

  return {
    ok: true,
    id: data?.id as string | undefined,
    jourUnique: verdict.jourUnique,
    motif: `relevé financier enregistré : ${periode}, ${Number(lecture.caTtc).toFixed(2)} € TTC, ${ventilation}`,
  }
}

export type LigneFinancier = {
  id: string
  date_debut: string
  date_fin: string
  nb_jours: number
  ca_ttc: number
  nb_tickets: number | null
  panier_moyen: number | null
  reglements: Record<string, number> | null
  reglements_lus: Record<string, number> | null
  ecart_reglements: number | null
  motif_reglements: string | null
  source: string
  file_path: string | null
}

/** Les relevés d'une fenêtre de dates, du plus récent au plus ancien.
 *  `depuis` et `jusqu_a` sont inclusifs, en AAAA-MM-JJ. Un relevé est retenu
 *  dès que sa période CHEVAUCHE la fenêtre — un relevé hebdomadaire à cheval
 *  sur deux mois appartient aux deux. */
export async function lireFinanciers(
  supabase: ServiceClient,
  clientId: string,
  depuis: string,
  jusquA: string,
): Promise<{ lignes: LigneFinancier[]; erreur: string | null }> {
  const { data, error } = await supabase
    .from('financier_jours')
    .select('*')
    .eq('client_id', clientId)
    .lte('date_debut', jusquA)
    .gte('date_fin', depuis)
    .order('date_debut', { ascending: false })
    .limit(400)

  if (error) return { lignes: [], erreur: error.message }
  return { lignes: (data ?? []) as unknown as LigneFinancier[], erreur: null }
}
