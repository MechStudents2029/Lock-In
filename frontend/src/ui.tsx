import type { ReactNode } from 'react'
import { Activity, ArrowUpRight, CircleHelp, Radio } from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useLab, type Entry } from './state'
export const color = { green: '#b3f665', cyan: '#54cde0', amber: '#eab86e' }
export const fmt = (n: number | null | undefined, digits = 1) =>
  n == null || !Number.isFinite(n) ? '—' : n.toFixed(digits)
export const pct = (n: number | null | undefined) =>
  n == null ? '—' : fmt(n * 100, 1) + '%'
export const time = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString('en-GB', { hour12: false })
export function duration(s: number) {
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, Math.floor(s) % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':')
}
export function Heading({
  index,
  title,
  description,
  children,
}: {
  index: string
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <div className="page-head">
      <div>
        <div className="eyebrow">
          <span /> {index}
        </div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children && <div className="actions">{children}</div>}
    </div>
  )
}
export function Panel({
  title,
  caption,
  action,
  children,
  className = '',
}: {
  title: string
  caption?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={'panel ' + className}>
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {caption && <p>{caption}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <CircleHelp size={17} />
      <p>{children}</p>
    </div>
  )
}
export function Status({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'green' | 'cyan' | 'amber' | 'neutral'
}) {
  return (
    <span className={'status ' + tone}>
      <i />
      {children}
    </span>
  )
}
export function Chart({
  data,
  lines,
  x = 't',
  domain,
  clock = false,
  height = 200,
  xLabel,
  yLabel,
  marker,
}: {
  data: object[]
  lines: { key: string; label: string; color: string; dash?: string }[]
  x?: string
  domain?: [number, number]
  clock?: boolean
  height?: number
  xLabel?: string
  yLabel?: string
  marker?: { x: number; y: number }
}) {
  return (
    <div className="chart">
      {data.length === 0 ? (
        <Empty>Waiting for telemetry</Empty>
      ) : (
        <>
          <div className="legend">
            {lines.map((l) => (
              <span key={l.key}>
                <i style={{ background: l.color }} />
                {l.label}
              </span>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={height}>
            <LineChart
              data={data}
              margin={{
                top: 14,
                right: 12,
                bottom: xLabel ? 18 : 5,
                left: yLabel ? 12 : -18,
              }}
            >
              <CartesianGrid
                stroke="#232a33"
                vertical={false}
                strokeDasharray="3 5"
              />
              <XAxis
                dataKey={x}
                minTickGap={24}
                tickLine={false}
                axisLine={false}
                tick={{ fill: '#788597', fontSize: 10 }}
                tickFormatter={(v) =>
                  clock
                    ? time(v).slice(3)
                    : typeof v === 'number'
                      ? String(Number(v.toFixed(2)))
                      : v
                }
                label={
                  xLabel
                    ? {
                        value: xLabel,
                        position: 'insideBottom',
                        offset: -10,
                        fill: '#9aa6b5',
                        fontSize: 11,
                      }
                    : undefined
                }
              />
              <YAxis
                domain={domain}
                tickLine={false}
                axisLine={false}
                tick={{ fill: '#788597', fontSize: 10 }}
                label={
                  yLabel
                    ? {
                        value: yLabel,
                        angle: -90,
                        position: 'insideLeft',
                        fill: '#9aa6b5',
                        fontSize: 11,
                      }
                    : undefined
                }
              />
              <Tooltip
                contentStyle={{
                  background: '#131923',
                  border: '1px solid #303b48',
                  borderRadius: 8,
                  fontFamily: 'monospace',
                }}
                labelFormatter={(v) => (clock ? time(Number(v)) : String(v))}
                formatter={(v) =>
                  typeof v === 'number' ? fmt(v, 3) : String(v)
                }
              />
              {marker && (
                <ReferenceDot
                  x={marker.x}
                  y={marker.y}
                  r={5}
                  fill={color.amber}
                  stroke="#10151c"
                  strokeWidth={2}
                />
              )}
              {lines.map((l) => (
                <Line
                  key={l.key}
                  type="monotone"
                  dataKey={l.key}
                  name={l.label}
                  stroke={l.color}
                  strokeDasharray={l.dash}
                  strokeWidth={2}
                  isAnimationActive={false}
                  dot={data.length === 1}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  )
}
export function Timeline({
  items,
  limit = 12,
}: {
  items: Entry[]
  limit?: number
}) {
  return items.length ? (
    <div className="timeline">
      {items.slice(0, limit).map((e) => (
        <div className="event" key={e.id}>
          <span
            className={
              'event-icon ' + (/ERROR|WARNING/.test(e.kind) ? 'alert' : '')
            }
          >
            {e.kind === 'PREDICTION' ? (
              <Activity size={14} />
            ) : (
              <Radio size={14} />
            )}
          </span>
          <div>
            <strong>{e.message}</strong>
            <small>
              {e.kind}
              {e.simulated ? ' · SIMULATION' : ''}
            </small>
          </div>
          <time>{time(e.ts)}</time>
        </div>
      ))}
    </div>
  ) : (
    <Empty>No events match this view</Empty>
  )
}
export function NavButton({
  children,
  onClick,
}: {
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button className="plain" onClick={onClick}>
      {children}
      <ArrowUpRight size={15} />
    </button>
  )
}
export function SourceBadge() {
  const mode = useLab((s) => s.mode)
  return (
    <Status tone={mode === 'simulation' ? 'amber' : 'cyan'}>
      {mode === 'simulation' ? 'SIMULATED DATA' : 'LIVE TELEMETRY'}
    </Status>
  )
}
