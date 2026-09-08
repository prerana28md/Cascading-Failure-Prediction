import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  AlertTriangle, CheckCircle, XCircle, Activity, Zap,
  ArrowRight, RefreshCw, Server, Clock, TrendingUp, TrendingDown,
  ShieldAlert, Lightbulb, GitBranch, Database, Info,
  Network, Cpu, Layers, BarChart2, AlertCircle, ExternalLink,
  Terminal, Play, Square, ChevronDown, ChevronUp, Gauge,
  Bell, BookOpen, Shield, Target, Eye, Wifi, WifiOff,
  MemoryStick, Flame, Wrench, CheckSquare
} from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  RadialBarChart, RadialBar, Legend, ReferenceLine
} from 'recharts'

// ── Constants ─────────────────────────────────────────────────────────────────
const API_BASE         = '/api'
const POLL_INTERVAL_MS = 8000

const SERVICES = ['order', 'payment', 'inventory', 'shipping', 'delivery', 'notification']
const SERVICE_LABELS = {
  order:        'Order Service',
  payment:      'Payment Service',
  inventory:    'Inventory Service',
  shipping:     'Shipping Service',
  delivery:     'Delivery Service',
  notification: 'Notification Service',
}
const SERVICE_COLORS = {
  order:        '#6366f1',
  payment:      '#22d3ee',
  inventory:    '#f59e0b',
  shipping:     '#34d399',
  delivery:     '#f97316',
  notification: '#a78bfa',
}

const NODE_POSITIONS = {
  order:        { x: 260, y: 55  },
  inventory:    { x: 80,  y: 175 },
  payment:      { x: 260, y: 175 },
  shipping:     { x: 440, y: 175 },
  delivery:     { x: 440, y: 295 },
  notification: { x: 170, y: 295 },
}

const NAV_SECTIONS = [
  { id: 'overview',      label: 'Overview',        icon: Gauge      },
  { id: 'observability', label: 'Observability',   icon: Layers     },
  { id: 'graph',         label: 'Dependency Graph',icon: Network    },
  { id: 'sla',           label: 'SLA Compliance',  icon: Target     },
  { id: 'anomaly',       label: 'Anomaly Engine',  icon: AlertCircle},
  { id: 'incidents',     label: 'Incident Log',    icon: Bell       },
  { id: 'fault',         label: 'Fault Injection', icon: Wrench     },
  { id: 'recs',          label: 'Recommendations', icon: Lightbulb  },
]

// ── Colour helpers ─────────────────────────────────────────────────────────────
const riskColour = l => ({ CRITICAL:'text-red-400', HIGH:'text-orange-400', MEDIUM:'text-yellow-400', LOW:'text-green-400' }[l] || 'text-slate-400')
const riskBg     = l => ({ CRITICAL:'bg-red-500/10 border-red-500/40', HIGH:'bg-orange-500/10 border-orange-500/40', MEDIUM:'bg-yellow-500/10 border-yellow-500/40', LOW:'bg-green-500/10 border-green-500/40' }[l] || 'bg-slate-800 border-slate-700')
const riskBar    = l => ({ CRITICAL:'bg-red-500', HIGH:'bg-orange-500', MEDIUM:'bg-yellow-500', LOW:'bg-green-500' }[l] || 'bg-slate-500')
const sevColour  = s => ({ CRITICAL:'text-red-400 bg-red-950 border-red-800', HIGH:'text-orange-400 bg-orange-950 border-orange-800', MEDIUM:'text-yellow-400 bg-yellow-950 border-yellow-800', LOW:'text-green-400 bg-green-950 border-green-800' }[s] || 'text-slate-400 bg-slate-800 border-slate-700')
const catColour  = c => ({ IMMEDIATE:'bg-red-900/30 text-red-300 border-red-700', SHORT_TERM:'bg-amber-900/30 text-amber-300 border-amber-700', PREVENTIVE:'bg-blue-900/30 text-blue-300 border-blue-700' }[c] || 'bg-slate-800 text-slate-300 border-slate-700')
const pctColour  = p => p >= 90 ? 'text-red-400' : p >= 70 ? 'text-orange-400' : p >= 40 ? 'text-yellow-400' : 'text-green-400'
const pctBg      = p => p >= 90 ? 'bg-red-500' : p >= 70 ? 'bg-orange-500' : p >= 40 ? 'bg-yellow-500' : 'bg-green-500'

const statusNodeColour = s => ({
  ROOT_CAUSE:{ fill:'#ef4444', stroke:'#b91c1c' },
  DOWN:      { fill:'#dc2626', stroke:'#991b1b' },
  ANOMALOUS: { fill:'#f59e0b', stroke:'#b45309' },
  NORMAL:    { fill:'#3b82f6', stroke:'#1d4ed8' },
}[s] || { fill:'#64748b', stroke:'#334155' })

const fmt = {
  pct:   v => `${(+v || 0).toFixed(1)}%`,
  ms:    v => `${Math.round((+v || 0) * 1000)}ms`,
  s:     v => `${(+v || 0).toFixed(3)}s`,
  rate:  v => `${(+v || 0).toFixed(4)}/s`,
  safe:  v => typeof v === 'number' ? v : 0,
}

