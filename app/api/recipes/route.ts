// Fiches recettes — liste avec coûts calculés, et création.
//
// GET  → { recipes: [{ ...recette, ingredients: [...], cost: RecipeCost }],
//          labor_rate_ht, generics: [...], employees: [{ id, name, loaded_rate }],
//          targets: [{ category, target_marge_pct }] }   ← cibles de marge par catégorie (R-A)
// POST → { name, category?, yield_qty?, yield_unit?, labor_minutes?, employee_id?,
//          selling_price_ttc?, tva_rate?, notes?,
//          ingredients: [{ generic_id?, article_id?, label, quantity, qty_unit?, loss_pct?, unit?, manual_price_ht? }] }
//
// Tout le calcul vit dans lib/recipes (module pur) : matière au prix du jour des
// ARTICLES GÉNÉRIQUES (unité de base kg/pièce, perte sur le brut), main-d'œuvre
// au taux chargé de l'employé choisi (repli : taux moyen de l'équipe, CCN 992).
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { PAYROLL_EMPLOYEE_COLUMNS, chargeMultiplier, productiveFactor, type PayrollEmployee } from '@/lib/payroll'
import {
  averageLoadedRate, employeeLoadedRate, buildGenericMap,
  buildGenericPriceSeries, costMatiereAtDate, motifSerieMatiere,
  buildRecipeCostGraph, computeFormatVerdict, costPourFormat, formatParDefaut,
  parseIngredients, parseRecipeFields,
  type IngredientRow, type RecipeCost, type RecipeFormat, type RecipeRow,
} from '@/lib/recipes'
import { fetchAllPages } from '@/lib/fetch-all'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json({ recipes: [], labor_rate_ht: null, generics: [], employees: [], targets: [] })

  // Fenêtre d'historique du coût matière : 12 mois de prix de factures VÉRIFIÉS
  // (un prix en quarantaine a unit_price_ht NULL et n'apparaît jamais ici)
  const cutoff12m = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)

  const [{ data: recipes }, { data: ingredients }, { data: employees }, articlesPage, { data: generics }, { data: targets }, { data: formatRows }] = await Promise.all([
    service.from('recipes').select('*').eq('client_id', clientId).eq('active', true).order('name'),
    service.from('recipe_ingredients').select('*').eq('client_id', clientId).order('position'),
    service.from('employees').select(PAYROLL_EMPLOYEE_COLUMNS).eq('client_id', clientId),
    fetchAllPages<any>(apres => {
      let q = service.from('articles')
        // `name` et `supplier_name` : la réf fournisseur telle qu'elle est
        // écrite sur la facture, affichée sous l'ingrédient de la fiche —
        // la provenance du prix, pas seulement sa valeur.
        .select('id, name, supplier_name, unit, last_price_ht, last_price_date, generic_id, conversion_factor')
        .eq('client_id', clientId)
      if (apres) q = q.gt('id', apres)
      return q.order('id', { ascending: true })
    }),
    service.from('generic_articles').select('id, name, base_unit, category, default_loss_pct').eq('client_id', clientId).eq('active', true).order('name'),
    service.from('recipe_targets').select('category, target_marge_pct').eq('client_id', clientId),
    service.from('recipe_formats').select('*').eq('client_id', clientId).order('position'),
  ])
  const articles = articlesPage.rows

  // Points de prix pour la COURBE de coût matière. Deux corrections (lot 8) :
  //   · le `.limit(2000)` muet coupait les points les plus ANCIENS — le prix à
  //     une date passée devenait introuvable, le jalon était filtré, et la
  //     courbe rétrécissait puis disparaissait (elle exige deux points) sans le
  //     moindre message. Mesuré : la boutique lit 93 lignes par semaine, le
  //     plafond tombait vers la mi-décembre, AVANT que la fenêtre de 12 mois
  //     qu'il sert soit seulement remplie ;
  //   · on ne lit plus QUE les réfs des génériques réellement utilisés dans les
  //     fiches — le reste ne sert à aucune courbe. Ici : une petite fraction du
  //     volume, et la requête reste bornée quand le catalogue grandit.
  const genericsUtilises = new Set(
    ((ingredients || []) as IngredientRow[]).map(i => i.generic_id).filter((g): g is string => !!g),
  )
  const articlesUtiles = articles
    .filter((a: any) => a.generic_id && genericsUtilises.has(String(a.generic_id)))
    .map((a: any) => String(a.id))
  // PostgREST met les valeurs d'un `in` dans l'URL : par paquets, sinon la
  // requête devient trop longue dès quelques centaines de réfs.
  const LOT_IDS = 150
  const pricePoints: any[] = []
  let pointsTronque = false
  for (let i = 0; i < articlesUtiles.length; i += LOT_IDS) {
    const lot = articlesUtiles.slice(i, i + LOT_IDS)
    const p = await fetchAllPages<any>(apres => {
      let q = service.from('invoice_lines')
        .select('id, article_id, unit_price_ht, invoices!inner(invoice_date)')
        .eq('client_id', clientId)
        .in('article_id', lot)
        .not('unit_price_ht', 'is', null)
        .gte('invoices.invoice_date', cutoff12m)
      if (apres) q = q.gt('id', apres)
      return q.order('id', { ascending: true })
    })
    pricePoints.push(...p.rows)
    if (p.tronque) pointsTronque = true
  }

  const emps = (employees || []) as unknown as PayrollEmployee[]
  const averageRate = averageLoadedRate(emps)
  const genericById = buildGenericMap((generics || []) as Record<string, unknown>[], (articles || []) as Record<string, unknown>[])
  const priceByArticle = new Map<string, number>()
  for (const a of articles || []) {
    if (a.last_price_ht != null) priceByArticle.set(a.id, parseFloat(String(a.last_price_ht)))
  }

  const byRecipe = new Map<string, IngredientRow[]>()
  for (const ing of (ingredients || []) as (IngredientRow & { recipe_id: string })[]) {
    const arr = byRecipe.get(ing.recipe_id) || []
    arr.push(ing)
    byRecipe.set(ing.recipe_id, arr)
  }

  // Coût matière dans le temps : séries de prix par générique, puis relecture de
  // chaque fiche aux lundis des 8 dernières semaines ISO + aujourd'hui. Un jalon
  // où un prix mercuriale manque est un TROU (null filtré), jamais un total
  // partiel. Fiches sans ligne mercuriale : pas de série (rien ne varie).
  const seriesByGeneric = buildGenericPriceSeries(
    (generics || []) as Record<string, unknown>[],
    (articles || []) as Record<string, unknown>[],
    ((pricePoints || []) as any[]).map(p => ({
      article_id: p.article_id ?? null,
      unit_price_ht: p.unit_price_ht,
      date: p.invoices?.invoice_date ?? null,
    })),
  )
  const mondayOf = (t: Date) => {
    const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()))
    const dow = d.getUTCDay() || 7
    d.setUTCDate(d.getUTCDate() - dow + 1)
    return d
  }
  const m0 = mondayOf(new Date())
  const jalons: string[] = []
  for (let i = 7; i >= 0; i--) {
    const d = new Date(m0)
    d.setUTCDate(m0.getUTCDate() - 7 * i)
    jalons.push(d.toISOString().slice(0, 10))
  }
  const todayIso = new Date().toISOString().slice(0, 10)
  if (jalons[jalons.length - 1] !== todayIso) jalons.push(todayIso)

  // Graphe de coût AVEC sous-recettes : mémoïsation, garde anti-cycle, coût
  // d'une sous-fiche = son coût complet ÷ son rendement (relu, jamais stocké).
  const graph = buildRecipeCostGraph({
    recipes: (recipes || []) as (RecipeRow & Record<string, unknown>)[],
    ingredientsByRecipe: byRecipe,
    priceByArticle,
    genericById,
    rateForRecipe: r => employeeLoadedRate(emps, r.employee_id as string | null) ?? averageRate,
  })

  // Formats de vente, rangés par fiche. Le coût du batch est le MÊME pour tous
  // les formats d'une fiche (c'est la même fabrication) : seule la division par
  // la quantité vendable et le prix changent.
  const formatsByRecipe = new Map<string, RecipeFormat[]>()
  for (const f of (formatRows || []) as Record<string, unknown>[]) {
    const rid = String(f.recipe_id)
    const arr = formatsByRecipe.get(rid) || []
    arr.push({
      id: String(f.id), recipe_id: rid, name: String(f.name ?? ''),
      sell_unit: (f.sell_unit as string | null) ?? null,
      sell_qty: f.sell_qty != null ? Number(f.sell_qty) : null,
      selling_price_ttc: f.selling_price_ttc != null ? Number(f.selling_price_ttc) : null,
      tva_rate: Number(f.tva_rate) || 5.5,
      validated: f.validated === true,
      position: Number(f.position) || 0,
    })
    formatsByRecipe.set(rid, arr)
  }

  const out = (recipes || []).map((r: RecipeRow & Record<string, unknown>) => {
    const costed = graph.costedFor(r.id)
    const brut = graph.costFor(r.id) as RecipeCost
    const formats = formatsByRecipe.get(String(r.id)) || []
    const defaut = formatParDefaut(formats)
    // La partie « vente » du coût vient du format PAR DÉFAUT — les colonnes de
    // vente de la fiche ne sont plus écrites depuis le lot 46.
    const cost = costPourFormat(brut, r, defaut)
    const hasMercuriale = costed.some(l => l.generic_id && l.price_source === 'mercuriale')
    // Série du coût matière : les lignes sous-recettes y restent CONSTANTES (au
    // coût du jour) — seule la matière mercuriale directe est relue à date.
    const matiere_series = hasMercuriale
      ? jalons
          .map(d => ({ d, v: costMatiereAtDate(costed, seriesByGeneric, d) }))
          .filter((x): x is { d: string; v: number } => x.v !== null)
      : []
    // Une courbe absente se lit « le coût n'a pas bougé » si rien ne dit pourquoi.
    const matiere_series_motif = motifSerieMatiere(hasMercuriale, matiere_series.length)
    return {
      ...r,
      // Les colonnes de vente de la FICHE sont gelées (lot 46) : on renvoie
      // celles du format par défaut à leur place, pour qu'aucun écran ne
      // continue à lire un prix que plus personne n'écrit.
      sell_unit: defaut?.sell_unit ?? null,
      sell_qty: defaut?.sell_qty ?? null,
      selling_price_ttc: defaut?.selling_price_ttc ?? null,
      tva_rate: defaut?.tva_rate ?? (Number(r.tva_rate) || 5.5),
      formats: formats.map(f => ({ ...f, ...computeFormatVerdict(brut.total_ht, r, f, brut.prix_manquants) })),
      ingredients: costed,
      cost: { ...cost, matiere_series, matiere_series_motif },
    }
  })

  return NextResponse.json({
    recipes: out,
    labor_rate_ht: averageRate,
    // Historique de prix tronqué : les courbes « 8 dernières semaines » sont
    // alors incomplètes. Annoncé plutôt que subi — une courbe qui rétrécit
    // ressemble en tout point à un prix qui n'a pas bougé.
    historique_incomplet: pointsTronque || articlesPage.tronque,
    targets: (targets || []).map((t: any) => ({ category: String(t.category), target_marge_pct: Number(t.target_marge_pct) })),
    generics: [...genericById.values()],
    employees: emps
      .map(e => {
        const er = e as unknown as Record<string, unknown>
        const h = Number(er.hourly_rate) || 0
        // Taux PRODUCTIF (chargé × 52/(52 − semaines non travaillées)) — le même
        // que celui du moteur de coût, pour que le menu annonce ce qui sera compté
        return { id: String(er.id), name: String(er.name ?? ''), loaded_rate: h > 0 ? Math.round(h * chargeMultiplier(e) * productiveFactor(e) * 100) / 100 : null }
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
  })
}

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const parsedFields = parseRecipeFields(body)
  if (parsedFields.error) return NextResponse.json({ error: parsedFields.error }, { status: 400 })
  const parsedIngs = parseIngredients(body.ingredients)
  if (parsedIngs.error) return NextResponse.json({ error: parsedIngs.error }, { status: 400 })

  const guard = await checkOwnership(service, clientId, parsedFields.fields!, parsedIngs.rows!)
  if (guard) return NextResponse.json({ error: guard }, { status: 400 })

  // Les champs de VENTE ne vont plus sur la fiche : ils font le format par
  // défaut (lot 46). Écrire aux deux endroits créerait deux vérités, et c'est
  // celle qu'on n'édite plus qui finirait par être lue quelque part.
  const { sell_unit, sell_qty, selling_price_ttc, tva_rate, ...champsFiche } = parsedFields.fields!

  const { data: recipe, error } = await service.from('recipes')
    .insert({ client_id: clientId, ...champsFiche })
    .select('id').single()
  if (error || !recipe) return NextResponse.json({ error: error?.message ?? 'Création impossible' }, { status: 500 })

  const { error: ingErr } = await service.from('recipe_ingredients').insert(
    parsedIngs.rows!.map(r => ({ ...r, client_id: clientId, recipe_id: recipe.id })),
  )
  if (ingErr) {
    // Pas de recette sans ses ingrédients : on retire la coquille plutôt que de la laisser vide
    await service.from('recipes').delete().eq('id', recipe.id)
    return NextResponse.json({ error: `Ingrédients : ${ingErr.message}` }, { status: 500 })
  }

  // Toute fiche a AU MOINS un format : sans lui elle n'aurait ni prix ni marge,
  // et l'écran la montrerait comme une fiche qu'on vient de vider.
  const { error: fmtErr } = await service.from('recipe_formats').insert({
    client_id: clientId, recipe_id: recipe.id,
    name: String(champsFiche.name), sell_unit, sell_qty, selling_price_ttc,
    tva_rate: tva_rate ?? 5.5, position: 0,
  })
  if (fmtErr) {
    await service.from('recipe_ingredients').delete().eq('recipe_id', recipe.id)
    await service.from('recipes').delete().eq('id', recipe.id)
    return NextResponse.json({ error: `Format de vente : ${fmtErr.message}` }, { status: 500 })
  }

  return NextResponse.json({ success: true, id: recipe.id })
}

