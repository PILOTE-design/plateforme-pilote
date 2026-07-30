// lib/onboarding-status.ts — CE QUI MANQUE ENCORE POUR QUE LES CHIFFRES SOIENT JUSTES.
//
// La mise en route ne doit plus passer par une intervention en base : un boucher
// qui vient de s'inscrire doit voir, tout seul, ce qu'il lui reste à renseigner
// ET ce que chaque manque fausse concrètement. C'est la différence entre une
// checklist de confort (« bien démarrer ») et un diagnostic honnête : tant qu'il
// manque les factures d'achat, la marge affichée n'a aucun sens — le dire vaut
// mieux que de laisser lire un beau chiffre faux.
//
// Source unique : le tableau de bord, l'écran de réglages et l'API partagent
// cette liste, pour qu'aucun écran n'oublie une étape que les autres exigent.

import type { createServiceClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceClient>

export type SetupStep = {
  key: string
  done: boolean
  label: string
  /** Ce qu'il faut faire, en clair */
  desc: string
  href: string
  /** true = tant que ce n'est pas fait, des chiffres affichés sont faux ou absents */
  fausseLesChiffres: boolean
  /** Ce que ça fausse précisément, quand ce n'est pas fait */
  impact: string | null
}

export type SetupStatus = {
  steps: SetupStep[]
  done: number
  total: number
  complete: boolean
  /** Les étapes manquantes qui empêchent les chiffres d'être justes */
  bloquants: SetupStep[]
}

/**
 * État de configuration d'un client. Volontairement basé sur des COMPTAGES
 * (head: true) : c'est léger et ça reflète la réalité de la base, jamais un
 * drapeau « onboarding terminé » qu'on aurait oublié de remettre à jour.
 */
export async function readSetupStatus(
  supabase: ServiceClient,
  clientId: string,
): Promise<SetupStatus> {
  const countOf = async (
    table: string,
    build?: (q: any) => any,
  ): Promise<number> => {
    let q: any = supabase.from(table).select('id', { count: 'exact', head: true }).eq('client_id', clientId)
    if (build) q = build(q)
    const { count } = await q
    return count || 0
  }

  const [integrations, employees, weeks, achats, ventilations] = await Promise.all([
    countOf('billing_integrations', q => q.eq('is_active', true)),
    countOf('employees'),
    countOf('weekly_ca'),
    // Achats VARIABLES : ce sont eux qui font la marge (les charges fixes non)
    countOf('invoices', q => q.eq('is_fixed_charge', false)),
    countOf('supplier_rayon_splits'),
  ])

  // Le planning n'a pas de client_id : il se rattache aux employés du client.
  let planning = 0
  if (employees > 0) {
    const { data: emps } = await supabase.from('employees').select('id').eq('client_id', clientId)
    const ids = (emps || []).map((e: { id: string }) => e.id)
    if (ids.length > 0) {
      const { count } = await supabase
        .from('planning_entries').select('id', { count: 'exact', head: true }).in('employee_id', ids)
      planning = count || 0
    }
  }

  const steps: SetupStep[] = [
    {
      key: 'ca',
      done: weeks > 0,
      label: 'Saisir votre chiffre d\'affaires',
      desc: 'À la main ou via le rapport hebdomadaire — c\'est la base de tous les taux',
      href: '/dashboard/facturation',
      fausseLesChiffres: true,
      impact: 'Sans CA, aucune marge ni aucun résultat ne peut être calculé.',
    },
    {
      key: 'achats',
      done: achats > 0,
      label: 'Importer ou saisir vos factures d\'achat',
      desc: 'Connexion comptable, transfert par email, ou saisie manuelle',
      href: '/dashboard/facturation',
      fausseLesChiffres: true,
      impact: "Sans achats, la marge affichée vaut 100 % du CA : elle n'a aucun sens tant qu'ils manquent.",
    },
    {
      key: 'integration',
      done: integrations > 0,
      label: 'Connecter votre logiciel comptable',
      desc: 'Vos factures s\'importeront automatiquement chaque lundi',
      href: '/dashboard/facturation',
      fausseLesChiffres: false,
      impact: null,
    },
    {
      key: 'employes',
      done: employees > 0,
      label: 'Ajouter vos employés',
      desc: 'Contrats, taux horaires et charges patronales (CCN 992)',
      href: '/dashboard/planning',
      fausseLesChiffres: true,
      impact: 'Sans employé, la masse salariale reste à 0 € et la marge sur coût direct est surévaluée.',
    },
    {
      key: 'planning',
      done: planning > 0,
      label: 'Remplir votre premier planning',
      desc: 'Les heures pointées donnent le coût réel du travail',
      href: '/dashboard/planning',
      fausseLesChiffres: true,
      impact: 'Sans heures pointées, le coût du travail de la semaine reste à 0 €.',
    },
    {
      key: 'ventilation',
      done: ventilations > 0,
      label: 'Ventiler vos fournisseurs par rayon',
      desc: 'Répartir les achats entre boucherie, charcuterie et traiteur',
      href: '/dashboard/facturation',
      fausseLesChiffres: false,
      impact: 'La marge globale reste juste, mais aucune marge par famille ne peut être calculée.',
    },
  ]

  const done = steps.filter(s => s.done).length
  return {
    steps,
    done,
    total: steps.length,
    complete: done === steps.length,
    bloquants: steps.filter(s => !s.done && s.fausseLesChiffres),
  }
}
