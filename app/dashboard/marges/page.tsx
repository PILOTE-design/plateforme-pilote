import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { computeWeekEconomics, type WeekEconomics } from '@/lib/week-economics'
import { familleMatchesText, margeFiabilite, effectiveCaStems } from '@/lib/postes'
import { ensureMarginFamilies, caByFamily, type MarginFamily } from '@/lib/margin-families'
import { normalizeSupplierName, sameSupplierFamily, supplierSociete } from '@/lib/supplier-memory'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Percent, Info, Settings2, AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { RepereEditor, StemsEditor } from './repere-editor'

// Page Marges — vue LISSÉE (4 dernières semaines) du moteur unique
// lib/week-economics, complétée depuis le 28/07 par le RÉFÉRENTIEL de familles
// personnalisable (margin_families) :
//   · SOUS-FAMILLES de boucherie (bœuf, veau, porc, agneau, volaille) — CA
//     détaillé depuis les familles de vente du rapport ;
//   · le bloc Divers ÉCLATÉ par familles d'achat-revente (fruits & légumes,
//     fromages, rachats, prestation, alcool, épicerie) ;
//   · REPÈRES de marge modifiables ligne à ligne ;
//   · colonne CUMUL 12 MOIS GLISSANTS (le cumul long gomme l'effet stock).
// La boussole de la page est la MARGE SUR COÛT DIRECT : CA − achats − salaires
// du planning. Les charges fixes restent hors de cette page (rapport hebdo).

const fmt = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })
const pct = (n: number | null) => (n === null ? '—' : `${n.toFixed(1)} %`)

type WeekRow = { week: number; year: number; eco: WeekEconomics }

/** Ligne agrégée d'une famille métier sur la période lissée */
type FamRow = {
  key: string
  label: string
  refFam: MarginFamily | null
  ca: number
  achats: number
  salaires: number
  ventile: boolean
  taux: number | null        // marge matière (CA − achats) / CA
  tauxDirect: number | null  // marge sur coût direct (CA − achats − salaires) / CA
  taux12: number | null      // marge matière cumulée 12 mois glissants
}

function isoWeekOf(d: Date): { week: number; year: number } {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return { week: Math.ceil((((t.getTime() - yearStart.getTime()) / 86400000) + 1) / 7), year: t.getUTCFullYear() }
}

