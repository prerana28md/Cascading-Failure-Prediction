import React from 'react'
import { ResponsiveContainer, AreaChart, Area } from 'recharts'
import { fmtMetric } from '../lib/api'
import { deriveServiceStatus, SERVICE_STATUS_CFG } from './SystemStatus'

/**
 * ServiceCard — generic card for one service.
 *
 * Props:
 *   serviceKey   string            e.g. 'order'
 *   metrics      object            live_metrics[serviceKey] from API
 *   history      Array<number>     recent error_rate values (for sparkline)
 *   onClick      fn|null           if provided, card is clickable
 *   selected     bool
 *   compact      bool              smaller variant for overview grid
 */
export default function ServiceCard({
  serviceKey,
  metrics = null,
  history = [],
  onClick = null,
  selected = false,
  compact = false,
}) {
  const status = deriveServiceStatus(metrics)
  const cfg    = SERVICE_STATUS_CFG[status] ?? SERVICE_STATUS_CFG.UNKNOWN
  const label  = toLabel(serviceKey)

  // Sparkline data — handle both old format (number[]) and new format (snapshot[])
  const sparkData = (history ?? []).map(v => ({
    v: typeof v === 'object' ? (v?.error_rate ?? 0) : (v ?? 0)
  }))

  const sparkColor = {
    HEALTHY:  '#34d399',
    WARNING:  '#fbbf24',
    DEGRADED: '#f97316',
    DOWN:     '#f87171',
    UNKNOWN:  '#64748b',
  }[status]

  const cardClass = [
    'rounded-lg border bg-slate-900 transition-colors',
    selected ? 'border-indigo-600/60 ring-1 ring-indigo-600/30' : 'border-slate-800 hover:border-slate-700',
    onClick ? 'cursor-pointer' : '',
    compact ? 'p-3' : 'p-4',
  ].join(' ')

  return (
    <div className={cardClass} onClick={onClick}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <p className="text-[11px] text-slate-500 uppercase tracking-wider font-medium truncate">
            {label}
          </p>
        </div>
        <div className={`flex items-center gap-1 shrink-0 text-[11px] font-semibold ${cfg.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${status === 'DOWN' ? 'animate-pulse' : ''}`} />
          {cfg.label}
        </div>
      </div>

      {/* Metrics */}
      {metrics ? (
        <>
          <div className={`grid gap-x-4 gap-y-1.5 text-xs ${compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}>
            <Metric label="Error Rate" value={fmtMetric(metrics.error_rate_5xx, 'rate')} warn={(metrics.error_rate_5xx ?? 0) > 0.01} />
            <Metric label="P99 Latency" value={fmtMetric(metrics.p99_latency_s, 'latency')} warn={(metrics.p99_latency_s ?? 0) > 0.8} />
            {!compact && <Metric label="Req Rate" value={fmtMetric(metrics.request_rate, 'rate')} />}
          </div>

          {/* Sparkline */}
          {sparkData.length > 1 && (
            <div className="mt-3 h-9">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sparkData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id={`sg-${serviceKey}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={sparkColor} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={sparkColor} stopOpacity={0}   />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="v"
                    stroke={sparkColor}
                    fill={`url(#sg-${serviceKey})`}
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      ) : (
        <p className="text-[11px] text-slate-600 italic mt-1">No metric data</p>
      )}
    </div>
  )
}

/** Single metric row inside a card */
function Metric({ label, value, warn = false }) {
  return (
    <div>
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className={`text-sm font-mono font-semibold mt-0.5 ${warn ? 'text-amber-400' : 'text-slate-200'}`}>
        {value}
      </p>
    </div>
  )
}

/** Convert 'order' → 'Order Service',  'payment' → 'Payment Service', etc. */
export function toLabel(key) {
  if (!key) return ''
  return key
    .split(/[-_]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    + ' Service'
}

/**
 * ServiceDetailPanel — expanded view for a selected service.
 * Shown in ServicesPage when a card is clicked.
 */
export function ServiceDetailPanel({ serviceKey, metrics, history, incidents }) {
  const status = deriveServiceStatus(metrics)
  const cfg    = SERVICE_STATUS_CFG[status] ?? SERVICE_STATUS_CFG.UNKNOWN
  const label  = toLabel(serviceKey)

  const svcIncidents = (incidents || [])
    .filter(e => e.service === serviceKey)
    .slice(0, 8)

  const latencyHistory = history.map(v => ({
    v: typeof v === 'object' ? (v?.error_rate ?? 0) : (v ?? 0)
  }))

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-5 space-y-5">

      {/* Title */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-100">{label}</h3>
        <span className={`flex items-center gap-1.5 text-xs font-semibold ${cfg.text}`}>
          <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
          {cfg.label}
        </span>
      </div>

      {/* Metric grid */}
      {metrics ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
          {[
            { label: 'Request Rate',  value: fmtMetric(metrics.request_rate,   'rate')    },
            { label: 'Error Rate',    value: fmtMetric(metrics.error_rate_5xx,  'rate'),    warn: (metrics.error_rate_5xx  ?? 0) > 0.01 },
            { label: 'P50 Latency',   value: fmtMetric(metrics.p50_latency_s,  'latency') },
            { label: 'P95 Latency',   value: fmtMetric(metrics.p95_latency_s,  'latency'), warn: (metrics.p95_latency_s   ?? 0) > 0.5  },
            { label: 'P99 Latency',   value: fmtMetric(metrics.p99_latency_s,  'latency'), warn: (metrics.p99_latency_s   ?? 0) > 0.8  },
            { label: 'JVM Heap',      value: metrics.jvm_heap_mb != null ? `${Math.round(metrics.jvm_heap_mb)} MB` : '—' },
          ].map(m => (
            <div key={m.label} className="space-y-0.5">
              <p className="text-[10px] text-slate-500">{m.label}</p>
              <p className={`text-sm font-mono font-semibold ${m.warn ? 'text-amber-400' : 'text-slate-200'}`}>{m.value}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500 italic">No metric data available</p>
      )}

      {/* Latency sparkline */}
      {latencyHistory.length > 1 && (
        <div>
          <p className="text-[10px] text-slate-500 mb-2">Error Rate Trend</p>
          <div className="h-16">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={latencyHistory} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={`det-${serviceKey}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}   />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="v" stroke="#6366f1" fill={`url(#det-${serviceKey})`} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Recent incidents for this service */}
      {svcIncidents.length > 0 && (
        <div>
          <p className="text-[10px] text-slate-500 mb-2 uppercase tracking-wider">Recent Incidents</p>
          <div className="space-y-1.5">
            {svcIncidents.map((e, i) => (
              <IncidentRow key={e.id ?? i} event={e} compact />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Inline incident row — imported here to avoid circular deps */
function IncidentRow({ event, compact }) {
  const resolved = event.reason === 'RESOLVED'
  return (
    <div className={`flex items-start gap-2 text-xs rounded px-2 py-1.5 ${resolved ? 'text-slate-500' : 'text-slate-300'}`}>
      <span className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${resolved ? 'bg-slate-600' : 'bg-amber-500'}`} />
      <div className="min-w-0 flex-1">
        <span className="font-mono text-[10px] text-slate-500 mr-2">{event.ts?.split(' ')[1] ?? ''}</span>
        <span>{event.reason?.replace(/_/g, ' ') ?? 'Event'}</span>
        {event.metric && event.value != null && (
          <span className="ml-2 text-slate-500">({event.metric}: {event.value})</span>
        )}
      </div>
    </div>
  )
}