/** L'employé et chaque article générique visés doivent appartenir au client.
 *  (Dupliqué dans [id]/route.ts — un module de route n'exporte que ses verbes.) */
async function checkOwnership(
  service: ReturnType<typeof createServiceClient>,
  clientId: string,
  fields: Record<string, unknown>,
  rows: IngredientRow[],
): Promise<string | null> {
  const employeeId = fields.employee_id as string | null
  if (employeeId) {
    const { data } = await service.from('employees').select('id').eq('id', employeeId).eq('client_id', clientId).maybeSingle()
    if (!data) return 'Employé introuvable'
  }
  const genericIds = [...new Set(rows.map(r => r.generic_id).filter((g): g is string => g !== null))]
  if (genericIds.length > 0) {
    const { data } = await service.from('generic_articles')
      .select('id').eq('client_id', clientId).eq('active', true).in('id', genericIds)
    if ((data || []).length !== genericIds.length) return 'Un des articles génériques est introuvable'
  }
  // Sous-recettes : chacune doit être une fiche ACTIVE du client
  const subIds = [...new Set(rows.map(r => r.sub_recipe_id ?? null).filter((s): s is string => s !== null))]
  if (subIds.length > 0) {
    const { data } = await service.from('recipes')
      .select('id').eq('client_id', clientId).eq('active', true).in('id', subIds)
    if ((data || []).length !== subIds.length) return 'Une des sous-recettes est introuvable'
  }
  return null
}
