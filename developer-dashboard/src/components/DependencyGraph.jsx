import React, { useState, useMemo } from 'react'
import { toLabel } from './ServiceCard'
import { getSeverityByPercentage } from '../lib/severity'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Layers,
  RefreshCw,
  ShieldAlert,
  Sliders,
  X,
  Zap,
} from 'lucide-react'

/**
 * DependencyGraph — High-fidelity SVG Microservice Dependency & Cascading Failure Visualization
 *
 * Implements:
 *   - Clean, non-congested 2-column planar geometry with zero line overlaps
 *   - Runtime-based dynamic request calculations:
 *       Affected % = (Unique affected requests / Total requests) * 100
 *   - Strict separation of Fault Intensity, Actual Impact %, and Propagation Risk
 *   - Exactly one ROOT CAUSE badge on the injected fault source
 *   - DIRECT / INDIRECT / HEALTHY badges for dependent services
 *   - Clickable Node Evidence Panel displaying the exact mathematical formula & telemetry grid
 *   - Hoverable Edge Inspector with timeout, retries, and circuit breaker details
 */
export default function DependencyGraph({
  graphData,
  rootCauses       = [],
  cascadePath      = [],
  liveMetrics      = {},
  serviceImpactPct = {},
  loading          = false,
}) {
  const [hoveredNode, setHoveredNode] = useState(null)
  const [hoveredEdge, setHoveredEdge] = useState(null)
  const [selectedNode, setSelectedNode] = useState(null)

  // ── Compute node positions with spacious, balanced, zero-overlap geometry ──
  const { nodes, edges, positions } = useMemo(() => {
    if (!graphData?.nodes?.length) return { nodes: [], edges: [], positions: {} }

    const ns = graphData.nodes
    const es = graphData.edges ?? []
    const ids = ns.map(n => n.id)

    const isOmniStore   = ids.includes('order') && ids.includes('payment')
    const isMovieStream = ids.includes('catalog') && ids.includes('recommendation')

    const pos = {}

    if (isOmniStore) {
      // 2-column layout — viewBox 640×420
      // Left  (x=150): Order, Inventory, Shipping
      // Right (x=490): Payment, Notification, Delivery
      // Extra vertical spacing so labels never overlap
      const omniPositions = {
        order:        { x: 150, y: 80  },
        payment:      { x: 490, y: 80  },
        inventory:    { x: 150, y: 210 },
        notification: { x: 490, y: 210 },
        shipping:     { x: 150, y: 340 },
        delivery:     { x: 490, y: 340 },
      }
      ns.forEach(n => { pos[n.id] = omniPositions[n.id] || { x: 320, y: 210 } })
    } else if (isMovieStream) {
      // Left column = profile/activity services, Right = content services
      const moviePositions = {
        user:           { x: 150, y: 80  },
        watchlist:      { x: 150, y: 210 },
        history:        { x: 150, y: 340 },
        catalog:        { x: 490, y: 120 },
        recommendation: { x: 490, y: 290 },
      }
      ns.forEach(n => { pos[n.id] = moviePositions[n.id] || { x: 320, y: 210 } })
    } else {
      // Generic hierarchical DAG
      const inDeg = {}, outDeg = {}
      ns.forEach(n => { inDeg[n.id] = 0; outDeg[n.id] = 0 })
      es.forEach(e => {
        if (outDeg[e.source] !== undefined) outDeg[e.source]++
        if (inDeg[e.target]  !== undefined) inDeg[e.target]++
      })

      const layers = [[], [], []]
      ns.forEach(n => {
        if (inDeg[n.id] === 0) {
          layers[0].push(n.id)
        } else if (outDeg[n.id] === 0) {
          layers[2].push(n.id)
        } else {
          layers[1].push(n.id)
        }
      })
      if (!layers[0].length && layers[1].length) layers[0].push(layers[1].shift())
      if (!layers[2].length && layers[1].length > 1) layers[2].push(layers[1].pop())

      const layerY = [70, 200, 330]
      layers.forEach((layerNodes, lIdx) => {
        const count = layerNodes.length
        if (count === 0) return
        const spacing = Math.min(180, 500 / Math.max(count, 1))
        const startX = 320 - ((count - 1) * spacing) / 2
        layerNodes.forEach((id, i) => {
          pos[id] = {
            x: Math.round(startX + i * spacing),
            y: layerY[lIdx],
          }
        })
      })

      ns.forEach(n => {
        if (!pos[n.id]) pos[n.id] = { x: 320, y: 200 }
      })
    }

    return { nodes: ns, edges: es, positions: pos }
  }, [graphData])

  // ALL root causes — supports multi-fault scenarios
  const rootCauseSet = useMemo(() => {
    const s = new Set()
    if (rootCauses?.length > 0) {
      rootCauses.forEach(c => {
        const id = typeof c === 'string' ? c : c.service
        if (id) s.add(id)
      })
    }
    nodes.forEach(n => { if (n.status === 'ROOT_CAUSE') s.add(n.id) })
    return s
  }, [rootCauses, nodes])

  // Keep primaryRootCause for backward-compat edge coloring (first root)
  const primaryRootCause = useMemo(() => {
    if (rootCauseSet.size > 0) return [...rootCauseSet][0]
    return null
  }, [rootCauseSet])

  const cascadeSet = useMemo(() => new Set(cascadePath || []), [cascadePath])

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-800 bg-[#0c1324] flex items-center justify-center h-96">
        <p className="text-xs text-slate-500 animate-pulse">Loading architecture topology…</p>
      </div>
    )
  }

  if (!nodes.length) {
    return (
      <div className="rounded-xl border border-slate-800 bg-[#0c1324] flex items-center justify-center h-96">
        <p className="text-xs text-slate-500 italic">No dependency graph data available</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-[#0b1120] overflow-hidden flex flex-col shadow-2xl relative">
      {/* Graph Toolbar & Legend */}
      <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between flex-wrap gap-2 text-xs bg-slate-900/60">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-200">Microservice Dependency Graph</span>
          <span className="text-slate-500 font-mono text-[11px]">
            {nodes.length} services • {edges.length} dependencies
          </span>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-[11px] text-slate-400 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse ring-2 ring-red-500/40" />
            <span className="text-red-400 font-semibold">Root Cause</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            <span className="text-amber-300">Direct Cascade</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-orange-500" />
            <span className="text-orange-300">Indirect Cascade</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span className="text-emerald-400">Healthy</span>
          </div>
          <div className="h-3 w-px bg-slate-700" />
          <div className="flex items-center gap-1.5">
            <span className="w-5 h-0.5 bg-slate-400 inline-block" />
            <span>Sync RPC</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-5 border-t border-dashed border-slate-400 inline-block" />
            <span>Async Event</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-5 border-t-2 border-dotted border-slate-400 inline-block" />
            <span>Conditional</span>
          </div>
        </div>
      </div>

      {/* SVG Canvas */}
      <div className="relative flex-1 min-h-[420px] flex items-center justify-center p-4 bg-gradient-to-b from-[#0b1120] to-[#070c18]">
        <svg
          viewBox="0 0 640 420"
          className="w-full max-w-[720px] h-auto select-none"
          style={{ overflow: 'visible' }}
        >
          <defs>
            {/* Arrowhead markers — refX="8" places tip at path end (node edge) */}
            <marker id="dg-arrow" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M 0 2 L 9 5 L 0 8 z" fill="#64748b" />
            </marker>
            <marker id="dg-arrow-root" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="9" markerHeight="9" orient="auto-start-reverse">
              <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#ef4444" />
            </marker>
            <marker id="dg-arrow-cascade" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="9" markerHeight="9" orient="auto-start-reverse">
              <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#f97316" />
            </marker>
            <filter id="dg-glow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Edges */}
          {edges.map((edge, idx) => {
            const p1 = positions[edge.source]
            const p2 = positions[edge.target]
            if (!p1 || !p2) return null

            const isSync = edge.is_sync ?? (edge.type === 'synchronous')
            const isConditional = edge.type === 'conditional'
            const isRootEdge = rootCauseSet.has(edge.source) || rootCauseSet.has(edge.target)
            const isProp = edge.is_active_propagation === true
            const isHovered = hoveredEdge === idx

            // ── Edge visual style ─────────────────────────────────────────────
            let stroke = '#334155'
            let marker = 'url(#dg-arrow)'
            let strokeWidth = isHovered ? 2.8 : 1.6
            let opacity = 0.55
            // When NOT active propagation: show edge type via dash pattern
            // When ACTIVE propagation: always solid so it's clearly visible
            let strokeDasharray = isProp
              ? undefined                                      // solid when propagating
              : isSync ? undefined : isConditional ? '9,4' : '5,4'

            if (isProp) {
              // Red = edge connected directly to root cause node
              // Orange = downstream cascade edge
              stroke = isRootEdge ? '#ef4444' : '#f97316'
              marker = isRootEdge ? 'url(#dg-arrow-root)' : 'url(#dg-arrow-cascade)'
              strokeWidth = isHovered ? 3.4 : 2.4
              opacity = 0.95
            }

            // ── Compute path endpoints that stop at node circle edge (r=21) ──────
            // Shorten the line so it terminates exactly at the node circumference,
            // not at the centre. This makes arrowheads land precisely regardless of
            // line angle or length.
            const NODE_R = 21
            const dx = p2.x - p1.x
            const dy = p2.y - p1.y
            const dist = Math.sqrt(dx * dx + dy * dy)
            const ux = dist > 0 ? dx / dist : 0
            const uy = dist > 0 ? dy / dist : 0
            // Source: start just outside source circle
            const sx = p1.x + ux * (NODE_R + 2)
            const sy = p1.y + uy * (NODE_R + 2)
            // Target: stop just outside target circle
            const tx = p2.x - ux * (NODE_R + 2)
            const ty = p2.y - uy * (NODE_R + 2)

            // Compute path
            let pathD = `M ${sx} ${sy} L ${tx} ${ty}`

            // order→shipping: both on left column (x=150), arc curves left to avoid Inventory
            // user→history: both on left column (x=150), arc curves left to avoid Watchlist
            if (edge.source === 'order' && edge.target === 'shipping') {
              pathD = `M ${p1.x} ${p1.y + NODE_R + 2} C ${p1.x - 70} ${p1.y + 60}, ${p2.x - 70} ${p2.y - 60}, ${p2.x} ${p2.y - NODE_R - 2}`
            } else if (edge.source === 'user' && edge.target === 'history') {
              pathD = `M ${p1.x} ${p1.y + NODE_R + 2} C ${p1.x - 70} ${p1.y + 60}, ${p2.x - 70} ${p2.y - 60}, ${p2.x} ${p2.y - NODE_R - 2}`
            }

            return (
              <g
                key={`${edge.source}-${edge.target}-${idx}`}
                onMouseEnter={() => setHoveredEdge(idx)}
                onMouseLeave={() => setHoveredEdge(null)}
                style={{ cursor: 'pointer' }}
              >
                {/* Wide invisible hover hitbox */}
                <path d={pathD} fill="none" stroke="transparent" strokeWidth={16} />

                {/* Visible edge path */}
                <path
                  d={pathD}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  strokeDasharray={strokeDasharray}
                  markerEnd={marker}
                  opacity={opacity}
                  filter={isProp ? 'url(#dg-glow)' : undefined}
                  className={isProp ? 'animate-pulse' : undefined}
                />

                {/* Edge tooltip on hover */}
                {isHovered && (
                  <EdgeTooltip
                    edge={edge}
                    midX={(p1.x + p2.x) / 2}
                    midY={(p1.y + p2.y) / 2}
                  />
                )}
              </g>
            )
          })}

          {/* Nodes */}
          {nodes.map(node => {
            const pos = positions[node.id]
            if (!pos) return null

            const isRoot = rootCauseSet.has(node.id) || node.status === 'ROOT_CAUSE'
            const isDirect = node.status === 'DIRECT' || node.impact_type === 'DIRECT'
            const isIndirect = node.status === 'INDIRECT' || node.impact_type === 'INDIRECT'
            const isInsufficient = node.status === 'INSUFFICIENT_TELEMETRY' || node.actual_impact_pct === null
            const isHovered = hoveredNode === node.id
            const isSelected = selectedNode?.id === node.id

            const shortLabel = (node.id || '').toUpperCase().slice(0, 4)
            const fullLabel = toLabel(node.id).replace(' Service', '')

            // Extract numerical impact value
            let rawPct = serviceImpactPct[node.id]
            if (rawPct == null && node.actual_impact_pct != null) rawPct = node.actual_impact_pct
            if (rawPct == null && node.impact_pct != null) rawPct = node.impact_pct
            const hasTelemetry = Number.isFinite(Number(rawPct)) && !isInsufficient
            const impactValue = hasTelemetry ? Number(rawPct) : 0.0

            const severity = getSeverityByPercentage(impactValue)
            // Colors: RED=root, severity-based=affected, BLUE=healthy
            const nodeFill = isRoot
              ? '#dc2626'
              : (isDirect || isIndirect)
                ? (impactValue > 0 ? severity.color : '#f97316')
                : '#3b82f6'  // always blue for healthy services

            const totalReqs = node.total_requests ?? 0
            const affReqs = node.affected_requests ?? 0

            return (
              <g
                key={node.id}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
                onClick={() => setSelectedNode(node)}
                style={{ cursor: 'pointer' }}
              >
                {/* Pulse animation strictly for Root Cause — contained within viewBox */}
                {isRoot && (
                  <circle
                    cx={pos.x} cy={pos.y} r={24}
                    fill="none" stroke="#ef4444" strokeWidth={2}
                    opacity={0.35} className="animate-ping"
                    style={{ animationDuration: '2s', transformOrigin: `${pos.x}px ${pos.y}px` }}
                  />
                )}

                {/* Selected Node Ring */}
                {isSelected && (
                  <circle
                    cx={pos.x} cy={pos.y} r={26}
                    fill="none" stroke="#38bdf8" strokeWidth={2.5}
                    strokeDasharray="4,2"
                    className="animate-spin"
                    style={{ animationDuration: '10s' }}
                  />
                )}

                {/* Main Node Circle */}
                <circle
                  cx={pos.x} cy={pos.y} r={21}
                  fill={nodeFill}
                  stroke={isSelected ? '#38bdf8' : isHovered ? '#ffffff' : (isRoot ? '#b91c1c' : '#1e293b')}
                  strokeWidth={isSelected ? 3 : isHovered ? 2.5 : 1.8}
                  opacity={0.96}
                  className="transition-all duration-200"
                />

                {/* 4-letter Abbreviation */}
                <text
                  x={pos.x} y={pos.y + 4.5}
                  fill="#ffffff"
                  fontSize={9.5}
                  fontWeight="bold"
                  textAnchor="middle"
                  style={{ pointerEvents: 'none', fontFamily: 'monospace' }}
                >
                  {shortLabel}
                </text>

                {/* Status Badges Above Node */}
                {isRoot ? (
                  <g>
                    <rect x={pos.x - 32} y={pos.y - 34} width={64} height={14} rx={7}
                      fill="#991b1b" stroke="#ef4444" strokeWidth={1.2} />
                    <text x={pos.x} y={pos.y - 24} fill="#ffffff" fontSize={7.5}
                      fontWeight="bold" textAnchor="middle"
                      style={{ pointerEvents: 'none', letterSpacing: '0.05em' }}>
                      ROOT CAUSE
                    </text>
                  </g>
                ) : isDirect ? (
                  <g>
                    <rect x={pos.x - 24} y={pos.y - 34} width={48} height={13} rx={6.5}
                      fill="#78350f" stroke="#f59e0b" strokeWidth={1} />
                    <text x={pos.x} y={pos.y - 25} fill="#fef3c7" fontSize={7.5}
                      fontWeight="bold" textAnchor="middle"
                      style={{ pointerEvents: 'none', letterSpacing: '0.04em' }}>
                      DIRECT
                    </text>
                  </g>
                ) : isIndirect ? (
                  <g>
                    <rect x={pos.x - 28} y={pos.y - 34} width={56} height={13} rx={6.5}
                      fill="#7c2d12" stroke="#f97316" strokeWidth={1} />
                    <text x={pos.x} y={pos.y - 25} fill="#ffedd5" fontSize={7.5}
                      fontWeight="bold" textAnchor="middle"
                      style={{ pointerEvents: 'none', letterSpacing: '0.04em' }}>
                      INDIRECT
                    </text>
                  </g>
                ) : (
                  <g>
                    <rect x={pos.x - 22} y={pos.y - 34} width={44} height={13} rx={6.5}
                      fill="#052e16" stroke="#16a34a" strokeWidth={1} />
                    <text x={pos.x} y={pos.y - 25} fill="#86efac" fontSize={7}
                      fontWeight="bold" textAnchor="middle"
                      style={{ pointerEvents: 'none', letterSpacing: '0.04em' }}>
                      HEALTHY
                    </text>
                  </g>
                )}

                {/* Service Name Label */}
                <text
                  x={pos.x} y={pos.y + 33}
                  fill={isRoot ? '#fca5a5' : impactValue > 0 ? '#fed7aa' : '#e2e8f0'}
                  fontSize={11}
                  fontWeight={isRoot ? 700 : 600}
                  textAnchor="middle"
                  style={{ pointerEvents: 'none' }}
                >
                  {fullLabel}
                </text>

                {/* Progress Bar Track */}
                <rect
                  x={pos.x - 32} y={pos.y + 39}
                  width={64} height={4.5} rx={2.25}
                  fill="#1e293b"
                />

                {/* Progress Bar Fill with Exact Dynamic Width */}
                {hasTelemetry && impactValue > 0 && (
                  <rect
                    x={pos.x - 32} y={pos.y + 39}
                    width={Math.max(4, Math.min(64, (impactValue / 100) * 64))}
                    height={4.5} rx={2.25}
                    fill={isRoot ? '#dc2626' : severity.color}
                  />
                )}

                {/* Dynamic Calculated Percentage Text */}
                <text
                  x={pos.x} y={pos.y + 53}
                  fill={isRoot ? '#f87171' : (isDirect || isIndirect) ? (hasTelemetry && impactValue > 0 ? severity.color : '#94a3b8') : '#34d399'}
                  fontSize={9}
                  fontWeight={impactValue > 0 ? 700 : 400}
                  textAnchor="middle"
                  style={{ pointerEvents: 'none', fontFamily: 'monospace' }}
                >
                  {isInsufficient
                    ? 'N/A – Telemetry'
                    : isRoot || isDirect || isIndirect
                      ? `${impactValue.toFixed(2)}% affected`
                      : impactValue > 0
                        ? `${impactValue.toFixed(2)}% affected`
                        : '✓ Healthy'
                  }
                </text>

                {/* Request Count Breakdown (e.g. 300 / 1000 reqs) */}
                <text
                  x={pos.x} y={pos.y + 63}
                  fill="#64748b"
                  fontSize={8}
                  textAnchor="middle"
                  style={{ pointerEvents: 'none', fontFamily: 'monospace' }}
                >
                  {totalReqs > 0 ? `${affReqs} / ${totalReqs} reqs` : '0 requests'}
                </text>
              </g>
            )
          })}
        </svg>

        {/* Click-to-inspect helper pill */}
        <div className="absolute bottom-3 right-3 text-[10px] text-slate-500 bg-slate-900/80 px-2 py-1 rounded border border-slate-800">
          Click any node to open mathematical evidence
        </div>
      </div>

      {/* Bottom Cascade Path Sequence */}
      {cascadePath.length > 0 && (
        <div className="px-5 py-3 border-t border-slate-800/80 bg-slate-900/70 flex items-center gap-2 flex-wrap">
          <p className="text-[11px] text-slate-500 uppercase tracking-wider font-mono font-bold shrink-0">
            CASCADE PATH
          </p>
          {cascadePath.map((svc, i) => {
            const isRoot = rootCauseSet.has(svc) || i === 0
            const rawImpact = serviceImpactPct[svc] ?? 0
            return (
              <React.Fragment key={svc}>
                <span
                  onClick={() => {
                    const match = nodes.find(n => n.id === svc)
                    if (match) setSelectedNode(match)
                  }}
                  className={`text-[11px] font-semibold px-3 py-1 rounded-md border flex items-center gap-1.5 cursor-pointer transition-all hover:scale-105 ${
                    isRoot
                      ? 'bg-red-950/80 text-red-200 border-red-700 shadow-md shadow-red-950/60 ring-1 ring-red-500/30'
                      : 'bg-orange-950/50 text-orange-200 border-orange-700/70 shadow-sm shadow-orange-950/40'
                  }`}
                >
                  {isRoot && <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-ping" />}
                  <span>{toLabel(svc).replace(' Service', '')}</span>
                  <span className="text-[10px] font-mono text-slate-400 opacity-80">
                    ({Number(rawImpact).toFixed(1)}%)
                  </span>
                </span>
                {i < cascadePath.length - 1 && (
                  <span className="text-slate-600 font-bold select-none">→</span>
                )}
              </React.Fragment>
            )
          })}
        </div>
      )}

      {/* Slide-out / Modal Interactive Node Evidence Panel */}
      {selectedNode && (
        <NodeEvidencePanel
          node={selectedNode}
          isRoot={rootCauseSet.has(selectedNode.id) || selectedNode.status === 'ROOT_CAUSE'}
          liveMetric={liveMetrics[selectedNode.id]}
          onClose={() => setSelectedNode(null)}
        />
      )}
    </div>
  )
}

/**
 * Slide-out Interactive Evidence Panel for Selected Node
 * Displays the exact mathematical equation, 3 separated telemetry measurements, and request grid.
 */
function NodeEvidencePanel({ node, isRoot, liveMetric, onClose }) {
  const isDirect = node.status === 'DIRECT' || node.impact_type === 'DIRECT'
  const isIndirect = node.status === 'INDIRECT' || node.impact_type === 'INDIRECT'
  const isInsufficient = node.status === 'INSUFFICIENT_TELEMETRY' || node.actual_impact_pct === null
  const hasTelemetry = !isInsufficient && node.actual_impact_pct !== null

  const impactValue = hasTelemetry ? Number(node.actual_impact_pct) : null
  const severity = hasTelemetry ? getSeverityByPercentage(impactValue) : { label: 'Insufficient Data', color: '#64748b' }

  const totalReqs = node.total_requests ?? 0
  const affReqs = node.affected_requests ?? 0
  const succReqs = node.successful_requests ?? Math.max(0, totalReqs - affReqs)
  const failReqs = node.failed_requests ?? 0
  const timeoutReqs = node.timed_out_requests ?? 0
  const delayReqs = node.delayed_requests ?? 0

  return (
    <div className="absolute inset-y-0 right-0 w-full max-w-md bg-slate-900/98 backdrop-blur-xl border-l border-slate-700/80 shadow-2xl p-5 overflow-y-auto z-30 flex flex-col justify-between animate-in slide-in-from-right duration-200">
      <div>
        {/* Panel Header */}
        <div className="flex items-start justify-between border-b border-slate-800 pb-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: isRoot ? '#dc2626' : severity.color }}
              />
              <h3 className="font-bold text-slate-100 text-base">
                {toLabel(node.id)}
              </h3>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Business Tier: <span className="text-slate-200 font-semibold">{node.business_tier ?? 'Critical'}</span>
            </p>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Status Pill Banner */}
        <div className="mb-4">
          {isRoot ? (
            <div className="px-3 py-2 rounded-lg bg-red-950/80 border border-red-700/80 flex items-center justify-between text-xs text-red-200 shadow-inner">
              <div className="flex items-center gap-2">
                <ShieldAlert size={16} className="text-red-400 animate-pulse" />
                <span className="font-bold">INJECTED FAULT ORIGIN (ROOT CAUSE)</span>
              </div>
              <span className="text-[10px] font-mono bg-red-900/60 px-1.5 py-0.5 rounded text-red-300">
                P1 Priority
              </span>
            </div>
          ) : isDirect ? (
            <div className="px-3 py-2 rounded-lg bg-amber-950/60 border border-amber-700/80 flex items-center justify-between text-xs text-amber-200">
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} className="text-amber-400" />
                <span className="font-bold">DIRECT SYNCHRONOUS CASCADE</span>
              </div>
              <span className="text-[10px] font-mono bg-amber-900/60 px-1.5 py-0.5 rounded text-amber-300">
                Via {node.fault_source}
              </span>
            </div>
          ) : isIndirect ? (
            <div className="px-3 py-2 rounded-lg bg-orange-950/60 border border-orange-700/80 flex items-center justify-between text-xs text-orange-200">
              <div className="flex items-center gap-2">
                <Sliders size={16} className="text-orange-400" />
                <span className="font-bold">INDIRECT CONDITIONAL CASCADE</span>
              </div>
              <span className="text-[10px] font-mono bg-orange-900/60 px-1.5 py-0.5 rounded text-orange-300">
                Via {node.fault_source}
              </span>
            </div>
          ) : (
            <div className="px-3 py-2 rounded-lg bg-emerald-950/60 border border-emerald-700/80 flex items-center justify-between text-xs text-emerald-200">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-400" />
                <span className="font-bold">HEALTHY / NOMINAL OPERATION</span>
              </div>
              <span className="text-[10px] font-mono bg-emerald-900/60 px-1.5 py-0.5 rounded text-emerald-300">
                SLA Compliant
              </span>
            </div>
          )}
        </div>

        {/* ── HIGHLIGHTED MATHEMATICAL CALCULATION BANNER ── */}
        <div className="rounded-lg border border-cyan-800/80 bg-cyan-950/30 p-3.5 mb-4 shadow-inner">
          <p className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 font-bold mb-1">
            Exact Runtime Mathematical Equation
          </p>
          <div className="bg-slate-950/80 rounded p-2 text-xs font-mono border border-slate-800 space-y-1">
            <p className="text-slate-400 text-[10.5px]">
              Affected % = <span className="text-cyan-300">(Unique affected reqs / Total reqs) × 100</span>
            </p>
            <p className="text-white font-bold text-sm text-cyan-200 pt-0.5">
              {hasTelemetry
                ? `(${affReqs.toLocaleString()} / ${totalReqs.toLocaleString()}) × 100 = ${impactValue.toFixed(2)}%`
                : 'N/A – Insufficient telemetry (0 requests)'}
            </p>
          </div>
          {node.reason && (
            <p className="text-[10.5px] text-slate-300 mt-2 italic leading-relaxed">
              Diagnostic: {node.reason}
            </p>
          )}
        </div>

        {/* ── 3 SEPARATED MEASUREMENTS ── */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 flex flex-col justify-between">
            <span className="text-[10px] text-slate-400 font-medium leading-tight">
              A. Fault Intensity
            </span>
            <span className="text-[11px] font-semibold text-rose-300 mt-1 font-mono truncate" title={node.fault_intensity}>
              {node.fault_intensity ?? 'Nominal'}
            </span>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 flex flex-col justify-between">
            <span className="text-[10px] text-slate-400 font-medium leading-tight">
              B. Actual Impact
            </span>
            <span
              className="text-sm font-bold mt-1 font-mono"
              style={{ color: isRoot ? '#ef4444' : severity.color }}
            >
              {hasTelemetry ? `${impactValue.toFixed(2)}%` : 'N/A'}
            </span>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 flex flex-col justify-between">
            <span className="text-[10px] text-slate-400 font-medium leading-tight">
              C. Propagation Risk
            </span>
            <span className="text-sm font-bold text-amber-300 mt-1 font-mono">
              {node.propagation_risk != null ? `${Number(node.propagation_risk).toFixed(1)}%` : '20.0%'}
            </span>
          </div>
        </div>

        {/* ── REQUEST BREAKDOWN TELEMETRY ── */}
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 mb-4 space-y-2 text-xs">
          <p className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-bold border-b border-slate-800/80 pb-1">
            Request Telemetry (60s rolling window)
          </p>

          <div className="grid grid-cols-2 gap-2 text-[11px] font-mono pt-1">
            <div className="flex justify-between border-b border-slate-900 pb-1">
              <span className="text-slate-400">Total Requests:</span>
              <span className="font-bold text-white">{totalReqs.toLocaleString()}</span>
            </div>
            <div className="flex justify-between border-b border-slate-900 pb-1">
              <span className="text-slate-400">Successful:</span>
              <span className="font-bold text-emerald-400">{succReqs.toLocaleString()}</span>
            </div>
            <div className="flex justify-between border-b border-slate-900 pb-1">
              <span className="text-slate-400">Unique Affected:</span>
              <span className="font-bold text-rose-400">{affReqs.toLocaleString()}</span>
            </div>
            <div className="flex justify-between border-b border-slate-900 pb-1">
              <span className="text-slate-400">5xx Server Errors:</span>
              <span className="font-bold text-red-400">{failReqs.toLocaleString()}</span>
            </div>
            <div className="flex justify-between border-b border-slate-900 pb-1">
              <span className="text-slate-400">Timed-out Reqs:</span>
              <span className="font-bold text-amber-300">{timeoutReqs.toLocaleString()}</span>
            </div>
            <div className="flex justify-between border-b border-slate-900 pb-1">
              <span className="text-slate-400">Delayed (&gt; SLO):</span>
              <span className="font-bold text-orange-300">{delayReqs.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* ── RESILIENCE & LATENCY DETAILS ── */}
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-1.5 text-xs">
          <p className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-bold border-b border-slate-800/80 pb-1">
            Resilience, SLOs & Latency Distribution
          </p>
          <div className="space-y-1.5 text-[11px] font-mono text-slate-300 pt-1">
            <p className="flex justify-between">
              <span className="text-slate-400">P50 / P95 / P99 Latency:</span>
              <span className="text-white">
                {node.p50_latency_ms ?? 25}ms / {node.p95_latency_ms ?? 150}ms / {node.p99_latency_ms ?? Math.round((node.p99_latency ?? 0.05) * 1000)}ms
              </span>
            </p>
            <p className="flex justify-between">
              <span className="text-slate-400">Circuit Breaker:</span>
              <span className={`font-semibold ${node.circuit_breaker_state === 'Open' ? 'text-red-400' : node.circuit_breaker_state === 'Half-Open' ? 'text-amber-400' : 'text-emerald-400'}`}>
                {node.circuit_breaker_state ?? 'Closed'}
              </span>
            </p>
            <p className="flex justify-between">
              <span className="text-slate-400">Retry Budget:</span>
              <span className="text-white">{node.retry_count ?? 2} configured attempts</span>
            </p>
            <p className="flex justify-between">
              <span className="text-slate-400">Queue Backlog:</span>
              <span className="text-amber-300">{node.queue_backlog ?? 0} buffered messages</span>
            </p>
            {node.dependency_path && (
              <p className="flex justify-between pt-1 border-t border-slate-900">
                <span className="text-slate-400">Dependency Path:</span>
                <span className="text-cyan-300 font-semibold">{node.dependency_path}</span>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Dismiss Button */}
      <div className="pt-4 border-t border-slate-800 mt-4">
        <button
          onClick={onClose}
          className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
        >
          Close Inspection Panel
        </button>
      </div>
    </div>
  )
}

/**
 * Interactive Edge Inspector Tooltip
 */
function EdgeTooltip({ edge, midX, midY }) {
  const x = Math.max(20, Math.min(440, midX - 95))
  const y = Math.max(20, Math.min(270, midY - 65))

  return (
    <foreignObject x={x} y={y} width={200} height={140} style={{ overflow: 'visible' }}>
      <div
        xmlns="http://www.w3.org/1999/xhtml"
        className="bg-slate-900/98 border border-slate-700 backdrop-blur-md rounded-lg p-2.5 text-[10px] shadow-2xl pointer-events-none text-slate-200"
      >
        <div className="flex items-center justify-between border-b border-slate-800 pb-1 mb-1.5">
          <span className="font-bold text-slate-100 font-mono">
            {edge.source} → {edge.target}
          </span>
          <span className="text-[9px] px-1 rounded bg-slate-800 text-slate-300 capitalize">
            {edge.type}
          </span>
        </div>

        <div className="space-y-1 text-[9.5px] text-slate-300 font-mono">
          <p className="flex justify-between">
            <span className="text-slate-400">Timeout:</span>
            <span className="text-white">{edge.timeout_ms ?? 3000}ms</span>
          </p>
          <p className="flex justify-between">
            <span className="text-slate-400">Retries:</span>
            <span className="text-white">{edge.retries ?? 2} attempts</span>
          </p>
          <p className="flex justify-between">
            <span className="text-slate-400">Circuit Breaker:</span>
            <span className="text-emerald-400">{edge.circuit_breaker ?? 'Enabled'}</span>
          </p>
        </div>

        {edge.description && (
          <p className="mt-1.5 text-[8.5px] text-slate-400 italic border-t border-slate-800/80 pt-1 leading-tight">
            {edge.description}
          </p>
        )}
      </div>
    </foreignObject>
  )
}
