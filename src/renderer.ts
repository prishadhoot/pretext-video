import type { AppMode } from './types'
import { layoutNextLine, type LayoutCursor } from '@chenglou/pretext'
import { getPrepared, layoutRectangular } from './text-layout'
import { texts, defaultTextKey } from './texts'

let canvas: HTMLCanvasElement
let ctx: CanvasRenderingContext2D
let animationId: number | null = null

// Offscreen canvas for sampling video pixels
let sampleCanvas: OffscreenCanvas | null = null
let sampleCtx: OffscreenCanvasRenderingContext2D | null = null
let sampleData: ImageData | null = null

// Offscreen canvases for cutout compositing
let maskCanvas: OffscreenCanvas | null = null
let maskCtx: OffscreenCanvasRenderingContext2D | null = null
let tmpMaskCanvas: OffscreenCanvas | null = null
let tmpMaskCtx: OffscreenCanvasRenderingContext2D | null = null

// State
let currentMode: AppMode = 'textface'
let currentTextKey = defaultTextKey
let customText = ''
let fontSize = 18
let lineHeight = 26
let font = ''
let videoElement: HTMLVideoElement | null = null
let personMask: ImageData | null = null

export function initRenderer(canvasEl: HTMLCanvasElement) {
  canvas = canvasEl
  ctx = canvas.getContext('2d', { alpha: false })!
  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  ctx.scale(dpr, dpr)
}

export function getCanvas(): HTMLCanvasElement { return canvas }
export function setMode(mode: AppMode) { currentMode = mode }
export function setTextKey(key: string) { currentTextKey = key }
export function setCustomText(text: string) { customText = text }
export function setFontSize(size: number) {
  fontSize = size
  lineHeight = Math.round(size * 1.5)
}
export function setVideoElement(video: HTMLVideoElement | null) { videoElement = video }
export function setPersonMask(mask: ImageData | null) { personMask = mask }

function getCurrentText(): string {
  if (currentTextKey === 'custom') return customText
  return texts[currentTextKey]?.text ?? ''
}

function updateFont() {
  font = `${fontSize}px Inter, sans-serif`
}

/**
 * Repeat text enough times to fill the canvas densely.
 */
function getRepeatedText(baseText: string, targetLength: number): string {
  if (!baseText) return ''
  let result = baseText
  while (result.length < targetLength) {
    result += ' ' + baseText
  }
  return result
}

/**
 * Capture the mirrored video frame for pixel sampling.
 */
function captureVideoFrame(w: number, h: number) {
  if (!videoElement || videoElement.readyState < 2) {
    sampleData = null
    return
  }

  const iw = Math.round(w)
  const ih = Math.round(h)
  if (!sampleCanvas || sampleCanvas.width !== iw || sampleCanvas.height !== ih) {
    sampleCanvas = new OffscreenCanvas(iw, ih)
    sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true })!
  }

  sampleCtx!.save()
  sampleCtx!.translate(iw, 0)
  sampleCtx!.scale(-1, 1)
  sampleCtx!.drawImage(videoElement, 0, 0, iw, ih)
  sampleCtx!.restore()

  sampleData = sampleCtx!.getImageData(0, 0, iw, ih)
}

/**
 * Sample pixel color from video frame.
 */
function samplePixel(x: number, y: number): { r: number; g: number; b: number; a: number; lum: number } {
  if (!sampleData) return { r: 30, g: 30, b: 30, a: 255, lum: 0.12 }
  const px = Math.max(0, Math.min(Math.round(x), sampleData.width - 1))
  const py = Math.max(0, Math.min(Math.round(y), sampleData.height - 1))
  const idx = (py * sampleData.width + px) * 4
  const r = sampleData.data[idx]
  const g = sampleData.data[idx + 1]
  const b = sampleData.data[idx + 2]
  const a = sampleData.data[idx + 3]
  const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255
  return { r, g, b, a, lum }
}

/**
 * Check if a pixel is part of the person (from segmentation mask).
 */
function isPersonAt(x: number, y: number, canvasW: number, canvasH: number): number {
  if (!personMask) return 0
  const mirroredX = canvasW - x
  const mx = Math.max(0, Math.min(Math.round((mirroredX / canvasW) * personMask.width), personMask.width - 1))
  const my = Math.max(0, Math.min(Math.round((y / canvasH) * personMask.height), personMask.height - 1))
  const idx = (my * personMask.width + mx) * 4
  return personMask.data[idx + 3] / 255
}

/**
 * Scan the person mask at a y range to find the horizontal bounds of the person.
 * Samples at multiple y positions within the line for accuracy.
 */
