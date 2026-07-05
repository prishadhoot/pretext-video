/**
 * Revolver: draggable gun with negative-space bullet, recoil, muzzle flash,
 * and text-glyph exit burst. All animation is driven by the main render loop
 * via updateAndDrawEffects(); no separate rAF loop is used.
 */

import { registerTear } from './tears'
import { queryGlyphsNear, type CachedGlyph } from './glyph-cache'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Bullet {
  x: number
  y: number
  vx: number       // px/s (negative = leftward)
  vy: number
  width: number    // capsule half-length
  height: number   // capsule radius
  trail: TrailPoint[]
  wasInsidePerson: boolean
  alive: boolean
}

interface TrailPoint {
  x: number
  y: number
  alpha: number
}

interface TextParticle {
  char: string
  x: number
  y: number
  vx: number
  vy: number
  angle: number
  spin: number
  size: number
  alpha: number
  life: number       // 0..1, decreasing
  color: string
  gravity: number
}

// ─── Module state ────────────────────────────────────────────────────────────

let revolverImage: HTMLImageElement | null = null
let imageReady = false

// Revolver layout (in CSS px)
let revolverX = 0
let revolverY = 0
let revolverW = 0
let revolverH = 0

// User-dragged position (null = use default bottom-right)
let userPinnedX: number | null = null
let userPinnedY: number | null = null

// Font size to match on-screen text
let particleFontSize = 8

// Muzzle tip position relative to revolver rect (fraction of W/H)
// The image faces left: barrel exit is at the left-center
const MUZZLE_REL_X = 0.03   // 3% from left edge
const MUZZLE_REL_Y = 0.38   // 38% from top (barrel center height)

// Recoil state
let recoilT = 0        // 0..1 progress (0 = resting, 1 = full recoil at start)
let recoilDur = 0.18   // seconds

const bullets: Bullet[] = []
const particles: TextParticle[] = []

let currentTextChars: string[] = []

// ─── Public API ──────────────────────────────────────────────────────────────

export function initRevolver(imageUrl: string): void {
  revolverImage = new Image()
  revolverImage.onload = () => { imageReady = true }
  revolverImage.src = imageUrl
}

export function setRevolverText(text: string): void {
  if (!text) return
  // Collect unique printable non-space chars for particles
  currentTextChars = Array.from(new Set(text.replace(/\s+/g, ''))).filter(c => c.trim().length > 0)
}

export function setParticleFontSize(size: number): void {
  particleFontSize = size
}

export function setRevolverPosition(x: number, y: number): void {
  userPinnedX = x
  userPinnedY = y
}

export function getRevolverBounds(): { x: number; y: number; w: number; h: number } {
  return { x: revolverX, y: revolverY, w: revolverW, h: revolverH }
}

export function fire(textChars?: string[]): void {
  if (textChars) currentTextChars = textChars

  // Start recoil
  recoilT = 1.0

  // Muzzle world position (CSS px)
  const muzzleX = revolverX + MUZZLE_REL_X * revolverW
  const muzzleY = revolverY + MUZZLE_REL_Y * revolverH

  // Spawn bullet
  bullets.push({
    x: muzzleX,
    y: muzzleY,
    vx: -1600,   // px/s leftward
    vy: 0,
    width: 22,
    height: 6,
    trail: [],
    wasInsidePerson: false,
    alive: true,
  })

  // Muzzle flash: text glyphs ejected in a forward cone
  spawnMuzzleFlash(muzzleX, muzzleY)
}

// ─── Main update / draw (called each render frame) ───────────────────────────

/**
 * @param ctx      Main canvas 2D context (already scaled by DPR via renderer)
 * @param w        CSS-px canvas width
 * @param h        CSS-px canvas height
 * @param dt       Delta-time in seconds
 * @param confAt   Function returning MediaPipe person confidence at a CSS-px position
 */
export function updateAndDrawEffects(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  dt: number,
  confAt: (x: number, y: number) => number,
): void {
  layoutRevolver(w, h)

  updateBullets(dt, w, h, confAt)
  updateParticles(dt)

  drawTrails(ctx)
  drawBullets(ctx, confAt)
  drawParticles(ctx)
  drawRevolver(ctx, w, h, dt)
}

// ─── Layout ──────────────────────────────────────────────────────────────────

