import {
  prepareWithSegments,
  layoutWithLines,
  layoutNextLine,
  type PreparedTextWithSegments,
  type LayoutCursor,
} from '@chenglou/pretext'
import type { Point, PositionedLine } from './types'

let cachedText = ''
let cachedFont = ''
let cachedPrepared: PreparedTextWithSegments | null = null

export function getPrepared(text: string, font: string): PreparedTextWithSegments {
  if (text === cachedText && font === cachedFont && cachedPrepared) {
    return cachedPrepared
  }
  cachedText = text
  cachedFont = font
  cachedPrepared = prepareWithSegments(text, font)
  return cachedPrepared
}

/**
 * Get the horizontal extent of a polygon at a given y coordinate.
 * Ray casting: find all x-intersections of horizontal line y with polygon edges.
 * Reference: pretext/pages/demos/wrap-geometry.ts getPolygonXsAtY
 */
function getContourWidthAtY(polygon: Point[], y: number): { left: number; right: number } | null {
  const xs: number[] = []
  let a = polygon[polygon.length - 1]
  for (const b of polygon) {
    if ((a.y <= y && y < b.y) || (b.y <= y && y < a.y)) {
      xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y))
    }
    a = b
  }
  xs.sort((a, b) => a - b)
  return xs.length >= 2 ? { left: xs[0], right: xs[xs.length - 1] } : null
}

function getPolygonBounds(polygon: Point[]): { top: number; bottom: number; left: number; right: number } {
  let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity
  for (const p of polygon) {
    if (p.y < top) top = p.y
    if (p.y > bottom) bottom = p.y
    if (p.x < left) left = p.x
    if (p.x > right) right = p.x
  }
  return { top, bottom, left, right }
}

/**
 * Mode 1: Reflow text into a polygon shape (face contour).
 * Each line gets a different maxWidth based on the polygon width at that y.
 */
export function reflowIntoPolygon(
  prepared: PreparedTextWithSegments,
  polygon: Point[],
  lineHeight: number,
  padding = 8,
): PositionedLine[] {
  const bounds = getPolygonBounds(polygon)
  const lines: PositionedLine[] = []
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
  let y = bounds.top + padding

  while (y + lineHeight <= bounds.bottom - padding) {
    const interval = getContourWidthAtY(polygon, y + lineHeight / 2)
    if (!interval || interval.right - interval.left < 24) {
      y += lineHeight
      continue
    }
    const width = interval.right - interval.left - padding * 2
    const line = layoutNextLine(prepared, cursor, width)
    if (!line) break
    const slotWidth = width
    lines.push({
      text: line.text,
      x: interval.left + padding,
      y,
      width: line.width,
      slotWidth,
    })
    cursor = line.end
    y += lineHeight
  }
  return lines
}

/**
 * Mode 2: Normal rectangular text layout.
 */
export function layoutRectangular(
  prepared: PreparedTextWithSegments,
  maxWidth: number,
  lineHeight: number,
  offsetX = 0,
  offsetY = 0,
): PositionedLine[] {
  const result = layoutWithLines(prepared, maxWidth, lineHeight)
  return result.lines.map((line, i) => ({
    text: line.text,
    x: offsetX,
    y: offsetY + i * lineHeight,
    width: line.width,
  }))
}

/**
 * Generate an ellipse polygon for testing Mode 1 without a camera.
 */
export function generateEllipse(cx: number, cy: number, rx: number, ry: number, segments = 64): Point[] {
  const points: Point[] = []
  for (let i = 0; i < segments; i++) {
    const angle = (2 * Math.PI * i) / segments
    points.push({
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
    })
  }
  return points
}
