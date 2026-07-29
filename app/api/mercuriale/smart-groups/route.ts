// Rapprochement intelligent — la même IA qui lit les factures propose les
// FUSIONS d'articles génériques en doublon d'appellation : « Cervelas choix »
// (fournisseur A), « Cervelas droit supérieur » (fournisseur B) et « Cervelas
// pur porc » (fournisseur C), c'est trois fois du cervelas.
//
// POST → { suggestions: [{ name, ids }] } — rien n'est fusionné ici : chaque
// proposition est VALIDÉE par l'utilisateur (POST /api/generic-articles/merge).
// Consigne stricte au modèle : dans le doute, ne pas regrouper (mieux vaut un
// doublon qu'une fusion de produits différents qui mélangerait leurs prix).
import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'MISSING_ANTHROPIC_KEY' })

export async function POST() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
  const service = createServiceClient()
  const clientId = await resolveClientId(service, user.id, user.email)
  if (!clientId) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 })

  const { data: generics, error } = await service.from('generic_articles')
    .select('id, name, base_unit')
    .eq('client_id', clientId).eq('active', true)
    .order('name')
    .limit(300)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const list = generics || []
  if (list.length < 2) return NextResponse.json({ suggestions: [] })

  const lignes = list.map((g, i) => `${i + 1}|${String(g.name).slice(0, 90)}`).join('\n')
  const prompt = `Tu regroupes le catalogue d'achats d'une boucherie-charcuterie artisanale par APPELLATION produit.

Deux articles se regroupent UNIQUEMENT s'ils désignent le MÊME produit, acheté sous des appellations, gammes, calibres ou fournisseurs différents. Exemple : « Cervelas choix vf s/v 1k aubret », « Cervelas droit superieur vrac » et « Cervelas pur porc droit pce » = un seul groupe « Cervelas ».

Ne regroupe JAMAIS des produits différents :
- espèces différentes (filet de poulet / filet de dinde / filet de canard : trois produits) ;
- découpes ou préparations différentes (filet mignon / carré de porc ; jambon sec / jambon blanc) ;
- variétés clairement distinctes vendues comme telles (tomate cerise / tomate cœur de bœuf) ;
- un ingrédient et son plat préparé (canard / parmentier de canard).
Dans le doute, NE regroupe PAS.

Catalogue (numero|nom) :
${lignes}

Réponds UNIQUEMENT par des lignes au format :
GROUPE|nom court de l'appellation|numeros separes par des virgules
Un groupe = 2 numeros minimum. Aucun regroupement pertinent : réponds exactement RIEN.`

  let text = ''
  try {
    const r = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    })
    text = r.content.map(c => (c.type === 'text' ? c.text : '')).join('')
  } catch (e) {
    console.error('[smart-groups] anthropic', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Lecture intelligente indisponible — réessayez.' }, { status: 502 })
  }

  // Parsing défensif : numéros valides uniquement, 2 membres minimum, un
  // générique n'appartient qu'à UN groupe (le premier gagne).
  const used = new Set<number>()
  const suggestions: { name: string; ids: string[] }[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line.toUpperCase().startsWith('GROUPE|')) continue
    const parts = line.split('|')
    if (parts.length < 3) continue
    const name = parts[1].trim().slice(0, 80)
    const nums = parts[2].split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => Number.isInteger(n) && n >= 1 && n <= list.length && !used.has(n))
    if (!name || nums.length < 2) continue
    nums.forEach(n => used.add(n))
    suggestions.push({ name, ids: nums.map(n => String(list[n - 1].id)) })
    if (suggestions.length >= 20) break
  }

  return NextResponse.json({ suggestions })
}
