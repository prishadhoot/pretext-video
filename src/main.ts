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

let videoElement: HTMLVideoElement | null = null
let cameraStream: MediaStream | null = null
let detectionLoopId: number | null = null

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

// Init renderer
initRenderer(canvas)
setTextKey(defaultTextKey)
setFontSize(parseInt(fontSizeSlider.value))
startRenderLoop()

// Mode select
modeSelect.addEventListener('change', () => {
  setMode(modeSelect.value as AppMode)
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

async function startCamera() {
  cameraBtn.disabled = true
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
    await initSegmentation()

    statusEl.textContent = 'Camera active'
    cameraBtn.textContent = 'Stop Camera'
    cameraBtn.disabled = false
    recordBtn.disabled = false

    // Start detection loop
    startDetectionLoop()
  } catch (err) {
    console.error('Camera error:', err)
    statusEl.textContent = `Camera error: ${(err as Error).message}`
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

  cameraBtn.textContent = 'Start Camera'
  recordBtn.disabled = true
  statusEl.textContent = 'Camera stopped'
}

function startDetectionLoop() {
  function detect() {
    if (!videoElement || !cameraStream) return

    if (isSegmentationReady()) {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const mask = segmentPerson(videoElement, Math.round(rect.width * dpr), Math.round(rect.height * dpr))
      setPersonMask(mask)
      statusEl.textContent = isRecording() ? '● Recording...' : 'Camera active'
    }

    detectionLoopId = requestAnimationFrame(detect)
  }
  detect()
}

// Record
recordBtn.addEventListener('click', async () => {
  if (isRecording()) {
    recordBtn.disabled = true
    recordBtn.textContent = 'Saving...'
    await stopRecording()
    recordBtn.textContent = 'Record'
    recordBtn.disabled = false
    statusEl.textContent = 'Video saved!'
  } else {
    await startRecording(getCanvas())
    recordBtn.textContent = 'Stop Recording'
    statusEl.textContent = '● Recording...'
  }
})
