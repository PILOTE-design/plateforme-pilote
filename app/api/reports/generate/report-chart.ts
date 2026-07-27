// Graphique de répartition du CA — image PNG produite par QuickChart.
import { trunc } from './report-format'
import type { ReportData } from './report-types'

// ─── QuickChart ───────────────────────────────────────────────────────────────
// REGLES ABSOLUES QuickChart :
// 1. Aucun caractere non-ASCII dans la config JSON
// 2. ticks.callback interdit — crash Chart.js 2.9.4 dans le sandbox
// 3. title.text doit etre une string simple (pas un array)
// 4. outlabeledPie : leader lines vers les labels externes
// 5. PIE = TOUTES les familles (pas de groupement) — le dashboard fait le top4+Autres

export async function getPieBuffer(data: ReportData): Promise<Buffer> {
  // Strip diacritics + non-ASCII (QuickChart sandbox rule)
  const toAscii = (s: string) =>
    s.normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\x00-\x7F]/g, '?')

  const famNames = data.ventes_n.familles.map(f => trunc(toAscii(f.nom), 18))
  const famCA    = data.ventes_n.familles.map(f => +f.total_montant.toFixed(2))

  const donutPalette = [
    '#1E3A5F', '#DC2626', '#D97706', '#059669',
    '#7C3AED', '#0891B2', '#BE185D', '#65A30D', '#9333EA', '#F59E0B',
  ].slice(0, famNames.length)

  const pieConfig = {
    type: 'outlabeledPie',
    data: {
      labels: famNames,
      datasets: [{
        data: famCA,
        backgroundColor: famNames.map((_, i) => donutPalette[i % donutPalette.length]),
        borderWidth: 2,
        borderColor: '#FFFFFF',
      }],
    },
    options: {
      title: {
        display: true,
        text: 'Repartition CA - S' + data.week_number + ' ' + data.year,
        fontSize: 14,
        fontColor: '#1E293B',
        fontStyle: 'bold',
        padding: 14,
      },
      legend: { display: false },
      plugins: {
        datalabels: { display: false },
        outlabels: {
          text: '%l\n%p',
          color: 'white',
          stretch: 38,
          font: { resizable: true, minSize: 8, maxSize: 12, size: 11, weight: 'bold' },
          padding: { top: 4, bottom: 4, left: 7, right: 7 },
          borderRadius: 4,
        },
      },
    },
  }

  const pieBody = JSON.stringify({ chart: pieConfig, width: 820, height: 460, backgroundColor: 'white', version: '2.9.4' })

  // Timeout explicite : sans lui, une sandbox QuickChart saturée bloque jusqu'à la
  // limite Vercel de 60 s et emporte tout le rapport avec elle.
  const pieRes = await fetch('https://quickchart.io/chart', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: pieBody,
    signal: AbortSignal.timeout(8000),
  })

  if (!pieRes.ok) {
    const ct = pieRes.headers.get('content-type') || ''
    const body = ct.includes('image') ? '[binary image]' : (await pieRes.text()).slice(0, 300)
    throw new Error(`QuickChart pie ${pieRes.status} | ${body}`)
  }

  return Buffer.from(await pieRes.arrayBuffer())
}
