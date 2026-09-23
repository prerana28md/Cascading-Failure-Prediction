import React from 'react'
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts'
import { ExternalLink, Wifi, WifiOff, AlertTriangle, CheckCircle, Wrench, ShieldAlert } from 'lucide-react'
import SystemStatus, { deriveSystemStatus } from '../components/SystemStatus'
import ServiceCard  from '../components/ServiceCard'
import IncidentFeed from '../components/IncidentFeed'
import FeatureImportance from '../components/FeatureImportance'
import { deriveServiceKeys } from '../lib/api'

/**
 * OverviewPage — first screen.
 *
 * Answers in 5–10 seconds:
 *   • Is the system healthy?
 *   • What is the cascade risk?
 *   • Which services are affected?
 *   • Are there active incidents?
 *
 * Every value comes from the live API. Nothing is fabricated.
 *
 * Props:
 *   data          object   — /metrics/live full response
 *   riskHistory   array    — [{ t, risk, level }] built in App.jsx from real polls
 *   metricHistory object   — { [svc]: number[] } rolling error_rate history
 *   loading       bool
 *   setPage       fn       — navigate to another page
 */
export default function OverviewPage({ data, riskHistory, metricHistory, loading, setPage }) {
  const systemStatus = deriveSystemStatus(data)
  const riskLevel    = data?.risk_level    ?? 'LOW'
  const cascadeRisk  = data?.cascade_risk  ?? 0
  const confidence   = data?.confidence    ?? null
  const riskPct      = Math.round(cascadeRisk * 100)
  const confPct      = confidence != null ? (confidence * 100).toFixed(1) : null
  const affectedPct  = data?.affected_percentage ?? riskPct
  const criticalityPct = data?.criticality_percentage ?? affectedPct
  const criticalityReasons = data?.criticality_reasons ?? []
  const recommendations = data?.recommendations ?? []

  const serviceKeys  = deriveServiceKeys(data?.live_metrics)
  const liveMetrics  = data?.live_metrics  ?? {}
  const incidents    = data?.incident_log  ?? []
  const obsStatus    = data?.observability_status ?? {}
  const importances  = data?.feature_importances  ?? []
  const numDown      = data?.system?.num_services_down ?? 0

  // Risk sparkline — use real poll history, no fakes
  const sparkData = riskHistory.map((h, i) => ({
    i,
    risk: Math.round((h.risk ?? 0) * 100),
    t: h.t instanceof Date ? h.t.toLocaleTimeString() : '',
  }))

  const riskColor = { LOW: '#34d399', MEDIUM: '#fbbf24', HIGH: '#f97316', CRITICAL: '#ef4444' }[riskLevel] ?? '#64748b'

  // Active incidents — latest entry per service, only if not RESOLVED.
  // The incident_log deque is newest-first (appendleft), so the first entry
  // per service is its current state.
  const latestPerService = {}
  incidents.forEach(e => {
    if (!latestPerService[e.service]) latestPerService[e.service] = e
  })
  const activeIncidents = Object.values(latestPerService)
    .filter(e => e.reason !== 'RESOLVED')
    .slice(0, 5)

  return (
    <div className="space-y-6">

      {/* ── Row 1: System status + Cascade risk + KPIs ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* System status */}
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-5 flex flex-col gap-3">
          <p className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">System Status</p>
          <div className="flex items-center gap-3">
            <SystemStatus status={systemStatus} loading={loading} />
          </div>
          <div className="grid grid-cols-2 gap-3 mt-1 text-xs">
            <KpiCell
              label="Services Up"
              value={loading ? '—' : `${serviceKeys.length - numDown} / ${serviceKeys.length}`}
              warn={numDown > 0}
            />
            <KpiCell
              label="Active Incidents"
              value={loading ? '—' : String(activeIncidents.length)}
              warn={activeIncidents.length > 0}
            />
            <KpiCell
              label="Affected"
              value={loading ? '—' : `${affectedPct}%`}
              warn={affectedPct > 0}
            />
            <KpiCell
              label="Mean Error Rate"
              value={loading ? '—' : fmtRate(data?.system?.mean_error_rate)}
              warn={(data?.system?.mean_error_rate ?? 0) > 0.01}
            />
            <KpiCell
              label="Max P99 Latency"
              value={loading ? '—' : fmtMs(data?.system?.max_p99_latency)}
              warn={(data?.system?.max_p99_latency ?? 0) > 1}
            />
          </div>
        </div>

        {/* Criticality */}
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
                {confPct && (
                  <p className="text-[11px] text-slate-400">Conf: {confPct}%</p>
                )}
              </div>
            </div>
          )}

          {/* Progress bar */}
          <div className="h-2 w-full bg-slate-800/60 rounded-full overflow-hidden border border-slate-700/50">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${Math.min(100, Math.max(0, criticalityPct))}%`, backgroundColor: riskColor }}
            />
          </div>

          {/* Sparkline */}
          {sparkData.length > 1 && (
            <div className="h-12 mt-1">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sparkData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={riskColor} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={riskColor} stopOpacity={0}    />
                    </linearGradient>
                  </defs>
                  <Tooltip
                    content={({ active, payload }) =>
                      active && payload?.length
                        ? <div className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[10px] text-slate-200">{payload[0].value}%</div>
                        : null
                    }
                  />
                  <Area type="monotone" dataKey="risk" stroke={riskColor} fill="url(#rg)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Feature importance */}
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <p className="text-[11px] text-slate-500 uppercase tracking-wider font-medium mb-3">Prediction Factors</p>
          <FeatureImportance importances={importances} maxItems={6} loading={loading} />
        </div>

      </div>

      {/* ── Explainability + recommendations ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Why This Score</h2>
            <span className="text-xs font-mono text-slate-300">{Math.round(criticalityPct)}%</span>
          </div>
          {criticalityReasons.length ? (
            <ul className="space-y-2">
              {criticalityReasons.slice(0, 6).map((reason, index) => (
                <li key={`${reason}-${index}`} className="flex items-start gap-2 text-xs text-slate-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 mt-1.5" />
                  {reason}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">Waiting for live criticality evidence.</p>
          )}
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900 p-5 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Remediation &amp; Root Cause Analysis</h2>
            {recommendations.length > 0 && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950/60 border border-indigo-800/50 text-indigo-300 font-semibold">
                {recommendations.length} Active {recommendations.length === 1 ? 'Action' : 'Actions'}
              </span>
            )}
          </div>

          {recommendations.length ? (
            <div className="space-y-4 max-h-[460px] overflow-y-auto pr-1.5">
              {recommendations.map((rec, index) => {
                const isP1 = rec.priority === 'P1'
                const isP2 = rec.priority === 'P2'
                const pColor = isP1
                  ? 'text-red-400 bg-red-950/50 border-red-800/60'
                  : isP2
                  ? 'text-amber-400 bg-amber-950/50 border-amber-800/60'
                  : 'text-emerald-400 bg-emerald-950/50 border-emerald-800/60'
                const borderAccent = isP1
                  ? 'border-red-500/80'
                  : isP2
                  ? 'border-amber-500/80'
                  : 'border-emerald-500/80'

                const measuresList = Array.isArray(rec.measures) && rec.measures.length > 0
                  ? rec.measures
                  : (rec.suggested_action ? [rec.suggested_action] : [rec.recommendation])

                return (
                  <div key={`${rec.service}-${index}`} className={`rounded-xl border border-slate-800/90 bg-slate-950/50 p-4 space-y-3 border-l-4 ${borderAccent}`}>
                    {/* Header badge row */}
                    <div className="flex items-center justify-between gap-2 flex-wrap pb-1 border-b border-slate-800/60">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${pColor}`}>
                          {rec.priority ?? 'P2'} PRIORITY
                        </span>
                        <span className="text-xs font-bold text-slate-200 uppercase tracking-wide">
                          {rec.service} Microservice
                        </span>
                      </div>
                      {rec.severity && (
                        <span className="text-[10px] font-mono text-slate-500 uppercase">
                          Severity: <strong className={isP1 ? 'text-red-400' : isP2 ? 'text-amber-400' : 'text-emerald-400'}>{rec.severity}</strong>
                        </span>
                      )}
                    </div>

                    <h3 className="text-sm font-bold text-white leading-snug">
                      {rec.title || rec.recommendation}
                    </h3>

                    {/* SECTION 1: WHAT IS HAPPENING / CAUSE OF THE FAULT */}
                    <div className="rounded-lg bg-slate-900/90 border border-amber-900/30 p-3 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-400 uppercase tracking-wider">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span>Section 1: What Is Happening / Cause of Fault</span>
                      </div>
                      
                      <div className="text-xs text-slate-200 leading-relaxed font-medium">
                        {rec.what_is_happening || rec.why}
                      </div>

                      {rec.cause && rec.cause !== rec.what_is_happening && (
                        <div className="text-[11px] text-slate-400 bg-amber-950/20 rounded p-2 border border-amber-900/30 mt-1.5 leading-relaxed">
                          <strong className="text-amber-300">Root Cause &amp; Cascade Trigger: </strong>
                          {rec.cause}
                        </div>
                      )}

                      {rec.evidence && (
                        <p className="text-[10px] text-slate-500 font-mono pt-0.5">
                          Telemetry Evidence: {rec.evidence}
                        </p>
                      )}
                    </div>

                    {/* SECTION 2: RECOMMENDED ACTION & MEASURES TO TAKE */}
                    <div className="rounded-lg bg-slate-900/90 border border-indigo-900/40 p-3 space-y-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-400 uppercase tracking-wider">
                        <Wrench className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                        <span>Section 2: Recommended Action &amp; Measures to Take</span>
                      </div>

                      <ul className="space-y-1.5 text-xs text-slate-300">
                        {measuresList.map((m, mIdx) => (
                          <li key={mIdx} className="flex items-start gap-2">
                            <span className="w-4 h-4 rounded-full bg-indigo-950 border border-indigo-700/60 text-indigo-400 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                              {mIdx + 1}
                            </span>
                            <span className="leading-relaxed">{m}</span>
                          </li>
                        ))}
                      </ul>

                      {rec.command && (
                        <div className="mt-2 pt-2 border-t border-slate-800/80">
                          <span className="text-[10px] text-slate-400 font-semibold block mb-1">
                            Primary Execution Command:
                          </span>
                          <div className="bg-slate-950 rounded border border-slate-800 p-2 text-[11px] font-mono text-indigo-300 overflow-x-auto select-all flex items-center justify-between gap-2 shadow-inner">
                            <code>{rec.command}</code>
                            <span className="text-[9px] text-slate-500 uppercase font-sans shrink-0 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                              Click to Select
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                  </div>
                )
              })}
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-slate-500 space-y-1">
              <p className="font-semibold text-slate-400">All systems operating normally</p>
              <p>No active remediation needed. Inject a fault via Fault Lab to test cascade response.</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Row 2: Service cards ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Services</h2>
          <button
            onClick={() => setPage('services')}
            className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            View all →
          </button>
        </div>

        {loading && !serviceKeys.length ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[1,2,3,4,5,6].map(n => (
              <div key={n} className="h-28 rounded-lg bg-slate-800/50 animate-pulse" />
            ))}
          </div>
        ) : serviceKeys.length === 0 ? (
          <p className="text-xs text-slate-500 italic">No service data available</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {serviceKeys.map(key => (
              <ServiceCard
                key={key}
                serviceKey={key}
                metrics={liveMetrics[key]}
                history={metricHistory[key] ?? []}
                compact
                onClick={() => setPage('services')}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Row 3: Active incidents + Observability ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Active incidents */}
        <div className="lg:col-span-2 rounded-lg border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Active Incidents
              {activeIncidents.length > 0 && (
                <span className="ml-2 text-[10px] font-bold text-red-400 bg-red-950/50 border border-red-800/50 px-1.5 py-0.5 rounded">
                  {activeIncidents.length}
                </span>
              )}
            </h2>
            <button
              onClick={() => setPage('incidents')}
              className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              View all →
            </button>
          </div>
          <IncidentFeed
            incidents={activeIncidents.length > 0 ? activeIncidents : incidents}
            loading={loading}
            maxItems={5}
            compact
          />
        </div>

        {/* Observability stack */}
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
                      : <WifiOff size={11} className="text-red-400 shrink-0" />
                    }
                    <span className="text-slate-300">{tool.label}</span>
                    {s?.latency_ms != null && (
                      <span className="text-slate-600 font-mono text-[10px]">{s.latency_ms}ms</span>
                    )}
                  </div>
                  <a
                    href={tool.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-indigo-400 transition-colors"
                  >
                    <ExternalLink size={10} />
                    Open
                  </a>
                </div>
              )
            })}
          </div>

          {!data && !loading && (
            <p className="text-[11px] text-slate-600 italic mt-3">Status unavailable — API offline</p>
          )}
        </div>
      </div>

    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const OBS_TOOLS = [
  { key: 'prometheus', label: 'Prometheus', url: 'http://localhost:9090' },
  { key: 'grafana',    label: 'Grafana',    url: 'http://localhost:3001' },
  { key: 'jaeger',     label: 'Jaeger',     url: 'http://localhost:16686' },
]

function KpiCell({ label, value, warn = false }) {
  return (
    <div>
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className={`text-sm font-mono font-semibold mt-0.5 ${warn ? 'text-amber-400' : 'text-slate-200'}`}>
        {value}
      </p>
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
