// lib/pdf-lines.ts — Lecture d'un PDF PAR COORDONNÉES → lignes reconstruites.
//
// Même principe éprouvé que le lecteur du rapport Crisalid : un PDF n'est pas une
// image, chaque token a une position (x, y). `pdf-parse` rend par défaut un texte
// PLAT qui colle les colonnes (« 12.4kg5.8071.92 »), forçant l'IA à deviner ; via
// son hook `pagerender`, on accède aux items AVEC leurs coordonnées, on regroupe
// par ligne (tolérance sur y : les montants alignés à droite tombent sur un y
// légèrement décalé) et on trie par x. Les colonnes ressortent séparées, sans
// aucune dépendance nouvelle (pdf-parse est déjà là).
//
// Best-effort ASSUMÉ : sur un PDF exotique (encodage tordu), la lecture peut
// échouer — on renvoie alors [] et l'appelant retombe sur le texte plat. Jamais
// d'exception qui remonte.

type Item = { x: number; y: number; str: string }

function rowText(row: Item[]): string {
  return row.sort((a, b) => a.x - b.x).map(i => i.str).join(' ').replace(/\s+/g, ' ').trim()
}

/** Renvoie les lignes du PDF reconstruites par coordonnées, ou [] si illisible. */
export async function pdfToLines(buffer: Buffer): Promise<string[]> {
  try {
    const _m = (await import('pdf-parse')) as any
    const fn = typeof _m.default === 'function' ? _m.default : _m
    if (typeof fn !== 'function') return []
    const lines: string[] = []
    await fn(buffer, {
      // pagerender reçoit la page pdfjs : on lit les coordonnées et on ignore le
      // texte plat concaténé par défaut (d'où le return '').
      pagerender: async (pageData: any) => {
        const tc = await pageData.getTextContent()
        const items: Item[] = tc.items
          .map((it: any) => ({ x: it.transform[4], y: it.transform[5], str: String(it.str) }))
          .sort((a: Item, b: Item) => b.y - a.y || a.x - b.x)
        let cur: Item[] = []
        let curY: number | null = null
        for (const it of items) {
          if (curY === null || Math.abs(it.y - curY) <= 2.5) {
            cur.push(it)
            if (curY === null) curY = it.y
          } else {
            lines.push(rowText(cur))
            cur = [it]
            curY = it.y
          }
        }
        if (cur.length) lines.push(rowText(cur))
        return ''
      },
    })
    return lines
  } catch {
    return []
  }
}
