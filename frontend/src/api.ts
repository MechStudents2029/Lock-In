export type Point = [number, number]
export interface Detection {
  label: string
  confidence: number
  bbox: [number, number, number, number]
  track_id?: string
  pose?: Point[]
  hand?: Point[]
}
export interface Frame {
  frame_id: number
  capture_ts: number
  model_id: string
  simulated: boolean
  detections: Detection[]
  activity: { label: string; confidence: number } | null
  inference_ms: number
  end_to_end_ms: number
  fps: number
  device: string
  features?: Record<string, number | null>
  probabilities?: Record<string, number>
  smoothed_probabilities?: Record<string, number>
}
export interface Hardware {
  enabled: boolean
  connected: boolean
  simulated: boolean
  state: string
  estop: boolean
  servos: Record<string, number | null>
  led?: boolean | null
  buzzer?: boolean | null
  last_error?: string | null
  port?: string | null
  requested_angle?: number
  angular_velocity?: number
  target?: Point
}
export interface System {
  cpu_percent: number
  ram_percent: number
  gpu_available: boolean
  gpu_util_percent?: number | null
  gpu_mem_used_mb?: number | null
  gpu_mem_total_mb?: number | null
}
export interface Model {
  id: string
  name: string
  description: string
  simulated: boolean
  available: boolean
  unavailable_reason?: string | null
  loaded: boolean
}
export interface Experiment {
  id: string
  model_id: string
  name: string
  dataset?: string
  metrics: Record<string, number>
  labels?: string[]
  confusion_matrix?: number[][]
}
export interface Training {
  run_id: string
  model_id?: string | null
  state: string
  epoch: number
  total_epochs?: number | null
  metrics: Record<string, number>
  message?: string | null
  checkpoints?: string[]
}
export interface Dataset {
  id: string
  name: string
  source: string
  license: string
  examples: number
  classes: Record<string, number>
  splits: Record<string, number>
  quality?: string
}
export interface Tree {
  feature?: string
  threshold?: number
  vote?: string
  left?: Tree
  right?: Tree
}
export interface Internals {
  trees?: Tree[]
  layers?: { name: string; activations: number[] }[]
  weights?: number[][][]
}
export interface Payloads {
  frame_result: Frame
  system: System
  hardware: Hardware
  models: {
    active: string | null
    loading?: string | null
    last_error?: string | null
    models: Model[]
  }
  camera: {
    source: string
    simulated: boolean
    running: boolean
    width: number
    height: number
    capture_fps: number
    error?: string | null
  }
  recording: { active: boolean; frames: number; dropped: number }
  training: Training
  event: { level?: string; message: string; category?: string }
  experiments: Experiment[]
  datasets: Dataset[]
  internals: Internals
  serial: { message: string }
}
export type Envelope = {
  [K in keyof Payloads]: { v: number; ts: number; type: K; data: Payloads[K] }
}[keyof Payloads]
export interface Routes {
  telemetry: string
  video?: string
  models?: string
  selectModel?: string
  trainingStart?: string
  trainingStop?: string
  experiments?: string
  datasets?: string
  internals?: string
  health?: string
  hardwareStop: string
}
export const origin = 'http://127.0.0.1:8000'
export const routes: Routes = {
  telemetry: '/api/v1/ws/telemetry',
  video: '/api/v1/ws/video',
  models: '/api/v1/models',
  selectModel: '/api/v1/models/select',
  health: '/api/v1/health',
  hardwareStop: '/api/v1/hardware/stop',
  trainingStart: import.meta.env.VITE_TRAINING_START_PATH,
  trainingStop: import.meta.env.VITE_TRAINING_STOP_PATH,
  experiments: import.meta.env.VITE_EXPERIMENTS_PATH,
  datasets: import.meta.env.VITE_DATASETS_PATH,
  internals: import.meta.env.VITE_INTERNALS_PATH,
}
export function localUrl(path: string, socket = false) {
  const url = new URL(path, origin)
  if (url.origin !== origin || url.username || url.password)
    throw Error('Only the local backend is supported')
  if (socket) url.protocol = 'ws:'
  return url.href
}
const types = new Set([
  'frame_result',
  'system',
  'hardware',
  'models',
  'camera',
  'recording',
  'training',
  'event',
  'experiments',
  'datasets',
  'internals',
  'serial',
])
export function decode(raw: string): Envelope {
  const value = JSON.parse(raw)
  if (
    value?.v !== 1 ||
    !types.has(value.type) ||
    !Number.isFinite(value.ts) ||
    !value.data ||
    typeof value.data !== 'object'
  )
    throw Error('Invalid v1 telemetry envelope')
  const d = value.data
  if (
    value.type === 'frame_result' &&
    (!Array.isArray(d.detections) ||
      typeof d.simulated !== 'boolean' ||
      !Number.isFinite(d.frame_id) ||
      !Number.isFinite(d.inference_ms) ||
      !Number.isFinite(d.fps) ||
      d.detections.some(
        (box: Detection) =>
          !box ||
          typeof box.label !== 'string' ||
          !Number.isFinite(box.confidence) ||
          !Array.isArray(box.bbox) ||
          box.bbox.length !== 4 ||
          !box.bbox.every(Number.isFinite),
      ))
  )
    throw Error('Invalid frame result')
  if (value.type === 'models' && !Array.isArray(d.models))
    throw Error('Invalid model list')
  if (
    value.type === 'training' &&
    (!d.metrics || typeof d.run_id !== 'string' || !Number.isFinite(d.epoch))
  )
    throw Error('Invalid training update')
  if (['experiments', 'datasets'].includes(value.type) && !Array.isArray(d))
    throw Error('Invalid research catalog')
  return value
}
export function connect(
  path: string,
  onMessage: (event: Envelope) => void,
  onStatus: (status: 'connecting' | 'connected' | 'disconnected') => void,
  onError: (error: string) => void,
) {
  let socket: WebSocket | undefined,
    timer: number | undefined,
    closed = false,
    delay = 600
  function open() {
    onStatus('connecting')
    socket = new WebSocket(localUrl(path, true))
    socket.onopen = () => {
      delay = 600
      onStatus('connected')
    }
    socket.onmessage = ({ data }) => {
      try {
        onMessage(decode(data))
      } catch (error) {
        onError(String(error))
      }
    }
    socket.onclose = () => {
      if (closed) return
      onStatus('disconnected')
      timer = window.setTimeout(open, delay)
      delay = Math.min(delay * 2, 10000)
    }
  }
  open()
  return () => {
    closed = true
    clearTimeout(timer)
    socket?.close()
  }
}
export async function api<T>(
  path: string,
  body?: object,
): Promise<{ data: T; status: number }> {
  const response = await fetch(localUrl(path), {
    redirect: 'error',
    credentials: 'omit',
    signal: AbortSignal.timeout(6000),
    ...(body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw Error(
      'HTTP ' +
        response.status +
        (typeof error?.detail === 'string' ? ' · ' + error.detail : ''),
    )
  }
  return { data: await response.json(), status: response.status }
}
