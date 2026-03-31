import type { PositionedLine, AppMode } from './types'
import { getPrepared, layoutRectangular } from './text-layout'
import { texts, defaultTextKey } from './texts'

let canvas: HTMLCanvasElement
let ctx: CanvasRenderingContext2D
let animationId: number | null = null

// Offscreen canvas for sampling video pixels
let sampleCanvas: OffscreenCanvas | null = null
let sampleCtx: OffscreenCanvasRenderingContext2D | null = null
let sampleData: ImageData | null = null

// Offscreen canvas for text rendering (before mask)
let textCanvas: OffscreenCanvas | null = null
let textCtx: OffscreenCanvasRenderingContext2D | null = null

// Offscreen canvases for Mode 2
let maskCanvas: OffscreenCanvas | null = null
let maskCtx: OffscreenCanvasRenderingContext2D | null = null

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
  // Mirror x to match the mirrored video frame (selfie mode)
  const mirroredX = canvasW - x
  const mx = Math.max(0, Math.min(Math.round((mirroredX / canvasW) * personMask.width), personMask.width - 1))
  const my = Math.max(0, Math.min(Math.round((y / canvasH) * personMask.height), personMask.height - 1))
  const idx = (my * personMask.width + mx) * 4
  return personMask.data[idx + 3] / 255 // alpha channel holds confidence
}

/**
 * Draw text covering the full canvas, colored by video pixels,
 * but only visible within the person mask area.
 */
function drawPersonTextLines(lines: PositionedLine[], w: number, h: number) {
  // Prepare text offscreen canvas
  const dpr = window.devicePixelRatio || 1
  const cw = Math.round(w * dpr)
  const ch = Math.round(h * dpr)
  if (!textCanvas || textCanvas.width !== cw || textCanvas.height !== ch) {
    textCanvas = new OffscreenCanvas(cw, ch)
    textCtx = textCanvas.getContext('2d')!
  }

  textCtx!.clearRect(0, 0, cw, ch)
  textCtx!.scale(dpr, dpr)
  textCtx!.font = font
  textCtx!.textBaseline = 'top'

  // Draw each character with color from video
  for (const line of lines) {
    let charX = line.x
    for (const char of line.text) {
      const charW = textCtx!.measureText(char).width
      const centerX = charX + charW / 2
      const centerY = line.y + lineHeight / 2

      // Check person mask — skip if not a person pixel
      const personConf = isPersonAt(centerX, centerY, w, h)
      if (personConf < 0.3) {
        charX += charW
        continue
      }

      // Sample video pixel color
      const { r, g, b, lum } = samplePixel(centerX, centerY)

      // Alpha: darker areas → more opaque, lighter areas → less opaque
      // Also factor in person confidence for soft edges
      const lumAlpha = Math.pow(1 - lum, 0.6)
      const alpha = Math.max(0.08, lumAlpha * personConf)

      // Use the sampled color (slightly darkened for contrast)
      const dr = Math.round(r * 0.4)
      const dg = Math.round(g * 0.4)
      const db = Math.round(b * 0.4)

      textCtx!.fillStyle = `rgba(${dr},${dg},${db},${alpha})`
      textCtx!.fillText(char, charX, line.y)
      charX += charW
    }
  }

  // Reset transform and draw to main canvas
  textCtx!.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(textCanvas!, 0, 0, cw, ch, 0, 0, w, h)
}

function renderTextFaceMode() {
  const rect = canvas.getBoundingClientRect()
  const w = rect.width
  const h = rect.height

  captureVideoFrame(w, h)

  const baseText = getCurrentText()
  if (!baseText) return

  updateFont()

  if (sampleData && personMask) {
    // Camera active: dense text covering full canvas, masked to person shape
    // Repeat text many times so it fills the entire area
    const charsNeeded = Math.ceil((w * h) / (fontSize * fontSize * 0.3))
    const repeatedText = getRepeatedText(baseText, charsNeeded)
    const prepared = getPrepared(repeatedText, font)

    const padding = 4
    const lines = layoutRectangular(prepared, w - padding * 2, lineHeight, padding, padding)
    drawPersonTextLines(lines, w, h)
  } else {
    // No camera: elegant full-canvas typographic composition
    // Dense repeated text filling the entire canvas with varying opacity
    const charsNeeded = Math.ceil((w * h) / (fontSize * fontSize * 0.3))
    const repeatedText = getRepeatedText(baseText, charsNeeded)
    const prepared = getPrepared(repeatedText, font)

    const padding = 4
    const lines = layoutRectangular(prepared, w - padding * 2, lineHeight, padding, padding)

    ctx.font = font
    ctx.textBaseline = 'top'

    // Draw with radial gradient opacity — denser in center, fading at edges
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

        // Center: opaque dark. Edges: very faint
        const alpha = Math.max(0.03, Math.pow(1 - t, 2.5) * 0.85)
        const gray = Math.round(30 + t * 60)
        ctx.fillStyle = `rgba(${gray},${gray},${gray},${alpha})`
        ctx.fillText(char, charX, line.y)
        charX += charW
      }
    }
  }
}

