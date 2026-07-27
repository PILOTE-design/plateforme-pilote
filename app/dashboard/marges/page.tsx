import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { computeWeekEconomics, type WeekEconomics } from '@/lib/week-economics'
import { benchOf } from '@/lib/postes'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Percent, Info, Settings2, AlertTriangle } from 'lucide-react'
import Link from 'next/link'

// Page Marges — vue LISSÉE (4 dernières semaines) du moteur unique lib/week-economics.
// Elle ne connaît aucun classement à elle : les familles sont celles que le client a
// choisies en facturation (clients.margin_families), les achats sont ventilés par la
// répartition fournisseur (supplier_rayon_splits) et les salaires viennent du planning.
// Un seul réglage pour toute l'application, plus de « catégorisation » parallèle.

const fmt = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })
const pct = (n: number | null) => (n === null ? '—' : `${n.toFixed(1)} %`)

type WeekRow = { week: number; year: number; eco: WeekEconomics }

/** Ligne agrégée d'une famille sur toute la période */
type FamRow = {
  key: string
  label: string
  ca: number
  achats: number
  salaires: number
  ventile: boolean
  taux: number | null
  tauxTotal: number | null
  bench: [number, number] | null
}

export default async function MargesPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const serviceSupabase = createServiceClient()
  const clientId = await resolveClientId(serviceSupabase, user!.id, user?.email)

  // Marges = année en cours (cohérent avec Tendances : les semaines N-1 archivées sont exclues)
  const currentYear = new Date().getFullYear()

  let rowsRaw: any[] = []
  if (clientId) {
    const { data } = await serviceSupabase
      .from('weekly_ca')
      .select('*')
      .eq('client_id', clientId)
      .eq('year', currentYear)
      .order('week_number', { ascending: false })
      .limit(4)
    rowsRaw = (data || []).filter((r: any) => parseFloat(String(r.ca_total || 0)) > 0)
  }

  // Une passe du moteur par semaine — mêmes chiffres qu'en facturation et dans le PDF.
  const weeks: WeekRow[] = clientId
    ? await Promise.all(
        rowsRaw.map(async (r: any): Promise<WeekRow> => ({
          week: r.week_number,
          year: r.year,
          eco: await computeWeekEconomics(serviceSupabase, clientId, r.week_number, r.year, {
            ca_total: parseFloat(String(r.ca_total || 0)) || 0,
            familles: Array.isArray(r.families_detail) ? r.families_detail : null,
            by_rayon: {
              boucherie:   parseFloat(String(r.ca_boucherie || 0)) || 0,
              charcuterie: parseFloat(String(r.ca_charcuterie || 0)) || 0,
              traiteur:    parseFloat(String(r.ca_traiteur || 0)) || 0,
            },
          }),
        })),
      )
    : []
  weeks.sort((a, b) => a.week - b.week)

  // ── Cumuls sur la période ──
  const sum = (pick: (e: WeekEconomics) => number) => weeks.reduce((s, w) => s + (pick(w.eco) || 0), 0)
  const caTotal        = sum(e => e.ca_total)
  const achatsTotal    = sum(e => e.achats_ht)
  const aVerifier      = sum(e => e.achats_a_verifier)
  const nonVentiles    = sum(e => e.achats_non_ventiles)
  const masseSalariale = sum(e => e.masse_salariale)
  const salairesHorsFam = sum(e => e.salaires_non_affectes)
  const chargesFixes   = sum(e => e.charges_fixes)

  const margeBrute  = caTotal - achatsTotal
  const tauxMarge   = caTotal > 0 ? (margeBrute / caTotal) * 100 : null
  const resultatNet = margeBrute - masseSalariale - chargesFixes
  const ratioMs     = caTotal > 0 ? (masseSalariale / caTotal) * 100 : null

  // Les familles sont identiques d'une semaine à l'autre (réglage client) → agrégation par index.
  const famRows: FamRow[] = (weeks[0]?.eco.familles || []).map((f, i) => {
    const ca       = sum(e => e.familles[i]?.ca || 0)
    const achats   = sum(e => e.familles[i]?.achats || 0)
    const salaires = sum(e => e.familles[i]?.salaires || 0)
    return {
      key: f.key,
      label: f.label,
      ca, achats, salaires,
      ventile: weeks.some(w => w.eco.familles[i]?.achats_ventiles),
      taux: ca > 0 ? ((ca - achats) / ca) * 100 : null,
      tauxTotal: ca > 0 ? ((ca - achats - salaires) / ca) * 100 : null,
      bench: benchOf(f.key, f.label),
    }
  })
  // Divers : 4e ligne (rachat, épicerie, boissons, fruits & légumes, prestations).
  // Ni repère de marge ni salaires — ce n'est pas un métier, juste de l'achat-revente.
  const diversRow: FamRow = {
    key: 'divers',
    label: weeks[0]?.eco.divers.label || 'Divers',
    ca: sum(e => e.divers.ca), achats: sum(e => e.divers.achats), salaires: 0,
    ventile: weeks.some(w => w.eco.divers.achats_ventiles),
    taux: null, tauxTotal: null, bench: null,
  }
  diversRow.taux = diversRow.ca > 0 ? ((diversRow.ca - diversRow.achats) / diversRow.ca) * 100 : null
  diversRow.tauxTotal = diversRow.taux
  const hasDivers = diversRow.ca > 0 || diversRow.achats > 0

  const famSansAchats = famRows.filter(f => f.ca > 0 && !f.ventile)
  const caFamilles     = famRows.reduce((s, f) => s + f.ca, 0)
  const achatsFamilles = famRows.reduce((s, f) => s + f.achats, 0)
  const salFamilles    = famRows.reduce((s, f) => s + f.salaires, 0)
  const caHorsFamilles = Math.max(0, caTotal - caFamilles - (hasDivers ? diversRow.ca : 0))

  const periodLabel = weeks.length > 0
    ? `S${weeks[0].week} → S${weeks[weeks.length - 1].week} · ${currentYear} (${weeks.length} semaine${weeks.length > 1 ? 's' : ''} lissée${weeks.length > 1 ? 's' : ''})`
    : ''

  // Couleur : le repère de la famille quand il existe, sinon les seuils généraux du secteur.
  const margeColor = (m: number | null, bench: [number, number] | null = null) => {
    if (m === null) return 'text-gray-400'
    const [lo, hi] = bench ?? [30, 40]
    return m >= hi ? 'text-green-600' : m >= lo ? 'text-orange-500' : 'text-red-600'
  }
  const msColor = ratioMs === null ? 'text-gray-400' : ratioMs > 50 ? 'text-gray-500' : ratioMs < 30 ? 'text-green-600' : ratioMs <= 40 ? 'text-orange-500' : 'text-red-600'

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <div className="mb-8 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-pilote to-pilote-hover rounded-2xl flex items-center justify-center flex-shrink-0 shadow-card">
            <Percent className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Marges par famille</h1>
            <p className="text-sm text-gray-500 mt-1">
              {famRows.length > 0 ? famRows.map(f => f.label).join(' · ') : 'Vos familles de marge'} — vos familles, votre ventilation fournisseur · {periodLabel || 'en attente de données'}
            </p>
          </div>
        </div>
        <Link href="/dashboard/facturation"
          className="flex items-center gap-1.5 text-xs font-semibold text-pilote border border-pilote-200 rounded-xl px-3 py-2 hover:bg-pilote-50 transition-colors">
          <Settings2 className="w-3.5 h-3.5" />Régler familles et ventilation
        </Link>
      </div>

      {weeks.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Percent className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-500 mb-1">Pas encore assez de données</p>
            <p className="text-xs text-gray-400 mb-4 max-w-sm mx-auto">Il faut au moins une semaine {currentYear} avec un CA archivé (via un rapport ou une saisie) et des factures d&apos;achat enregistrées.</p>
            <div className="flex items-center justify-center gap-4">
              <Link href="/dashboard/facturation" className="text-sm text-pilote font-semibold hover:underline">Facturation →</Link>
              <Link href="/dashboard/reports" className="text-sm text-pilote font-semibold hover:underline">Mes rapports →</Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Alertes de fiabilité */}
          {(aVerifier > 0 || nonVentiles > 0 || famSansAchats.length > 0) && (
            <div className="mb-6 space-y-2">
              {aVerifier > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm text-amber-800">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span><strong>{fmt(aVerifier)} € de factures « à vérifier »</strong> exclues du calcul — validez-les pour des marges complètes.</span>
                  <Link href="/dashboard/facturation" className="ml-auto text-xs font-bold underline whitespace-nowrap">Valider →</Link>
                </div>
              )}
              {nonVentiles > 0 && (
                <div className="bg-pilote-50 border border-pilote-200 rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm text-pilote-800">
                  <Info className="w-4 h-4 flex-shrink-0" />
                  <span><strong>{fmt(nonVentiles)} € d&apos;achats sans ventilation</strong> — ces fournisseurs pèsent sur la marge globale mais sur aucune famille.</span>
                  <Link href="/dashboard/facturation" className="ml-auto text-xs font-bold underline whitespace-nowrap">Ventiler →</Link>
                </div>
              )}
              {famSansAchats.length > 0 && (
                <div className="bg-pilote-50 border border-pilote-200 rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm text-pilote-800">
                  <Info className="w-4 h-4 flex-shrink-0" />
                  <span><strong>{famSansAchats.map(f => f.label).join(', ')}</strong> : aucun achat ventilé sur {famSansAchats.length > 1 ? 'ces familles' : 'cette famille'} — leur marge est donc surévaluée.</span>
                  <Link href="/dashboard/facturation" className="ml-auto text-xs font-bold underline whitespace-nowrap">Ventiler →</Link>
                </div>
              )}
            </div>
          )}

          {/* KPIs globaux */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Card className="hover:shadow-card-hover transition-shadow"><CardContent className="p-5">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">CA cumulé</p>
              <p className="text-2xl font-bold tracking-tight text-gray-900 tabular">{fmt(caTotal)} €</p>
              <p className="text-xs text-gray-400 mt-1 tabular">achats {fmt(achatsTotal)} €</p>
            </CardContent></Card>
            <Card className="hover:shadow-card-hover transition-shadow"><CardContent className="p-5">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Marge brute</p>
              <p className={`text-2xl font-bold tracking-tight tabular ${margeColor(tauxMarge)}`}>{pct(tauxMarge)}</p>
              <p className="text-xs text-gray-400 mt-1 tabular">{fmt(margeBrute)} € · repère &gt; 40 %</p>
            </CardContent></Card>
            <Card className="hover:shadow-card-hover transition-shadow"><CardContent className="p-5">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Masse salariale</p>
              <p className={`text-2xl font-bold tracking-tight tabular ${msColor}`}>{pct(ratioMs)}</p>
              <p className="text-xs text-gray-400 mt-1 tabular">{fmt(masseSalariale)} € chargés</p>
            </CardContent></Card>
            <Card className="hover:shadow-card-hover transition-shadow"><CardContent className="p-5">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Résultat net</p>
              <p className={`text-2xl font-bold tracking-tight tabular ${resultatNet >= 0 ? 'text-gray-900' : 'text-red-600'}`}>{fmt(resultatNet)} €</p>
              <p className="text-xs text-gray-400 mt-1 tabular">charges fixes {fmt(chargesFixes)} €</p>
            </CardContent></Card>
          </div>

          {/* Tableau par famille */}
          <Card className="mb-6 overflow-hidden">
            <CardHeader>
              <CardTitle className="text-base">Marge par famille</CardTitle>
              <CardDescription>Lissée sur {weeks.length} semaine{weeks.length > 1 ? 's' : ''} · achats ventilés par fournisseur · salaires pointés au planning · charges fixes hors familles (résultat net uniquement)</CardDescription>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead>
                  <tr className="bg-gray-50 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                    <th className="px-4 py-2.5 text-left">Famille</th>
                    <th className="px-4 py-2.5 text-right">CA</th>
                    <th className="px-4 py-2.5 text-right">Achats</th>
                    <th className="px-4 py-2.5 text-right">Marge €</th>
                    <th className="px-4 py-2.5 text-right">Marge %</th>
                    <th className="px-4 py-2.5 text-right">Repère</th>
                    <th className="px-4 py-2.5 text-right">Salaires</th>
                    <th className="px-4 py-2.5 text-right">Après salaires</th>
                  </tr>
                </thead>
                <tbody>
                  {famRows.map(f => (
                    <tr key={f.key} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900">
                        {f.label}
                        {f.ca > 0 && !f.ventile && <span className="ml-1.5 text-[10px] font-medium text-amber-600">achats non ventilés</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-gray-700 tabular">{fmt(f.ca)} €</td>
                      <td className="px-4 py-3 text-right text-sm text-gray-700 tabular">{fmt(f.achats)} €</td>
                      <td className={`px-4 py-3 text-right text-sm font-semibold tabular ${f.ca - f.achats >= 0 ? 'text-gray-900' : 'text-red-600'}`}>{fmt(f.ca - f.achats)} €</td>
                      <td className={`px-4 py-3 text-right text-sm font-bold tabular ${margeColor(f.taux, f.bench)}`}>{pct(f.taux)}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-gray-400 tabular">{f.bench ? `${f.bench[0]}-${f.bench[1]} %` : '—'}</td>
                      <td className="px-4 py-3 text-right text-xs text-gray-500 tabular">{f.salaires > 0 ? `${fmt(f.salaires)} €` : '—'}</td>
                      <td className={`px-4 py-3 text-right text-sm font-semibold tabular ${f.tauxTotal !== null && f.tauxTotal < 0 ? 'text-red-600' : 'text-gray-700'}`}>{pct(f.tauxTotal)}</td>
                    </tr>
                  ))}
                  {hasDivers && (
                    <tr className="border-t border-gray-100 bg-gray-50/40 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-sm font-semibold text-gray-700">
                        {diversRow.label}
                        <span className="ml-1.5 text-[10px] font-medium text-gray-400">rachat, épicerie, boissons, fruits &amp; légumes</span>
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-gray-700 tabular">{fmt(diversRow.ca)} €</td>
                      <td className="px-4 py-3 text-right text-sm text-gray-700 tabular">{fmt(diversRow.achats)} €</td>
                      <td className={`px-4 py-3 text-right text-sm font-semibold tabular ${diversRow.ca - diversRow.achats >= 0 ? 'text-gray-900' : 'text-red-600'}`}>{fmt(diversRow.ca - diversRow.achats)} €</td>
                      <td className="px-4 py-3 text-right text-sm font-bold tabular text-gray-600">{pct(diversRow.taux)}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-gray-400">—</td>
                      <td className="px-4 py-3 text-right text-xs text-gray-400 tabular">—</td>
                      <td className="px-4 py-3 text-right text-sm font-semibold tabular text-gray-600">{pct(diversRow.tauxTotal)}</td>
                    </tr>
                  )}
                  {(caHorsFamilles > 0 || nonVentiles > 0 || salairesHorsFam > 0) && (
                    <tr className="border-t border-gray-100 bg-gray-50/60">
                      <td className="px-4 py-3 text-xs font-semibold text-gray-500">Hors familles</td>
                      <td className="px-4 py-3 text-right text-xs text-gray-500 tabular">{caHorsFamilles > 0 ? `${fmt(caHorsFamilles)} €` : '—'}</td>
                      <td className="px-4 py-3 text-right text-xs text-gray-500 tabular">{nonVentiles > 0 ? `${fmt(nonVentiles)} €` : '—'}</td>
                      <td className="px-4 py-3" />
                      <td className="px-4 py-3" />
                      <td className="px-4 py-3" />
                      <td className="px-4 py-3 text-right text-xs text-gray-500 tabular">{salairesHorsFam > 0 ? `${fmt(salairesHorsFam)} €` : '—'}</td>
                      <td className="px-4 py-3" />
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-pilote text-white">
                    <td className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-white/60">Total familles</td>
                    <td className="px-4 py-3 text-right font-bold tabular">{fmt(caFamilles)} €</td>
                    <td className="px-4 py-3 text-right font-bold tabular">{fmt(achatsFamilles)} €</td>
                    <td className="px-4 py-3 text-right font-bold tabular text-green-300">{fmt(caFamilles - achatsFamilles)} €</td>
                    <td className="px-4 py-3 text-right font-bold tabular text-green-300">{pct(caFamilles > 0 ? ((caFamilles - achatsFamilles) / caFamilles) * 100 : null)}</td>
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3 text-right font-bold tabular text-white/70">{fmt(salFamilles)} €</td>
                    <td className="px-4 py-3 text-right font-bold tabular text-green-300">{pct(caFamilles > 0 ? ((caFamilles - achatsFamilles - salFamilles) / caFamilles) * 100 : null)}</td>
                  </tr>
                </tfoot>
              </table>
            </CardContent>
          </Card>

          {/* Notes de lecture */}
          <div className="bg-pilote-50 border border-pilote-100 rounded-xl p-5 flex gap-3">
            <Info className="w-4 h-4 text-pilote flex-shrink-0 mt-0.5" />
            <div className="text-xs text-gray-600 space-y-2 leading-relaxed">
              <p><span className="font-semibold text-gray-800">Comment lire :</span> marge lissée sur {weeks.length} semaine{weeks.length > 1 ? 's' : ''} — les achats d&apos;une semaine se vendent sur les suivantes, le cumul gomme l&apos;effet stock. Précise à 2-3 points près, la tendance est fiable.</p>
              <p><span className="font-semibold text-gray-800">Un seul réglage :</span> les familles affichées sont celles que vous avez choisies en facturation, et les achats sont répartis par la ventilation de chaque fournisseur. Les mêmes chiffres apparaissent en facturation et dans votre rapport hebdomadaire — il n&apos;y a plus de classement séparé à tenir à jour.</p>
              <p><span className="font-semibold text-gray-800">Divers :</span> rachat, épicerie, boissons, fromage, fruits &amp; légumes, prestations — acheté fini, revendu tel quel. Ce bloc existe pour que les trois métiers restent lisibles : sans lui, ses achats seraient étalés sur eux et un cageot de tomates viendrait plomber la marge boucherie.</p>
              <p><span className="font-semibold text-gray-800">Salaires :</span> coût chargé issu du planning, réparti d&apos;après les postes pointés. Les heures dont le poste ne correspond à aucune famille (vente, administratif, livraison…) restent transverses : elles comptent dans la masse salariale globale, pas dans une famille.</p>
              <p><span className="font-semibold text-gray-800">Fiabilité :</span> seules les factures <strong>validées</strong> comptent — les imports automatiques restent « à vérifier » jusqu&apos;à votre validation en page Facturation. Contrôle croisé : comparez avec la marge théorique de vos valorisations carcasse ; un écart durable = démarque (pertes, erreurs de prix, vol).</p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
