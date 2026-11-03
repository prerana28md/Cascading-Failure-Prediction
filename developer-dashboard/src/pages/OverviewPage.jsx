import React, { useMemo } from 'react'
import {
  AlertTriangle, CheckCircle, Bell, Wrench, ShieldAlert,
  ArrowRight, ShieldCheck, Activity, Terminal
} from 'lucide-react'
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts'
import SystemStatus from '../components/SystemStatus'
import ServiceCard, { toLabel } from '../components/ServiceCard'
import FeatureImportance from '../components/FeatureImportance'
import { getSeverityByPercentage } from '../lib/severity'

export default function OverviewPage({
  data,
  systemStatus,
  loading,
  setPage,
  metricHistory = {},
  riskHistory   = [],
}) {
  const serviceKeys     = data?.service_order ?? Object.keys(data?.live_metrics ?? {})
  const affectedCount   = data?.affected_services ?? 0
  const affectedPct     = data?.affected_service_percentage
    ?? (serviceKeys.length ? (affectedCount / serviceKeys.length) * 100 : 0)
  const criticalityPct  = Number(data?.criticality_percentage ?? affectedPct ?? 0)
  const recommendations = data?.recommendations     ?? []

  const liveMetrics = data?.live_metrics ?? {}
  const incidents   = data?.incident_log ?? []
  const importances = data?.feature_importances ?? []
  const numDown     = data?.system?.num_services_down ?? 0
  const servicesUp  = serviceKeys.filter(service => liveMetrics[service]?.service_up === 1).length
  const hasMetrics  = data?.system?.prometheus_connected !== false
  const incidentImpact = data?.incident_impact ?? null

  // Derive standardized 5-tier risk level (0-20 Low, 20-40 Moderate, 40-60 Medium, 60-80 High, 80-100 Critical)
  const riskLevel = useMemo(() => {
    if (!hasMetrics && numDown === 0) return 'UNKNOWN'
    if (data?.criticality_severity) {
      return String(data.criticality_severity).toUpperCase()
    }
    const pct = Number(criticalityPct)
    if (pct > 80) return 'CRITICAL'
    if (pct > 60) return 'HIGH'
    if (pct > 40) return 'MEDIUM'
    if (pct > 20) return 'MODERATE'
    return 'LOW'
  }, [data, hasMetrics, numDown, criticalityPct])

  const riskColor = {
    LOW:      '#10b981',
    MODERATE: '#eab308',
    MEDIUM:   '#f97316',
    HIGH:     '#ef4444',
    CRITICAL: '#dc2626',
    UNKNOWN:  '#94a3b8',
  }[riskLevel] ?? '#94a3b8'

  // Sparkline history data
  const sparkData = riskHistory.map((h, i) => ({
    i,
    risk: Math.round(h.risk ?? 0),
    t:   h.t instanceof Date ? h.t.toLocaleTimeString() : '',
  }))

  // Active incidents — latest per-service, non-RESOLVED
  const latestPerSvc = {}
  incidents.forEach(e => { if (!latestPerSvc[e.service]) latestPerSvc[e.service] = e })
  const activeIncidents = Object.values(latestPerSvc).filter(e => e.reason !== 'RESOLVED')

  const confPct = data?.confidence != null ? Math.round(data.confidence * 100) : null

  return (
    <div className="space-y-6">

      {/* ── Row 1: Status + Criticality + Prediction Factors ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* System status KPIs */}
        <div className="rounded-xl border border-slate-800 bg-[#0c1324] p-5 flex flex-col gap-3 shadow-xl">
          <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">System Status</p>
          <SystemStatus status={systemStatus} loading={loading} />
          <div className="grid grid-cols-2 gap-3 mt-1 text-xs">
            <KpiCell label="Services Up"      value={loading ? '—' : `${hasMetrics ? servicesUp : '—'} / ${serviceKeys.length}`} warn={numDown > 0} />
            <KpiCell label="Active Incidents" value={loading ? '—' : String(activeIncidents.length)} warn={activeIncidents.length > 0} />
            <KpiCell
              label="Services Affected"
              value={loading ? '—' : !hasMetrics ? 'No metrics' : `${Number(affectedPct).toFixed(1)}% (${affectedCount}/${serviceKeys.length})`}
              warn={affectedCount > 0}
            />
            <KpiCell
              label="Overall 5xx Error Rate"
              value={loading ? '—' : fmtPercent(data?.system?.error_rate_pct, hasMetrics)}
              warn={(data?.system?.error_rate_pct ?? 0) > 1}
            />
            <KpiCell label="Max P99 Latency"  value={loading ? '—' : fmtMs(data?.system?.max_p99_latency)} warn={(data?.system?.max_p99_latency ?? 0) > 1} />
          </div>
        </div>

        {/* System Criticality Gauge + Sparkline */}
        <div className={`rounded-xl border p-5 flex flex-col justify-between gap-3 transition-colors duration-300 ${riskBg(riskLevel)}`}>
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">
              System Criticality
            </p>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
              riskLevel === 'CRITICAL' ? 'bg-red-950/80 text-red-300 border-red-700/80 animate-pulse' :
              riskLevel === 'HIGH' ? 'bg-red-950/50 text-red-300 border-red-800/60' :
              riskLevel === 'MEDIUM' ? 'bg-orange-950/60 text-orange-300 border-orange-700/60' :
              riskLevel === 'MODERATE' ? 'bg-amber-950/60 text-amber-300 border-amber-700/60' :
              'bg-emerald-950/50 text-emerald-300 border-emerald-800/50'
            }`}>
              {riskLevel} RISK
            </span>
          </div>

          {loading ? (
            <div className="h-12 bg-slate-800/50 rounded animate-pulse" />
          ) : (
            <div className="flex items-baseline gap-3 my-1">
              <span className="text-5xl font-black font-mono tracking-tight leading-none" style={{ color: riskColor }}>
                {hasMetrics || numDown > 0 ? `${Number(criticalityPct).toFixed(1)}%` : 'No metrics'}
              </span>
              <div className="space-y-0.5">
                <p className="text-base font-bold uppercase tracking-wide" style={{ color: riskColor }}>
                  {riskLevel}
                </p>
                {confPct && (
                  <p className="text-[11px] text-slate-400 font-mono">Confidence: {confPct}%</p>
                )}
              </div>
            </div>
          )}

          <div className="h-2.5 w-full bg-slate-800/80 rounded-full overflow-hidden border border-slate-700/50">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${hasMetrics || numDown > 0 ? Math.min(100, Math.max(0, criticalityPct)) : 0}%`,
                backgroundColor: riskColor,
                boxShadow: `0 0 10px ${riskColor}80`,
              }}
            />
          </div>

          {sparkData.length > 1 && (
            <div className="h-12 mt-1">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sparkData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={riskColor} stopOpacity={0.4} />
                      <stop offset="95%" stopColor={riskColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Tooltip content={({ active, payload }) =>
                    active && payload?.length
                      ? <div className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[10px] text-slate-200">{payload[0].value}%</div>
                      : null
                  } />
                  <Area type="monotone" dataKey="risk" stroke={riskColor} fill="url(#rg)" strokeWidth={2} dot={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Prediction factors */}
        <div className="rounded-xl border border-slate-800 bg-[#0c1324] p-5 shadow-xl">
          <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-3">Prediction Factors</p>
          <FeatureImportance importances={importances} maxItems={6} loading={loading} />
        </div>

      </div>

      {/* ── Real-World Incident Impact & Consequences Panel ── */}
      {incidentImpact && incidentImpact.status === 'INCIDENT_ACTIVE' && (
        <section className="rounded-xl border border-red-800/50 bg-[#12080e] p-5 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1.5 h-full bg-red-600" />
          
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className="text-red-400" size={18} />
              <h2 className="text-sm font-bold text-red-200 tracking-wide uppercase">
                Active Incident Technical Impact &amp; Business Consequences
              </h2>
            </div>
            <span className="text-[11px] font-mono font-semibold px-2.5 py-0.5 rounded-full bg-red-950 border border-red-700 text-red-300">
              Root Cause: {toLabel(incidentImpact.root_cause_service)}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 text-xs">
            {/* Customer impact */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3 space-y-1">
              <span className="text-[10px] uppercase font-bold text-amber-400 tracking-wider">Customer Experience</span>
              <p className="text-slate-300 leading-relaxed font-sans">{incidentImpact.customer_consequences}</p>
            </div>

            {/* Business impact */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3 space-y-1">
              <span className="text-[10px] uppercase font-bold text-red-400 tracking-wider">Business Impact</span>
              <p className="text-slate-300 leading-relaxed font-sans">{incidentImpact.business_impact}</p>
            </div>

            {/* Technical impact */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3 space-y-1">
              <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider">Technical Architecture</span>
              <p className="text-slate-300 leading-relaxed font-sans">{incidentImpact.technical_impact}</p>
            </div>
          </div>

          {/* Breakdown pills: Directly Affected, Indirectly Affected, Healthy */}
          <div className="flex items-center gap-4 text-xs flex-wrap border-t border-slate-800/80 pt-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase font-semibold text-slate-500">Directly Affected:</span>
              {incidentImpact.directly_affected?.length ? (
                incidentImpact.directly_affected.map(s => (
                  <span key={s} className="px-2 py-0.5 rounded bg-red-950/70 border border-red-700/70 text-red-300 text-[11px] font-mono">
                    {toLabel(s).replace(' Service', '')}
                  </span>
                ))
              ) : (
                <span className="text-slate-500 italic text-[11px]">None</span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase font-semibold text-slate-500">Indirectly Affected:</span>
              {incidentImpact.indirectly_affected?.length ? (
                incidentImpact.indirectly_affected.map(s => (
                  <span key={s} className="px-2 py-0.5 rounded bg-orange-950/60 border border-orange-700/60 text-orange-300 text-[11px] font-mono">
                    {toLabel(s).replace(' Service', '')}
                  </span>
                ))
              ) : (
                <span className="text-slate-500 italic text-[11px]">None</span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase font-semibold text-slate-500">Healthy / Unaffected:</span>
              {incidentImpact.healthy_services?.length ? (
                incidentImpact.healthy_services.map(s => (
                  <span key={s} className="px-2 py-0.5 rounded bg-emerald-950/50 border border-emerald-800/50 text-emerald-300 text-[11px] font-mono">
                    {toLabel(s).replace(' Service', '')}
                  </span>
                ))
              ) : (
                <span className="text-slate-500 italic text-[11px]">None</span>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Row 2: Services Grid ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Services Operational Health</h2>
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

      {/* ── Row 3: Active Incidents + Recommendations ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Active Incidents panel */}
        <div className="rounded-xl border border-slate-800 bg-[#0c1324] p-5 flex flex-col shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Bell size={14} className={activeIncidents.length > 0 ? 'text-red-400' : 'text-slate-500'} />
              <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Active Incident Feed</h2>
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
                <p className="text-[11px] text-slate-500 mt-0.5">All services are operating normally within SLA</p>
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

        {/* Recommendations & Runbook panel */}
        <div className="rounded-xl border border-slate-800 bg-[#0c1324] p-5 flex flex-col shadow-xl">
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
                  ? 'bg-red-950 text-red-300 border-red-800'
                  : isP2
                  ? 'bg-amber-950 text-amber-300 border-amber-800'
                  : 'bg-emerald-950 text-emerald-300 border-emerald-800'

                return (
                  <div key={rec.id ?? i} className={`rounded-lg border bg-slate-900/60 p-3.5 space-y-2 text-xs ${accent}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${pBadge}`}>
                          {rec.priority ?? 'P3'}
                        </span>
                        <span className="font-semibold text-slate-200">{toLabel(rec.service)}</span>
                      </div>
                      {rec.category && (
                        <span className="text-[10px] text-slate-500 font-mono capitalize">{rec.category}</span>
                      )}
                    </div>

                    <p className="font-medium text-slate-200 leading-snug">{rec.title ?? rec.recommendation}</p>

                    {rec.measures && rec.measures.length > 0 && (
                      <ul className="space-y-1 mt-1 text-[11px] text-slate-400 font-mono list-disc list-inside">
                        {rec.measures.map((m, mIdx) => (
                          <li key={mIdx}>{m}</li>
                        ))}
                      </ul>
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

const REASON_STYLE = {
  SERVICE_DOWN:    { bg: 'bg-red-950/30 border-red-800/40', icon: 'text-red-400', badge: 'bg-red-950 text-red-300 border-red-800' },
  HIGH_ERROR_RATE: { bg: 'bg-orange-950/20 border-orange-800/30', icon: 'text-orange-400', badge: 'bg-orange-950 text-orange-300 border-orange-800' },
  HIGH_LATENCY:    { bg: 'bg-amber-950/20 border-amber-800/30', icon: 'text-amber-400', badge: 'bg-amber-950 text-amber-300 border-amber-800' },
}

function ActiveIncidentCard({ event }) {
  const cfg  = REASON_STYLE[event.reason] ?? { bg: 'bg-slate-800/40 border-slate-700', icon: 'text-slate-400', badge: 'bg-slate-800 text-slate-300 border-slate-700' }
  const svcLabel = (event.service ?? '').charAt(0).toUpperCase() + (event.service ?? '').slice(1) + ' Service'
  return (
    <div className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border text-xs ${cfg.bg}`}>
      <AlertTriangle size={13} className={`${cfg.icon} shrink-0 mt-0.5`} />
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

function KpiCell({ label, value, warn = false }) {
  return (
    <div>
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className={`text-sm font-mono font-semibold mt-0.5 ${warn ? 'text-amber-400' : 'text-slate-200'}`}>{value}</p>
    </div>
  )
}

function riskBg(level) {
  const norm = (level || '').toUpperCase()
  if (norm === 'CRITICAL') return 'border-red-900/70 bg-red-950/25 shadow-xl shadow-red-950/30'
  if (norm === 'HIGH') return 'border-red-900/60 bg-red-950/15 shadow-xl shadow-red-950/20'
  if (norm === 'MEDIUM') return 'border-orange-900/60 bg-orange-950/20 shadow-xl shadow-orange-950/20'
  if (norm === 'MODERATE') return 'border-amber-900/60 bg-amber-950/20 shadow-xl shadow-amber-950/20'
  if (norm === 'LOW' || norm === 'INFORMATIONAL') return 'border-emerald-900/50 bg-emerald-950/20 shadow-xl shadow-emerald-950/20'
  return 'border-slate-800 bg-slate-900'
}

function fmtPercent(v, metricsAvailable) {
  if (metricsAvailable === false) return 'No metrics'
  if (v == null) return 'No traffic'
  return `${(+v).toFixed(2)}%`
}

function fmtMs(v) {
  if (v == null) return '—'
  return `${(+v * 1000).toFixed(0)} ms`
}