/**
 * Check if any sample point in a surrounding area hits the person mask.
 * This creates a wider "exclusion zone" around the person so text stays further away.
 */
function isNearPerson(x: number, y: number, w: number, h: number, margin: number): boolean {
  // Check the center point and several points within the margin
  for (let dy = -margin; dy <= margin; dy += margin) {
    for (let dx = -margin; dx <= margin; dx += margin) {
      if (isPersonAt(x + dx, y + dy, w, h) > 0.3) return true
    }
  }
  return false
}

/**
 * Draw text lines but skip characters that are near the person area.
 * Text "flows around" the person cutout with a visible gap.
 */
function drawTextAvoidingPerson(lines: PositionedLine[], w: number, h: number) {
  ctx.font = font
  ctx.fillStyle = '#1a1a1a'
  ctx.textBaseline = 'top'

  // Margin in pixels — how far text stays from the person edge
  const margin = Math.max(fontSize * 2, 16)

  for (const line of lines) {
    let charX = line.x
    for (const char of line.text) {
      const charW = ctx.measureText(char).width
      const centerX = charX + charW / 2
      const centerY = line.y + lineHeight / 2

      if (!isNearPerson(centerX, centerY, w, h, margin)) {
        ctx.fillText(char, charX, line.y)
      }
      charX += charW
    }
  }
}

function renderCutoutMode() {
  const rect = canvas.getBoundingClientRect()
  const w = rect.width
  const h = rect.height

  const baseText = getCurrentText()
  if (!baseText) return

  updateFont()

  // Repeat text to fill full canvas
  const charsNeeded = Math.ceil((w * h) / (fontSize * fontSize * 0.3))
  const repeatedText = getRepeatedText(baseText, charsNeeded)
  const prepared = getPrepared(repeatedText, font)

  const padding = 4
  const lines = layoutRectangular(prepared, w - padding * 2, lineHeight, padding, padding)

  if (personMask && videoElement && videoElement.readyState >= 2) {
    // Draw text everywhere EXCEPT where person is
    drawTextAvoidingPerson(lines, w, h)

    // Overlay person cutout on top:
    // 1. Draw mask as image (need a temp canvas to hold it)
    // 2. Draw mirrored video using 'source-in' so only person area shows
    const dpr = window.devicePixelRatio || 1
    const cw = canvas.width
    const ch = canvas.height
    if (!maskCanvas || maskCanvas.width !== cw || maskCanvas.height !== ch) {
      maskCanvas = new OffscreenCanvas(cw, ch)
      maskCtx = maskCanvas.getContext('2d')!
    }

    // Step 1: Put the mask into a temp canvas, mirrored to match video
    // Create a small temp canvas at mask resolution to hold the ImageData
    const maskW = personMask.width
    const maskH = personMask.height
    const tmpMask = new OffscreenCanvas(maskW, maskH)
    const tmpCtx = tmpMask.getContext('2d')!
    tmpCtx.putImageData(personMask, 0, 0)

    // Step 2: Draw mask mirrored onto maskCanvas
    maskCtx!.clearRect(0, 0, cw, ch)
    maskCtx!.save()
    maskCtx!.translate(cw, 0)
    maskCtx!.scale(-1, 1)
    maskCtx!.drawImage(tmpMask, 0, 0, cw, ch)
    maskCtx!.restore()

    // Step 3: Draw mirrored video, but only where mask is (source-in)
    maskCtx!.globalCompositeOperation = 'source-in'
    maskCtx!.save()
    maskCtx!.scale(dpr, dpr)
    maskCtx!.translate(w, 0)
    maskCtx!.scale(-1, 1)
    maskCtx!.drawImage(videoElement, 0, 0, w, h)
    maskCtx!.restore()
    maskCtx!.globalCompositeOperation = 'source-over'

    // Step 4: Draw the cutout onto main canvas
    ctx.drawImage(maskCanvas!, 0, 0, cw, ch, 0, 0, w, h)
  } else {
    // No camera: just draw all text normally
    ctx.font = font
    ctx.fillStyle = '#1a1a1a'
    ctx.textBaseline = 'top'
    for (const line of lines) {
      ctx.fillText(line.text, line.x, line.y)
    }
  }
}

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
