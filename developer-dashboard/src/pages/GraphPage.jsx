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
          Live NetworkX graph — driven by backend data. Hover a node for details.
        </p>
      </div>

      {/* Graph */}
      <DependencyGraph
        graphData={graphData}
        rootCauses={rootCauses}
        cascadePath={cascadePath}
        liveMetrics={liveMetrics}
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
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Cascade Propagation Path
          </h2>
          {cascadePath.length === 0 ? (
            <p className="text-xs text-slate-500 italic">No active cascade path</p>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                {cascadePath.map((svc, i) => (
                  <div key={svc} className="flex items-center gap-2">
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium border flex-1 ${
                      i === 0
                        ? 'bg-red-950/30 border-red-800/50 text-red-300'
                        : 'bg-amber-950/20 border-amber-800/30 text-amber-300'
                    }`}>
                      <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                        style={{ background: i === 0 ? '#7f1d1d' : '#78350f' }}>
                        {i + 1}
                      </span>
                      {toLabel(svc)}
                      {i === 0 && (
                        <span className="ml-auto text-[10px] text-red-400 font-bold">ROOT</span>
                      )}
                    </div>
                    {i < cascadePath.length - 1 && (
                      <span className="text-slate-600 text-xs">↓</span>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-600 mt-3">
                Computed via NetworkX BFS from root-cause nodes through the architectural call tree.
              </p>
            </>
          )}
        </div>

      </div>
    </div>
  )
}
