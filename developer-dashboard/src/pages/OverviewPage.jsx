import React from 'react'
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts'
import {
  AlertTriangle, CheckCircle, Wrench,
  XCircle, Clock, Bell,
} from 'lucide-react'
import SystemStatus, { deriveSystemStatus } from '../components/SystemStatus'
import ServiceCard    from '../components/ServiceCard'
import IncidentFeed   from '../components/IncidentFeed'
import FeatureImportance from '../components/FeatureImportance'
import { deriveServiceKeys } from '../lib/api'

export default function OverviewPage({ data, riskHistory, metricHistory, loading, setPage }) {
  const systemStatus    = deriveSystemStatus(data)
  const riskLevel       = data?.risk_level          ?? 'LOW'
  const confidence      = data?.confidence          ?? null
  const confPct         = confidence != null ? (confidence * 100).toFixed(1) : null
  const affectedPct     = data?.affected_percentage ?? 0
  const criticalityPct  = data?.criticality_percentage ?? affectedPct
  const recommendations = data?.recommendations     ?? []

  const serviceKeys = deriveServiceKeys(data?.live_metrics)
  const liveMetrics = data?.live_metrics ?? {}
  const incidents   = data?.incident_log ?? []
  const importances = data?.feature_importances ?? []
  const numDown     = data?.system?.num_services_down ?? 0

  // sparkline: riskHistory[].risk is already 0-100 (stored as criticalityPct in App.jsx)
  const sparkData = riskHistory.map((h, i) => ({
    i,
    risk: Math.round(h.risk ?? 0),
    t:   h.t instanceof Date ? h.t.toLocaleTimeString() : '',
  }))
  const riskColor = { LOW: '#34d399', MEDIUM: '#fbbf24', HIGH: '#f97316', CRITICAL: '#ef4444' }[riskLevel] ?? '#64748b'

  // Active incidents — latest per-service, non-RESOLVED
  const latestPerSvc = {}
  incidents.forEach(e => { if (!latestPerSvc[e.service]) latestPerSvc[e.service] = e })
  const activeIncidents = Object.values(latestPerSvc).filter(e => e.reason !== 'RESOLVED')

  return (
    <div className="space-y-6">

      {/* ── Row 1: Status + Criticality + Prediction Factors ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* System status KPIs */}
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-5 flex flex-col gap-3">
          <p className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">System Status</p>
          <SystemStatus status={systemStatus} loading={loading} />
          <div className="grid grid-cols-2 gap-3 mt-1 text-xs">
            <KpiCell label="Services Up"      value={loading ? '—' : `${serviceKeys.length - numDown} / ${serviceKeys.length}`} warn={numDown > 0} />
            <KpiCell label="Active Incidents" value={loading ? '—' : String(activeIncidents.length)} warn={activeIncidents.length > 0} />
            <KpiCell label="Affected"         value={loading ? '—' : `${Math.round(criticalityPct)}%`}  warn={criticalityPct > 0} />
            <KpiCell label="Mean Error Rate"  value={loading ? '—' : fmtRate(data?.system?.mean_error_rate)}  warn={(data?.system?.mean_error_rate ?? 0) > 0.01} />
            <KpiCell label="Max P99 Latency"  value={loading ? '—' : fmtMs(data?.system?.max_p99_latency)}    warn={(data?.system?.max_p99_latency ?? 0) > 1} />
          </div>
        </div>

        {/* Criticality gauge + sparkline */}
        <div className={`rounded-lg border p-5 flex flex-col gap-3 ${riskBg(riskLevel)}`}>
          <p className="text-[11px] text-slate-400 uppercase tracking-wider font-medium">System Criticality</p>
          {loading ? (
            <div className="h-12 bg-slate-800/50 rounded animate-pulse" />
          ) : (
            <div className="flex items-end gap-3">
              <span className="text-5xl font-black font-mono leading-none" style={{ color: riskColor }}>
                {Math.round(criticalityPct)}%
              </span>
              <div className="mb-1 space-y-0.5">
                <p className="text-lg font-bold" style={{ color: riskColor }}>{riskLevel}</p>
                {confPct && <p className="text-[11px] text-slate-400">Conf: {confPct}%</p>}
              </div>
            </div>
          )}
          <div className="h-2 w-full bg-slate-800/60 rounded-full overflow-hidden border border-slate-700/50">
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${Math.min(100, Math.max(0, criticalityPct))}%`, backgroundColor: riskColor }} />
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

        {/* Prediction factors */}
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <p className="text-[11px] text-slate-500 uppercase tracking-wider font-medium mb-3">Prediction Factors</p>
          <FeatureImportance importances={importances} maxItems={6} loading={loading} />
        </div>

      </div>

      {/* ── Row 2: Services ── */}
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
              <ServiceCard key={key} serviceKey={key} metrics={liveMetrics[key]}
                history={metricHistory[key] ?? []} compact onClick={() => setPage('services')} />
            ))}
          </div>
        )}
      </section>

      {/* ── Row 3: Active Incidents (replaces Why-This-Score) + Recommendations ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Active Incidents panel */}
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Bell size={14} className={activeIncidents.length > 0 ? 'text-red-400' : 'text-slate-500'} />
              <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Active Incidents</h2>
              {activeIncidents.length > 0 && (
                <span className="ml-1 text-[10px] font-bold text-red-300 bg-red-950/60 border border-red-800/60 px-1.5 py-0.5 rounded-full">
                  {activeIncidents.length}
                </span>
              )}
            </div>
            <button onClick={() => setPage('incidents')}
              className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors">
              View all →
            </button>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[1,2,3].map(n => <div key={n} className="h-12 rounded-lg bg-slate-800/50 animate-pulse" />)}
            </div>
          ) : activeIncidents.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 py-10 gap-3 text-center">
              <div className="w-10 h-10 rounded-full bg-emerald-950/60 border border-emerald-800/40 flex items-center justify-center">
                <CheckCircle size={18} className="text-emerald-400" />
              </div>
              <div>
                <p className="text-xs font-semibold text-emerald-300">No Active Incidents</p>
                <p className="text-[11px] text-slate-500 mt-0.5">All services are operating normally</p>
              </div>
            </div>
          ) : (
            <div className="space-y-2 overflow-y-auto max-h-[320px]">
              {activeIncidents.map((event, i) => (
                <ActiveIncidentCard key={event.id ?? i} event={event} />
              ))}
            </div>
          )}
        </div>

        {/* Recommendations panel */}
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Wrench size={14} className="text-indigo-400" />
              <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Remediation &amp; Root Cause</h2>
            </div>
            {recommendations.length > 0 && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-950/60 border border-indigo-800/50 text-indigo-300 font-semibold">
                {recommendations.length} {recommendations.length === 1 ? 'action' : 'actions'}
              </span>
            )}
          </div>

          {recommendations.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 py-10 gap-3 text-center">
              <div className="w-10 h-10 rounded-full bg-emerald-950/60 border border-emerald-800/40 flex items-center justify-center">
                <CheckCircle size={18} className="text-emerald-400" />
              </div>
              <div>
                <p className="text-xs font-semibold text-emerald-300">All Systems Operational</p>
                <p className="text-[11px] text-slate-500 mt-0.5">No remediation required</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3 overflow-y-auto max-h-[320px] pr-0.5">
              {recommendations.map((rec, i) => {
                const isP1 = rec.priority === 'P1'
                const isP2 = rec.priority === 'P2'
                const accent = isP1 ? 'border-red-500/70' : isP2 ? 'border-amber-500/60' : 'border-emerald-500/50'
                const pBadge = isP1
                  ? 'text-red-300 bg-red-950/60 border-red-800'
                  : isP2
                  ? 'text-amber-300 bg-amber-950/60 border-amber-800'
                  : 'text-emerald-300 bg-emerald-950/60 border-emerald-800'
                const measures = Array.isArray(rec.measures) && rec.measures.length > 0
                  ? rec.measures
                  : [rec.suggestion || rec.recommendation].filter(Boolean)
                return (
                  <div key={i} className={`rounded-lg border border-slate-800 bg-slate-950/50 p-3.5 space-y-2.5 border-l-4 ${accent}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border font-mono ${pBadge}`}>
                        {rec.priority ?? 'P2'}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-200 uppercase">{rec.service}</span>
                    </div>
                    <p className="text-xs font-semibold text-white leading-snug">{rec.title || rec.recommendation}</p>
                    {(rec.what_is_happening || rec.why) && (
                      <div className="rounded bg-amber-950/20 border border-amber-900/30 px-2.5 py-2">
                        <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-1">Cause</p>
                        <p className="text-[11px] text-slate-300 leading-relaxed">{rec.what_is_happening || rec.why}</p>
                      </div>
                    )}
                    {measures.length > 0 && (
                      <div className="rounded bg-indigo-950/20 border border-indigo-900/30 px-2.5 py-2">
                        <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider mb-1.5">Fix</p>
                        <ul className="space-y-1">
                          {measures.slice(0, 3).map((m, mi) => (
                            <li key={mi} className="flex items-start gap-1.5 text-[11px] text-slate-300">
                              <span className="shrink-0 text-indigo-500 font-bold mt-0.5">{mi + 1}.</span>
                              <span>{m}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {rec.command && (
                      <code className="block text-[10px] font-mono text-green-400 bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 break-all select-all">
                        {rec.command}
                      </code>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

      </div>

    </div>
  )
}

// ── Active Incident Card ───────────────────────────────────────────────────────
const REASON_ICON = {
  SERVICE_DOWN:    XCircle,
  HIGH_ERROR_RATE: AlertTriangle,
  HIGH_LATENCY:    Clock,
}
const REASON_STYLE = {
  SERVICE_DOWN:    { bg: 'bg-red-950/30 border-red-800/40', icon: 'text-red-400', badge: 'bg-red-950 text-red-300 border-red-800' },
  HIGH_ERROR_RATE: { bg: 'bg-orange-950/20 border-orange-800/30', icon: 'text-orange-400', badge: 'bg-orange-950 text-orange-300 border-orange-800' },
  HIGH_LATENCY:    { bg: 'bg-amber-950/20 border-amber-800/30', icon: 'text-amber-400', badge: 'bg-amber-950 text-amber-300 border-amber-800' },
}

function ActiveIncidentCard({ event }) {
  const cfg  = REASON_STYLE[event.reason] ?? { bg: 'bg-slate-800/40 border-slate-700', icon: 'text-slate-400', badge: 'bg-slate-800 text-slate-300 border-slate-700' }
  const Icon = REASON_ICON[event.reason] ?? AlertTriangle
  const svcLabel = (event.service ?? '').charAt(0).toUpperCase() + (event.service ?? '').slice(1) + ' Service'
  return (
    <div className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border text-xs ${cfg.bg}`}>
      <Icon size={13} className={`${cfg.icon} shrink-0 mt-0.5`} />
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-slate-200">{svcLabel}</span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${cfg.badge}`}>
            {event.reason?.replace(/_/g, ' ')}
          </span>
          <span className="text-[10px] text-red-400 font-bold animate-pulse">● ACTIVE</span>
        </div>
        {event.metric && event.value != null && (
          <p className="font-mono text-slate-500 text-[10px]">{event.metric}: <span className="text-slate-300">{event.value}</span></p>
        )}
      </div>
      <span className="text-[10px] font-mono text-slate-600 shrink-0">{event.ts?.split(' ')[1] ?? ''}</span>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
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
