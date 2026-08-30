import React, { useState, useEffect, useCallback } from 'react'
import {
  AlertTriangle, CheckCircle, XCircle, Activity, Zap,
  ArrowRight, RefreshCw, Server, Clock, TrendingUp,
  ShieldAlert, Lightbulb, GitBranch, Database, Info
} from 'lucide-react'

const API_BASE = '/api'
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

// ─── Risk colour helpers ──────────────────────────────────────────────────────
const riskColour = (level) => ({
  CRITICAL: 'text-red-400',
  HIGH:     'text-orange-400',
  MEDIUM:   'text-yellow-400',
  LOW:      'text-green-400',
}[level] || 'text-slate-400')

const riskBg = (level) => ({
  CRITICAL: 'bg-red-500/20 border-red-500/40',
  HIGH:     'bg-orange-500/20 border-orange-500/40',
  MEDIUM:   'bg-yellow-500/20 border-yellow-500/40',
  LOW:      'bg-green-500/20 border-green-500/40',
}[level] || 'bg-slate-800 border-slate-700')

const riskBarColour = (level) => ({
  CRITICAL: 'bg-red-500',
  HIGH:     'bg-orange-500',
  MEDIUM:   'bg-yellow-500',
  LOW:      'bg-green-500',
}[level] || 'bg-slate-500')

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ up }) {
  return up === 1
    ? <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle size={12}/> UP</span>
    : <span className="flex items-center gap-1 text-xs text-red-400"><XCircle size={12}/> DOWN</span>
}

function MetricCard({ label, value, unit = '', warn = false }) {
  return (
    <div className={`rounded-lg border p-3 ${warn ? 'bg-red-900/20 border-red-700/40' : 'bg-slate-800/60 border-slate-700/50'}`}>
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className={`text-lg font-bold font-mono ${warn ? 'text-red-300' : 'text-slate-100'}`}>
        {typeof value === 'number' ? value.toFixed(3) : value}
        {unit && <span className="text-xs text-slate-400 ml-1">{unit}</span>}
      </p>
    </div>
  )
}

function ServiceRow({ name, metrics }) {
  if (!metrics) return null
  const label   = SERVICE_LABELS[name] || name
  const isDown  = metrics.service_up === 0
  const hasErr  = metrics.error_rate_5xx > 0.05
  const slowP99 = metrics.p99_latency_s > 1.5

  return (
    <div className={`flex items-center gap-4 px-4 py-3 rounded-lg border text-sm
      ${isDown ? 'bg-red-950/40 border-red-700/40' :
        hasErr  ? 'bg-orange-950/30 border-orange-700/30' :
        slowP99 ? 'bg-yellow-950/20 border-yellow-700/20' :
                  'bg-slate-800/40 border-slate-700/30'}`}>
      <div className="w-36 font-medium text-slate-200">{label}</div>
      <StatusBadge up={metrics.service_up} />
      <div className="flex gap-3 ml-auto text-xs font-mono text-slate-400">
        <span className={hasErr ? 'text-red-400' : ''}>
          5xx: {metrics.error_rate_5xx.toFixed(3)}/s
        </span>
        <span className={slowP99 ? 'text-yellow-400' : ''}>
          p99: {metrics.p99_latency_s.toFixed(3)}s
        </span>
        <span>req: {metrics.request_rate.toFixed(3)}/s</span>
      </div>
    </div>
  )
}

function CascadePath({ path }) {
  if (!path || path.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {path.map((svc, i) => (
        <React.Fragment key={svc}>
          <span className="px-3 py-1 rounded-full bg-indigo-900/50 border border-indigo-700/50 text-indigo-200 text-sm font-medium">
            {SERVICE_LABELS[svc] || svc}
          </span>
          {i < path.length - 1 && <ArrowRight size={14} className="text-slate-500" />}
        </React.Fragment>
      ))}
    </div>
  )
}

