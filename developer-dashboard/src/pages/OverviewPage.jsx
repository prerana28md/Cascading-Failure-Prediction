import React from 'react'
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts'
import { ExternalLink, Wifi, WifiOff } from 'lucide-react'
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

        {/* Cascade risk */}
        <div className={`rounded-lg border p-5 flex flex-col gap-3 ${riskBg(riskLevel)}`}>
          <p className="text-[11px] text-slate-400 uppercase tracking-wider font-medium">Cascade Risk</p>

          {loading ? (
            <div className="h-12 bg-slate-800/50 rounded animate-pulse" />
          ) : (
            <div className="flex items-end gap-3">
              <span className="text-5xl font-black font-mono leading-none" style={{ color: riskColor }}>
                {riskPct}%
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
              style={{ width: `${riskPct}%`, backgroundColor: riskColor }}
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
