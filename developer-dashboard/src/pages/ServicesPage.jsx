import React, { useState, useMemo, useRef, useCallback } from 'react'
import {
  LineChart, Line, AreaChart, Area,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
  CartesianGrid, ReferenceLine, Legend,
} from 'recharts'
import {
  Activity, AlertTriangle, CheckCircle, XCircle,
  Clock, Zap, Server, TrendingUp,
  ChevronRight, BarChart2, Cpu, Database,
  Flame, Play, Square, Shield,
} from 'lucide-react'
import { deriveServiceKeys, fmtMetric, injectFault, resetFault } from '../lib/api'
import { deriveServiceStatus, SERVICE_STATUS_CFG } from '../components/SystemStatus'

// ── Constants ─────────────────────────────────────────────────────────────────
const SLA = {
  order:        { maxErr: 0.01,  maxP99: 0.5  },
  payment:      { maxErr: 0.005, maxP99: 0.8  },
  inventory:    { maxErr: 0.01,  maxP99: 0.3  },
  shipping:     { maxErr: 0.02,  maxP99: 1.0  },
  delivery:     { maxErr: 0.02,  maxP99: 1.0  },
  notification: { maxErr: 0.02,  maxP99: 0.5  },
}

const SERVICE_COLOR = {
  order:        '#6366f1',
  payment:      '#22d3ee',
  inventory:    '#f59e0b',
  shipping:     '#34d399',
  delivery:     '#f97316',
  notification: '#a78bfa',
}

const SORT_OPTIONS = [
  { key: 'name',      label: 'Name'        },
  { key: 'status',    label: 'Status'      },
  { key: 'errorRate', label: 'Error Rate'  },
  { key: 'latency',   label: 'P99 Latency' },
]

const NOISE_ERR = 0.001
const NOISE_P99 = 0.005
const NOISE_RR  = 0.01

// ── Helpers ───────────────────────────────────────────────────────────────────
function toLabel(key) {
  if (!key) return ''
  return key.split(/[-_]/).map(w => w[0].toUpperCase() + w.slice(1)).join(' ') + ' Service'
}
function clean(v, floor = 0)  { return (v ?? 0) < floor ? 0 : (v ?? 0) }
function getPort(key) {
  return { order: 8081, payment: 8082, inventory: 8083, shipping: 8084, delivery: 8085, notification: 8086 }[key] ?? '?'
}

// ── Custom tooltip ────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-[10px] shadow-xl pointer-events-none min-w-[120px]">
      {label && <p className="text-slate-500 mb-1 font-mono">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="font-mono" style={{ color: p.color }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(4) : p.value}
        </p>
      ))}
    </div>
  )
}

// ── SLA progress bar ──────────────────────────────────────────────────────────
function SlaBar({ label, value, max, unit = '%' }) {
  const pct   = max > 0 ? Math.min(100, (value / max) * 100) : 0
  const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'
  const txt   = pct >= 90 ? 'text-red-400' : pct >= 70 ? 'text-amber-400' : 'text-emerald-400'
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px]">
        <span className="text-slate-500">{label}</span>
        <span className={`font-mono font-semibold ${txt}`}>{Math.round(pct)}{unit}</span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ── Metric box ────────────────────────────────────────────────────────────────
function MetricBox({ label, value, icon: Icon, warn = false, crit = false }) {
  return (
    <div className="bg-slate-800/50 rounded-lg p-3 space-y-1">
      <div className="flex items-center gap-1.5">
        <Icon size={10} className="text-slate-500" />
        <p className="text-[10px] text-slate-500">{label}</p>
      </div>
      <p className={`text-sm font-mono font-bold ${crit ? 'text-red-400' : warn ? 'text-amber-400' : 'text-slate-100'}`}>{value}</p>
    </div>
  )
}

