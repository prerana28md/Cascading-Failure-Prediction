import React, { useState, useCallback, useMemo } from 'react'
import { toLabel } from './ServiceCard'
import { SERVICE_STATUS_CFG, deriveServiceStatus } from './SystemStatus'

/**
 * DependencyGraph — generic SVG graph driven entirely by backend data.
 *
 * The graph layout is auto-computed from the node list returned by the API.
 * No service names, no positions, no edges are hardcoded here.
 *
 * Props:
 *   graphData    object   data.networkx_graph from /metrics/live
 *                         { nodes: [...], edges: [...], node_count, edge_count }
 *   rootCauses   array    data.root_cause — [{ service, reason, ... }]
 *   cascadePath  array    data.cascade_path — ['order','payment',...]
 *   liveMetrics  object   data.live_metrics — for deriving node health colour
 *   loading      bool
 */
export default function DependencyGraph({
  graphData,
  rootCauses  = [],
  cascadePath = [],
  liveMetrics = {},
  loading     = false,
}) {
  const [hoveredNode, setHoveredNode] = useState(null)

  // ── Compute node positions from graph data ──────────────────────────────
  // Uses a simple circular layout as fallback when no positions are in the data.
  // This means any number of services renders correctly.
  const { nodes, edges, positions } = useMemo(() => {
    if (!graphData?.nodes?.length) return { nodes: [], edges: [], positions: {} }

    const ns = graphData.nodes
    const es = graphData.edges ?? []

    // Circular layout — evenly spaced, centred in the 480×370 viewport
    // Radius is generous so the propagation % badges below each node don't overlap
    const cx = 240, cy = 178, rx = 168, ry = 138
    const pos = {}
    ns.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / ns.length - Math.PI / 2
      pos[n.id] = {
        x: Math.round(cx + rx * Math.cos(angle)),
        y: Math.round(cy + ry * Math.sin(angle)),
      }
    })

    return { nodes: ns, edges: es, positions: pos }
  }, [graphData])

  const rootSet    = useMemo(() => new Set((rootCauses || []).map(c => c.service)), [rootCauses])
  const cascadeSet = useMemo(() => new Set(cascadePath || []), [cascadePath])

  const nodeColour = useCallback((node) => {
    if (rootSet.has(node.id))    return { fill: '#dc2626', stroke: '#991b1b', label: '#fca5a5' }
    if (node.status === 'DOWN')  return { fill: '#dc2626', stroke: '#991b1b', label: '#fca5a5' }
    if (cascadeSet.has(node.id)) return { fill: '#d97706', stroke: '#92400e', label: '#fde68a' }
    const svcMetrics = liveMetrics[node.id]
    const status = deriveServiceStatus(svcMetrics)
    if (status === 'DEGRADED' || status === 'WARNING') return { fill: '#d97706', stroke: '#92400e', label: '#fde68a' }
    return { fill: '#3b82f6', stroke: '#1d4ed8', label: '#bfdbfe' }
  }, [rootSet, cascadeSet, liveMetrics])

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900 flex items-center justify-center h-80">
        <p className="text-xs text-slate-500 animate-pulse">Loading graph…</p>
      </div>
    )
  }

  if (!nodes.length) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900 flex items-center justify-center h-80">
        <p className="text-xs text-slate-500 italic">No graph data available</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 overflow-hidden">
      {/* Legend */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800">
        <p className="text-xs font-medium text-slate-300">
          Dependency Graph
          <span className="ml-2 text-[11px] text-slate-500 font-normal font-mono">
            {graphData?.node_count ?? nodes.length}n · {graphData?.edge_count ?? edges.length}e
          </span>
        </p>
        <div className="flex items-center gap-4 text-[11px] text-slate-500">
          <LegendItem color="#dc2626" label="Root Cause" />
          <LegendItem color="#d97706" label="Cascade Path" />
          <LegendItem color="#3b82f6" label="Healthy"    />
          <span className="text-slate-700">|</span>
          <LegendItem color="#ef4444" label="≥70% propagated" bar />
          <LegendItem color="#f59e0b" label="30–69%"          bar />
          <LegendItem color="#6366f1" label="1–29%"           bar />
        </div>
      </div>

      {/* SVG */}
      <div className="w-full overflow-x-auto">
        <svg
          width="100%"
          viewBox="0 0 480 370"
          className="max-h-[420px]"
          style={{ minWidth: 320 }}
        >
          <defs>
            <marker id="dg-arrow" viewBox="0 0 10 10" refX="22" refY="5"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569" />
            </marker>
            <marker id="dg-arrow-cascade" viewBox="0 0 10 10" refX="22" refY="5"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#d97706" />
            </marker>
            <marker id="dg-arrow-root" viewBox="0 0 10 10" refX="22" refY="5"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#dc2626" />
            </marker>
          </defs>

          {/* Edges */}
          {edges.map((edge, idx) => {
            const p1 = positions[edge.source]
            const p2 = positions[edge.target]
            if (!p1 || !p2) return null

            const isCascade = cascadeSet.has(edge.source) && cascadeSet.has(edge.target)
            const isRoot    = rootSet.has(edge.source)
            const stroke    = isRoot ? '#dc2626' : isCascade ? '#d97706' : '#334155'
            const marker    = isRoot ? 'url(#dg-arrow-root)' : isCascade ? 'url(#dg-arrow-cascade)' : 'url(#dg-arrow)'
            const dash      = edge.type === 'data_driven' ? '5,3' : undefined

            return (
              <line
                key={idx}
                x1={p1.x} y1={p1.y}
                x2={p2.x} y2={p2.y}
                stroke={stroke}
                strokeWidth={isCascade || isRoot ? 2 : 1.5}
                strokeDasharray={dash}
                markerEnd={marker}
                opacity={0.85}
              />
            )
          })}

          {/* Nodes */}
          {nodes.map(node => {
            const pos    = positions[node.id]
            if (!pos) return null
            const colors = nodeColour(node)
            const isRoot = rootSet.has(node.id)
            const isHovered = hoveredNode === node.id
            const shortLabel = (node.id || '').toUpperCase().slice(0, 4)
            const fullLabel  = toLabel(node.id).replace(' Service', '')

            return (
              <g key={node.id}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
                style={{ cursor: 'default' }}
              >
                {/* Pulse ring for root cause */}
                {isRoot && (
                  <circle cx={pos.x} cy={pos.y} r={20} fill="none"
                    stroke="#dc2626" strokeWidth={1.5} opacity={0.5}
                    className="animate-ping" style={{ animationDuration: '2s' }} />
                )}

                {/* Node circle */}
                <circle
                  cx={pos.x} cy={pos.y} r={18}
                  fill={colors.fill}
                  stroke={colors.stroke}
                  strokeWidth={isHovered ? 2.5 : 2}
                  opacity={isHovered ? 1 : 0.92}
                />

                {/* Abbreviated label inside */}
                <text
                  x={pos.x} y={pos.y + 4}
                  fill="#fff"
                  fontSize={9}
                  fontWeight="bold"
                  textAnchor="middle"
                  style={{ pointerEvents: 'none', fontFamily: 'monospace' }}
                >
                  {shortLabel}
                </text>

                {/* Full service name below node */}
                <text
                  x={pos.x} y={pos.y + 32}
                  fill={colors.label}
                  fontSize={10}
                  fontWeight={isRoot ? 700 : 500}
                  textAnchor="middle"
                  style={{ pointerEvents: 'none' }}
                >
                  {fullLabel}
                </text>

                {/* ── Failure propagation % badge ──────────────────────── */}
                {/* Always shown so engineers can compare impact at a glance */}
                {(() => {
                  const pct     = node.cascade_effect_pct ?? 0
                  // Colour tiers: 0 = slate, 1-29 = blue, 30-69 = amber, 70+ = red
                  const barFill = pct === 0 ? '#334155'
                                : pct >= 70 ? '#ef4444'
                                : pct >= 30 ? '#f59e0b'
                                : '#6366f1'
                  const txtFill = pct === 0 ? '#64748b'
                                : pct >= 70 ? '#fca5a5'
                                : pct >= 30 ? '#fde68a'
                                : '#c7d2fe'
                  const bgFill  = pct === 0 ? '#1e293b'
                                : pct >= 70 ? '#7f1d1d'
                                : pct >= 30 ? '#78350f'
                                : '#1e1b4b'
                  const BAR_W   = 46
                  const BAR_H   = 5
                  const bx      = pos.x - BAR_W / 2
                  const by      = pos.y + 38        // below the name label
                  const filled  = Math.round((pct / 100) * BAR_W)

                  return (
                    <g style={{ pointerEvents: 'none' }}>
                      {/* Pill background */}
                      <rect
                        x={bx - 2} y={by - 1}
                        width={BAR_W + 4} height={BAR_H + 2}
                        rx={3}
                        fill={bgFill}
                        stroke={barFill}
                        strokeWidth={0.8}
                        opacity={0.9}
                      />
                      {/* Filled portion */}
                      {filled > 0 && (
                        <rect
                          x={bx} y={by}
                          width={filled} height={BAR_H}
                          rx={2}
                          fill={barFill}
                          opacity={0.9}
                        />
                      )}
                      {/* Percentage label */}
                      <text
                        x={pos.x}
                        y={pos.y + 52}
                        fill={txtFill}
                        fontSize={8.5}
                        fontWeight="700"
                        fontFamily="monospace"
                        textAnchor="middle"
                      >
                        {pct}% propagated
                      </text>
                    </g>
                  )
                })()}

                {/* Cascade step badge */}
                {cascadeSet.has(node.id) && !isRoot && (
                  <>
                    <circle cx={pos.x + 13} cy={pos.y - 13} r={7}
                      fill="#92400e" stroke="#d97706" strokeWidth={1} />
                    <text x={pos.x + 13} y={pos.y - 10}
                      fill="#fde68a" fontSize={8} fontWeight="bold" textAnchor="middle"
                      style={{ pointerEvents: 'none' }}>
                      {cascadePath.indexOf(node.id) + 1}
                    </text>
                  </>
                )}

                {/* Tooltip on hover */}
                {isHovered && (
                  <NodeTooltip
                    node={node}
                    pos={pos}
                    metrics={liveMetrics[node.id]}
                    isRoot={isRoot}
                    cascadeIdx={cascadePath.indexOf(node.id)}
                  />
                )}
              </g>
            )
          })}
        </svg>
      </div>

      {/* Cascade path text — below graph */}
      {cascadePath.length > 0 && (
        <div className="px-4 py-2.5 border-t border-slate-800 flex items-center gap-2 flex-wrap">
          <p className="text-[11px] text-slate-500 uppercase tracking-wider font-medium shrink-0">Cascade path</p>
          {cascadePath.map((svc, i) => (
            <React.Fragment key={svc}>
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded ${
                rootSet.has(svc)
                  ? 'bg-red-950/60 text-red-300 border border-red-800/50'
                  : 'bg-amber-950/40 text-amber-300 border border-amber-800/40'
              }`}>
                {toLabel(svc).replace(' Service', '')}
              </span>
              {i < cascadePath.length - 1 && (
                <span className="text-slate-600 text-xs">→</span>
              )}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  )
}

function LegendItem({ color, label, bar = false }) {
  return (
    <span className="flex items-center gap-1">
      {bar
        ? <span className="w-3 h-1.5 rounded-sm" style={{ backgroundColor: color }} />
        : <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      }
      {label}
    </span>
  )
}

function NodeTooltip({ node, pos, metrics, isRoot, cascadeIdx }) {
  const x = pos.x > 360 ? pos.x - 110 : pos.x + 22
  const y = pos.y > 260 ? pos.y - 80  : pos.y - 10

  return (
    <foreignObject x={x} y={y} width={130} height={90} style={{ overflow: 'visible' }}>
      <div
        xmlns="http://www.w3.org/1999/xhtml"
        className="bg-slate-800 border border-slate-700 rounded-md p-2 text-[10px] shadow-xl pointer-events-none"
      >
        <p className="font-semibold text-slate-200 mb-1">{toLabel(node.id)}</p>
        {isRoot && <p className="text-red-400 font-bold">ROOT CAUSE</p>}
        {cascadeIdx > 0 && <p className="text-amber-400">Cascade step {cascadeIdx + 1}</p>}
        {metrics && (
          <>
            <p className="text-slate-400 mt-1">
              Err: <span className="text-slate-200">{((metrics.error_rate_5xx ?? 0) * 1000).toFixed(2)}/s</span>
            </p>
            <p className="text-slate-400">
              P99: <span className="text-slate-200">{Math.round((metrics.p99_latency_s ?? 0) * 1000)}ms</span>
            </p>
          </>
        )}
        {node.cascade_effect_pct > 0 && (
          <p className="text-amber-300 mt-0.5">{node.cascade_effect_pct}% impact</p>
        )}
      </div>
    </foreignObject>
  )
}
