// Fiche recette — lecture d'UNE fiche, édition et suppression.
//
// GET    → { recipe: { ...fiche, ingredients, cost }, employees, generics, target }
//          La fiche pleine page appelait jusqu'ici GET /api/recipes (la LISTE)
//          puis cherchait la sienne dans le tableau. Ce GET-là construit le
//          graphe de coût de TOUTES les fiches puis relit le coût matière de
//          chacune à NEUF jalons datés — et le panneau le rappelle après chaque
//          étape, palier, ingrédient ou prix enregistré. À cinquante fiches,
//          chaque ajout d'ingrédient déclenchait 450 recalculs datés pour
//          afficher UNE fiche. Ici le graphe est le même (il est paresseux et
//          mémoïsé : demander une fiche ne calcule qu'elle et ses sous-recettes)
//          et la série temporelle n'est calculée que pour la fiche demandée.
// PUT    → mêmes champs que la création (employee_id, ingrédients sur articles
//          génériques…) ; si `ingredients` est fourni, la liste est REMPLACÉE
//          entièrement (pas de merge ligne à ligne — la modale renvoie toujours
//          la liste complète).
// DELETE → désactivation (active = false), pas de suppression physique : les
//          fiches restent réactivables et l'historique de production y survivra.
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { PAYROLL_EMPLOYEE_COLUMNS, chargeMultiplier, productiveFactor, type PayrollEmployee } from '@/lib/payroll'
import {
  averageLoadedRate, employeeLoadedRate, buildGenericMap,
  buildGenericPriceSeries, costMatiereAtDate, motifSerieMatiere, buildRecipeCostGraph,
  parseIngredients, parseRecipeFields,
  type IngredientRow, type RecipeCost, type RecipeRow,
} from '@/lib/recipes'
import { fetchAllPages } from '@/lib/fetch-all'

export const dynamic = 'force-dynamic'

async function authClient() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Non authentifié' }, { status: 401 }) }
  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return { error: NextResponse.json({ error: 'Client introuvable' }, { status: 404 }) }
  return { service, clientId }
}

/** L'employé et chaque article générique visés doivent appartenir au client.
 *  (Même garde-fou que dans route.ts — un module de route n'exporte que ses verbes.) */
