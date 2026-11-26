import { useEffect, useState } from 'react'
import {
  Activity,
  Camera,
  Cpu,
  Gauge,
  HardDrive,
  Microchip,
  Pause,
  Play,
  Shield,
  ShieldOff,
  Square,
  Zap,
} from 'lucide-react'
import { useLab } from './state'
import {
  Chart,
  color,
  duration,
  fmt,
  Heading,
  NavButton,
  Panel,
  pct,
  Status,
  Timeline,
} from './ui'
import { Viewport } from './Vision'
export function SessionActions() {
  const { session, control, privacy, togglePrivacy } = useLab()
  return (
    <>
      <button
        className="primary"
        onClick={() => control('start')}
        disabled={session === 'running' || privacy}
      >
        <Play size={15} />
        {session === 'paused' ? 'Resume session' : 'Start session'}
      </button>
      <button
        aria-label="Pause session"
        title="Pause session"
        onClick={() => control('pause')}
        disabled={session !== 'running'}
      >
        <Pause size={15} />
      </button>
      <button
        aria-label="Stop session"
        title="Stop session"
        onClick={() => control('stop')}
        disabled={session !== 'running' && session !== 'paused'}
      >
        <Square size={14} />
      </button>
      <button
        aria-label={privacy ? 'Release privacy pause' : 'Enable privacy pause'}
        title="Privacy pause"
        className={privacy ? 'active' : ''}
        onClick={togglePrivacy}
      >
        {privacy ? <ShieldOff size={16} /> : <Shield size={16} />}
      </button>
    </>
  )
}
export function SessionClock() {
  const { session, since, elapsed } = useLab()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (session !== 'running') return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [session, since])
  return (
    <>
      {duration(
        (elapsed + (session === 'running' ? Math.max(0, now - since) : 0)) /
          1000,
      )}
    </>
  )
}
export default function Mission({ go }: { go: (page: string) => void }) {
  const { data, samples, events, mode, link, session, privacy } = useLab()
  const sim = mode === 'simulation',
    frame = data.frame_result,
    system = data.system
  const metrics = [
    {
      name: 'Inference FPS',
      value: fmt(frame?.fps),
      unit: 'fps',
      icon: Activity,
      tone: 'green',
      key: 'fps',
    },
    {
      name: 'Inference latency',
      value: fmt(frame?.inference_ms),
      unit: 'ms',
      icon: Zap,
      tone: 'cyan',
      key: 'latency',
    },
    {
      name: 'CPU utilization',
      value: fmt(system?.cpu_percent, 0),
      unit: '%',
      icon: Cpu,
      tone: 'green',
      key: 'cpu',
    },
    {
      name: 'GPU utilization',
      value: fmt(system?.gpu_util_percent, 0),
      unit: '%',
      icon: Gauge,
      tone: 'cyan',
      key: 'gpu',
    },
    {
      name: 'VRAM usage',
      value: fmt(
        system?.gpu_mem_used_mb == null ? null : system.gpu_mem_used_mb / 1024,
        2,
      ),
      unit: 'GB',
      icon: HardDrive,
      tone: 'amber',
      key: '',
    },
  ]
  return (
    <>
      <Heading
        index="SYSTEM OVERVIEW"
        title="Mission Control"
        description="Observe inference, system performance, and voluntary focus sessions."
      >
        <SessionActions />
      </Heading>
      <div className="metrics">
        {metrics.map((m) => {
          const values = samples
            .slice(-25)
            .map((s) => s[m.key as 'fps'] as number | undefined)
            .filter((x): x is number => typeof x === 'number')
          const low = Math.min(...values),
            span = Math.max(1, Math.max(...values) - low)
          return (
            <section className={'metric ' + m.tone} key={m.name}>
              <div>
                <m.icon size={15} />
                {m.name}
              </div>
              <strong>
                {m.value}
                <small> {m.unit}</small>
              </strong>
              {values.length > 1 && (
                <svg viewBox="0 0 82 24" className="spark" aria-hidden="true">
                  <polyline
                    points={values
                      .map((v, i) =>
                        [
                          (i * 82) / (values.length - 1),
                          22 - ((v - low) / span) * 18,
                        ].join(','),
                      )
                      .join(' ')}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                  />
                </svg>
              )}
            </section>
          )
        })}
      </div>
      <div className="split mission-top">
        <Panel
          className="feed-panel"
          title="Vision feed"
          caption="Computer vision viewport"
          action={
            <NavButton onClick={() => go('vision')}>Open Vision Lab</NavButton>
          }
        >
          <Viewport
            compact
            active={
              new Set(['Boxes', 'Confidence', 'Pose', 'Distance', 'Centers'])
            }
          />
          <div className="feed-footer">
            <Status
              tone={sim ? 'amber' : data.camera?.running ? 'green' : 'neutral'}
            >
              {privacy
                ? 'Privacy paused'
                : sim
                  ? 'Synthetic source'
                  : data.camera?.simulated
                    ? 'Backend synthetic camera'
                    : data.camera?.running
                      ? 'Camera running'
                      : 'Camera disconnected'}
            </Status>
            <span>
              {frame?.model_id ?? 'No active inference'} <i />{' '}
              {data.camera?.width
                ? data.camera.width + ' × ' + data.camera.height
                : sim
                  ? '640 × 480'
                  : '—'}
            </span>
          </div>
        </Panel>
        <div className="stack">
          <Panel
            title="Session monitor"
            caption="Voluntary focus session"
            action={
              <Status
                tone={
                  session === 'running'
                    ? 'green'
                    : session === 'paused'
                      ? 'amber'
                      : 'neutral'
                }
              >
                {session === 'idle' ? 'Ready' : session}
              </Status>
            }
          >
            <div className="session-monitor">
              <div className="timer">
                <SessionClock />
              </div>
              <div className="session-label">SESSION ELAPSED</div>
              <div className="observation">
                <div>
                  <span>OBSERVED ACTIVITY</span>
                  <strong>
                    {privacy
                      ? 'Privacy paused'
                      : (frame?.activity?.label ?? 'Awaiting observation')}
                  </strong>
                </div>
                <b>{pct(frame?.activity?.confidence)}</b>
              </div>
              <div className="meter">
                <i
                  style={{
                    width: (frame?.activity?.confidence ?? 0) * 100 + '%',
                  }}
                />
              </div>
            </div>
          </Panel>
          <Panel title="Subsystems" action={<Microchip size={16} />}>
            <div className="subsystems">
              <div>
                <span>Telemetry</span>
                <Status
                  tone={
                    sim ? 'amber' : link === 'connected' ? 'green' : 'neutral'
                  }
                >
                  {sim ? 'Simulation' : link}
                </Status>
              </div>
              <div>
                <span>Active model</span>
                <b>
                  {sim
                    ? 'YOLO + Rules / Demo'
                    : (data.models?.active ?? frame?.model_id ?? 'Unavailable')}
                </b>
              </div>
              <div>
                <span>
                  <Camera size={13} /> Camera
                </span>
                <Status tone={data.camera?.running ? 'green' : 'neutral'}>
                  {data.camera?.simulated || sim
                    ? 'Synthetic'
                    : data.camera?.running
                      ? 'Connected'
                      : 'Disconnected'}
                </Status>
              </div>
              <div>
                <span>Arduino</span>
                <Status tone={data.hardware?.connected ? 'green' : 'neutral'}>
                  {data.hardware?.state ?? 'Disconnected'}
                </Status>
              </div>
            </div>
          </Panel>
        </div>
      </div>
      <div className="split mission-bottom">
        <Panel title="Inference telemetry" caption="Rolling performance window">
          <Chart
            data={samples}
            lines={[
              { key: 'fps', label: 'Frames / s', color: color.green },
              { key: 'latency', label: 'Inference ms', color: color.cyan },
            ]}
            clock
            height={174}
          />
        </Panel>
        <Panel
          title="Event log"
          caption="Recent system activity"
          action={<NavButton onClick={() => go('console')}>Console</NavButton>}
        >
          <Timeline items={events} limit={4} />
        </Panel>
      </div>
    </>
  )
}
