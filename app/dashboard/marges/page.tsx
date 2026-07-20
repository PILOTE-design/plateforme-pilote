import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveClientId } from '@/lib/resolve-client-id'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Percent, Info, Settings2, AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import MargesWizard from '@/components/MargesWizard'
import { GROUPES, CATEGORIES_STRUCTURELLES, defaultGroupeForFamille, defaultGroupeForCategorie, type Groupe, type MappingRow } from '@/lib/marges-config'

const fmt = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })

const GROUPE_LABELS: Record<Groupe, string> = {
  boucherie: 'Boucherie',
  charcuterie: 'Charcuterie',
  traiteur: 'Traiteur',
  achat_revente: 'Achat-revente',
}
// Cibles métier de marge matière par groupe (repères boucherie artisanale)
const GROUPE_CIBLES: Record<Groupe, string> = {
  boucherie: '30-40 %',
  charcuterie: '40-50 %',
  traiteur: '50-65 %',
  achat_revente: '25-35 %',
}

const keyOf = (year: number, week: number) => `${year}-${String(week).padStart(2, '0')}`

export default async function MargesPage({ searchParams }: { searchParams?: { config?: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const serviceSupabase = createServiceClient()
  const clientId = await resolveClientId(serviceSupabase, user!.id, user?.email)

  // Marges = année en cours (cohérent avec Tendances : les semaines N-1 archivées sont exclues)
  const currentYear = new Date().getFullYear()

  let weeks: { key: string; week: number; year: number; ca: number; familles: { nom: string; montant: number }[] }[] = []
  let invoices: { week_number: number; year: number; category: string; amount_ht: number; is_fixed_charge: boolean | null; prorata_ht: number | null; status?: string | null }[] = []
  let mappings: MappingRow[] = []

  if (clientId) {
    const [{ data: caRows }, { data: mapRows }] = await Promise.all([
      serviceSupabase
        .from('weekly_ca')
        .select('week_number, year, ca_total, families_detail')
        .eq('client_id', clientId)
        .eq('year', currentYear)
        .order('week_number', { ascending: false })
        .limit(4),
      serviceSupabase
        .from('margin_mappings')
        .select('source_type, source_name, groupe')
        .eq('client_id', clientId),
    ])
    mappings = (mapRows || []) as MappingRow[]
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
        .select('week_number, year, category, amount_ht, is_fixed_charge, prorata_ht, status')
        .eq('client_id', clientId)
        .eq('year', currentYear)
      invoices = (invRows || []).filter((i: any) => weeks.some(w => w.week === i.week_number && w.year === i.year))
    }
  }

  // Familles détectées dans les rapports (pour l'assistant et les correspondances)
  const famillesDetectees = [...new Set(weeks.flatMap(w => w.familles.map(f => String(f.nom || '').trim())).filter(Boolean))].sort()

  // ── Assistant : première utilisation (aucune correspondance) ou demande explicite (?config=1) ──
  const showWizard = searchParams?.config === '1' || (mappings.length === 0 && (famillesDetectees.length > 0 || invoices.length > 0))
  if (showWizard) {
    return (
      <div className="p-6 md:p-8">
        <MargesWizard familles={famillesDetectees} existing={mappings} firstTime={mappings.length === 0} />
      </div>
    )
  }

  // ── Correspondances → fonctions de résolution (repli heuristique pour toute nouveauté non mappée) ──
  const famMap = new Map<string, Groupe>()
  const catMap = new Map<string, Groupe>()
  for (const m of mappings) {
    if (m.source_type === 'famille') famMap.set(m.source_name.toUpperCase(), m.groupe)
    else catMap.set(m.source_name, m.groupe)
  }
  const famillesNonMappees = famillesDetectees.filter(f => !famMap.has(f.toUpperCase()))
  const groupeOfFamille = (nom: string): Groupe => famMap.get(nom.toUpperCase()) ?? defaultGroupeForFamille(nom)
  const groupeOfCategorie = (cat: string): Groupe => catMap.get(cat) ?? defaultGroupeForCategorie(cat)

  // ── Agrégats sur la période lissée ──
  const zero = (): Record<Groupe, number> => ({ boucherie: 0, charcuterie: 0, traiteur: 0, achat_revente: 0 })
  const caByGroupe = zero()
  for (const w of weeks) for (const f of w.familles) caByGroupe[groupeOfFamille(String(f.nom || ''))] += Number(f.montant) || 0

  // Seules les factures VALIDÉES entrent dans le calcul — les imports « à vérifier » sont exclus.
  // Les charges STRUCTURELLES (frais généraux : loyer, énergie…) ne sont affectées à aucun
  // groupe : elles pèsent uniquement sur la marge globale.
  const aVerifier = invoices.filter(i => i.status === 'a_verifier')
  const valides   = invoices.filter(i => i.status !== 'a_verifier')
  const achatsByGroupe = zero()
  const fixesByGroupe  = zero()
  let structurel = 0
  for (const inv of valides) {
    const cat = String(inv.category || 'autre')
    const montant = inv.is_fixed_charge ? parseFloat(String(inv.prorata_ht || 0)) : parseFloat(String(inv.amount_ht || 0))
    if (CATEGORIES_STRUCTURELLES.has(cat)) { structurel += montant; continue }
    const g = groupeOfCategorie(cat)
    if (inv.is_fixed_charge) fixesByGroupe[g] += montant
    else achatsByGroupe[g] += montant
  }

  const caTotal     = weeks.reduce((s, w) => s + w.ca, 0)
  const achatsTotal = (Object.values(achatsByGroupe) as number[]).reduce((s, v) => s + v, 0)
  const fixesTotal  = (Object.values(fixesByGroupe)  as number[]).reduce((s, v) => s + v, 0)
  const margeGroupes = caTotal > 0 ? ((caTotal - achatsTotal - fixesTotal) / caTotal) * 100 : null
  const margeGlobale = caTotal > 0 ? ((caTotal - achatsTotal - fixesTotal - structurel) / caTotal) * 100 : null

  const rows = GROUPES.map(({ key }) => {
    const ca = caByGroupe[key]
    const achats = achatsByGroupe[key]
    const fixes = fixesByGroupe[key]
    const margeEur = ca - achats - fixes
    const marge = ca > 0 ? (margeEur / ca) * 100 : null
    return { key, label: GROUPE_LABELS[key], cible: GROUPE_CIBLES[key], ca, achats, fixes, margeEur, marge }
  }).filter(x => x.ca > 0 || x.achats > 0 || x.fixes > 0)

  const periodLabel = weeks.length > 0
    ? `S${weeks[0].week} → S${weeks[weeks.length - 1].week} · ${currentYear} (${weeks.length} semaine${weeks.length > 1 ? 's' : ''} lissée${weeks.length > 1 ? 's' : ''})`
    : ''
  const margeColor = (m: number | null) =>
    m === null ? 'text-gray-400' : m >= 40 ? 'text-green-600' : m >= 30 ? 'text-orange-500' : 'text-red-600'

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <div className="mb-8 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-pilote to-pilote-hover rounded-2xl flex items-center justify-center flex-shrink-0 shadow-card">
            <Percent className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Marges par groupe</h1>
            <p className="text-sm text-gray-500 mt-1">Boucherie · Charcuterie · Traiteur · Achat-revente — selon VOTRE catégorisation · {periodLabel || 'en attente de données'}</p>
          </div>
        </div>
        <Link href="/dashboard/marges?config=1"
          className="flex items-center gap-1.5 text-xs font-semibold text-pilote border border-pilote-200 rounded-xl px-3 py-2 hover:bg-pilote-50 transition-colors">
          <Settings2 className="w-3.5 h-3.5" />Modifier la catégorisation
        </Link>
      </div>

      {weeks.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Percent className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-500 mb-1">Pas encore assez de données</p>
            <p className="text-xs text-gray-400 mb-4 max-w-sm mx-auto">Il faut au moins une semaine {currentYear} avec un CA archivé (via un rapport ou une saisie) et des factures catégorisées.</p>
            <div className="flex items-center justify-center gap-4">
              <Link href="/dashboard/facturation" className="text-sm text-pilote font-semibold hover:underline">Facturation →</Link>
              <Link href="/dashboard/reports" className="text-sm text-pilote font-semibold hover:underline">Mes rapports →</Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Alertes de fiabilité */}
          {(aVerifier.length > 0 || famillesNonMappees.length > 0) && (
            <div className="mb-6 space-y-2">
              {aVerifier.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm text-amber-800">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span><strong>{aVerifier.length} facture{aVerifier.length > 1 ? 's' : ''} « à vérifier »</strong> exclue{aVerifier.length > 1 ? 's' : ''} du calcul — validez-les pour des marges complètes.</span>
                  <Link href="/dashboard/facturation" className="ml-auto text-xs font-bold underline whitespace-nowrap">Facturation →</Link>
                </div>
              )}
              {famillesNonMappees.length > 0 && (
                <div className="bg-pilote-50 border border-pilote-200 rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm text-pilote-800">
                  <Info className="w-4 h-4 flex-shrink-0" />
                  <span><strong>{famillesNonMappees.length} nouvelle{famillesNonMappees.length > 1 ? 's' : ''} famille{famillesNonMappees.length > 1 ? 's' : ''}</strong> non catégorisée{famillesNonMappees.length > 1 ? 's' : ''} ({famillesNonMappees.slice(0, 3).join(', ')}{famillesNonMappees.length > 3 ? '…' : ''}) — classée{famillesNonMappees.length > 1 ? 's' : ''} automatiquement en attendant.</span>
                  <Link href="/dashboard/marges?config=1" className="ml-auto text-xs font-bold underline whitespace-nowrap">Catégoriser →</Link>
                </div>
              )}
            </div>
          )}

          {/* KPIs globaux */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <Card className="hover:shadow-card-hover transition-shadow"><CardContent className="p-5">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">CA cumulé</p>
              <p className="text-2xl font-bold tracking-tight text-gray-900 tabular">{fmt(caTotal)} €</p>
            </CardContent></Card>
            <Card className="hover:shadow-card-hover transition-shadow"><CardContent className="p-5">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Achats validés + charges</p>
              <p className="text-2xl font-bold tracking-tight text-gray-900 tabular">{fmt(achatsTotal + fixesTotal + structurel)} €</p>
              <p className="text-xs text-gray-400 mt-1 tabular">dont fixes {fmt(fixesTotal)} € · structurel {fmt(structurel)} € (part hebdo)</p>
            </CardContent></Card>
            <Card className="hover:shadow-card-hover transition-shadow"><CardContent className="p-5">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Marge globale</p>
              <p className={`text-2xl font-bold tracking-tight tabular ${margeColor(margeGlobale)}`}>{margeGlobale !== null ? `${margeGlobale.toFixed(1)} %` : '—'}</p>
              {structurel > 0 && <p className="text-xs text-gray-400 mt-1">frais généraux inclus</p>}
            </CardContent></Card>
          </div>

          {/* Tableau par groupe */}
          <Card className="mb-6 overflow-hidden">
            <CardHeader>
              <CardTitle className="text-base">Marge par groupe</CardTitle>
              <CardDescription>Lissée sur {weeks.length} semaine{weeks.length > 1 ? 's' : ''} · seules les factures validées comptent · frais généraux hors groupes (marge globale uniquement)</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                    <th className="px-4 py-2.5 text-left">Groupe</th>
                    <th className="px-4 py-2.5 text-right">CA</th>
                    <th className="px-4 py-2.5 text-right">Achats</th>
                    <th className="px-4 py-2.5 text-right">Fixes/sem</th>
                    <th className="px-4 py-2.5 text-right">Marge €</th>
                    <th className="px-4 py-2.5 text-right">Marge %</th>
                    <th className="px-4 py-2.5 text-right">Cible</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(x => (
                    <tr key={x.key} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900">{x.label}</td>
                      <td className="px-4 py-3 text-right text-sm text-gray-700 tabular">{fmt(x.ca)} €</td>
                      <td className="px-4 py-3 text-right text-sm text-gray-700 tabular">{fmt(x.achats)} €</td>
                      <td className="px-4 py-3 text-right text-xs text-gray-500 tabular">{x.fixes > 0 ? `${fmt(x.fixes)} €` : '—'}</td>
                      <td className={`px-4 py-3 text-right text-sm font-semibold tabular ${x.margeEur >= 0 ? 'text-gray-900' : 'text-red-600'}`}>{fmt(x.margeEur)} €</td>
                      <td className={`px-4 py-3 text-right text-sm font-bold tabular ${margeColor(x.marge)}`}>{x.marge !== null ? `${x.marge.toFixed(1)} %` : '—'}</td>
                      <td className="px-4 py-3 text-right text-[11px] text-gray-400 tabular">{x.cible}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-pilote text-white">
                    <td className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-white/60">Total groupes</td>
                    <td className="px-4 py-3 text-right font-bold tabular">{fmt(caTotal)} €</td>
                    <td className="px-4 py-3 text-right font-bold tabular">{fmt(achatsTotal)} €</td>
                    <td className="px-4 py-3 text-right font-bold tabular text-white/70">{fmt(fixesTotal)} €</td>
                    <td className="px-4 py-3 text-right font-bold tabular text-green-300">{fmt(caTotal - achatsTotal - fixesTotal)} €</td>
                    <td className="px-4 py-3 text-right font-bold tabular text-green-300">{margeGroupes !== null ? `${margeGroupes.toFixed(1)} %` : '—'}</td>
                    <td className="px-4 py-3" />
                  </tr>
                </tfoot>
              </table>
            </CardContent>
          </Card>

          {/* Notes de lecture */}
          <div className="bg-pilote-50 border border-pilote-100 rounded-xl p-5 flex gap-3">
            <Info className="w-4 h-4 text-pilote flex-shrink-0 mt-0.5" />
            <div className="text-xs text-gray-600 space-y-2 leading-relaxed">
              <p><span className="font-semibold text-gray-800">Comment lire :</span> marge lissée sur {weeks.length} semaine{weeks.length > 1 ? 's' : ''} — les achats d'une semaine se vendent sur les suivantes, le cumul gomme l'effet stock. Précise à 2-3 points près, la tendance est fiable.</p>
              <p><span className="font-semibold text-gray-800">Votre catégorisation :</span> chaque famille de vente et catégorie d'achat est rangée dans un groupe selon VOS choix (bouton « Modifier la catégorisation »). Le traiteur consomme de la matière boucherie : si sa part de CA monte, la marge boucherie doit suivre — sinon, un œil sur la valorisation carcasse.</p>
              <p><span className="font-semibold text-gray-800">Charges structurelles :</span> les frais généraux (loyer, énergie, assurance…) ne sont affectés à aucun groupe — ils n'apparaissent que dans la marge globale, en haut de page.</p>
              <p><span className="font-semibold text-gray-800">Fiabilité :</span> seules les factures <strong>validées</strong> comptent — les imports automatiques restent « à vérifier » jusqu'à votre validation en page Facturation. Contrôle croisé : comparez avec la marge théorique de vos valorisations carcasse ; un écart durable = démarque (pertes, erreurs de prix, vol).</p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
