import React, { useState } from 'react'
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts'
import {
  ExternalLink, Wifi, WifiOff,
  Lightbulb, ChevronDown, ChevronUp,
  Terminal, Copy, Check,
  ShieldAlert, AlertTriangle, AlertCircle, Info,
  Zap, Clock, Shield, CheckCircle,
} from 'lucide-react'
import SystemStatus, { deriveSystemStatus } from '../components/SystemStatus'
import ServiceCard  from '../components/ServiceCard'
import IncidentFeed from '../components/IncidentFeed'
import FeatureImportance from '../components/FeatureImportance'
import { deriveServiceKeys } from '../lib/api'

export default function OverviewPage({ data, riskHistory, metricHistory, loading, setPage }) {
  const systemStatus = deriveSystemStatus(data)
  const riskLevel    = data?.risk_level    ?? 'LOW'
  const cascadeRisk  = data?.cascade_risk  ?? 0
  const confidence   = data?.confidence    ?? null
  const riskPct      = Math.round(cascadeRisk * 100)
  const confPct      = confidence != null ? (confidence * 100).toFixed(1) : null

  const serviceKeys  = deriveServiceKeys(data?.live_metrics)
  const liveMetrics  = data?.live_metrics  ?? {}
  const incidents    = data?.incident_log  ?? []
  const obsStatus    = data?.observability_status ?? {}
  const importances  = data?.feature_importances  ?? []
  const numDown      = data?.system?.num_services_down ?? 0

  const sparkData = riskHistory.map((h, i) => ({
    i,
    risk: Math.round((h.risk ?? 0) * 100),
    t: h.t instanceof Date ? h.t.toLocaleTimeString() : '',
  }))

  const riskColor = { LOW: '#34d399', MEDIUM: '#fbbf24', HIGH: '#f97316', CRITICAL: '#ef4444' }[riskLevel] ?? '#64748b'

  const latestPerService = {}
  incidents.forEach(e => { if (!latestPerService[e.service]) latestPerService[e.service] = e })
  const activeIncidents = Object.values(latestPerService).filter(e => e.reason !== 'RESOLVED').slice(0, 5)

  return (
    <div className="space-y-6">

      {/* Row 1: System status + Cascade risk + KPIs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        <div className="rounded-lg border border-slate-800 bg-slate-900 p-5 flex flex-col gap-3">
          <p className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">System Status</p>
          <div className="flex items-center gap-3">
            <SystemStatus status={systemStatus} loading={loading} />
          </div>
          <div className="grid grid-cols-2 gap-3 mt-1 text-xs">
            <KpiCell label="Services Up"      value={loading ? '—' : `${serviceKeys.length - numDown} / ${serviceKeys.length}`} warn={numDown > 0} />
            <KpiCell label="Active Incidents" value={loading ? '—' : String(activeIncidents.length)} warn={activeIncidents.length > 0} />
            <KpiCell label="Mean Error Rate"  value={loading ? '—' : fmtRate(data?.system?.mean_error_rate)} warn={(data?.system?.mean_error_rate ?? 0) > 0.01} />
            <KpiCell label="Max P99 Latency"  value={loading ? '—' : fmtMs(data?.system?.max_p99_latency)}  warn={(data?.system?.max_p99_latency ?? 0) > 1} />
          </div>
        </div>

        <div className={`rounded-lg border p-5 flex flex-col gap-3 ${riskBg(riskLevel)}`}>
          <p className="text-[11px] text-slate-400 uppercase tracking-wider font-medium">Cascade Risk</p>
          {loading ? (
            <div className="h-12 bg-slate-800/50 rounded animate-pulse" />
          ) : (
            <div className="flex items-end gap-3">
              <span className="text-5xl font-black font-mono leading-none" style={{ color: riskColor }}>{riskPct}%</span>
              <div className="mb-1 space-y-0.5">
                <p className="text-lg font-bold" style={{ color: riskColor }}>{riskLevel}</p>
                {confPct && <p className="text-[11px] text-slate-400">Conf: {confPct}%</p>}
              </div>
            </div>
          )}
          <div className="h-2 w-full bg-slate-800/60 rounded-full overflow-hidden border border-slate-700/50">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${riskPct}%`, backgroundColor: riskColor }} />
          </div>
          {sparkData.length > 1 && (
            <div className="h-12 mt-1">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sparkData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={riskColor} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={riskColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Tooltip content={({ active, payload }) =>
                    active && payload?.length
                      ? <div className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[10px] text-slate-200">{payload[0].value}%</div>
                      : null
                  } />
                  <Area type="monotone" dataKey="risk" stroke={riskColor} fill="url(#rg)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <p className="text-[11px] text-slate-500 uppercase tracking-wider font-medium mb-3">Prediction Factors</p>
          <FeatureImportance importances={importances} maxItems={6} loading={loading} />
        </div>

      </div>

      {/* Row 2: Service cards */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Services</h2>
          <button onClick={() => setPage('services')} className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors">
            View all →
          </button>
        </div>
        {loading && !serviceKeys.length ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[1,2,3,4,5,6].map(n => <div key={n} className="h-28 rounded-lg bg-slate-800/50 animate-pulse" />)}
          </div>
        ) : serviceKeys.length === 0 ? (
          <p className="text-xs text-slate-500 italic">No service data available</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {serviceKeys.map(key => (
              <ServiceCard key={key} serviceKey={key} metrics={liveMetrics[key]} history={metricHistory[key] ?? []} compact onClick={() => setPage('services')} />
            ))}
          </div>
        )}
      </section>

      {/* Row 3: Active incidents + Observability */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-lg border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Active Incidents
              {activeIncidents.length > 0 && (
                <span className="ml-2 text-[10px] font-bold text-red-400 bg-red-950/50 border border-red-800/50 px-1.5 py-0.5 rounded">{activeIncidents.length}</span>
              )}
            </h2>
            <button onClick={() => setPage('incidents')} className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors">View all →</button>
          </div>
          <IncidentFeed incidents={activeIncidents.length > 0 ? activeIncidents : incidents} loading={loading} maxItems={5} compact />
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Observability</h2>
          <div className="space-y-2">
            {OBS_TOOLS.map(tool => {
              const s = obsStatus[tool.key]
              return (
                <div key={tool.key} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    {s?.connected
                      ? <Wifi size={11} className="text-emerald-400 shrink-0" />
                      : <WifiOff size={11} className="text-red-400 shrink-0" />}
                    <span className="text-slate-300">{tool.label}</span>
                    {s?.latency_ms != null && <span className="text-slate-600 font-mono text-[10px]">{s.latency_ms}ms</span>}
                  </div>
                  <a href={tool.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-indigo-400 transition-colors">
                    <ExternalLink size={10} /> Open
                  </a>
                </div>
              )
            })}
          </div>
          {!data && !loading && <p className="text-[11px] text-slate-600 italic mt-3">Status unavailable — API offline</p>}
        </div>
      </div>

      {/* Row 4: Recommendations */}
      <RecommendationsSection recs={data?.recommendations} loading={loading && !data} />

    </div>
  )
}

// ── Static helpers ────────────────────────────────────────────────────────────

const OBS_TOOLS = [
  { key: 'prometheus', label: 'Prometheus', url: 'http://localhost:9090' },
  { key: 'grafana',    label: 'Grafana',    url: 'http://localhost:3001' },
  { key: 'jaeger',     label: 'Jaeger',     url: 'http://localhost:16686' },
]

const SVC_COLOR = {
  order: '#6366f1', payment: '#22d3ee', inventory: '#f59e0b',
  shipping: '#34d399', delivery: '#f97316', notification: '#a78bfa', system: '#94a3b8',
}

// ── Severity config ───────────────────────────────────────────────────────────
const SEV_CFG = {
  CRITICAL: {
    bar: 'bg-red-500', border: 'border-red-500/40', glow: 'shadow-lg shadow-red-950',
    badge: 'bg-red-950 text-red-300 border-red-700', title: 'text-red-200',
    icon: () => <ShieldAlert size={15} className="text-red-400 shrink-0" />, pulse: true, label: 'CRITICAL',
  },
  HIGH: {
    bar: 'bg-orange-500', border: 'border-orange-500/30', glow: 'shadow-lg shadow-orange-950',
    badge: 'bg-orange-950 text-orange-300 border-orange-700', title: 'text-orange-100',
    icon: () => <AlertTriangle size={15} className="text-orange-400 shrink-0" />, pulse: false, label: 'HIGH',
  },
  MEDIUM: {
    bar: 'bg-amber-500', border: 'border-amber-500/25', glow: '',
    badge: 'bg-amber-950 text-amber-300 border-amber-700', title: 'text-amber-100',
    icon: () => <AlertCircle size={15} className="text-amber-400 shrink-0" />, pulse: false, label: 'MEDIUM',
  },
  LOW: {
    bar: 'bg-emerald-500', border: 'border-slate-700', glow: '',
    badge: 'bg-slate-800 text-slate-400 border-slate-600', title: 'text-slate-300',
    icon: () => <CheckCircle size={15} className="text-emerald-400 shrink-0" />, pulse: false, label: 'LOW',
  },
}

const CAT_CFG = {
  IMMEDIATE:  { label: 'Act Now',    color: 'text-red-400',   bg: 'bg-red-950/50 border-red-800/70',     icon: <Zap   size={9} className="text-red-400"   /> },
  SHORT_TERM: { label: 'Short-term', color: 'text-amber-400', bg: 'bg-amber-950/50 border-amber-800/70', icon: <Clock size={9} className="text-amber-400" /> },
  PREVENTIVE: { label: 'Preventive', color: 'text-blue-400',  bg: 'bg-blue-950/50 border-blue-800/70',   icon: <Shield size={9} className="text-blue-400"  /> },
}

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(text).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      className={`flex items-center gap-1 rounded px-2 py-0.5 border transition-all text-[10px] font-mono shrink-0 ${
        copied
          ? 'border-emerald-700 bg-emerald-950/50 text-emerald-400'
          : 'border-slate-700 text-slate-500 hover:text-slate-200 hover:bg-slate-700 hover:border-slate-600'
      }`}
    >
      {copied ? <><Check size={10} /> Copied!</> : <><Copy size={10} /> Copy</>}
    </button>
  )
}