function layoutRevolver(w: number, h: number): void {
  revolverW = Math.min(180, w * 0.22)
  revolverH = revolverW * 0.72   // aspect ratio from image
  const margin = 16

  if (userPinnedX !== null && userPinnedY !== null) {
    // Clamp to canvas bounds so revolver stays visible
    revolverX = Math.max(0, Math.min(userPinnedX, w - revolverW))
    revolverY = Math.max(0, Math.min(userPinnedY, h - revolverH))
  } else {
    revolverX = w - revolverW - margin
    revolverY = h - revolverH - margin
  }
}

// ─── Bullet update ───────────────────────────────────────────────────────────

function updateBullets(dt: number, w: number, h: number, confAt: (x: number, y: number) => number): void {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i]
    if (!b.alive) { bullets.splice(i, 1); continue }

    b.x += b.vx * dt
    b.y += b.vy * dt

    // Record trail
    b.trail.push({ x: b.x, y: b.y, alpha: 1.0 })
    if (b.trail.length > 18) b.trail.shift()
    // Fade older trail points
    for (let t = 0; t < b.trail.length; t++) {
      b.trail[t].alpha = (t + 1) / b.trail.length * 0.55
    }

    // Person pass-through detection
    const conf = confAt(b.x, b.y)
    const isInsideNow = conf > 0.45

    if (b.wasInsidePerson && !isInsideNow) {
      const bulletAngle = Math.atan2(b.vy, b.vx)
      const rx = particleFontSize * 4
      const ry = particleFontSize * 1.8
      const tornGlyphs = queryGlyphsNear(b.x, b.y, rx, ry, bulletAngle, 10)
      registerTear(b.x, b.y, bulletAngle, particleFontSize)
      spawnExitBurst(b.x, b.y, b.vx, b.vy, tornGlyphs)
    }
    b.wasInsidePerson = isInsideNow

    // Kill off-screen
    if (b.x < -b.width * 2 || b.x > w + b.width * 2 || b.y < -20 || b.y > h + 20) {
      b.alive = false
    }
  }
}

// ─── Particle update ─────────────────────────────────────────────────────────

function updateParticles(dt: number): void {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]
    p.life -= dt * 1.8
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.vy += p.gravity * dt
    p.angle += p.spin * dt
    p.alpha = Math.max(0, p.life)
    if (p.life <= 0) { particles.splice(i, 1) }
  }
}

// ─── Spawn helpers ───────────────────────────────────────────────────────────

function randomChar(): string {
  if (!currentTextChars.length) return '·'
  return currentTextChars[Math.floor(Math.random() * currentTextChars.length)]
}

function spawnMuzzleFlash(mx: number, my: number): void {
  const count = 10
  const baseSize = particleFontSize
  for (let i = 0; i < count; i++) {
    // Cone pointing left (angles around π, ±45°)
    const baseAngle = Math.PI
    const spread = (Math.PI / 4) * (Math.random() * 2 - 1)
    const angle = baseAngle + spread
    const speed = 200 + Math.random() * 280
    particles.push({
      char: randomChar(),
      x: mx,
      y: my,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 8,
      size: baseSize * (0.7 + Math.random() * 0.6),
      alpha: 1,
      life: 0.55 + Math.random() * 0.25,
      color: '#1a1a1a',
      gravity: 60,
    })
  }
}

