import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Percent, Info } from 'lucide-react'
import Link from 'next/link'

const fmt = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })

// ── Rayons ──
// Le traiteur consomme la matiere du rayon boucherie => on les fusionne pour une marge honnete
type Rayon = 'boucherie' | 'charcuterie' | 'vente'
const RAYON_LABELS: Record<Rayon, string> = {
  boucherie: 'Boucherie & Traiteur',
  charcuterie: 'Charcuterie',
  vente: 'Vente / Epicerie',
}

/** Famille de vente Crisalid -> rayon */
function famToRayon(nom: string): Rayon {
  const n = nom.toUpperCase()
  if (/(CHARCUT|SALAISON|SAUCISS|JAMBON|PATE|TERRINE)/.test(n)) return 'charcuterie'
  if (/(BOEUF|BŒUF|VEAU|AGNEAU|PORC|VOLAILLE|VIANDE|BOUCH|GIBIER|ABAT|TRAITEUR|PLAT|ROTISSERIE)/.test(n)) return 'boucherie'
  return 'vente'
}

/** Categorie d'achat -> rayon (null = cout transverse non reparti) */
function catToRayon(cat: string): Rayon | null {
  if (cat === 'viande') return 'boucherie'
  if (cat === 'charcuterie') return 'charcuterie'
  if (cat === 'epicerie') return 'vente'
  return null // emballage, frais_generaux, autre => non repartis
}

const keyOf = (year: number, week: number) => `${year}-${String(week).padStart(2, '0')}`

