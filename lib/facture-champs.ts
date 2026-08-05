/**
 * CE QUE LE NAVIGATEUR A LE DROIT DE MODIFIER SUR UNE FACTURE.
 *
 * Module PUR, testable hors ligne.
 *
 * ─── LE TROU ──────────────────────────────────────────────────────────────
 *
 * `PATCH /api/invoices/[id]` appliquait le corps de la requête TEL QUEL :
 * `update(body)`. Le cloisonnement par `client_id` était bien là — on ne
 * pouvait pas toucher la facture d'une autre boucherie —, mais sur ses propres
 * factures, n'importe quelle colonne devenait modifiable depuis le navigateur.
 *
 * Trois conséquences, de la plus grave à la plus discrète :
 *
 *  · `client_id` lui-même. Le filtre `.eq('client_id', …)` porte sur l'ANCIENNE
 *    valeur : `update({ client_id: 'une autre boutique' })` passait le filtre,
 *    puis DÉPLAÇAIT la facture chez le voisin. La barrière anti-fuite du projet
 *    était contournable par un champ de formulaire.
 *
 *  · `period_source`. Les lots 81 et 82 ont établi qu'une période DEVINÉE
 *    n'ouvre pas droit à la réinjection dans le résultat — c'est ce qui évite
 *    de publier 400 €/semaine pour un abonnement à 89 €/mois. Écrire
 *    `period_source: 'document'` depuis le navigateur levait ce garde-fou.
 *
 *  · `lectures_echouees`, `lines_status`, `prorata_ht`… : des compteurs et des
 *    états que des moteurs calculent. Les laisser écrire de l'extérieur, c'est
 *    accepter que le chiffre affiché ne vienne plus du calcul.
 *
 * ─── LA RÈGLE ─────────────────────────────────────────────────────────────
 *
 * Une liste blanche : ce que le boucher corrige à la main sur une facture, et
 * rien d'autre. Un champ hors liste ne passe pas EN SILENCE — la requête est
 * refusée en nommant le champ. Un champ ignoré sans le dire, c'est une
 * correction que l'utilisateur croit enregistrée et qui n'existe pas.
 *
 * ─── CE QUI SE RECALCULE ──────────────────────────────────────────────────
 *
 * `amount_ttc` et `prorata_ht` sont DÉRIVÉS. Ils ne sont jamais acceptés du
 * navigateur : ils sont recalculés ici quand leur base change. Corriger un
 * montant HT sans recalculer la part hebdomadaire laisserait dans le résultat
 * de la semaine un chiffre issu de l'ancien montant.
 */

/** Les seuls champs qu'une requête du navigateur peut porter. */
export const CHAMPS_MODIFIABLES = [
  'status',            // à vérifier / validée
  'is_fixed_charge',   // c'est une charge, pas un achat de matière
  'charge_family_id',  // à quelle famille de charge elle se rattache
  'supplier_name',     // le fournisseur a été mal lu
  'invoice_date',      // la date a été mal lue
  'amount_ht',         // le montant a été mal lu
  'tva_rate',          // le taux a été mal lu
] as const

export type ChampModifiable = typeof CHAMPS_MODIFIABLES[number]

/**
 * Les champs refusés qui méritent une phrase, parce qu'ils ont l'air légitimes.
 *
 * Les autres colonnes reçoivent le refus générique : il vaut mieux une phrase
 * un peu sèche qu'une liste à maintenir en double de la base.
 */
const REFUS_EXPLIQUE: Record<string, string> = {
  client_id:
    `le rattachement d'une facture à une boutique ne se change pas depuis un formulaire.`,
  period_source:
    `l'origine de la période dit si elle a été LUE sur le document ou devinée ;`
    + ` c'est ce qui autorise, ou non, sa réinjection dans le résultat de la semaine.`,
  prorata_ht:
    `la part hebdomadaire se recalcule à partir du montant et de la période — elle ne se saisit pas.`,
  amount_ttc:
    `le TTC se recalcule à partir du HT et du taux de TVA — il ne se saisit pas.`,
  lectures_echouees:
    `le compteur de lectures échouées appartient à la file de lecture.`,
  lines_status:
    `l'état de lecture des lignes appartient au moteur d'extraction.`,
  period_days:
    `la durée couverte vient du document ; la corriger à la main demande de dire aussi`
    + ` d'où elle vient, ce que cette route ne sait pas encore faire.`,
}

const nombre = (x: unknown): number | null => {
  if (x === null || x === undefined || x === '') return null
  const n = typeof x === 'number' ? x : parseFloat(String(x))
  return Number.isFinite(n) ? n : null
}

const r2 = (n: number) => Math.round(n * 100) / 100

export type FactureExistante = {
  amount_ht?: number | string | null
  tva_rate?: number | string | null
  period_days?: number | string | null
  is_fixed_charge?: boolean | null
}

export type Verdict =
  | { ok: true; patch: Record<string, unknown> }
  | { ok: false; motif: string }

/**
 * Le correctif à appliquer, ou le refus.
 *
 * `existante` est la facture telle qu'elle est en base : elle sert à recalculer
 * les champs dérivés quand la requête ne change qu'une partie de leur base
 * (corriger le seul HT doit tout de même mettre à jour le TTC).
 */
export function correctifFacture(
  corps: unknown,
  existante: FactureExistante | null | undefined,
): Verdict {
  if (!corps || typeof corps !== 'object' || Array.isArray(corps)) {
    return { ok: false, motif: `Requête vide : rien à modifier.` }
  }

  const entrees = Object.entries(corps as Record<string, unknown>)
  if (entrees.length === 0) {
    return { ok: false, motif: `Requête vide : rien à modifier.` }
  }

  const autorises = new Set<string>(CHAMPS_MODIFIABLES)
  const patch: Record<string, unknown> = {}

  for (const [cle, valeur] of entrees) {
    if (!autorises.has(cle)) {
      const explication = REFUS_EXPLIQUE[cle]
      return {
        ok: false,
        motif: explication
          ? `Le champ « ${cle} » ne se modifie pas depuis l'application : ${explication}`
          : `Le champ « ${cle} » ne fait pas partie de ce qui se corrige sur une facture.`,
      }
    }
    patch[cle] = valeur
  }

  // ── Les champs dérivés, recalculés à partir de l'état résultant ──
  const ht = 'amount_ht' in patch ? nombre(patch.amount_ht) : nombre(existante?.amount_ht)
  const tva = 'tva_rate' in patch ? nombre(patch.tva_rate) : nombre(existante?.tva_rate)

  if ('amount_ht' in patch || 'tva_rate' in patch) {
    if (ht !== null && tva !== null) patch.amount_ttc = r2(ht * (1 + tva / 100))
  }

  // La part hebdomadaire d'une charge suit son montant. Sans période lisible,
  // il n'y a pas de part à recalculer — et surtout pas à inventer.
  if ('amount_ht' in patch) {
    const jours = nombre(existante?.period_days)
    const charge = 'is_fixed_charge' in patch
      ? patch.is_fixed_charge === true
      : existante?.is_fixed_charge === true
    if (charge && ht !== null && jours !== null && jours > 0) {
      patch.prorata_ht = r2(ht * 7 / jours)
    }
  }

  return { ok: true, patch }
}
