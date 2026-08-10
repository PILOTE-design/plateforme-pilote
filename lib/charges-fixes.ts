/**
 * LES FACTURES DE CHARGE, DANS LE RÉSULTAT DE LA SEMAINE.
 *
 * Module PUR, testable hors ligne.
 *
 * ─── LE TROU ──────────────────────────────────────────────────────────────
 *
 * Une facture étiquetée « charge fixe » est retirée des ACHATS — c'est juste,
 * un loyer n'est pas de la matière première. Mais elle ne revenait **nulle
 * part** : ni dans la marge, ni dans les charges de structure, ni dans le
 * résultat net. Le seul poste de charges du moteur hebdomadaire est la
 * provision des charges RÉCURRENTES, que le boucher déclare à la main.
 *
 * Autrement dit : une facture de charge qu'il n'a pas doublée d'une charge
 * récurrente sortait du calcul, purement et simplement. Son résultat net
 * était trop BEAU de ce montant-là.
 *
 * `prorata_ht` — la part hebdomadaire, `montant × 7 ÷ durée` — était pourtant
 * calculée et écrite en base par quatre routes différentes. Et lue par aucune.
 *
 * ─── POURQUOI ON NE PEUT PAS SIMPLEMENT LE BRANCHER ───────────────────────
 *
 * Parce que `period_days` a deux origines qu'aucune colonne ne distinguait :
 * la période LUE sur le document, et les 30 jours DEVINÉS par le connecteur.
 *
 * Mesuré en production : SKELLO facturé 1 717,20 € avec `period_days = 30`
 * deviné donne 400 €/semaine, pour un abonnement à 89 €/mois. Brancher sans
 * distinguer, c'était publier un chiffre faux d'un facteur vingt — pire que
 * le trou qu'on bouche.
 *
 * D'où `period_source`. Et d'où la règle de ce module : **seule une période
 * lue sur le document donne droit à la réinjection.** Une période devinée
 * laisse la facture hors du calcul, comme avant, et on le DIT à l'écran.
 *
 * ─── LE SECOND PIÈGE : COMPTER DEUX FOIS ──────────────────────────────────
 *
 * Le lot 75 a montré qu'un même fournisseur peut figurer des deux côtés :
 * ses factures d'un côté, une charge récurrente déclarée de l'autre. Une
 * charge récurrente s'AJOUTE, elle ne remplace pas.
 *
 * Si on réinjecte le prorata d'une facture dont le fournisseur porte déjà une
 * charge récurrente active, on recrée exactement le défaut qu'on vient de
 * corriger. Ces factures-là sont donc écartées de la réinjection — et là
 * encore, on le dit : c'est le boucher qui décide laquelle des deux sources
 * est la bonne, pas nous.
 */

import { societeKey } from '@/lib/supplier-memory'

/** Seule valeur qui autorise la réinjection. */
export const PERIODE_LUE = 'document'

export type FactureCharge = {
  id: string
  supplier_name?: string | null
  invoice_date?: string | null
  amount_ht?: number | string | null
  is_fixed_charge?: boolean | null
  period_days?: number | string | null
  period_source?: string | null
  prorata_ht?: number | string | null
}

export type ChargeRecurrenteActive = { label: string; active?: boolean | null }

export type MotifEcart =
  | 'periode_devinee'      // personne n'a lu la période sur le document
  | 'periode_absente'      // aucune période, même devinée
  | 'hors_semaine'         // la période couverte ne touche pas la semaine
  | 'deja_en_recurrent'    // une charge récurrente porte déjà ce fournisseur

export type LigneCharge = {
  invoice_id: string
  fournisseur: string
  /** Part hebdomadaire HT réinjectée. 0 quand la ligne est écartée. */
  montant: number
  /** Montant total de la facture, pour que le boucher reconnaisse la pièce */
  montant_facture: number
  jours: number | null
  retenue: boolean
  motif: MotifEcart | null
  phrase: string | null
}

export type BilanCharges = {
  /** Somme des parts hebdomadaires RETENUES — à ajouter aux charges fixes. */
  total: number
  lignes: LigneCharge[]
}

const nombre = (x: unknown): number | null => {
  if (x === null || x === undefined || x === '') return null
  const n = typeof x === 'number' ? x : parseFloat(String(x))
  return Number.isFinite(n) ? n : null
}

const jour = (s: unknown): number | null => {
  const t = new Date(String(s ?? '') + 'T00:00:00Z').getTime()
  return Number.isFinite(t) ? t : null
}

const euros = (n: number) =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

/**
 * La période d'une facture de charge touche-t-elle la semaine ?
 *
 * `[date de facture, date de facture + period_days − 1]` croise `[lundi,
 * dimanche]`. Sans période lisible, la facture ne vit que le jour de sa
 * facturation : elle n'est rattachée qu'à sa seule semaine de facturation.
 *
 * Exportée pour l'ÉCRAN — le bloc « En charges fixes cette semaine » doit
 * trancher exactement comme le calcul. Une règle, une définition : la recopier
 * ailleurs, c'est se condamner à deux vérités qui divergent.
 */
