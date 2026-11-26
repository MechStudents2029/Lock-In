import { useEffect, useRef, useState } from 'react'
import {
  Camera,
  CameraOff,
  Crosshair,
  Expand,
  ScanLine,
  Snowflake,
} from 'lucide-react'

import { localUrl, routes, type Frame, type Point } from './api'
import { center, frameCache, useLab } from './state'
import {
  Chart,
  color,
  Empty,
  fmt,
  Heading,
  Panel,
  pct,
  SourceBadge,
  Status,
} from './ui'
export const layers = [
  'Boxes',
  'Confidence',
  'Centers',
  'Pose',
  'Hands',
  'Distance',
  'Trails',
] as const
type Layer = (typeof layers)[number]
const allLayers = new Set<Layer>(layers)
const W = 640,
  H = 480
const xy = (p: Point): Point => [p[0] * W, p[1] * H]
export function coordinates(frame?: Frame) {
  const f = frame?.features
  if (
    f &&
    [f.hand_x, f.hand_y, f.phone_x, f.phone_y].every(
      (n) => typeof n === 'number' && Number.isFinite(n),
    )
  )
    return {
      hand: [f.hand_x!, f.hand_y!] as Point,
      phone: [f.phone_x!, f.phone_y!] as Point,
    }
  if (
    f &&
    [
      f.hand_center_x_norm,
      f.hand_center_y_norm,
      f.phone_center_x_norm,
      f.phone_center_y_norm,
    ].every((n) => typeof n === 'number' && Number.isFinite(n))
  )
    return {
      hand: [f.hand_center_x_norm!, f.hand_center_y_norm!] as Point,
      phone: [f.phone_center_x_norm!, f.phone_center_y_norm!] as Point,
    }
  const hand = frame?.detections.find((d) => d.hand?.length)?.hand?.[0],
    phone = frame?.detections.find((d) => /phone/i.test(d.label))
  return hand && phone ? { hand, phone: center(phone.bbox) } : undefined
}
function Scene() {
  return (
    <svg
      className="scene"
      viewBox="0 0 640 480"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <pattern id="wall" width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M32 0H0V32" fill="none" stroke="#25333b" strokeWidth=".7" />
        </pattern>
        <pattern id="rug" width="6" height="6" patternUnits="userSpaceOnUse">
          <path d="M0 6L6 0" stroke="#2b4044" strokeWidth=".6" />
        </pattern>
      </defs>
      <path fill="#141e24" d="M0 0h640v480H0z" />
      <path fill="url(#wall)" d="M0 0h640v350H0z" />
      <path fill="#0d151b" d="M0 242l640 12v226H0z" />
      <path fill="#223035" stroke="#35484e" d="M0 300l640-4v122L0 452z" />
      <path fill="url(#rug)" d="M0 300l640-4v122L0 452z" />
      <path
        fill="#131b20"
        stroke="#39515a"
        d="M27 80h143v115H27zM43 94h111v85H43z"
      />
      <path
        stroke="#365c5e"
        fill="none"
        d="M50 153l20-9 12 8 17-27 19 9 27-19"
      />
      <path
        fill="#18262e"
        stroke="#486069"
        d="M459 118h150v105H459zM466 126h136v87H466z"
      />
      <path
        stroke="#36565b"
        d="M480 143h55m-55 12h35m-35 13h73m-73 13h43m-43 13h88"
      />
      <path
        fill="#152226"
        stroke="#455859"
        d="M530 223v57h-33v9h78v-9h-32v-57M463 307l134 1 19 21-159-3z"
      />
      <path
        fill="#202c32"
        stroke="#3c515a"
        d="M181 250q2-71 41-60l153 22 18 160-189 16z"
      />
      <path
        fill="#2c4346"
        stroke="#55716e"
        d="M244 191q48-22 97 0l14 57 45 41-18 35-67-27 24 56-100 19-42-53 12-85z"
      />
      <ellipse
        cx="291"
        cy="137"
        rx="39"
        ry="55"
        fill="#52615b"
        stroke="#718579"
      />
      <path
        fill="#27363a"
        d="M252 138q-10-75 51-58 36 9 27 49-16-23-35-20-22 21-43 29z"
      />
      <path
        stroke="#526e6d"
        fill="none"
        d="M239 212l-15 93 102 38M333 212l25 62 39 17"
      />
      <path
        fill="#162529"
        stroke="#4c6364"
        d="M235 372l103-19 74 46-13 59-42 3-26-55-45 23-66-16z"
      />
      <path
        fill="#18252a"
        stroke="#435659"
        d="M95 328l82 5 18 39-109-8zM503 343l105-8 13 34-118 12z"
      />
    </svg>
  )
}
export function Viewport({
  compact = false,
  active = allLayers,
  threshold = 0.35,
}: {
  compact?: boolean
  active?: Set<Layer>
  threshold?: number
}) {
  const { data, mode, privacy, samples, link, log } = useLab()
  const video = useRef<HTMLVideoElement>(null),
    root = useRef<HTMLDivElement>(null),
    image = useRef<HTMLImageElement>(null),
    stream = useRef<MediaStream | null>(null)
  const [preview, setPreview] = useState(false),
    [videoReady, setVideoReady] = useState(false),
    [videoFrame, setVideoFrame] = useState<{ id: number; url: string } | null>(
      null,
    ),
    [error, setError] = useState(''),
    [inspect, setInspect] = useState<{ frame?: Frame; image?: string } | null>(
      null,
    ),
    [selected, select] = useState<number | null>(null)
  useEffect(() => {
    if (!preview || privacy) return
    let gone = false
    if (!navigator.mediaDevices) {
      setError('Browser camera access requires a local secure context')
      setPreview(false)
      return
    }
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: false })
      .then((s) => {
        if (gone) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream.current = s
        if (video.current) video.current.srcObject = s
        setError('')
      })
      .catch((e) => {
        if (!gone) {
          setError(String(e))
          log('CAMERA', String(e))
          setPreview(false)
        }
      })
    return () => {
      gone = true
      stream.current?.getTracks().forEach((t) => t.stop())
      stream.current = null
    }
  }, [preview, privacy, log])
  useEffect(() => {
    if (privacy) {
      setPreview(false)
      setInspect(null)
      select(null)
    }
  }, [privacy])
  useEffect(() => {
    setInspect(null)
    select(null)
  }, [mode, link])
  const backendVideo =
    mode === 'live' &&
    !privacy &&
    !preview &&
    link === 'connected' &&
    data.camera?.running &&
    !data.camera.simulated
      ? routes.video
      : undefined
  useEffect(() => {
    setVideoFrame(null)
    setVideoReady(false)
    if (!backendVideo) return
    let url: string | undefined,
      timer: number | undefined,
      socket: WebSocket | undefined,
      finished = false
    function open() {
      socket = new WebSocket(localUrl(backendVideo!, true))
      socket.binaryType = 'arraybuffer'
      socket.onopen = () => setError('')
      socket.onmessage = (e) => {
        if (
          finished ||
          !(e.data instanceof ArrayBuffer) ||
          e.data.byteLength <= 4
        )
          return
        const id = new DataView(e.data).getUint32(0),
          next = URL.createObjectURL(
            new Blob([e.data.slice(4)], { type: 'image/jpeg' }),
          )
        if (url) URL.revokeObjectURL(url)
        url = next
        setVideoFrame({ id, url: next })
      }
      socket.onclose = () => {
        if (finished) return
        setVideoReady(false)
        setVideoFrame(null)
        setError('Local video connection closed')
        log('CAMERA', 'Local video connection closed')
        timer = window.setTimeout(open, 1500)
      }
    }
    open()
    return () => {
      finished = true
      clearTimeout(timer)
      socket?.close()
      if (url) URL.revokeObjectURL(url)
    }
  }, [backendVideo, log])
  const frame =
    privacy || (preview && !inspect)
      ? undefined
      : inspect
        ? inspect.frame
        : mode === 'simulation'
          ? data.frame_result
          : videoFrame
            ? frameCache.get(videoFrame.id)
            : data.frame_result
  const pair = coordinates(frame)
  const trail = samples
    .filter((s) => !inspect?.frame || s.t <= inspect.frame.capture_ts)
    .flatMap((s) => (s.center ? [xy(s.center)] : []))
    .slice(-24)
  const aligned =
    !preview &&
    (mode === 'simulation' ||
      Boolean(inspect?.image || (backendVideo && videoReady)))
  const box = selected === null ? undefined : frame?.detections[selected]
  const freeze = () => {
    if (inspect) {
      setInspect(null)
      return
    }
    const source = preview ? video.current : videoReady ? image.current : null
    if (!source && mode === 'live') {
      setInspect({ frame })
      return
    }
    if (
      source &&
      ((source instanceof HTMLVideoElement && source.readyState >= 2) ||
        (source instanceof HTMLImageElement &&
          source.complete &&
          source.naturalWidth))
    ) {
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      canvas.getContext('2d')?.drawImage(source, 0, 0, W, H)
      setInspect({ frame, image: canvas.toDataURL('image/jpeg') })
    } else if (frame) setInspect({ frame })
  }
  return (
    <div ref={root} className={'vision ' + (compact ? 'compact' : '')}>
      <div className="view-stage">
        {!privacy && mode === 'simulation' && !preview && <Scene />}
        {backendVideo && videoFrame && (
          <img
            ref={image}
            className="video"
            src={videoFrame.url}
            alt="Local backend camera"
            onLoad={() => setVideoReady(true)}
            onError={() => {
              setVideoReady(false)
              setError('Local backend video unavailable')
              log('CAMERA', 'Local backend video unavailable')
            }}
          />
        )}
        {preview && !privacy && (
          <video className="video" ref={video} autoPlay playsInline muted />
        )}
        {!privacy && inspect?.image && (
          <img className="video" src={inspect.image} alt="Inspected frame" />
        )}
        {(privacy ||
          (!preview && mode === 'live' && !videoReady && !inspect?.image)) && (
          <div className="camera-empty">
            <CameraOff size={25} />
            <strong>
              {privacy
                ? 'Privacy pause'
                : data.camera?.simulated
                  ? 'Backend synthetic camera'
                  : link === 'connected'
                    ? 'Backend video unavailable'
                    : 'Camera offline'}
            </strong>
            <small>
              {privacy
                ? 'Browser capture is paused'
                : preview
                  ? 'Opening camera'
                  : 'Local camera stream'}
            </small>
          </div>
        )}
        {aligned && !privacy && frame && (
          <svg
            className="overlay"
            viewBox="0 0 640 480"
            preserveAspectRatio="none"
            aria-label="Detection overlays"
          >
            {active.has('Trails') && trail.length > 1 && (
              <polyline
                points={trail.map((p) => p.join(',')).join(' ')}
                fill="none"
                stroke="#55cedd"
                strokeWidth="2"
                opacity=".6"
              />
            )}
            {frame.detections.map((d, i) => {
              if (d.confidence < threshold) return null
              const [x1, y1, x2, y2] = [
                d.bbox[0] * W,
                d.bbox[1] * H,
                d.bbox[2] * W,
                d.bbox[3] * H,
              ]
              const [cx, cy] = xy(center(d.bbox)),
                c = d.label === 'person' ? color.green : color.cyan
              const poseEdges =
                d.pose?.length === 17
                  ? [
                      [0, 1],
                      [0, 2],
                      [1, 3],
                      [2, 4],
                      [5, 6],
                      [5, 7],
                      [7, 9],
                      [6, 8],
                      [8, 10],
                      [5, 11],
                      [6, 12],
                      [11, 12],
                      [11, 13],
                      [13, 15],
                      [12, 14],
                      [14, 16],
                    ]
                  : [
                      [0, 1],
                      [0, 2],
                      [1, 2],
                      [1, 3],
                      [2, 4],
                      [1, 5],
                      [2, 6],
                      [5, 6],
                    ]
              return (
                <g key={i}>
                  {active.has('Pose') && d.pose && (
                    <g stroke={color.green} opacity=".7">
                      {poseEdges.map(([a, b]) => {
                        const p = d.pose?.[a],
                          q = d.pose?.[b]
                        return p && q ? (
                          <line
                            key={a + '-' + b}
                            x1={xy(p)[0]}
                            y1={xy(p)[1]}
                            x2={xy(q)[0]}
                            y2={xy(q)[1]}
                          />
                        ) : null
                      })}
                      {d.pose.map((p, j) => (
                        <circle
                          key={j}
                          cx={xy(p)[0]}
                          cy={xy(p)[1]}
                          r="3"
                          fill={color.green}
                        />
                      ))}
                    </g>
                  )}
                  {active.has('Hands') && d.hand && (
                    <g stroke={color.amber}>
                      {(d.hand.length === 21
                        ? [
                            [0, 1, 2, 3, 4],
                            [0, 5, 6, 7, 8],
                            [0, 9, 10, 11, 12],
                            [0, 13, 14, 15, 16],
                            [0, 17, 18, 19, 20],
                          ]
                        : [d.hand.map((_, i) => i)]
                      ).map((chain, j) => (
                        <polyline
                          key={j}
                          points={chain
                            .map((k) => xy(d.hand![k]).join(','))
                            .join(' ')}
                          fill="none"
                        />
                      ))}
                      {d.hand.map((p, j) => (
                        <circle
                          key={j}
                          cx={xy(p)[0]}
                          cy={xy(p)[1]}
                          r="3"
                          fill={color.amber}
                        />
                      ))}
                    </g>
                  )}
                  {active.has('Boxes') && (
                    <rect
                      tabIndex={compact ? undefined : 0}
                      role={compact ? undefined : 'button'}
                      aria-label={'Inspect ' + d.label}
                      onClick={() => !compact && select(i)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          select(i)
                        }
                      }}
                      x={x1}
                      y={y1}
                      width={x2 - x1}
                      height={y2 - y1}
                      fill={selected === i ? '#ffffff18' : 'transparent'}
                      stroke={c}
                      strokeWidth={selected === i ? 3 : 1.5}
                    />
                  )}
                  {active.has('Boxes') && (
                    <g pointerEvents="none">
                      <rect
                        x={x1}
                        y={Math.max(0, y1 - 24)}
                        width={active.has('Confidence') ? 125 : 72}
                        height="24"
                        fill={c}
                      />
                      <text
                        x={x1 + 6}
                        y={Math.max(16, y1 - 8)}
                        fill="#101810"
                        fontSize="13"
                      >
                        {d.label}{' '}
                        {active.has('Confidence') ? pct(d.confidence) : ''}
                      </text>
                    </g>
                  )}
                  {active.has('Centers') && (
                    <path
                      d={'M' + (cx - 5) + ' ' + cy + 'h10m-5 -5v10'}
                      stroke={c}
                    />
                  )}
                </g>
              )
            })}
            {active.has('Distance') && pair && (
              <line
                x1={xy(pair.hand)[0]}
                y1={xy(pair.hand)[1]}
                x2={xy(pair.phone)[0]}
                y2={xy(pair.phone)[1]}
                stroke={color.amber}
                strokeDasharray="4 3"
                strokeWidth="2"
              />
            )}
          </svg>
        )}
        <div className="view-label">
          <ScanLine size={13} />
          {privacy
            ? 'PRIVATE'
            : preview
              ? 'BROWSER PREVIEW'
              : mode === 'simulation'
                ? 'SIMULATED FRAME'
                : data.camera?.simulated
                  ? 'BACKEND SYNTHETIC FEED'
                  : 'LOCAL FEED'}
        </div>
        {frame && (
          <div className="frame-id">
            FRAME {String(frame.frame_id).padStart(5, '0')}
          </div>
        )}
      </div>
      {!compact && (
        <div className="view-footer">
          <button
            onClick={() => {
              setInspect(null)
              setPreview(!preview)
              setError('')
            }}
            disabled={privacy}
          >
            <Camera size={15} />
            {preview ? 'Close webcam' : 'Open local webcam'}
          </button>
          <button
            onClick={freeze}
            disabled={privacy || (!frame && !preview && !videoReady)}
          >
            <Snowflake size={15} />
            {inspect ? 'Resume frames' : 'Inspect frame'}
          </button>
          <button
            aria-label="Toggle fullscreen"
            onClick={() => {
              const task = document.fullscreenElement
                ? document.exitFullscreen()
                : root.current?.requestFullscreen()
              void task?.catch((e) => setError(String(e)))
            }}
          >
            <Expand size={15} />
          </button>
        </div>
      )}
      {!compact && (error || preview || box) && (
        <div className="view-inspect">
          {error && <p role="alert">{error}</p>}
          {preview && (
            <p>
              Browser webcam preview uses a separate capture source. Detection
              overlays are disabled here.
            </p>
          )}
          {box && (
            <>
              <strong>
                {box.label} · {pct(box.confidence)}
              </strong>
              <p>
                Center (
                {center(box.bbox)
                  .map((n) => fmt(n, 3))
                  .join(', ')}
                ) · box [{box.bbox.map((n) => fmt(n, 3)).join(', ')}]
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
export default function Vision() {
  const [threshold, setThreshold] = useState(0.35),
    [visible, setVisible] = useState(new Set(allLayers))
  const { data, samples } = useLab()
  const detections = data.frame_result?.detections.filter(
    (d) => d.confidence >= threshold,
  )
  return (
    <>
      <Heading
        index="02 / OBSERVATION"
        title="Live Vision"
        description="Inspect camera frames, model detections, and inference performance."
      >
        <SourceBadge />
      </Heading>
      <div className="split vision-layout">
        <Panel
          title="Camera viewport"
          action={
            <Status>
              {data.camera?.simulated
                ? 'Backend synthetic camera'
                : data.camera?.running
                  ? 'Camera running'
                  : 'Camera disconnected'}
            </Status>
          }
        >
          <Viewport active={visible} threshold={threshold} />
        </Panel>
        <div className="stack">
          <Panel title="Visualization layers" action={<Crosshair size={16} />}>
            <div className="form">
              <label>
                Confidence threshold <output>{pct(threshold)}</output>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step=".01"
                  value={threshold}
                  onChange={(e) => setThreshold(+e.target.value)}
                />
              </label>
              <div className="checks">
                {layers.map((l) => (
                  <label key={l}>
                    <input
                      type="checkbox"
                      checked={visible.has(l)}
                      onChange={(e) =>
                        setVisible((s) => {
                          const next = new Set(s)
                          if (e.target.checked) next.add(l)
                          else next.delete(l)
                          return next
                        })
                      }
                    />
                    {l}
                  </label>
                ))}
              </div>
            </div>
          </Panel>
          <Panel title="Detected objects">
            {detections?.length ? (
              <div className="records">
                {detections.map((d, i) => (
                  <div key={i}>
                    <strong>{d.label}</strong>
                    <span>
                      {center(d.bbox)
                        .map((n) => fmt(n, 2))
                        .join(', ')}
                    </span>
                    <b>{pct(d.confidence)}</b>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>No detections above the selected threshold</Empty>
            )}
          </Panel>
        </div>
      </div>
      <Panel title="Inference performance" className="spaced">
        <Chart
          data={samples}
          lines={[
            { key: 'fps', label: 'Frames / s', color: color.green },
            { key: 'latency', label: 'Inference ms', color: color.cyan },
          ]}
          clock
        />
      </Panel>
    </>
  )
}
