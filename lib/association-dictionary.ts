// lib/association-dictionary.ts — DICTIONNAIRE D'ASSOCIATIONS PARTAGÉ (lot 28).
//
// L'association d'une réf fournisseur à un article générique (« FILET DE POULET
// SV » → « Filet de poulet ») est du JUGEMENT humain — et il est le même dans
// toutes les boucheries. Mesuré sur la fiche pilote : 131 associations faites à
// la main, le goulot n°1 de toute la chaîne de valeur (39 % des réfs). La
// deuxième boutique ne doit pas refaire ce travail.
//
// La table `association_dictionary` est PLATEFORME (aucun client_id) et ne
// porte QUE des libellés et des facteurs de conversion — jamais un prix, jamais
// un volume : rien d'une boutique ne fuit vers une autre, sauf le vocabulaire.
//
// Deux mouvements, tous deux silencieux et jamais bloquants :
//   · NOURRIR — chaque association manuelle réussie ajoute (ou conforte) une
//     correspondance. L'identité (réf nommée comme son générique) n'apprend
//     rien ; une ligne non-produit (taxe, remise…) n'entre jamais.
//   · APPLIQUER — les réfs libres d'une fiche dont le libellé EXACT est au
//     dictionnaire sont associées d'office, le générique du client étant créé
//     au besoin. La correspondance la plus confortée (seen_count) gagne ; une
//     égalité est ambiguë et reste en file manuelle. Les garde-fous d'unité de
//     l'association automatique s'appliquent à l'identique : sans facteur de
//     conversion, l'unité facturée doit être lisible ET du même type que
//     l'unité de base — un prix au colis publié en €/kg est exactement la
//     faute que ce produit s'interdit.
//
// La dissociation ne retire RIEN du dictionnaire : `no_auto` protège la fiche
// localement, et si une correspondance était fausse, les associations
// suivantes — comptées — finissent par l'emporter.

