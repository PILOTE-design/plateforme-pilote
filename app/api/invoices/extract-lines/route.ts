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
import { normalizeSupplierName, supplierSociete, societeKey } from '@/lib/supplier-memory'
import { normText } from '@/lib/postes'
import { pdfToLines } from '@/lib/pdf-lines'
import { plausibleDelivery } from '@/lib/invoice-week'
import { lireFacturX } from '@/lib/facturx'
// Le MOTEUR d'extraction vit dans lib/ — un module de route n'exporte que ses
// verbes HTTP, et la route d'évaluation doit pouvoir rejouer exactement le même
// code sur un texte archivé (cf. lib/invoice-extract).
import {
  PROMPT_LIGNES_VERSION, TEXTE_MAX,
  extractLinesLong, extractLinesVision,
  type ExtractedLine,
} from '@/lib/invoice-extract'

// Jusqu'à trois passes de lecture pour une facture qui résiste (texte, reprise,
// image) : 60 s n'y suffisent plus. 300 s est le plafond réel de la plateforme,
// et la lecture reste déclenchée à la main, une facture à la fois.
export const maxDuration = 300


export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  /** Écrit l'issue de la lecture AVEC SON MOTIF (lot 1, 31/07).
   *
   *  Jusqu'ici chaque sortie posait un `lines_status` et jetait la raison : 26
   *  factures sur 118 étaient des boîtes noires, impossible de distinguer un
   *  scan illisible d'une somme qui ne boucle pas. Sans motif persisté, aucune
   *  correction de l'extraction n'est mesurable — c'est le préalable à tout le
   *  reste. Le motif est écrit en FRANÇAIS LISIBLE : il s'affiche tel quel au
   *  boucher, qui doit pouvoir décider quoi faire sans lire du code. */
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
      ...extra,
    }).eq('id', invoiceId)
  }

  const { invoice_id } = await request.json().catch(() => ({} as Record<string, unknown>))
  if (!invoice_id) return NextResponse.json({ error: 'invoice_id requis' }, { status: 400 })

  const { data: invoice } = await service.from('invoices')
    .select('id, supplier_name, invoice_date, amount_ht, tva_rate, file_path, delivery_date, due_date, is_fixed_charge')
    .eq('id', invoice_id).eq('client_id', clientId).maybeSingle()
  if (!invoice) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 })

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
      // Une facture n'est jugée MAL LUE DANS SON ENSEMBLE qu'au-delà d'un écart
      // massif. Entre les deux, le contrôle qui compte est celui de la LIGNE
      // (qté × PU = montant) : punir vingt lignes justes pour la faute d'une
      // seule mettait 15 % des prix au rebut sans raison.
      const factureSuspecte = base <= 0 || ecartAbs > Math.max(50, base * 0.15) || tronque
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
      /** L'assiette n'est PAS toujours le poids. Sur la même facture DAVID
       *  MASTER, la colonne « UF » vaut KG sur une ligne et PI sur la suivante :
       *  « SAUCISSON … KG 3 4,003 22,550 90,27 » se recoupe sur le POIDS
       *  (4,003 × 22,55 = 90,27), tandis que « ASPIC … PI 12 1,080 1,760 21,12 »
       *  se recoupe sur les PIÈCES (12 × 1,76 = 21,12) et pas du tout sur son
       *  poids. Préférer aveuglément le poids rejetait la seconde.
       *
       *  On ne devine donc pas l'assiette : on essaie les deux et on retient
       *  celle qui TOMBE JUSTE. C'est plus sûr qu'une règle — le recoupement
       *  lui-même désigne la bonne colonne. */
      const assietteQuiTombeJuste = (l: ExtractedLine): number | null => {
        if (l.unit_price_ht == null) return null
        const tol = Math.max(0.05, Math.abs(l.amount_ht) * 0.01)
        for (const c of [l.weight_kg, l.quantity]) {
          if (c == null || c === 0) continue
          if (Math.abs(c * l.unit_price_ht - l.amount_ht) <= tol) return c
        }
        return null
      }

      const ligneVerifiee = (l: ExtractedLine): boolean => {
        if (l.unit_price_ht == null) return true // rien à contredire
        const aUneAssiette = (l.weight_kg != null && l.weight_kg !== 0) || (l.quantity != null && l.quantity !== 0)
        if (!aUneAssiette) return true // prix seul : pas de contradiction vérifiable
        return assietteQuiTombeJuste(l) !== null
      }
      /** Un prix DÉRIVÉ (montant ÷ quantité) n'est pas un prix lu : il n'est
       *  retenu que si l'unité facturée est exploitable. Sans unité, la quantité
       *  peut être un nombre de colis pour un montant au kilo — et la mercuriale
       *  publierait un prix faux sans le moindre signal. */
      const uniteExploitable = (u: string | null): boolean => {
        const t = normText(u ?? '')
        return t !== '' && !/^[-+]?[0-9]/.test(t)
      }

      // 4. Rattachement aux articles — par code fournisseur, sinon libellé normalisé.
      const supplierKey = normalizeSupplierName(supplierSociete(invoice.supplier_name || '')) || ''
      const { data: existing } = await service.from('articles')
        .select('id, article_code, name_key, last_price_date, price_count')
        .eq('client_id', clientId).eq('supplier_key', supplierKey)
      const byCode = new Map<string, any>()
      const byName = new Map<string, any>()
      for (const a of existing || []) {
        if (a.article_code) byCode.set(String(a.article_code), a)
        else byName.set(String(a.name_key), a)
      }

      const rows: any[] = []
      let prixPromus = 0, prixQuarantaine = 0
      for (const l of lines) {
        const nameKey = normText(l.designation)
        let art = (l.article_code && byCode.get(l.article_code)) || byName.get(nameKey) || null
        const prixLu = l.unit_price_ht
        // Un poids facturé est une assiette SÛRE : il est en kilos par définition,
        // donc le prix qu'on en déduit est un prix au kilo — pas besoin que
        // l'unité de la ligne soit exploitable, elle ne décide de rien ici.
        const prixDerive = prixLu !== null ? null
          : l.weight_kg != null && l.weight_kg > 0
            ? +(l.amount_ht / l.weight_kg).toFixed(4)
            : l.quantity && l.quantity > 0 && uniteExploitable(l.unit)
              ? +(l.amount_ht / l.quantity).toFixed(4)
              : null
        const unitPrice = prixLu ?? prixDerive
        // QUARANTAINE : un prix ne devient un point de mercuriale que si la LIGNE
        // se recoupe (qté × PU = montant) et que la facture n'est pas massivement
        // fausse. Le seuil de 3 % ne condamne plus l'ensemble : il alerte, le
        // contrôle ligne à ligne tranche. Sinon l'article est rattaché SANS prix —
        // « prix manquant » signalé plutôt qu'un prix douteux publié en silence.
        const promouvoir = !factureSuspecte && ligneVerifiee(l) && unitPrice !== null
        if (unitPrice !== null) { if (promouvoir) prixPromus++; else prixQuarantaine++ }
        const prixRetenu = promouvoir ? unitPrice : null

        if (!art && nameKey) {
          const { data: created } = await service.from('articles').insert({
            client_id: clientId, name: l.designation, name_key: nameKey, unit: l.unit,
            supplier_key: supplierKey, supplier_name: invoice.supplier_name,
            article_code: l.article_code,
            last_price_ht: prixRetenu,
            last_price_date: promouvoir ? invoice.invoice_date : null,
            price_count: promouvoir ? 1 : 0,
          }).select('id, article_code, name_key, last_price_date, price_count').single()
          if (created) {
            art = created
            if (created.article_code) byCode.set(String(created.article_code), created)
            else byName.set(String(created.name_key), created)
          }
        } else if (art && promouvoir) {
          // Dernier prix : seule une facture plus récente (ou du même jour) le remplace.
          const patch: Record<string, unknown> = { price_count: (art.price_count || 0) + 1, updated_at: new Date().toISOString() }
          if (!art.last_price_date || invoice.invoice_date >= art.last_price_date) {
            patch.last_price_ht = unitPrice
            patch.last_price_date = invoice.invoice_date
          }
          await service.from('articles').update(patch).eq('id', art.id)
          art.price_count = (art.price_count || 0) + 1
        }
        // Une ligne non promue laisse l'article INCHANGÉ (son prix précédent reste).

        rows.push({
          client_id: clientId, invoice_id: invoice.id, article_id: art?.id ?? null,
          designation: l.designation, article_code: l.article_code, quantity: l.quantity,
          unit: l.unit,
          // Le poids facturé est CONSERVÉ tel que lu : c'est lui qui porte le prix
          // au kilo, et sans lui la ligne redeviendrait invérifiable à la relecture.
          weight_kg: l.weight_kg,
          // Prix en quarantaine = null : la mercuriale prend le point de prix le plus
          // récent depuis invoice_lines ; un prix non vérifié n'en est pas un.
          unit_price_ht: prixRetenu,
          amount_ht: l.amount_ht, tva_rate: l.tva_rate ?? invoice.tva_rate,
        })
      }

      // 5. Remplacement atomique des lignes de CETTE facture (ré-extraction incluse)
      const { error: delErr } = await service.from('invoice_lines').delete().eq('invoice_id', invoice.id).eq('client_id', clientId)
      if (delErr) throw new Error(`Purge des anciennes lignes : ${delErr.message}`)
      const { error: insErr } = await service.from('invoice_lines').insert(rows)
      if (insErr) throw new Error(`Insertion des lignes : ${insErr.message}`)

      // 6. Statut + dates lues sur le PDF (jamais d'écrasement d'une valeur déjà posée).
      // 'done' seulement si la facture boucle ET aucun prix en quarantaine ; sinon
      // 'partial' : les lignes sont gardées, mais des prix restent à valider.
      // « Lue complètement » exige au moins UN prix publié : une facture dont
      // aucune ligne n'a de prix calculable passait pour un succès (quarantaine
      // à zéro) alors qu'elle n'apportait rien à la mercuriale.
      const complet = coherent && !tronque && prixQuarantaine === 0 && prixPromus > 0
      // Motif d'une lecture PARTIELLE : les deux chiffres qui expliquent tout —
      // l'écart somme/total et le nombre de prix écartés — étaient jusqu'ici
      // calculés, renvoyés dans le JSON, puis perdus. Ils sont maintenant écrits.
      const ecart = +(somme - totalHT).toFixed(2)
      const motifPartiel = complet ? null : [
        tronque
          ? `La réponse de lecture a été coupée : il manque des lignes en fin de facture. Les prix ne sont pas publiés tant que la lecture n'est pas entière.`
          : null,
        luEnVision
          ? `Document sans texte lu en image (scan) — vérifiez les montants avant de valider.`
          : null,
        !coherent
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
        const motifFinal = [ctx.motifSuffixe, mentionPasse, motifPartiel].filter(Boolean).join(' ') || null
        await marquer(invoice.id, complet ? 'done' : 'partial', motifFinal, patch)

        return NextResponse.json({
          success: true, status: complet ? 'done' : 'partial', mode: ctx.mode,
          lines: rows.length, prix_promus: prixPromus, prix_en_quarantaine: prixQuarantaine,
          somme: +somme.toFixed(2), total_facture: totalHT,
          motif: motifFinal,
        })
    }

  // ── Reconnaissance en trois étages : seules les factures de MATIÈRE (ingrédients,
  // consommables de production) nourrissent la mercuriale. ──
  // Étage 1 — déterministe : une charge fixe (loyer, logiciel, leasing, assurance…)
  // n'est jamais de la matière. Zéro appel IA.
  if (invoice.is_fixed_charge) {
    await marquer(invoice.id, 'hors_matiere', 'Charge fixe (loyer, abonnement, assurance…) — jamais de la matière première.')
    return NextResponse.json({ success: true, status: 'hors_matiere', reason: 'charge fixe' })
  }

  // Étage 2 — mémoire fournisseur : si ce fournisseur a déjà été reconnu hors
  // matière et n'a JAMAIS produit de lignes, inutile de relire chaque nouvelle
  // facture (Wiismile revient tous les mois). Un seul appel IA par fournisseur.
  const supKey = societeKey(invoice.supplier_name || '')
  if (supKey) {
    const { data: histo } = await service.from('invoices')
      .select('supplier_name, lines_status')
      .eq('client_id', clientId)
      .in('lines_status', ['done', 'partial', 'hors_matiere'])
    let dejaHors = false, dejaMatiere = false
    for (const h of histo || []) {
      if (societeKey(h.supplier_name || '') !== supKey) continue
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
    }).eq('id', invoice.id)

    let luEnVision = false
    let extraction: Awaited<ReturnType<typeof extractLinesLong>>
    let passe = sansTexte ? 'vision' : 'texte'
    let tentatives = 1
    if (sansTexte) {
      try {
        extraction = await extractLinesVision(buffer, totalHT)
        luEnVision = true
      } catch (visionErr) {
        const d = visionErr instanceof Error ? visionErr.message : String(visionErr)
        await marquer(invoice.id, 'scan_illisible',
          `Ce PDF ne contient pas de texte (${lettres} lettres lues) : c'est un scan ou une photo. La lecture image a échoué elle aussi (${d.slice(0, 200)}). Demandez au fournisseur une facture PDF native — c'est gratuit et définitif.`)
        return NextResponse.json({ error: 'PDF sans texte exploitable (scan) — lecture image indisponible.' }, { status: 422 })
      }
    } else {
      extraction = await extractLinesLong(pdfText, totalHT)

      // ── PASSES DE SECOURS ───────────────────────────────────────────────────
      //
      // Une lecture qui ne BOUCLE pas sur le total n'est plus une fatalité. Le
      // total, lui, ne vient pas de nous : c'est celui de la comptabilité. Il
      // sert donc d'arbitre — et tant qu'il n'est pas atteint, on retente
      // AUTREMENT, jamais deux fois pareil.
      //
      //   1. texte    — la lecture nominale ;
      //   2. reprise  — le MÊME texte, avec l'écart nommé au centime et le sens
      //                 de l'erreur (excédent = ligne en trop, manque = ligne
      //                 oubliée). C'est ce qui distingue une seconde chance d'un
      //                 coup de dés ;
      //   3. vision   — le document REGARDÉ au lieu d'être lu. Rattrape les
      //                 couches texte abîmées, où les caractères ressortent
      //                 espacés (« F A : 0 . 8 8 ») et où aucune relecture du
      //                 même texte ne peut aider.
      //
      // L'arbitre est de l'ARITHMÉTIQUE, pas une seconde IA : on garde la
      // première lecture qui boucle au centime, sinon celle dont l'écart est le
      // plus petit — à écart égal, celle qui donne le plus de prix exploitables.
      // Aucune passe ne peut donc dégrader le résultat : au pire elle ne gagne pas.
      const boucleExact = (ls: ExtractedLine[]) =>
        Math.abs(ls.reduce((s, l) => s + l.amount_ht, 0) - totalHT) <= 0.02

      if (totalHT !== 0 && extraction.lines.length > 0 && !boucleExact(extraction.lines)) {
        const score = (ls: ExtractedLine[]) => ({
          ecart: Math.abs(ls.reduce((s, l) => s + l.amount_ht, 0) - totalHT),
          prix: ls.filter(l => l.unit_price_ht !== null).length,
        })
        let meilleur = { extraction, passe, score: score(extraction.lines) }
        // Photographie de la PREMIÈRE lecture : c'est elle que la reprise doit
        // corriger. La capturer explicitement évite qu'une évolution du code ne
        // fasse un jour repartir la reprise d'un résultat déjà remplacé.
        const premiere = extraction.lines.map(l => ({ designation: l.designation, amount_ht: l.amount_ht }))
        const sommePremiere = premiere.reduce((s, l) => s + l.amount_ht, 0)

        const candidats: { nom: string; run: () => Promise<typeof extraction> }[] = [
          {
            nom: 'reprise',
            run: () => extractLinesLong(pdfText, totalHT, { somme: sommePremiere, lignes: premiere }),
          },
          { nom: 'vision', run: () => extractLinesVision(buffer, totalHT) },
        ]

        for (const c of candidats) {
          if (meilleur.score.ecart <= 0.02) break
          tentatives++
          try {
            const essai = await c.run()
            if (essai.lines.length === 0) continue
            const s = score(essai.lines)
            const mieux = s.ecart < meilleur.score.ecart - 0.005
              || (Math.abs(s.ecart - meilleur.score.ecart) <= 0.005 && s.prix > meilleur.score.prix)
            if (mieux) meilleur = { extraction: essai, passe: c.nom, score: s }
          } catch (e) {
            // Une passe de secours qui échoue ne casse rien : on garde la
            // meilleure lecture obtenue jusque-là et on le dit dans le motif.
            console.error(`[extract-lines] passe ${c.nom} indisponible:`, e instanceof Error ? e.message : e)
          }
        }

        extraction = meilleur.extraction
        passe = meilleur.passe
        if (passe === 'vision') luEnVision = true
      }
    }
    const { lines, delivery_date, due_date, nature, tronque } = extraction

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
      await service.from('invoice_lines').delete().eq('invoice_id', invoice.id).eq('client_id', clientId)
      const patch: Record<string, unknown> = {}
      if (due_date && !invoice.due_date) patch.due_date = due_date
      await marquer(invoice.id, 'hors_matiere', 'Le document lui-même ne porte aucune matière première (matériel, service, abonnement).', patch)
      return NextResponse.json({ success: true, status: 'hors_matiere', reason: 'facture sans matière première (matériel, service, abonnement…)' })
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
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await marquer(invoice.id, 'error', msg.slice(0, 500))
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
