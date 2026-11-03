import React from 'react'
import DependencyGraph from '../components/DependencyGraph'
import { toLabel } from '../components/ServiceCard'
import { ShieldAlert, GitCommit, Layers, Clock, RefreshCw, Cpu } from 'lucide-react'

export default function GraphPage({ data, loading }) {
  const graphData    = data?.networkx_graph ?? null
  const rootCauses   = data?.root_cause     ?? []
  const cascadePath  = data?.cascade_path   ?? []
  const liveMetrics  = data?.live_metrics   ?? {}
  const serviceDetails = data?.service_details ?? {}
  const depMetadata  = data?.dependency_metadata ?? []

  return (
    <div className="space-y-6">
      {/* Dependency Graph Canvas */}
      <DependencyGraph
        graphData={graphData}
        rootCauses={rootCauses}
        cascadePath={cascadePath}
        liveMetrics={liveMetrics}
        serviceImpactPct={data?.service_impact_pct ?? {}}
        loading={loading && !graphData}
      />

      {/* Root cause + cascade path detail below graph */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Root causes */}
        <div className="rounded-xl border border-slate-800 bg-[#0c1324] p-5 shadow-xl">
          <div className="flex items-center gap-2 mb-3">
            <ShieldAlert size={16} className="text-red-400" />
            <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Root Cause Diagnostics
            </h2>
          </div>
          {rootCauses.length === 0 ? (
            <p className="text-xs text-slate-500 italic">No active anomalies detected — system operating nominally</p>
          ) : (
            <div className="space-y-2.5">
              {rootCauses.map((c, i) => {
                const detail = serviceDetails[c.service] ?? {}
                return (
                  <div key={i} className="flex flex-col gap-1 text-xs rounded-lg bg-red-950/25 border border-red-800/40 p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                        <span className="font-bold text-red-200">{toLabel(c.service)}</span>
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-red-900/60 text-red-300 font-semibold uppercase">
                        {c.reason?.replace(/_/g, ' ')}
                      </span>
                    </div>
                    {detail.reason && (
                      <p className="text-slate-300 text-[11px] mt-1">{detail.reason}</p>
                    )}
                    {c.metric && c.value != null && (
                      <p className="text-slate-400 font-mono text-[10px] mt-0.5">
                        Observed {c.metric}: <span className="text-red-300 font-semibold">{c.value}</span>
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Cascade path */}
        <div className="rounded-xl border border-slate-800 bg-[#0c1324] p-5 shadow-xl">
          <div className="flex items-center gap-2 mb-3">
            <GitCommit size={16} className="text-amber-400" />
            <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Cascading Propagation Sequence
            </h2>
          </div>
          {cascadePath.length === 0 ? (
            <p className="text-xs text-slate-500 italic">No cascading failure path active</p>
          ) : (
            <>
              {/* Step pills */}
              <div className="flex flex-wrap items-center gap-y-3">
                {cascadePath.map((svc, i) => {
                  const isRoot = i === 0
                  const rawImpact = data?.service_impact_pct?.[svc] ?? 0
                  const detail = serviceDetails[svc] ?? {}

                  return (
                    <React.Fragment key={svc}>
                      <div className="flex flex-col items-center gap-1 min-w-[85px]">
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                          isRoot ? 'bg-red-600 text-white' : 'bg-orange-600 text-white'
                        }`}>
                          {i + 1}
                        </div>

                        <div className={`px-2.5 py-1.5 rounded-lg border text-center min-w-[80px] ${
                          isRoot
                            ? 'bg-red-950/60 border-red-700/80 text-red-200'
                            : 'bg-orange-950/50 border-orange-700/60 text-orange-200'
                        }`}>
                          <p className="text-[11px] font-semibold leading-tight">
                            {toLabel(svc).replace(' Service', '')}
                          </p>
                          <p className={`text-[9.5px] font-mono mt-0.5 font-bold ${isRoot ? 'text-red-300' : 'text-orange-300'}`}>
                            {Number(rawImpact).toFixed(2)}%
                          </p>
                          <span className="text-[8px] uppercase tracking-wider font-semibold text-slate-400 block mt-0.5">
                            {detail.impact_type ?? (isRoot ? 'ROOT_CAUSE' : 'DIRECT')}
                          </span>
                        </div>
                      </div>

                      {i < cascadePath.length - 1 && (
                        <div className="flex items-center self-center px-1 text-slate-500 font-bold text-xs">
                          →
                        </div>
                      )}
                    </React.Fragment>
                  )
                })}
              </div>

              <p className="text-[10px] text-slate-500 mt-4 leading-relaxed font-mono">
                Propagation computed via live dependency contracts: timeout breaches, thread pool exhaustion, and circuit breaker trip states.
              </p>
            </>
          )}
        </div>

      </div>

      {/* Dependency Architectural Metadata Contract */}
      {depMetadata.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-[#0c1324] p-5 shadow-xl">
          <div className="flex items-center gap-2 mb-4">
            <Layers size={16} className="text-indigo-400" />
            <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Architecture Dependency Matrix &amp; Resilience Configuration
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] uppercase font-mono text-slate-400 bg-slate-900/50">
                  <th className="py-2.5 px-3">Caller (Source)</th>
                  <th className="py-2.5 px-3">Dependency (Target)</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Criticality</th>
                  <th className="py-2.5 px-3">Timeout</th>
                  <th className="py-2.5 px-3">Retries</th>
                  <th className="py-2.5 px-3">Circuit Breaker</th>
                  <th className="py-2.5 px-3">Fallback Strategy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                {depMetadata.map((edge, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-2 px-3 font-semibold text-slate-200">{toLabel(edge.source)}</td>
                    <td className="py-2 px-3 font-semibold text-indigo-300">{toLabel(edge.target)}</td>
                    <td className="py-2 px-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-sans capitalize ${
                        edge.type === 'synchronous'
                          ? 'bg-blue-950/70 border border-blue-800 text-blue-300'
                          : edge.type === 'conditional'
                          ? 'bg-purple-950/70 border border-purple-800 text-purple-300'
                          : 'bg-emerald-950/70 border border-emerald-800 text-emerald-300'
                      }`}>
                        {edge.type}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-300">{edge.criticality}</td>
                    <td className="py-2 px-3 text-slate-400">{edge.timeout_ms ? `${edge.timeout_ms}ms` : '—'}</td>
                    <td className="py-2 px-3 text-slate-400">{edge.retries ?? '—'}</td>
                    <td className="py-2 px-3 text-emerald-400">{edge.circuit_breaker ?? 'Enabled'}</td>
                    <td className="py-2 px-3 text-slate-400 font-sans text-[10.5px] max-w-xs truncate" title={edge.fallback}>
                      {edge.fallback || edge.description || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
