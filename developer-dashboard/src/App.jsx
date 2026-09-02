import React, { useState, useEffect, useCallback } from 'react'
import {
  AlertTriangle, CheckCircle, XCircle, Activity, Zap,
  ArrowRight, RefreshCw, Server, Clock, TrendingUp,
  ShieldAlert, Lightbulb, GitBranch, Database, Info,
  Network, Cpu, Layers, BarChart2, AlertCircle, ExternalLink
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

// Fixed positions for standard topological layout in NetworkX SVG canvas
const NODE_POSITIONS = {
  order:        { x: 260, y: 55 },
  inventory:    { x: 80,  y: 175 },
  payment:      { x: 260, y: 175 },
  shipping:     { x: 440, y: 175 },
  delivery:     { x: 440, y: 295 },
  notification: { x: 170, y: 295 },
}

// ─── Colour Helpers ──────────────────────────────────────────────────────────
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

const statusNodeColour = (status) => ({
  ROOT_CAUSE: { fill: '#ef4444', stroke: '#b91c1c', text: '#white', badge: 'bg-red-950 text-red-200 border-red-700' },
  DOWN:       { fill: '#dc2626', stroke: '#991b1b', text: '#white', badge: 'bg-red-900 text-red-100 border-red-600' },
  ANOMALOUS:  { fill: '#f59e0b', stroke: '#b45309', text: '#white', badge: 'bg-amber-950 text-amber-200 border-amber-700' },
  NORMAL:     { fill: '#3b82f6', stroke: '#1d4ed8', text: '#white', badge: 'bg-blue-950 text-blue-200 border-blue-700' },
}[status] || { fill: '#64748b', stroke: '#334155', text: '#white', badge: 'bg-slate-800 text-slate-300 border-slate-700' })


// ─── Sub-Components ──────────────────────────────────────────────────────────

function StatusBadge({ up }) {
  return up === 1
    ? <span className="flex items-center gap-1 text-xs text-green-400 font-medium"><CheckCircle size={12}/> UP</span>
    : <span className="flex items-center gap-1 text-xs text-red-400 font-medium"><XCircle size={12}/> DOWN</span>
}

function MetricCard({ label, value, unit = '', warn = false, sub = '' }) {
  return (
    <div className={`rounded-lg border p-3.5 transition-all ${warn ? 'bg-red-900/20 border-red-700/40' : 'bg-slate-800/60 border-slate-700/50'}`}>
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className={`text-lg font-bold font-mono ${warn ? 'text-red-300' : 'text-slate-100'}`}>
        {typeof value === 'number' ? value.toFixed(3) : value}
        {unit && <span className="text-xs text-slate-400 ml-1">{unit}</span>}
      </p>
      {sub && <p className="text-[10px] text-slate-500 mt-1">{sub}</p>}
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
    <div className={`flex items-center gap-4 px-4 py-3 rounded-lg border text-sm transition-all
      ${isDown ? 'bg-red-950/40 border-red-700/40' :
        hasErr  ? 'bg-orange-950/30 border-orange-700/30' :
        slowP99 ? 'bg-yellow-950/20 border-yellow-700/20' :
                  'bg-slate-800/40 border-slate-700/30'}`}>
      <div className="w-36 font-semibold text-slate-200">{label}</div>
      <StatusBadge up={metrics.service_up} />
      <div className="flex gap-4 ml-auto text-xs font-mono text-slate-400">
        <span className={hasErr ? 'text-red-400 font-bold' : ''}>
          5xx: {metrics.error_rate_5xx.toFixed(3)}/s
        </span>
        <span className={slowP99 ? 'text-yellow-400 font-bold' : ''}>
          p99: {metrics.p99_latency_s.toFixed(3)}s
        </span>
        <span>req: {metrics.request_rate.toFixed(3)}/s</span>
      </div>
    </div>
  )
}

// ─── NetworkX Graph Visualization Component ──────────────────────────────────
function NetworkXGraphVisualizer({ graphData }) {
  if (!graphData || !graphData.nodes) {
    return <div className="text-slate-500 text-xs italic py-8 text-center">NetworkX graph data loading...</div>
  }

  const nodes = graphData.nodes
  const edges = graphData.edges

  return (
    <div className="relative bg-slate-950/70 border border-slate-800 rounded-xl p-4 overflow-hidden">
      <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2">
          <Network size={16} className="text-indigo-400" />
          <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
            Live NetworkX Dependency Graph &amp; Cascade Impact (%)
          </h3>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-400">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-0.5 bg-indigo-500 inline-block"/> Architectural
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-0.5 border-t border-dashed border-red-500 inline-block"/> Correlation Arc
          </span>
          <span className="text-slate-500 font-mono">
            {graphData.node_count} nodes &bull; {graphData.edge_count} edges
          </span>
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

          {/* Render Edges */}
          {edges.map((edge, idx) => {
            const p1 = NODE_POSITIONS[edge.source] || { x: 100, y: 100 }
            const p2 = NODE_POSITIONS[edge.target] || { x: 200, y: 200 }
            const isCorr = edge.type === 'data_driven'

            if (isCorr) {
              // Quadratic curved arc for dynamic correlation lines so they never overlap straight architectural lines
              const mx = (p1.x + p2.x) / 2
              const my = (p1.y + p2.y) / 2
              const dx = p2.x - p1.x
              const dy = p2.y - p1.y
              const cx = mx - dy * 0.35
              const cy = my + dx * 0.35

              return (
                <g key={`corr-${idx}`}>
                  <path
                    d={`M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}`}
                    fill="none"
                    stroke="#ef4444"
                    strokeWidth={Math.max(1.8, edge.weight * 2.8)}
                    strokeDasharray="5,4"
                    markerEnd="url(#arrow-corr)"
                    opacity="0.95"
                  />
                  {/* Badge for Correlation Strength r */}
                  <rect
                    x={cx - 18} y={cy - 8}
                    width="36" height="14" rx="4"
                    fill="#450a0a" stroke="#b91c1c" strokeWidth="1"
                  />
                  <text
                    x={cx} y={cy + 2}
                    fill="#fca5a5"
                    fontSize="9"
                    fontWeight="bold"
                    fontFamily="monospace"
                    textAnchor="middle">
                    r={edge.correlation}
                  </text>
                </g>
              )
            }

            return (
              <g key={`arch-${idx}`}>
                <line
                  x1={p1.x} y1={p1.y}
                  x2={p2.x} y2={p2.y}
                  stroke="#6366f1"
                  strokeWidth="2.2"
                  markerEnd="url(#arrow-arch)"
                  opacity="0.85"
                />
              </g>
            )
          })}

          {/* Render Nodes */}
          {nodes.map((node) => {
            const pos = NODE_POSITIONS[node.id] || { x: 150, y: 150 }
            const colors = statusNodeColour(node.status)
            const effectPct = node.cascade_effect_pct ?? 0

            return (
              <g key={node.id} className="cursor-pointer group">
                {/* Outer halo if affected by cascade */}
                {effectPct > 0 && (
                  <circle
                    cx={pos.x} cy={pos.y} r="28"
                    fill="none"
                    stroke={effectPct > 70 ? '#ef4444' : '#f97316'}
                    strokeWidth="2"
                    strokeDasharray="4,3"
                    className="animate-spin"
                    style={{ animationDuration: '10s' }}
                  />
                )}

                <circle
                  cx={pos.x} cy={pos.y} r="22"
                  fill={colors.fill}
                  stroke={colors.stroke}
                  strokeWidth="3"
                  className={node.status === 'ROOT_CAUSE' ? 'animate-pulse' : ''}
                />
                <text
                  x={pos.x} y={pos.y + 4}
                  fill="#ffffff"
                  fontSize="10"
                  fontWeight="bold"
                  textAnchor="middle">
                  {node.id.toUpperCase().slice(0, 4)}
                </text>

                {/* Node Label Below */}
                <text
                  x={pos.x} y={pos.y + 36}
                  fill="#cbd5e1"
                  fontSize="11"
                  fontWeight="600"
                  textAnchor="middle">
                  {SERVICE_LABELS[node.id] || node.id}
                </text>

                {/* NetworkX PageRank Badge */}
                <rect
                  x={pos.x - 24} y={pos.y - 36}
                  width="48" height="14" rx="7"
                  fill="#0f172a" stroke="#334155" strokeWidth="1"
                />
                <text
                  x={pos.x} y={pos.y - 26}
                  fill="#94a3b8"
                  fontSize="8"
                  fontFamily="monospace"
                  textAnchor="middle">
                  PR: {node.pagerank}
                </text>

                {/* Cascade Effect % Badge */}
                <rect
                  x={pos.x - 28} y={pos.y + 42}
                  width="56" height="15" rx="7"
                  fill={effectPct > 70 ? '#7f1d1d' : effectPct > 0 ? '#7c2d12' : '#0f172a'}
                  stroke={effectPct > 70 ? '#ef4444' : effectPct > 0 ? '#f97316' : '#334155'}
                  strokeWidth="1"
                />
                <text
                  x={pos.x} y={pos.y + 53}
                  fill={effectPct > 0 ? '#fca5a5' : '#94a3b8'}
                  fontSize="9"
                  fontWeight="bold"
                  fontFamily="monospace"
                  textAnchor="middle">
                  {effectPct}% Effect
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* Node Metrics & Cascade Effect Summary Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2 pt-3 border-t border-slate-800 text-[11px]">
        {nodes.map(n => (
          <div key={n.id} className="flex items-center justify-between p-1.5 rounded bg-slate-900/60 border border-slate-800 font-mono">
            <span className="text-slate-400 font-sans font-semibold">{SERVICE_LABELS[n.id] || n.id}:</span>
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

// ─── Grafana Visibility & Observability Component ─────────────────────────────
function GrafanaVisibilityPanel({ system, liveMetrics }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <Layers size={18} className="text-orange-400" />
          <div>
            <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              Grafana Live Observability &amp; Visibility Stream (Port 3001)
            </h3>
            <p className="text-[11px] text-slate-400">Raw observability metrics (P99 latency, HTTP 5xx error rate, JVM heap, thread count)</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="http://localhost:3001"
            target="_blank"
            rel="noreferrer"
            className="text-xs px-3 py-1.5 rounded bg-orange-950/60 border border-orange-700/60 text-orange-300 hover:bg-orange-900/60 transition flex items-center gap-1 font-semibold">
            Open Grafana (3001) <ExternalLink size={12}/>
          </a>
          <a
            href="http://localhost:9090"
            target="_blank"
            rel="noreferrer"
            className="text-xs px-3 py-1.5 rounded bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 transition flex items-center gap-1 font-semibold">
            Prometheus <ExternalLink size={12}/>
          </a>
          <a
            href="http://localhost:16686"
            target="_blank"
            rel="noreferrer"
            className="text-xs px-3 py-1.5 rounded bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 transition flex items-center gap-1 font-semibold">
            Jaeger <ExternalLink size={12}/>
          </a>
        </div>
      </div>

      {/* Grafana Observability Metrics Stream Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3.5 space-y-1">
          <p className="text-slate-400 font-medium">Max P99 Latency Stream</p>
          <p className="text-xl font-bold font-mono text-amber-400">
            {(system?.max_p99_latency ?? 0).toFixed(3)}s
          </p>
          <p className="text-[10px] text-slate-500">Scraped via Grafana / Prometheus</p>
        </div>
        <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3.5 space-y-1">
          <p className="text-slate-400 font-medium">System 5xx Error Stream</p>
          <p className="text-xl font-bold font-mono text-red-400">
            {(system?.mean_error_rate ?? 0).toFixed(3)} req/s
          </p>
          <p className="text-[10px] text-slate-500">Grafana HTTP 5xx Channel</p>
        </div>
        <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3.5 space-y-1">
          <p className="text-slate-400 font-medium">Services Health Probes</p>
          <p className={`text-xl font-bold font-mono ${(system?.num_services_down ?? 0) > 0 ? 'text-red-400' : 'text-green-400'}`}>
            {6 - (system?.num_services_down ?? 0)} / 6 ONLINE
          </p>
          <p className="text-[10px] text-slate-500">Grafana Actuator Health Scrape</p>
        </div>
        <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3.5 space-y-1">
          <p className="text-slate-400 font-medium">Grafana Telemetry Status</p>
          <p className="text-xl font-bold text-green-400 font-mono">CONNECTED</p>
          <p className="text-[10px] text-slate-500">Prometheus + Loki + Jaeger</p>
        </div>
      </div>
    </div>
  )
}

// ─── Z-Score Anomaly Analysis Panel ──────────────────────────────────────────
function ZScoreAnalysisPanel({ zData }) {
  if (!zData || !zData.services) {
    return <p className="text-slate-500 text-xs italic">Z-score anomaly data loading...</p>
  }

  const { services, max_zscore, flagged_count } = zData

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertCircle size={15} className="text-purple-400" />
          <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
            Z-Score Anomaly Analysis
          </h3>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="text-slate-400">Max deviation:</span>
          <span className={`px-2 py-0.5 rounded font-bold ${max_zscore > 3 ? 'bg-red-950 text-red-400 border border-red-800' : 'bg-slate-800 text-green-400'}`}>
            {max_zscore} &sigma;
          </span>
          <span className="text-slate-500">({flagged_count} flagged)</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        {Object.entries(services).map(([svc, metrics]) => {
          const hasAnomaly = Object.values(metrics).some(m => m.anomalous)
          return (
            <div key={svc} className={`p-3 rounded-lg border text-xs font-mono ${hasAnomaly ? 'bg-purple-950/20 border-purple-800/40' : 'bg-slate-800/40 border-slate-700/30'}`}>
              <div className="flex items-center justify-between font-sans font-semibold text-slate-300 mb-2">
                <span>{SERVICE_LABELS[svc] || svc}</span>
                {hasAnomaly && <span className="text-[10px] bg-purple-900/60 text-purple-300 px-1.5 py-0.5 rounded border border-purple-700/50">ANOMALOUS (&gt;3&sigma;)</span>}
              </div>
              <div className="space-y-1">
                {Object.entries(metrics).map(([mName, mInfo]) => (
                  <div key={mName} className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400 font-sans">{mName.replace(/_/g, ' ')}:</span>
                    <span className={mInfo.anomalous ? 'text-red-400 font-bold' : 'text-slate-300'}>
                      {mInfo.val} <span className="text-[10px] text-slate-500">({mInfo.z_score}&sigma;)</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Temporal Analysis Panel ─────────────────────────────────────────────────
function TemporalAnalysisPanel({ temporalData }) {
  if (!temporalData) {
    return <p className="text-slate-500 text-xs italic">Temporal metrics loading...</p>
  }

  const { delta_error_rate, delta_latency, rolling_3_mean_error, acceleration_error, propagation_onset } = temporalData

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Clock size={15} className="text-cyan-400" />
        <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
          Temporal Analysis &amp; Propagation Onset
        </h3>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <MetricCard
          label="Rate of Change (Error)"
          value={delta_error_rate}
          unit="err/s²"
          warn={delta_error_rate > 0.01}
          sub="&Delta; error rate vs previous poll"
        />
        <MetricCard
          label="Latency Change"
          value={delta_latency}
          unit="s/poll"
          warn={delta_latency > 0.5}
          sub="&Delta; P99 latency vs previous poll"
        />
        <MetricCard
          label="3-Poll Rolling Mean"
          value={rolling_3_mean_error}
          unit="err/s"
          warn={rolling_3_mean_error > 0.05}
          sub="System rolling error average"
        />
        <MetricCard
          label="Error Acceleration"
          value={acceleration_error}
          unit="acc"
          warn={acceleration_error > 0.005}
          sub="2nd derivative of system error"
        />
      </div>

      {/* Propagation Onset Sequence */}
      <div className="bg-slate-800/40 border border-slate-700/30 rounded-lg p-3 text-xs">
        <p className="text-slate-400 font-semibold mb-2">Propagation Onset Sequence (Time Order):</p>
        {propagation_onset && propagation_onset.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {propagation_onset.map((item, idx) => (
              <React.Fragment key={idx}>
                <span className="px-2.5 py-1 rounded bg-cyan-950 border border-cyan-800/60 text-cyan-200 font-mono text-[11px]">
                  {idx + 1}. {SERVICE_LABELS[item.service] || item.service} <span className="text-slate-500">({item.time})</span>
                </span>
                {idx < propagation_onset.length - 1 && <ArrowRight size={12} className="text-slate-600" />}
              </React.Fragment>
            ))}
          </div>
        ) : (
          <p className="text-slate-500 italic">No degradation onset recorded in window</p>
        )}
      </div>
    </div>
  )
}

// ─── Random Forest Feature Importances Panel ──────────────────────────────────
function FeatureImportancesPanel({ importances }) {
  if (!importances || importances.length === 0) {
    return <p className="text-slate-500 text-xs italic">Feature importances loading...</p>
  }

  const maxImp = Math.max(...importances.map(i => i.importance)) || 1.0

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <BarChart2 size={15} className="text-indigo-400" />
        <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
          Top Random Forest Feature Importances
        </h3>
      </div>

      <div className="space-y-2 text-xs">
        {importances.slice(0, 5).map((item, idx) => {
          const pct = Math.round((item.importance / maxImp) * 100)
          return (
            <div key={idx} className="space-y-1">
              <div className="flex justify-between font-mono text-[11px]">
                <span className="text-slate-300">{item.feature.replace(/_/g, ' ')}</span>
                <span className="text-indigo-400 font-bold">{(item.importance * 100).toFixed(1)}%</span>
              </div>
              <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )
        })}
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
          <span className="px-3 py-1 rounded-full bg-indigo-900/50 border border-indigo-700/50 text-indigo-200 text-xs font-semibold">
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
    return <p className="text-slate-400 text-xs italic">No metric anomalies detected</p>

  const icons = {
    SERVICE_DOWN:    <XCircle size={16} className="text-red-400 shrink-0" />,
    HIGH_ERROR_RATE: <AlertTriangle size={16} className="text-orange-400 shrink-0" />,
    HIGH_LATENCY:    <Clock size={16} className="text-yellow-400 shrink-0" />,
  }

  return (
    <div className="space-y-2">
      {causes.map((c, i) => (
        <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700/40 text-xs">
          {icons[c.reason] || <Info size={16} className="text-slate-400 shrink-0" />}
          <div>
            <span className="font-semibold text-slate-200">{SERVICE_LABELS[c.service] || c.service}</span>
            <span className="mx-2 text-slate-500">—</span>
            <span className="text-slate-300">{c.reason.replace(/_/g, ' ')}</span>
            {c.value !== undefined && (
              <span className="ml-2 font-mono text-[11px] text-slate-400">({c.metric}: {c.value})</span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function RecommendationList({ recs }) {
  if (!recs || recs.length === 0)
    return <p className="text-slate-400 text-xs italic">System operating within normal bounds</p>

  return (
    <ol className="space-y-2">
      {recs.map((r, i) => (
        <li key={i} className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700/40 text-xs">
          <span className="shrink-0 w-5 h-5 rounded-full bg-indigo-800 text-indigo-200 text-[11px] flex items-center justify-center font-bold">
            {i + 1}
          </span>
          <span className="text-slate-300">{r}</span>
        </li>
      ))}
    </ol>
  )
}


// ─── Main Developer Dashboard App ─────────────────────────────────────────────

export default function App() {
  const [data,         setData]         = useState(null)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState(null)
  const [lastUpdated,  setLastUpdated]  = useState(null)
  const [apiStatus,    setApiStatus]    = useState('CHECKING')
  const [autoRefresh,  setAutoRefresh]  = useState(true)
  const [history,      setHistory]      = useState([])

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

  const riskLevel   = data?.risk_level    || 'LOW'
  const cascadeRisk = data?.cascade_risk  ?? 0
  const riskPct     = Math.round(cascadeRisk * 100)

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans pb-12">
      {/* Top Header */}
      <header className="bg-slate-900/90 backdrop-blur border-b border-slate-800 px-6 py-4 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Zap size={24} className="text-indigo-400" />
            <div>
              <h1 className="text-lg font-bold text-slate-100">Cascading Failure Prediction</h1>
              <p className="text-xs text-slate-400">Developer Dashboard &bull; OmniStore Analysis Engine</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs">
              <span className={`w-2 h-2 rounded-full ${apiStatus === 'UP' ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
              <span className="text-slate-400">Analysis API</span>
              <span className={apiStatus === 'UP' ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>{apiStatus}</span>
            </div>
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

        {/* API Warning */}
        {error && (
          <div className="flex items-center gap-3 p-4 rounded-lg bg-red-950/50 border border-red-700/50 text-sm">
            <AlertTriangle size={18} className="text-red-400 shrink-0" />
            <div>
              <p className="font-semibold text-red-300">Prediction/Analysis API Unreachable</p>
              <p className="text-red-400 text-xs mt-0.5">{error} — Ensure <code className="bg-red-900/50 px-1 rounded">ml/predict_api.py</code> is running on port 5001.</p>
            </div>
          </div>
        )}

        {/* ── 1. Hero Cascade Risk Gauge & Random Forest Classifier Status ── */}
        <div className={`rounded-xl border p-6 ${riskBg(riskLevel)}`}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Random Forest Risk Assessment</p>
              <div className="flex items-end gap-3">
                <span className={`text-6xl font-black font-mono ${riskColour(riskLevel)}`}>{riskPct}%</span>
                <div className="mb-2">
                  <span className={`text-2xl font-bold ${riskColour(riskLevel)}`}>{riskLevel}</span>
                  <p className="text-xs text-slate-400 mt-0.5">{data?.prediction || '—'} (Conf: {data?.confidence ? (data.confidence * 100).toFixed(1) : 0}%)</p>
                </div>
              </div>
              <div className="w-80 h-2.5 bg-slate-800 rounded-full mt-3 overflow-hidden border border-slate-700">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${riskBarColour(riskLevel)}`}
                  style={{ width: `${riskPct}%` }}
                />
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-500 mb-2">Risk Poll History (last {history.length})</p>
              <div className="flex items-end gap-1 h-12 justify-end">
                {history.map((h, i) => (
                  <div
                    key={i}
                    title={`${Math.round(h.risk * 100)}% at ${h.t.toLocaleTimeString()}`}
                    className={`w-2 rounded-t ${riskBarColour(h.level)} opacity-85`}
                    style={{ height: `${Math.max(4, Math.round(h.risk * 48))}px` }}
                  />
                ))}
              </div>
              {lastUpdated && (
                <p className="text-xs text-slate-500 mt-2 font-mono">
                  Updated {lastUpdated.toLocaleTimeString()}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── 2. Grafana Live Observability & Visibility Stream ── */}
        <GrafanaVisibilityPanel system={data?.system} liveMetrics={data?.live_metrics} />

        {/* ── 3. NetworkX Graph Visualizer & Feature Importances ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <NetworkXGraphVisualizer graphData={data?.networkx_graph} />
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <FeatureImportancesPanel importances={data?.feature_importances} />
          </div>
        </div>

        {/* ── 4. Z-Score Anomaly Analysis & Temporal Analysis ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <ZScoreAnalysisPanel zData={data?.z_score_analysis} />
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <TemporalAnalysisPanel temporalData={data?.temporal_analysis} />
          </div>
        </div>

        {/* ── 5. Root Cause Analysis & NetworkX Cascade Path ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2 mb-4">
              <ShieldAlert size={15} className="text-red-400" /> Root Cause Identification
            </h2>
            <RootCauseList causes={data?.root_cause} />
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2 mb-4">
              <GitBranch size={15} className="text-orange-400" /> NetworkX Computed Cascade Path
            </h2>
            {data?.cascade_path?.length > 0
              ? <CascadePath path={data.cascade_path} />
              : <p className="text-slate-500 text-xs italic">No cascade propagation path active</p>
            }
            <div className="mt-4 pt-3 border-t border-slate-800">
              <p className="text-[11px] text-slate-500">
                Cascade path is calculated using NetworkX Breadth-First Search (BFS) graph traversal from root cause nodes down the architectural call tree.
              </p>
            </div>
          </div>
        </div>

        {/* ── 6. Service Health & Risk/Impact Assessment ── */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
            <Activity size={15} className="text-purple-400" /> Risk &amp; Impact Matrix across Services
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {SERVICES.map(svc => {
              const m   = data?.live_metrics?.[svc]
              const err = m?.error_rate_5xx ?? 0
              const p99 = m?.p99_latency_s ?? 0
              const up  = m?.service_up ?? 1
              const impact = up === 0 ? 'CRITICAL' : err > 0.05 ? 'HIGH' : p99 > 1.5 ? 'MEDIUM' : 'LOW'
              return (
                <div key={svc} className={`rounded-lg border p-3 ${riskBg(impact)} transition-all`}>
                  <p className="text-xs font-semibold text-slate-300 mb-1">{SERVICE_LABELS[svc]}</p>
                  <p className={`font-bold text-sm ${riskColour(impact)}`}>{impact}</p>
                  <p className="text-[10px] font-mono text-slate-500 mt-1">
                    {up === 0 ? 'DOWN' : `err: ${err.toFixed(2)} | p99: ${p99.toFixed(2)}s`}
                  </p>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── 7. Recommendations ── */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2 mb-4">
            <Lightbulb size={15} className="text-yellow-400" /> Actionable Remediation Recommendations
          </h2>
          <RecommendationList recs={data?.recommendations} />
        </div>

      </main>

      <footer className="border-t border-slate-800 py-4 text-center text-xs text-slate-600">
        Cascade Failure Prediction &bull; Developer Dashboard &bull;
        Analysis API: <code className="text-indigo-400">http://localhost:5001</code> &bull;
        Grafana Observability: <code className="text-indigo-400">http://localhost:3001</code>
      </footer>
    </div>
  )
}
