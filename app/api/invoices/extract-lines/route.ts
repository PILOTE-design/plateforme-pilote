// Extraction ligne à ligne d'une facture fournisseur — le cœur de la mercuriale.
//
// Pennylane ne fournit que des lignes COMPTABLES (libellé + montants, sans quantité
// ni prix unitaire) : les lignes PRODUITS — « ÉCHINE DE PORC · 4521 · 12,4 kg ×
// 5,80 € » — n'existent que sur le PDF. On le lit donc nous-mêmes, avec le même
// pipeline éprouvé que le rapport hebdomadaire : pdf-parse + Haiku + garde-fous
// déterministes (la somme des lignes doit boucler sur le total de la facture).
//
// Chaque ligne insérée est un POINT DE PRIX daté : l'historique de la mercuriale
// EST la table invoice_lines, il n'y a pas de copie à maintenir. L'article
// canonique est rattaché par code fournisseur d'abord (stable), libellé normalisé
// ensuite, créé sinon.
if (typeof globalThis.DOMMatrix === 'undefined') {
  ;(globalThis as Record<string, unknown>).DOMMatrix = class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { isAdminEmail } from '@/lib/admins'
import { normalizeSupplierName, supplierSociete, societeKey } from '@/lib/supplier-memory'
import { normText } from '@/lib/postes'
import { pdfToLines } from '@/lib/pdf-lines'
import { plausibleDelivery } from '@/lib/invoice-week'
import { lireFacturX } from '@/lib/facturx'
import { choisirExemples, consigneExemples, rangerExemple } from '@/lib/invoice-layouts'
// Le MOTEUR d'extraction vit dans lib/ — un module de route n'exporte que ses
// verbes HTTP, et la route d'évaluation doit pouvoir rejouer exactement le même
// code sur un texte archivé (cf. lib/invoice-extract).
import {
  PROMPT_LIGNES_VERSION, TEXTE_MAX,
  convertirLignesTTC, extractLinesVision, lireTexteAvecReprise, sommeLignes,
  type ExtractedLine,
} from '@/lib/invoice-extract'
import { verdictLigne } from '@/lib/invoice-lines'
import { PERIODE_LUE } from '@/lib/charges-fixes'
import { compteurApres } from '@/lib/lecture-file'
import { dernierPrix, memePrix } from '@/lib/article-price'
import { cleCodeArticle } from '@/lib/article-code'
import { fetchAllPages } from '@/lib/fetch-all'

// Jusqu'à trois passes de lecture pour une facture qui résiste (texte, reprise,
// image) : 60 s n'y suffisent plus. 300 s est le plafond réel de la plateforme,
// et la lecture reste déclenchée à la main, une facture à la fois.
export const maxDuration = 300

type Service = ReturnType<typeof createServiceClient>

/** L'état des lignes ACTUELLES de cette facture. À relever AVANT de les purger :
 *  après, plus rien ne dit lesquels articles étaient concernés — leur prix
 *  resterait figé sur une lecture disparue — ni combien de prix la lecture
 *  précédente publiait. */
async function etatDesLignes(
  service: Service, clientId: string, invoiceId: string,
): Promise<{ articles: string[]; prixPublies: number }> {
  const { data } = await service.from('invoice_lines')
    .select('article_id, unit_price_ht').eq('invoice_id', invoiceId).eq('client_id', clientId)
  return {
    articles: (data || []).map(r => r.article_id).filter(Boolean) as string[],
    prixPublies: (data || []).filter(r => r.unit_price_ht !== null).length,
  }
}

/**
 * Recale le dernier prix des articles donnés depuis leurs lignes de facture.
 *
 * C'est le seul endroit du projet qui écrit `last_price_ht` : le prix d'un
 * article se DÉDUIT de ses points de prix, il ne s'accumule pas. `blocked_price_ht`
 * n'est jamais touché — c'est une décision du boucher, pas une donnée dérivée.
 *
 * Un échec ici ne fait pas échouer la lecture : les lignes, elles, sont déjà
 * justes, et c'est sur elles que tout se recalcule. Mais il est TRACÉ, parce
 * qu'un prix resté en arrière est exactement ce qu'on cherche à ne plus voir.
 */
async function recalerArticles(service: Service, clientId: string, ids: (string | null)[]): Promise<void> {
  const uniques = [...new Set(ids.filter(Boolean) as string[])]
  if (uniques.length === 0) return
  try {
    const { data: arts } = await service.from('articles')
      .select('id, last_price_ht, last_price_date, price_count')
      .eq('client_id', clientId).in('id', uniques)
    if (!arts?.length) return

    // Tous les points de prix des articles concernés.
    //
    // Deux requêtes plutôt qu'une jointure : la forme d'une relation imbriquée
    // change selon la façon dont PostgREST la résout (objet ou tableau), et une
    // erreur de jointure serait avalée par le `catch` — c'est-à-dire qu'un prix
    // resterait silencieusement en arrière, exactement le défaut qu'on corrige.
    // Par PAQUETS d'identifiants et PAGINÉE. Deux plafonds muets se cumulaient
    // ici : PostgREST met les valeurs d'un `in` dans l'URL (au-delà de quelques
    // centaines de réfs, la requête devient trop longue) et rend au plus mille
    // lignes. Or c'est le SEUL endroit du projet qui écrit `last_price_ht` :
    // au-delà de mille points de prix, le « dernier prix » du catalogue était
    // calculé sur un sous-ensemble arbitraire, et donc faux sans le dire.
    const LOT_IDS = 150
    const lignes: Array<{ article_id: string | null; unit_price_ht: number | string | null; invoice_id: string | null; created_at: string | null }> = []
    for (let i = 0; i < uniques.length; i += LOT_IDS) {
      const lot = uniques.slice(i, i + LOT_IDS)
      const page = await fetchAllPages<any>(apres => {
        let q = service.from('invoice_lines')
          .select('id, article_id, unit_price_ht, invoice_id, created_at')
          .eq('client_id', clientId).in('article_id', lot)
        if (apres) q = q.gt('id', apres)
        return q.order('id', { ascending: true })
      })
      if (page.erreur) throw new Error(`lecture des points de prix : ${page.erreur}`)
      if (page.tronque) throw new Error(`lecture des points de prix : lot tronqué, recalage abandonné`)
      lignes.push(...page.rows)
    }

    const factureIds = [...new Set((lignes || []).map(l => l.invoice_id).filter(Boolean) as string[])]
    const dateDe = new Map<string, string | null>()
    for (let i = 0; i < factureIds.length; i += LOT_IDS) {
      const lot = factureIds.slice(i, i + LOT_IDS)
      const { data: facs, error: errFacs } = await service.from('invoices')
        .select('id, invoice_date').eq('client_id', clientId).in('id', lot)
      if (errFacs) throw new Error(`lecture des dates de facture : ${errFacs.message}`)
      for (const f of facs || []) dateDe.set(String(f.id), f.invoice_date ?? null)
    }

    const parArticle = new Map<string, Array<{ unit_price_ht: number | string | null; invoice_date: string | null; created_at: string | null }>>()
    for (const l of lignes || []) {
      const id = String(l.article_id ?? '')
      if (!id) continue
      const arr = parArticle.get(id) ?? []
      arr.push({
        unit_price_ht: l.unit_price_ht ?? null,
        invoice_date: dateDe.get(String(l.invoice_id)) ?? null,
        created_at: l.created_at ?? null,
      })
      parArticle.set(id, arr)
    }

    for (const a of arts) {
      const calcule = dernierPrix(parArticle.get(String(a.id)) ?? [])
      // Rien n'a bougé : ne pas écrire, pour ne pas faire vieillir `updated_at`
      // que la mercuriale montre au boucher.
      if (memePrix(calcule, a as never)) continue
      await service.from('articles').update({
        last_price_ht: calcule.last_price_ht,
        last_price_date: calcule.last_price_date,
        price_count: calcule.price_count,
        updated_at: new Date().toISOString(),
      }).eq('id', a.id).eq('client_id', clientId)
    }
  } catch (e) {
    console.error('[extract-lines] recalage des prix d’articles', e)
  }
}


export async function POST(request: NextRequest) {
  const service = createServiceClient()
  const corpsRecu = await request.json().catch(() => ({} as Record<string, unknown>))
  const ficheDemandee = typeof corpsRecu?.client_id === 'string' && corpsRecu.client_id ? String(corpsRecu.client_id) : null

  // LECTURE DE NUIT (lot 27) : le cron quotidien appelle cette route sans
  // session, porteur du secret de la plateforme. Le jeton se compare côté
  // serveur et ne sort jamais d'ici. En mode machine la fiche visée doit être
  // EXPLICITE — un automate n'a pas de fiche « à lui », donc aucun repli.
  const secret = process.env.CRON_SECRET
  const estMachine = !!secret && request.headers.get('authorization') === `Bearer ${secret}`
  let clientId: string | null
  if (estMachine) {
    if (!ficheDemandee) return NextResponse.json({ error: 'client_id requis en mode machine' }, { status: 400 })
    clientId = ficheDemandee
  } else {
    // ENTRETIEN PAR L'ADMINISTRATEUR : même règle que le rattrapage des PDF — un
    // corps { client_id } désigne la fiche à lire, accepté UNIQUEMENT pour un
    // administrateur ; pour tout autre compte, c'est un refus net.
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    if (ficheDemandee) {
      if (!isAdminEmail(user.email)) return NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 })
      clientId = ficheDemandee
    } else {
      clientId = await resolveClientId(service, user.id, user.email)
    }
  }
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  /** Écrit l'issue de la lecture AVEC SON MOTIF (lot 1, 31/07).
   *
   *  Jusqu'ici chaque sortie posait un `lines_status` et jetait la raison : 26
   *  factures sur 118 étaient des boîtes noires, impossible de distinguer un
   *  scan illisible d'une somme qui ne boucle pas. Sans motif persisté, aucune
   *  correction de l'extraction n'est mesurable — c'est le préalable à tout le
   *  reste. Le motif est écrit en FRANÇAIS LISIBLE : il s'affiche tel quel au
   *  boucher, qui doit pouvoir décider quoi faire sans lire du code. */

  /** Le compteur d'échecs LU EN BASE au début de cette lecture (lot 80). Il est
   *  relevé une fois, après la lecture de la facture, et sert au seul endroit
   *  qui écrit l'issue : `marquer`. Compter dans les six appelants, c'est
   *  garantir qu'un jour l'un d'eux oubliera. */
  let echecsAvant = 0
  const marquer = async (
    invoiceId: string,
    status: 'done' | 'partial' | 'error' | 'no_file' | 'hors_matiere' | 'scan_illisible',
    motif: string | null,
    extra: Record<string, unknown> = {},
  ) => {
    await service.from('invoices').update({
      lines_status: status,
      lines_error: motif,
      lines_checked_at: new Date().toISOString(),
      // Une lecture qui échoue rapproche le document de la sortie de file ; une
      // lecture qui aboutit efface son passé (cf. lib/lecture-file).
      lectures_echouees: compteurApres(echecsAvant, status),
      ...extra,
    }).eq('id', invoiceId).eq('client_id', clientId)
  }

  const invoice_id = corpsRecu?.invoice_id
  if (!invoice_id) return NextResponse.json({ error: 'invoice_id requis' }, { status: 400 })

  const { data: invoice } = await service.from('invoices')
    .select('id, supplier_name, invoice_date, amount_ht, amount_ttc, tva_rate, file_path, delivery_date, due_date, is_fixed_charge, lectures_echouees')
    .eq('id', invoice_id).eq('client_id', clientId).maybeSingle()
  if (!invoice) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 })
  echecsAvant = Number(invoice.lectures_echouees) || 0

  // Clé du fournisseur, calculée une fois pour toute la requête : elle sert à
  // choisir les exemples de mise en page AVANT la lecture, et à ranger la
  // lecture réussie APRÈS.
  const cleFournisseur = normalizeSupplierName(supplierSociete(invoice.supplier_name || '')) || ''

    // ── PUBLICATION : garde-fous puis écriture. Chemin UNIQUE, partagé par la
    // lecture structurée (facture électronique), la lecture texte et la lecture
    // image. Dupliquer la quarantaine par chemin serait le meilleur moyen de la
    // voir diverger — et un prix douteux publié d'un côté seulement.
    // Fonction FLÉCHÉE et non déclaration : une déclaration est hoistée, donc
    // TypeScript la suppose appelable avant le contrôle « facture introuvable »
    // et perd la certitude que `invoice` existe. Une const affectée ici garde
    // l'affinage de type — et le compilateur reste un filet, pas une gêne.
    const publierLignes = async (
      lines: ExtractedLine[],
      ctx: {
        mode: string
        delivery_date: string | null
        due_date: string | null
        tronque: boolean
        luEnVision?: boolean
        motifSuffixe?: string
        /** Quelle passe a produit cette lecture, et combien ont été tentées.
         *  Sans ça, impossible de dire combien de factures ne passent QUE grâce
         *  au secours — donc impossible de savoir s'il sert à quelque chose. */
        passe?: string
        tentatives?: number
        /** Texte source, quand il y en a un : une lecture qui boucle au centime
         *  devient l'exemple de référence de ce fournisseur. */
        texteSource?: string
        /** Vrai UNIQUEMENT quand la nature « matière » a été jugée sur le
         *  document par le modèle (lecture texte ou image). La voie Factur-X
         *  publie ses lignes structurées SANS juger la nature : elle ne prouve
         *  rien sur l'étiquette « charge fixe », et ne doit pas la corriger —
         *  mesuré le 02/08, PENNYLANE (logiciel) « dé-fixée » à tort par cette
         *  voie. */
        corrigerEtiquette?: boolean
        /** Vrai quand la nature vient du BOUCHER (réponse à un doute) : le
         *  doute est levé par construction, quel que soit le mode de lecture. */
        natureImposee?: boolean
      },
    ) => {
      const { delivery_date, due_date, tronque } = ctx
      const luEnVision = ctx.luEnVision === true
      const totalHT = parseFloat(String(invoice.amount_ht || 0)) || 0
      // 3. Garde-fous déterministes de la lecture, à DEUX niveaux :
      //   · FACTURE : la somme des lignes doit boucler sur le total (à 3 %). Un total
      //     inconnu (0) n'est PLUS un laissez-passer — sans total, rien n'est
      //     vérifiable, donc on ne promeut aucun prix.
      //   · LIGNE : quand quantité ET prix unitaire figurent tous deux, leur produit
      //     doit égaler le montant (sinon l'un des deux est mal lu). C'est ce prix
      //     unitaire qui devient le point de mercuriale — on ne le publie que vérifié.
      const somme = lines.reduce((s, l) => s + l.amount_ht, 0)
      // AVOIRS : un avoir a un total NÉGATIF. `totalHT > 0` le déclarait donc
      // toujours incohérent, quelle que soit la qualité de la lecture, et tous ses
      // prix partaient en quarantaine. On compare l'écart signé à une base absolue.
      const base = Math.abs(totalHT)
      const ecartAbs = Math.abs(somme - totalHT)
      // Plancher d'un euro : une facture de 30 € tombait pour 0,95 € d'arrondi.
      const coherent = base > 0 && ecartAbs <= Math.max(1, base * 0.03)
      // LIGNES RESTÉES EN TTC : la somme tombe au centime sur le total TTC de la
      // comptabilité, pas sur le HT, et la conversion n'a pas pu se faire (taux
      // absents des lignes). Sans ce garde-fou, l'écart — égal à la TVA, souvent
      // sous les seuils — laissait passer des prix GONFLÉS DE LA TVA dans la
      // mercuriale, en silence. Mesuré sur LA FERME DE RACHOU : +5,5 % par prix.
      const totalTTCConnu = parseFloat(String(invoice.amount_ttc || 0)) || 0
      const resteEnTTC = totalTTCConnu !== 0
        && Math.abs(totalTTCConnu - totalHT) >= 0.05
        && ecartAbs > 0.02
        && Math.abs(somme - totalTTCConnu) <= 0.02
      // Une facture n'est jugée MAL LUE DANS SON ENSEMBLE qu'au-delà d'un écart
      // massif. Entre les deux, le contrôle qui compte est celui de la LIGNE
      // (qté × PU = montant) : punir vingt lignes justes pour la faute d'une
      // seule mettait 15 % des prix au rebut sans raison.
      const factureSuspecte = base <= 0 || ecartAbs > Math.max(50, base * 0.15) || tronque || resteEnTTC
      /** L'ASSIETTE du prix unitaire : ce par quoi il faut le multiplier pour
       *  retomber sur le montant de la ligne.
       *
       *  Sur une facture de boucherie, la ligne aligne le nombre de colis, le
       *  poids et le prix au kilo — et c'est le POIDS qui porte le prix, pas le
       *  nombre de colis. Tant que le format ne connaissait qu'une quantité,
       *  « 2 pièces × 14,97 €/kg » était comparé à 224,73 € : le contrôle
       *  échouait, et un prix parfaitement lu partait en quarantaine. Mesuré le
       *  31/07 : 32 prix refusés sur des factures dont la somme des lignes
       *  tombait pourtant au centime près. */
      // Le contrôle par ligne (recoupement qté × PU = montant, choix de
      // l'assiette poids ou pièces, dérivation d'un prix absent) vivait ici. Il
      // est parti dans `lib/invoice-lines` au lot 57 : un module PUR, couvert
      // par 56 assertions, qui décide aussi de réparer une quantité plutôt que
      // de jeter un prix juste. Deux vérités sur le garde-fou le plus sensible
      // du projet, c'était une de trop.

      // 4. Rattachement aux articles — par code fournisseur, sinon libellé normalisé.
      const supplierKey = normalizeSupplierName(supplierSociete(invoice.supplier_name || '')) || ''
      // PAGINÉE. Sans ça, au-delà de mille réfs chez un même fournisseur, les
      // index `byCode`/`byName` construits juste après étaient incomplets : un
      // article existant n'était pas retrouvé, et la suite en CRÉAIT UN SECOND —
      // un doublon qui repartait sans prix ni historique. Le catalogue se
      // dédoublait tout seul, en silence, précisément chez les fournisseurs les
      // plus fournis.
      const existingPage = await fetchAllPages<any>(apres => {
        let q = service.from('articles')
          .select('id, article_code, name_key, last_price_date, price_count')
          .eq('client_id', clientId).eq('supplier_key', supplierKey)
        if (apres) q = q.gt('id', apres)
        return q.order('id', { ascending: true })
      })
      const existing = existingPage.rows
      if (existingPage.tronque) {
        // Mieux vaut ne rien créer que doublonner : on le dit et on s'arrête là
        // pour cette facture.
        console.error('[extract-lines] réfs fournisseur tronquées — création suspendue', supplierKey)
        return NextResponse.json({ error: 'Catalogue fournisseur trop volumineux pour être lu d’un coup : lecture suspendue pour éviter de créer des doublons.' }, { status: 503 })
      }
      // Le code fournisseur est rangé sous sa CLÉ, pas sous son écriture :
      // « 003180 » et « 3180 » sont le même produit, et les distinguer créait
      // un second article qui repartait sans prix ni historique (lot 70,
      // cf. lib/article-code).
      const byCode = new Map<string, any>()
      const byName = new Map<string, any>()
      for (const a of existing || []) {
        const cle = cleCodeArticle(a.article_code)
        if (cle) byCode.set(cle, a)
        else byName.set(String(a.name_key), a)
      }

      const rows: any[] = []
      let prixPromus = 0, prixQuarantaine = 0
      for (const l of lines) {
        const nameKey = normText(l.designation)
        const cleCode = cleCodeArticle(l.article_code)
        let art = (cleCode && byCode.get(cleCode)) || byName.get(nameKey) || null
        // LE VERDICT DE LA LIGNE — lib/invoice-lines, module pur, 56 assertions.
        //
        // Il remplace la décision qui vivait ici. Deux changements, tous deux nés
        // de l'ouverture des PDF le 04/08 :
        //
        //  · quand le prix unitaire est LU mais que rien ne se recoupe, c'est la
        //    QUANTITÉ qu'on répare (montant ÷ prix), pas le prix qu'on jette.
        //    DAT-SCHAUB écrivait « seau de 10 kg » et on lisait « 1 seau » ;
        //    METRO éclate sa quantité en « Qté × Colisage » et on n'en lisait
        //    qu'une. Dans les deux cas le prix imprimé était juste ;
        //  · un prix écarté est désormais CONSERVÉ dans `unit_price_rejected`.
        //    Il n'est jamais publié — la quarantaine reste entière — mais on ne
        //    perd plus l'information, qu'il fallait jusqu'ici rouvrir les PDF
        //    pour retrouver.
        const verdict = verdictLigne(l, factureSuspecte)
        const prixRetenu = verdict.prix_retenu
        // Un AVOIR ne compte ni comme prix publié ni comme prix en quarantaine :
        // ne pas en tirer de prix est le comportement voulu, pas un échec de
        // lecture. Les compter gonflait le bilan d'alertes sans rien à faire.
        if (!verdict.avoir) {
          if (prixRetenu !== null) prixPromus++
          else if (verdict.prix_ecarte !== null) prixQuarantaine++
        }

        // L'article est CRÉÉ sans prix : son dernier prix se déduit de ses
        // lignes, et ses lignes n'existent pas encore. Le recalage de l'étape 5
        // le lui donnera — une seule écriture du prix, au même endroit pour
        // tout le monde.
        if (!art && nameKey) {
          const { data: created } = await service.from('articles').insert({
            client_id: clientId, name: l.designation, name_key: nameKey, unit: l.unit,
            supplier_key: supplierKey, supplier_name: invoice.supplier_name,
            article_code: l.article_code,
            last_price_ht: null, last_price_date: null, price_count: 0,
          }).select('id, article_code, name_key, last_price_date, price_count').single()
          if (created) {
            art = created
            const cle = cleCodeArticle(created.article_code)
            if (cle) byCode.set(cle, created)
            else byName.set(String(created.name_key), created)
          }
        }
        // Le prix de l'article n'est PLUS poussé ici, ligne par ligne.
        //
        // Il l'était, en accumulant : chaque ligne promue écrivait son prix, et
        // une ligne qui cessait de l'être ne reprenait jamais le sien. Après le
        // lot 60, les prix faux ont bien quitté `invoice_lines` — et la
        // mercuriale a continué de les afficher. 86 articles portaient un prix
        // qu'aucune ligne existante ne pouvait plus expliquer.
        //
        // Le dernier prix est une donnée DÉRIVÉE : elle se recalcule depuis les
        // lignes (étape 5), elle ne s'accumule pas.

        rows.push({
          client_id: clientId, invoice_id: invoice.id, article_id: art?.id ?? null,
          designation: l.designation, article_code: l.article_code,
          // La quantité RÉPARÉE prend la place de celle qui a été lue quand le
          // prix imprimé et le montant désignent une autre valeur ; l'originale
          // reste dans `quantity_raw`, pour pouvoir revenir en arrière et
          // mesurer la fréquence du défaut par fournisseur.
          quantity: verdict.quantite_reparee ?? l.quantity,
          quantity_raw: verdict.quantite_reparee !== null ? l.quantity : null,
          unit: l.unit,
          // Le poids facturé est CONSERVÉ tel que lu — sauf quand les deux
          // colonnes ont été échangées, cas où le « poids » lu était le prix.
          // Il n'est alors pas perdu : c'est lui qui devient `unit_price_ht`
          // sur la même ligne, et le poids rendu ici est le conditionnement
          // annoncé par le libellé (« 5L » × 2 bidons = 10 L).
          weight_kg: verdict.poids_repare ?? l.weight_kg,
          // Prix en quarantaine = null : la mercuriale prend le point de prix le plus
          // récent depuis invoice_lines ; un prix non vérifié n'en est pas un.
          unit_price_ht: prixRetenu,
          // Le prix LU puis écarté — diagnostic seulement, jamais lu par la
          // mercuriale ni par les fiches.
          unit_price_rejected: verdict.prix_ecarte,
          amount_ht: l.amount_ht, tva_rate: l.tva_rate ?? invoice.tva_rate,
        })
      }

      // 5. Remplacement atomique des lignes de CETTE facture (ré-extraction incluse)
      //
      // Les articles que portaient les ANCIENNES lignes sont relevés avant la
      // purge : si la relecture n'en publie plus le prix, ce sont eux qu'il
      // faut recaler — et après la purge, plus rien ne dirait lesquels.
      const avant = await etatDesLignes(service, clientId, invoice.id)
      const { error: delErr } = await service.from('invoice_lines').delete().eq('invoice_id', invoice.id).eq('client_id', clientId)
      if (delErr) throw new Error(`Purge des anciennes lignes : ${delErr.message}`)
      const { error: insErr } = await service.from('invoice_lines').insert(rows)
      if (insErr) throw new Error(`Insertion des lignes : ${insErr.message}`)

      // Le dernier prix des articles touchés, RECALCULÉ depuis leurs lignes.
      // Ni avant ni pendant : après, quand les lignes disent la vérité.
      await recalerArticles(service, clientId, [
        ...avant.articles,
        ...rows.map(r => r.article_id as string | null),
      ])

      // 6. Statut + dates lues sur le PDF (jamais d'écrasement d'une valeur déjà posée).
      // 'done' seulement si la facture boucle ET aucun prix en quarantaine ; sinon
      // 'partial' : les lignes sont gardées, mais des prix restent à valider.
      // « Lue complètement » exige au moins UN prix publié : une facture dont
      // aucune ligne n'a de prix calculable passait pour un succès (quarantaine
      // à zéro) alors qu'elle n'apportait rien à la mercuriale.
      //
      // UNE RELECTURE PEUT FAIRE PERDRE DES PRIX — et ne le disait à personne.
      //
      // Mesuré le 05/08 : la MÊME facture METRO, lue trois fois, a donné 19,
      // puis 10, puis 9 prix. La lecture n'est pas stable (la colonne poids est
      // parfois captée, parfois pas, et l'unité passe de « l » à « pièce »), et
      // la publication REMPLACE les lignes précédentes sans jamais regarder ce
      // qu'elle efface. Un boucher qui relance une lecture pour arranger une
      // ligne peut en perdre neuf, sans un mot à l'écran.
      //
      // On ne BLOQUE pas pour autant : le lot 60 retirait des prix VOLONTAIREMENT
      // — ils étaient faux — et « moins de prix » n'est donc pas « moins bien ».
      // La règle de la maison s'applique telle quelle : on annonce, on ne cache
      // pas, et on laisse le boucher décider. Une relecture qui régresse n'est
      // simplement plus « lue complètement » : elle reste à regarder.
      const perteDePrix = avant.prixPublies > 0 && prixPromus < avant.prixPublies
      const complet = coherent && !tronque && prixQuarantaine === 0 && prixPromus > 0 && !perteDePrix
      // Motif d'une lecture PARTIELLE : les deux chiffres qui expliquent tout —
      // l'écart somme/total et le nombre de prix écartés — étaient jusqu'ici
      // calculés, renvoyés dans le JSON, puis perdus. Ils sont maintenant écrits.
      const ecart = +(somme - totalHT).toFixed(2)
      const motifPartiel = complet ? null : [
        perteDePrix
          ? `Cette relecture publie ${prixPromus} prix, contre ${avant.prixPublies} à la lecture précédente : ${avant.prixPublies - prixPromus} prix ${avant.prixPublies - prixPromus > 1 ? 'ont disparu' : 'a disparu'} de la mercuriale. Si la lecture d'avant était meilleure, relancez-en une autre — le document n'a pas changé, c'est la lecture qui varie.`
          : null,
        tronque
          ? `La réponse de lecture a été coupée : il manque des lignes en fin de facture. Les prix ne sont pas publiés tant que la lecture n'est pas entière.`
          : null,
        luEnVision
          ? `Document sans texte lu en image (scan) — vérifiez les montants avant de valider.`
          : null,
        resteEnTTC
          ? `Les montants des lignes sont TVA COMPRISE (leur somme tombe sur le total TTC) et les taux de TVA manquent sur les lignes : impossible de convertir en HT. Aucun prix publié — ils seraient gonflés de la TVA.`
          : null,
        !coherent && !resteEnTTC
          ? `La somme des lignes lues (${somme.toFixed(2)} €) ne boucle pas sur le total de la facture (${totalHT.toFixed(2)} €) : ${ecart > 0 ? '+' : ''}${ecart.toFixed(2)} €.${factureSuspecte ? ' Écart trop important : aucun prix retenu.' : ' Écart limité : les lignes qui se recoupent ont quand même donné leur prix.'}`
          : null,
        prixPromus === 0 && prixQuarantaine === 0 && rows.length > 0
          ? `Aucune ligne ne porte de prix unitaire exploitable : rien à publier dans la mercuriale.`
          : null,
        prixQuarantaine > 0
          ? `${prixQuarantaine} prix écarté${prixQuarantaine > 1 ? 's' : ''} : non vérifiable${prixQuarantaine > 1 ? 's' : ''} contre le montant de la ligne, donc non publié${prixQuarantaine > 1 ? 's' : ''} dans la mercuriale.`
          : null,
        `${rows.length} ligne${rows.length > 1 ? 's' : ''} conservée${rows.length > 1 ? 's' : ''}, ${prixPromus} prix retenu${prixPromus > 1 ? 's' : ''}.`,
      ].filter(Boolean).join(' ')
      const patch: Record<string, unknown> = {}
      // GARDE-FOU DATES (31/07) : une date de livraison lue par l'IA n'est écrite
      // que si elle est PLAUSIBLE — jamais l'échéance de paiement recopiée, jamais
      // une date hors de la fenêtre autour de la facture. Mesuré en prod : 10
      // livraisons fausses sur 61, dont 8 égales à l'échéance. Une date écartée
      // laisse la colonne vide : l'imputation retombe sur la date de facture
      // (déterministe) au lieu de partir dans une autre semaine.
      const echeance = due_date ?? (invoice.due_date as string | null) ?? null
      const livraisonRetenue = plausibleDelivery(delivery_date, invoice.invoice_date as string | null, echeance)
      if (livraisonRetenue && !invoice.delivery_date) patch.delivery_date = livraisonRetenue
      if (due_date && !invoice.due_date) patch.due_date = due_date
        patch.lines_mode = ctx.mode
        patch.lines_pass = ctx.passe ?? ctx.mode
        patch.lines_attempts = ctx.tentatives ?? 1
        // Le boucher doit savoir qu'une facture n'est passée qu'au rattrapage :
        // c'est le signe d'un fournisseur dont la mise en page nous résiste, et
        // donc le premier endroit à regarder quand un prix semble étrange.
        const mentionPasse = (ctx.tentatives ?? 1) > 1
          ? `Lue au ${ctx.tentatives}e essai (${ctx.passe === 'vision' ? 'lecture du document en image' : 'relecture avec l’écart signalé'}).`
          : null
        // L'étiquette « charge fixe » de l'import est CORRIGÉE par le document :
        // des lignes de matière publiées prouvent le contraire, et laisser
        // l'étiquette fausserait les marges, où les charges fixes sont comptées
        // à part des achats.
        const corriger = invoice.is_fixed_charge && ctx.corrigerEtiquette === true
        const mentionEtiquette = corriger
          ? `Étiquetée « charge fixe » à l'import, mais le document facture de la matière : étiquette corrigée.`
          : null
        if (corriger) patch.is_fixed_charge = false
        // FILE DE DOUTE (lot 29) : une nature « matière » jugée sur une lecture
        // IMAGE est fragile — mesuré en production, des frais bancaires publiés
        // comme articles. Le drapeau demande une confirmation d'un clic ; il ne
        // retire rien (les garde-fous de chiffres ont déjà fait leur travail).
        // Une lecture texte, une facture électronique ou un verdict du boucher
        // effacent le doute.
        const douteMatiere = ctx.natureImposee === true ? false : luEnVision
        patch.nature_doute = douteMatiere
        const mentionDoute = douteMatiere
          ? `Nature (matière) jugée sur une lecture image — confirmez d'un clic que c'est bien de la matière première.`
          : null
        const motifFinal = [ctx.motifSuffixe, mentionEtiquette, mentionDoute, mentionPasse, motifPartiel].filter(Boolean).join(' ') || null
        await marquer(invoice.id, complet ? 'done' : 'partial', motifFinal, patch)

        // La lecture rejoint la bibliothèque SI elle boucle au centime — c'est
        // `rangerExemple` qui tranche, sur le total, pas sur notre satisfaction.
        // Une facture bien lue aujourd'hui aide à lire la suivante du même
        // fournisseur : c'est le seul apprentissage qui ne peut pas mal tourner,
        // puisque son unique critère d'entrée vient de la comptabilité.
        if (ctx.texteSource) {
          await rangerExemple(service, {
            clientId, supplierKey: cleFournisseur, invoiceId: String(invoice.id),
            texte: ctx.texteSource, lignes: lines, totalHT,
            promptVersion: PROMPT_LIGNES_VERSION,
          })
        }

        return NextResponse.json({
          success: true, status: complet ? 'done' : 'partial', mode: ctx.mode,
          lines: rows.length, prix_promus: prixPromus, prix_en_quarantaine: prixQuarantaine,
          prix_avant: avant.prixPublies, perte_de_prix: perteDePrix,
          somme: +somme.toFixed(2), total_facture: totalHT,
          motif: motifFinal,
        })
    }

  // ── Reconnaissance en trois étages : seules les factures de MATIÈRE (ingrédients,
  // consommables de production) nourrissent la mercuriale. ──
  // Étage 1 — l'étiquette « charge fixe » posée à l'IMPORT n'est plus une
  // sentence : c'est un INDICE. Mesuré le 02/08 : SOCAVI (1 229 €), DAT-SCHAUB,
  // DAVID MASTER, AURIBAULT étiquetées « charge fixe » par le classement
  // d'import — de la viande, jamais lue, invisible de la mercuriale. Le
  // DOCUMENT tranche, comme partout ailleurs dans cette chaîne. L'étiquette ne
  // conclut seule que lorsqu'il n'y a PAS de document : une charge prélevée
  // sans facture n'a rien qui puisse la contredire. Avec un document, on lit —
  // une fois par fournisseur, le verrou de l'étage 2 fait le reste.
  if (invoice.is_fixed_charge && !invoice.file_path) {
    await marquer(invoice.id, 'hors_matiere', 'Charge fixe (loyer, abonnement, assurance…) sans document à lire — jamais de la matière première.')
    return NextResponse.json({ success: true, status: 'hors_matiere', reason: 'charge fixe sans document' })
  }

  // Étage 2 — mémoire fournisseur : si ce fournisseur a déjà été reconnu hors
  // matière et n'a JAMAIS produit de lignes, inutile de relire chaque nouvelle
  // facture (Wiismile revient tous les mois). Un seul appel IA par fournisseur.
  // Le corps { relire: true } SAUTE ce verrou : c'est la voie de la relecture
  // volontaire d'UNE facture — celle que le motif du verrou promet depuis le
  // début (« relancez la lecture »), et qui sans ce drapeau retombait sur le
  // verrou à l'infini. Le document tranche toujours ; on ne force jamais un
  // résultat, seulement une nouvelle audience.
  // FILE DE DOUTE (lot 29) : le corps { nature: 'matiere' } porte la réponse
  // du boucher à un doute — « c'est bien de la matière ». Il implique la
  // relecture, et le verdict humain l'emporte sur le classement automatique
  // (jamais sur les garde-fous de chiffres, qui ne se discutent pas).
  const natureVoulue = corpsRecu?.nature === 'matiere' ? 'matiere' : null
  const relire = corpsRecu?.relire === true || natureVoulue !== null
  const supKey = societeKey(invoice.supplier_name || '')
  if (supKey && !relire) {
    const { data: histo } = await service.from('invoices')
      .select('supplier_name, lines_status, nature_doute')
      .eq('client_id', clientId)
      .in('lines_status', ['done', 'partial', 'hors_matiere'])
    let dejaHors = false, dejaMatiere = false
    for (const h of histo || []) {
      if (societeKey(h.supplier_name || '') !== supKey) continue
      // Un doute non tranché ne verrouille RIEN, dans aucun sens : seul un
      // classement assumé (sans drapeau) fait mémoire fournisseur.
      if (h.nature_doute === true) continue
      if (h.lines_status === 'hors_matiere') dejaHors = true
      else dejaMatiere = true
    }
    if (dejaHors && !dejaMatiere) {
      await marquer(invoice.id, 'hors_matiere', `Fournisseur déjà reconnu hors matière sur une facture précédente — non relu. Si c'est une erreur, relancez la lecture de cette facture.`)
      return NextResponse.json({ success: true, status: 'hors_matiere', reason: 'fournisseur déjà reconnu hors matière' })
    }
  }

  if (!invoice.file_path) {
    await marquer(invoice.id, 'no_file', 'Aucun PDF archivé pour cette facture : rien à lire. Le PDF se récupère par une nouvelle synchronisation du connecteur.')
    return NextResponse.json({ error: 'Aucun PDF pour cette facture — relancez une synchronisation Pennylane.' }, { status: 422 })
  }

  try {
    // 1. PDF depuis le bucket privé
    const { data: file, error: dlErr } = await service.storage.from('invoice-files').download(invoice.file_path)
    if (dlErr || !file) throw new Error(`Téléchargement du PDF impossible : ${dlErr?.message ?? 'fichier vide'}`)
    const buffer = Buffer.from(await file.arrayBuffer())
    // Lecture PAR COORDONNÉES (colonnes séparées) ; repli sur le texte plat de
    // pdf-parse seulement si le PDF résiste. C'est ce texte propre qui est donné
    // à l'IA, au lieu du texte plat qui colle « 12.4kg5.8071.92 ».
    // ── FACTURE ÉLECTRONIQUE : le document se lit, il ne se devine pas ──
    // Depuis le 1er septembre 2026, un PDF ordinaire ne compte plus comme une
    // facture électronique : le document doit porter ses données STRUCTURÉES.
    // Quand elles sont là, la quantité, l'unité, le prix et le montant de chaque
    // ligne sont des champs nommés — et l'unité est normalisée (KGM = kilo,
    // H87 = pièce), ce qui supprime d'un coup le problème du colis compté pour
    // un kilo. Zéro requête IA, zéro quarantaine, un résultat reproductible.
    const facturx = lireFacturX(buffer)
    if (facturx && facturx.lines.length > 0) {
      const totalXml = facturx.total_ht
      const totalFacture = parseFloat(String(invoice.amount_ht || 0)) || 0
      // Le total du XML doit s'accorder avec celui déjà connu de la facture.
      // S'il diverge, ce n'est pas le bon document : on ne le croit pas sur
      // parole et on repasse par la lecture ordinaire.
      const accord = totalXml === null || totalFacture === 0
        || Math.abs(Math.abs(totalXml) - Math.abs(totalFacture)) <= Math.max(0.05, Math.abs(totalFacture) * 0.01)
      if (accord) {
        const lignesXml: ExtractedLine[] = facturx.lines.map(l => ({
          designation: l.designation,
          article_code: l.article_code,
          quantity: l.quantity,
          unit: l.unit,
          unit_price_ht: l.unit_price_ht,
          amount_ht: l.amount_ht,
          tva_rate: l.tva_rate,
          weight_kg: l.weight_kg,
        }))
        return await publierLignes(lignesXml, {
          mode: `facturx-${facturx.profil}`,
          delivery_date: facturx.delivery_date,
          due_date: facturx.due_date,
          tronque: false,
          motifSuffixe: `Lu dans les données structurées de la facture électronique (${facturx.profil.toUpperCase()}) — sans interprétation.`,
          passe: 'facturx', tentatives: 1,
        })
      }
    }

    const coordLines = await pdfToLines(buffer)
    let pdfText: string
    if (coordLines.length > 0) {
      pdfText = coordLines.join('\n')
    } else {
      const _m = await import('pdf-parse') as any
      const pdfParse = typeof _m.default === 'function' ? _m.default : _m
      pdfText = (await pdfParse(buffer)).text
    }

    // 2. Extraction des lignes
    const totalHT = parseFloat(String(invoice.amount_ht || 0)) || 0
    const totalTTC = parseFloat(String(invoice.amount_ttc || 0)) || 0

    // SCAN OU PHOTO ? Un PDF sans couche texte rend zéro item par coordonnées et
    // une chaîne vide par pdf-parse. On l'envoyait quand même à l'IA, qui ne
    // pouvait rien produire, et la facture finissait « erreur » sans explication.
    // C'est la signature d'un fournisseur entier à 0 % (LA VIANDE CHAUNOISE :
    // 8 factures, 16 325 €, aucune lue). On mesure d'abord, on bascule ensuite
    // sur une lecture VISION du document — le PDF lui-même, pas son texte.
    const lettres = (pdfText.match(/[A-Za-zÀ-ÿ]/g) || []).length
    const sansTexte = lettres < 200

    // ARCHIVAGE du texte soumis, AVANT toute tentative d'extraction — donc y
    // compris pour les factures qui vont échouer : ce sont précisément
    // celles-là qu'il faudra rejouer après avoir corrigé le prompt. Sans cet
    // archivage, aucun changement d'extraction n'est mesurable, et le corpus
    // ne se remplit jamais.
    await service.from('invoices').update({
      lines_source_text: pdfText.slice(0, TEXTE_MAX),
      lines_mode: sansTexte ? 'vision' : 'texte',
      lines_prompt_version: PROMPT_LIGNES_VERSION,
    }).eq('id', invoice.id).eq('client_id', clientId)

    let luEnVision = false
    let ttcConverti = false
    let extraction: { lines: ExtractedLine[]; delivery_date: string | null; due_date: string | null; nature: 'matiere' | 'hors_matiere'; tronque: boolean; periode_du: string | null; periode_au: string | null }
    let passe = sansTexte ? 'vision' : 'texte'
    let tentatives = 1
    if (sansTexte) {
      try {
        extraction = await extractLinesVision(buffer, totalHT)
        luEnVision = true
        // Un scan peut lui aussi porter des montants TTC : même conversion,
        // même arbitre (le total TTC de la comptabilité), même code.
        const enHT = convertirLignesTTC(extraction.lines, totalHT, totalTTC)
        if (enHT) { extraction = { ...extraction, lines: enHT }; ttcConverti = true }
      } catch (visionErr) {
        const d = visionErr instanceof Error ? visionErr.message : String(visionErr)
        await marquer(invoice.id, 'scan_illisible',
          `Ce PDF ne contient pas de texte (${lettres} lettres lues) : c'est un scan ou une photo. La lecture image a échoué elle aussi (${d.slice(0, 200)}). Demandez au fournisseur une facture PDF native — c'est gratuit et définitif.`)
        return NextResponse.json({ error: 'PDF sans texte exploitable (scan) — lecture image indisponible.' }, { status: 422 })
      }
    } else {
      // Passes 1 et 2 (texte, puis reprise avec l'écart nommé) : dans lib/, pour
      // que la route de MESURE rejoue exactement le même chemin. Un garde-fou
      // qui ne teste pas la chaîne réelle ne garde rien.
      // BIBLIOTHÈQUE DE MISES EN PAGE : au plus deux exemples déjà vérifiés —
      // celui du même fournisseur d'abord, puis la disposition la plus proche.
      // Ce qui fait échouer une lecture est presque toujours la mise en page, et
      // un exemple juste de la MÊME disposition vaut mieux qu'une règle de plus.
      const exemples = consigneExemples(
        await choisirExemples(service, clientId, cleFournisseur, pdfText).catch(() => []),
      )
      const lecture = await lireTexteAvecReprise(pdfText, totalHT, exemples, totalTTC)
      extraction = lecture
      passe = lecture.passe
      tentatives = lecture.tentatives
      if (lecture.ttc) ttcConverti = true

      // Passe 3 — le document REGARDÉ au lieu d'être lu. Elle vit ici parce
      // qu'elle a besoin du PDF, que le corpus archivé ne contient pas. Elle
      // rattrape les couches texte abîmées, où les caractères ressortent espacés
      // (« F A : 0 . 8 8 ») et où aucune relecture du même texte ne peut aider.
      const ecartDe = (ls: ExtractedLine[]) => Math.abs(sommeLignes(ls) - totalHT)
      // Zéro ligne déclenche aussi la passe image — sauf « hors matière » assumé
      // sur une petite facture, où ne rien lire est le comportement voulu : on ne
      // paie pas une lecture image pour confirmer chaque abonnement. Une facture
      // significative (> 500 €) sans aucune ligne, elle, mérite d'être regardée
      // avant d'être classée — même seuil que le garde-fou d'en dessous.
      const lignesVides = extraction.lines.length === 0
      const meriteVision = totalHT !== 0 && (
        lignesVides
          ? (extraction.nature === 'matiere' || totalHT > 500)
          : ecartDe(extraction.lines) > 0.02
      )
      if (meriteVision) {
        tentatives++
        try {
          const vu = await extractLinesVision(buffer, totalHT)
          // La lecture image d'un document TTC rend des lignes TTC : conversion
          // AVANT l'arbitrage, pour que la comparaison se fasse en HT contre HT.
          let vuLignes = vu.lines
          let vuTtc = false
          const vuHT = convertirLignesTTC(vuLignes, totalHT, totalTTC)
          if (vuHT) { vuLignes = vuHT; vuTtc = true }
          const nbPrix = (ls: ExtractedLine[]) => ls.filter(l => l.unit_price_ht !== null).length
          const avant = ecartDe(extraction.lines)
          const apres = ecartDe(vuLignes)
          const mieux = vuLignes.length > 0 && (
            apres < avant - 0.005
            || (Math.abs(apres - avant) <= 0.005 && nbPrix(vuLignes) > nbPrix(extraction.lines))
          )
          if (mieux) { extraction = { ...vu, lines: vuLignes }; passe = 'vision'; luEnVision = true; ttcConverti = vuTtc }
        } catch (e) {
          console.error('[extract-lines] lecture image indisponible:', e instanceof Error ? e.message : e)
        }
      }
    }
    const { lines, delivery_date, due_date, tronque } = extraction
    let nature = extraction.nature
    let motifNatureImposee: string | undefined
    // RÉPONSE DU BOUCHER à un doute : « c'est de la matière ». Son verdict
    // l'emporte sur le classement automatique — mais jamais sur les chiffres :
    // les lignes publiées passent par les mêmes garde-fous que toujours, et
    // sans aucune ligne lisible, on le dit au lieu d'inventer.
    if (natureVoulue === 'matiere' && nature === 'hors_matiere') {
      if (lines.length === 0) {
        await marquer(invoice.id, 'error',
          `Vous avez indiqué que cette facture porte de la matière, mais aucune ligne d'article n'est lisible sur le document. Vérifiez le PDF — s'il s'agit d'un relevé ou d'un échéancier, c'est bien une charge.`,
          { nature_doute: false })
        return NextResponse.json({ error: 'Aucune ligne d\'article lisible malgré la nature indiquée.' }, { status: 422 })
      }
      nature = 'matiere'
      motifNatureImposee = `Classée « hors matière » par la lecture automatique, mais vous avez indiqué qu'il s'agit de matière : les lignes lues sont publiées.`
    }

    // Étage 3 — la nature lue sur le PDF lui-même. C'est lui qui rattrape les
    // catégories fausses du connecteur (des factures de viande arrivent en
    // « frais_divers ») : le document tranche, pas l'étiquette.
    // Un document illisible n'est PAS une qualification métier : sans texte ni
    // vision exploitable, on ne conclut jamais « hors matière » — sinon le
    // verrou fournisseur gèle toutes ses factures suivantes sans les lire.
    if (nature === 'hors_matiere' && lines.length === 0 && luEnVision && totalHT > 500) {
      await marquer(invoice.id, 'error',
        `Document lu en image mais aucun article reconnu, sur une facture de ${totalHT.toFixed(2)} € : trop gros pour être classé « hors matière » sans preuve. À vérifier à la main.`)
      return NextResponse.json({ error: 'Lecture image sans résultat sur une facture significative.' }, { status: 422 })
    }

    if (nature === 'hors_matiere') {
      // Une facture requalifiée en charge retire ses points de prix de la
      // mercuriale : les articles qu'elle alimentait doivent retomber sur leur
      // dernière facture d'achat, ou n'avoir plus de prix du tout.
      const touches = (await etatDesLignes(service, clientId, invoice.id)).articles
      await service.from('invoice_lines').delete().eq('invoice_id', invoice.id).eq('client_id', clientId)
      await recalerArticles(service, clientId, touches)
      const patch: Record<string, unknown> = {}
      if (due_date && !invoice.due_date) patch.due_date = due_date
      // PÉRIODE FACTURÉE lue sur le document. Le prorata hebdomadaire des
      // charges reposait sur une durée DEVINÉE à l'import (30 jours par défaut,
      // sur le seul nom du fournisseur) : une facture annuelle répartie sur 30
      // jours gonfle la structure de charges d'un facteur douze. La période lue
      // est VÉRIFIÉE en code avant d'être écrite — bornes ordonnées, durée
      // plausible, date de facture au voisinage — et sans période lisible, on
      // ne touche à rien : jamais de date devinée.
      let motifPeriode = ''
      const du = extraction.periode_du
      const au = extraction.periode_au
      if (du && au) {
        const dDu = new Date(du + 'T00:00:00Z').getTime()
        const dAu = new Date(au + 'T00:00:00Z').getTime()
        const jours = Math.round((dAu - dDu) / 86400000) + 1
        const dFact = invoice.invoice_date ? new Date(String(invoice.invoice_date) + 'T00:00:00Z').getTime() : null
        // Une charge se facture au début de sa période (loyer, abonnement,
        // parfois d'avance) ou après relevé (énergie) : la date de facture doit
        // rester au voisinage de la période, sinon la lecture s'est trompée.
        const auVoisinage = dFact === null || (dFact >= dDu - 45 * 86400000 && dFact <= dAu + 60 * 86400000)
        const montantCharge = parseFloat(String(invoice.amount_ht || 0)) || 0
        if (jours >= 1 && jours <= 400 && auVoisinage && montantCharge !== 0) {
          patch.period_days = jours
          patch.prorata_ht = Math.round((montantCharge * 7 / jours) * 100) / 100
          // C'est la SEULE période vérifiée du projet : on la marque comme lue,
          // ce qui autorise le moteur hebdomadaire à réinjecter ce prorata.
          patch.period_source = PERIODE_LUE
          patch.is_fixed_charge = true
          motifPeriode = ` Période facturée lue sur le document : du ${du} au ${au} (${jours} jours) — part hebdomadaire recalculée.`
        }
      }
      // FILE DE DOUTE (lot 29). Deux classes mesurées de « hors matière »
      // fragiles : la nature jugée sur une LECTURE IMAGE (dérive constatée dans
      // les deux sens), et une grosse facture — un classement qui sort plus de
      // 500 € de la mercuriale mérite un œil humain. Le doute ne change pas le
      // classement (rien n'est publié, comme toujours) : il pose un drapeau que
      // le boucher tranche d'un clic. Une relecture sereine efface le doute.
      const douteHors = luEnVision || totalHT > 500
      patch.nature_doute = douteHors
      const motifDoute = douteHors
        ? ` À confirmer d'un clic : ${luEnVision ? 'nature jugée sur une lecture image (scan)' : `facture de ${totalHT.toFixed(2)} € écartée de la mercuriale`}.`
        : ''
      await marquer(invoice.id, 'hors_matiere', 'Le document lui-même ne porte aucune matière première (matériel, service, abonnement).' + motifPeriode + motifDoute, patch)
      return NextResponse.json({ success: true, status: 'hors_matiere', reason: 'facture sans matière première (matériel, service, abonnement…)', periode: motifPeriode ? { du, au } : null, nature_doute: douteHors })
    }

    if (lines.length === 0) {
      await marquer(invoice.id, 'error', luEnVision
        ? `Aucune ligne d'article reconnue à la lecture image de ce scan. Demandez au fournisseur une facture PDF native.`
        : `Aucune ligne d'article reconnue sur ce PDF (${pdfText.trim().length} caractères de texte lus, ${lettres} lettres).`)
      return NextResponse.json({ error: 'Aucune ligne reconnue sur ce PDF.' }, { status: 422 })
    }

    return await publierLignes(lines, {
      mode: luEnVision ? 'vision' : 'texte',
      delivery_date, due_date, tronque, luEnVision,
      passe, tentatives,
      motifSuffixe: [
        motifNatureImposee,
        ttcConverti
          ? `Montants facturés TVA COMPRISE — convertis en HT ligne par ligne (taux imprimés), somme vérifiée au centime sur le total HT.`
          : undefined,
      ].filter(Boolean).join(' ') || undefined,
      // Une lecture CONVERTIE n'entre jamais dans la bibliothèque d'exemples :
      // ses montants HT ne figurent pas dans le texte du document — l'exemple
      // enseignerait au modèle de recalculer, l'inverse de sa consigne.
      texteSource: luEnVision || ttcConverti ? undefined : pdfText,
      // Ici — et seulement ici — la nature « matière » vient d'être jugée sur le
      // document lui-même : l'étiquette « charge fixe » peut être corrigée.
      corrigerEtiquette: true,
      natureImposee: motifNatureImposee !== undefined,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await marquer(invoice.id, 'error', msg.slice(0, 500))
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