function RootCauseList({ causes }) {
  if (!causes || causes.length === 0)
    return <p className="text-slate-400 text-sm italic">No anomalies detected</p>

  const icons = {
    SERVICE_DOWN:    <XCircle size={16} className="text-red-400 shrink-0" />,
    HIGH_ERROR_RATE: <AlertTriangle size={16} className="text-orange-400 shrink-0" />,
    HIGH_LATENCY:    <Clock size={16} className="text-yellow-400 shrink-0" />,
  }

  return (
    <div className="space-y-2">
      {causes.map((c, i) => (
        <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700/40 text-sm">
          {icons[c.reason] || <Info size={16} className="text-slate-400 shrink-0" />}
          <div>
            <span className="font-semibold text-slate-200">{SERVICE_LABELS[c.service] || c.service}</span>
            <span className="mx-2 text-slate-500">—</span>
            <span className="text-slate-300">{c.reason.replace(/_/g, ' ')}</span>
            {c.value !== undefined && (
              <span className="ml-2 font-mono text-xs text-slate-400">({c.metric}: {c.value})</span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function RecommendationList({ recs }) {
  if (!recs || recs.length === 0)
    return <p className="text-slate-400 text-sm italic">System is healthy — no actions needed</p>

  return (
    <ol className="space-y-2">
      {recs.map((r, i) => (
        <li key={i} className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700/40 text-sm">
          <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-800 text-indigo-200 text-xs flex items-center justify-center font-bold">
            {i + 1}
          </span>
          <span className="text-slate-300">{r}</span>
        </li>
      ))}
    </ol>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [data,         setData]         = useState(null)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState(null)
  const [lastUpdated,  setLastUpdated]  = useState(null)
  const [apiStatus,    setApiStatus]    = useState('CHECKING')
  const [autoRefresh,  setAutoRefresh]  = useState(true)
  const [history,      setHistory]      = useState([])   // last 20 risk scores

  // ── Fetch live prediction ──────────────────────────────────────────────────
  const fetchPrediction = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/metrics/live`, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
      setError(null)
      setApiStatus('UP')
      setLastUpdated(new Date())
      setHistory(prev => [...prev.slice(-19), { t: new Date(), risk: json.cascade_risk, level: json.risk_level }])
    } catch (e) {
      setError(e.message)
      setApiStatus('DOWN')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPrediction()
  }, [fetchPrediction])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(fetchPrediction, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [autoRefresh, fetchPrediction])

  // ── Render helpers ─────────────────────────────────────────────────────────
  const riskLevel    = data?.risk_level    || 'LOW'
  const cascadeRisk  = data?.cascade_risk  ?? 0
  const riskPct      = Math.round(cascadeRisk * 100)

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Zap size={24} className="text-indigo-400" />
            <div>
              <h1 className="text-lg font-bold text-slate-100">Cascade Failure Prediction</h1>
              <p className="text-xs text-slate-400">Developer Dashboard — OmniStore Platform</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {/* API status */}
            <div className="flex items-center gap-2 text-xs">
              <span className={`w-2 h-2 rounded-full ${apiStatus === 'UP' ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
              <span className="text-slate-400">Prediction API</span>
              <span className={apiStatus === 'UP' ? 'text-green-400' : 'text-red-400'}>{apiStatus}</span>
            </div>
            {/* Auto-refresh toggle */}
            <button
              onClick={() => setAutoRefresh(v => !v)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border transition
                ${autoRefresh
                  ? 'bg-indigo-900/50 border-indigo-700 text-indigo-300'
                  : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
              <RefreshCw size={12} className={autoRefresh ? 'animate-spin' : ''} />
              {autoRefresh ? 'Live' : 'Paused'}
            </button>
            <button
              onClick={fetchPrediction}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 transition disabled:opacity-50">
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">

        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-3 p-4 rounded-lg bg-red-950/50 border border-red-700/50 text-sm">
            <AlertTriangle size={16} className="text-red-400 shrink-0" />
            <div>
              <p className="font-semibold text-red-300">Prediction API Unavailable</p>
              <p className="text-red-400 text-xs mt-0.5">{error} — Make sure <code className="bg-red-900/50 px-1 rounded">ml/predict_api.py</code> is running on port 5001</p>
            </div>
          </div>
        )}

        {/* ── Risk Score Hero ─────────────────────────────────────────────── */}
        <div className={`rounded-xl border p-6 ${riskBg(riskLevel)}`}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-slate-400 mb-1">Cascade Risk Score</p>
              <div className="flex items-end gap-3">
                <span className={`text-6xl font-black font-mono ${riskColour(riskLevel)}`}>{riskPct}%</span>
                <div className="mb-2">
                  <span className={`text-2xl font-bold ${riskColour(riskLevel)}`}>{riskLevel}</span>
                  <p className="text-xs text-slate-400 mt-0.5">{data?.prediction || '—'}</p>
                </div>
              </div>
              {/* Risk bar */}
              <div className="w-80 h-2 bg-slate-700 rounded-full mt-3 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${riskBarColour(riskLevel)}`}
                  style={{ width: `${riskPct}%` }}
                />
              </div>
            </div>
            {/* Mini history sparkline */}
            <div className="text-right">
              <p className="text-xs text-slate-500 mb-2">Risk history (last {history.length} polls)</p>
              <div className="flex items-end gap-0.5 h-12">
                {history.map((h, i) => (
                  <div
                    key={i}
                    title={`${Math.round(h.risk * 100)}% at ${h.t.toLocaleTimeString()}`}
                    className={`w-2 rounded-t ${riskBarColour(h.level)} opacity-80`}
                    style={{ height: `${Math.max(4, Math.round(h.risk * 48))}px` }}
                  />
                ))}
              </div>
              {lastUpdated && (
                <p className="text-xs text-slate-500 mt-1">
                  Updated {lastUpdated.toLocaleTimeString()}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── System overview + service grid ─────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* System metrics */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <TrendingUp size={14} className="text-indigo-400" /> System Metrics
            </h2>
            <MetricCard label="Mean Error Rate" value={data?.system?.mean_error_rate ?? 0} unit="req/s"
              warn={(data?.system?.mean_error_rate ?? 0) > 0.05} />
            <MetricCard label="Max P99 Latency" value={data?.system?.max_p99_latency ?? 0} unit="s"
              warn={(data?.system?.max_p99_latency ?? 0) > 1.5} />
            <div className={`rounded-lg border p-3 ${(data?.system?.num_services_down ?? 0) > 0 ? 'bg-red-900/20 border-red-700/40' : 'bg-slate-800/60 border-slate-700/50'}`}>
              <p className="text-xs text-slate-400 mb-1">Services Down</p>
              <p className={`text-lg font-bold font-mono ${(data?.system?.num_services_down ?? 0) > 0 ? 'text-red-300' : 'text-green-400'}`}>
                {data?.system?.num_services_down ?? 0} / {SERVICES.length}
              </p>
            </div>
            <MetricCard label="Model Confidence" value={(data?.confidence ?? 0)} />
          </div>

          {/* Per-service grid */}
          <div className="lg:col-span-2 space-y-2">
            <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <Server size={14} className="text-indigo-400" /> Service Health
            </h2>
            {SERVICES.map(svc => (
              <ServiceRow key={svc} name={svc} metrics={data?.live_metrics?.[svc]} />
            ))}
          </div>
        </div>

        {/* ── Analysis panels ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Root Cause */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2 mb-4">
              <ShieldAlert size={14} className="text-red-400" /> Root Cause Analysis
            </h2>
            <RootCauseList causes={data?.root_cause} />
          </div>

          {/* Cascade Path */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2 mb-4">
              <GitBranch size={14} className="text-orange-400" /> Estimated Cascade Path
            </h2>
            {data?.cascade_path?.length > 0
              ? <CascadePath path={data.cascade_path} />
              : <p className="text-slate-400 text-sm italic">No cascade propagation detected</p>
            }
            <div className="mt-4 pt-4 border-t border-slate-800">
              <p className="text-xs text-slate-500">
                Path shows estimated failure propagation direction based on architectural dependency graph.
                Actual cascades may vary.
              </p>
            </div>
          </div>

        </div>

        {/* ── Recommendations ─────────────────────────────────────────────── */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2 mb-4">
            <Lightbulb size={14} className="text-yellow-400" /> Recommendations
          </h2>
          <RecommendationList recs={data?.recommendations} />
        </div>

        {/* ── Impact assessment ───────────────────────────────────────────── */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2 mb-4">
            <Activity size={14} className="text-purple-400" /> Risk / Impact Assessment
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            {SERVICES.map(svc => {
              const m   = data?.live_metrics?.[svc]
              const err = m?.error_rate_5xx ?? 0
              const p99 = m?.p99_latency_s ?? 0
              const up  = m?.service_up ?? 1
              const impact = up === 0 ? 'CRITICAL' : err > 0.1 ? 'HIGH' : p99 > 2 ? 'MEDIUM' : 'LOW'
              return (
                <div key={svc} className={`rounded-lg border p-3 ${riskBg(impact)}`}>
                  <p className="text-xs text-slate-400 mb-1">{SERVICE_LABELS[svc]}</p>
                  <p className={`font-bold text-sm ${riskColour(impact)}`}>{impact}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {up === 0 ? 'Service DOWN' : `err: ${err.toFixed(3)} | p99: ${p99.toFixed(2)}s`}
                  </p>
                </div>
              )
            })}
          </div>
        </div>

      </main>

      <footer className="border-t border-slate-800 py-4 text-center text-xs text-slate-600 mt-8">
        Cascade Failure Prediction — Developer Dashboard &bull;
        Prediction API: <code className="text-indigo-500">http://localhost:5001</code> &bull;
        Prometheus: <code className="text-indigo-500">http://localhost:9090</code> &bull;
        Grafana: <code className="text-indigo-500">http://localhost:3001</code>
      </footer>
    </div>
  )
}
