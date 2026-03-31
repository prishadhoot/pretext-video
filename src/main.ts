import {
  initRenderer,
  startRenderLoop,
  setMode,
  setTextKey,
  setCustomText,
  setFontSize,
  setVideoElement,
  setPersonMask,
  getCanvas,
} from './renderer'
import { initSegmentation, segmentPerson, isSegmentationReady } from './segmentation'
import { startRecording, stopRecording, isRecording } from './recorder'
import { texts, defaultTextKey } from './texts'
import type { AppMode } from './types'
import './style.css'

// GA event helper
declare global { interface Window { gtag?: (...args: unknown[]) => void } }
function trackEvent(action: string, params?: Record<string, string | number>) {
  window.gtag?.('event', action, params)
}

// DOM elements
const canvas = document.getElementById('main-canvas') as HTMLCanvasElement
const modeSelect = document.getElementById('mode-select') as HTMLSelectElement
const textSelect = document.getElementById('text-select') as HTMLSelectElement
const customTextWrap = document.getElementById('custom-text-wrap') as HTMLDivElement
const customTextArea = document.getElementById('custom-text') as HTMLTextAreaElement
const customTextClose = document.getElementById('custom-text-close') as HTMLButtonElement
const fontSizeSlider = document.getElementById('font-size') as HTMLInputElement
const fontSizeLabel = document.getElementById('font-size-label') as HTMLSpanElement
const cameraBtn = document.getElementById('camera-btn') as HTMLButtonElement
const recordBtn = document.getElementById('record-btn') as HTMLButtonElement
const statusEl = document.getElementById('status') as HTMLDivElement

const aboutBtn = document.getElementById('about-btn') as HTMLButtonElement
const aboutPanel = document.getElementById('about-panel') as HTMLDivElement
const aboutClose = document.getElementById('about-close') as HTMLButtonElement

aboutBtn.addEventListener('click', () => {
  aboutPanel.style.display = aboutPanel.style.display === 'none' ? 'block' : 'none'
})
aboutClose.addEventListener('click', () => {
  aboutPanel.style.display = 'none'
})

let videoElement: HTMLVideoElement | null = null
let cameraStream: MediaStream | null = null
let detectionLoopId: number | null = null

// --- Font preload: wait for Inter to load before preparing text ---
async function waitForFonts() {
  try {
    await document.fonts.load('8px Inter')
    await document.fonts.ready
  } catch {
    // Fonts API not available, proceed anyway
  }
}

// --- WebCodecs compatibility check ---
function supportsWebCodecs(): boolean {
  return typeof VideoEncoder !== 'undefined'
}

// Populate text select
for (const [key, { title }] of Object.entries(texts)) {
  const option = document.createElement('option')
  option.value = key
  option.textContent = title
  textSelect.appendChild(option)
}
const customOption = document.createElement('option')
customOption.value = 'custom'
customOption.textContent = 'Custom text...'
textSelect.appendChild(customOption)
textSelect.value = defaultTextKey

// Init renderer after fonts are ready
waitForFonts().then(() => {
  initRenderer(canvas)
  setTextKey(defaultTextKey)
  setFontSize(parseInt(fontSizeSlider.value))
  startRenderLoop()
})

// Disable record button on unsupported browsers
if (!supportsWebCodecs()) {
  recordBtn.disabled = true
  recordBtn.title = 'Recording requires Chrome or Edge'
}

// Mode select
modeSelect.addEventListener('change', () => {
  setMode(modeSelect.value as AppMode)
  trackEvent('switch_mode', { mode: modeSelect.value })
})

// Text select
textSelect.addEventListener('change', () => {
  const key = textSelect.value
  setTextKey(key)
  customTextWrap.style.display = key === 'custom' ? 'flex' : 'none'
})

// Custom text
customTextArea.addEventListener('input', () => {
  setCustomText(customTextArea.value)
})

customTextClose.addEventListener('click', () => {
  customTextWrap.style.display = 'none'
})