// ── Step / bullet list renderer ───────────────────────────────────────────────
function StepList({ text }) {
  if (!text) return null
  return (
    <div className="space-y-2">
      {text.split('\n').filter(l => l.trim()).map((line, i) => {
        const isNum  = /^\d+[.)]\s/.test(line.trim())
        const isBull = /^[•·\-\*]\s/.test(line.trim())
        const clean  = line.replace(/^\d+[.)]\s*|^[•·\-\*]\s*/, '').trim()

        if (isNum) {
          const num = line.match(/^(\d+)/)?.[1]
          return (
            <div key={i} className="flex items-start gap-3">
              <span className="shrink-0 w-5 h-5 rounded-full border border-slate-600 bg-slate-700/80 text-[10px] font-bold text-slate-300 flex items-center justify-center mt-0.5 font-mono">
                {num}
              </span>
              <span className="text-xs text-slate-300 leading-relaxed flex-1">{clean}</span>
            </div>
          )
        }
        if (isBull) {
          return (
            <div key={i} className="flex items-start gap-2.5">
              <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-slate-500 mt-1.5" />
              <span className="text-xs text-slate-300 leading-relaxed">{clean}</span>
            </div>
          )
        }
        return <p key={i} className="text-xs text-slate-300 leading-relaxed">{line}</p>
      })}
    </div>
  )
}

