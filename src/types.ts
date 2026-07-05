export type Point = { x: number; y: number }

export type Interval = { left: number; right: number }

export type LayoutSegment = Interval & { width: number }

export type PositionedLine = {
  text: string
  x: number
  y: number
  width: number       // actual measured text width
  slotWidth?: number  // available slot width (for centering)
}

export type AppMode = 'textface' | 'cutout'

export type AppState = {
  mode: AppMode
  fontSize: number
  lineHeight: number
  font: string
  textKey: string
  cameraActive: boolean
  recording: boolean
}