// Re-open custom text if already selected and user clicks the select again
textSelect.addEventListener('click', () => {
  if (textSelect.value === 'custom' && customTextWrap.style.display === 'none') {
    customTextWrap.style.display = 'flex'
  }
})

// Font size
fontSizeSlider.addEventListener('input', () => {
  const size = parseInt(fontSizeSlider.value)
  setFontSize(size)
  fontSizeLabel.textContent = `${size}px`
})

// Camera
cameraBtn.addEventListener('click', async () => {
  if (cameraStream) {
    stopCamera()
    return
  }
  await startCamera()
})

function showLoading(msg: string) {
  let overlay = document.getElementById('loading-overlay')
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.id = 'loading-overlay'
    document.getElementById('canvas-container')!.appendChild(overlay)
  }
  overlay.textContent = msg
  overlay.style.display = 'flex'
}

function hideLoading() {
  const overlay = document.getElementById('loading-overlay')
  if (overlay) overlay.style.display = 'none'
}

async function startCamera() {
  cameraBtn.disabled = true
  showLoading('Loading AI models...')
  statusEl.textContent = 'Loading AI models...'

  try {
    // Start camera
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: 1280, height: 720 },
    })
    videoElement = document.createElement('video')
    videoElement.srcObject = cameraStream
    videoElement.muted = true
    videoElement.playsInline = true
    await videoElement.play()

    setVideoElement(videoElement)

    // Load segmentation model (used by both modes)
    showLoading('Loading AI models... This may take a moment.')
    await initSegmentation()

    hideLoading()
    trackEvent('camera_started')
    statusEl.textContent = 'Camera active'
    cameraBtn.textContent = 'Stop Camera'
    cameraBtn.disabled = false
    recordBtn.disabled = supportsWebCodecs() ? false : true

    // Start detection loop
    startDetectionLoop()
  } catch (err) {
    hideLoading()
    const error = err as Error
    console.error('Camera error:', error)

    // Friendly error messages
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      statusEl.textContent = 'Camera permission denied. Please allow camera access and try again.'
    } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      statusEl.textContent = 'No camera found. Please connect a camera and try again.'
    } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      statusEl.textContent = 'Camera is in use by another app. Please close it and try again.'
    } else {
      statusEl.textContent = `Camera error: ${error.message}`
    }
    cameraBtn.disabled = false
  }
}

function stopCamera() {
  if (detectionLoopId !== null) {
    cancelAnimationFrame(detectionLoopId)
    detectionLoopId = null
  }
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop())
    cameraStream = null
  }
  videoElement = null
  setVideoElement(null)
  setPersonMask(null)

  cameraBtn.textContent = 'Camera'
  recordBtn.disabled = true
  statusEl.textContent = ''
}

function startDetectionLoop() {
  function detect() {
    if (!videoElement || !cameraStream) return

    if (isSegmentationReady()) {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const mask = segmentPerson(videoElement, Math.round(rect.width * dpr), Math.round(rect.height * dpr))
      setPersonMask(mask)
      statusEl.textContent = isRecording() ? '● Recording...' : ''
    }

    detectionLoopId = requestAnimationFrame(detect)
  }
  detect()
}

// Record
recordBtn.addEventListener('click', async () => {
  if (!supportsWebCodecs()) {
    statusEl.textContent = 'Recording requires Chrome or Edge browser'
    return
  }

  if (isRecording()) {
    recordBtn.disabled = true
    recordBtn.textContent = 'Saving...'
    await stopRecording()
    trackEvent('recording_saved')
    recordBtn.textContent = 'Record'
    recordBtn.disabled = false
    statusEl.textContent = 'Video saved!'
    setTimeout(() => { if (!isRecording()) statusEl.textContent = '' }, 3000)
  } else {
    await startRecording(getCanvas())
    trackEvent('recording_started')
    recordBtn.textContent = 'Stop'
    statusEl.textContent = '● Recording...'
  }
})
