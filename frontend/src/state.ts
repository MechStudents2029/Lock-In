import { create } from 'zustand'
import {
  api,
  type Envelope,
  type Frame,
  type Payloads,
  type Point,
} from './api'
export type Mode = 'simulation' | 'live'
export interface Entry {
  id: number
  ts: number
  kind: string
  message: string
  simulated: boolean
}
export interface Sample {
  t: number
  fps: number
  latency: number
  cpu?: number
  gpu?: number
  confidence: number | null
  smooth: number | null
  label?: string
  center?: Point
}
export interface Observation {
  id: number
  at: number
  label: string
  confidence: number
  dismissed?: boolean
  reminder?: boolean
}
let sequence = 0
export const frameCache = new Map<number, Frame>()
interface State {
  mode: Mode
  link: string
  privacy: boolean
  data: Partial<Payloads>
  samples: Sample[]
  events: Entry[]
  packets: Envelope[]
  trainingHistory: Payloads['training'][]
  recording: boolean
  session: 'idle' | 'running' | 'paused' | 'stopped'
  since: number
  elapsed: number
  observations: Observation[]
  reminders: boolean
  reminderThreshold: number
  cooldown: number
  setMode: (mode: Mode) => void
  setLink: (link: string) => void
  togglePrivacy: () => void
  ingest: (packet: Envelope) => void
  log: (kind: string, message: string) => void
  control: (action: 'start' | 'pause' | 'stop') => void
  dismiss: (id: number) => void
  clearLive: () => void
}
const event = (
  kind: string,
  message: string,
  simulated: boolean,
  ts = Date.now() / 1000,
) => ({ id: ++sequence, ts, kind, message, simulated })
export const center = (bbox: Frame['detections'][number]['bbox']): Point => [
  (bbox[0] + bbox[2]) / 2,
  (bbox[1] + bbox[3]) / 2,
]
export const useLab = create<State>((set, get) => ({
  mode: 'simulation',
  link: 'offline',
  privacy: false,
  data: {},
  samples: [],
  events: [event('SYSTEM', 'Simulation workspace initialized', true)],
  packets: [],
  trainingHistory: [],
  recording: false,
  session: 'idle',
  since: 0,
  elapsed: 0,
  observations: [],
  reminders: false,
  reminderThreshold: 0.85,
  cooldown: 60,
  setMode: (mode) => {
    if (mode === get().mode) return
    frameCache.clear()
    set({
      mode,
      link: mode === 'live' ? 'connecting' : 'offline',
      data: {},
      samples: [],
      packets: [],
      trainingHistory: [],
      events: [
        event(
          'SYSTEM',
          mode === 'live'
            ? 'Opening local telemetry connection'
            : 'Simulation workspace initialized',
          mode === 'simulation',
        ),
      ],
      session: 'idle',
      elapsed: 0,
      since: 0,
      observations: [],
    })
  },
  setLink: (link) => {
    if (get().link !== link) {
      set({ link })
      if (link !== 'connecting')
        get().log(
          'LINK',
          link === 'connected'
            ? 'Local telemetry connection opened'
            : 'Local backend disconnected; retrying',
        )
    }
  },
  clearLive: () => {
    frameCache.clear()
    set({ data: {}, samples: [] })
  },
  togglePrivacy: () => {
    frameCache.clear()
    const privacy = !get().privacy
    set({
      privacy,
      data: { ...get().data, frame_result: undefined },
      samples: [],
      packets: get().packets.filter((packet) => packet.type !== 'frame_result'),
    })
    get().log(
      'PRIVACY',
      privacy
        ? 'Browser capture and frame display paused'
        : 'Privacy pause released',
    )
  },
  log: (kind, message) =>
    set((s) => ({
      events: [
        event(kind, message, s.mode === 'simulation'),
        ...s.events,
      ].slice(0, 120),
    })),
  control: (action) => {
    const s = get()
    const now = Date.now()
    if (action === 'start' && s.session !== 'running')
      set({
        session: 'running',
        since: now,
        ...(s.session !== 'paused' ? { elapsed: 0, observations: [] } : {}),
      })
    else if (
      s.session === 'running' ||
      (action === 'stop' && s.session === 'paused')
    )
      set({
        session: action === 'pause' ? 'paused' : 'stopped',
        elapsed: s.elapsed + (s.session === 'running' ? now - s.since : 0),
      })
    else return
    s.log(
      'SESSION',
      action === 'start'
        ? 'Focus session started'
        : action === 'pause'
          ? 'Focus session paused'
          : 'Focus session ended',
    )
  },
  dismiss: (id) =>
    set((s) => ({
      observations: s.observations.map((o) =>
        o.id === id ? { ...o, dismissed: true } : o,
      ),
    })),
  ingest: (packet) =>
    set((s) => {
      const simulated = s.mode === 'simulation'
      if (packet.type === 'frame_result' && s.privacy) return s
      if (
        packet.type === 'frame_result' &&
        (packet.data.simulated !== simulated ||
          (!simulated && s.data.camera?.simulated))
      ) {
        if (!s.data.frame_result) return s
        frameCache.clear()
        return {
          data: { ...s.data, frame_result: undefined },
          samples: [],
          packets: s.packets.filter((p) => p.type !== 'frame_result'),
        }
      }
      if (packet.type === 'hardware' && packet.data.simulated !== simulated)
        return { data: { ...s.data, hardware: undefined } }
      const data = { ...s.data, [packet.type]: packet.data }
      let samples = s.samples,
        observations = s.observations,
        events = s.events,
        trainingHistory = s.trainingHistory
      const add = (kind: string, message: string) => {
        events = [event(kind, message, simulated, packet.ts), ...events].slice(
          0,
          120,
        )
      }
      if (packet.type === 'frame_result') {
        const f = packet.data,
          previous = s.data.frame_result,
          previousSample = s.samples.at(-1)
        if (!simulated) {
          frameCache.set(f.frame_id, f)
          if (frameCache.size > 120)
            frameCache.delete(frameCache.keys().next().value!)
        }
        const confidence = f.activity?.confidence ?? null
        const label = f.activity?.label
        const smooth =
          confidence === null
            ? null
            : (f.smoothed_probabilities?.[label ?? ''] ??
              (simulated &&
              previousSample?.label === label &&
              previousSample?.smooth != null
                ? 0.2 * confidence + 0.8 * previousSample.smooth
                : simulated
                  ? confidence
                  : null))
        if (!previousSample || packet.ts - previousSample.t >= 0.23)
          samples = [
            ...samples,
            {
              t: packet.ts,
              fps: f.fps,
              latency: f.inference_ms,
              cpu: data.system?.cpu_percent,
              gpu: data.system?.gpu_util_percent ?? undefined,
              confidence,
              smooth,
              label,
              center:
                f.detections.find((d) => d.label.includes('phone'))?.bbox &&
                center(
                  f.detections.find((d) => d.label.includes('phone'))!.bbox,
                ),
            },
          ].slice(-90)
        if (previous?.model_id !== f.model_id)
          add('MODEL', 'Active model: ' + f.model_id)
        if (previous?.activity?.label !== label)
          add('PREDICTION', label ?? 'Unknown activity')
        if (s.session === 'running') {
          const at = (s.elapsed + Date.now() - s.since) / 1000
          const last = observations.filter((o) => !o.reminder).at(-1)
          if (last?.label !== (label ?? 'Unknown') || !last)
            observations = [
              ...observations,
              {
                id: ++sequence,
                at,
                label: label ?? 'Unknown',
                confidence: confidence ?? 0,
              },
            ]
          const lastReminder = observations.filter((o) => o.reminder).at(-1)
          if (
            s.reminders &&
            /phone/i.test(label ?? '') &&
            (confidence ?? 0) >= s.reminderThreshold &&
            (!lastReminder || at - lastReminder.at >= s.cooldown)
          ) {
            observations = [
              ...observations,
              {
                id: ++sequence,
                at,
                label: 'Phone visible reminder',
                confidence: confidence ?? 0,
                reminder: true,
              },
            ]
            add('REMINDER', 'Phone visible during voluntary session')
          }
        }
      }
      if (packet.type === 'training') {
        const run = packet.data
        trainingHistory = [
          ...trainingHistory.filter(
            (p) => p.run_id !== run.run_id || p.epoch !== run.epoch,
          ),
          run,
        ].slice(-400)
      }
      if (packet.type === 'event')
        add(packet.data.level?.toUpperCase() ?? 'EVENT', packet.data.message)
      if (packet.type === 'serial') add('SERIAL', packet.data.message)
      if (
        packet.type === 'camera' &&
        packet.data.error &&
        packet.data.error !== s.data.camera?.error
      )
        add('CAMERA', packet.data.error)
      if (
        packet.type === 'hardware' &&
        packet.data.state !== s.data.hardware?.state
      )
        add('HARDWARE', 'Arduino ' + packet.data.state)
      if (
        packet.type === 'hardware' &&
        packet.data.last_error &&
        packet.data.last_error !== s.data.hardware?.last_error
      )
        add('SERIAL', packet.data.last_error)
      if (
        packet.type === 'models' &&
        packet.data.active !== s.data.models?.active
      )
        add(
          'MODEL',
          'Active backend model: ' +
            (packet.data.active ?? 'none') +
            (packet.data.models.find((m) => m.id === packet.data.active)
              ?.simulated
              ? ' (mock)'
              : ''),
        )
      if (
        packet.type === 'models' &&
        packet.data.last_error &&
        packet.data.last_error !== s.data.models?.last_error
      )
        add('MODEL', packet.data.last_error)
      return {
        data,
        samples,
        events,
        observations,
        trainingHistory,
        packets:
          packet.type === 'frame_result' && samples === s.samples
            ? s.packets
            : [packet, ...s.packets].slice(0, 80),
      }
    }),
}))
export async function request<T>(path: string, body?: object) {
  const log = useLab.getState().log
  try {
    const result = await api<T>(path, body)
    log('API', (body ? 'POST ' : 'GET ') + path + ' ' + result.status)
    return result.data
  } catch (error) {
    log('ERROR', (body ? 'POST ' : 'GET ') + path + ' ' + String(error))
    throw error
  }
}
export function simulate(tick: number) {
  const s = useLab.getState(),
    ts = Date.now() / 1000
  const send = (packet: Envelope) => s.ingest(packet)
  const wave = Math.sin(tick / 11),
    phone = 0.63 + wave * 0.09,
    hand = 0.6 + Math.sin(tick / 8) * 0.06,
    prob = 0.85 + wave * 0.05
  const phoneVisible = tick % 95 >= 66
  const label = phoneVisible
    ? 'Phone visible'
    : tick % 95 >= 54
      ? 'Intentional break'
      : 'Computer activity'
  send({
    v: 1,
    ts,
    type: 'frame_result',
    data: {
      frame_id: tick,
      capture_ts: ts,
      model_id: 'A / Demo',
      simulated: true,
      device: 'simulation',
      inference_ms: 17.8 + wave * 2,
      fps: 28.4 + wave * 1.3,
      end_to_end_ms: 23 + wave,
      activity: { label, confidence: prob },
      probabilities: { [label]: prob, Unknown: 1 - prob },
      detections: [
        {
          label: 'person',
          confidence: 0.98,
          bbox: [0.27, 0.15, 0.66, 0.93],
          pose: [
            [0.45, 0.25],
            [0.36, 0.4],
            [0.55, 0.4],
            [0.33, 0.62],
            [hand, 0.65],
            [0.4, 0.72],
            [0.52, 0.72],
          ],
          hand: [
            [hand, 0.65],
            [hand + 0.02, 0.63],
            [hand + 0.04, 0.62],
            [hand + 0.05, 0.64],
            [hand + 0.03, 0.67],
          ],
        },
        {
          label: 'phone',
          confidence: 0.93,
          bbox: [phone - 0.035, 0.59, phone + 0.035, 0.75],
        },
      ],
      features: { hand_x: hand, hand_y: 0.65, phone_x: phone, phone_y: 0.67 },
    },
  })
  if (tick % 4 === 0)
    send({
      v: 1,
      ts,
      type: 'system',
      data: {
        cpu_percent: 22 + wave * 5,
        ram_percent: 43,
        gpu_available: true,
        gpu_util_percent: 38 + wave * 8,
        gpu_mem_used_mb: 1480 + wave * 42,
        gpu_mem_total_mb: 8192,
      },
    })
}
