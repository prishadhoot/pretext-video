/**
 * Per-frame cache of positioned glyphs for tear particle extraction.
 */

export type CachedGlyph = {
  char: string
  x: number
  y: number
  w: number
  h: number
}

let glyphs: CachedGlyph[] = []

export function clearGlyphCache(): void {
  glyphs = []
}

export function addGlyph(char: string, x: number, y: number, w: number, h: number): void {
  glyphs.push({ char, x, y, w, h })
}

/** Find glyphs whose center falls inside an oriented ellipse region. */
export function queryGlyphsNear(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  angle: number,
  limit = 10,
): CachedGlyph[] {
  const cos = Math.cos(-angle)
  const sin = Math.sin(-angle)
  const results: CachedGlyph[] = []

  for (const g of glyphs) {
    const gx = g.x + g.w / 2
    const gy = g.y + g.h / 2
    const dx = gx - cx
    const dy = gy - cy
    const localX = dx * cos - dy * sin
    const localY = dx * sin + dy * cos
    if ((localX / rx) ** 2 + (localY / ry) ** 2 <= 1) {
      results.push(g)
      if (results.length >= limit) break
    }
  }

  return results
}
