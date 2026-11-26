import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createRoot } from 'react-dom/client'
import { motion, useReducedMotion } from 'framer-motion'
import {
  Activity,
  Aperture,
  AudioLines,
  Camera,
  ChevronDown,
  CircleDot,
  Command,
  FlaskConical,
  LayoutDashboard,
  ListFilter,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RadioTower,
  Search,
  Shield,
  Sigma,
  Terminal,
  X,
} from 'lucide-react'
import { connect, routes, type Envelope, type Payloads } from './api'
import Mission from './Mission'
import { request, simulate, useLab } from './state'
import { Empty, Status } from './ui'
import './style.css'
import Vision from './Vision'
const Research = lazy(() => import('./Research'))
const MathLab = lazy(() => import('./Mathematics'))
const Robotics = lazy(() =>
  import('./Operations').then((m) => ({ default: m.Robotics })),
)
const Sessions = lazy(() =>
  import('./Operations').then((m) => ({ default: m.Sessions })),
)
const Console = lazy(() =>
  import('./Operations').then((m) => ({ default: m.Console })),
)
const Collection = lazy(() =>
  import('./Operations').then((m) => ({ default: m.Collection })),
)
const Training = lazy(() =>
  import('./Research').then((m) => ({ default: m.Training })),
)
const pages = [
  {
    id: 'mission',
    name: 'Mission Control',
    icon: LayoutDashboard,
    section: 'OPERATIONS',
  },
  { id: 'vision', name: 'Live Vision', icon: Camera, section: 'OPERATIONS' },
  {
    id: 'research',
    name: 'ML Research Lab',
    icon: FlaskConical,
    section: 'RESEARCH',
  },
  { id: 'math', name: 'Math Lab', icon: Sigma, section: 'RESEARCH' },
  {
    id: 'training',
    name: 'Training Studio',
    icon: AudioLines,
    section: 'RESEARCH',
  },
  {
    id: 'robotics',
    name: 'Robotics Control',
    icon: RadioTower,
    section: 'OPERATIONS',
  },
  {
    id: 'sessions',
    name: 'Focus Sessions',
    icon: Activity,
    section: 'OPERATIONS',
  },
  {
    id: 'console',
    name: 'Developer Console',
    icon: Terminal,
    section: 'SYSTEM',
  },
]
const readPage = () =>
  pages.some((p) => p.id === location.hash.slice(1))
    ? location.hash.slice(1)
    : 'mission'
class Boundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' }
  static getDerivedStateFromError(e: Error) {
    return { error: e.message }
  }
  componentDidCatch(e: Error) {
    useLab.getState().log('ERROR', e.message)
  }
  render() {
    return this.state.error ? (
      <div className="panel inset" role="alert">
        <h2>Workspace failed to render</h2>
        <p>{this.state.error}</p>
        <button onClick={() => this.setState({ error: '' })}>
          Retry workspace
        </button>
      </div>
    ) : (
      this.props.children
    )
  }
}
function App() {
  const { mode, link, privacy, recording, setMode, data } = useLab()
  const [page, setPage] = useState(readPage),
    [collapsed, setCollapsed] = useState(false),
    [palette, setPalette] = useState(false),
    [query, setQuery] = useState(''),
    [selection, setSelection] = useState(0),
    [mobile, setMobile] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null),
    reduce = useReducedMotion()
  const current = pages.find((p) => p.id === page)!,
    results = pages.filter((p) =>
      p.name.toLowerCase().includes(query.toLowerCase()),
    )
  function go(id: string) {
    location.hash = id
    setPage(id)
    setPalette(false)
    setMobile(false)
    window.scrollTo(0, 0)
  }
  useEffect(() => {
    const fn = () => setPage(readPage())
    window.addEventListener('hashchange', fn)
    return () => window.removeEventListener('hashchange', fn)
  }, [])
  useEffect(() => {
    document.title = 'Lock-In AI | ' + current.name
  }, [current])
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((p) => !p)
      }
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])
  useEffect(() => {
    if (palette) {
      setQuery('')
      setSelection(0)
      dialog.current?.showModal()
    } else dialog.current?.close()
  }, [palette])
  useEffect(() => {
    let tick = 0
    if (mode === 'simulation') {
      simulate(tick++)
      const id = setInterval(() => simulate(tick++), 260)
      return () => clearInterval(id)
    }
    const s = useLab.getState()
    return connect(
      routes.telemetry,
      s.ingest,
      (status) => {
        if (status === 'disconnected') s.clearLive()
        s.setLink(status)
      },
      (error) => s.log('ERROR', error),
    )
  }, [mode])
  useEffect(() => {
    if (mode !== 'live' || link !== 'connected' || privacy) return
    let stopped = false
    function load<K extends 'experiments' | 'datasets' | 'internals'>(
      type: K,
      path?: string,
    ) {
      if (path)
        void request<Payloads[K]>(path)
          .then((data) => {
            if (!stopped)
              useLab
                .getState()
                .ingest({ v: 1, ts: Date.now() / 1000, type, data } as Envelope)
          })
          .catch(() => undefined)
    }
    load('experiments', routes.experiments)
    load('datasets', routes.datasets)
    load('internals', routes.internals)
    return () => {
      stopped = true
    }
  }, [mode, link, privacy, data.models?.active, data.training?.state])
  const content =
    page === 'mission' ? (
      <Mission go={go} />
    ) : page === 'vision' ? (
      <Vision />
    ) : page === 'research' ? (
      <Research />
    ) : page === 'math' ? (
      <MathLab />
    ) : page === 'training' ? (
      <>
        <Training />
        <Collection />
      </>
    ) : page === 'robotics' ? (
      <Robotics />
    ) : page === 'sessions' ? (
      <Sessions />
    ) : (
      <Console />
    )
  return (
    <div
      className={
        'app ' + (collapsed ? 'collapsed' : '') + (mobile ? ' mobile-open' : '')
      }
    >
      <aside className="rail">
        <a
          className="brand"
          href="#mission"
          onClick={(e) => {
            e.preventDefault()
            go('mission')
          }}
          aria-label="Lock-In AI home"
        >
          <div className="brand-icon">
            <Aperture size={22} />
          </div>
          <div>
            <strong>
              Lock-In <em>AI</em>
            </strong>
            <small>RESEARCH CONSOLE</small>
          </div>
        </a>
        <div className="rail-inner">
          <button
            className="jump"
            onClick={() => setPalette(true)}
            aria-label="Open command palette"
          >
            <Search size={15} />
            <span>Quick search</span>
            <kbd>Ctrl K</kbd>
          </button>
          {['OPERATIONS', 'RESEARCH', 'SYSTEM'].map((group) => (
            <nav key={group} aria-label={group}>
              <h2>{group}</h2>
              {pages
                .filter((p) => p.section === group)
                .map((p) => (
                  <a
                    href={'#' + p.id}
                    key={p.id}
                    className={page === p.id ? 'current' : ''}
                    aria-current={page === p.id ? 'page' : undefined}
                    title={p.name}
                    onClick={(e) => {
                      e.preventDefault()
                      go(p.id)
                    }}
                  >
                    <p.icon size={17} />
                    <span>{p.name}</span>
                    {page === p.id && <i />}
                  </a>
                ))}
            </nav>
          ))}
        </div>
        <div className="rail-footer">
          <div className="rail-local">
            <Shield size={15} />
            <div>
              <strong>Local workspace</strong>
              <small>127.0.0.1</small>
            </div>
          </div>
          <button
            className="plain"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? (
              <PanelLeftOpen size={17} />
            ) : (
              <PanelLeftClose size={17} />
            )}
          </button>
        </div>
      </aside>
      {mobile && (
        <button
          className="mobile-dismiss"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="plain mobile-toggle"
              aria-label="Open navigation"
              onClick={() => setMobile(!mobile)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <span className="slash">/</span>
            <strong>{current.name}</strong>
          </div>
          <div className="top-controls">
            {(recording || data.recording?.active) && (
              <Status tone="amber">
                {recording ? 'Browser recording' : 'Backend recording'}
              </Status>
            )}
            {privacy && <Status tone="amber">Privacy paused</Status>}
            <Status
              tone={
                mode === 'simulation'
                  ? 'green'
                  : link === 'connected'
                    ? 'green'
                    : 'neutral'
              }
            >
              {mode === 'simulation'
                ? 'Simulation active'
                : link === 'connected'
                  ? 'Backend connected'
                  : link === 'connecting'
                    ? 'Connecting'
                    : 'Backend offline'}
            </Status>
            <label
              className={
                'mode-select ' + (mode === 'simulation' ? 'sim-mode' : '')
              }
            >
              <CircleDot size={14} />
              <select
                aria-label="Data mode"
                value={mode}
                onChange={(e) =>
                  setMode(e.target.value === 'live' ? 'live' : 'simulation')
                }
              >
                <option value="simulation">Simulation mode</option>
                <option value="live">Live mode</option>
              </select>
              <ChevronDown size={13} />
            </label>
          </div>
        </header>
        <main>
          {mode === 'live' && link !== 'connected' && (
            <div className="notice" role="status">
              <RadioTower size={15} />{' '}
              {link === 'connecting'
                ? 'Connecting to the local backend…'
                : 'Local backend unavailable. Reconnecting…'}
            </div>
          )}
          {mode === 'live' &&
            link === 'connected' &&
            data.models?.models.find((m) => m.id === data.models?.active)
              ?.simulated && (
              <div className="notice">
                <ListFilter size={15} /> Backend mock model active. Select an
                available real model in ML Research Lab for live predictions.
              </div>
            )}
          <motion.div
            key={page}
            initial={reduce ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
          >
            <Boundary>
              <Suspense
                fallback={
                  <div className="panel">
                    <Empty>Loading workspace…</Empty>
                  </div>
                }
              >
                {content}
              </Suspense>
            </Boundary>
          </motion.div>
        </main>
      </div>
      <dialog
        ref={dialog}
        onCancel={() => setPalette(false)}
        onClick={(e) => {
          if (e.target === dialog.current) setPalette(false)
        }}
      >
        <div className="palette">
          <div className="palette-search">
            <Command size={19} />
            <input
              autoFocus
              aria-label="Search workspaces"
              placeholder="Find a workspace…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setSelection(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setSelection((i) =>
                    Math.min(Math.max(0, results.length - 1), i + 1),
                  )
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setSelection((i) => Math.max(0, i - 1))
                }
                if (e.key === 'Enter' && results[selection])
                  go(results[selection].id)
              }}
            />
            <button
              className="plain"
              aria-label="Close command palette"
              onClick={() => setPalette(false)}
            >
              <X size={17} />
            </button>
          </div>
          {results.length ? (
            <div className="palette-results">
              {results.map((p, i) => (
                <button
                  key={p.id}
                  className={i === selection ? 'active' : ''}
                  onClick={() => go(p.id)}
                >
                  <p.icon size={16} />
                  {p.name}
                  <small>{p.section}</small>
                </button>
              ))}
            </div>
          ) : (
            <Empty>No matching workspaces</Empty>
          )}
        </div>
      </dialog>
    </div>
  )
}
createRoot(document.getElementById('root')!).render(<App />)