export function periodeCouvreSemaine(
  dateFacture: unknown,
  periodDays: unknown,
  lundi: string,
  dimanche: string,
): boolean {
  const debut = jour(dateFacture)
  const debutSemaine = jour(lundi)
  const finSemaine = jour(dimanche)
  if (debut === null || debutSemaine === null || finSemaine === null) return false
  const jours = nombre(periodDays)
  const fin = jours !== null && jours > 0 ? debut + (jours - 1) * 86400000 : debut
  return fin >= debutSemaine && debut <= finSemaine
}

/**
 * La part hebdomadaire des factures de charge qui touchent la semaine.
 *
 * `lundi` et `dimanche` au format `YYYY-MM-DD`. L'appelant passe toutes les
 * factures de charge dont la période PEUT couvrir la semaine (fenêtre élargie —
 * le critère est le chevauchement de période, pas la semaine de facturation) ;
 * ce module tranche au jour près. Les factures qui touchent la semaine sont
 * rendues dans `lignes`, RETENUES ou écartées avec leur motif : une charge qui
 * ne compte pas est une information, pas un silence. Celles qui ne la touchent
 * pas sont ignorées (elles comptent dans leur propre semaine). Seules les
 * retenues comptent dans `total`.
 */
export function chargesFixesDeLaSemaine(
  factures: FactureCharge[] | null | undefined,
  recurrentes: ChargeRecurrenteActive[] | null | undefined,
  lundi: string,
  dimanche: string,
): BilanCharges {
  const debutSemaine = jour(lundi)
  const finSemaine = jour(dimanche)

  // Les sociétés déjà couvertes par une charge récurrente ACTIVE. Une charge
  // clôturée ne provisionne plus rien : elle ne peut donc rien doubler.
  const dejaProvisionnees = new Set<string>()
  for (const r of recurrentes ?? []) {
    if (!r || r.active === false) continue
    const k = societeKey(String(r.label ?? ''))
    if (k) dejaProvisionnees.add(k)
  }

  const lignes: LigneCharge[] = []
  let total = 0

  for (const f of factures ?? []) {
    if (!f || !f.is_fixed_charge) continue
    const fournisseur = String(f.supplier_name ?? '').trim() || 'Fournisseur inconnu'
    const montantFacture = nombre(f.amount_ht) ?? 0
    const jours = nombre(f.period_days)
    const part = nombre(f.prorata_ht)

    const ecarter = (motif: MotifEcart, phrase: string) => {
      lignes.push({
        invoice_id: String(f.id), fournisseur, montant: 0,
        montant_facture: Math.round(montantFacture * 100) / 100,
        jours, retenue: false, motif, phrase,
      })
    }

    // ── LE PORTILLON : cette facture touche-t-elle la semaine ? ────────────
    // L'appelant nous envoie désormais TOUTES les factures de charge dont la
    // période PEUT couvrir la semaine (fenêtre élargie côté requête), et non
    // plus les seules factures de la semaine de facturation — c'était le trou :
    // un loyer facturé le 28/01 sur 31 jours n'entrait dans le résultat qu'en
    // semaine de facturation, alors qu'il court sur les suivantes. On tranche
    // ici, au jour près, avec la MÊME fonction que l'écran. Une facture qui, au
    // jour près, ne touche pas la semaine appartient à une AUTRE semaine : ni
    // comptée, ni affichée ici (elle le sera dans la sienne). Sans période
    // lisible, une facture ne vit que sa semaine de facturation.
    const debut = jour(f.invoice_date)
    if (debut === null || debutSemaine === null || finSemaine === null) continue
    if (!periodeCouvreSemaine(f.invoice_date, jours, lundi, dimanche)) continue

    // Elle touche la semaine — reste à savoir si sa part est calculable et si
    // elle n'est pas déjà comptée ailleurs.
    if (jours === null || jours <= 0 || part === null) {
      ecarter('periode_absente',
        `Aucune période lisible sur cette facture : impossible de dire quelle part revient à cette semaine. Elle n'entre pas dans le résultat.`)
      continue
    }

    // LA RÈGLE. Une période devinée ne donne pas droit à la réinjection.
    if (String(f.period_source ?? '') !== PERIODE_LUE) {
      ecarter('periode_devinee',
        `La période de cette facture (${jours} jours) a été devinée, pas lue sur le document : sa part hebdomadaire serait un chiffre inventé. Elle n'entre pas dans le résultat — indiquez la période pour l'y faire entrer.`)
      continue
    }

    if (dejaProvisionnees.has(societeKey(fournisseur))) {
      ecarter('deja_en_recurrent',
        `Une charge récurrente porte déjà ${fournisseur} : sa part hebdomadaire est comptée là-bas. L'ajouter ici la compterait deux fois.`)
      continue
    }

    const montant = Math.round(part * 100) / 100
    total += montant
    lignes.push({
      invoice_id: String(f.id), fournisseur, montant,
      montant_facture: Math.round(montantFacture * 100) / 100,
      jours, retenue: true, motif: null,
      phrase: `${euros(montantFacture)} sur ${jours} jours, période lue sur le document — ${euros(montant)} pour cette semaine.`,
    })
  }

  return { total: Math.round(total * 100) / 100, lignes }
}

/** Le résumé d'une ligne de charge écartée, pour la pastille de l'écran. */
export function libelleMotif(motif: MotifEcart): string {
  if (motif === 'periode_devinee') return 'période devinée'
  if (motif === 'periode_absente') return 'sans période'
  if (motif === 'deja_en_recurrent') return 'déjà en récurrent'
  return 'hors semaine'
}
