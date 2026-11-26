import { useEffect, useState } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { Play, RotateCcw, StepForward } from 'lucide-react'
import type { Tree } from './api'
import { useLab } from './state'
import { coordinates } from './Vision'
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
const modes = [
  'Euclidean distance',
  'Probabilities',
  'Random Forest',
  'Neural network',
  'Gradient descent',
  'Temporal filtering',
]
function MathText({ value }: { value: string }) {
  return (
    <span
      dangerouslySetInnerHTML={{
        __html: katex.renderToString(value, { throwOnError: false }),
      }}
    />
  )
}
function Explanation({
  simple,
  advanced,
}: {
  simple: string
  advanced: string
}) {
  return (
    <div className="explanation">
      <p>{simple}</p>
      <details>
        <summary>Advanced explanation</summary>
        <p>{advanced}</p>
      </details>
    </div>
  )
}
export default function Mathematics() {
  const [tab, setTab] = useState(modes[0])
  return (
    <>
      <Heading
        index="04 / APPLIED MATHEMATICS"
        title="Math Lab"
        description="Explore the mathematics behind the observations, feature transforms, and model decisions."
      />
      <div className="tabs" role="group" aria-label="Math visualization">
        {modes.map((t) => (
          <button key={t} aria-pressed={t === tab} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab === modes[0] ? (
        <Distance />
      ) : tab === modes[1] ? (
        <Probabilities />
      ) : tab === modes[2] ? (
        <Forest />
      ) : tab === modes[3] ? (
        <Network />
      ) : tab === modes[4] ? (
        <Descent />
      ) : (
        <Temporal />
      )}
    </>
  )
}
function Distance() {
  const pair = coordinates(useLab((s) => s.data.frame_result))
  const plot = ([x, y]: [number, number]) => [50 + 450 * x, 25 + 265 * y]
  const dist = pair
    ? Math.hypot(pair.phone[0] - pair.hand[0], pair.phone[1] - pair.hand[1])
    : null
  return (
    <Panel
      title="Hand-to-phone distance"
      caption="Normalized image coordinates"
      action={<SourceBadge />}
    >
      <div className="split inset">
        <svg
          className="scientific-svg"
          viewBox="0 0 560 335"
          aria-label="Hand and phone in normalized coordinate space"
        >
          <path d="M50 25v265h450" stroke="#6d7b8c" fill="none" />
          {Array.from({ length: 6 }, (_, i) => (
            <g key={i}>
              <path
                d={
                  'M' + (50 + 90 * i) + ' 25v265 M50 ' + (25 + 53 * i) + 'h450'
                }
                stroke="#29343d"
              />
              <text x={50 + 90 * i} y="309" textAnchor="middle">
                {fmt(i * 0.2)}
              </text>
              <text x="40" y={29 + 53 * i} textAnchor="end">
                {fmt(i * 0.2)}
              </text>
            </g>
          ))}
          <text x="270" y="329">
            x
          </text>
          <text x="10" y="150">
            y
          </text>
          {pair &&
            (() => {
              const [hx, hy] = plot(pair.hand),
                [px, py] = plot(pair.phone)
              return (
                <>
                  <path
                    d={'M' + hx + ' ' + hy + 'H' + px + 'V' + py}
                    stroke={color.cyan}
                    strokeDasharray="3 5"
                    fill="none"
                  />
                  <line
                    x1={hx}
                    y1={hy}
                    x2={px}
                    y2={py}
                    stroke={color.amber}
                    strokeWidth="2"
                  />
                  <circle cx={hx} cy={hy} r="6" fill={color.green} />
                  <circle cx={px} cy={py} r="6" fill={color.cyan} />
                  <text x={hx - 10} y={hy - 12} textAnchor="end">
                    Hand
                  </text>
                  <text x={px + 11} y={py + 16}>
                    Phone
                  </text>
                </>
              )
            })()}
        </svg>
        <div className="formula">
          <MathText value={String.raw`d = \sqrt{(x_p-x_h)^2+(y_p-y_h)^2}`} />
          {pair ? (
            <div className="measurements">
              <div>
                <span>Hand (x, y)</span>
                <b>{pair.hand.map((n) => fmt(n, 3)).join(', ')}</b>
              </div>
              <div>
                <span>Phone (x, y)</span>
                <b>{pair.phone.map((n) => fmt(n, 3)).join(', ')}</b>
              </div>
              <div>
                <span>Distance</span>
                <b>{fmt(dist, 4)} normalized</b>
              </div>
            </div>
          ) : (
            <Empty>Waiting for hand and phone coordinates</Empty>
          )}
        </div>
      </div>
      <Explanation
        simple="Subtract the coordinates to find horizontal and vertical displacement. Squaring, adding, and taking the square root gives the straight-line image distance."
        advanced="The axes are normalized independently. To measure distance in image pixels, multiply each component by its original frame dimension before taking the norm. Physical distance needs camera calibration and depth."
      />
    </Panel>
  )
}
function Probabilities() {
  const [threshold, setThreshold] = useState(0.75),
    frame = useLab((s) => s.data.frame_result),
    probabilities = frame?.probabilities
  const values = probabilities
    ? Object.entries(probabilities)
    : frame?.activity
      ? [[frame.activity.label, frame.activity.confidence] as [string, number]]
      : []
  return (
    <Panel
      title="Classification probabilities"
      caption={
        probabilities
          ? 'Reported distribution'
          : 'Reported class confidence when available'
      }
      action={<SourceBadge />}
    >
      <div className="form">
        <label>
          Inspection threshold <output>{pct(threshold)}</output>
          <input
            type="range"
            min="0"
            max="1"
            step=".01"
            value={threshold}
            onChange={(e) => setThreshold(+e.target.value)}
          />
        </label>
      </div>
      {values.length ? (
        <div className="bars">
          {values.map(([label, p]) => (
            <div key={label}>
              <span>{label}</span>
              <div>
                <i
                  style={{
                    width: p * 100 + '%',
                    background: p >= threshold ? color.green : color.cyan,
                  }}
                />
                <em style={{ left: threshold * 100 + '%' }} />
              </div>
              <b>{pct(p)}</b>
            </div>
          ))}
        </div>
      ) : (
        <Empty>No classification values received</Empty>
      )}
      <Explanation
        simple="A decision threshold specifies the minimum reported confidence to treat a prediction as sufficiently certain for a decision. The slider changes this inspection only."
        advanced="Calibration tests whether predictions assigned probability p are correct approximately p of the time. A model may rank classes well while producing poorly calibrated confidence values."
      />
    </Panel>
  )
}
function TreeNode({
  node,
  features,
}: {
  node: Tree
  features?: Record<string, number | null>
}) {
  const value = node.feature ? features?.[node.feature] : null
  return (
    <li>
      <span>
        {node.vote != null ? (
          'Vote · ' + node.vote
        ) : (
          <>
            {node.feature ?? 'Split'} ≤ {fmt(node.threshold, 3)}{' '}
            {value != null && <b> · input {fmt(value, 3)}</b>}
          </>
        )}
      </span>
      {(node.left || node.right) && (
        <ul>
          {node.left && <TreeNode node={node.left} features={features} />}
          {node.right && <TreeNode node={node.right} features={features} />}
        </ul>
      )}
    </li>
  )
}
function voteFor(
  tree: Tree,
  features: Record<string, number | null> | undefined,
): string | undefined {
  if (tree.vote != null) return tree.vote
  const value = tree.feature ? features?.[tree.feature] : null
  if (value == null || tree.threshold == null) return
  const child = value <= tree.threshold ? tree.left : tree.right
  return child ? voteFor(child, features) : undefined
}
function Forest() {
  const { internals, frame_result } = useLab((s) => s.data),
    [index, setIndex] = useState(0)
  const trees = internals?.trees ?? [],
    tree = trees[index] ?? trees[0],
    votes = new Map<string, number>()
  trees.forEach((t) => {
    const vote = voteFor(t, frame_result?.features)
    if (vote != null) votes.set(vote, (votes.get(vote) ?? 0) + 1)
  })
  return (
    <Panel
      title="Random Forest"
      caption="Feature splits, terminal votes, and ensemble behavior"
    >
      {tree ? (
        <>
          <div className="form">
            <label>
              Decision tree
              <select
                value={trees[index] ? index : 0}
                onChange={(e) => setIndex(+e.target.value)}
              >
                {trees.map((_, i) => (
                  <option value={i} key={i}>
                    Tree {i + 1}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ul className="tree">
            <TreeNode node={tree} features={frame_result?.features} />
          </ul>
          {votes.size ? (
            <div className="inset">
              {[...votes].map(([label, n]) => (
                <Status key={label} tone="cyan">
                  {label} · {n} of {trees.length} votes
                </Status>
              ))}
            </div>
          ) : (
            <Empty>Voting requires the current feature values</Empty>
          )}
        </>
      ) : (
        <Empty>Tree internals have not been supplied by the backend</Empty>
      )}
      <Explanation
        simple="Each tree compares one feature at a time with learned thresholds. A leaf supplies a vote, and the forest combines votes across trees."
        advanced="Some implementations average leaf class distributions instead of counting hard votes. Class weighting and tie handling can affect the final decision."
      />
    </Panel>
  )
}
function Network() {
  const internals = useLab((s) => s.data.internals),
    [selected, setSelected] = useState<{ layer: number; node: number } | null>(
      null,
    )
  const layers = internals?.layers ?? [],
    y = (l: number, n: number) =>
      30 + ((n + 1) * 250) / (layers[l].activations.length + 1),
    x = (l: number) => 80 + (l * 590) / Math.max(1, layers.length - 1)
  const selectedLayer = selected ? layers[selected.layer] : undefined,
    value =
      selectedLayer && selected
        ? selectedLayer.activations[selected.node]
        : undefined
  return (
    <Panel
      title="Neural network"
      caption="Reported layer activations and connection weights"
    >
      {layers.length ? (
        <>
          <div className="inset">
            <svg
              className="scientific-svg"
              viewBox="0 0 750 325"
              aria-label="Neural network diagram"
            >
              {layers.slice(1).map((l, i) =>
                l.activations.map((_, b) =>
                  layers[i].activations.map((a, j) => {
                    const w = internals?.weights?.[i]?.[j]?.[b]
                    return w == null ? null : (
                      <line
                        key={i + '-' + j + '-' + b}
                        x1={x(i)}
                        y1={y(i, j)}
                        x2={x(i + 1)}
                        y2={y(i + 1, b)}
                        stroke={a * w >= 0 ? color.cyan : color.amber}
                        opacity={Math.min(1, Math.abs(a * w))}
                        strokeWidth={
                          selected &&
                          ((selected.layer === i && selected.node === j) ||
                            (selected.layer === i + 1 && selected.node === b))
                            ? 3
                            : 1
                        }
                      >
                        <title>
                          Weight {fmt(w, 4)} · contribution {fmt(a * w, 4)}
                        </title>
                      </line>
                    )
                  }),
                ),
              )}
              {layers.map((l, i) => (
                <g key={i}>
                  <text x={x(i)} y="310" textAnchor="middle">
                    {l.name}
                  </text>
                  {l.activations.map((a, j) => (
                    <g
                      key={j}
                      role="button"
                      tabIndex={0}
                      aria-label={l.name + ' node ' + (j + 1)}
                      onClick={() => setSelected({ layer: i, node: j })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter')
                          setSelected({ layer: i, node: j })
                      }}
                    >
                      <circle
                        cx={x(i)}
                        cy={y(i, j)}
                        r="15"
                        fill={
                          selected?.layer === i && selected.node === j
                            ? color.green
                            : '#25343e'
                        }
                        stroke={color.cyan}
                      />
                      <title>{fmt(a, 4)}</title>
                    </g>
                  ))}
                </g>
              ))}
            </svg>
          </div>
          <p className="inset">
            {value != null
              ? selectedLayer?.name +
                ' · node ' +
                ((selected?.node ?? 0) + 1) +
                ' · activation ' +
                fmt(value, 6)
              : 'Select a node to inspect its activation.'}
          </p>
        </>
      ) : (
        <Empty>No network activations or weights received</Empty>
      )}
      <Explanation
        simple="A node applies an activation function to a weighted sum of inputs. Inspecting activations shows which values reached each layer."
        advanced="For incoming weights w and bias b, a neuron computes an activation of wᵀx + b. A softmax final layer converts logits into probabilities whose sum is one."
      />
    </Panel>
  )
}
function Descent() {
  const [rate, setRate] = useState(0.18),
    [steps, setSteps] = useState([3.6]),
    [playing, setPlaying] = useState(false)
  const next = () =>
    setSteps((s) =>
      s.length < 32 && Math.abs(s.at(-1)!) < 500
        ? [...s, s.at(-1)! * (1 - 2 * rate)]
        : s,
    )
  useEffect(() => {
    if (!playing) return
    const id = setInterval(next, 350)
    return () => clearInterval(id)
  }, [playing, rate])
  const x = steps.at(-1)!,
    limit = Math.max(4, Math.abs(x))
  const path = [
    ...new Set([
      ...Array.from({ length: 81 }, (_, i) => (i / 40 - 1) * limit),
      x,
    ]),
  ]
    .sort((a, b) => a - b)
    .map((parameter) => ({ parameter, loss: parameter * parameter }))
  const history = steps.map((q, i) => ({ step: i, loss: q * q, parameter: q }))
  return (
    <Panel
      title="Gradient descent"
      caption="Quadratic loss and the effect of the learning rate"
      action={<Status tone="amber">EDUCATIONAL SIMULATION</Status>}
    >
      <div className="split inset">
        <div className="formula">
          <MathText value={String.raw`L(w)=w^2,\quad L'(w)=2w`} />
          <MathText value={String.raw`w_{k+1}=w_k-\eta L'(w_k)`} />
          <label>
            Learning rate <output>{fmt(rate, 2)}</output>
            <input
              type="range"
              min=".01"
              max="1.25"
              step=".01"
              value={rate}
              onChange={(e) => setRate(+e.target.value)}
            />
          </label>
          <div className="actions">
            <button
              onClick={next}
              disabled={steps.length >= 32 || Math.abs(x) >= 500}
            >
              <StepForward size={15} /> Step
            </button>
            <button onClick={() => setPlaying(!playing)}>
              <Play size={15} /> {playing ? 'Pause' : 'Run'}
            </button>
            <button
              onClick={() => {
                setPlaying(false)
                setSteps([3.6])
              }}
            >
              <RotateCcw size={15} /> Reset
            </button>
          </div>
          <p>
            Step {steps.length - 1} · w = {fmt(x, 4)} · loss = {fmt(x * x, 4)} ·
            derivative = {fmt(2 * x, 4)}
          </p>
        </div>
        <Chart
          data={path}
          x="parameter"
          xLabel="Parameter w"
          yLabel="Loss"
          marker={{ x, y: x * x }}
          lines={[{ key: 'loss', label: 'Loss function', color: color.cyan }]}
        />
      </div>
      <Chart
        data={history}
        x="step"
        xLabel="Update step"
        lines={[
          { key: 'loss', label: 'Loss after update', color: color.green },
          { key: 'parameter', label: 'Parameter w', color: color.amber },
        ]}
      />
      <Explanation
        simple="The derivative gives the slope. Each update moves against the slope by a distance proportional to the learning rate. A large step can overshoot the minimum."
        advanced="For this quadratic, each update multiplies w by (1 − 2η). The iterates converge when 0 < η < 1, oscillate without shrinking at η = 1, and diverge for η > 1."
      />
    </Panel>
  )
}
function Temporal() {
  const samples = useLab((s) => s.samples),
    [window, setWindow] = useState(5),
    [threshold, setThreshold] = useState(0.8)
  const series = samples.map((s, i) => {
    const recent = samples
      .slice(Math.max(0, i - window + 1), i + 1)
      .filter((p) => p.label === s.label && p.confidence != null)
    return {
      ...s,
      average:
        s.confidence != null && recent.length
          ? recent.reduce((a, p) => a + (p.confidence ?? 0), 0) / recent.length
          : null,
      threshold,
    }
  })
  return (
    <Panel
      title="Temporal filtering"
      caption="Confidence trends, reported smoothing, and a local moving average"
      action={<SourceBadge />}
    >
      <div className="filters">
        <label>
          Average window{' '}
          <input
            type="range"
            min="2"
            max="30"
            value={window}
            onChange={(e) => setWindow(+e.target.value)}
          />
          <output>{window} samples</output>
        </label>
        <label>
          Threshold{' '}
          <input
            type="range"
            min=".2"
            max="1"
            step=".01"
            value={threshold}
            onChange={(e) => setThreshold(+e.target.value)}
          />
          <output>{pct(threshold)}</output>
        </label>
      </div>
      <Chart
        data={series}
        lines={[
          { key: 'confidence', label: 'Raw confidence', color: color.cyan },
          {
            key: 'smooth',
            label: 'Smoothed confidence (when supplied)',
            color: color.green,
          },
          { key: 'average', label: 'Sliding average', color: '#be9ce8' },
          {
            key: 'threshold',
            label: 'Threshold',
            color: color.amber,
            dash: '3 4',
          },
        ]}
        domain={[0, 1]}
        clock
      />
      <div className="inset">
        <MathText
          value={String.raw`\bar{p}_t=\frac{1}{m}\sum_{j=0}^{m-1}p_{t-j}`}
        />{' '}
        <span className="muted">
          {' '}
          · Current observation: {series.at(-1)?.label ?? 'Unknown'}
        </span>
      </div>
      <Explanation
        simple="The moving average combines recent samples for the currently reported class. It reduces short fluctuations and can respond more slowly to changes."
        advanced="A sliding average has a finite rectangular window. Exponential smoothing weights recent samples more heavily and trades response speed against noise reduction through its smoothing coefficient."
      />
    </Panel>
  )
}
