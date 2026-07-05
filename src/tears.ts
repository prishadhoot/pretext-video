/**
 * Persistent tear holes created when bullets exit the person silhouette.
 * Renderer subtracts these from layout intervals so Pretext reflows around gaps.
 */

export type TearHole = {
  x: number
  y: number
  angle: number
  age: number
  growDuration: number
  maxRadiusX: number
  maxRadiusY: number
  fadeStart: number
  maxAge: number
}

export type Interval = { left: number; right: number }

const MAX_TEAR_COUNT = 12
const tears: TearHole[] = []

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

/** Register a new tear at the bullet exit point. */
export function registerTear(x: number, y: number, angle: number, fontSize: number): void {
  tears.push({
    x,
    y,
    angle,
    age: 0,
    growDuration: 0.25,
    maxRadiusX: fontSize * 5,
    maxRadiusY: fontSize * 2.2,
    fadeStart: 7,
    maxAge: 8,
  })
  while (tears.length > MAX_TEAR_COUNT) tears.shift()
}

export function updateTears(dt: number): void {
  for (let i = tears.length - 1; i >= 0; i--) {
    tears[i].age += dt
    if (tears[i].age >= tears[i].maxAge) tears.splice(i, 1)
  }
}

function getTearRadii(tear: TearHole): { rx: number; ry: number } {
  const growT = Math.min(1, tear.age / tear.growDuration)
  const grow = easeOut(growT)

  let fade = 1
  if (tear.age > tear.fadeStart) {
    fade = 1 - (tear.age - tear.fadeStart) / (tear.maxAge - tear.fadeStart)
    fade = Math.max(0, fade)
  }

  return {
    rx: tear.maxRadiusX * grow * fade,
    ry: tear.maxRadiusY * grow * fade,
  }
}

/**
 * Intersection of a horizontal scanline with an oriented ellipse tear.
 */
function getTearExclusionAtY(tear: TearHole, y: number): Interval | null {
  const { rx, ry } = getTearRadii(tear)
  if (rx < 1 || ry < 1) return null

  const cos = Math.cos(tear.angle)
  const sin = Math.sin(tear.angle)
  const dy = y - tear.y

  const a = (cos * cos) / (rx * rx) + (sin * sin) / (ry * ry)
  const b = 2 * dy * sin * cos * (1 / (rx * rx) - 1 / (ry * ry))
  const c = ((dy * sin) ** 2) / (rx * rx) + ((dy * cos) ** 2) / (ry * ry) - 1

  const disc = b * b - 4 * a * c
  if (disc < 0) return null

  const sqrtDisc = Math.sqrt(disc)
  const u1 = (-b - sqrtDisc) / (2 * a)
  const u2 = (-b + sqrtDisc) / (2 * a)

  return { left: tear.x + Math.min(u1, u2), right: tear.x + Math.max(u1, u2) }
}

/** Collect x-intervals to exclude from layout at a given scanline. */
export function getExclusionsAtY(yStart: number, yEnd: number): Interval[] {
  const exclusions: Interval[] = []
  const sampleYs = [yStart, (yStart + yEnd) / 2, yEnd]

  for (const tear of tears) {
    let exLeft = Infinity
    let exRight = -Infinity
    let found = false

    for (const y of sampleYs) {
      const interval = getTearExclusionAtY(tear, y)
      if (!interval) continue
      if (interval.left < exLeft) exLeft = interval.left
      if (interval.right > exRight) exRight = interval.right
      found = true
    }

    if (found && exRight - exLeft > 1) {
      exclusions.push({ left: exLeft, right: exRight })
    }
  }

  return mergeIntervals(exclusions)
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (!intervals.length) return []
  const sorted = [...intervals].sort((a, b) => a.left - b.left)
  const merged: Interval[] = [{ ...sorted[0] }]

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]
    const cur = sorted[i]
    if (cur.left <= last.right + 1) {
      last.right = Math.max(last.right, cur.right)
    } else {
      merged.push({ ...cur })
    }
  }

  return merged
}