export default async function MargesPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const serviceSupabase = createServiceClient()
  const clientId = await resolveClientId(serviceSupabase, user!.id, user?.email)

  const now = new Date()
  const currentYear = now.getFullYear()
  const { week: currentWeek } = isoWeekOf(now)
  // Fenêtre 12 mois glissants, en semaines ISO : toute l'année en cours + la fin
  // de l'année précédente (semaines strictement postérieures à la semaine du jour).
  const inWindow = (y: number, w: number) => y === currentYear || (y === currentYear - 1 && w > currentWeek)

  const families: MarginFamily[] = clientId ? await ensureMarginFamilies(serviceSupabase, clientId) : []

  // ── Données 12 mois : CA archivés + factures validées, UNE requête chacun ──
  let ca12Rows: any[] = []
  let inv12Rows: any[] = []
  let splitRows: any[] = []
  let rowsRaw: any[] = []
  // Vocabulaire de reconnaissance du client (clients.ca_stems) — le cumul 12 mois
  // ci-dessous rattache les libellés de vente aux familles EXACTEMENT comme le
  // moteur hebdo ; sans ce réglage partagé, l'écran et le moteur diviseraient le
  // CA différemment dès qu'un client personnalise son vocabulaire.
  let caStemsRaw: unknown = null
  if (clientId) {
    const [{ data: caData }, { data: invData }, { data: splitData }, { data: clientRow }] = await Promise.all([
      serviceSupabase.from('weekly_ca')
        .select('week_number, year, ca_total, families_detail, ca_boucherie, ca_charcuterie, ca_traiteur')
        .eq('client_id', clientId).in('year', [currentYear - 1, currentYear]),
      serviceSupabase.from('invoices')
        .select('amount_ht, supplier_name, is_fixed_charge, status, week_number, year')
        .eq('client_id', clientId).in('year', [currentYear - 1, currentYear])
        .eq('is_fixed_charge', false),
      serviceSupabase.from('supplier_rayon_splits')
        .select('supplier_key, pct_boucherie, pct_charcuterie, pct_traiteur, pct_fruits_et_legumes, pct_divers')
        .eq('client_id', clientId),
      serviceSupabase.from('clients').select('ca_stems').eq('id', clientId).maybeSingle(),
    ])
    caStemsRaw = (clientRow as { ca_stems?: unknown } | null)?.ca_stems ?? null
    ca12Rows = (caData || []).filter((r: any) => inWindow(r.year, r.week_number) && parseFloat(String(r.ca_total || 0)) > 0)
    inv12Rows = (invData || []).filter((r: any) => inWindow(r.year, r.week_number) && r.status === 'validee')
    splitRows = splitData || []
    rowsRaw = [...ca12Rows].filter((r: any) => r.year === currentYear)
      .sort((a: any, b: any) => b.week_number - a.week_number).slice(0, 4)
  }

  // Une passe du moteur par semaine lissée — mêmes chiffres qu'en facturation et dans le PDF.
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

  // ── Cumuls sur la période lissée ──
  const sum = (pick: (e: WeekEconomics) => number) => weeks.reduce((s, w) => s + (pick(w.eco) || 0), 0)
  const caTotal        = sum(e => e.ca_total)
  const achatsTotal    = sum(e => e.achats_ht)
  const aVerifier      = sum(e => e.achats_a_verifier)
  const nonVentiles    = sum(e => e.achats_non_ventiles)
  const masseSalariale = sum(e => e.masse_salariale)
  const salairesRepartis = sum(e => e.salaires_repartis)
  const salairesHorsFam  = sum(e => e.salaires_non_affectes)

  const margeBrute  = caTotal - achatsTotal
  const tauxMarge   = caTotal > 0 ? (margeBrute / caTotal) * 100 : null
  const margeCoutDirect = margeBrute - masseSalariale
  const tauxCoutDirect  = caTotal > 0 ? (margeCoutDirect / caTotal) * 100 : null
  const ratioMs     = caTotal > 0 ? (masseSalariale / caTotal) * 100 : null

  // ── 12 mois glissants : CA par famille (libellés de vente) + achats ventilés ──
  const entries12: { nom?: unknown; montant?: unknown }[] = ca12Rows.flatMap((r: any) => Array.isArray(r.families_detail) ? r.families_detail : [])
  const entries4: { nom?: unknown; montant?: unknown }[] = rowsRaw.flatMap((r: any) => Array.isArray(r.families_detail) ? r.families_detail : [])
  const ca12ByRef = caByFamily(entries12, families).byId
  const ca4ByRef  = caByFamily(entries4, families).byId
  const ca12Total = ca12Rows.reduce((s: number, r: any) => s + (parseFloat(String(r.ca_total || 0)) || 0), 0)

  const caStems = effectiveCaStems(caStemsRaw)
  const famDefs = weeks[0]?.eco.familles || []
  const ca12Fam = famDefs.map(f =>
    entries12.reduce((s, e) => s + (familleMatchesText(f.key, f.label, String(e?.nom ?? ''), String(e?.nom ?? ''), caStems) ? (Number(e?.montant) || 0) : 0), 0))

  // Ventilation 12 mois des achats — même règle que le moteur (splits fournisseur,
  // fruits & légumes replié dans divers), réécrite ici sur la fenêtre longue.
  const splitFor = (supplierName: string) => {
    const q = normalizeSupplierName(supplierSociete(supplierName || ''))
    if (!q) return null
    let best: any = null
    for (const s of splitRows) {
      if (s.supplier_key === q) return s
      if (sameSupplierFamily(s.supplier_key, q) && (best === null || String(s.supplier_key).length > String(best.supplier_key).length)) best = s
    }
    return best
  }
  const achats12 = { boucherie: 0, charcuterie: 0, traiteur: 0, divers: 0, non_ventiles: 0, total: 0 }
  for (const inv of inv12Rows) {
    const amt = parseFloat(String(inv.amount_ht || 0)) || 0
    if (!amt) continue
    achats12.total += amt
    const sp = splitFor(inv.supplier_name)
    const pDivers = Number(sp?.pct_divers || 0) + Number(sp?.pct_fruits_et_legumes || 0)
    const tot = sp ? (Number(sp.pct_boucherie) + Number(sp.pct_charcuterie) + Number(sp.pct_traiteur) + pDivers) : 0
    if (!sp || tot <= 0) { achats12.non_ventiles += amt; continue }
    achats12.boucherie   += amt * (Number(sp.pct_boucherie)   / tot)
    achats12.charcuterie += amt * (Number(sp.pct_charcuterie) / tot)
    achats12.traiteur    += amt * (Number(sp.pct_traiteur)    / tot)
    achats12.divers      += amt * (pDivers                    / tot)
  }

  // ── Lignes familles métier (période lissée + colonne 12 mois) ──
  const refRoots = families.filter(f => f.parent_id === null)
  const refOf = (key: string, label: string) =>
    refRoots.find(r => r.name_key === key || familleMatchesText(key, label, r.name_key, r.name)) ?? null

  const famRows: FamRow[] = famDefs.map((f, i) => {
    const ca       = sum(e => e.familles[i]?.ca || 0)
    const achats   = sum(e => e.familles[i]?.achats || 0)
    const salaires = sum(e => e.familles[i]?.salaires || 0)
    const a12 = (achats12 as Record<string, number>)[f.key] ?? 0
    const c12 = ca12Fam[i] || 0
    return {
      key: f.key,
      label: f.label,
      refFam: refOf(f.key, f.label),
      ca, achats, salaires,
      ventile: weeks.some(w => w.eco.familles[i]?.achats_ventiles),
      // Voir lib/week-economics : sans achats rattachés, le taux vaudrait 100 %
      // et serait peint en vert. On n'affiche rien plutôt qu'un chiffre faux.
      taux: ca > 0 && achats > 0 ? ((ca - achats) / ca) * 100 : null,
      tauxDirect: ca > 0 && achats > 0 ? ((ca - achats - salaires) / ca) * 100 : null,
      taux12: c12 > 0 && a12 > 0 ? ((c12 - a12) / c12) * 100 : null,
    }
  })

  // Sous-familles (CA seul : la ventilation fournisseur ne descend pas encore à
  // ce niveau — elle viendra avec le chantier Facturation).
  const childrenOf = (root: MarginFamily | null) => root === null ? [] : families.filter(f => f.parent_id === root.id)

  // Divers : le bloc reste la ligne d'achats agrégée ; ses familles d'achat-revente
  // du référentiel en ÉCLATENT le CA (fruits & légumes, fromages, rachats…).
  const matchedRootIds = new Set(famRows.map(r => r.refFam?.id).filter(Boolean) as string[])
  const diversDetail = refRoots.filter(r => !matchedRootIds.has(r.id))
  const diversRow = {
    label: weeks[0]?.eco.divers.label || 'Divers',
    ca: sum(e => e.divers.ca), achats: sum(e => e.divers.achats), salaires: sum(e => e.divers.salaires),
    ventile: weeks.some(w => w.eco.divers.achats_ventiles),
  }
  const ca12Divers = Math.max(0, ca12Total - ca12Fam.reduce((a, b) => a + b, 0))
  const diversTaux = diversRow.ca > 0 && diversRow.achats > 0 ? ((diversRow.ca - diversRow.achats) / diversRow.ca) * 100 : null
  const diversTauxDirect = diversRow.ca > 0 && diversRow.achats > 0 ? ((diversRow.ca - diversRow.achats - diversRow.salaires) / diversRow.ca) * 100 : null
  const diversTaux12 = ca12Divers > 0 && achats12.divers > 0 ? ((ca12Divers - achats12.divers) / ca12Divers) * 100 : null
  const hasDivers = diversRow.ca > 0 || diversRow.achats > 0

  const famSansAchats = famRows.filter(f => f.ca > 0 && !f.ventile)
  const caFamilles     = famRows.reduce((s, f) => s + f.ca, 0)
  const achatsFamilles = famRows.reduce((s, f) => s + f.achats, 0)
  const salFamilles    = famRows.reduce((s, f) => s + f.salaires, 0)
  const caHorsFamilles = Math.max(0, caTotal - caFamilles - (hasDivers ? diversRow.ca : 0))
  const taux12Total = ca12Total > 0 && achats12.total > 0 ? ((ca12Total - achats12.total) / ca12Total) * 100 : null

  const periodLabel = weeks.length > 0
    ? `S${weeks[0].week} → S${weeks[weeks.length - 1].week} · ${currentYear} (${weeks.length} semaine${weeks.length > 1 ? 's' : ''} lissée${weeks.length > 1 ? 's' : ''})`
    : ''

  // Fiabilité de la marge globale : sans achats saisis sur la période, le taux
  // vaut mécaniquement 100 %. On ne le peint pas en vert et on dit pourquoi
  // (même règle que le tableau de bord et le rapport PDF).
  const margeInfo = margeFiabilite(caTotal, achatsTotal, tauxMarge)
  const tauxMargeAffichable = margeInfo.fiable ? tauxMarge : null

  // Couleur : le repère MODIFIABLE de la famille quand il existe, sinon les seuils généraux.
  const margeColor = (m: number | null, ref: MarginFamily | null = null) => {
    if (m === null) return 'text-gray-400'
    const lo = ref?.benchmark_lo ?? 30
    const hi = ref?.benchmark_hi ?? 40
    return m >= hi ? 'text-green-600' : m >= lo ? 'text-orange-500' : 'text-red-600'
  }
  const msColor = ratioMs === null ? 'text-gray-400' : ratioMs > 50 ? 'text-gray-500' : ratioMs < 30 ? 'text-green-600' : ratioMs <= 40 ? 'text-orange-500' : 'text-red-600'

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      <div className="mb-8 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-pilote to-pilote-hover rounded-2xl flex items-center justify-center flex-shrink-0 shadow-card">
            <Percent className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Marges par famille</h1>
            <p className="text-sm text-gray-500 mt-1">
              Marge sur coût direct (CA − achats − salaires) · repères modifiables · {periodLabel || 'en attente de données'}
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
          {(!margeInfo.fiable || aVerifier > 0 || nonVentiles > 0 || famSansAchats.length > 0) && (
            <div className="mb-6 space-y-2">
              {!margeInfo.fiable && margeInfo.message && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm text-amber-800">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{margeInfo.message}</span>
                  <Link href="/dashboard/facturation" className="ml-auto text-xs font-bold underline whitespace-nowrap">Saisir les achats →</Link>
                </div>
              )}
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
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Marge matière</p>
              <p className={`text-2xl font-bold tracking-tight tabular ${margeColor(tauxMargeAffichable)}`}>{pct(tauxMargeAffichable)}</p>
              <p className={`text-xs mt-1 tabular ${margeInfo.fiable ? 'text-gray-400' : 'text-amber-600 font-semibold'}`}>
                {margeInfo.fiable
                  ? `${fmt(margeBrute)} € · 12 mois : ${pct(taux12Total)}`
                  : margeInfo.raison === 'aucun_achat' ? 'aucune facture saisie' : 'achats incomplets'}
              </p>
            </CardContent></Card>
            <Card className="hover:shadow-card-hover transition-shadow"><CardContent className="p-5">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Masse salariale</p>
              <p className={`text-2xl font-bold tracking-tight tabular ${msColor}`}>{pct(ratioMs)}</p>
              <p className="text-xs text-gray-400 mt-1 tabular">{fmt(masseSalariale)} € chargés</p>
            </CardContent></Card>
            <Card className="hover:shadow-card-hover transition-shadow"><CardContent className="p-5">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Marge sur coût direct</p>
              <p className={`text-2xl font-bold tracking-tight tabular ${margeCoutDirect >= 0 ? 'text-gray-900' : 'text-red-600'}`}>{fmt(margeCoutDirect)} €</p>
              <p className="text-xs text-gray-400 mt-1 tabular">{pct(tauxCoutDirect)} du CA · hors charges fixes</p>
            </CardContent></Card>
          </div>

          {/* Tableau par famille */}
          <Card className="mb-6 overflow-hidden">
            <CardHeader>
              <CardTitle className="text-base">Marge par famille</CardTitle>
              <CardDescription>Lissée sur {weeks.length} semaine{weeks.length > 1 ? 's' : ''} · achats ventilés par fournisseur · salaires pointés au planning · repères modifiables (cliquer les chiffres) · cumul 12 mois glissants</CardDescription>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full min-w-[860px]">
                <thead>
                  <tr className="bg-gray-50 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                    <th className="px-4 py-2.5 text-left">Famille</th>
                    <th className="px-4 py-2.5 text-right">CA</th>
                    <th className="px-4 py-2.5 text-right">Achats</th>
                    <th className="px-4 py-2.5 text-right">Marge €</th>
                    <th className="px-4 py-2.5 text-right">Marge %</th>
                    <th className="px-4 py-2.5 text-right">Repère</th>
                    <th className="px-4 py-2.5 text-right">Salaires</th>
                    <th className="px-4 py-2.5 text-right">Marge / coût direct</th>
                    <th className="px-4 py-2.5 text-right">Marge 12 mois</th>
                  </tr>
                </thead>
                <tbody>
                  {famRows.map(f => {
                    const sous = childrenOf(f.refFam)
                    return [
                      <tr key={f.key} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-sm font-semibold text-gray-900">
                          {f.label}
                          {f.ca > 0 && !f.ventile && <span className="ml-1.5 text-[10px] font-medium text-amber-600">achats non ventilés</span>}
                          <span className="block mt-0.5">
                            <StemsEditor familyId={f.refFam?.id ?? null} stems={f.refFam?.match_stems ?? []} />
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-gray-700 tabular">{fmt(f.ca)} €</td>
                        <td className="px-4 py-3 text-right text-sm text-gray-700 tabular">{fmt(f.achats)} €</td>
                        <td className={`px-4 py-3 text-right text-sm font-semibold tabular ${f.ca - f.achats >= 0 ? 'text-gray-900' : 'text-red-600'}`}>{fmt(f.ca - f.achats)} €</td>
                        <td className={`px-4 py-3 text-right text-sm font-bold tabular ${margeColor(f.taux, f.refFam)}`}>{pct(f.taux)}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <RepereEditor familyId={f.refFam?.id ?? null} lo={f.refFam?.benchmark_lo ?? null} hi={f.refFam?.benchmark_hi ?? null} />
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-gray-500 tabular">{f.salaires > 0 ? `${fmt(f.salaires)} €` : '—'}</td>
                        <td className={`px-4 py-3 text-right text-sm font-semibold tabular ${f.tauxDirect !== null && f.tauxDirect < 0 ? 'text-red-600' : 'text-gray-700'}`}>{pct(f.tauxDirect)}</td>
                        <td className={`px-4 py-3 text-right text-sm font-semibold tabular ${margeColor(f.taux12, f.refFam)}`}>{pct(f.taux12)}</td>
                      </tr>,
                      ...sous.map(s => {
                        const ca4 = ca4ByRef.get(s.id) || 0
                        const ca12 = ca12ByRef.get(s.id) || 0
                        if (ca4 <= 0 && ca12 <= 0) return null
                        return (
                          <tr key={s.id} className="border-t border-gray-50 bg-gray-50/30 hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-2 text-xs text-gray-500 pl-8">└ {s.name}</td>
                            <td className="px-4 py-2 text-right text-xs text-gray-500 tabular">{ca4 > 0 ? `${fmt(ca4)} €` : '—'}</td>
                            <td className="px-4 py-2 text-right text-[11px] text-gray-300" colSpan={2}>ventilation à venir</td>
                            <td className="px-4 py-2 text-right text-[11px] text-gray-400 tabular">{f.ca > 0 && ca4 > 0 ? `${((ca4 / f.ca) * 100).toFixed(0)} % du CA` : ''}</td>
                            <td className="px-4 py-2" />
                            <td className="px-4 py-2" />
                            <td className="px-4 py-2" />
                            <td className="px-4 py-2 text-right text-xs text-gray-500 tabular">{ca12 > 0 ? `${fmt(ca12)} € de CA` : '—'}</td>
                          </tr>
                        )
                      }).filter(Boolean),
                    ]
                  })}
                  {hasDivers && [
                    <tr key="divers" className="border-t border-gray-100 bg-gray-50/40 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-sm font-semibold text-gray-700">
                        {diversRow.label}
                        <span className="ml-1.5 text-[10px] font-medium text-gray-400">achat-revendu, détaillé ci-dessous</span>
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-gray-700 tabular">{fmt(diversRow.ca)} €</td>
                      <td className="px-4 py-3 text-right text-sm text-gray-700 tabular">{fmt(diversRow.achats)} €</td>
                      <td className={`px-4 py-3 text-right text-sm font-semibold tabular ${diversRow.ca - diversRow.achats >= 0 ? 'text-gray-900' : 'text-red-600'}`}>{fmt(diversRow.ca - diversRow.achats)} €</td>
                      <td className="px-4 py-3 text-right text-sm font-bold tabular text-gray-600">{pct(diversTaux)}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-gray-400">—</td>
                      <td className="px-4 py-3 text-right text-xs text-gray-500 tabular">{diversRow.salaires > 0 ? `${fmt(diversRow.salaires)} €` : '—'}</td>
                      <td className="px-4 py-3 text-right text-sm font-semibold tabular text-gray-600">{pct(diversTauxDirect)}</td>
                      <td className="px-4 py-3 text-right text-sm font-semibold tabular text-gray-600">{pct(diversTaux12)}</td>
                    </tr>,
                    ...diversDetail.map(s => {
                      const ca4 = ca4ByRef.get(s.id) || 0
                      const ca12 = ca12ByRef.get(s.id) || 0
                      if (ca4 <= 0 && ca12 <= 0) return null
                      return (
                        <tr key={s.id} className="border-t border-gray-50 bg-gray-50/30 hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-2 text-xs text-gray-500 pl-8">└ {s.name}</td>
                          <td className="px-4 py-2 text-right text-xs text-gray-500 tabular">{ca4 > 0 ? `${fmt(ca4)} €` : '—'}</td>
                          <td className="px-4 py-2 text-right text-[11px] text-gray-300" colSpan={2}>ventilation à venir</td>
                          <td className="px-4 py-2 text-right text-[11px] text-gray-400 tabular">{diversRow.ca > 0 && ca4 > 0 ? `${((ca4 / diversRow.ca) * 100).toFixed(0)} % du CA` : ''}</td>
                          <td className="px-4 py-2 text-right whitespace-nowrap">
                            <RepereEditor familyId={s.id} lo={s.benchmark_lo} hi={s.benchmark_hi} />
                          </td>
                          <td className="px-4 py-2" />
                          <td className="px-4 py-2" />
                          <td className="px-4 py-2 text-right text-xs text-gray-500 tabular">{ca12 > 0 ? `${fmt(ca12)} € de CA` : '—'}</td>
                        </tr>
                      )
                    }).filter(Boolean),
                  ]}
                  {(caHorsFamilles > 0 || nonVentiles > 0 || salairesHorsFam > 0) && (
                    <tr className="border-t border-gray-100 bg-gray-50/60">
                      <td className="px-4 py-3 text-xs font-semibold text-gray-500">Hors familles</td>
                      <td className="px-4 py-3 text-right text-xs text-gray-500 tabular">{caHorsFamilles > 0 ? `${fmt(caHorsFamilles)} €` : '—'}</td>
                      <td className="px-4 py-3 text-right text-xs text-gray-500 tabular">{nonVentiles > 0 ? `${fmt(nonVentiles)} €` : '—'}</td>
                      <td className="px-4 py-3" colSpan={3} />
                      <td className="px-4 py-3 text-right text-xs text-gray-500 tabular">{salairesHorsFam > 0 ? `${fmt(salairesHorsFam)} €` : '—'}</td>
                      <td className="px-4 py-3" colSpan={2} />
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
                    <td className="px-4 py-3 text-right font-bold tabular text-green-300">{pct(taux12Total)}</td>
                  </tr>
                </tfoot>
              </table>
            </CardContent>
          </Card>

          {/* Notes de lecture */}
          <div className="bg-pilote-50 border border-pilote-100 rounded-xl p-5 flex gap-3">
            <Info className="w-4 h-4 text-pilote flex-shrink-0 mt-0.5" />
            <div className="text-xs text-gray-600 space-y-2 leading-relaxed">
              <p><span className="font-semibold text-gray-800">Marge sur coût direct :</span> CA − achats − salaires du planning. C&apos;est la boussole de la page — les charges fixes (loyer, énergie, abonnements) restent traitées à part, dans le résultat du rapport hebdomadaire.</p>
              <p><span className="font-semibold text-gray-800">Cumul 12 mois :</span> marge matière calculée sur toutes les semaines archivées des 12 derniers mois (CA des familles de vente, achats validés ventilés par fournisseur). Le cumul long gomme l&apos;effet stock mieux encore que le lissage 4 semaines.</p>
              <p><span className="font-semibold text-gray-800">Repères :</span> modifiables ligne à ligne (bas-haut, en %) — vos objectifs à vous, pas des moyennes de branche figées. La couleur des marges suit VOS repères.</p>
              <p><span className="font-semibold text-gray-800">Sous-familles et détail du Divers :</span> le CA descend au détail (bœuf, veau, porc… ; fruits &amp; légumes, fromages, rachats…) depuis vos familles de vente. La ventilation des ACHATS à ce niveau arrive avec la refonte de la ventilation en Facturation — d&apos;ici là, ces lignes montrent le CA et sa part.</p>
              <p><span className="font-semibold text-gray-800">Salaires :</span> coût chargé issu du planning, réparti d&apos;après les postes pointés ; les heures sans poste métier sont réparties au prorata du CA{salairesRepartis > 0 ? ` (${fmt(salairesRepartis)} € sur la période)` : ''}.</p>
              <p><span className="font-semibold text-gray-800">Fiabilité :</span> seules les factures <strong>validées</strong> comptent. Contrôle croisé : comparez avec la marge théorique de vos valorisations carcasse ; un écart durable = démarque.</p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