async function checkOwnership(
  service: ReturnType<typeof createServiceClient>,
  clientId: string,
  fields: Record<string, unknown>,
  rows: IngredientRow[] | null,
  /** id de la fiche en cours d'édition — pour interdire l'auto-référence */
  selfId?: string,
): Promise<string | null> {
  const employeeId = fields.employee_id as string | null
  if (employeeId) {
    const { data } = await service.from('employees').select('id').eq('id', employeeId).eq('client_id', clientId).maybeSingle()
    if (!data) return 'Employé introuvable'
  }
  const genericIds = [...new Set((rows || []).map(r => r.generic_id).filter((g): g is string => g !== null))]
  if (genericIds.length > 0) {
    const { data } = await service.from('generic_articles')
      .select('id').eq('client_id', clientId).eq('active', true).in('id', genericIds)
    if ((data || []).length !== genericIds.length) return 'Un des articles génériques est introuvable'
  }
  // Sous-recettes : fiches ACTIVES du client, et jamais la fiche elle-même
  // (les boucles plus profondes sont neutralisées à l'affichage — garde anti-cycle)
  const subIds = [...new Set((rows || []).map(r => r.sub_recipe_id ?? null).filter((s): s is string => s !== null))]
  if (subIds.length > 0) {
    if (selfId && subIds.includes(selfId)) return 'Une fiche ne peut pas être sa propre sous-recette'
    const { data } = await service.from('recipes')
      .select('id').eq('client_id', clientId).eq('active', true).in('id', subIds)
    if ((data || []).length !== subIds.length) return 'Une des sous-recettes est introuvable'
  }
  return null
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authClient()
  if (auth.error) return auth.error
  const { service, clientId } = auth as { service: ReturnType<typeof createServiceClient>; clientId: string }

  const cutoff12m = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)

  // La fiche demandée d'abord : si elle n'est pas au client, on s'arrête là.
  const { data: cible } = await service.from('recipes')
    .select('id').eq('id', params.id).eq('client_id', clientId).eq('active', true).maybeSingle()
  if (!cible) return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 })

  // Les fiches et leurs lignes sont chargées en entier : le graphe en a besoin
  // pour résoudre les sous-recettes (une fiche peut en appeler une autre, qui en
  // appelle une autre). Ce sont deux requêtes ; ce qui coûtait, c'était le
  // CALCUL de toutes les fiches, pas leur lecture.
  const [{ data: recipes }, { data: ingredients }, { data: employees }, articlesPage, { data: generics }, { data: targets }] = await Promise.all([
    service.from('recipes').select('*').eq('client_id', clientId).eq('active', true).order('name'),
    service.from('recipe_ingredients').select('*').eq('client_id', clientId).order('position'),
    service.from('employees').select(PAYROLL_EMPLOYEE_COLUMNS).eq('client_id', clientId),
    fetchAllPages<any>(apres => {
      let q = service.from('articles')
        // `name` / `supplier_name` : la réf fournisseur d'où sort le prix,
        // affichée sous l'ingrédient (même contenu que la liste).
        .select('id, name, supplier_name, unit, last_price_ht, last_price_date, generic_id, conversion_factor')
        .eq('client_id', clientId)
      if (apres) q = q.gt('id', apres)
      return q.order('id', { ascending: true })
    }),
    service.from('generic_articles').select('id, name, base_unit, category, default_loss_pct').eq('client_id', clientId).eq('active', true).order('name'),
    service.from('recipe_targets').select('category, target_marge_pct').eq('client_id', clientId),
  ])

  const articles = articlesPage.rows
  const emps = (employees || []) as unknown as PayrollEmployee[]
  const averageRate = averageLoadedRate(emps)
  const genericById = buildGenericMap((generics || []) as Record<string, unknown>[], articles as Record<string, unknown>[])
  const priceByArticle = new Map<string, number>()
  for (const a of articles) {
    if (a.last_price_ht != null) priceByArticle.set(a.id, parseFloat(String(a.last_price_ht)))
  }

  const byRecipe = new Map<string, IngredientRow[]>()
  for (const ing of (ingredients || []) as (IngredientRow & { recipe_id: string })[]) {
    const arr = byRecipe.get(ing.recipe_id) || []
    arr.push(ing)
    byRecipe.set(ing.recipe_id, arr)
  }

  const graph = buildRecipeCostGraph({
    recipes: (recipes || []) as (RecipeRow & Record<string, unknown>)[],
    ingredientsByRecipe: byRecipe,
    priceByArticle,
    genericById,
    rateForRecipe: r => employeeLoadedRate(emps, r.employee_id as string | null) ?? averageRate,
  })

  // Graphe PARESSEUX : ces deux appels ne calculent que la fiche demandée et,
  // en cascade, ses sous-recettes. Les autres fiches ne sont jamais évaluées.
  const costed = graph.costedFor(params.id)
  const cost = graph.costFor(params.id) as RecipeCost | null
  const row = (recipes || []).find((r: any) => String(r.id) === String(params.id))
  if (!row || !cost) return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 })

  // Série du coût matière — pour CETTE fiche seulement, et seulement si elle a
  // au moins une ligne au prix mercuriale. Les points de prix sont restreints
  // aux réfs de ses propres génériques : la requête ne grandit pas avec le
  // catalogue, et ne se fait plus couper en silence (lib/fetch-all).
  const gidsFiche = [...new Set(costed.map(l => l.generic_id).filter((g): g is string => !!g))]
  const idsArticles = articles
    .filter((a: any) => a.generic_id && gidsFiche.includes(String(a.generic_id)))
    .map((a: any) => String(a.id))
  const hasMercuriale = costed.some(l => l.generic_id && l.price_source === 'mercuriale')

  let matiere_series: { d: string; v: number }[] = []
  let historique_incomplet = articlesPage.tronque
  if (hasMercuriale && idsArticles.length > 0) {
    const LOT_IDS = 150
    const points: any[] = []
    for (let i = 0; i < idsArticles.length; i += LOT_IDS) {
      const lot = idsArticles.slice(i, i + LOT_IDS)
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
      points.push(...p.rows)
      if (p.tronque) historique_incomplet = true
    }
    const seriesByGeneric = buildGenericPriceSeries(
      (generics || []) as Record<string, unknown>[],
      articles as Record<string, unknown>[],
      points.map(p => ({ article_id: p.article_id ?? null, unit_price_ht: p.unit_price_ht, date: p.invoices?.invoice_date ?? null })),
    )
    // Mêmes jalons que la liste : les 8 derniers lundis ISO, plus aujourd'hui.
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
    matiere_series = jalons
      .map(d => ({ d, v: costMatiereAtDate(costed, seriesByGeneric, d) }))
      .filter((x): x is { d: string; v: number } => x.v !== null)
  }

  // Cible de marge de la catégorie de la fiche — même normalisation que la liste
  const cat = String((row as any).category ?? '').trim().toLowerCase()
  const cible2 = (targets || []).find((t: any) => String(t.category) === cat)

  // Une courbe absente se lit « le coût n'a pas bougé » si rien ne dit pourquoi.
  const matiere_series_motif = motifSerieMatiere(hasMercuriale, matiere_series.length)

  return NextResponse.json({
    recipe: { ...row, ingredients: costed, cost: { ...cost, matiere_series, matiere_series_motif } },
    labor_rate_ht: averageRate,
    historique_incomplet,
    target: cible2 ? Number((cible2 as any).target_marge_pct) : null,
    generics: [...genericById.values()],
    employees: emps
      .map(e => {
        const er = e as unknown as Record<string, unknown>
        const h = Number(er.hourly_rate) || 0
        return { id: String(er.id), name: String(er.name ?? ''), loaded_rate: h > 0 ? Math.round(h * chargeMultiplier(e) * productiveFactor(e) * 100) / 100 : null }
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
  })
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authClient()
  if ('error' in auth) return auth.error
  const { service, clientId } = auth

  const { data: existing } = await service.from('recipes')
    .select('id').eq('id', params.id).eq('client_id', clientId).maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Recette introuvable' }, { status: 404 })

  const body = await request.json().catch(() => ({} as Record<string, unknown>))
  const parsedFields = parseRecipeFields(body)
  if (parsedFields.error) return NextResponse.json({ error: parsedFields.error }, { status: 400 })

  let rows: IngredientRow[] | null = null
  if ('ingredients' in body) {
    const parsedIngs = parseIngredients(body.ingredients)
    if (parsedIngs.error) return NextResponse.json({ error: parsedIngs.error }, { status: 400 })
    rows = parsedIngs.rows!
  }

  const guard = await checkOwnership(service, clientId, parsedFields.fields!, rows, params.id)
  if (guard) return NextResponse.json({ error: guard }, { status: 400 })

  const { error: upErr } = await service.from('recipes')
    .update(parsedFields.fields!).eq('id', params.id).eq('client_id', clientId)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  if (rows) {
    const { error: delErr } = await service.from('recipe_ingredients')
      .delete().eq('recipe_id', params.id).eq('client_id', clientId)
    if (delErr) return NextResponse.json({ error: `Purge des ingrédients : ${delErr.message}` }, { status: 500 })
    const { error: insErr } = await service.from('recipe_ingredients').insert(
      rows.map(r => ({ ...r, client_id: clientId, recipe_id: params.id })),
    )
    if (insErr) return NextResponse.json({ error: `Ingrédients : ${insErr.message}` }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authClient()
  if ('error' in auth) return auth.error
  const { service, clientId } = auth

  const { error } = await service.from('recipes')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', params.id).eq('client_id', clientId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
