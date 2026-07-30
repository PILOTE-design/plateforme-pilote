// lib/ca-sources.ts — D'OÙ VIENT LE CHIFFRE D'AFFAIRES D'UNE SEMAINE.
//
// Le moteur hebdo (lib/week-economics) reçoit déjà le CA en ENTRÉE (`CaInput`) :
// il ne va jamais le chercher lui-même. C'est ce qui rend la source du CA
// remplaçable sans toucher au moindre calcul. Ce module formalise cette
// frontière : il dit quelles sources existent, laquelle a alimenté une semaine,
// et fournit LE lecteur unique d'une semaine de CA.
//
// RÈGLE INTANGIBLE — la saisie MANUELLE reste toujours disponible, quelle que
// soit la source branchée. Un client sans flux de caisse doit pouvoir piloter sa
// semaine ; une source automatique en panne ne doit jamais bloquer un boucher.
//
// Ce module ne contient AUCUN connecteur de caisse, volontairement : tant que le
// logiciel du client n'est pas connu, écrire un connecteur serait du travail
// perdu. Brancher une source revient à : écrire dans `weekly_ca` en renseignant
// `source`, et rien d'autre — aucun calcul, aucun écran à reprendre.

import type { createServiceClient } from '@/lib/supabase/server'
import type { CaInput } from '@/lib/week-economics'

type ServiceClient = ReturnType<typeof createServiceClient>

/** Sources possibles du CA d'une semaine. */
export type CaSourceKey = 'manuel' | 'rapport_pdf' | 'csv' | 'caisse'

export type CaSourceInfo = {
  label: string
  /** Ce que le gérant doit comprendre en lisant l'origine de ses chiffres */
  description: string
  /** true = arrive sans intervention humaine (cible « 0 minute par semaine ») */
  automatique: boolean
}

export const CA_SOURCES: Record<CaSourceKey, CaSourceInfo> = {
  manuel: {
    label: 'Saisie manuelle',
    description: 'CA saisi dans la modale « Saisir le CA » — le repli toujours disponible.',
    automatique: false,
  },
  rapport_pdf: {
    label: 'Relevés de caisse (PDF)',
    description: 'CA extrait des relevés déposés à la génération du rapport hebdomadaire.',
    automatique: false,
  },
  csv: {
    label: 'Import CSV',
    description: "CA importé depuis un export de caisse au format CSV.",
    automatique: false,
  },
  caisse: {
    label: 'Caisse connectée',
    description: 'CA reçu automatiquement du logiciel de caisse, sans intervention.',
    automatique: true,
  },
}

/** Source par défaut d'une semaine dont l'origine n'a pas été enregistrée
 *  (toutes les semaines antérieures à ce module). */
export const DEFAULT_CA_SOURCE: CaSourceKey = 'manuel'

/** Valeur de base lue en jsonb/texte → clé de source sûre. */
export function parseCaSource(raw: unknown): CaSourceKey {
  const k = String(raw ?? '')
  return k in CA_SOURCES ? (k as CaSourceKey) : DEFAULT_CA_SOURCE
}

/** Une semaine de CA telle qu'elle est stockée, prête à entrer dans le moteur. */
export type WeekCaRecord = {
  /** Exactement ce qu'attend computeWeekEconomics */
  ca: CaInput
  source: CaSourceKey
  /** true si le détail par famille est présent (sinon on retombe sur les
   *  montants par rayon saisis à la main) */
  hasDetail: boolean
  updatedAt: string | null
  /** La ligne `weekly_ca` telle quelle — les écrans existants lisent encore
   *  certains champs bruts (families_detail, nb_tickets…). On ne change pas
   *  leur contrat en introduisant ce lecteur. */
  raw: Record<string, unknown>
}

/**
 * LE lecteur d'une semaine de CA. Tous les écrans qui affichent l'économie
 * d'UNE semaine passent par ici, pour qu'ajouter une source ne demande pas de
 * retrouver chaque `select` éparpillé.
 * Renvoie `null` quand la semaine n'a pas encore de CA — l'appelant affiche
 * alors le trou plutôt qu'un zéro trompeur.
 */
export async function readWeekCa(
  supabase: ServiceClient,
  clientId: string,
  week: number,
  year: number,
): Promise<WeekCaRecord | null> {
  const { data } = await supabase
    .from('weekly_ca')
    .select('*')
    .eq('client_id', clientId)
    .eq('week_number', week)
    .eq('year', year)
    .maybeSingle()

  if (!data) return null

  const row = data as Record<string, unknown>
  const familles = Array.isArray(row.families_detail)
    ? (row.families_detail as { nom: string; montant: number }[])
    : null

  return {
    ca: {
      ca_total: parseFloat(String(row.ca_total ?? 0)) || 0,
      familles,
      by_rayon: {
        boucherie:   parseFloat(String(row.ca_boucherie ?? 0)) || 0,
        charcuterie: parseFloat(String(row.ca_charcuterie ?? 0)) || 0,
        traiteur:    parseFloat(String(row.ca_traiteur ?? 0)) || 0,
      },
    },
    source: parseCaSource(row.source),
    hasDetail: !!familles && familles.length > 0,
    updatedAt: (row.updated_at as string | null) ?? null,
    raw: row,
  }
}
