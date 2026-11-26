import { useEffect, useRef, useState } from 'react'
import {
  Bell,
  Download,
  OctagonAlert,
  Radio,
  RotateCcw,
  Target,
  Terminal,
  Trash2,
  Video,
} from 'lucide-react'
import { localUrl, routes } from './api'
import { SessionActions, SessionClock } from './Mission'
import { request, useLab } from './state'
import {
  duration,
  Empty,
  fmt,
  Heading,
  Panel,
  pct,
  Status,
  Timeline,
} from './ui'
export function Robotics() {
  const { mode, data, events, log, link } = useLab()
  const sim = mode === 'simulation'
  const [stopping, setStopping] = useState(false),
    [stopError, setStopError] = useState('')
  const [angle, setAngle] = useState(90),
    [target, setTarget] = useState(115),
    [stop, setStop] = useState(false),
    [led, setLed] = useState(false),
    [buzz, setBuzz] = useState(false)
  useEffect(() => {
    if (!sim || stop) return
    const id = setInterval(
      () =>
        setAngle(
          (a) => a + Math.sign(target - a) * Math.min(2, Math.abs(target - a)),
        ),
      50,
    )
    return () => clearInterval(id)
  }, [sim, stop, target])
  useEffect(() => {
    if (!buzz) return
    const id = setTimeout(() => setBuzz(false), 650)
    return () => clearTimeout(id)
  }, [buzz])
  const hardware = data.hardware,
    measured = sim
      ? angle
      : hardware?.connected
        ? hardware.servos?.pan
        : undefined,
    requested = sim ? target : hardware?.requested_angle
  const velocity = sim
    ? stop
      ? 0
      : Math.sign(target - angle) * Math.min(40, Math.abs(target - angle) * 20)
    : hardware?.angular_velocity
  const pos = (a: number, r: number) => [
    280 + Math.cos(((180 - a) * Math.PI) / 180) * r,
    261 - Math.sin(((180 - a) * Math.PI) / 180) * r,
  ]
  const path = (r: number, a = 0, b = 180) => {
    const [x, y] = pos(a, r),
      [u, v] = pos(b, r)
    return 'M' + x + ' ' + y + 'A' + r + ' ' + r + ' 0 0 1 ' + u + ' ' + v
  }
  const activeStop = sim ? stop : hardware?.estop
  async function emergencyStop() {
    if (sim) {
      setStop(true)
      setLed(false)
      setBuzz(false)
      log('SERIAL', 'Simulation emergency stop latched')
      return
    }
    setStopping(true)
    setStopError('')
    try {
      const result = await request<{
        ok: boolean
        detail?: string
        status: NonNullable<typeof hardware>
      }>(routes.hardwareStop, {})
      if (useLab.getState().mode === 'live')
        useLab
          .getState()
          .ingest({
            v: 1,
            ts: Date.now() / 1000,
            type: 'hardware',
            data: result.status,
          })
      if (!result.ok)
        setStopError(
          result.detail ?? 'The Arduino did not acknowledge the stop command',
        )
    } catch (e) {
      setStopError(String(e))
    } finally {
      setStopping(false)
    }
  }
  const serial = events.filter(
    (e) => e.kind === 'SERIAL' || e.kind === 'HARDWARE',
  )
  return (
    <>
      <Heading
        index="06 / HARDWARE"
        title="Robotics Control"
        description="Inspect the camera mount through a two-dimensional servo and field-of-view model."
      >
        <Status tone={sim ? 'amber' : 'cyan'}>
          {sim ? 'HARDWARE SIMULATION' : 'LIVE HARDWARE'}
        </Status>
      </Heading>
      <div className="split mission-top">
        <Panel
          title="Camera mount digital twin"
          caption="Pan axis · top-down view"
          action={<Target size={17} />}
        >
          <div className="inset">
            <svg
              className="scientific-svg"
              viewBox="0 0 560 330"
              aria-label="180-degree servo and camera field of view"
            >
              {[48, 100, 152, 208].map((r) => (
                <path
                  key={r}
                  d={path(r)}
                  stroke="#34424f"
                  fill="none"
                  strokeDasharray={r === 208 ? '' : '3 5'}
                />
              ))}
              {[0, 30, 60, 90, 120, 150, 180].map((a) => {
                const [x, y] = pos(a, 208),
                  [u, v] = pos(a, 231)
                return (
                  <g key={a}>
                    <line x1="280" y1="261" x2={x} y2={y} stroke="#28343e" />
                    <text x={u} y={v + 4} textAnchor="middle">
                      {a}°
                    </text>
                  </g>
                )
              })}
              {measured != null &&
                (() => {
                  const [ax, ay] = pos(Math.max(0, measured - 28), 175),
                    [bx, by] = pos(Math.min(180, measured + 28), 175),
                    [x, y] = pos(measured, 126)
                  return (
                    <>
                      <path
                        d={
                          'M280 261L' +
                          ax +
                          ' ' +
                          ay +
                          ' A175 175 0 0 1 ' +
                          bx +
                          ' ' +
                          by +
                          'Z'
                        }
                        fill="#54cde01e"
                        stroke="#54cde0"
                      />
                      <line
                        x1="280"
                        y1="261"
                        x2={x}
                        y2={y}
                        stroke="#54cde0"
                        strokeWidth="2"
                      />
                    </>
                  )
                })()}
              {requested != null &&
                (() => {
                  const [x, y] = pos(requested, 191)
                  return (
                    <g stroke="#b3f665">
                      <line
                        x1="280"
                        y1="261"
                        x2={x}
                        y2={y}
                        strokeDasharray="3 5"
                      />
                      <circle cx={x} cy={y} r="6" fill="#0e1319" />
                    </g>
                  )
                })()}
              <circle
                cx="280"
                cy="261"
                r="24"
                fill="#172630"
                stroke="#55717e"
              />
              <circle cx="280" cy="261" r="9" fill="#54cde0" />
              <text x="280" y="314" textAnchor="middle">
                {measured == null
                  ? 'Awaiting acknowledged angle'
                  : (sim ? 'Simulated angle ' : 'Acknowledged angle ') +
                    fmt(measured, 0) +
                    '°'}
              </text>
            </svg>
          </div>
        </Panel>
        <Panel
          title="Pan controls"
          action={
            <Status tone={hardware?.connected ? 'green' : 'neutral'}>
              {hardware?.state ?? 'Arduino disconnected'}
            </Status>
          }
        >
          <div className="form">
            <label>
              Requested angle{' '}
              <output>
                {requested == null ? '—' : fmt(requested, 0) + '°'}
              </output>
              <input
                type="range"
                min="0"
                max="180"
                value={target}
                disabled={!sim || stop}
                onChange={(e) => setTarget(+e.target.value)}
                onPointerUp={() =>
                  log('SERIAL', 'Simulated pan target: ' + target + '°')
                }
                onKeyUp={(e) => {
                  if (e.key.startsWith('Arrow'))
                    log('SERIAL', 'Simulated pan target: ' + target + '°')
                }}
              />
            </label>
            <div className="measurements">
              <div>
                <span>Angular velocity</span>
                <b>{velocity == null ? '—' : fmt(velocity, 0) + '°/s'}</b>
              </div>
              <div>
                <span>Position error</span>
                <b>
                  {measured == null || requested == null
                    ? '—'
                    : fmt(requested - measured, 0) + '°'}
                </b>
              </div>
              <div>
                <span>Target position</span>
                <b>
                  {hardware?.target?.join(', ') ?? (sim ? target + '°' : '—')}
                </b>
              </div>
              <div>
                <span>Camera field of view</span>
                <b>{sim ? '56° (planned)' : 'Calibration unavailable'}</b>
              </div>
              <div>
                <span>LED</span>
                <b>
                  {(sim ? led : hardware?.led) == null
                    ? 'Unknown'
                    : (sim ? led : hardware?.led)
                      ? 'On'
                      : 'Off'}
                </b>
              </div>
              <div>
                <span>Buzzer</span>
                <b>
                  {(sim ? buzz : hardware?.buzzer) == null
                    ? 'Unknown'
                    : (sim ? buzz : hardware?.buzzer)
                      ? 'On'
                      : 'Off'}
                </b>
              </div>
            </div>
            <div className="actions">
              <button
                disabled={!sim || stop}
                onClick={() => {
                  setLed(!led)
                  log('SERIAL', 'Simulated LED ' + (led ? 'off' : 'on'))
                }}
              >
                Toggle LED
              </button>
              <button
                disabled={!sim || stop}
                onClick={() => {
                  setBuzz(true)
                  log('SERIAL', 'Simulated buzzer pulse')
                }}
              >
                Pulse buzzer
              </button>
            </div>
            <button
              className="danger"
              disabled={
                stopping ||
                Boolean(activeStop) ||
                (!sim && (link !== 'connected' || !hardware?.connected))
              }
              onClick={() => void emergencyStop()}
            >
              <OctagonAlert size={16} /> Emergency stop
            </button>
            <button
              disabled={!sim || !stop}
              onClick={() => {
                setTarget(angle)
                setStop(false)
                log('SERIAL', 'Simulation stop latch reset')
              }}
            >
              <RotateCcw size={15} /> Reset simulation latch
            </button>
            {activeStop && <p role="status">Stop latch active</p>}
            {stopError && <p role="alert">{stopError}</p>}
            {!sim && <p>Live controls are limited to emergency stop.</p>}
          </div>
        </Panel>
      </div>
      <Panel
        title="Serial communication"
        className="spaced"
        action={<Terminal size={17} />}
      >
        <Timeline items={serial} />
      </Panel>
    </>
  )
}
export function Sessions() {
  const {
    observations,
    reminders,
    reminderThreshold,
    cooldown,
    session,
    elapsed,
    since,
    mode,
  } = useLab()
  const [show, setShow] = useState('all')
  const events = observations.filter(
    (o) =>
      show === 'all' ||
      (show === 'reminders'
        ? o.reminder
        : show === 'dismissed'
          ? o.dismissed
          : !o.reminder && !o.dismissed),
  )
  const valid = observations.filter((o) => !o.dismissed && !o.reminder)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (session !== 'running') return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [session, since])
  const end =
    (elapsed + (session === 'running' ? Math.max(0, now - since) : 0)) / 1000
  return (
    <>
      <Heading
        index="07 / SESSION REVIEW"
        title="Focus Sessions"
        description="Review observable events from voluntary sessions and adjust optional reminders."
      >
        <SessionActions />
      </Heading>
      <div className="three">
        {[
          ['Session duration', <SessionClock />],
          [
            'Phone visibility events',
            valid.filter((o) => /phone/i.test(o.label)).length,
          ],
          [
            'Unknown observations',
            valid.filter((o) => /unknown|uncertain/i.test(o.label)).length,
          ],
        ].map(([name, value], i) => (
          <div className="metric" key={i}>
            <div>{name}</div>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="split spaced">
        <Panel
          title="Observed activity over time"
          action={
            <Status tone={mode === 'simulation' ? 'amber' : 'cyan'}>
              {mode === 'simulation' ? 'Simulated session' : 'Local session'}
            </Status>
          }
        >
          {valid.length ? (
            <>
              <div className="activity-strip">
                {valid.map((o, i) => (
                  <span
                    key={o.id}
                    title={duration(o.at) + ' · ' + o.label}
                    style={{
                      flexGrow: Math.max(0.1, (valid[i + 1]?.at ?? end) - o.at),
                      background: /phone/i.test(o.label)
                        ? '#eab86e'
                        : /break/i.test(o.label)
                          ? '#54cde0'
                          : /computer/i.test(o.label)
                            ? '#b3f665'
                            : '#637083',
                    }}
                  />
                ))}
              </div>
              <div className="activity-legend">
                <span>Computer activity</span>
                <span>Phone visible</span>
                <span>Break</span>
                <span>Unknown / other</span>
              </div>
            </>
          ) : (
            <Empty>Start a session to collect observable activity events</Empty>
          )}
        </Panel>
        <Panel title="Reminder settings" action={<Bell size={16} />}>
          <div className="form">
            <label className="inline">
              <input
                type="checkbox"
                checked={reminders}
                onChange={(e) =>
                  useLab.setState({ reminders: e.target.checked })
                }
              />{' '}
              In-app phone visibility reminders
            </label>
            <label>
              Confidence threshold <output>{pct(reminderThreshold)}</output>
              <input
                type="range"
                min=".5"
                max="1"
                step=".01"
                value={reminderThreshold}
                onChange={(e) =>
                  useLab.setState({ reminderThreshold: +e.target.value })
                }
              />
            </label>
            <label>
              Cooldown <output>{cooldown}s</output>
              <input
                type="range"
                min="10"
                max="300"
                step="5"
                value={cooldown}
                onChange={(e) => useLab.setState({ cooldown: +e.target.value })}
              />
            </label>
            <button
              disabled={session !== 'running'}
              onClick={() =>
                useLab.setState((s) => ({
                  observations: [
                    ...s.observations,
                    {
                      id: Date.now(),
                      at: (s.elapsed + Date.now() - s.since) / 1000,
                      label: 'Intentional break (manual)',
                      confidence: 1,
                    },
                  ],
                }))
              }
            >
              Mark intentional break
            </button>
          </div>
        </Panel>
      </div>
      <Panel
        title="Session events"
        className="spaced"
        action={
          <select
            aria-label="Filter session events"
            value={show}
            onChange={(e) => setShow(e.target.value)}
          >
            <option value="all">All events</option>
            <option value="activity">Observations</option>
            <option value="reminders">Reminders</option>
            <option value="dismissed">Dismissed</option>
          </select>
        }
      >
        {events.length ? (
          <div className="records">
            {[...events].reverse().map((o) => (
              <div key={o.id}>
                <strong>{o.label}</strong>
                <time>{duration(o.at)}</time>
                <span>
                  {o.label.endsWith('(manual)') ? 'Manual' : pct(o.confidence)}
                </span>
                <button
                  disabled={o.dismissed}
                  onClick={() => useLab.getState().dismiss(o.id)}
                >
                  {o.dismissed ? 'Dismissed' : 'Dismiss'}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Empty>No events match this view</Empty>
        )}
      </Panel>
    </>
  )
}
function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function Console() {
  const { packets, events, mode, link, data, privacy } = useLab()
  const [type, setType] = useState('all'),
    [kind, setKind] = useState('all'),
    [index, setIndex] = useState(0),
    [snapshot, setSnapshot] = useState<string | null>(null)
  const filtered = packets.filter((p) => type === 'all' || p.type === type),
    log = events.filter((e) => kind === 'all' || e.kind === kind)
  useEffect(() => {
    setSnapshot(null)
    setIndex(0)
    setType('all')
    setKind('all')
  }, [mode, privacy])
  const selected = filtered[index] ?? filtered[0]
  function exportMetrics(format: 'json' | 'csv') {
    const allowed = [
      'accuracy',
      'precision',
      'recall',
      'f1',
      'fpr',
      'fnr',
      'latency_ms',
      'fps',
      'size_mb',
      'training_seconds',
      'gpu_memory_mb',
    ]
    const numberRows = (data.experiments ?? []).flatMap((r, i) =>
      allowed.flatMap((k) =>
        Number.isFinite(r.metrics[k])
          ? [{ run: i + 1, metric: k, value: r.metrics[k] }]
          : [],
      ),
    )
    if (!numberRows.length) return
    const file =
      format === 'json'
        ? JSON.stringify(numberRows, null, 2)
        : 'run,metric,value\n' +
          numberRows.map((r) => [r.run, r.metric, r.value].join(',')).join('\n')
    save(
      new Blob([file], {
        type: format === 'json' ? 'application/json' : 'text/csv',
      }),
      'lock-in-experiments.' + format,
    )
  }
  return (
    <>
      <Heading
        index="08 / DIAGNOSTICS"
        title="Developer Console"
        description="Inspect local telemetry envelopes, system events, and numeric experiment exports."
      >
        <button
          disabled={!data.experiments?.length}
          onClick={() => exportMetrics('json')}
        >
          <Download size={15} /> JSON
        </button>
        <button
          disabled={!data.experiments?.length}
          onClick={() => exportMetrics('csv')}
        >
          <Download size={15} /> CSV
        </button>
      </Heading>
      <Panel
        title="Connection diagnostics"
        action={
          <Status
            tone={
              mode === 'simulation'
                ? 'amber'
                : link === 'connected'
                  ? 'green'
                  : 'neutral'
            }
          >
            {mode === 'simulation' ? 'Local simulation' : link}
          </Status>
        }
      >
        <div className="inset actions">
          <code>{localUrl(routes.telemetry, true)}</code>
          <button
            disabled={mode !== 'live' || !routes.health}
            onClick={() => void request(routes.health!).catch(() => undefined)}
          >
            <Radio size={15} /> Check backend health
          </button>
        </div>
      </Panel>
      <div className="split spaced">
        <Panel
          title="Telemetry messages"
          action={
            <select
              aria-label="Message type"
              value={type}
              onChange={(e) => {
                setType(e.target.value)
                setIndex(0)
                setSnapshot(null)
              }}
            >
              <option value="all">All types</option>
              {[...new Set(packets.map((p) => p.type))].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          }
        >
          {filtered.length ? (
            <div className="packet-list">
              {filtered.slice(0, 22).map((p, i) => (
                <button
                  className={i === index ? 'active' : ''}
                  key={p.type + p.ts + i}
                  onClick={() => {
                    setIndex(i)
                    setSnapshot(JSON.stringify(p, null, 2))
                  }}
                >
                  <span>{p.type}</span>
                  <time>{new Date(p.ts * 1000).toLocaleTimeString()}</time>
                </button>
              ))}
            </div>
          ) : (
            <Empty>No packets received</Empty>
          )}
        </Panel>
        <Panel
          title="JSON payload"
          action={
            snapshot && (
              <button onClick={() => setSnapshot(null)}>Follow stream</button>
            )
          }
        >
          {selected || snapshot ? (
            <pre>{snapshot ?? JSON.stringify(selected, null, 2)}</pre>
          ) : (
            <Empty>Select a telemetry message to inspect it</Empty>
          )}
        </Panel>
      </div>
      <Panel
        title="System logs"
        className="spaced"
        action={
          <select
            aria-label="Event category"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="all">All events</option>
            {[...new Set(events.map((e) => e.kind))].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        }
      >
        <Timeline items={log} limit={40} />
      </Panel>
    </>
  )
}
export function Collection() {
  const { privacy, recording, log } = useLab()
  const [clips, setClips] = useState<
      { id: number; blob: Blob; label: string }[]
    >([]),
    [label, setLabel] = useState(''),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false)
  const recorder = useRef<MediaRecorder | null>(null),
    camera = useRef<MediaStream | null>(null),
    mounted = useRef(true),
    cancel = useRef(false)
  function stop() {
    if (recorder.current?.state === 'recording') recorder.current.stop()
    camera.current?.getTracks().forEach((t) => t.stop())
    camera.current = null
  }
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      cancel.current = true
      stop()
      useLab.setState({ recording: false })
    }
  }, [])
  useEffect(() => {
    if (privacy) {
      cancel.current = true
      stop()
    }
  }, [privacy])
  async function start() {
    setPending(true)
    setError('')
    cancel.current = false
    try {
      if (!window.MediaRecorder || !navigator.mediaDevices)
        throw Error('Local recording is unavailable in this browser')
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      })
      if (!mounted.current || cancel.current || useLab.getState().privacy) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      camera.current = stream
      const rec = new MediaRecorder(stream),
        chunks: Blob[] = []
      recorder.current = rec
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data)
      }
      rec.onstop = () => {
        stop()
        recorder.current = null
        useLab.setState({ recording: false })
        if (mounted.current && chunks.length && !cancel.current)
          setClips((s) => [
            ...s,
            {
              id: Date.now(),
              blob: new Blob(chunks, { type: rec.mimeType }),
              label: label.trim(),
            },
          ])
        log('RECORDING', 'Local browser recording stopped')
      }
      rec.onerror = () => {
        cancel.current = true
        setError('The browser recorder encountered an error')
        stop()
      }
      rec.start(1000)
      useLab.setState({ recording: true })
      log('RECORDING', 'Explicit local browser recording started')
    } catch (e) {
      stop()
      if (mounted.current) setError(String(e))
    } finally {
      if (mounted.current) setPending(false)
    }
  }
  return (
    <Panel
      title="Local dataset collection"
      caption="Clips are kept in this page until exported or deleted. Camera audio is disabled."
      className="spaced"
      action={
        <Status tone={recording ? 'amber' : 'neutral'}>
          {recording ? 'RECORDING' : 'Recording off'}
        </Status>
      }
    >
      <div className="form">
        <label>
          Clip label
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={80}
            disabled={recording || pending}
            placeholder="Observable activity label"
          />
        </label>
        <div className="actions">
          <button
            disabled={privacy || recording || pending || !label.trim()}
            onClick={() => void start()}
          >
            <Video size={15} />{' '}
            {pending ? 'Opening camera…' : 'Start local recording'}
          </button>
          <button disabled={!recording} onClick={stop}>
            Stop recording
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
      </div>
      {clips.length ? (
        <div className="records">
          {clips.map((c) => (
            <div key={c.id}>
              <strong>{c.label}</strong>
              <span>{fmt(c.blob.size / 1024, 0)} KB</span>
              <button
                onClick={() =>
                  save(
                    c.blob,
                    'clip-' +
                      c.id +
                      (c.blob.type.includes('mp4') ? '.mp4' : '.webm'),
                  )
                }
              >
                <Download size={14} /> Save locally
              </button>
              <button
                aria-label={'Delete ' + c.label}
                onClick={() => setClips((s) => s.filter((v) => v.id !== c.id))}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <Empty>No local clips in this workspace</Empty>
      )}
    </Panel>
  )
}