function getPersonBoundsAtY(yStart: number, yEnd: number, canvasW: number, canvasH: number): { left: number; right: number } | null {
  if (!personMask) return null

  let globalLeft = canvasW
  let globalRight = 0
  let found = false

  const step = Math.max(2, Math.floor(canvasW / 150))

  for (const y of [yStart, (yStart + yEnd) / 2, yEnd]) {
    const my = Math.max(0, Math.min(Math.round((y / canvasH) * personMask.height), personMask.height - 1))

    for (let x = 0; x < canvasW; x += step) {
      const mirroredX = canvasW - x
      const mx = Math.max(0, Math.min(Math.round((mirroredX / canvasW) * personMask.width), personMask.width - 1))
      const idx = (my * personMask.width + mx) * 4
      const confidence = personMask.data[idx + 3] / 255

      if (confidence > 0.5) {
        if (x < globalLeft) globalLeft = x
        if (x > globalRight) globalRight = x
        found = true
      }
    }
  }

  if (!found || globalRight - globalLeft < 10) return null
  return { left: globalLeft, right: globalRight }
}

// ─── Text Face Mode ─────────────────────────────────────────────


function renderTextFaceMode() {
  const rect = canvas.getBoundingClientRect()
  const w = rect.width
  const h = rect.height

  captureVideoFrame(w, h)

  const baseText = getCurrentText()
  if (!baseText) return

  updateFont()

  if (sampleData && personMask) {
    // Layout text INSIDE person shape using variable-width reflow
    const innerMargin = fontSize * 0.3
    const charsNeeded = Math.ceil((w * h) / (fontSize * fontSize * 0.3))
    const repeatedText = getRepeatedText(baseText, charsNeeded)
    const prepared = getPrepared(repeatedText, font)

    ctx.font = font
    ctx.textBaseline = 'top'

    let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }

    for (let y = 0; y + lineHeight <= h; y += lineHeight) {
      const bounds = getPersonBoundsAtY(y, y + lineHeight, w, h)
      if (!bounds) continue

      const availWidth = bounds.right - bounds.left - innerMargin * 2
      if (availWidth < fontSize * 3) continue

      const line = layoutNextLine(prepared, cursor, availWidth)
      if (!line) break

      // Draw each character colored by video pixel
      let charX = bounds.left + innerMargin
      for (const char of line.text) {
        const charW = ctx.measureText(char).width
        const centerX = charX + charW / 2
        const centerY = y + lineHeight / 2

        const { r, g, b, lum } = samplePixel(centerX, centerY)
        const personConf = isPersonAt(centerX, centerY, w, h)
        const lumAlpha = Math.pow(1 - lum, 0.6)
        const alpha = Math.max(0.05, lumAlpha * Math.min(1, personConf * 1.5))

        const dr = Math.round(r * 0.4)
        const dg = Math.round(g * 0.4)
        const db = Math.round(b * 0.4)

        ctx.fillStyle = `rgba(${dr},${dg},${db},${alpha})`
        ctx.fillText(char, charX, y)
        charX += charW
      }

      cursor = line.end
    }
  } else {
    renderEditorialLayout(w, h)
  }
}

// ─── Cutout Mode ────────────────────────────────────────────────

/**
 * Draw the person cutout overlay with soft edges.
 */
function drawPersonCutout(w: number, h: number) {
  if (!personMask || !videoElement || videoElement.readyState < 2) return

  const dpr = window.devicePixelRatio || 1
  const cw = canvas.width
  const ch = canvas.height

  if (!maskCanvas || maskCanvas.width !== cw || maskCanvas.height !== ch) {
    maskCanvas = new OffscreenCanvas(cw, ch)
    maskCtx = maskCanvas.getContext('2d')!
  }

  // Reuse tmp canvas for mask ImageData
  const maskW = personMask.width
  const maskH = personMask.height
  if (!tmpMaskCanvas || tmpMaskCanvas.width !== maskW || tmpMaskCanvas.height !== maskH) {
    tmpMaskCanvas = new OffscreenCanvas(maskW, maskH)
    tmpMaskCtx = tmpMaskCanvas.getContext('2d')!
  }
  tmpMaskCtx!.putImageData(personMask, 0, 0)

  // Draw mask mirrored with blur for soft edges
  maskCtx!.clearRect(0, 0, cw, ch)
  maskCtx!.imageSmoothingEnabled = true
  maskCtx!.imageSmoothingQuality = 'high'
  maskCtx!.filter = 'blur(4px)'
  maskCtx!.save()
  maskCtx!.translate(cw, 0)
  maskCtx!.scale(-1, 1)
  maskCtx!.drawImage(tmpMaskCanvas!, 0, 0, cw, ch)
  maskCtx!.restore()
  maskCtx!.filter = 'none'

  // Draw mirrored video using source-in (only person area shows)
  maskCtx!.globalCompositeOperation = 'source-in'
  maskCtx!.save()
  maskCtx!.scale(dpr, dpr)
  maskCtx!.translate(w, 0)
  maskCtx!.scale(-1, 1)
  maskCtx!.drawImage(videoElement!, 0, 0, w, h)
  maskCtx!.restore()
  maskCtx!.globalCompositeOperation = 'source-over'

  ctx.drawImage(maskCanvas!, 0, 0, cw, ch, 0, 0, w, h)
}