// ── Summary severity pills ────────────────────────────────────────────────────
function SummaryPills({ recs }) {
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0 }
  recs.forEach(r => { if (counts[r.severity] != null) counts[r.severity]++ })
  const pills = [
    { key: 'CRITICAL', text: 'text-red-300',    bg: 'bg-red-950/80 border-red-700'    },
    { key: 'HIGH',     text: 'text-orange-300', bg: 'bg-orange-950/80 border-orange-700' },
    { key: 'MEDIUM',   text: 'text-amber-300',  bg: 'bg-amber-950/80 border-amber-700'  },
  ].filter(p => counts[p.key] > 0)

  if (!pills.length) return null
  return (
    <div className="flex items-center gap-1.5">
      {pills.map(p => (
        <span key={p.key} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${p.text} ${p.bg}`}>
          {counts[p.key]} {p.key}
        </span>
      ))}
    </div>
  )
}

// ── Healthy state ─────────────────────────────────────────────────────────────
function HealthyState() {
  return (
    <div className="flex flex-col items-center justify-center py-10 space-y-3">
      <div className="relative">
        <div className="w-14 h-14 rounded-full bg-emerald-950/60 border-2 border-emerald-800/50 flex items-center justify-center">
          <CheckCircle size={26} className="text-emerald-400" />
        </div>
        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-[#060d1a] animate-pulse" />
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-emerald-300">All Systems Healthy</p>
        <p className="text-xs text-slate-500 mt-1">No failures detected — all services operating normally</p>
      </div>
    </div>
  )
}

// ── Single recommendation card ────────────────────────────────────────────────
function RecCard({ rec, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen)
  const cfg      = SEV_CFG[rec.severity] ?? SEV_CFG.LOW
  const cat      = CAT_CFG[rec.category] ?? CAT_CFG.IMMEDIATE
  const svcColor = SVC_COLOR[rec.service] ?? SVC_COLOR.system

  // Parse "Root cause: ...\n\nFix: ..." pattern
  const desc       = rec.description ?? ''
  const causeMatch = desc.match(/^(.+?)(?:\n\nFix:)([\s\S]*)$/si)
  const causePart  = causeMatch
    ? causeMatch[1].replace(/^Root cause:\s*/i, '').trim()
    : desc.trim()
  const fixPart    = causeMatch ? causeMatch[2].trim() : null

  return (
    <div className={`relative rounded-xl border overflow-hidden transition-all duration-200 ${cfg.border} ${open ? cfg.glow : ''}`}>

      {/* Severity accent bar on left edge */}
      <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${cfg.bar} ${cfg.pulse ? 'animate-pulse' : ''}`} />

      {/* ── Collapsed header ── */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-start gap-3 pl-5 pr-4 py-4 text-left bg-slate-900/90 hover:bg-slate-800/70 transition-colors"
      >
        {/* Severity icon */}
        <div className="mt-0.5 shrink-0">{cfg.icon()}</div>

        {/* Title + tags */}
        <div className="flex-1 min-w-0 space-y-2">
          <p className={`text-sm font-semibold leading-snug ${cfg.title}`}>{rec.title}</p>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Service tag — service-coloured */}
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ color: svcColor, background: `${svcColor}18`, border: `1px solid ${svcColor}40` }}>
              {rec.service === 'system' ? '⚙ System' : `● ${rec.service.charAt(0).toUpperCase() + rec.service.slice(1)}`}
            </span>
            {/* Category pill */}
            <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${cat.bg}`}>
              {cat.icon}<span className={cat.color}>{cat.label}</span>
            </span>
            {/* Severity badge */}
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.badge}`}>{cfg.label}</span>
          </div>
        </div>

        {/* Expand chevron */}
        <div className={`shrink-0 mt-1 text-slate-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
          <ChevronDown size={14} />
        </div>
      </button>

      {/* ── Expanded content ── */}
      {open && (
        <div className="pl-5 pr-4 pb-5 pt-2 space-y-3 bg-slate-900/50 border-t border-slate-800/50">

          {/* Root Cause block */}
          <div className="rounded-lg overflow-hidden border border-amber-900/30">
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-950/30 border-b border-amber-900/30">
              <AlertTriangle size={11} className="text-amber-400 shrink-0" />
              <p className="text-[10px] font-bold text-amber-300 uppercase tracking-widest">Root Cause</p>
            </div>
            <div className="px-3 py-3 bg-slate-900/60">
              <StepList text={causePart} />
            </div>
          </div>

          {/* Solution block */}
          {fixPart && (
            <div className="rounded-lg overflow-hidden border border-emerald-900/30">
              <div className="flex items-center gap-2 px-3 py-2 bg-emerald-950/30 border-b border-emerald-900/30">
                <Lightbulb size={11} className="text-emerald-400 shrink-0" />
                <p className="text-[10px] font-bold text-emerald-300 uppercase tracking-widest">Solution</p>
              </div>
              <div className="px-3 py-3 bg-slate-900/60">
                <StepList text={fixPart} />
              </div>
            </div>
          )}

          {/* Terminal command */}
          {rec.command && (
            <div className="rounded-lg overflow-hidden border border-slate-700/50">
              <div className="flex items-center justify-between px-3 py-2 bg-slate-800/80 border-b border-slate-700/50">
                <div className="flex items-center gap-2">
                  <Terminal size={11} className="text-indigo-400" />
                  <span className="text-[10px] text-slate-400 font-mono">Run in terminal</span>
                </div>
                <CopyBtn text={rec.command} />
              </div>
              <div className="px-3 py-2.5 bg-slate-950">
                <code className="text-[11px] text-green-400 font-mono leading-relaxed whitespace-pre-wrap break-all">
                  {rec.command}
                </code>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  )
}

// ── Recommendations section ───────────────────────────────────────────────────
function RecommendationsSection({ recs, loading }) {
  const [expandAll, setExpandAll] = useState(false)
  const [sevFilter, setSevFilter] = useState('ALL')

  const all      = recs ?? []
  const filtered = sevFilter === 'ALL' ? all : all.filter(r => r.severity === sevFilter)
  const hasCrit  = all.some(r => r.severity === 'CRITICAL')
  const hasHigh  = all.some(r => r.severity === 'HIGH')

  // Only show filter pills when multiple severity levels are present
  const presentSevs = ['CRITICAL','HIGH','MEDIUM','LOW'].filter(s => all.some(r => r.severity === s))

  return (
    <div className="rounded-xl border border-slate-800 overflow-hidden bg-[#060d1a]">

      {/* ── Header ── */}
      <div className={`px-5 py-4 border-b border-slate-800/80 ${hasCrit ? 'bg-red-950/15' : hasHigh ? 'bg-orange-950/10' : 'bg-slate-900/60'}`}>
        <div className="flex items-center justify-between gap-4 flex-wrap">

          {/* Left: title + counts */}
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
              hasCrit ? 'bg-red-950 border border-red-800' : 'bg-amber-950/60 border border-amber-800/50'
            }`}>
              <Lightbulb size={14} className={hasCrit ? 'text-red-400' : 'text-amber-400'} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-100">Recommendations</h2>
                {!loading && all.length > 0 && <SummaryPills recs={all} />}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {loading
                  ? 'Analysing system state…'
                  : all.length === 0
                    ? 'No issues found'
                    : `${all.length} action${all.length !== 1 ? 's' : ''} identified · click any card to expand`}
              </p>
            </div>
          </div>

          {/* Right: controls */}
          {all.length > 1 && (
            <button
              onClick={() => setExpandAll(v => !v)}
              className="text-[11px] px-3 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
            >
              {expandAll ? 'Collapse all' : 'Expand all'}
            </button>
          )}
        </div>

        {/* Severity filter pills — only when ≥ 2 different severities exist */}
        {!loading && presentSevs.length >= 2 && (
          <div className="flex items-center gap-1.5 mt-3 flex-wrap">
            <button
              onClick={() => setSevFilter('ALL')}
              className={`text-[10px] font-bold px-3 py-1 rounded-full border transition-all ${
                sevFilter === 'ALL'
                  ? 'bg-indigo-900/70 border-indigo-600 text-indigo-200'
                  : 'border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300'
              }`}
            >
              All ({all.length})
            </button>
            {presentSevs.map(s => {
              const cfg = SEV_CFG[s]
              const cnt = all.filter(r => r.severity === s).length
              return (
                <button
                  key={s}
                  onClick={() => setSevFilter(s)}
                  className={`text-[10px] font-bold px-3 py-1 rounded-full border transition-all ${
                    sevFilter === s
                      ? `${cfg.badge}`
                      : 'border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300'
                  }`}
                >
                  {s} ({cnt})
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div className="p-4 space-y-2.5">

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-2.5">
            {[1, 2].map(n => (
              <div key={n} className="h-16 rounded-xl bg-slate-800/50 border border-slate-800 animate-pulse" />
            ))}
          </div>
        )}

        {/* Healthy */}
        {!loading && all.length === 0 && <HealthyState />}

        {/* Filter empty */}
        {!loading && all.length > 0 && filtered.length === 0 && (
          <div className="flex items-center justify-center py-6 text-xs text-slate-500">
            No {sevFilter} recommendations —
            <button onClick={() => setSevFilter('ALL')} className="ml-1 text-indigo-400 hover:text-indigo-300 underline">show all</button>
          </div>
        )}

        {/* Cards */}
        {!loading && filtered.length > 0 && filtered.map((rec, i) => (
          <RecCard
            key={i}
            rec={rec}
            defaultOpen={expandAll || (i === 0 && (rec.severity === 'CRITICAL' || rec.severity === 'HIGH'))}
          />
        ))}

      </div>
    </div>
  )
}

// ── Utility components ────────────────────────────────────────────────────────

function KpiCell({ label, value, warn = false }) {
  return (
    <div>
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className={`text-sm font-mono font-semibold mt-0.5 ${warn ? 'text-amber-400' : 'text-slate-200'}`}>{value}</p>
    </div>
  )
}

function riskBg(level) {
  return {
    LOW:      'border-emerald-900/50 bg-emerald-950/20',
    MEDIUM:   'border-amber-900/50   bg-amber-950/20',
    HIGH:     'border-orange-900/50  bg-orange-950/20',
    CRITICAL: 'border-red-900/50     bg-red-950/20',
  }[level] ?? 'border-slate-800 bg-slate-900'
}

function fmtRate(v) {
  if (v == null) return '—'
  return `${(+v).toFixed(4)}/s`
}

function fmtMs(v) {
  if (v == null) return '—'
  return `${(+v * 1000).toFixed(0)} ms`
}
