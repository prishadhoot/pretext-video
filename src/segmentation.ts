import { ImageSegmenter, FilesetResolver } from '@mediapipe/tasks-vision'

let segmenter: ImageSegmenter | null = null
let loading = false

export async function initSegmentation(): Promise<void> {
  if (segmenter || loading) return
  loading = true

  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
  )

  segmenter = await ImageSegmenter.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  })

  loading = false
}

/**
 * Segment person from video frame.
 * Returns an ImageData with alpha channel set by the confidence mask,
 * sized to match the canvas (not the video).
 */
export function segmentPerson(
  video: HTMLVideoElement,
  canvasWidth: number,
  canvasHeight: number,
): ImageData | null {
  if (!segmenter || video.readyState < 2) return null

  const result = segmenter.segmentForVideo(video, performance.now())
  if (!result.confidenceMasks || result.confidenceMasks.length === 0) return null

  const mask = result.confidenceMasks[0]
  const maskData = mask.getAsFloat32Array()
  const mw = mask.width
  const mh = mask.height

  // Create ImageData at canvas resolution with alpha from mask
  const imageData = new ImageData(canvasWidth, canvasHeight)
  const pixels = imageData.data

  for (let y = 0; y < canvasHeight; y++) {
    for (let x = 0; x < canvasWidth; x++) {
      const mx = Math.floor((x / canvasWidth) * mw)
      const my = Math.floor((y / canvasHeight) * mh)
      const confidence = maskData[my * mw + mx]
      const idx = (y * canvasWidth + x) * 4
      // White pixel with alpha from confidence
      pixels[idx] = 255
      pixels[idx + 1] = 255
      pixels[idx + 2] = 255
      pixels[idx + 3] = Math.round(confidence * 255)
    }
  }

  mask.close()
  return imageData
}

export function isSegmentationReady(): boolean {
  return segmenter !== null
}