import { normText } from '@/lib/postes'
import { isNonProduct, unitKind } from '@/lib/mercuriale-auto'
import type { createServiceClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceClient>

type EntreeDict = {
  generic_name: string
  generic_name_key: string
  base_unit: string
  conversion_factor: number | null
  seen_count: number
}

/** Enregistre au dictionnaire les associations qui viennent d'être faites à la
 *  main sur une fiche. Jamais bloquant : une erreur se logue et la réponse de
 *  la route n'en sait rien — le dictionnaire est un bénéfice, pas une condition. */
export async function nourrirDictionnaire(
  service: ServiceClient,
  clientId: string,
  genericId: string,
  articleIds: string[],
): Promise<void> {
  try {
    if (articleIds.length === 0) return
    const { data: g } = await service.from('generic_articles')
      .select('name, name_key, base_unit')
      .eq('id', genericId).eq('client_id', clientId).maybeSingle()
    if (!g) return
    const gKey = String(g.name_key ?? '')
    if (!gKey) return

    const { data: refs } = await service.from('articles')
      .select('name, name_key, conversion_factor')
      .eq('client_id', clientId).in('id', articleIds.slice(0, 200))

    for (const r of refs || []) {
      const nom = String(r.name ?? '')
      const nameKey = String(r.name_key ?? '') || normText(nom)
      if (!nameKey || nameKey === gKey) continue // l'identité n'apprend rien
      if (isNonProduct(nom)) continue // une taxe associée par erreur ne se propage pas
      const facteur = r.conversion_factor === null || r.conversion_factor === undefined
        ? null : Number(r.conversion_factor)

      // Lire-puis-écrire plutôt qu'un upsert : il faut INCRÉMENTER le compteur.
      // La pire course perd un +1 — un compteur de confiance le supporte.
      const { data: exist } = await service.from('association_dictionary')
        .select('id, seen_count')
        .eq('name_key', nameKey).eq('generic_name_key', gKey).maybeSingle()
      if (exist) {
        await service.from('association_dictionary').update({
          seen_count: (Number(exist.seen_count) || 0) + 1,
          generic_name: String(g.name),
          base_unit: String(g.base_unit ?? 'kg'),
          conversion_factor: facteur,
          updated_at: new Date().toISOString(),
        }).eq('id', exist.id)
      } else {
        await service.from('association_dictionary').insert({
          name_key: nameKey,
          generic_name: String(g.name),
          generic_name_key: gKey,
          base_unit: String(g.base_unit ?? 'kg'),
          conversion_factor: facteur,
        })
      }
    }
  } catch (e) {
    console.error('[dictionnaire] nourrir :', e instanceof Error ? e.message : e)
  }
}

/** Applique le dictionnaire aux réfs libres d'une fiche : libellé EXACT connu →
 *  association d'office, générique créé au besoin. Renvoie le nombre de réfs
 *  associées. Jamais bloquant — au pire, la réf reste en file manuelle. */
export async function appliquerDictionnaire(service: ServiceClient, clientId: string): Promise<number> {
  try {
    const { data: freeRefs } = await service.from('articles')
      .select('id, name, name_key, unit')
      .eq('client_id', clientId)
      .is('generic_id', null).eq('no_auto', false).eq('ignored', false)
    if (!freeRefs || freeRefs.length === 0) return 0

    const cles = [...new Set(freeRefs.map(r => String(r.name_key ?? '')).filter(Boolean))]
    if (cles.length === 0) return 0

    // Entrées du dictionnaire pour ces libellés, par paquets bornés.
    const parCle = new Map<string, EntreeDict[]>()
    for (let i = 0; i < cles.length; i += 100) {
      const { data } = await service.from('association_dictionary')
        .select('name_key, generic_name, generic_name_key, base_unit, conversion_factor, seen_count')
        .in('name_key', cles.slice(i, i + 100))
      for (const d of (data || []) as Record<string, unknown>[]) {
        const k = String(d.name_key)
        const arr = parCle.get(k) || []
        arr.push({
          generic_name: String(d.generic_name),
          generic_name_key: String(d.generic_name_key),
          base_unit: String(d.base_unit ?? 'kg'),
          conversion_factor: d.conversion_factor === null || d.conversion_factor === undefined
            ? null : Number(d.conversion_factor),
          seen_count: Number(d.seen_count) || 1,
        })
        parCle.set(k, arr)
      }
    }
    if (parCle.size === 0) return 0

    // Génériques déjà présents chez ce client, pour créer sans doublonner.
    const { data: generics } = await service.from('generic_articles')
      .select('id, name_key').eq('client_id', clientId).eq('active', true)
    const gidParCle = new Map((generics || []).map(g => [String(g.name_key), String(g.id)]))

    let associees = 0
    for (const ref of freeRefs) {
      const entrees = parCle.get(String(ref.name_key ?? ''))
      if (!entrees || entrees.length === 0) continue
      if (isNonProduct(String(ref.name ?? ''))) continue

      // La correspondance la plus CONFORTÉE gagne ; une égalité entre deux
      // génériques différents est ambiguë — on ne devine pas, file manuelle.
      const triees = [...entrees].sort((a, b) => b.seen_count - a.seen_count)
      if (triees.length > 1 && triees[0].seen_count === triees[1].seen_count) continue
      const choix = triees[0]

      // Garde-fou d'unité, identique à l'association automatique : sans facteur
      // de conversion hérité, l'unité facturée doit être lisible et du même
      // type que l'unité de base du générique.
      const facteur = choix.conversion_factor
      if (facteur === null && unitKind((ref.unit as string | null) ?? null) !== choix.base_unit) continue

      let gid = gidParCle.get(choix.generic_name_key)
      if (!gid) {
        const { data: created, error: insErr } = await service.from('generic_articles')
          .insert({
            client_id: clientId,
            name: choix.generic_name,
            name_key: choix.generic_name_key,
            base_unit: choix.base_unit === 'piece' ? 'piece' : 'kg',
            category: 'ingredient',
            default_loss_pct: 0,
            auto_created: true,
          })
          .select('id').single()
        if (insErr || !created) {
          // Course avec une création concurrente : relire plutôt qu'échouer.
          const { data: retrouve } = await service.from('generic_articles')
            .select('id').eq('client_id', clientId).eq('name_key', choix.generic_name_key)
            .eq('active', true).maybeSingle()
          if (!retrouve) { console.error('[dictionnaire] création générique :', insErr?.message); continue }
          gid = String(retrouve.id)
        } else {
          gid = String(created.id)
        }
        gidParCle.set(choix.generic_name_key, gid)
      }

      const { error: updErr } = await service.from('articles')
        .update({ generic_id: gid, conversion_factor: facteur })
        .eq('id', String(ref.id)).eq('client_id', clientId)
      if (updErr) { console.error('[dictionnaire] association :', updErr.message); continue }
      associees++
    }
    return associees
  } catch (e) {
    console.error('[dictionnaire] appliquer :', e instanceof Error ? e.message : e)
    return 0
  }
}