function renderCutoutMode() {
  const rect = canvas.getBoundingClientRect()
  const w = rect.width
  const h = rect.height

  const baseText = getCurrentText()
  if (!baseText) return

  updateFont()

  if (personMask && videoElement && videoElement.readyState >= 2) {
    // ── Reflow text around person using layoutNextLine() ──
    const margin = Math.max(fontSize * 2, 20)
    const padding = 4
    const charsNeeded = Math.ceil((w * h) / (fontSize * fontSize * 0.3))
    const repeatedText = getRepeatedText(baseText, charsNeeded)
    const prepared = getPrepared(repeatedText, font)

    ctx.font = font
    ctx.fillStyle = '#1a1a1a'
    ctx.textBaseline = 'top'

    let leftCursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
    let rightCursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }

    // Pre-advance right cursor so both sides show different text
    const advanceLines = Math.ceil(h / lineHeight)
    for (let i = 0; i < advanceLines; i++) {
      const line = layoutNextLine(prepared, rightCursor, w * 0.4)
      if (!line) { rightCursor = { segmentIndex: 0, graphemeIndex: 0 }; break }
      rightCursor = line.end
    }

    for (let y = padding; y + lineHeight <= h; y += lineHeight) {
      const bounds = getPersonBoundsAtY(y, y + lineHeight, w, h)

      if (!bounds) {
        // No person at this line — full width
        const line = layoutNextLine(prepared, leftCursor, w - padding * 2)
        if (!line) break
        ctx.fillText(line.text, padding, y)
        leftCursor = line.end
      } else {
        const leftWidth = bounds.left - margin - padding
        const rightWidth = w - bounds.right - margin - padding

        // Left side (skip if too narrow for readable text)
        if (leftWidth > fontSize * 8) {
          const line = layoutNextLine(prepared, leftCursor, leftWidth)
          if (line) {
            ctx.fillText(line.text, padding, y)
            leftCursor = line.end
          }
        }

        // Right side
        if (rightWidth > fontSize * 8) {
          const line = layoutNextLine(prepared, rightCursor, rightWidth)
          if (line) {
            ctx.fillText(line.text, bounds.right + margin, y)
            rightCursor = line.end
          }
        }
      }
    }

    // Overlay person cutout with soft edges
    drawPersonCutout(w, h)
  } else {
    renderEditorialLayout(w, h)
  }
}

// ─── Editorial Layout (no camera) ──────────────────────────────

function renderEditorialLayout(w: number, h: number) {
  const baseText = getCurrentText()
  if (!baseText) return

  updateFont()

  // Dense repeated text filling entire canvas
  const charsNeeded = Math.ceil((w * h) / (fontSize * fontSize * 0.3))
  const repeatedText = getRepeatedText(baseText, charsNeeded)
  const prepared = getPrepared(repeatedText, font)

  const padding = 4
  const lines = layoutRectangular(prepared, w - padding * 2, lineHeight, padding, padding)

  ctx.font = font
  ctx.textBaseline = 'top'

  // Radial gradient: center opaque, edges fade out
  const cx = w / 2
  const cy = h / 2
  const maxDist = Math.sqrt(cx * cx + cy * cy)

  for (const line of lines) {
    let charX = line.x
    for (const char of line.text) {
      const charW = ctx.measureText(char).width
      const dx = (charX + charW / 2) - cx
      const dy = (line.y + lineHeight / 2) - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      const t = dist / maxDist

      const alpha = Math.max(0.03, Math.pow(1 - t, 2.5) * 0.85)
      const gray = Math.round(30 + t * 60)
      ctx.fillStyle = `rgba(${gray},${gray},${gray},${alpha})`
      ctx.fillText(char, charX, line.y)
      charX += charW
    }
  }
}

// ─── Render Loop ────────────────────────────────────────────────

function render() {
  const rect = canvas.getBoundingClientRect()
  ctx.clearRect(0, 0, rect.width, rect.height)
  ctx.fillStyle = '#f5f3ef'
  ctx.fillRect(0, 0, rect.width, rect.height)

  if (currentMode === 'textface') {
    renderTextFaceMode()
  } else {
    renderCutoutMode()
  }

  animationId = requestAnimationFrame(render)
}

export function startRenderLoop() {
  if (animationId !== null) return
  render()
}

export function stopRenderLoop() {
  if (animationId !== null) {
    cancelAnimationFrame(animationId)
    animationId = null
  }
}
