// Le document PDF lui-même — 8 pages. Extrait de route.tsx sans modification de
// rendu autre que les correctifs listés dans le PR.
import React from 'react'
import { Document, Page, Text, View, Image } from '@react-pdf/renderer'
import { C, S } from './report-theme'
import { FONT_FAMILY } from './report-fonts'
import { SecHeader, Footer, KpiBox, ShareBar } from './report-pdf-atoms'
import { eur, eur0, signEur, signPct, pctStr, trunc } from './report-format'
import { hasEconomics } from './report-compute'
import { benchOf } from '@/lib/postes'
import type { ComputedReport } from './report-types'

// ─── PDF Document ───────────────────────────────────────────────────────────────

export const PiloteReport = ({ r }: { r: ComputedReport }) => {
  const { data, clientName, insights, pieBuffer, tops, flops, famRows, caVar, status, execSummary, economics, margeRead } = r
  // eco non nul = il y a de quoi parler d'argent (au moins des achats, des salaires
  // ou des charges) ; sinon la page 3 affiche le mode d'emploi plutot que des zeros
  const eco = hasEconomics(economics) ? economics : null
  const { financier_n: fn, financier_n1: fn1, ventes_n: vn, ventes_n1: vn1 } = data
  const generatedOn = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })

  const sortedByEcart = [...famRows].sort((a, b) => b.ecart - a.ecart)
  const bestFam  = sortedByEcart[0]
  const worstFam = sortedByEcart[sortedByEcart.length - 1]
  const topProduct  = tops[0]
  const flopProduct = flops[0]
  const vigilance = insights.vigilance ?? []

  return (
    <Document title={`Rapport S${data.week_number} - ${data.period_n}`} author="PILOTE" language="fr">

      {/* PAGE 1 - COUVERTURE */}
      <Page size="A4" style={{ backgroundColor: C.white, fontFamily: FONT_FAMILY }}>
        <View style={S.coverBlueBg}>
          <View style={S.coverTagRow}>
            <View style={S.coverTagDot} />
            <Text style={S.coverTagText}>PILOTE</Text>
          </View>
          <Text style={S.coverTitle}>Rapport{'\n'}Hebdomadaire</Text>
          <Text style={S.coverSub}>Analyse comparative des ventes et pilotage de la performance</Text>
          <View style={S.coverDivider} />
          <Text style={S.coverWeek}>Semaine {data.week_number} - {data.year}</Text>
          <Text style={S.coverPeriod}>{data.period_n}</Text>
          <View style={S.coverKpiRow}>
            <View style={S.coverKpi}>
              <Text style={S.coverKpiLabel}>CA DE LA SEMAINE</Text>
              <Text style={S.coverKpiValue}>{eur0(fn.ca_net)}</Text>
            </View>
            <View style={[S.coverKpi, { borderLeftColor: caVar >= 0 ? '#4CAF50' : '#EF5350' }]}>
              <Text style={S.coverKpiLabel}>VS MÊME SEMAINE {data.year - 1}</Text>
              <Text style={[S.coverKpiValue, { color: caVar >= 0 ? '#81C784' : '#EF9A9A' }]}>{signPct(caVar)}</Text>
            </View>
            <View style={S.coverKpi}>
              <Text style={S.coverKpiLabel}>TICKETS</Text>
              <Text style={S.coverKpiValue}>{String(fn.nb_tickets)}</Text>
            </View>
            <View style={S.coverKpi}>
              <Text style={S.coverKpiLabel}>PANIER MOYEN</Text>
              <Text style={S.coverKpiValue}>{eur(fn.moyenne_ticket)}</Text>
            </View>
          </View>
        </View>
        <View style={S.coverWhiteBg}>
          <View>
            {clientName ? (
              <>
                <Text style={S.coverLabel}>CLIENT</Text>
                <Text style={S.coverClient}>{clientName.toUpperCase()}</Text>
              </>
            ) : (
              <Text style={S.coverClient}>BOUCHERIE ARTISANALE</Text>
            )}
          </View>
          <View>
            <Text style={S.coverMeta}>Généré le {generatedOn}</Text>
            <Text style={S.coverMeta}>Période comparée (N-1) : {data.period_n1}</Text>
            <Text style={S.coverMeta}>Marge &amp; coûts - Analyse IA - Graphique - Synthèse</Text>
          </View>
        </View>
      </Page>

      {/* PAGE 2 - SYNTHESE FINANCIERE */}
      <Page size="A4" style={S.page}>
        <SecHeader num="01" title="SYNTHÈSE FINANCIÈRE" />
        <View style={S.execBox}>
          <Text style={S.execLabel}>RÉSUMÉ EXÉCUTIF</Text>
          <Text style={S.execText}>{execSummary}</Text>
        </View>
        <Text style={{ paddingHorizontal: 36, fontSize: 9, color: C.textLight, marginBottom: 8 }}>CHIFFRE D'AFFAIRES</Text>
        <View style={S.kpiRow}>
          <KpiBox label="CA SEMAINE N" value={eur(fn.ca_net)} sub={`S${data.week_number} - ${data.year}`} bg={C.navy} />
          <KpiBox label="CA SEMAINE N-1" value={eur(fn1.ca_net)} sub={`S${data.week_number} - ${data.year - 1}`} bg={C.blue} />
          <KpiBox label="VARIATION" value={signPct(caVar)} sub={signEur(fn.ca_net - fn1.ca_net)} bg={caVar >= 0 ? C.green : C.red} />
        </View>
        <Text style={{ paddingHorizontal: 36, fontSize: 9, color: C.textLight, marginTop: 4, marginBottom: 8 }}>TICKETS &amp; PANIER</Text>
        <View style={[S.kpiRow, { marginBottom: 18 }]}>
          <KpiBox label="TICKETS N" value={String(fn.nb_tickets)} sub={`${fn.nb_tickets - fn1.nb_tickets >= 0 ? '+' : ''}${fn.nb_tickets - fn1.nb_tickets} vs N-1`} bg={fn.nb_tickets >= fn1.nb_tickets ? C.green : C.red} />
          <KpiBox label="TICKETS N-1" value={String(fn1.nb_tickets)} sub={`S${data.week_number} - ${data.year - 1}`} bg={C.blue} />
          <KpiBox label="PANIER MOYEN" value={eur(fn.moyenne_ticket)} sub={`N-1 : ${eur(fn1.moyenne_ticket)}`} bg={fn.moyenne_ticket >= fn1.moyenne_ticket ? C.green : C.red} />
        </View>
        <Text style={{ paddingHorizontal: 36, fontSize: 9.5, fontWeight: 700, color: C.navy, marginBottom: 10 }}>Récapitulatif par famille de produits</Text>
        <View style={S.tableWrap}>
          <View style={S.tHead}>
            <Text style={[S.tHeadCell, { flex: 3 }]}>FAMILLE</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>CA N (€)</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>CA N-1 (€)</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>ÉCART (€)</Text>
            <Text style={[S.tHeadCell, { flex: 1.2, textAlign: 'right' }]}>% CA</Text>
            <Text style={[S.tHeadCell, { flex: 1, textAlign: 'center' }]}>TEND.</Text>
          </View>
          {famRows.map((fam, i) => {
            const w = vn.total ? fam.caN / vn.total : 0
            return (
              <View key={i} style={i % 2 === 0 ? S.tRow : S.tRowAlt}>
                <Text style={[S.tCellB, { flex: 3 }]}>{trunc(fam.nom, 28)}</Text>
                <Text style={[S.tCellR, { flex: 2 }]}>{eur(fam.caN)}</Text>
                <Text style={[S.tCellR, { flex: 2 }]}>{fam.caN1 !== null ? eur(fam.caN1) : '-'}</Text>
                <Text style={[fam.ecart >= 0 ? S.tCellGreen : S.tCellRed, { flex: 2 }]}>{signEur(fam.ecart)}</Text>
                <Text style={[S.tCellRB, { flex: 1.2 }]}>{pctStr(w)}</Text>
                <Text style={[fam.ecart >= 0 ? S.tCellGreen : S.tCellRed, { flex: 1, textAlign: 'center' }]}>{fam.ecart >= 0 ? '▲' : '▼'}</Text>
              </View>
            )
          })}
          <View style={S.tTotal}>
            <Text style={[S.tTotalCellL, { flex: 3 }]}>TOTAL GENERAL</Text>
            <Text style={[S.tTotalCell, { flex: 2 }]}>{eur(vn.total)}</Text>
            <Text style={[S.tTotalCell, { flex: 2 }]}>{eur(vn1.total)}</Text>
            <Text style={[S.tTotalCell, { flex: 2 }]}>{signEur(vn.total - vn1.total)}</Text>
            <Text style={[S.tTotalCell, { flex: 1.2 }]}>100%</Text>
            <Text style={[S.tTotalCell, { flex: 1, textAlign: 'center' }]}>{vn.total >= vn1.total ? '▲' : '▼'}</Text>
          </View>
        </View>
        <Footer week={data.week_number} year={data.year} />
      </Page>

      {/* PAGE 3 - MARGE & COUTS (memes chiffres que l'onglet Facturation) */}
      <Page size="A4" style={S.page}>
        <SecHeader num="02" title="MARGE &amp; COÛTS DE LA SEMAINE" />
        {eco ? (
          <>
            <View style={S.kpiRow}>
              <KpiBox
                label="MARGE BRUTE"
                value={eur0(eco.marge_brute)}
                sub={eco.taux_marge !== null ? `${eco.taux_marge.toFixed(1)} % du CA - repère > 40 %` : 'CA non renseigné'}
                bg={eco.taux_marge === null ? C.blue : eco.taux_marge >= 40 ? C.green : eco.taux_marge >= 30 ? C.amber : C.red}
              />
              <KpiBox
                label="MASSE SALARIALE"
                value={eur0(eco.masse_salariale)}
                sub={eco.ratio_ms !== null ? `${eco.ratio_ms.toFixed(1)} % du CA - repère < 30 %` : 'chargée (CCN 992)'}
                bg={eco.ratio_ms === null ? C.blue : eco.ratio_ms < 30 ? C.green : eco.ratio_ms <= 40 ? C.amber : C.red}
              />
              <KpiBox
                label="RÉSULTAT NET ESTIMÉ"
                value={eur0(eco.resultat_net)}
                sub={`après ${eur0(eco.charges_fixes)} de charges fixes`}
                bg={eco.resultat_net >= 0 ? C.green : C.red}
              />
            </View>

            <Text style={{ paddingHorizontal: 36, fontSize: 8.5, color: C.textLight, marginBottom: 14 }}>
              CA HT {eur0(eco.ca_total)} - achats HT {eur0(eco.achats_ht)} - salaires {eur0(eco.masse_salariale)} - charges fixes {eur0(eco.charges_fixes)} = {eur0(eco.resultat_net)}
            </Text>

            <Text style={{ paddingHorizontal: 36, fontSize: 9.5, fontWeight: 700, color: C.navy, marginBottom: 10 }}>
              Marge par famille
            </Text>
            <View style={S.tableWrap}>
              <View style={S.tHead}>
                <Text style={[S.tHeadCell, { flex: 2.4 }]}>FAMILLE</Text>
                <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>CA HT (€)</Text>
                <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>ACHATS HT (€)</Text>
                <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>SALAIRES (€)</Text>
                <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>MARGE (€)</Text>
                <Text style={[S.tHeadCell, { flex: 1.4, textAlign: 'right' }]}>TX MAT.</Text>
                <Text style={[S.tHeadCell, { flex: 1.4, textAlign: 'right' }]}>TX NET</Text>
              </View>
              {eco.familles.map((f, i) => {
                const b = benchOf(f.key, f.label)
                const tauxOk = f.taux === null ? null : b ? f.taux >= b[0] : f.taux >= 40
                return (
                  <View key={f.key} style={i % 2 === 0 ? S.tRow : S.tRowAlt}>
                    <Text style={[S.tCellB, { flex: 2.4 }]}>{trunc(f.label, 20)}</Text>
                    <Text style={[S.tCellR, { flex: 2 }]}>{f.ca > 0 ? eur0(f.ca) : '-'}</Text>
                    <Text style={[S.tCellR, { flex: 2 }]}>{f.achats > 0 ? eur0(f.achats) : '-'}</Text>
                    <Text style={[S.tCellR, { flex: 2 }]}>{f.salaires > 0 ? eur0(f.salaires) : '-'}</Text>
                    <Text style={[S.tCellRB, { flex: 2 }]}>{f.ca > 0 ? eur0(f.marge_totale) : '-'}</Text>
                    <Text style={[tauxOk === null ? S.tCellR : tauxOk ? S.tCellGreen : S.tCellRed, { flex: 1.4 }]}>
                      {f.taux !== null ? `${f.taux.toFixed(1)}%` : '-'}
                    </Text>
                    <Text style={[S.tCellRB, { flex: 1.4 }]}>{f.taux_totale !== null ? `${f.taux_totale.toFixed(1)}%` : '-'}</Text>
                  </View>
                )
              })}
              {(eco.divers.ca > 0 || eco.divers.achats > 0) && (
                <View style={eco.familles.length % 2 === 0 ? S.tRow : S.tRowAlt}>
                  <Text style={[S.tCellB, { flex: 2.4 }]}>{trunc(eco.divers.label, 20)}</Text>
                  <Text style={[S.tCellR, { flex: 2 }]}>{eco.divers.ca > 0 ? eur0(eco.divers.ca) : '-'}</Text>
                  <Text style={[S.tCellR, { flex: 2 }]}>{eco.divers.achats > 0 ? eur0(eco.divers.achats) : '-'}</Text>
                  <Text style={[S.tCellR, { flex: 2 }]}>{eco.divers.salaires > 0 ? eur0(eco.divers.salaires) : '-'}</Text>
                  <Text style={[S.tCellRB, { flex: 2 }]}>{eco.divers.ca > 0 ? eur0(eco.divers.marge_totale) : '-'}</Text>
                  <Text style={[S.tCellR, { flex: 1.4 }]}>{eco.divers.taux !== null ? `${eco.divers.taux.toFixed(1)}%` : '-'}</Text>
                  <Text style={[S.tCellRB, { flex: 1.4 }]}>{eco.divers.taux_totale !== null ? `${eco.divers.taux_totale.toFixed(1)}%` : '-'}</Text>
                </View>
              )}
              <View style={S.tTotal}>
                <Text style={[S.tTotalCellL, { flex: 2.4 }]}>GLOBAL BOUTIQUE</Text>
                <Text style={[S.tTotalCell, { flex: 2 }]}>{eur0(eco.ca_total)}</Text>
                <Text style={[S.tTotalCell, { flex: 2 }]}>{eur0(eco.achats_ht)}</Text>
                <Text style={[S.tTotalCell, { flex: 2 }]}>{eur0(eco.masse_salariale)}</Text>
                <Text style={[S.tTotalCell, { flex: 2 }]}>{eur0(eco.marge_apres_salaires)}</Text>
                <Text style={[S.tTotalCell, { flex: 1.4 }]}>{eco.taux_marge !== null ? `${eco.taux_marge.toFixed(1)}%` : '-'}</Text>
                <Text style={[S.tTotalCell, { flex: 1.4 }]}>{eco.taux_apres_salaires !== null ? `${eco.taux_apres_salaires.toFixed(1)}%` : '-'}</Text>
              </View>
            </View>
            <Text style={[S.chartCaption, { textAlign: 'left', marginTop: 6, lineHeight: 1.45 }]}>
              Tous les montants sont HT : votre CA de caisse est ramené hors taxes avant calcul, pour être comparable
              à vos achats et à vos salaires. TX MAT. = marge matière (CA - achats). TX NET = après salaires.
              Repères du métier : boucherie 35-45 %, charcuterie 40-55 %, traiteur 50-65 %.
              DIVERS regroupe le rachat, l'épicerie, les boissons, les fruits et légumes et les prestations : acheté fini,
              revendu tel quel - ni matière travaillée, ni repère de marge. Il existe pour que les trois métiers restent lisibles.
              Les heures sans poste métier (vente, administratif) sont réparties au prorata du CA sur les quatre blocs.
            </Text>

            {margeRead.alerts.length > 0 && (
              <View style={S.vigilanceBox}>
                <Text style={S.vigilanceTitle}>LECTURE DE LA SEMAINE</Text>
                {margeRead.alerts.map((a, i) => (
                  <Text key={i} style={S.vigilanceText}>- {a}</Text>
                ))}
              </View>
            )}
            {margeRead.action && (
              <View style={S.actionBox}>
                <Text style={S.actionLabel}>À FAIRE EN PRIORITÉ</Text>
                <Text style={S.actionText}>{margeRead.action}</Text>
              </View>
            )}
          </>
        ) : (
          <>
            <View style={S.execBox}>
              <Text style={S.execLabel}>PAGE EN ATTENTE DE VOS DONNÉES</Text>
              <Text style={S.execText}>
                Cette page calcule votre marge réelle : chiffre d&apos;affaires moins achats, moins le coût
                des heures pointées au planning, moins vos charges fixes. Elle reste vide tant que ces
                éléments ne sont pas renseignés pour la semaine {data.week_number}.
              </Text>
            </View>
            <View style={S.insightBlock}>
              {[
                'Saisissez ou synchronisez vos factures d\'achat de la semaine dans Facturation.',
                'Renseignez le planning de vos employés, en précisant le poste de chaque journée : c\'est ce qui permet d\'affecter le bon salaire au bon rayon.',
                'Déclarez vos charges fixes (loyer, énergie, assurance, crédit) une seule fois : elles seront ensuite étalées automatiquement sur chaque semaine.',
              ].map((t, i) => (
                <View key={i} style={S.insightRow}>
                  <View style={S.insightBullet}><Text style={S.bulletNum}>{i + 1}</Text></View>
                  <Text style={S.insightText}>{t}</Text>
                </View>
              ))}
            </View>
            <View style={S.actionBox}>
              <Text style={S.actionLabel}>CE QUE VOUS OBTIENDREZ</Text>
              <Text style={S.actionText}>
                Le taux de marge exact de chaque rayon, salaires compris, et le résultat net de la semaine
                - les mêmes chiffres que ceux affichés dans votre espace Facturation.
              </Text>
            </View>
          </>
        )}
        <Footer week={data.week_number} year={data.year} />
      </Page>

      {/* PAGE 4 - REPARTITION CA */}
      <Page size="A4" style={S.page}>
        <SecHeader num="03" title="RÉPARTITION DU CA PAR FAMILLE" />
        <View style={S.chartWrap}>
          {pieBuffer
            ? <Image src={{ data: pieBuffer, format: 'png' }} style={{ width: 490, height: 275 }} />
            : <Text style={S.chartCaption}>Graphique momentanément indisponible - le détail par famille figure ci-dessous.</Text>}
        </View>
        <Text style={S.chartCaption}>Répartition du CA de caisse par famille (€ TTC) - Semaine {data.week_number} {data.year}</Text>
        <View style={[S.tableWrap, { marginTop: 14 }]}>
          <View style={S.tHead}>
            <Text style={[S.tHeadCell, { flex: 2.6 }]}>FAMILLE</Text>
            <Text style={[S.tHeadCell, { flex: 1.8, textAlign: 'right' }]}>CA N (€)</Text>
            <Text style={[S.tHeadCell, { flex: 2.6, textAlign: 'center' }]}>PART DU CA</Text>
            <Text style={[S.tHeadCell, { flex: 1.8, textAlign: 'right' }]}>CA N-1 (€)</Text>
            <Text style={[S.tHeadCell, { flex: 1.4, textAlign: 'right' }]}>ÉVOL. CA</Text>
          </View>
          {famRows.map((fam, i) => {
            const wN = vn.total ? fam.caN / vn.total : 0
            const evolCA = fam.caN1 ? (fam.caN - fam.caN1) / fam.caN1 : 0
            return (
              <View key={i} style={i % 2 === 0 ? S.tRow : S.tRowAlt}>
                <Text style={[S.tCellB, { flex: 2.6 }]}>{trunc(fam.nom, 24)}</Text>
                <Text style={[S.tCellR, { flex: 1.8 }]}>{eur(fam.caN)}</Text>
                <View style={{ flex: 2.6, flexDirection: 'row', alignItems: 'center' }}>
                  <ShareBar pct={wN} />
                  <Text style={{ fontSize: 8, color: C.textMid, width: 34, textAlign: 'right' }}>{pctStr(wN)}</Text>
                </View>
                <Text style={[S.tCellR, { flex: 1.8 }]}>{fam.caN1 !== null ? eur(fam.caN1) : '-'}</Text>
                <Text style={[fam.caN1 ? (evolCA >= 0 ? S.tCellGreen : S.tCellRed) : S.tCellR, { flex: 1.4 }]}>{fam.caN1 ? signPct(evolCA) : '-'}</Text>
              </View>
            )
          })}
        </View>
        <Footer week={data.week_number} year={data.year} />
      </Page>

      {/* PAGE 5 - EVOLUTION PAR FAMILLE (tableau trié, sans graphique) */}
      <Page size="A4" style={S.page}>
        <SecHeader num="04" title={`ÉVOLUTION PAR FAMILLE - ${data.year} vs ${data.year - 1}`} />
        <Text style={{ paddingHorizontal: 36, fontSize: 8.5, color: C.textLight, marginBottom: 12 }}>
          Familles triées du meilleur écart au moins bon - comparaison avec la même semaine {data.year - 1}
        </Text>
        <View style={S.tableWrap}>
          <View style={S.tHead}>
            <Text style={[S.tHeadCell, { flex: 3 }]}>FAMILLE</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>CA N (€)</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>CA N-1 (€)</Text>
            <Text style={[S.tHeadCell, { flex: 2, textAlign: 'right' }]}>ÉCART (€)</Text>
            <Text style={[S.tHeadCell, { flex: 1.5, textAlign: 'right' }]}>ÉCART %</Text>
            <Text style={[S.tHeadCell, { flex: 2.6, textAlign: 'center' }]}>POIDS DE L'ÉCART</Text>
          </View>
          {(() => {
            const maxAbs = Math.max(1, ...sortedByEcart.map(f => Math.abs(f.ecart)))
            return sortedByEcart.map((fam, i) => {
              const ecPct = fam.caN1 ? fam.ecart / fam.caN1 : 0
              const w = Math.abs(fam.ecart) / maxAbs
              return (
                <View key={i} style={i % 2 === 0 ? S.tRow : S.tRowAlt}>
                  <Text style={[S.tCellB, { flex: 3 }]}>{trunc(fam.nom, 28)}</Text>
                  <Text style={[S.tCellR, { flex: 2 }]}>{eur(fam.caN)}</Text>
                  <Text style={[S.tCellR, { flex: 2 }]}>{fam.caN1 !== null ? eur(fam.caN1) : '-'}</Text>
                  <Text style={[fam.ecart >= 0 ? S.tCellGreen : S.tCellRed, { flex: 2 }]}>{signEur(fam.ecart)}</Text>
                  <Text style={[fam.ecart >= 0 ? S.tCellGreen : S.tCellRed, { flex: 1.5 }]}>{fam.caN1 ? signPct(ecPct) : '-'}</Text>
                  <View style={{ flex: 2.6, flexDirection: 'row', alignItems: 'center', paddingLeft: 8 }}>
                    <View style={S.shareBarBg}>
                      <View style={[S.shareBarFill, { width: `${(w * 100).toFixed(1)}%`, backgroundColor: fam.ecart >= 0 ? C.green : C.red }]} />
                    </View>
                  </View>
                </View>
              )
            })
          })()}
        </View>
        <View style={{ marginHorizontal: 36, marginTop: 16, backgroundColor: C.gray, borderRadius: 6, padding: 11 }}>
          <Text style={{ fontSize: 8, color: C.textMid, lineHeight: 1.5 }}>
            Lecture : la barre indique le poids de l'écart de chaque famille par rapport au plus gros écart de la semaine (vert = progression, rouge = recul). Les familles en tête expliquent l'essentiel de la variation du CA.
          </Text>
        </View>
        <Footer week={data.week_number} year={data.year} />
      </Page>

      {/* PAGE 6 - TOP / FLOP */}
      <Page size="A4" style={S.page}>
        <SecHeader num="05" title="CE QUI PROGRESSE - CE QUI DÉCROCHE" />
        <Text style={{ paddingHorizontal: 36, fontSize: 8.5, color: C.textLight, marginBottom: 12 }}>
          Plus fortes progressions et plus fortes baisses de CA produit vs la même semaine {data.year - 1} (écarts calculés sur le CA total de chaque produit)
        </Text>
        <View style={S.topFlopWrap}>
          <View style={S.topFlopLeft}>
            <View style={{ backgroundColor: C.green, paddingVertical: 9, paddingHorizontal: 8, borderTopLeftRadius: 4, borderTopRightRadius: 4 }}>
              <Text style={{ color: C.white, fontWeight: 700, fontSize: 9 }}>TOP PROGRESSIONS</Text>
            </View>
            <View style={{ flexDirection: 'row', backgroundColor: '#F1F5F9', paddingVertical: 5, paddingHorizontal: 8, borderBottomColor: '#CBD5E1', borderBottomWidth: 1 }}>
              <Text style={[S.tHeadCell, { flex: 0.7, color: C.textLight }]}>#</Text>
              <Text style={[S.tHeadCell, { flex: 3, color: C.textMid }]}>PRODUIT</Text>
              <Text style={[S.tHeadCell, { flex: 1.8, textAlign: 'right', color: C.textMid }]}>CA N (€)</Text>
              <Text style={[S.tHeadCell, { flex: 1.4, textAlign: 'right', color: C.textMid }]}>ÉCART (€)</Text>
            </View>
            {tops.map((t, i) => (
              <View key={i} style={[i % 2 === 0 ? S.tRow : S.tRowAlt, { paddingHorizontal: 8 }]}>
                <View style={{ flex: 0.7, flexDirection: 'row', alignItems: 'center' }}>
                  <View style={[S.rankChip, { backgroundColor: i < 3 ? C.green : C.grayMid }]}>
                    <Text style={[S.rankChipText, i >= 3 ? { color: C.textMid } : {}]}>{i + 1}</Text>
                  </View>
                </View>
                <Text style={[S.tCell, { flex: 3, fontSize: 7.5 }]}>{trunc(t.designation, 24)}</Text>
                <Text style={[S.tCellR, { flex: 1.8, fontSize: 7.5 }]}>{eur(t.n)}</Text>
                <Text style={[S.tCellGreen, { flex: 1.4, fontSize: 7.5 }]}>+{eur0(Math.abs(t.ecart))}</Text>
              </View>
            ))}
            {tops.length === 0 && (
              <View style={S.tRow}><Text style={[S.tCell, { fontSize: 8, color: C.textLight }]}>Aucune progression détectée</Text></View>
            )}
          </View>
          <View style={S.topFlopRight}>
            <View style={{ backgroundColor: C.red, paddingVertical: 9, paddingHorizontal: 8, borderTopLeftRadius: 4, borderTopRightRadius: 4 }}>
              <Text style={{ color: C.white, fontWeight: 700, fontSize: 9 }}>TOP BAISSES</Text>
            </View>
            <View style={{ flexDirection: 'row', backgroundColor: '#F1F5F9', paddingVertical: 5, paddingHorizontal: 8, borderBottomColor: '#CBD5E1', borderBottomWidth: 1 }}>
              <Text style={[S.tHeadCell, { flex: 0.7, color: C.textLight }]}>#</Text>
              <Text style={[S.tHeadCell, { flex: 3, color: C.textMid }]}>PRODUIT</Text>
              <Text style={[S.tHeadCell, { flex: 1.8, textAlign: 'right', color: C.textMid }]}>CA N (€)</Text>
              <Text style={[S.tHeadCell, { flex: 1.4, textAlign: 'right', color: C.textMid }]}>ÉCART (€)</Text>
            </View>
            {flops.map((f, i) => (
              <View key={i} style={[i % 2 === 0 ? S.tRow : S.tRowAlt, { paddingHorizontal: 8 }]}>
                <View style={{ flex: 0.7, flexDirection: 'row', alignItems: 'center' }}>
                  <View style={[S.rankChip, { backgroundColor: i < 3 ? C.red : C.grayMid }]}>
                    <Text style={[S.rankChipText, i >= 3 ? { color: C.textMid } : {}]}>{i + 1}</Text>
                  </View>
                </View>
                <Text style={[S.tCell, { flex: 3, fontSize: 7.5 }]}>{trunc(f.designation, 24)}</Text>
                <Text style={[S.tCellR, { flex: 1.8, fontSize: 7.5 }]}>{eur(f.n)}</Text>
                <Text style={[S.tCellRed, { flex: 1.4, fontSize: 7.5 }]}>-{eur0(Math.abs(f.ecart))}</Text>
              </View>
            ))}
            {flops.length === 0 && (
              <View style={S.tRow}><Text style={[S.tCell, { fontSize: 8, color: C.textLight }]}>Aucune baisse détectée</Text></View>
            )}
          </View>
        </View>
        <View style={{ marginHorizontal: 36, marginTop: 16, backgroundColor: C.gray, borderRadius: 6, padding: 11 }}>
          <Text style={{ fontSize: 8, color: C.textMid, lineHeight: 1.5 }}>
            Lecture : CA N = total des ventes du produit sur la semaine ; l'écart compare ce total à la même semaine de {data.year - 1}. Les produits en tête de progression sont à mettre en avant en vitrine ; les baisses marquées méritent une vérification (approvisionnement, prix, présence en rayon).
          </Text>
        </View>
        <Footer week={data.week_number} year={data.year} />
      </Page>

      {/* PAGE 7 - ANALYSE IA */}
      <Page size="A4" style={S.page}>
        <SecHeader num="06" title="ANALYSE INTELLIGENTE - INSIGHTS CLÉS" />
        <Text style={{ paddingHorizontal: 36, fontSize: 8.5, color: C.textLight, marginBottom: 14 }}>Analyse générée par intelligence artificielle - Semaine {data.week_number} {data.year}</Text>
        <View style={S.insightBlock}>
          {insights.insights.map((txt, i) => (
            <View key={i} style={S.insightRow}>
              <View style={S.insightBullet}><Text style={S.bulletNum}>{i + 1}</Text></View>
              <Text style={S.insightText}>{txt}</Text>
            </View>
          ))}
        </View>
        {vigilance.length > 0 && (
          <View style={S.vigilanceBox}>
            <Text style={S.vigilanceTitle}>POINTS DE VIGILANCE</Text>
            {vigilance.map((txt, i) => (
              <Text key={i} style={S.vigilanceText}>- {txt}</Text>
            ))}
          </View>
        )}
        <View style={{ marginTop: 10 }}>
          <SecHeader num="07" title="RECOMMANDATIONS POUR LA SEMAINE PROCHAINE" />
          <View style={S.insightBlock}>
            {insights.recommendations.map((txt, i) => (
              <View key={i} style={S.insightRow}>
                <View style={S.recoBullet}><Text style={S.bulletNum}>{i + 1}</Text></View>
                <Text style={S.insightText}>{txt}</Text>
              </View>
            ))}
          </View>
        </View>
        <Footer week={data.week_number} year={data.year} />
      </Page>

      {/* PAGE 8 - SYNTHESE DE LA SEMAINE */}
      <Page size="A4" style={S.page}>
        <SecHeader num="08" title="SYNTHÈSE DE LA SEMAINE" />
        <View style={[S.statusBanner, { backgroundColor: status.color }]}>
          <Text style={S.statusLabel}>{status.label}</Text>
          <Text style={S.statusDesc}>{status.desc}</Text>
        </View>
        <Text style={{ paddingHorizontal: 36, fontSize: 9, color: C.textLight, marginBottom: 10 }}>LES CHIFFRES À RETENIR</Text>
        <View style={S.recapGrid}>
          <View style={S.recapCard}>
            <Text style={S.recapLabel}>CA SEMAINE</Text>
            <Text style={S.recapValue}>{eur0(fn.ca_net)}</Text>
            <Text style={S.recapSub}>{signEur(fn.ca_net - fn1.ca_net)} vs {data.year - 1}</Text>
          </View>
          <View style={[S.recapCard, { backgroundColor: caVar >= 0 ? C.lightGreen : C.lightRed }]}>
            <Text style={S.recapLabel}>ÉVOLUTION</Text>
            <Text style={[S.recapValue, { color: caVar >= 0 ? C.green : C.red }]}>{signPct(caVar)}</Text>
            <Text style={S.recapSub}>vs S{data.week_number} {data.year - 1}</Text>
          </View>
          <View style={S.recapCard}>
            <Text style={S.recapLabel}>PANIER MOYEN</Text>
            <Text style={S.recapValue}>{eur(fn.moyenne_ticket)}</Text>
            <Text style={S.recapSub}>{fn.nb_tickets} tickets ({fn.nb_tickets - fn1.nb_tickets >= 0 ? '+' : ''}{fn.nb_tickets - fn1.nb_tickets})</Text>
          </View>
          <View style={S.recapCard}>
            <Text style={S.recapLabel}>FAMILLE EN FORME</Text>
            <Text style={[S.recapValue, { fontSize: 10.5 }]}>{bestFam ? trunc(bestFam.nom, 20) : '-'}</Text>
            <Text style={[S.recapSub, { color: C.green }]}>{bestFam ? signEur(bestFam.ecart) : ''}</Text>
          </View>
          <View style={S.recapCard}>
            <Text style={S.recapLabel}>FAMILLE EN RETRAIT</Text>
            <Text style={[S.recapValue, { fontSize: 10.5 }]}>{worstFam ? trunc(worstFam.nom, 20) : '-'}</Text>
            <Text style={[S.recapSub, { color: worstFam && worstFam.ecart < 0 ? C.red : C.textLight }]}>{worstFam ? signEur(worstFam.ecart) : ''}</Text>
          </View>
          <View style={S.recapCard}>
            <Text style={S.recapLabel}>PRODUIT VEDETTE</Text>
            <Text style={[S.recapValue, { fontSize: 10.5 }]}>{topProduct ? trunc(topProduct.designation, 20) : '-'}</Text>
            <Text style={[S.recapSub, { color: C.green }]}>{topProduct ? '+' + eur0(Math.abs(topProduct.ecart)) + ' vs N-1' : ''}</Text>
          </View>
        </View>
        <View style={{ marginHorizontal: 36, marginTop: 8, marginBottom: 4, backgroundColor: C.lightBlue, borderLeftWidth: 3, borderLeftColor: C.navy, borderRadius: 4, padding: 12 }}>
          <Text style={S.execLabel}>À RETENIR CETTE SEMAINE</Text>
          <Text style={S.execText}>{insights.resume}</Text>
        </View>
        <View style={S.actionBox}>
          <Text style={S.actionLabel}>ACTION PRIORITAIRE POUR LA SEMAINE PROCHAINE</Text>
          <Text style={S.actionText}>{insights.recommendations[0] ?? 'Poursuivre la dynamique actuelle et surveiller les familles en retrait.'}</Text>
        </View>
        {flopProduct && (
          <Text style={{ paddingHorizontal: 36, marginTop: 12, fontSize: 8, color: C.textLight }}>
            À surveiller aussi : {trunc(flopProduct.designation, 40)} ({'-'}{eur0(Math.abs(flopProduct.ecart))} vs N-1).
          </Text>
        )}
        <Text style={{ paddingHorizontal: 36, marginTop: 18, fontSize: 8, color: C.textLight }}>
          Rapport généré automatiquement par PILOTE le {generatedOn}. Données issues de vos exports de caisse (S{data.week_number} {data.year} et S{data.week_number} {data.year - 1}).
        </Text>
        <Footer week={data.week_number} year={data.year} />
      </Page>

    </Document>
  )
}
