// Police du rapport PDF — Plus Jakarta Sans, alignée sur la DA du site.
// Extrait de route.tsx : le cache `fontsPromise` reste un singleton par instance
// serveur, et sa ré-amorce en cas d'échec CDN est ce qui autorise une nouvelle
// tentative au rapport suivant. Ne pas déplacer registerHyphenationCallback hors
// de ensureFonts : c'est un effet global sur @react-pdf/renderer.
import { Font } from '@react-pdf/renderer'

// ─── Police PDF : Plus Jakarta Sans (alignée sur la DA du site) ──────────────
// Les TTF sont téléchargés une fois par instance (cache module) depuis deux CDN
// (jsDelivr puis raw.githubusercontent en secours), épinglés sur un commit précis,
// puis passés à Font.register en data: URI. Grâce à cette vraie police :
//   - '€' et les accents sont rendus nativement (fin du contournement 'EUR')
//   - les indicateurs de tendance utilisent ▲ / ▼ (fin du contournement '+/-')
const FONT_REF = '18d1cd2f7ea10481919d2f05c1f7064b7307fc26'
const FONT_SOURCES = [
  `https://cdn.jsdelivr.net/gh/tokotype/PlusJakartaSans@${FONT_REF}/fonts/ttf/`,
  `https://raw.githubusercontent.com/tokotype/PlusJakartaSans/${FONT_REF}/fonts/ttf/`,
]
const FONT_WEIGHTS: [number, string][] = [
  [400, 'PlusJakartaSans-Regular.ttf'],
  [600, 'PlusJakartaSans-SemiBold.ttf'],
  [700, 'PlusJakartaSans-Bold.ttf'],
  [800, 'PlusJakartaSans-ExtraBold.ttf'],
]
export const FONT_FAMILY = 'PlusJakartaSans'

let fontsPromise: Promise<void> | null = null
export function ensureFonts(): Promise<void> {
  if (!fontsPromise) {
    fontsPromise = (async () => {
      let lastErr: unknown = null
      for (const base of FONT_SOURCES) {
        try {
          const fonts = await Promise.all(FONT_WEIGHTS.map(async ([fontWeight, file]) => {
            const res = await fetch(base + file)
            if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`)
            const b64 = Buffer.from(await res.arrayBuffer()).toString('base64')
            return { src: `data:font/ttf;base64,${b64}`, fontWeight }
          }))
          Font.register({ family: FONT_FAMILY, fonts })
          // Pas de césure automatique : les libellés produits restent entiers
          Font.registerHyphenationCallback(w => [w])
          return
        } catch (e) {
          lastErr = e
        }
      }
      fontsPromise = null // permet une nouvelle tentative au prochain appel
      throw new Error('Police du rapport indisponible (CDN) : ' + String(lastErr))
    })()
  }
  return fontsPromise
}
