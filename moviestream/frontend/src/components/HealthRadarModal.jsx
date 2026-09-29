import React from 'react'
import {
  X, Activity, CheckCircle2, AlertTriangle, Clock,
  ServerCrash, RefreshCw, ExternalLink, Network, Zap
} from 'lucide-react'

export default function HealthRadarModal({
  isOpen,
  onClose,
  statuses,
  onRefresh,
  refreshing
}) {
  if (!isOpen) return null

  const healthyCount = statuses.filter(s => s.healthy).length
  const totalCount = statuses.length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-slate-950 rounded-2xl border border-slate-800 shadow-2xl p-6 sm:p-8 space-y-6">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-950/80 border border-indigo-700/60 text-cyan-400">
              <Activity className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span>MovieStream Microservice Health Radar</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                  healthyCount === totalCount
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                    : 'bg-amber-950 text-amber-300 border border-amber-800 animate-pulse'
                }`}>
                  {healthyCount}/{totalCount} Operational
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Live endpoint telemetry and architectural cascade inspection
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onRefresh}
              disabled={refreshing}
              className="p-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-400 hover:text-white transition-colors"
              title="Refresh radar"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-cyan-400' : ''}`} />
            </button>

            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Status Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {statuses.map(s => {
            const isSlow = s.latencyMs > 400
            return (
              <div
                key={s.key}
                className={`p-3.5 rounded-xl border transition-all ${
                  !s.healthy
                    ? 'bg-red-950/20 border-red-800/80 text-red-200'
                    : isSlow
                    ? 'bg-amber-950/20 border-amber-800/80 text-amber-200'
                    : 'bg-slate-900/60 border-slate-800/80 text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    {s.healthy ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    ) : (
                      <ServerCrash className="w-4 h-4 text-red-400 flex-shrink-0" />
                    )}
                    <span className="text-xs font-bold text-white">{s.name}</span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400">:{s.port}</span>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/60">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-slate-500" />
                    Latency: <strong className={isSlow ? 'text-amber-400 font-mono' : 'text-slate-200 font-mono'}>{s.latencyMs}ms</strong>
                  </span>
                  <span className={`font-semibold ${s.healthy ? 'text-emerald-400' : 'text-red-400'}`}>
                    {s.healthy ? 'HEALTHY' : 'DEGRADED / DOWN'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Architectural Dependency Cascade Callout */}
        <div className="p-4 rounded-xl bg-indigo-950/30 border border-indigo-800/60 space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-cyan-300">
            <Network className="w-4 h-4" />
            <span>MovieStream Cascade Dependency Topology</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            The <strong>Recommendation Service (:8093)</strong> depends synchronously on the 
            <strong> Catalog Service (:8087)</strong> and <strong>History Service (:8092)</strong>. 
            Injecting latency or failures in Catalog Service propagates downstream into Recommendation synthesis!
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <a
              href="http://localhost:4001"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5 transition-colors"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Inject Faults in Fault Lab (:4001)</span>
              <ExternalLink className="w-3 h-3" />
            </a>

            <a
              href="http://localhost:4000"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1.5 transition-colors"
            >
              <Activity className="w-3.5 h-3.5 text-purple-400" />
              <span>Inspect in Developer Dashboard (:4000)</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

      </div>
    </div>
  )
}