// ── Shared small components ────────────────────────────────────────────────────
function Badge({ children, className = '' }) {
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border font-mono uppercase ${className}`}>{children}</span>
}

function SectionTitle({ icon: Icon, color = 'text-indigo-400', children }) {
  return (
    <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2 mb-4">
      <Icon size={15} className={color} /> {children}
    </h2>
  )
}

function Panel({ id, children, className = '' }) {
  return (
    <div id={id} className={`bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 ${className}`}>
      {children}
    </div>
  )
}

function MiniBar({ value, max = 100, color = 'bg-indigo-500', height = 'h-1.5' }) {
  const pct = Math.min(100, Math.max(0, (fmt.safe(value) / Math.max(max, 0.001)) * 100))
  return (
    <div className={`w-full ${height} bg-slate-800 rounded-full overflow-hidden`}>
      <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className="text-[10px] px-2 py-0.5 rounded bg-slate-700 border border-slate-600 text-slate-300 hover:bg-slate-600 transition ml-2 font-mono">
      {copied ? '✓' : 'copy'}
    </button>
  )
}

// Custom Recharts tooltip
function ChartTooltip({ active, payload, label, unit = '' }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-slate-400 mb-1 font-mono">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }} className="font-semibold">
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(4) : p.value}{unit}
        </p>
      ))}
    </div>
  )
}

// ── 1. HERO / OVERVIEW PANEL ──────────────────────────────────────────────────
function OverviewPanel({ data, history, loading, lastUpdated }) {
  const riskLevel   = data?.risk_level   || 'LOW'
  const cascadeRisk = fmt.safe(data?.cascade_risk)
  const riskPct     = Math.round(cascadeRisk * 100)
  const confidence  = data?.confidence != null ? data.confidence : null
  const confPct     = confidence != null ? (confidence * 100).toFixed(1) : '—'
  const numDown     = fmt.safe(data?.system?.num_services_down)

  // Summary KPIs
  const kpis = [
    { label: 'Cascade Risk',       value: `${riskPct}%`,          color: riskColour(riskLevel),   sub: riskLevel },
    { label: 'Services Online',    value: `${6 - numDown} / 6`,   color: numDown > 0 ? 'text-red-400' : 'text-green-400', sub: numDown > 0 ? `${numDown} DOWN` : 'All healthy' },
    { label: 'Confidence',         value: confidence != null ? `${confPct}%` : '—', color: 'text-indigo-300', sub: data?.model_note || '—' },
    { label: 'Mean Error Rate',    value: fmt.rate(data?.system?.mean_error_rate),  color: data?.system?.mean_error_rate > 0.01 ? 'text-red-400' : 'text-green-400', sub: 'System-wide' },
    { label: 'Max P99 Latency',    value: fmt.s(data?.system?.max_p99_latency),     color: data?.system?.max_p99_latency > 1 ? 'text-orange-400' : 'text-green-400', sub: 'Worst service' },
    { label: 'Active Incidents',   value: String((data?.root_cause || []).length),  color: (data?.root_cause || []).length > 0 ? 'text-red-400' : 'text-green-400', sub: 'Root causes' },
  ]

  const historyData = history.map((h, i) => ({ i, risk: Math.round(h.risk * 100), level: h.level, t: h.t.toLocaleTimeString() }))

  return (
    <Panel id="overview" className="!space-y-5">
      {/* Top row: risk gauge + KPI cards */}
      <div className="flex flex-wrap items-stretch gap-4">
        {/* Gauge */}
        <div className={`flex-shrink-0 rounded-xl border p-5 flex flex-col justify-between min-w-[260px] ${riskBg(riskLevel)}`}>
          <div>
            <p className="text-[11px] text-slate-400 uppercase tracking-wider mb-1">Random Forest Risk Score</p>
            <div className="flex items-end gap-3">
              <span className={`text-5xl font-black font-mono ${riskColour(riskLevel)}`}>{riskPct}%</span>
              <div className="mb-1">
                <span className={`text-xl font-bold ${riskColour(riskLevel)}`}>{riskLevel}</span>
                <p className="text-[11px] text-slate-400 mt-0.5">{data?.prediction || '—'}</p>
                <p className="text-[11px] text-slate-400">Conf: {confPct}%</p>
              </div>
            </div>
          </div>
          <div className="mt-3">
            <div className="w-full h-3 bg-slate-800/60 rounded-full overflow-hidden border border-slate-700">
              <div className={`h-full rounded-full transition-all duration-700 ${riskBar(riskLevel)}`} style={{ width: `${riskPct}%` }} />
            </div>
            <div className="flex justify-between text-[10px] text-slate-500 mt-1">
              <span>0%</span><span>50%</span><span>100%</span>
            </div>
          </div>
        </div>

        {/* KPI grid */}
        <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-3 min-w-0">
          {kpis.map(k => (
            <div key={k.label} className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3.5">
              <p className="text-[11px] text-slate-400 mb-1">{k.label}</p>
              <p className={`text-lg font-bold font-mono ${k.color}`}>{k.value}</p>
              <p className="text-[10px] text-slate-500 mt-0.5 truncate">{k.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Risk history chart */}
      {historyData.length > 1 && (
        <div>
          <p className="text-[11px] text-slate-500 mb-2 font-mono">Risk Poll History (last {historyData.length} polls · {POLL_INTERVAL_MS / 1000}s interval)</p>
          <ResponsiveContainer width="100%" height={80}>
            <AreaChart data={historyData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="riskGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0}   />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="t" tick={{ fontSize: 8, fill: '#64748b' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 8, fill: '#64748b' }} />
              <Tooltip content={<ChartTooltip unit="%" />} />
              <ReferenceLine y={75} stroke="#f97316" strokeDasharray="4 3" strokeWidth={1} />
              <ReferenceLine y={50} stroke="#eab308" strokeDasharray="4 3" strokeWidth={1} />
              <Area type="monotone" dataKey="risk" name="Risk" stroke="#6366f1" fill="url(#riskGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {lastUpdated && (
        <p className="text-[11px] text-slate-500 font-mono text-right">
          Last updated: {lastUpdated.toLocaleTimeString()} · Auto-refresh every {POLL_INTERVAL_MS / 1000}s
        </p>
      )}
    </Panel>
  )
}

// ── 2. OBSERVABILITY PANEL (real percentages, real probe status) ───────────────
function ObservabilityPanel({ system, liveMetrics, obsPct, obsStatus }) {
  // Probe status display
  const probes = [
    { key: 'prometheus', label: 'Prometheus', port: 9090, url: 'http://localhost:9090', color: 'text-orange-400' },
    { key: 'grafana',    label: 'Grafana',    port: 3001, url: 'http://localhost:3001', color: 'text-orange-300' },
    { key: 'jaeger',     label: 'Jaeger',     port: 16686,url: 'http://localhost:16686',color: 'text-purple-400' },
  ]

  return (
    <Panel id="observability">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <Layers size={18} className="text-orange-400" />
          <div>
            <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Grafana / Prometheus Live Observability</h2>
            <p className="text-[11px] text-slate-400">Real-time percentages: uptime, error budget, latency budget per service</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {probes.map(p => (
            <a key={p.key} href={p.url} target="_blank" rel="noreferrer"
               className="text-xs px-2.5 py-1.5 rounded bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 transition flex items-center gap-1">
              {obsStatus?.[p.key]?.connected
                ? <Wifi size={11} className="text-green-400" />
                : <WifiOff size={11} className="text-red-400" />}
              {p.label}
              <ExternalLink size={10} className="text-slate-500" />
            </a>
          ))}
        </div>
      </div>

      {/* Probe status row */}
      <div className="grid grid-cols-3 gap-3">
        {probes.map(p => {
          const s = obsStatus?.[p.key]
          return (
            <div key={p.key} className={`rounded-lg border p-3 text-xs ${s?.connected ? 'bg-green-950/20 border-green-800/40' : 'bg-red-950/20 border-red-800/40'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-slate-200">{p.label}</span>
                {s?.connected
                  ? <span className="flex items-center gap-1 text-green-400"><CheckCircle size={11}/> Connected</span>
                  : <span className="flex items-center gap-1 text-red-400"><XCircle size={11}/> Unreachable</span>}
              </div>
              <p className="text-slate-500 font-mono">:{p.port}</p>
              {s?.latency_ms != null && <p className="text-slate-400 font-mono">{s.latency_ms}ms</p>}
            </div>
          )
        })}
      </div>

      {/* System summary metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        {[
          { label: 'Max P99 Latency',    value: fmt.s(system?.max_p99_latency),    warn: (system?.max_p99_latency || 0) > 1,   sub: 'Scraped via Prometheus' },
          { label: 'Mean Error Rate',    value: fmt.rate(system?.mean_error_rate),  warn: (system?.mean_error_rate || 0) > 0.01, sub: 'HTTP 5xx stream' },
          { label: 'Services Online',    value: `${6 - fmt.safe(system?.num_services_down)} / 6`, warn: (system?.num_services_down || 0) > 0, sub: 'Actuator health probe' },
          { label: 'Prometheus',         value: system?.prometheus_connected ? 'CONNECTED' : 'OFFLINE', warn: !system?.prometheus_connected, sub: 'Metrics scrape status' },
        ].map(m => (
          <div key={m.label} className={`rounded-lg border p-3 space-y-1 ${m.warn ? 'bg-red-950/20 border-red-800/30' : 'bg-slate-950/60 border-slate-800'}`}>
            <p className={`text-[11px] ${m.warn ? 'text-slate-300' : 'text-slate-400'} font-medium`}>{m.label}</p>
            <p className={`text-xl font-bold font-mono ${m.warn ? 'text-red-400' : 'text-green-400'}`}>{m.value}</p>
            <p className="text-[10px] text-slate-500">{m.sub}</p>
          </div>
        ))}
      </div>

      {/* Per-service percentage breakdown */}
      <div>
        <p className="text-[11px] text-slate-400 uppercase tracking-wider font-bold mb-3">Per-Service Observability Percentages</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {SERVICES.map(svc => {
            const m   = obsPct?.[svc] || {}
            const up  = liveMetrics?.[svc]?.service_up ?? 1
            const color = SERVICE_COLORS[svc]
            return (
              <div key={svc} className={`rounded-lg border p-3.5 text-xs space-y-2.5 ${up === 0 ? 'bg-red-950/20 border-red-800/40' : 'bg-slate-800/40 border-slate-700/30'}`}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200" style={{ borderLeft: `3px solid ${color}`, paddingLeft: 6 }}>{SERVICE_LABELS[svc]}</span>
                  {up === 1
                    ? <Badge className="bg-green-950 text-green-400 border-green-800">UP</Badge>
                    : <Badge className="bg-red-950 text-red-400 border-red-800">DOWN</Badge>}
                </div>

                {[
                  { label: 'Uptime',         value: m.uptime_pct        ?? (up ? 100 : 0), unit: '%',  invert: true  },
                  { label: 'Error Rate',      value: m.error_rate_pct    ?? 0,              unit: '% of reqs',       },
                  { label: 'Error Budget',    value: m.error_budget_pct  ?? 0,              unit: '% consumed',      },
                  { label: 'Latency Budget',  value: m.latency_budget_pct?? 0,              unit: '% consumed',      },
                ].map(row => (
                  <div key={row.label} className="space-y-1">
                    <div className="flex justify-between font-mono">
                      <span className="text-slate-400">{row.label}</span>
                      <span className={row.invert
                        ? (row.value < 99 ? 'text-red-400 font-bold' : 'text-green-400 font-bold')
                        : pctColour(row.value)
                      }>
                        {(+row.value || 0).toFixed(1)}{row.unit}
                      </span>
                    </div>
                    <MiniBar
                      value={row.value}
                      max={100}
                      color={row.invert
                        ? (row.value >= 99 ? 'bg-green-500' : 'bg-red-500')
                        : pctBg(row.value)}
                    />
                  </div>
                ))}

                <div className="flex justify-between font-mono text-[10px] text-slate-500 pt-1 border-t border-slate-700/30">
                  <span>P99: {fmt.s(m.p99_latency_s)}</span>
                  <span>Req: {fmt.rate(m.request_rate)}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Panel>
  )
}

// ── 3. SERVICE HEALTH TIMELINE (Recharts sparklines) ─────────────────────────
function ServiceTimelinePanel({ metricHistory }) {
  const [metric, setMetric] = useState('error_rate_5xx')

  const metricOpts = [
    { key: 'error_rate_5xx', label: 'Error Rate (req/s)' },
    { key: 'p99_latency_s',  label: 'P99 Latency (s)'   },
    { key: 'request_rate',   label: 'Request Rate (req/s)'},
  ]

  // metricHistory is array of { t, metrics: { svc: { error_rate, p99, ... } } }
  const chartData = metricHistory.map(h => {
    const pt = { t: h.t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }
    SERVICES.forEach(svc => { pt[svc] = h.metrics?.[svc]?.[metric] ?? 0 })
    return pt
  })

  return (
    <Panel id="timeline">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle icon={Activity} color="text-cyan-400">Service Health Timeline</SectionTitle>
        <div className="flex items-center gap-2">
          {metricOpts.map(o => (
            <button key={o.key} onClick={() => setMetric(o.key)}
              className={`text-[11px] px-2.5 py-1 rounded border transition
                ${metric === o.key
                  ? 'bg-indigo-900/60 border-indigo-700 text-indigo-300'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'}`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {chartData.length < 2 ? (
        <p className="text-slate-500 text-xs italic text-center py-8">Collecting history… (needs 2+ polls)</p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 4, right: 16, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="t" tick={{ fontSize: 8, fill: '#64748b' }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 8, fill: '#64748b' }} />
            <Tooltip content={<ChartTooltip />} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {SERVICES.map(svc => (
              <Line key={svc} type="monotone" dataKey={svc} name={SERVICE_LABELS[svc]}
                stroke={SERVICE_COLORS[svc]} strokeWidth={1.8} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}

      {/* Per-service mini-sparklines */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-800">
        {SERVICES.map(svc => {
          const svcData = chartData.map(d => ({ v: d[svc] ?? 0 }))
          const last    = svcData[svcData.length - 1]?.v ?? 0
          const color   = SERVICE_COLORS[svc]
          return (
            <div key={svc} className="bg-slate-800/40 border border-slate-700/30 rounded-lg p-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-semibold text-slate-300" style={{ color }}>{SERVICE_LABELS[svc]}</span>
                <span className="text-[11px] font-mono text-slate-300">{last.toFixed(4)}</span>
              </div>
              {svcData.length > 1 ? (
                <ResponsiveContainer width="100%" height={36}>
                  <AreaChart data={svcData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id={`grad-${svc}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={color} stopOpacity={0.35} />
                        <stop offset="95%" stopColor={color} stopOpacity={0}    />
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="v" stroke={color} fill={`url(#grad-${svc})`} strokeWidth={1.5} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-9 flex items-center text-[10px] text-slate-600 italic">No history yet</div>
              )}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

// ── 4. NETWORKX GRAPH ─────────────────────────────────────────────────────────
function NetworkXGraphVisualizer({ graphData }) {
  if (!graphData?.nodes) {
    return (
      <Panel>
        <p className="text-slate-500 text-xs italic py-8 text-center">NetworkX graph data loading…</p>
      </Panel>
    )
  }
  const { nodes, edges } = graphData

  return (
    <div id="graph" className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 overflow-hidden">
      <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2">
          <Network size={16} className="text-indigo-400" />
          <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
            Live NetworkX Dependency Graph &amp; Cascade Impact
          </h3>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-400">
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-indigo-500 inline-block" /> Architectural</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 border-t border-dashed border-red-500 inline-block" /> Correlation Arc</span>
          <span className="font-mono text-slate-500">{graphData.node_count}n · {graphData.edge_count}e</span>
        </div>
      </div>

      <div className="w-full overflow-x-auto flex justify-center py-2">
        <svg width="540" height="380" viewBox="0 0 540 380" className="drop-shadow-md">
          <defs>
            <marker id="arrow-arch" viewBox="0 0 10 10" refX="28" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#6366f1" />
            </marker>
            <marker id="arrow-corr" viewBox="0 0 10 10" refX="28" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
            </marker>
          </defs>

          {edges.map((edge, idx) => {
            const p1 = NODE_POSITIONS[edge.source] || { x: 100, y: 100 }
            const p2 = NODE_POSITIONS[edge.target] || { x: 200, y: 200 }
            if (edge.type === 'data_driven') {
              const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2
              const dx = p2.x - p1.x, dy = p2.y - p1.y
              const cx = mx - dy * 0.35, cy = my + dx * 0.35
              return (
                <g key={`c-${idx}`}>
                  <path d={`M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}`}
                    fill="none" stroke="#ef4444"
                    strokeWidth={Math.max(1.5, edge.weight * 2.5)}
                    strokeDasharray="5,4" markerEnd="url(#arrow-corr)" opacity="0.9" />
                  <rect x={cx - 18} y={cy - 8} width="36" height="14" rx="4" fill="#450a0a" stroke="#b91c1c" strokeWidth="1" />
                  <text x={cx} y={cy + 2} fill="#fca5a5" fontSize="8" fontWeight="bold" fontFamily="monospace" textAnchor="middle">r={(+edge.correlation).toFixed(2)}</text>
                </g>
              )
            }
            return (
              <line key={`a-${idx}`}
                x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                stroke="#6366f1" strokeWidth="2.2"
                markerEnd="url(#arrow-arch)" opacity="0.85" />
            )
          })}

          {nodes.map(node => {
            const pos     = NODE_POSITIONS[node.id] || { x: 150, y: 150 }
            const colors  = statusNodeColour(node.status)
            const effect  = node.cascade_effect_pct ?? 0
            return (
              <g key={node.id}>
                {effect > 0 && (
                  <circle cx={pos.x} cy={pos.y} r="28" fill="none"
                    stroke={effect > 70 ? '#ef4444' : '#f97316'} strokeWidth="2"
                    strokeDasharray="4,3" className="animate-spin" style={{ animationDuration: '10s' }} />
                )}
                <circle cx={pos.x} cy={pos.y} r="22" fill={colors.fill} stroke={colors.stroke} strokeWidth="3"
                  className={node.status === 'ROOT_CAUSE' ? 'animate-pulse' : ''} />
                <text x={pos.x} y={pos.y + 4} fill="#fff" fontSize="10" fontWeight="bold" textAnchor="middle">
                  {node.id.toUpperCase().slice(0, 4)}
                </text>
                <text x={pos.x} y={pos.y + 36} fill="#cbd5e1" fontSize="11" fontWeight="600" textAnchor="middle">
                  {SERVICE_LABELS[node.id] || node.id}
                </text>
                <rect x={pos.x - 24} y={pos.y - 36} width="48" height="14" rx="7" fill="#0f172a" stroke="#334155" strokeWidth="1" />
                <text x={pos.x} y={pos.y - 26} fill="#94a3b8" fontSize="8" fontFamily="monospace" textAnchor="middle">
                  PR: {node.pagerank}
                </text>
                <rect x={pos.x - 28} y={pos.y + 42} width="56" height="15" rx="7"
                  fill={effect > 70 ? '#7f1d1d' : effect > 0 ? '#7c2d12' : '#0f172a'}
                  stroke={effect > 70 ? '#ef4444' : effect > 0 ? '#f97316' : '#334155'} strokeWidth="1" />
                <text x={pos.x} y={pos.y + 53}
                  fill={effect > 0 ? '#fca5a5' : '#94a3b8'} fontSize="9" fontWeight="bold"
                  fontFamily="monospace" textAnchor="middle">
                  {effect}% Effect
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2 pt-3 border-t border-slate-800 text-[11px]">
        {nodes.map(n => (
          <div key={n.id} className="flex items-center justify-between p-1.5 rounded bg-slate-900/60 border border-slate-800 font-mono">
            <span className="text-slate-400 font-sans font-semibold" style={{ color: SERVICE_COLORS[n.id] }}>{SERVICE_LABELS[n.id] || n.id}</span>
            <div className="flex items-center gap-1.5">
              <span className={`px-1.5 py-0.5 rounded text-[10px] ${(n.cascade_effect_pct ?? 0) > 70 ? 'bg-red-950 text-red-300 border border-red-700' : 'bg-slate-800 text-slate-300'}`}>
                {n.cascade_effect_pct ?? 0}% impact
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 5. SLA COMPLIANCE PANEL ───────────────────────────────────────────────────
function SLACompliancePanel({ slaData }) {
  if (!slaData?.services) {
    return <Panel id="sla"><p className="text-slate-500 text-xs italic">SLA data loading…</p></Panel>
  }
  const { services, total_breaches, compliant_count } = slaData

  const radialData = SERVICES.map(svc => ({
    name: SERVICE_LABELS[svc].replace(' Service', ''),
    uptime: services[svc]?.uptime_pct ?? 100,
    fill: services[svc]?.sla_compliant ? '#22c55e' : '#ef4444',
  }))

  return (
    <Panel id="sla">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle icon={Target} color="text-emerald-400">System SLA Compliance</SectionTitle>
        <div className="flex items-center gap-3 text-xs">
          <span className={`font-bold ${total_breaches > 0 ? 'text-red-400' : 'text-green-400'}`}>
            {compliant_count} / {SERVICES.length} Compliant
          </span>
          {total_breaches > 0 && (
            <Badge className="bg-red-950 text-red-400 border-red-800">{total_breaches} BREACH{total_breaches > 1 ? 'ES' : ''}</Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Service SLA cards */}
        <div className="space-y-3">
          {SERVICES.map(svc => {
            const s    = services[svc]
            const tgt  = s?.targets || {}
            return (
              <div key={svc} className={`rounded-lg border p-3.5 text-xs space-y-2 ${s?.sla_compliant ? 'bg-slate-800/40 border-slate-700/30' : 'bg-red-950/15 border-red-800/40'}`}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200">{SERVICE_LABELS[svc]}</span>
                  {s?.sla_compliant
                    ? <Badge className="bg-green-950 text-green-400 border-green-800">COMPLIANT</Badge>
                    : <Badge className="bg-red-950 text-red-400 border-red-800">BREACHED ({s?.breach_count})</Badge>}
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Uptime', value: s?.uptime_pct ?? 100, target: tgt.uptime_pct, unit: '%', invert: true },
                    { label: 'Error Budget', value: s?.error_budget_pct ?? 0, target: 100, unit: '% used' },
                    { label: 'Lat. Budget', value: s?.latency_budget_pct ?? 0, target: 100, unit: '% used' },
                  ].map(m => (
                    <div key={m.label}>
                      <p className="text-slate-500 mb-0.5">{m.label}</p>
                      <p className={`font-mono font-bold ${m.invert ? (m.value < 99 ? 'text-red-400' : 'text-green-400') : pctColour(m.value)}`}>
                        {(+m.value || 0).toFixed(1)}{m.unit}
                      </p>
                      <p className="text-[10px] text-slate-600">target: {m.target}{m.unit}</p>
                      <MiniBar value={m.value} max={100} color={m.invert ? (m.value >= 99 ? 'bg-green-500' : 'bg-red-500') : pctBg(m.value)} />
                    </div>
                  ))}
                </div>

                {(s?.breaches || []).map((b, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px] bg-red-950/30 border border-red-800/30 rounded p-2">
                    <AlertTriangle size={11} className="text-red-400 shrink-0 mt-0.5" />
                    <span className="text-red-300">{b.message}</span>
                  </div>
                ))}
              </div>
            )
          })}
        </div>

        {/* Radial bar chart */}
        <div className="flex flex-col items-center justify-center">
          <p className="text-[11px] text-slate-400 mb-2 uppercase tracking-wider">Service Uptime Overview</p>
          <ResponsiveContainer width="100%" height={260}>
            <RadialBarChart cx="50%" cy="50%" innerRadius="20%" outerRadius="90%"
              data={radialData} startAngle={180} endAngle={-180}>
              <RadialBar dataKey="uptime" cornerRadius={4} background={{ fill: '#1e293b' }} label={false} />
              <Tooltip formatter={(v) => [`${v}%`, 'Uptime']} contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
            </RadialBarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Panel>
  )
}

// ── 6. ANOMALY ENGINE (Z-Score + Temporal + Feature Importances) ──────────────
function AnomalyEnginePanel({ zData, temporalData, importances }) {
  const maxImp = Math.max(...(importances || []).map(i => i.importance), 1)

  return (
    <Panel id="anomaly">
      <SectionTitle icon={AlertCircle} color="text-purple-400">Anomaly Detection Engine</SectionTitle>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Z-Score */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">Z-Score Analysis (3σ threshold)</p>
            {zData && (
              <div className="flex items-center gap-2 text-xs font-mono">
                <span className={`px-2 py-0.5 rounded font-bold border ${(zData.max_zscore || 0) > 3 ? 'bg-red-950 text-red-400 border-red-800' : 'bg-slate-800 text-green-400 border-slate-700'}`}>
                  {zData.max_zscore ?? 0}σ max
                </span>
                <span className="text-slate-500">{zData.flagged_count ?? 0} flagged</span>
              </div>
            )}
          </div>

          {!zData?.services ? (
            <p className="text-slate-500 text-xs italic">Loading…</p>
          ) : (
            <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
              {Object.entries(zData.services).map(([svc, metrics]) => {
                const hasAnomaly = Object.values(metrics).some(m => m.anomalous)
                return (
                  <div key={svc} className={`p-3 rounded-lg border text-xs ${hasAnomaly ? 'bg-purple-950/20 border-purple-800/40' : 'bg-slate-800/40 border-slate-700/30'}`}>
                    <div className="flex items-center justify-between font-semibold text-slate-300 mb-2">
                      <span style={{ color: SERVICE_COLORS[svc] }}>{SERVICE_LABELS[svc]}</span>
                      {hasAnomaly && <Badge className="bg-purple-900/60 text-purple-300 border-purple-700">ANOMALOUS &gt;3σ</Badge>}
                    </div>
                    <div className="space-y-1.5 font-mono">
                      {Object.entries(metrics).map(([mName, mInfo]) => (
                        <div key={mName}>
                          <div className="flex items-center justify-between text-[11px] mb-0.5">
                            <span className="text-slate-400 font-sans">{mName.replace(/_/g, ' ')}</span>
                            <span className={mInfo.anomalous ? 'text-red-400 font-bold' : 'text-slate-300'}>
                              {mInfo.val} <span className="text-[10px] text-slate-500">({mInfo.z_score}σ)</span>
                            </span>
                          </div>
                          {mInfo.pct_of_baseline != null && (
                            <MiniBar value={Math.min(mInfo.pct_of_baseline, 500)} max={500}
                              color={mInfo.anomalous ? 'bg-red-500' : 'bg-purple-500'} />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Temporal + Feature Importances */}
        <div className="space-y-4">
          {/* Temporal */}
          {temporalData && (
            <div className="space-y-3">
              <p className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">Temporal Analysis</p>
              <div className="grid grid-cols-2 gap-2.5 text-xs">
                {[
                  { label: 'Error Rate Δ',    value: temporalData.delta_error_rate,    unit: '/s²',  warn: (temporalData.delta_error_rate || 0) > 0.01 },
                  { label: 'Latency Δ',       value: temporalData.delta_latency,       unit: 's/poll', warn: (temporalData.delta_latency || 0) > 0.5 },
                  { label: '3-Poll Mean Err', value: temporalData.rolling_3_mean_error, unit: '/s',   warn: (temporalData.rolling_3_mean_error || 0) > 0.05 },
                  { label: 'Err Acceleration',value: temporalData.acceleration_error,  unit: '',     warn: (temporalData.acceleration_error || 0) > 0.005 },
                ].map(m => (
                  <div key={m.label} className={`rounded-lg border p-2.5 ${m.warn ? 'bg-red-900/20 border-red-700/40' : 'bg-slate-800/60 border-slate-700/50'}`}>
                    <p className="text-[10px] text-slate-400 mb-0.5">{m.label}</p>
                    <p className={`font-bold font-mono text-sm ${m.warn ? 'text-red-300' : 'text-slate-100'}`}>
                      {typeof m.value === 'number' ? m.value.toFixed(4) : '—'}{m.unit}
                    </p>
                  </div>
                ))}
              </div>

              {temporalData.propagation_onset?.length > 0 && (
                <div className="bg-slate-800/40 border border-slate-700/30 rounded-lg p-3 text-xs">
                  <p className="text-slate-400 font-semibold mb-2">Propagation Onset Sequence:</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {temporalData.propagation_onset.map((item, idx) => (
                      <React.Fragment key={idx}>
                        <span className="px-2.5 py-1 rounded bg-cyan-950 border border-cyan-800/60 text-cyan-200 font-mono text-[11px]">
                          {idx + 1}. {SERVICE_LABELS[item.service] || item.service} <span className="text-slate-500">({item.time})</span>
                        </span>
                        {idx < temporalData.propagation_onset.length - 1 && <ArrowRight size={12} className="text-slate-600" />}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Feature Importances bar chart */}
          {importances?.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">Top RF Feature Importances</p>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={importances.slice(0, 8).map(i => ({ name: i.feature.replace(/_/g, ' ').slice(0, 22), val: +(i.importance * 100).toFixed(1) }))}
                  layout="vertical" margin={{ top: 0, right: 30, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 8, fill: '#64748b' }} tickFormatter={v => `${v}%`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 8, fill: '#94a3b8' }} width={140} />
                  <Tooltip formatter={v => [`${v}%`, 'Importance']} contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }} />
                  <Bar dataKey="val" fill="#6366f1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </Panel>
  )
}

// ── 7. INCIDENT LOG ───────────────────────────────────────────────────────────
const REASON_ICON = {
  SERVICE_DOWN:    <XCircle     size={13} className="text-red-400 shrink-0"    />,
  HIGH_ERROR_RATE: <AlertTriangle size={13} className="text-orange-400 shrink-0" />,
  HIGH_LATENCY:    <Clock       size={13} className="text-yellow-400 shrink-0" />,
  RESOLVED:        <CheckCircle size={13} className="text-green-400 shrink-0"  />,
}
const REASON_STYLE = {
  SERVICE_DOWN:    'bg-red-950/30 border-red-800/40',
  HIGH_ERROR_RATE: 'bg-orange-950/30 border-orange-800/40',
  HIGH_LATENCY:    'bg-yellow-950/20 border-yellow-800/30',
  RESOLVED:        'bg-green-950/20 border-green-800/30',
}

function IncidentLogPanel({ incidents }) {
  const [filter, setFilter] = useState('ALL')
  const filters = ['ALL', 'SERVICE_DOWN', 'HIGH_ERROR_RATE', 'HIGH_LATENCY', 'RESOLVED']

  const shown = (incidents || []).filter(e => filter === 'ALL' || e.reason === filter)

  return (
    <Panel id="incidents">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle icon={Bell} color="text-amber-400">Incident Log &amp; Event Feed</SectionTitle>
        <div className="flex items-center gap-1.5 flex-wrap">
          {filters.map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`text-[10px] px-2 py-0.5 rounded border transition uppercase
                ${filter === f ? 'bg-indigo-900/60 border-indigo-700 text-indigo-300' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'}`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-[420px] overflow-y-auto space-y-2 pr-1">
        {shown.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-500 text-sm">
            <CheckCircle size={32} className="text-green-500/50 mb-3" />
            <p>No incidents detected — system is healthy</p>
          </div>
        ) : (
          shown.map((e, i) => (
            <div key={e.id || i} className={`flex items-start gap-3 p-3 rounded-lg border text-xs transition-all ${REASON_STYLE[e.reason] || 'bg-slate-800/40 border-slate-700/30'}`}>
              <div className="mt-0.5">{REASON_ICON[e.reason] || <Info size={13} className="text-slate-400" />}</div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="font-semibold text-slate-200" style={{ color: SERVICE_COLORS[e.service] }}>{e.label}</span>
                  <Badge className={e.reason === 'RESOLVED' ? 'bg-green-950 text-green-400 border-green-800' : sevColour('HIGH')}>
                    {e.reason?.replace(/_/g, ' ')}
                  </Badge>
                  {e.risk_level && <Badge className={sevColour(e.risk_level)}>{e.risk_level}</Badge>}
                </div>
                {e.metric && e.value != null && (
                  <p className="font-mono text-slate-400">{e.metric}: <span className="text-slate-200">{e.value}</span></p>
                )}
              </div>
              <span className="text-[10px] text-slate-500 font-mono shrink-0 mt-0.5">{e.ts}</span>
            </div>
          ))
        )}
      </div>
    </Panel>
  )
}

// ── 8. FAULT INJECTION PANEL ──────────────────────────────────────────────────
const FAULT_TYPES = [
  { key: 'latency',     label: 'Latency Spike',   description: 'Inject artificial delay into all responses', icon: Clock     },
  { key: 'error',       label: 'Error Storm',      description: 'Force HTTP 500 responses at a given rate',  icon: XCircle   },
  { key: 'down',        label: 'Service Down',     description: 'Make the service return 503 immediately',   icon: Server    },
]

function FaultInjectionPanel() {
  const [selectedSvc,   setSelectedSvc]   = useState('order')
  const [selectedFault, setSelectedFault] = useState('latency')
  const [delayMs,       setDelayMs]       = useState(2000)
  const [errorRate,     setErrorRate]     = useState(0.5)
  const [status,        setStatus]        = useState(null)   // null | 'loading' | 'success' | 'error'
  const [statusMsg,     setStatusMsg]     = useState('')
  const [faultStates,   setFaultStates]   = useState({})

  const GATEWAY = 'http://localhost:8080'

  const configure = async () => {
    setStatus('loading')
    const body = selectedFault === 'latency'
      ? { type: 'latency', delayMs }
      : selectedFault === 'error'
        ? { type: 'error', rate: errorRate }
        : { type: 'down' }
    try {
      const r = await fetch(`${GATEWAY}/fault/${selectedSvc}-service/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      })
      const txt = await r.text()
      setStatus(r.ok ? 'success' : 'error')
      setStatusMsg(r.ok ? `Fault injected into ${SERVICE_LABELS[selectedSvc]}` : `Error ${r.status}: ${txt}`)
      if (r.ok) setFaultStates(p => ({ ...p, [selectedSvc]: { ...body } }))
    } catch (e) {
      setStatus('error')
      setStatusMsg(`Gateway unreachable: ${e.message}`)
    }
  }

  const reset = async (svc) => {
    setStatus('loading')
    try {
      const r = await fetch(`${GATEWAY}/fault/${svc}-service/reset`, {
        method: 'POST', signal: AbortSignal.timeout(5000),
      })
      const txt = await r.text()
      setStatus(r.ok ? 'success' : 'error')
      setStatusMsg(r.ok ? `${SERVICE_LABELS[svc]} fault cleared` : `Error ${r.status}: ${txt}`)
      if (r.ok) setFaultStates(p => { const n = { ...p }; delete n[svc]; return n })
    } catch (e) {
      setStatus('error')
      setStatusMsg(`Gateway unreachable: ${e.message}`)
    }
  }

  const resetAll = async () => {
    for (const svc of Object.keys(faultStates)) await reset(svc)
  }

  return (
    <Panel id="fault">
      <div className="flex items-center justify-between">
        <SectionTitle icon={Wrench} color="text-red-400">Chaos / Fault Injection Control</SectionTitle>
        {Object.keys(faultStates).length > 0 && (
          <button onClick={resetAll} className="text-xs px-3 py-1.5 rounded bg-green-900/40 border border-green-700 text-green-300 hover:bg-green-900/60 transition flex items-center gap-1.5">
            <CheckSquare size={12} /> Reset All Faults
          </button>
        )}
      </div>

      {/* Active fault badges */}
      {Object.keys(faultStates).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(faultStates).map(([svc, f]) => (
            <div key={svc} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-950/40 border border-red-700/50 text-xs">
              <Flame size={11} className="text-red-400" />
              <span className="text-red-300 font-semibold">{SERVICE_LABELS[svc]}</span>
              <span className="text-red-400 font-mono">{f.type}{f.delayMs ? ` ${f.delayMs}ms` : ''}{f.rate != null ? ` ${Math.round(f.rate * 100)}%` : ''}</span>
              <button onClick={() => reset(svc)} className="ml-1 text-slate-400 hover:text-slate-200 transition"><XCircle size={11} /></button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Config form */}
        <div className="space-y-4">
          {/* Service selector */}
          <div>
            <label className="text-[11px] text-slate-400 uppercase tracking-wider mb-2 block">Target Service</label>
            <div className="grid grid-cols-3 gap-2">
              {SERVICES.map(svc => (
                <button key={svc} onClick={() => setSelectedSvc(svc)}
                  className={`text-[11px] py-2 px-2 rounded border transition text-center
                    ${selectedSvc === svc ? 'bg-indigo-900/60 border-indigo-700 text-indigo-200' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'}`}>
                  {SERVICE_LABELS[svc].replace(' Service', '')}
                </button>
              ))}
            </div>
          </div>

          {/* Fault type */}
          <div>
            <label className="text-[11px] text-slate-400 uppercase tracking-wider mb-2 block">Fault Type</label>
            <div className="space-y-2">
              {FAULT_TYPES.map(ft => (
                <button key={ft.key} onClick={() => setSelectedFault(ft.key)}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border text-xs text-left transition
                    ${selectedFault === ft.key ? 'bg-red-950/40 border-red-700/60 text-slate-100' : 'bg-slate-800/60 border-slate-700/40 text-slate-400 hover:bg-slate-800'}`}>
                  <ft.icon size={14} className={selectedFault === ft.key ? 'text-red-400' : 'text-slate-500'} />
                  <div>
                    <p className="font-semibold">{ft.label}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{ft.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Params */}
          {selectedFault === 'latency' && (
            <div>
              <label className="text-[11px] text-slate-400 mb-1 block">Delay: <span className="text-slate-200 font-mono">{delayMs}ms</span></label>
              <input type="range" min={100} max={10000} step={100} value={delayMs} onChange={e => setDelayMs(+e.target.value)}
                className="w-full accent-indigo-500" />
              <div className="flex justify-between text-[10px] text-slate-600 mt-1"><span>100ms</span><span>10s</span></div>
            </div>
          )}
          {selectedFault === 'error' && (
            <div>
              <label className="text-[11px] text-slate-400 mb-1 block">Error Rate: <span className="text-slate-200 font-mono">{Math.round(errorRate * 100)}%</span></label>
              <input type="range" min={0.1} max={1} step={0.05} value={errorRate} onChange={e => setErrorRate(+e.target.value)}
                className="w-full accent-red-500" />
              <div className="flex justify-between text-[10px] text-slate-600 mt-1"><span>10%</span><span>100%</span></div>
            </div>
          )}

          <button onClick={configure} disabled={status === 'loading'}
            className="w-full py-2.5 rounded-lg bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-semibold flex items-center justify-center gap-2 transition">
            <Flame size={14} />
            {status === 'loading' ? 'Injecting…' : `Inject Fault → ${SERVICE_LABELS[selectedSvc]}`}
          </button>

          {status && status !== 'loading' && (
            <div className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${status === 'success' ? 'bg-green-950/30 border-green-800/40 text-green-300' : 'bg-red-950/30 border-red-800/40 text-red-300'}`}>
              {status === 'success' ? <CheckCircle size={13} className="shrink-0 mt-0.5" /> : <AlertTriangle size={13} className="shrink-0 mt-0.5" />}
              {statusMsg}
            </div>
          )}
        </div>

        {/* Info panel */}
        <div className="space-y-3 text-xs">
          <div className="bg-slate-800/40 border border-slate-700/30 rounded-lg p-4 space-y-3">
            <p className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">How Fault Injection Works</p>
            <p className="text-slate-400">Faults are injected via the existing <code className="bg-slate-700 px-1 rounded text-indigo-300">/fault/</code> gateway endpoints in each Spring Boot service. The <code className="bg-slate-700 px-1 rounded text-indigo-300">FaultInterceptor</code> intercepts all requests and applies the configured fault behaviour.</p>
            <div className="space-y-2">
              {[
                { label: 'Latency Spike',  desc: 'Sleeps for N ms before returning — simulates DB slowdown, network congestion.' },
                { label: 'Error Storm',    desc: 'Returns HTTP 500 for X% of requests — triggers circuit breaker logic.' },
                { label: 'Service Down',   desc: 'Returns HTTP 503 for ALL requests — simulates full service crash.' },
              ].map(f => (
                <div key={f.label} className="border-l-2 border-indigo-700 pl-3">
                  <p className="font-semibold text-slate-300">{f.label}</p>
                  <p className="text-slate-500">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-amber-950/20 border border-amber-800/30 rounded-lg p-3 text-amber-300 flex items-start gap-2">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <p>Fault injection will affect live traffic and trigger the cascade detection engine. Use in dev/staging only.</p>
          </div>
        </div>
      </div>
    </Panel>
  )
}

// ── 9. RECOMMENDATIONS PANEL ──────────────────────────────────────────────────
function RecommendationsPanel({ recs, rootCause, cascadePath }) {
  const [expanded, setExpanded] = useState(new Set([0]))

  const toggle = i => setExpanded(p => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n })

  if (!recs?.length) {
    return (
      <Panel id="recs">
        <SectionTitle icon={Lightbulb} color="text-yellow-400">Actionable Remediation Recommendations</SectionTitle>
        <p className="text-slate-400 text-xs italic text-center py-6">System operating within normal bounds — no recommendations.</p>
      </Panel>
    )
  }

  const grouped = { IMMEDIATE: [], SHORT_TERM: [], PREVENTIVE: [] }
  recs.forEach(r => { (grouped[r.category] || grouped.PREVENTIVE).push(r) })

  return (
    <Panel id="recs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle icon={Lightbulb} color="text-yellow-400">Actionable Remediation Recommendations</SectionTitle>
        <div className="flex items-center gap-2 text-xs">
          {Object.entries(grouped).map(([cat, items]) => items.length > 0 && (
            <span key={cat} className={`px-2 py-0.5 rounded border text-[10px] font-bold ${catColour(cat)}`}>
              {items.length} {cat.replace('_', ' ')}
            </span>
          ))}
        </div>
      </div>

      {/* Root cause summary */}
      {rootCause?.length > 0 && (
        <div className="bg-slate-800/40 border border-slate-700/30 rounded-lg p-3 text-xs">
          <p className="text-slate-400 font-bold mb-2">Root Causes Identified:</p>
          <div className="flex flex-wrap gap-2">
            {rootCause.map((c, i) => (
              <span key={i} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-300">
                <span style={{ color: SERVICE_COLORS[c.service] }}>●</span>
                {SERVICE_LABELS[c.service]} — {c.reason.replace(/_/g, ' ')}
                {c.value != null && <span className="font-mono text-slate-500">({c.value})</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Cascade path */}
      {cascadePath?.length > 0 && (
        <div className="bg-slate-800/40 border border-slate-700/30 rounded-lg p-3 text-xs">
          <p className="text-slate-400 font-bold mb-2 flex items-center gap-1.5"><GitBranch size={12} className="text-orange-400" /> Cascade Propagation Path:</p>
          <div className="flex flex-wrap items-center gap-2">
            {cascadePath.map((svc, i) => (
              <React.Fragment key={svc}>
                <span className="px-2.5 py-1 rounded-full border text-[11px] font-semibold" style={{ borderColor: SERVICE_COLORS[svc], color: SERVICE_COLORS[svc], background: `${SERVICE_COLORS[svc]}15` }}>
                  {SERVICE_LABELS[svc]}
                </span>
                {i < cascadePath.length - 1 && <ArrowRight size={12} className="text-slate-600" />}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {/* Recommendations by category */}
      {['IMMEDIATE', 'SHORT_TERM', 'PREVENTIVE'].map(cat => {
        const items = grouped[cat]
        if (!items?.length) return null
        return (
          <div key={cat}>
            <p className={`text-[11px] font-bold uppercase tracking-wider mb-2 flex items-center gap-2`}>
              <span className={`px-2 py-0.5 rounded border ${catColour(cat)}`}>{cat.replace('_', '-')}</span>
              <span className="text-slate-500">{items.length} action{items.length > 1 ? 's' : ''}</span>
            </p>
            <div className="space-y-2">
              {items.map((r, gi) => {
                const globalIdx = recs.indexOf(r)
                const isOpen    = expanded.has(globalIdx)
                return (
                  <div key={globalIdx} className={`rounded-lg border text-xs overflow-hidden transition-all ${r.severity === 'CRITICAL' ? 'border-red-800/60' : r.severity === 'HIGH' ? 'border-orange-800/50' : r.severity === 'MEDIUM' ? 'border-yellow-800/40' : 'border-slate-700/40'}`}>
                    <button onClick={() => toggle(globalIdx)}
                      className={`w-full flex items-center gap-3 p-3 text-left transition ${isOpen ? 'bg-slate-800/80' : 'bg-slate-800/40 hover:bg-slate-800/60'}`}>
                      <span className="shrink-0 w-6 h-6 rounded-full bg-slate-700 text-slate-300 text-[10px] flex items-center justify-center font-bold font-mono">
                        {r.priority}
                      </span>
                      <Badge className={sevColour(r.severity)}>{r.severity}</Badge>
                      <span className="flex-1 font-semibold text-slate-200 text-left">{r.title}</span>
                      <span className="text-slate-500 text-[10px] font-mono shrink-0" style={{ color: SERVICE_COLORS[r.service] }}>
                        {r.service !== 'system' ? SERVICE_LABELS[r.service]?.replace(' Service','') : 'System'}
                      </span>
                      {isOpen ? <ChevronUp size={13} className="text-slate-500 shrink-0" /> : <ChevronDown size={13} className="text-slate-500 shrink-0" />}
                    </button>

                    {isOpen && (
                      <div className="px-4 pb-4 pt-2 space-y-3 bg-slate-900/60 border-t border-slate-800">
                        <p className="text-slate-300 leading-relaxed">{r.description}</p>
                        {r.command && (
                          <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono flex items-start gap-2">
                            <Terminal size={12} className="text-indigo-400 shrink-0 mt-0.5" />
                            <code className="text-green-400 text-[11px] break-all flex-1">{r.command}</code>
                            <CopyBtn text={r.command} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </Panel>
  )
}

// ── ROOT CAUSE + GRAPH SIDE PANELS ────────────────────────────────────────────
function RootCauseCascadePanel({ rootCause: causes, cascadePath, graphData }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Root causes */}
      <Panel>
        <SectionTitle icon={ShieldAlert} color="text-red-400">Root Cause Identification</SectionTitle>
        {!causes?.length ? (
          <p className="text-slate-400 text-xs italic">No metric anomalies detected</p>
        ) : (
          <div className="space-y-2">
            {causes.map((c, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700/40 text-xs">
                {c.reason === 'SERVICE_DOWN'    && <XCircle      size={16} className="text-red-400 shrink-0" />}
                {c.reason === 'HIGH_ERROR_RATE' && <AlertTriangle size={16} className="text-orange-400 shrink-0" />}
                {c.reason === 'HIGH_LATENCY'    && <Clock        size={16} className="text-yellow-400 shrink-0" />}
                <div>
                  <span className="font-semibold" style={{ color: SERVICE_COLORS[c.service] }}>{SERVICE_LABELS[c.service]}</span>
                  <span className="mx-2 text-slate-500">—</span>
                  <span className="text-slate-300">{c.reason.replace(/_/g, ' ')}</span>
                  {c.value != null && <span className="ml-2 font-mono text-[11px] text-slate-400">({c.metric}: {c.value})</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Cascade path */}
      <Panel>
        <SectionTitle icon={GitBranch} color="text-orange-400">NetworkX Cascade Path (BFS)</SectionTitle>
        {cascadePath?.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {cascadePath.map((svc, i) => (
              <React.Fragment key={svc}>
                <span className="px-3 py-1.5 rounded-full border text-xs font-semibold"
                  style={{ borderColor: SERVICE_COLORS[svc], color: SERVICE_COLORS[svc], background: `${SERVICE_COLORS[svc]}15` }}>
                  {SERVICE_LABELS[svc]}
                </span>
                {i < cascadePath.length - 1 && <ArrowRight size={14} className="text-slate-500" />}
              </React.Fragment>
            ))}
          </div>
        ) : (
          <p className="text-slate-500 text-xs italic">No cascade propagation path active</p>
        )}
        <div className="mt-3 pt-3 border-t border-slate-800">
          <p className="text-[11px] text-slate-500">
            Computed via NetworkX BFS from root-cause nodes through the architectural call tree. Shows the likely order of service degradation.
          </p>
        </div>
      </Panel>
    </div>
  )
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [data,          setData]          = useState(null)
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState(null)
  const [lastUpdated,   setLastUpdated]   = useState(null)
  const [apiStatus,     setApiStatus]     = useState('CHECKING')
  const [autoRefresh,   setAutoRefresh]   = useState(true)
  const [history,       setHistory]       = useState([])        // {t,risk,level}
  const [metricHistory, setMetricHistory] = useState([])        // {t,metrics:{svc:{...}}}
  const [activeSection, setActiveSection] = useState('overview')
  const sectionRefs = useRef({})

  const fetchPrediction = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`${API_BASE}/metrics/live`, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
      setError(null)
      setApiStatus('UP')
      const now = new Date()
      setLastUpdated(now)
      setHistory(prev => [...prev.slice(-29), { t: now, risk: json.cascade_risk ?? 0, level: json.risk_level || 'LOW' }])
      setMetricHistory(prev => [...prev.slice(-29), { t: now, metrics: json.live_metrics || {} }])
    } catch (e) {
      setError(e.message)
      setApiStatus('DOWN')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchPrediction() }, [fetchPrediction])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(fetchPrediction, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [autoRefresh, fetchPrediction])

  // Scroll-spy
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) setActiveSection(e.target.id) })
    }, { threshold: 0.3, rootMargin: '-80px 0px -60% 0px' })
    Object.values(sectionRefs.current).forEach(el => el && observer.observe(el))
    return () => observer.disconnect()
  }, [data])

  const scrollTo = id => {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActiveSection(id)
  }

  const riskLevel = data?.risk_level || 'LOW'

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      {/* ── Top Header ───────────────────────────────────────── */}
      <header className="bg-slate-900/95 backdrop-blur border-b border-slate-800 px-6 py-3 sticky top-0 z-50">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Zap size={22} className="text-indigo-400" />
              {riskLevel === 'CRITICAL' && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />}
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-100 leading-tight">Cascading Failure Prediction</h1>
              <p className="text-[10px] text-slate-400">Developer Dashboard · OmniStore Analysis Engine</p>
            </div>
            <div className={`ml-4 px-3 py-1 rounded-full border text-[11px] font-bold ${riskBg(riskLevel)}`}>
              <span className={riskColour(riskLevel)}>{riskLevel} RISK</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs">
              <span className={`w-2 h-2 rounded-full ${apiStatus === 'UP' ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
              <span className="text-slate-400">Analysis API</span>
              <span className={apiStatus === 'UP' ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>{apiStatus}</span>
            </div>
            <button onClick={() => setAutoRefresh(v => !v)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border transition
                ${autoRefresh ? 'bg-indigo-900/50 border-indigo-700 text-indigo-300' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
              <RefreshCw size={11} className={autoRefresh ? 'animate-spin' : ''} />
              {autoRefresh ? 'Live' : 'Paused'}
            </button>
            <button onClick={fetchPrediction} disabled={loading}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 transition disabled:opacity-50">
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <div className="flex max-w-screen-2xl mx-auto">
        {/* ── Sticky Sidebar Navigation ───────────────────────── */}
        <aside className="hidden xl:flex flex-col w-52 shrink-0 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto border-r border-slate-800 bg-slate-900/50 py-4 px-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold px-2 mb-3">Dashboard Sections</p>
          {NAV_SECTIONS.map(s => (
            <button key={s.id} onClick={() => scrollTo(s.id)}
              className={`flex items-center gap-2.5 text-xs px-3 py-2.5 rounded-lg mb-1 text-left transition w-full
                ${activeSection === s.id
                  ? 'bg-indigo-900/50 text-indigo-300 border border-indigo-800/60'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'}`}>
              <s.icon size={13} />
              {s.label}
            </button>
          ))}
          <div className="mt-auto pt-4 border-t border-slate-800 space-y-1.5">
            {[
              { href: 'http://localhost:3001', label: 'Grafana', color: 'text-orange-400' },
              { href: 'http://localhost:9090', label: 'Prometheus', color: 'text-orange-300' },
              { href: 'http://localhost:16686',label: 'Jaeger', color: 'text-purple-400' },
            ].map(l => (
              <a key={l.href} href={l.href} target="_blank" rel="noreferrer"
                className={`flex items-center gap-2 text-[11px] px-2 py-1.5 rounded hover:bg-slate-800 transition ${l.color}`}>
                <ExternalLink size={10} /> {l.label}
              </a>
            ))}
          </div>
        </aside>

        {/* ── Main Content ─────────────────────────────────────── */}
        <main className="flex-1 min-w-0 px-4 xl:px-6 py-6 space-y-6 pb-16">
          {/* API error banner */}
          {error && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-red-950/50 border border-red-700/50 text-sm">
              <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-red-300">Prediction / Analysis API Unreachable</p>
                <p className="text-red-400 text-xs mt-0.5">{error} — Ensure <code className="bg-red-900/50 px-1 rounded">ml/predict_api.py</code> is running on port 5001.</p>
              </div>
            </div>
          )}

          {/* ── Section refs wrapper ── */}
          {[
            { id: 'overview',     El: () => (
              <div ref={el => sectionRefs.current['overview'] = el}>
                <OverviewPanel data={data} history={history} loading={loading} lastUpdated={lastUpdated} />
              </div>
            )},
            { id: 'observability', El: () => (
              <div ref={el => sectionRefs.current['observability'] = el}>
                <ObservabilityPanel
                  system={data?.system}
                  liveMetrics={data?.live_metrics}
                  obsPct={data?.observability_pct}
                  obsStatus={data?.observability_status}
                />
              </div>
            )},
            { id: 'timeline', El: () => (
              <div ref={el => sectionRefs.current['timeline'] = el}>
                <ServiceTimelinePanel metricHistory={metricHistory} />
              </div>
            )},
            { id: 'graph', El: () => (
              <div ref={el => sectionRefs.current['graph'] = el}>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2">
                    <NetworkXGraphVisualizer graphData={data?.networkx_graph} />
                  </div>
                  <Panel>
                    <SectionTitle icon={BarChart2} color="text-indigo-400">RF Feature Importances</SectionTitle>
                    {(data?.feature_importances || []).length > 0 ? (
                      <div className="space-y-2 text-xs">
                        {(data.feature_importances || []).slice(0, 7).map((item, idx) => {
                          const pct = Math.round((item.importance / Math.max(...data.feature_importances.map(i => i.importance), 1)) * 100)
                          return (
                            <div key={idx} className="space-y-1">
                              <div className="flex justify-between font-mono text-[11px]">
                                <span className="text-slate-300 truncate pr-2">{item.feature.replace(/_/g, ' ')}</span>
                                <span className="text-indigo-400 font-bold shrink-0">{(item.importance * 100).toFixed(1)}%</span>
                              </div>
                              <MiniBar value={pct} max={100} color="bg-indigo-500" />
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="text-slate-500 text-xs italic">Loading…</p>
                    )}
                  </Panel>
                </div>
                <RootCauseCascadePanel rootCause={data?.root_cause} cascadePath={data?.cascade_path} />
              </div>
            )},
            { id: 'sla', El: () => (
              <div ref={el => sectionRefs.current['sla'] = el}>
                <SLACompliancePanel slaData={data?.sla_compliance} />
              </div>
            )},
            { id: 'anomaly', El: () => (
              <div ref={el => sectionRefs.current['anomaly'] = el}>
                <AnomalyEnginePanel
                  zData={data?.z_score_analysis}
                  temporalData={data?.temporal_analysis}
                  importances={data?.feature_importances}
                />
              </div>
            )},
            { id: 'incidents', El: () => (
              <div ref={el => sectionRefs.current['incidents'] = el}>
                <IncidentLogPanel incidents={data?.incident_log} />
              </div>
            )},
            { id: 'fault', El: () => (
              <div ref={el => sectionRefs.current['fault'] = el}>
                <FaultInjectionPanel />
              </div>
            )},
            { id: 'recs', El: () => (
              <div ref={el => sectionRefs.current['recs'] = el}>
                <RecommendationsPanel
                  recs={data?.recommendations}
                  rootCause={data?.root_cause}
                  cascadePath={data?.cascade_path}
                />
              </div>
            )},
          ].map(({ id, El }) => <El key={id} />)}
        </main>
      </div>

      <footer className="border-t border-slate-800 py-4 text-center text-xs text-slate-600">
        Cascade Failure Prediction · Developer Dashboard ·
        Analysis API: <code className="text-indigo-400">http://localhost:5001</code> ·
        Grafana: <code className="text-orange-400">http://localhost:3001</code> ·
        Prometheus: <code className="text-orange-400">http://localhost:9090</code> ·
        Jaeger: <code className="text-purple-400">http://localhost:16686</code>
      </footer>
    </div>
  )
}
