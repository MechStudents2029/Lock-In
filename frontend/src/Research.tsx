import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, CircleAlert, FlaskConical } from 'lucide-react'
import { routes, type Dataset, type Experiment, type Training } from './api'
import { request, useLab } from './state'
import { Chart, color, Empty, fmt, Heading, Panel, Status } from './ui'
export const architectures = [
  {
    id: 'A',
    name: 'YOLO + Rules',
    description:
      'Pretrained YOLO detections with programmed classification rules.',
  },
  {
    id: 'B',
    name: 'YOLO + Random Forest',
    description: 'YOLO features with a custom-trained tree ensemble.',
  },
  {
    id: 'C',
    name: 'YOLO + Neural Network',
    description: 'YOLO features with a custom-trained lightweight network.',
  },
]
export const metrics = [
  ['accuracy', 'Accuracy'],
  ['precision', 'Precision'],
  ['recall', 'Recall'],
  ['f1', 'F1 score'],
  ['fpr', 'False positive rate'],
  ['fnr', 'False negative rate'],
  ['latency_ms', 'Inference latency (ms)'],
  ['fps', 'Frames / second'],
  ['size_mb', 'Model size (MB)'],
  ['training_seconds', 'Training duration (s)'],
  ['gpu_memory_mb', 'GPU memory (MB)'],
] as const
export default function Research() {
  const { mode, data, link } = useLab()
  const [filter, setFilter] = useState('all'),
    [dataset, setDataset] = useState('all'),
    [metric, setMetric] = useState<string>('f1'),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState(''),
    [selected, setSelected] = useState<string[]>([])
  const history = data.experiments ?? []
  const filtered = history.filter(
    (r) =>
      (filter === 'all' || r.model_id === filter) &&
      (dataset === 'all' || r.dataset === dataset),
  )
  const compared = selected.length
    ? filtered.filter((r) => selected.includes(r.id))
    : architectures.flatMap(
        (a) => filtered.find((r) => r.model_id === a.id) ?? [],
      )
  const bars = compared.filter((r) => Number.isFinite(r.metrics[metric]))
  async function select(id: string) {
    if (!routes.selectModel) return
    setPending(true)
    setMessage('')
    try {
      await request(routes.selectModel, { model_id: id })
      setMessage('Selection sent. Active model updates from telemetry.')
    } catch (e) {
      setMessage(String(e))
    } finally {
      setPending(false)
    }
  }
  return (
    <>
      <Heading
        index="03 / EXPERIMENTATION"
        title="ML Research Lab"
        description="Compare evaluated architectures and inspect the evidence behind each run."
      />
      <div className="three">
        {architectures.map((a) => {
          const model = data.models?.models.find(
              (m) => m.id.toUpperCase() === a.id,
            ),
            hasResult = history.some((r) => r.model_id === a.id)
          return (
            <Panel
              key={a.id}
              title={a.name}
              action={<span className="model-letter">{a.id}</span>}
            >
              <div className="model-body">
                <p>{a.description}</p>
                <div className="flex flex-wrap gap-2">
                  <Status
                    tone={a.id === 'A' ? 'cyan' : hasResult ? 'green' : 'amber'}
                  >
                    {a.id === 'A'
                      ? 'Pretrained detector'
                      : hasResult || model?.available
                        ? 'Trained'
                        : model
                          ? 'Untrained / no checkpoint'
                          : 'Training status unknown'}
                  </Status>
                  <Status>
                    {model?.loaded
                      ? 'Loaded'
                      : model?.available
                        ? 'Available'
                        : 'Unavailable'}
                  </Status>
                </div>
                {model?.unavailable_reason && <p>{model.unavailable_reason}</p>}
                <button
                  disabled={
                    mode !== 'live' ||
                    link !== 'connected' ||
                    !routes.selectModel ||
                    !model?.available ||
                    model.loaded ||
                    pending
                  }
                  onClick={() => void select(model!.id)}
                >
                  {model?.loaded ? 'Active model' : 'Select model'}
                </button>
              </div>
            </Panel>
          )
        })}
      </div>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <Panel
        title="Architecture comparison"
        caption="Measured experiment results"
        className="spaced"
        action={<FlaskConical size={17} />}
      >
        <div className="filters">
          <label>
            Architecture{' '}
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All models</option>
              {architectures.map((a) => (
                <option key={a.id}>{a.id}</option>
              ))}
            </select>
          </label>
          <label>
            Dataset{' '}
            <select
              value={dataset}
              onChange={(e) => setDataset(e.target.value)}
            >
              <option value="all">All datasets</option>
              {[
                ...new Set(
                  history.flatMap((r) => (r.dataset ? [r.dataset] : [])),
                ),
              ].map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
          <label>
            Metric{' '}
            <select value={metric} onChange={(e) => setMetric(e.target.value)}>
              {metrics.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {bars.length ? (
          <div className="bars">
            {bars.map((r) => (
              <div key={r.id} title={r.name}>
                <span>
                  {r.model_id} · {r.name}
                </span>
                <div>
                  <i
                    style={{
                      width:
                        (Math.abs(r.metrics[metric]) /
                          Math.max(
                            ...bars.map((b) => Math.abs(b.metrics[metric])),
                            0.00001,
                          )) *
                          100 +
                        '%',
                    }}
                  />
                </div>
                <b>{fmt(r.metrics[metric], 3)}</b>
              </div>
            ))}
          </div>
        ) : (
          <Empty>No measured results for this selection</Empty>
        )}
      </Panel>
      <Panel title="Experiment history" className="spaced">
        {filtered.length ? (
          <div className="details-list">
            {filtered.map((r) => (
              <div key={r.id} className="experiment-row">
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(r.id)}
                    onChange={(e) =>
                      setSelected((s) =>
                        e.target.checked
                          ? [...s, r.id]
                          : s.filter((id) => id !== r.id),
                      )
                    }
                  />{' '}
                  Compare
                </label>
                <ExperimentDetail run={r} />
              </div>
            ))}
          </div>
        ) : (
          <Empty>
            Evaluated runs will appear when supplied by the local backend
          </Empty>
        )}
      </Panel>
    </>
  )
}
function ExperimentDetail({ run }: { run: Experiment }) {
  return (
    <details>
      <summary>
        {run.name}{' '}
        <small>
          {run.model_id} · {run.dataset ?? 'Dataset unavailable'}
        </small>
        <ChevronDown size={14} />
      </summary>
      <div className="detail-body">
        <div className="measurements">
          {metrics.map(([k, l]) => (
            <div key={k}>
              <span>{l}</span>
              <b>{fmt(run.metrics[k], 3)}</b>
            </div>
          ))}
        </div>
        {run.confusion_matrix?.length &&
        run.labels?.length === run.confusion_matrix.length ? (
          <div className="table-wrap">
            <table>
              <caption>
                Confusion matrix · rows actual, columns predicted
              </caption>
              <thead>
                <tr>
                  <th>Actual / predicted</th>
                  {run.labels.map((s) => (
                    <th key={s}>{s}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {run.confusion_matrix.map((row, i) => (
                  <tr key={i}>
                    <th>{run.labels![i]}</th>
                    {row.map((n, j) => (
                      <td key={j} className={i === j ? 'matched' : ''}>
                        {n}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No confusion matrix supplied</Empty>
        )}
      </div>
    </details>
  )
}
type MetricRow = {
  run_id: string
  name: string
  value: number
  step: number | null
}
export function Training() {
  const { data, trainingHistory, mode, link } = useLab()
  const [stored, setStored] = useState<MetricRow[]>([])
  const [model, setModel] = useState('B'),
    [dataset, setDataset] = useState(''),
    [epochs, setEpochs] = useState(30),
    [batch, setBatch] = useState(16),
    [rate, setRate] = useState(0.001),
    [runId, setRunId] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  useEffect(() => {
    setStored([])
    if (mode !== 'live' || link !== 'connected') return
    let disposed = false
    void request<MetricRow[]>('/api/v1/metrics?limit=5000')
      .then((rows) => {
        if (!disposed && Array.isArray(rows))
          setStored(
            rows.filter(
              (r) =>
                typeof r?.run_id === 'string' &&
                typeof r.name === 'string' &&
                Number.isFinite(r.value),
            ),
          )
      })
      .catch(() => undefined)
    return () => {
      disposed = true
    }
  }, [mode, link, data.training?.run_id, data.training?.state])
  const runs = useMemo(() => {
    const history = new Map<string, Training>()
    for (const r of stored) {
      if (!history.has(r.run_id))
        history.set(r.run_id, {
          run_id: r.run_id,
          epoch: r.step ?? 0,
          metrics: {},
          state: 'Stored metrics',
        })
    }
    for (const r of trainingHistory) history.set(r.run_id, r)
    return [...history.values()]
  }, [stored, trainingHistory])
  const run = runId
    ? runs.find((r) => r.run_id === runId)
    : (data.training ?? runs[0])
  const rows = new Map<number, Record<string, number>>()
  for (const row of [...stored].reverse()) {
    if (row.run_id !== run?.run_id || row.step == null) continue
    rows.set(row.step, { ...rows.get(row.step), [row.name]: row.value })
  }
  for (const r of trainingHistory) {
    if (r.run_id === run?.run_id)
      rows.set(r.epoch, { ...rows.get(r.epoch), ...r.metrics })
  }
  const curve = [...rows]
    .sort(([a], [b]) => a - b)
    .map(([epoch, m]) => ({
      epoch,
      loss: m.loss ?? m.train_loss,
      val_loss: m.val_loss,
    }))
    .filter((r) => r.loss != null || r.val_loss != null)
  const current = curve.at(-1),
    older = curve.at(-3),
    overfit =
      current?.loss != null &&
      older?.loss != null &&
      current.val_loss != null &&
      older.val_loss != null &&
      current.loss < older.loss &&
      current.val_loss > older.val_loss
  async function send(start: boolean) {
    const path = start ? routes.trainingStart : routes.trainingStop
    if (!path) return
    setBusy(true)
    setError('')
    try {
      await request(
        path,
        start
          ? {
              model_id: model,
              dataset_id: dataset,
              epochs,
              batch_size: batch,
              learning_rate: rate,
            }
          : { run_id: run?.run_id },
      )
      setError('Request accepted. Waiting for training telemetry.')
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Heading
        index="05 / TRAINING"
        title="Training Studio"
        description="Explore dataset provenance, configure runs, and inspect training telemetry."
      />
      <div className="split">
        <Panel title="Datasets" caption="Sources, licenses, and data quality">
          {data.datasets?.length ? (
            <div className="details-list">
              {data.datasets.map((d) => (
                <DatasetDetail d={d} key={d.id} />
              ))}
            </div>
          ) : (
            <Empty>No dataset catalog received</Empty>
          )}
        </Panel>
        <Panel
          title="Experiment configuration"
          action={
            <Status>
              {mode === 'live' && routes.trainingStart
                ? 'Backend configured'
                : 'Local draft'}
            </Status>
          }
        >
          <form
            className="form training-form"
            onSubmit={(e) => {
              e.preventDefault()
              void send(true)
            }}
          >
            <label>
              Architecture
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                {architectures
                  .filter((a) => a.id !== 'A')
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Dataset
              <select
                required
                value={dataset}
                onChange={(e) => setDataset(e.target.value)}
              >
                <option value="">Choose dataset</option>
                {data.datasets?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Epochs
              <input
                type="number"
                min="1"
                max="10000"
                required
                value={epochs}
                onChange={(e) => setEpochs(+e.target.value)}
              />
            </label>
            <label>
              Batch size
              <input
                type="number"
                min="1"
                required
                value={batch}
                onChange={(e) => setBatch(+e.target.value)}
              />
            </label>
            <label>
              Learning rate
              <input
                type="number"
                min=".000001"
                max="1"
                step="any"
                required
                value={rate}
                onChange={(e) => setRate(+e.target.value)}
              />
            </label>
            <div className="actions">
              <button
                className="primary"
                disabled={
                  busy ||
                  mode !== 'live' ||
                  link !== 'connected' ||
                  !routes.trainingStart ||
                  !dataset ||
                  data.training?.state === 'running'
                }
              >
                Start training
              </button>
              <button
                type="button"
                disabled={
                  busy ||
                  mode !== 'live' ||
                  link !== 'connected' ||
                  !routes.trainingStop ||
                  run?.state !== 'running'
                }
                onClick={() => void send(false)}
              >
                Stop run
              </button>
            </div>
            {error && <p role="status">{error}</p>}
          </form>
        </Panel>
      </div>
      <Panel
        title="Training telemetry"
        className="spaced"
        action={
          <label className="inline">
            Run{' '}
            <select value={runId} onChange={(e) => setRunId(e.target.value)}>
              <option value="">Latest available run</option>
              {runs.map((r) => (
                <option key={r.run_id}>{r.run_id}</option>
              ))}
            </select>
          </label>
        }
      >
        {run && (
          <div className="measurements inset">
            <div>
              <span>Architecture</span>
              <b>{run.model_id ?? '—'}</b>
            </div>
            <div>
              <span>Epoch</span>
              <b>
                {run.epoch} / {run.total_epochs ?? '—'}
              </b>
            </div>
            <div>
              <span>Status</span>
              <b>{run.state}</b>
            </div>
            <div>
              <span>GPU utilization</span>
              <b>
                {fmt(
                  run.metrics.gpu_util_percent ?? data.system?.gpu_util_percent,
                )}
              </b>
            </div>
            <div>
              <span>ETA (s)</span>
              <b>{fmt(run.metrics.eta_seconds, 0)}</b>
            </div>
            <div>
              <span>Learning rate</span>
              <b>{run.metrics.learning_rate ?? '—'}</b>
            </div>
            <div>
              <span>Batch size</span>
              <b>{run.metrics.batch_size ?? '—'}</b>
            </div>
          </div>
        )}
        <Chart
          data={curve}
          x="epoch"
          lines={[
            { key: 'loss', label: 'Training loss', color: color.green },
            { key: 'val_loss', label: 'Validation loss', color: color.cyan },
          ]}
          xLabel="Epoch"
        />
        {overfit && (
          <div className="notice inset">
            <CircleAlert size={15} /> Possible overfitting: training loss fell
            while validation loss rose over the displayed epochs.
          </div>
        )}
        {run?.message && <p className="inset">{run.message}</p>}
        {run && (
          <div className="inset">
            <strong>Checkpoints</strong>
            <p>{run.checkpoints?.join(' · ') || 'No checkpoints reported'}</p>
          </div>
        )}
      </Panel>
    </>
  )
}
function DatasetDetail({ d }: { d: Dataset }) {
  return (
    <details>
      <summary>
        {d.name}
        <small>{d.examples} examples</small>
        <ChevronDown size={14} />
      </summary>
      <div className="detail-body">
        <p>Source · {d.source}</p>
        <p>License · {d.license}</p>
        <p>Quality · {d.quality ?? 'Unavailable'}</p>
        <div className="measurements">
          {Object.entries(d.splits).map(([k, v]) => (
            <div key={k}>
              <span>{k}</span>
              <b>{v}</b>
            </div>
          ))}
        </div>
        <div className="bars">
          {Object.entries(d.classes).map(([k, v]) => (
            <div key={k}>
              <span>{k}</span>
              <div>
                <i
                  style={{ width: (v / Math.max(1, d.examples)) * 100 + '%' }}
                />
              </div>
              <b>{v}</b>
            </div>
          ))}
        </div>
      </div>
    </details>
  )
}
