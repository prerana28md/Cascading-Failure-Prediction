import React from 'react'
import DependencyGraph from '../components/DependencyGraph'
import { toLabel } from '../components/ServiceCard'

/**
 * GraphPage — dependency graph + root cause + cascade path.
 *
 * Uses data.networkx_graph, data.root_cause, data.cascade_path, data.live_metrics.
 * No topology is hardcoded in this component.
 *
 * Props:
 *   data     object  — full /metrics/live response
 *   loading  bool
 */
export default function GraphPage({ data, loading }) {
  const graphData   = data?.networkx_graph ?? null
  const rootCauses  = data?.root_cause     ?? []
  const cascadePath = data?.cascade_path   ?? []
  const liveMetrics = data?.live_metrics   ?? {}

  return (
    <div className="space-y-5">

      {/* Page header */}
      <div>
        <h1 className="text-base font-semibold text-slate-100">Dependency Graph</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Live dependency topology. The highlighted path shows possible downstream reachability, not a failure probability.
        </p>
      </div>

      {/* Graph */}
      <DependencyGraph
        graphData={graphData}
        rootCauses={rootCauses}
        cascadePath={cascadePath}
        liveMetrics={liveMetrics}
        serviceImpactPct={data?.service_impact_pct ?? {}}
        affectedPercentage={data?.affected_percentage}
        affectedServices={data?.affected_services}
        affectedServicePercentage={data?.affected_service_percentage}
        loading={loading && !graphData}
      />

      {/* Root cause + cascade path detail below graph */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Root causes */}
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Root Cause Identification
          </h2>
          {rootCauses.length === 0 ? (
            <p className="text-xs text-slate-500 italic">No anomalies detected — system operating normally</p>
          ) : (
            <div className="space-y-2">
              {rootCauses.map((c, i) => (
                <div key={i} className="flex items-start gap-3 text-xs rounded-md bg-red-950/20 border border-red-900/40 px-3 py-2.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0 mt-1.5 animate-pulse" />
                  <div>
                    <p className="font-semibold text-red-300">{toLabel(c.service)}</p>
                    <p className="text-slate-400 mt-0.5">{c.reason?.replace(/_/g, ' ')}</p>
                    {c.metric && c.value != null && (
                      <p className="text-slate-500 font-mono text-[10px] mt-0.5">
                        {c.metric}: {c.value}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Cascade path */}
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">
            Potential Propagation Path
          </h2>
          {cascadePath.length === 0 ? (
            <p className="text-xs text-slate-500 italic">No root-cause path detected</p>
          ) : (
            <>
              {/* Horizontal flowchart — wraps onto multiple rows if needed */}
              <div className="flex flex-wrap items-center gap-y-3">
                {cascadePath.map((svc, i) => {
                  const isRoot   = i === 0
                  const impactPct = data?.service_impact_pct?.[svc]

                  return (
                    <React.Fragment key={svc}>
                      {/* Step node */}
                      <div className={`flex flex-col items-center gap-1 min-w-[80px]`}>
                        {/* Step number badge */}
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold
                          ${isRoot ? 'bg-red-700 text-red-100' : 'bg-amber-800 text-amber-100'}`}>
                          {i + 1}
                        </div>

                        {/* Service box */}
                        <div className={`px-3 py-2 rounded-lg border text-center min-w-[76px] ${
                          isRoot
                            ? 'bg-red-950/40 border-red-700/60 text-red-200'
                            : 'bg-amber-950/30 border-amber-700/40 text-amber-200'
                        }`}>
                          <p className="text-[11px] font-semibold leading-tight">
                            {toLabel(svc).replace(' Service', '')}
                          </p>
                          {isRoot && (
                            <p className="text-[9px] text-red-400 font-bold mt-0.5 uppercase tracking-wide">
                              Root
                            </p>
                          )}
                          {impactPct != null && (
                            <p className={`text-[9px] font-mono mt-0.5 ${
                              impactPct > 0 ? 'text-amber-400' : 'text-slate-500'
                            }`}>
                              {impactPct.toFixed(0)}% impact
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Arrow between steps */}
                      {i < cascadePath.length - 1 && (
                        <div className="flex items-center self-end pb-4 px-1">
                          <div className="flex items-center gap-0.5">
                            <div className="h-px w-5 bg-amber-700/60" />
                            <svg width="8" height="10" viewBox="0 0 8 10" fill="none">
                              <path d="M0 0 L8 5 L0 10 Z" fill="#92400e" />
                            </svg>
                          </div>
                        </div>
                      )}
                    </React.Fragment>
                  )
                })}
              </div>

              <p className="text-[10px] text-slate-600 mt-4 leading-relaxed">
                Topology-based reachability from detected root causes — not a confirmed failure probability.
                Observed impact values come from current service metrics.
              </p>
            </>
          )}
        </div>

      </div>
    </div>
  )
}