export default async function MargesPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const serviceSupabase = createServiceClient()
  const clientId = await resolveClientId(serviceSupabase, user!.id, user?.email)

  // 4 dernieres semaines avec un CA archive
  let weeks: { key: string; week: number; year: number; ca: number; familles: { nom: string; montant: number }[] }[] = []
  let invoices: { week_number: number; year: number; category: string; amount_ht: number; is_fixed_charge: boolean | null; prorata_ht: number | null }[] = []

  if (clientId) {
    const { data: caRows } = await serviceSupabase
      .from('weekly_ca')
      .select('week_number, year, ca_total, families_detail')
      .eq('client_id', clientId)
      .order('year', { ascending: false }).order('week_number', { ascending: false })
      .limit(4)
    weeks = (caRows || [])
      .map((r: any) => ({
        key: keyOf(r.year, r.week_number), week: r.week_number, year: r.year,
        ca: parseFloat(String(r.ca_total || 0)),
        familles: Array.isArray(r.families_detail) ? r.families_detail : [],
      }))
      .filter(w => w.ca > 0)
      .sort((a, b) => a.key.localeCompare(b.key))

    if (weeks.length > 0) {
      const { data: invRows } = await serviceSupabase
        .from('invoices')
        .select('week_number, year, category, amount_ht, is_fixed_charge, prorata_ht')
        .eq('client_id', clientId)
        .in('year', [...new Set(weeks.map(w => w.year))])
      invoices = (invRows || []).filter((i: any) => weeks.some(w => w.week === i.week_number && w.year === i.year))
    }
  }

  // ── Agrégats sur la période lissée ──
  const caByRayon: Record<Rayon, number> = { boucherie: 0, charcuterie: 0, vente: 0 }
  const caByRayonWeek: Record<Rayon, number[]> = { boucherie: [], charcuterie: [], vente: [] }
  for (const w of weeks) {
    const perWeek: Record<Rayon, number> = { boucherie: 0, charcuterie: 0, vente: 0 }
    for (const f of w.familles) {
      const r = famToRayon(String(f.nom || ''))
      perWeek[r] += Number(f.montant) || 0
    }
    (Object.keys(perWeek) as Rayon[]).forEach(r => { caByRayon[r] += perWeek[r]; caByRayonWeek[r].push(perWeek[r]) })
  }

  const achatsByRayon: Record<Rayon, number> = { boucherie: 0, charcuterie: 0, vente: 0 }
  let coutsTransverses = 0
  let chargesFixes = 0
  for (const inv of invoices) {
    const amount = parseFloat(String(inv.amount_ht || 0))
    if (inv.is_fixed_charge) { chargesFixes += parseFloat(String(inv.prorata_ht || 0)); continue }
    const r = catToRayon(String(inv.category || 'autre'))
    if (r) achatsByRayon[r] += amount
    else coutsTransverses += amount
  }

  const caTotal = weeks.reduce((s, w) => s + w.ca, 0)
  const achatsTotal = achatsByRayon.boucherie + achatsByRayon.charcuterie + achatsByRayon.vente + coutsTransverses + chargesFixes
  const margeGlobale = caTotal > 0 ? ((caTotal - achatsTotal) / caTotal) * 100 : null

  const rayons = (Object.keys(RAYON_LABELS) as Rayon[])
    .map(r => {
      const ca = caByRayon[r]
      const achats = achatsByRayon[r]
      const marge = ca > 0 ? ((ca - achats) / ca) * 100 : null
      return { r, label: RAYON_LABELS[r], ca, achats, margeEur: ca - achats, marge, series: caByRayonWeek[r] }
    })
    .filter(x => x.ca > 0 || x.achats > 0)
    .sort((a, b) => b.ca - a.ca)

  const periodLabel = weeks.length > 0
    ? `S${weeks[0].week} → S${weeks[weeks.length - 1].week} (${weeks.length} semaine${weeks.length > 1 ? 's' : ''} lissée${weeks.length > 1 ? 's' : ''})`
    : ''

  const margeColor = (m: number | null) =>
    m === null ? 'text-gray-400' : m >= 40 ? 'text-green-600' : m >= 30 ? 'text-orange-500' : 'text-red-600'

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <div className="mb-8 flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-pilote-50 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Percent className="w-5 h-5 text-pilote" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Marges par rayon</h1>
          <p className="text-sm text-gray-500 mt-1">
            CA des familles de vente vs achats catégorisés · {periodLabel || 'en attente de données'}
          </p>
        </div>
      </div>

      {weeks.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Percent className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-500 mb-1">Pas encore assez de données</p>
            <p className="text-xs text-gray-400 mb-4 max-w-sm mx-auto">Il faut au moins une semaine avec un CA archivé (via un rapport ou une saisie) et des factures catégorisées.</p>
            <div className="flex items-center justify-center gap-4">
              <Link href="/dashboard/facturation" className="text-sm text-pilote font-semibold hover:underline">Facturation →</Link>
              <Link href="/dashboard/reports" className="text-sm text-pilote font-semibold hover:underline">Mes rapports →</Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Marge globale */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <Card className="hover:shadow-card-hover transition-shadow"><CardContent className="p-5">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">CA cumulé</p>
              <p className="text-2xl font-bold tracking-tight text-gray-900 tabular">{fmt(caTotal)} €</p>
            </CardContent></Card>
            <Card className="hover:shadow-card-hover transition-shadow"><CardContent className="p-5">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Achats cumulés</p>
              <p className="text-2xl font-bold tracking-tight text-gray-900 tabular">{fmt(achatsTotal)} €</p>
              <p className="text-xs text-gray-400 mt-1 tabular">dont fixes {fmt(chargesFixes)} € · transverses {fmt(coutsTransverses)} €</p>
            </CardContent></Card>
            <Card className="hover:shadow-card-hover transition-shadow"><CardContent className="p-5">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Marge globale</p>
              <p className={`text-2xl font-bold tracking-tight tabular ${margeColor(margeGlobale)}`}>{margeGlobale !== null ? `${margeGlobale.toFixed(1)} %` : '—'}</p>
            </CardContent></Card>
          </div>

          {/* Tableau par rayon */}
          <Card className="mb-6 overflow-hidden">
            <CardHeader>
              <CardTitle className="text-base">Marge matière par rayon</CardTitle>
              <CardDescription>Lissée sur {weeks.length} semaine{weeks.length > 1 ? 's' : ''} · les achats d'une semaine se vendent sur les suivantes, le cumul gomme l'effet stock</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                    <th className="px-4 py-2.5 text-left">Rayon</th>
                    <th className="px-4 py-2.5 text-right">CA</th>
                    <th className="px-4 py-2.5 text-right">Achats matière</th>
                    <th className="px-4 py-2.5 text-right">Marge €</th>
                    <th className="px-4 py-2.5 text-right">Marge %</th>
                  </tr>
                </thead>
                <tbody>
                  {rayons.map((x) => (
                    <tr key={x.r} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900">{x.label}</td>
                      <td className="px-4 py-3 text-right text-sm text-gray-700 tabular">{fmt(x.ca)} €</td>
                      <td className="px-4 py-3 text-right text-sm text-gray-700 tabular">{fmt(x.achats)} €</td>
                      <td className={`px-4 py-3 text-right text-sm font-semibold tabular ${x.margeEur >= 0 ? 'text-gray-900' : 'text-red-600'}`}>{fmt(x.margeEur)} €</td>
                      <td className={`px-4 py-3 text-right text-sm font-bold tabular ${margeColor(x.marge)}`}>{x.marge !== null ? `${x.marge.toFixed(1)} %` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-pilote text-white">
                    <td className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-white/60">Total (hors transverses/fixes)</td>
                    <td className="px-4 py-3 text-right font-bold tabular">{fmt(caTotal)} €</td>
                    <td className="px-4 py-3 text-right font-bold tabular">{fmt(achatsByRayon.boucherie + achatsByRayon.charcuterie + achatsByRayon.vente)} €</td>
                    <td className="px-4 py-3 text-right font-bold tabular text-green-300">{fmt(caTotal - achatsByRayon.boucherie - achatsByRayon.charcuterie - achatsByRayon.vente)} €</td>
                    <td className="px-4 py-3 text-right font-bold tabular text-green-300">{caTotal > 0 ? `${(((caTotal - achatsByRayon.boucherie - achatsByRayon.charcuterie - achatsByRayon.vente) / caTotal) * 100).toFixed(1)} %` : '—'}</td>
                  </tr>
                </tfoot>
              </table>
            </CardContent>
          </Card>

          {/* Notes de lecture */}
          <div className="bg-pilote-50 border border-pilote-100 rounded-xl p-5 flex gap-3">
            <Info className="w-4 h-4 text-pilote flex-shrink-0 mt-0.5" />
            <div className="text-xs text-gray-600 space-y-2 leading-relaxed">
              <p><span className="font-semibold text-gray-800">Comment lire :</span> marge matière lissée sur {weeks.length} semaine{weeks.length > 1 ? 's' : ''}. Précise à 2-3 points près (variation de stock non déduite), la tendance est fiable. Cible métier : boucherie 30-40 %, charcuterie 40-50 %, traiteur 50-65 %.</p>
              <p><span className="font-semibold text-gray-800">Traiteur :</span> fusionné avec la boucherie car il consomme la même matière. Si sa part de CA augmente, la marge du rayon doit monter. Sinon, la valorisation carcasse mérite un œil.</p>
              <p><span className="font-semibold text-gray-800">Fiabilité :</span> dépend de la bonne catégorisation des factures (page Facturation). Emballage, frais généraux et charges fixes sont volontairement hors marge rayon.</p>
              <p><span className="font-semibold text-gray-800">Contrôle croisé :</span> comparez avec la marge théorique de vos valorisations carcasse. Un écart durable = démarque (pertes, erreurs de prix, vol).</p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