// ── Fault injection control ───────────────────────────────────────────────────
function FaultControl({ serviceKey, faultState, onFaultChange }) {
  const [busy, setBusy] = useState(false)
  const active = faultState?.fault && faultState.fault !== 'NONE'

  async function inject(type, delayMs = 2000) {
    setBusy(true)
    await injectFault(serviceKey, type, delayMs)
    onFaultChange(serviceKey, { fault: type, delayMs })
    setBusy(false)
  }
  async function clear() {
    setBusy(true)
    await resetFault(serviceKey)
    onFaultChange(serviceKey, { fault: 'NONE', delayMs: 0 })
    setBusy(false)
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Fault Injection</p>
      {active ? (
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded bg-red-950/40 border border-red-800/50 text-red-300">
            <Flame size={10} /> {faultState.fault}{faultState.delayMs ? ` ${faultState.delayMs}ms` : ''}
          </span>
          <button onClick={clear} disabled={busy}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-40">
            <Square size={10} /> Clear
          </button>
        </div>
      ) : (
        <div className="flex gap-1.5 flex-wrap">
          {[
            { label: 'Latency +2s', type: 'LATENCY', delay: 2000 },
            { label: 'Errors',      type: 'ERROR',   delay: 0    },
            { label: 'Down',        type: 'DOWN',     delay: 0    },
          ].map(f => (
            <button key={f.type} onClick={() => inject(f.type, f.delay)} disabled={busy}
              className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded border border-slate-700 text-slate-400 hover:border-red-800 hover:text-red-400 hover:bg-red-950/20 transition-colors disabled:opacity-40">
              <Play size={8} /> {f.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── ① COMPARATIVE MULTI-SERVICE CHART ────────────────────────────────────────
// Shows all services in one graph, different colour per line.
// metric: 'error_rate' | 'p99' | 'request_rate'
function ComparativeChart({ metricHistory, serviceKeys, metric, title, unit, slaMap }) {
  // Build unified time series: each point has a slot per service
  const chartData = useMemo(() => {
    // Find max length across all services
    const maxLen = Math.max(...serviceKeys.map(k => (metricHistory[k] ?? []).length), 0)
    if (maxLen === 0) return []

    // Align all series to same length by padding from the left with nulls
    const aligned = {}
    serviceKeys.forEach(k => {
      const arr = metricHistory[k] ?? []
      const pad = maxLen - arr.length
      aligned[k] = [...Array(pad).fill(null), ...arr]
    })

    return Array.from({ length: maxLen }, (_, i) => {
      // Use the time label from whichever service has data at this index
      let time = ''
      for (const k of serviceKeys) {
        const snap = aligned[k][i]
        if (snap && snap.time) { time = snap.time; break }
      }
      const pt = { time }
      serviceKeys.forEach(k => {
        const snap = aligned[k][i]
        const raw  = snap ? (snap[metric] ?? 0) : null
        // Apply noise floor — show null (gap) when value is below threshold so
        // chart doesn't draw a spurious flat zero line; shows actual gaps instead
        pt[k] = raw === null ? null
              : metric === 'error_rate' && raw < NOISE_ERR ? 0
              : metric === 'p99'        && raw < NOISE_P99 ? 0
              : metric === 'request_rate' && raw < NOISE_RR ? 0
              : parseFloat(raw.toFixed(5))
      })
      return pt
    })
  }, [metricHistory, serviceKeys, metric])

  // Highest SLA line across all services for reference
  const maxSlaVal = slaMap
    ? Math.min(...serviceKeys.map(k => slaMap[k] ?? Infinity).filter(v => v < Infinity))
    : null

  if (chartData.length < 2) {
    return (
      <div className="h-44 flex items-center justify-center rounded-lg bg-slate-800/30 border border-slate-800">
        <p className="text-[11px] text-slate-600 italic">Collecting history… ({chartData.length} points)</p>
      </div>
    )
  }

  // Show every Nth label so the x-axis isn't crowded
  const tickInterval = Math.max(1, Math.floor(chartData.length / 6))

  return (
    <div className="h-52">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 8, fill: '#475569' }}
            interval={tickInterval}
            tickLine={false}
          />
          <YAxis tick={{ fontSize: 8, fill: '#475569' }} tickLine={false} />
          <Tooltip content={<ChartTooltip />} />
          <Legend
            iconSize={8}
            wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
            formatter={v => toLabel(v).replace(' Service', '')}
          />
          {/* SLA reference line */}
          {maxSlaVal != null && maxSlaVal < Infinity && (
            <ReferenceLine
              y={maxSlaVal}
              stroke="#f59e0b"
              strokeDasharray="4 3"
              strokeWidth={1}
              label={{ value: 'SLA', position: 'insideTopRight', fontSize: 9, fill: '#f59e0b' }}
            />
          )}
          {serviceKeys.map(k => (
            <Line
              key={k}
              type="monotone"
              dataKey={k}
              name={k}
              stroke={SERVICE_COLOR[k] ?? '#64748b'}
              strokeWidth={1.8}
              dot={false}
              isAnimationActive={false}
              connectNulls={false}   // gaps stay as gaps — no spurious straight lines
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── ② SINGLE-SERVICE HISTORY CHART ───────────────────────────────────────────
// Persistent 120-point buffer — never clears on backend recovery flush.
function ServiceHistoryChart({ snapshots, metric, color, title, unit, slaLine }) {
  const data = useMemo(() => (snapshots ?? []).map((s, i) => ({
    i,
    time: s.time ?? '',
    v: (() => {
      const raw = s[metric] ?? 0
      if (metric === 'error_rate'   && raw < NOISE_ERR) return 0
      if (metric === 'p99'          && raw < NOISE_P99) return 0
      if (metric === 'request_rate' && raw < NOISE_RR)  return 0
      return parseFloat(raw.toFixed(5))
    })(),
  })), [snapshots, metric])

  const tickInterval = Math.max(1, Math.floor(data.length / 5))

  if (data.length < 2) {
    return (
      <div className="h-28 flex items-center justify-center bg-slate-800/30 rounded-lg border border-slate-800">
        <p className="text-[10px] text-slate-600 italic">Collecting…</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-[11px] text-slate-400 font-semibold">{title}</p>
        <div className="flex items-center gap-3 text-[10px]">
          {slaLine != null && (
            <span className="text-amber-500 font-mono">SLA: {slaLine}{unit}</span>
          )}
          <span className="text-slate-600 font-mono">{data.length} pts</span>
        </div>
      </div>
      <div className="h-28 bg-slate-800/30 rounded-lg border border-slate-800 p-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 2, right: 4, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id={`grad-${metric}-${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={color} stopOpacity={0.35} />
                <stop offset="95%" stopColor={color} stopOpacity={0}    />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="time" tick={{ fontSize: 7, fill: '#475569' }} interval={tickInterval} tickLine={false} />
            <YAxis tick={{ fontSize: 7, fill: '#475569' }} tickLine={false} />
            <Tooltip content={<ChartTooltip />} />
            {slaLine != null && (
              <ReferenceLine y={slaLine} stroke="#f59e0b" strokeDasharray="3 3" strokeWidth={1} />
            )}
            <Area
              type="monotone"
              dataKey="v"
              name={title}
              stroke={color}
              fill={`url(#grad-${metric}-${color.replace('#','')})`}
              strokeWidth={1.8}
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── Grid card (left column) ───────────────────────────────────────────────────
function ServiceGridCard({ serviceKey, metrics, snapshots, selected, onClick, faultState }) {
  const status = deriveServiceStatus(metrics)
  const cfg    = SERVICE_STATUS_CFG[status] ?? SERVICE_STATUS_CFG.UNKNOWN
  const color  = SERVICE_COLOR[serviceKey] ?? '#6366f1'
  const err    = clean(metrics?.error_rate_5xx, NOISE_ERR)
  const p99    = clean(metrics?.p99_latency_s, NOISE_P99)
  const rr     = clean(metrics?.request_rate, NOISE_RR)
  const sla    = SLA[serviceKey] ?? { maxErr: 0.01, maxP99: 1.0 }

  // Sparkline from live snapshots
  const spark = (snapshots ?? []).slice(-30).map(s => ({
    v: clean(s.error_rate, NOISE_ERR)
  }))

  return (
    <button onClick={onClick} className={[
      'w-full text-left rounded-xl border p-3.5 transition-all duration-150 space-y-2.5',
      selected
        ? 'border-indigo-600/70 ring-1 ring-indigo-600/30 bg-slate-800/80'
        : 'border-slate-800 bg-slate-900 hover:border-slate-700 hover:bg-slate-800/50',
    ].join(' ')}>

      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
          <span className="text-xs font-semibold text-slate-200 truncate">
            {toLabel(serviceKey).replace(' Service', '')}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {faultState?.fault && faultState.fault !== 'NONE' && (
            <Flame size={10} className="text-red-400" />
          )}
          <span className={`flex items-center gap-1 text-[10px] font-semibold ${cfg.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${status === 'DOWN' ? 'animate-pulse' : ''}`} />
            {cfg.label}
          </span>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <div>
          <p className="text-slate-500">Err Rate</p>
          <p className={`font-mono font-bold ${err > sla.maxErr ? 'text-red-400' : 'text-slate-200'}`}>
            {err === 0 ? '0/s' : fmtMetric(err, 'rate')}
          </p>
        </div>
        <div>
          <p className="text-slate-500">P99</p>
          <p className={`font-mono font-bold ${p99 > sla.maxP99 ? 'text-amber-400' : 'text-slate-200'}`}>
            {p99 === 0 ? '0ms' : fmtMetric(p99, 'latency')}
          </p>
        </div>
      </div>

      {/* Mini sparkline */}
      {spark.length > 2 ? (
        <div className="h-7">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`sp-${serviceKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={color} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={color} stopOpacity={0}   />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={color} fill={`url(#sp-${serviceKey})`}
                strokeWidth={1.4} dot={false} isAnimationActive={false} connectNulls={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-7 flex items-center">
          <p className="text-[10px] text-slate-700 italic">No history yet</p>
        </div>
      )}

      <div className="flex items-center justify-between text-[10px] text-slate-500">
        <span>Req: {rr === 0 ? '0/s' : fmtMetric(rr, 'rate')}</span>
        <ChevronRight size={11} className={selected ? 'text-indigo-400' : ''} />
      </div>
    </button>
  )
}

// ── Detail panel (right column) ───────────────────────────────────────────────
function ServiceDetailPanel({ serviceKey, metrics, snapshots, incidents, slaData, faultState, onFaultChange }) {
  const [tab, setTab] = useState('charts')
  const status = deriveServiceStatus(metrics)
  const cfg    = SERVICE_STATUS_CFG[status] ?? SERVICE_STATUS_CFG.UNKNOWN
  const color  = SERVICE_COLOR[serviceKey] ?? '#6366f1'
  const sla    = SLA[serviceKey] ?? { maxErr: 0.01, maxP99: 1.0 }

  const err    = clean(metrics?.error_rate_5xx, NOISE_ERR)
  const p99    = clean(metrics?.p99_latency_s, NOISE_P99)
  const p50    = clean(metrics?.p50_latency_s, NOISE_P99)
  const rr     = clean(metrics?.request_rate, NOISE_RR)
  const heap   = metrics?.jvm_heap_mb ?? 0
  const thrd   = metrics?.active_threads ?? 0
  const svcSla = slaData?.services?.[serviceKey]
  const svcIncidents = (incidents ?? []).filter(e => e.service === serviceKey).slice(0, 12)
  const activeIncident = svcIncidents.find(e => e.reason !== 'RESOLVED')

  const TABS = [
    { id: 'charts',    label: 'History Charts' },
    { id: 'overview',  label: 'Overview'       },
    { id: 'sla',       label: 'SLA'            },
    { id: 'incidents', label: 'Incidents'      },
    { id: 'fault',     label: '⚡ Fault'       },
  ]

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden flex flex-col">

      {/* Header */}
      <div className={`px-5 py-4 border-b border-slate-800 ${status === 'DOWN' ? 'bg-red-950/20' : activeIncident ? 'bg-amber-950/10' : ''}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${color}20`, border: `1px solid ${color}40` }}>
              <Server size={14} style={{ color }} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100">{toLabel(serviceKey)}</h2>
              <p className="text-[11px] text-slate-500 font-mono">:{getPort(serviceKey)} · {(snapshots ?? []).length} history pts</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {faultState?.fault && faultState.fault !== 'NONE' && (
              <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-red-950/40 border border-red-800/50 text-red-300">
                <Flame size={10} /> FAULT
              </span>
            )}
            <span className={`flex items-center gap-1.5 text-xs font-bold ${cfg.text}`}>
              <span className={`w-2 h-2 rounded-full ${cfg.dot} ${status === 'DOWN' ? 'animate-pulse' : ''}`} />
              {cfg.label}
            </span>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-3 gap-3 mt-3">
          {[
            { label: 'Error Rate',  value: err  === 0 ? '0/s'  : fmtMetric(err, 'rate'),    warn: err  > sla.maxErr,  crit: err  > sla.maxErr * 5  },
            { label: 'P99 Latency', value: p99  === 0 ? '0ms'  : fmtMetric(p99, 'latency'), warn: p99  > sla.maxP99,  crit: p99  > sla.maxP99 * 2  },
            { label: 'Req Rate',    value: rr   === 0 ? '0/s'  : fmtMetric(rr, 'rate'),     warn: false,              crit: false                   },
          ].map(k => (
            <div key={k.label} className="bg-slate-800/50 rounded-lg px-3 py-2">
              <p className="text-[10px] text-slate-500 mb-1">{k.label}</p>
              <p className={`text-sm font-mono font-bold ${k.crit ? 'text-red-400' : k.warn ? 'text-amber-400' : 'text-slate-100'}`}>{k.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-slate-800 px-1 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-3 py-2.5 text-[11px] font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${
              tab === t.id ? 'border-indigo-500 text-indigo-300' : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-4 space-y-4 overflow-y-auto max-h-[520px]">

        {/* ── Charts tab ── */}
        {tab === 'charts' && (
          <>
            {activeIncident && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-950/30 border border-amber-800/40 text-xs">
                <AlertTriangle size={12} className="text-amber-400 shrink-0 mt-0.5" />
                <span className="text-amber-300">
                  <span className="font-semibold">{activeIncident.reason?.replace(/_/g, ' ')}</span>
                  {activeIncident.value != null && <span className="ml-2 font-mono text-amber-400">{activeIncident.metric}: {activeIncident.value}</span>}
                </span>
              </div>
            )}

            <ServiceHistoryChart
              snapshots={snapshots}
              metric="error_rate"
              color={color}
              title="Error Rate /s"
              unit="/s"
              slaLine={sla.maxErr}
            />
            <ServiceHistoryChart
              snapshots={snapshots}
              metric="p99"
              color="#f59e0b"
              title="P99 Latency (s)"
              unit="s"
              slaLine={sla.maxP99}
            />
            <ServiceHistoryChart
              snapshots={snapshots}
              metric="request_rate"
              color="#34d399"
              title="Request Rate /s"
              unit="/s"
              slaLine={null}
            />
          </>
        )}

        {/* ── Overview tab ── */}
        {tab === 'overview' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <MetricBox label="Request Rate"   value={rr   === 0 ? '0/s'  : fmtMetric(rr, 'rate')}    icon={TrendingUp} />
            <MetricBox label="Error Rate"     value={err  === 0 ? '0/s'  : fmtMetric(err, 'rate')}   icon={AlertTriangle} warn={err > sla.maxErr} />
            <MetricBox label="P50 Latency"    value={p50  === 0 ? '0ms'  : fmtMetric(p50, 'latency')} icon={Clock} />
            <MetricBox label="P99 Latency"    value={p99  === 0 ? '0ms'  : fmtMetric(p99, 'latency')} icon={Clock} warn={p99 > sla.maxP99} />
            <MetricBox label="JVM Heap"       value={heap > 0 ? `${Math.round(heap)} MB` : '—'}       icon={Cpu} />
            <MetricBox label="Active Threads" value={thrd > 0 ? String(thrd) : '0'}                   icon={Database} />
          </div>
        )}

        {/* ── SLA tab ── */}
        {tab === 'sla' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Shield size={13} className={svcSla?.sla_compliant === false ? 'text-red-400' : 'text-emerald-400'} />
              <span className={`text-xs font-semibold ${svcSla?.sla_compliant === false ? 'text-red-300' : 'text-emerald-300'}`}>
                {svcSla?.sla_compliant === false ? `BREACHED (${svcSla.breach_count} violation${svcSla.breach_count !== 1 ? 's' : ''})` : 'Within SLA'}
              </span>
            </div>
            <div className="space-y-3">
              <SlaBar label="Uptime"                                      value={metrics?.service_up === 0 ? 0 : 100} max={100} />
              <SlaBar label={`Error Budget (limit: ${sla.maxErr}/s)`}    value={err} max={sla.maxErr} />
              <SlaBar label={`Latency Budget (limit: ${sla.maxP99}s)`}   value={p99} max={sla.maxP99} />
            </div>
            {svcSla?.breaches?.length > 0 && (
              <div className="space-y-1.5">
                {svcSla.breaches.map((b, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px] bg-red-950/20 border border-red-900/40 rounded-md px-3 py-2">
                    <AlertTriangle size={11} className="text-red-400 shrink-0 mt-0.5" />
                    <span className="text-red-300">{b.message}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="bg-slate-800/40 rounded-lg p-3 text-[11px] space-y-1.5">
              <p className="text-slate-400 font-semibold mb-2">SLA Targets</p>
              {[
                { l: 'Uptime',       v: '≥ 99%'             },
                { l: 'Max P99',      v: `≤ ${sla.maxP99}s`  },
                { l: 'Max Err Rate', v: `≤ ${sla.maxErr}/s` },
              ].map(t => (
                <div key={t.l} className="flex justify-between font-mono">
                  <span className="text-slate-500">{t.l}</span>
                  <span className="text-slate-300">{t.v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Incidents tab ── */}
        {tab === 'incidents' && (
          svcIncidents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 space-y-2">
              <CheckCircle size={28} className="text-emerald-500/50" />
              <p className="text-sm text-slate-500">No incidents for this service</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {svcIncidents.map((e, i) => {
                const resolved = e.reason === 'RESOLVED'
                return (
                  <div key={e.id ?? i} className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border text-xs ${
                    resolved ? 'bg-slate-800/30 border-slate-800 text-slate-500' : 'bg-amber-950/20 border-amber-900/40 text-slate-300'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${resolved ? 'bg-slate-600' : 'bg-amber-500'}`} />
                    <div className="flex-1 min-w-0">
                      <span className={`font-semibold text-[11px] ${resolved ? 'text-slate-500' : 'text-amber-300'}`}>
                        {e.reason?.replace(/_/g, ' ')}
                      </span>
                      {e.metric && e.value != null && (
                        <span className="ml-2 font-mono text-[10px] text-slate-500">{e.metric}: {e.value}</span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-600 font-mono shrink-0">{e.ts?.split(' ')[1] ?? e.ts}</span>
                  </div>
                )
              })}
            </div>
          )
        )}

        {/* ── Fault tab ── */}
        {tab === 'fault' && (
          <div className="space-y-4">
            <FaultControl serviceKey={serviceKey} faultState={faultState} onFaultChange={onFaultChange} />
            <div className="bg-slate-800/40 rounded-lg p-3 text-[11px] text-slate-400 space-y-2">
              <p className="font-semibold text-slate-300">Fault types</p>
              <p><span className="text-amber-300 font-semibold">LATENCY</span> — adds 2s delay to every request, simulates DB slowdown.</p>
              <p><span className="text-orange-300 font-semibold">ERROR</span> — forces HTTP 500, triggers cascade detection.</p>
              <p><span className="text-red-300 font-semibold">DOWN</span> — returns HTTP 503, simulates full service crash.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Comparison table ──────────────────────────────────────────────────────────
function ComparisonTable({ serviceKeys, liveMetrics, cascadePath, rootCauses }) {
  const rootSet    = new Set((rootCauses ?? []).map(c => c.service))
  const cascadeSet = new Set(cascadePath ?? [])
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">All Services — Side-by-Side</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-800">
              {['Service', 'Status', 'Error Rate', 'P99 Latency', 'Req Rate'].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-[10px] text-slate-500 font-semibold uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {serviceKeys.map(key => {
              const m      = liveMetrics[key]
              const status = deriveServiceStatus(m)
              const cfg    = SERVICE_STATUS_CFG[status] ?? SERVICE_STATUS_CFG.UNKNOWN
              const err    = clean(m?.error_rate_5xx, NOISE_ERR)
              const p99    = clean(m?.p99_latency_s, NOISE_P99)
              const rr     = clean(m?.request_rate, NOISE_RR)
              const sla    = SLA[key] ?? { maxErr: 0.01, maxP99: 1.0 }
              const color  = SERVICE_COLOR[key] ?? '#6366f1'
              return (
                <tr key={key} className={`border-b border-slate-800/60 transition-colors ${
                  rootSet.has(key) ? 'bg-red-950/10' : cascadeSet.has(key) ? 'bg-amber-950/10' : 'hover:bg-slate-800/20'
                }`}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      <span className="font-medium text-slate-200">{toLabel(key).replace(' Service', '')}</span>
                      {rootSet.has(key) && <span className="text-[9px] px-1 rounded bg-red-950 text-red-400 border border-red-800">ROOT</span>}
                      {cascadeSet.has(key) && !rootSet.has(key) && (
                        <span className="text-[9px] px-1 rounded bg-amber-950 text-amber-400 border border-amber-800">#{cascadePath.indexOf(key)+1}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`flex items-center gap-1 ${cfg.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                      {cfg.label}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono">
                    <span className={err > sla.maxErr ? 'text-red-400 font-bold' : 'text-slate-300'}>
                      {err === 0 ? '0/s' : fmtMetric(err, 'rate')}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono">
                    <span className={p99 > sla.maxP99 ? 'text-amber-400 font-bold' : 'text-slate-300'}>
                      {p99 === 0 ? '0ms' : fmtMetric(p99, 'latency')}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-slate-300">
                    {rr === 0 ? '0/s' : fmtMetric(rr, 'rate')}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ServicesPage({ data, metricHistory, loading }) {
  const liveMetrics = data?.live_metrics  ?? {}
  const incidents   = data?.incident_log  ?? []
  const slaData     = data?.sla_compliance ?? {}
  const cascadePath = data?.cascade_path  ?? []
  const rootCauses  = data?.root_cause    ?? []
  const serviceKeys = deriveServiceKeys(liveMetrics)

  const [selected,    setSelected]    = useState(null)
  const [sortBy,      setSortBy]      = useState('name')
  const [filterStat,  setFilterStat]  = useState('ALL')
  const [faultStates, setFaultStates] = useState({})
  const [compMetric,  setCompMetric]  = useState('error_rate')

  const activeKey    = selected ?? serviceKeys[0] ?? null
  const detailRef    = useRef(null)

  // Select a card and scroll the detail panel into view smoothly
  const handleSelect = useCallback((key) => {
    setSelected(key)
    // Small timeout lets React re-render the panel before scrolling
    setTimeout(() => {
      detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
  }, [])

  // Sort + filter
  const sorted = useMemo(() => {
    const statusOrder = { DOWN: 0, DEGRADED: 1, WARNING: 2, HEALTHY: 3, UNKNOWN: 4 }
    return [...serviceKeys]
      .filter(k => filterStat === 'ALL' || deriveServiceStatus(liveMetrics[k]) === filterStat)
      .sort((a, b) => {
        const ma = liveMetrics[a], mb = liveMetrics[b]
        switch (sortBy) {
          case 'status':    return (statusOrder[deriveServiceStatus(ma)] ?? 9) - (statusOrder[deriveServiceStatus(mb)] ?? 9)
          case 'errorRate': return clean(mb?.error_rate_5xx) - clean(ma?.error_rate_5xx)
          case 'latency':   return clean(mb?.p99_latency_s, NOISE_P99) - clean(ma?.p99_latency_s, NOISE_P99)
          default:          return a.localeCompare(b)
        }
      })
  }, [serviceKeys, liveMetrics, sortBy, filterStat])

  function handleFaultChange(k, state) {
    setFaultStates(prev => ({ ...prev, [k]: state }))
  }

  const downCount    = serviceKeys.filter(k => deriveServiceStatus(liveMetrics[k]) === 'DOWN').length
  const warningCount = serviceKeys.filter(k => ['WARNING', 'DEGRADED'].includes(deriveServiceStatus(liveMetrics[k]))).length
  const healthyCount = serviceKeys.filter(k => deriveServiceStatus(liveMetrics[k]) === 'HEALTHY').length

  // SLA map for comparative chart reference lines
  const slaLineMap = {
    error_rate:   Object.fromEntries(serviceKeys.map(k => [k, SLA[k]?.maxErr ?? 0.01])),
    p99:          Object.fromEntries(serviceKeys.map(k => [k, SLA[k]?.maxP99 ?? 1.0])),
    request_rate: null,
  }

  if (loading && !serviceKeys.length) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-slate-800/50 rounded animate-pulse" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[1,2,3,4,5,6].map(n => <div key={n} className="h-44 rounded-xl bg-slate-800/50 animate-pulse" />)}
        </div>
      </div>
    )
  }

  const COMP_METRICS = [
    { key: 'error_rate',   label: 'Error Rate'   },
    { key: 'p99',          label: 'P99 Latency'  },
    { key: 'request_rate', label: 'Request Rate' },
  ]

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold text-slate-100">Services</h1>
          <div className="flex items-center gap-3 mt-1 text-[11px]">
            {downCount > 0    && <span className="flex items-center gap-1 text-red-400"><XCircle size={11} /> {downCount} down</span>}
            {warningCount > 0 && <span className="flex items-center gap-1 text-amber-400"><AlertTriangle size={11} /> {warningCount} degraded</span>}
            <span className="flex items-center gap-1 text-emerald-400"><CheckCircle size={11} /> {healthyCount} healthy</span>
            <span className="text-slate-600">{serviceKeys.length} total</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {['ALL', 'DOWN', 'DEGRADED', 'WARNING', 'HEALTHY'].map(s => (
            <button key={s} onClick={() => setFilterStat(s)}
              className={`text-[10px] px-2 py-1 rounded border transition-colors ${filterStat === s ? 'border-indigo-700 bg-indigo-900/50 text-indigo-300' : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300'}`}>
              {s}
            </button>
          ))}
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
            className="text-[11px] bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-300 focus:outline-none focus:border-indigo-600">
            {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>Sort: {o.label}</option>)}
          </select>
        </div>
      </div>

      {/* ── Comparative multi-service chart ── */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs font-semibold text-slate-300">All Services — Comparative History</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Each colour = one service · dashed line = SLA limit · gaps = no traffic</p>
          </div>
          <div className="flex items-center gap-1.5 bg-slate-800/60 rounded-lg border border-slate-700 p-0.5">
            {COMP_METRICS.map(m => (
              <button key={m.key} onClick={() => setCompMetric(m.key)}
                className={`text-[11px] px-3 py-1 rounded-md transition-colors ${compMetric === m.key ? 'bg-indigo-700 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <ComparativeChart
          metricHistory={metricHistory}
          serviceKeys={serviceKeys}
          metric={compMetric}
          title={COMP_METRICS.find(m => m.key === compMetric)?.label ?? ''}
          unit=""
          slaMap={slaLineMap[compMetric]}
        />
      </div>

      {/* ── Grid + detail ── */}
      {sorted.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-8 text-center">
          <p className="text-sm text-slate-500">No services match the filter</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-start">
          {/* Service cards column */}
          <div className="lg:col-span-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
            {sorted.map(key => (
              <ServiceGridCard
                key={key}
                serviceKey={key}
                metrics={liveMetrics[key]}
                snapshots={metricHistory[key] ?? []}
                selected={activeKey === key}
                onClick={() => handleSelect(key)}
                faultState={faultStates[key]}
              />
            ))}
          </div>

          {/* Detail panel */}
          <div className="lg:col-span-3" ref={detailRef}>
            {activeKey ? (
              <ServiceDetailPanel
                serviceKey={activeKey}
                metrics={liveMetrics[activeKey]}
                snapshots={metricHistory[activeKey] ?? []}
                incidents={incidents}
                slaData={slaData}
                faultState={faultStates[activeKey]}
                onFaultChange={handleFaultChange}
              />
            ) : (
              <div className="rounded-xl border border-slate-800 bg-slate-900 h-48 flex items-center justify-center">
                <p className="text-xs text-slate-500 italic">Select a service to view history</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Comparison table ── */}
      {serviceKeys.length > 0 && (
        <ComparisonTable
          serviceKeys={sorted}
          liveMetrics={liveMetrics}
          cascadePath={cascadePath}
          rootCauses={rootCauses}
        />
      )}

    </div>
  )
}