function spawnExitBurst(
  ex: number,
  ey: number,
  bulletVx: number,
  bulletVy: number,
  tornGlyphs: CachedGlyph[] = [],
): void {
  const bulletAngle = Math.atan2(bulletVy, bulletVx)
  const baseSize = particleFontSize

  // ── Torn glyphs: real letters ripped from the layout ───────────────────────
  for (const g of tornGlyphs) {
    const gx = g.x + g.w / 2
    const gy = g.y + g.h / 2
    const tearAngle = bulletAngle + (Math.random() * 2 - 1) * (Math.PI * 0.25)
    const speed = 280 + Math.random() * 320
    particles.push({
      char: g.char,
      x: gx,
      y: gy,
      vx: Math.cos(tearAngle) * speed,
      vy: Math.sin(tearAngle) * speed,
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 12,
      size: baseSize * (0.9 + Math.random() * 0.4),
      alpha: 1,
      life: 0.75 + Math.random() * 0.45,
      color: '#1a1a1a',
      gravity: 80,
    })
  }

  // ── Main spray: fan in the bullet's forward direction ──────────────────────
  const sprayCone = (Math.PI * 70) / 180
  const sprayCount = tornGlyphs.length > 0 ? 8 : 18
  for (let i = 0; i < sprayCount; i++) {
    const angle = bulletAngle + (Math.random() * 2 - 1) * sprayCone
    const speed = 160 + Math.random() * 300
    particles.push({
      char: randomChar(),
      x: ex + (Math.random() - 0.5) * 6,
      y: ey + (Math.random() - 0.5) * 6,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 10,
      size: baseSize * (0.8 + Math.random() * 0.7),
      alpha: 1,
      life: 0.6 + Math.random() * 0.5,
      color: '#1a1a1a',
      gravity: 90,
    })
  }

  // ── Side scatter: shrapnel perpendicular to bullet ─────────────────────────
  const sideCount = tornGlyphs.length > 0 ? 2 : 4
  for (let i = 0; i < sideCount; i++) {
    const sideSign = i % 2 === 0 ? 1 : -1
    const sideAngle = bulletAngle + sideSign * (Math.PI * 0.5 + Math.random() * 0.4)
    const speed = 100 + Math.random() * 180
    particles.push({
      char: randomChar(),
      x: ex + (Math.random() - 0.5) * 12,
      y: ey + (Math.random() - 0.5) * 12,
      vx: Math.cos(sideAngle) * speed,
      vy: Math.sin(sideAngle) * speed,
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 8,
      size: baseSize * (0.6 + Math.random() * 0.5),
      alpha: 1,
      life: 0.4 + Math.random() * 0.35,
      color: '#1a1a1a',
      gravity: 120,
    })
  }
}

// ─── Draw helpers ─────────────────────────────────────────────────────────────

/** Easing: cubic ease-out */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function drawTrails(ctx: CanvasRenderingContext2D): void {
  for (const b of bullets) {
    if (b.trail.length < 2) continue
    for (let t = 1; t < b.trail.length; t++) {
      const prev = b.trail[t - 1]
      const curr = b.trail[t]
      const w = (b.height * 2) * (t / b.trail.length)
      ctx.save()
      ctx.globalAlpha = prev.alpha * 0.5
      ctx.strokeStyle = '#f5f3ef'
      ctx.lineWidth = w
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(prev.x, prev.y)
      ctx.lineTo(curr.x, curr.y)
      ctx.stroke()
      ctx.restore()
    }
  }
}

function drawBullets(ctx: CanvasRenderingContext2D, confAt: (x: number, y: number) => number): void {
  for (const b of bullets) {
    // Hide bullet while inside person silhouette
    if (confAt(b.x, b.y) > 0.45) continue

    ctx.save()
    ctx.translate(b.x, b.y)

    // Pointed-nose capsule: negative-space paper color
    ctx.fillStyle = '#f5f3ef'
    ctx.beginPath()
    // Right flat end
    ctx.moveTo(b.width, -b.height)
    ctx.lineTo(b.width, b.height)
    // Left pointed nose
    ctx.lineTo(-b.width * 1.3, 0)
    ctx.closePath()
    ctx.fill()

    // Thin dark outline for readability on the paper background
    ctx.strokeStyle = 'rgba(30,30,30,0.15)'
    ctx.lineWidth = 0.8
    ctx.stroke()

    ctx.restore()
  }
}

function drawParticles(ctx: CanvasRenderingContext2D): void {
  for (const p of particles) {
    if (p.alpha <= 0) continue
    ctx.save()
    ctx.globalAlpha = p.alpha
    ctx.translate(p.x, p.y)
    ctx.rotate(p.angle)
    ctx.font = `${p.size}px Inter, sans-serif`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillStyle = p.color
    ctx.fillText(p.char, 0, 0)
    ctx.restore()
  }
}

function drawRevolver(ctx: CanvasRenderingContext2D, _w: number, _h: number, dt: number): void {
  // Advance recoil decay
  if (recoilT > 0) {
    recoilT = Math.max(0, recoilT - dt / recoilDur)
  }

  if (!imageReady || !revolverImage) return

  // Ease-out recoil offset: gun kicks right then settles back
  const recoilProgress = easeOut(recoilT)
  const offsetX = recoilProgress * 22
  const offsetY = recoilProgress * 3
  const rotation = recoilProgress * 0.1   // ~6 degrees max

  ctx.save()
  // Pivot around the grip (right edge center)
  const pivotX = revolverX + revolverW
  const pivotY = revolverY + revolverH * 0.7
  ctx.translate(pivotX + offsetX, pivotY + offsetY)
  ctx.rotate(rotation)
  ctx.drawImage(revolverImage, -revolverW, -revolverH * 0.7, revolverW, revolverH)
  ctx.restore()
}
