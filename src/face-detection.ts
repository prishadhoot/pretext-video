import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import type { Point } from './types'

let faceLandmarker: FaceLandmarker | null = null
let loading = false

// Face oval contour landmark indices (36 points)
const FACE_OVAL_INDICES = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
  397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
]

// Temporal smoothing
let smoothedPolygon: Point[] | null = null
const SMOOTH_ALPHA = 0.3

export async function initFaceDetection(): Promise<void> {
  if (faceLandmarker || loading) return
  loading = true

  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
  )

  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numFaces: 1,
  })

  loading = false
}

export function detectFace(video: HTMLVideoElement, canvasWidth: number, canvasHeight: number): Point[] | null {
  if (!faceLandmarker || video.readyState < 2) return null

  const result = faceLandmarker.detectForVideo(video, performance.now())
  if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
    smoothedPolygon = null
    return null
  }

  const landmarks = result.faceLandmarks[0]
  const rawPolygon: Point[] = FACE_OVAL_INDICES.map(i => ({
    x: landmarks[i].x * canvasWidth,
    y: landmarks[i].y * canvasHeight,
  }))

  return smoothContour(rawPolygon)
}

function smoothContour(newPoints: Point[]): Point[] {
  if (!smoothedPolygon || smoothedPolygon.length !== newPoints.length) {
    smoothedPolygon = newPoints.map(p => ({ ...p }))
    return smoothedPolygon
  }
  for (let i = 0; i < newPoints.length; i++) {
    smoothedPolygon[i].x += (newPoints[i].x - smoothedPolygon[i].x) * SMOOTH_ALPHA
    smoothedPolygon[i].y += (newPoints[i].y - smoothedPolygon[i].y) * SMOOTH_ALPHA
  }
  return smoothedPolygon
}

export function isFaceDetectionReady(): boolean {
  return faceLandmarker !== null
}
