/**
 * Video recorder using mediabunny.
 * Adapted from cavo/src/features/recording/mediaBunnyRecorder.ts
 */

import {
  Output,
  Mp4OutputFormat,
  BufferTarget,
  CanvasSource,
} from 'mediabunny'

const FRAME_RATE = 30
const VIDEO_BITRATE = 10_000_000 // 10 Mbps

let output: Output | null = null
let videoSource: CanvasSource | null = null
let frameInterval: ReturnType<typeof setInterval> | null = null
let startTime = 0
let lastFrameNumber = -1
let readyForMoreFrames = true
let bufferTarget: BufferTarget | null = null

export function isRecording(): boolean {
  return output !== null
}

export async function startRecording(canvas: HTMLCanvasElement): Promise<void> {
  if (output) return

  bufferTarget = new BufferTarget()

  output = new Output({
    format: new Mp4OutputFormat({
      fastStart: 'in-memory',
    }),
    target: bufferTarget,
  })

  videoSource = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: VIDEO_BITRATE,
    latencyMode: 'realtime',
  })
  output.addVideoTrack(videoSource, { frameRate: FRAME_RATE })

  // Yield to let the UI update before the potentially heavy encoder init
  await new Promise(r => requestAnimationFrame(r))
  await output.start()

  startTime = performance.now()
  lastFrameNumber = -1
  readyForMoreFrames = true

  frameInterval = setInterval(captureFrame, 1000 / FRAME_RATE)
}

function captureFrame(): void {
  if (!videoSource || !readyForMoreFrames) return

  const elapsedSeconds = (performance.now() - startTime) / 1000
  const frameNumber = Math.round(elapsedSeconds * FRAME_RATE)

  if (frameNumber === lastFrameNumber) return

  lastFrameNumber = frameNumber
  const timestamp = frameNumber / FRAME_RATE
  const frameDuration = 1 / FRAME_RATE

  readyForMoreFrames = false
  videoSource
    .add(timestamp, frameDuration)
    .then(() => { readyForMoreFrames = true })
    .catch((e) => {
      console.warn('Frame capture error:', e)
      readyForMoreFrames = true
    })
}

export async function stopRecording(): Promise<void> {
  if (!output) return

  if (frameInterval) {
    clearInterval(frameInterval)
    frameInterval = null
  }

  await output.finalize()

  const buffer = bufferTarget!.buffer
  if (!buffer) {
    console.warn('No buffer after finalize')
    output = null
    videoSource = null
    bufferTarget = null
    return
  }

  const blob = new Blob([buffer], { type: 'video/mp4' })

  // Trigger download
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `pretext-video-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.mp4`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)

  output = null
  videoSource = null
  bufferTarget = null
}
