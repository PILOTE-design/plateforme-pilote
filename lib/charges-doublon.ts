/**
 * UNE CHARGE RÉCURRENTE QUI DOUBLONNE AVEC LES ACHATS.
 *
 * Module PUR, testable hors ligne.
 *
 * ─── LE DÉFAUT ────────────────────────────────────────────────────────────
 *
 * Deux moteurs comptent l'argent qui sort, et ils ne se parlent pas :
 *
 *  · les FACTURES non étiquetées « charge fixe » entrent dans les achats, donc
 *    dans la marge brute (`week-economics`, section « achats variables ») ;
 *  · les CHARGES RÉCURRENTES sont provisionnées au jour près et retirées plus
 *    bas, en charges de structure.
 *
 * Rien ne vérifie qu'un même fournisseur ne figure pas des deux côtés. Or une
 * charge récurrente se crée EN UN CLIC depuis une facture : le libellé repris
 * est celui de la facture (« Facture X — 26070340 (label généré) »), la
 * périodicité « mensuel » est supposée, et il n'y a pas de date de fin. Un
 * achat ponctuel devient une provision perpétuelle — et le fournisseur est
 * compté deux fois.
 *
 * Mesuré en production le 05/08/2026 sur une boucherie : quatre charges
 * récurrentes sur treize portaient le nom d'un fournisseur de MATIÈRE
 * (viande, charcuterie) dont les factures alimentaient déjà les achats. 764 €
 * par semaine comptés deux fois, sur 1 117 € de charges de structure
 * affichées — 68 %. Le résultat net montré au boucher, au tableau de bord
 * comme dans le rapport PDF, était trop bas d'autant, toutes les semaines.
 *
 * ─── CE QU'ON FAIT, ET CE QU'ON NE FAIT PAS ───────────────────────────────
 *
 * On ANNONCE. On ne retire rien, on ne désactive rien, on ne recalcule rien.
 *
 * Ce n'est pas de la prudence de façade : le cas légitime existe. Un
 * fournisseur peut vendre de la marchandise ET louer du matériel au mois ; la
 * provision est alors juste, et la retirer d'office fabriquerait un résultat
 * faux dans l'autre sens. Seul le boucher sait. Notre travail est qu'il ne
 * puisse pas ne pas voir la question — pas d'y répondre à sa place.
 *
 * Le rapprochement se fait par SOCIÉTÉ (`societeKey`), la même clé que la
 * ventilation fournisseur et le moteur hebdomadaire : « Facture X — 26070340
 * (label généré) » et « Facture X — 26071120 (label généré) » sont le même X.
 * Une clé de plus aurait regroupé autrement, et deux écrans se seraient mis à
 * dire deux choses.
 */

import { societeKey } from '@/lib/supplier-memory'

export type ChargeRecurrente = {
  id: string
  label: string
  /** Une charge clôturée ne provisionne plus rien : elle ne double rien non plus. */
  active?: boolean | null
}

export type FactureVariable = {
  supplier_name?: string | null
  amount_ht?: number | string | null
  /** Les factures DÉJÀ étiquetées « charge fixe » sont hors des achats : elles
   *  ne peuvent pas doublonner avec une provision. */
  is_fixed_charge?: boolean | null
  invoice_date?: string | null
}

/** Ce qu'on a trouvé en face d'une charge récurrente, dans les achats. */
export type DoubleEmploi = {
  /** La société, telle qu'elle sera lue par le boucher */
  societe: string
  factures: number
  montant_ht: number
  depuis: string | null
  jusqu_a: string | null
}

/** Le double emploi TEL QU'IL SORT DE L'API : le constat, plus la phrase à
 *  afficher. La phrase est calculée côté serveur pour être la même partout —
 *  à la création d'une charge comme dans le tableau. */
export type DoubleEmploiVu = DoubleEmploi & { phrase: string }

const nombre = (x: unknown): number | null => {
  if (x === null || x === undefined || x === '') return null
  const n = typeof x === 'number' ? x : parseFloat(String(x))
  return Number.isFinite(n) ? n : null
}

/**
 * Les charges récurrentes dont la société apparaît AUSSI dans les achats.
 *
 * Rendu : une entrée par `charge.id` concerné. Une charge sans correspondance
 * n'est pas dans la carte — l'absence est la normale, et elle ne coûte rien à
 * transporter.
 */
export function doublesEmplois(
  charges: ChargeRecurrente[] | null | undefined,
  factures: FactureVariable[] | null | undefined,
): Map<string, DoubleEmploi> {
  const out = new Map<string, DoubleEmploi>()

  // Les achats, regroupés par société. Une seule passe : ces listes se
  // comptent en centaines, mais elles se croisent, et le produit des deux
  // n'aurait aucune raison de rester petit.
  const parSociete = new Map<string, DoubleEmploi>()
  for (const f of factures ?? []) {
    if (!f) continue
    if (f.is_fixed_charge) continue
    const brut = String(f.supplier_name ?? '').trim()
    if (!brut) continue
    const cle = societeKey(brut)
    if (!cle) continue
    const montant = nombre(f.amount_ht) ?? 0
    const date = typeof f.invoice_date === 'string' && f.invoice_date ? f.invoice_date.slice(0, 10) : null
    const cur = parSociete.get(cle)
    if (!cur) {
      parSociete.set(cle, {
        // Le nom lisible vient de la première facture rencontrée, pas de la
        // clé normalisée : « SOCIETE X DES VIANDES » se lit mieux en
        // majuscules que « societe x des viandes ».
        societe: brut.replace(/^factures?\s+/i, '').split(/\s+[-–—]\s+/)[0].trim() || brut,
        factures: 1,
        montant_ht: montant,
        depuis: date,
        jusqu_a: date,
      })
      continue
    }
    cur.factures += 1
    cur.montant_ht += montant
    if (date && (cur.depuis === null || date < cur.depuis)) cur.depuis = date
    if (date && (cur.jusqu_a === null || date > cur.jusqu_a)) cur.jusqu_a = date
  }

  for (const c of charges ?? []) {
    if (!c || !c.id) continue
    // Une charge clôturée ne provisionne plus : rien à signaler.
    if (c.active === false) continue
    const cle = societeKey(String(c.label ?? ''))
    if (!cle) continue
    const trouve = parSociete.get(cle)
    if (!trouve) continue
    out.set(String(c.id), {
      societe: trouve.societe,
      factures: trouve.factures,
      montant_ht: Math.round(trouve.montant_ht * 100) / 100,
      depuis: trouve.depuis,
      jusqu_a: trouve.jusqu_a,
    })
  }

  return out
}

/** La phrase à afficher, en français, telle quelle. Elle vit ici et non dans
 *  l'écran : le même avertissement doit se lire à l'identique à la création
 *  d'une charge et dans le tableau des charges. */
export function phraseDoubleEmploi(d: DoubleEmploi): string {
  const montant = d.montant_ht.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const combien = d.factures > 1 ? `${d.factures} factures` : `1 facture`
  return `Peut-être compté deux fois : ${combien} de ${d.societe} (${montant} € HT) figurent aussi dans vos achats.`
    + ` Une charge récurrente s'ajoute à ces factures, elle ne les remplace pas.`
    + ` Si ce fournisseur vous livre de la marchandise, clôturez cette charge ; s'il vous facture aussi un abonnement, gardez-la.`
}
