import React from 'react'
import { CheckCircle, AlertTriangle, XCircle, HelpCircle } from 'lucide-react'

const STATUS_CONFIG = {
  HEALTHY:  { icon: CheckCircle,   dot: 'bg-emerald-400', label: 'Healthy',  text: 'text-emerald-400', ring: 'border-emerald-800/50 bg-emerald-950/30' },
  DEGRADED: { icon: AlertTriangle, dot: 'bg-amber-400',   label: 'Degraded', text: 'text-amber-400',   ring: 'border-amber-800/50 bg-amber-950/30' },
  CRITICAL: { icon: XCircle,       dot: 'bg-red-500',     label: 'Critical', text: 'text-red-400',     ring: 'border-red-800/50 bg-red-950/30' },
  UNKNOWN:  { icon: HelpCircle,    dot: 'bg-slate-500',   label: 'Unknown',  text: 'text-slate-400',   ring: 'border-slate-700 bg-slate-900' },
}

/**
 * SystemStatus — compact status badge used on the Overview.
 *
 * Props:
 *   status   'HEALTHY'|'DEGRADED'|'CRITICAL'|'UNKNOWN'
 *   loading  bool
 */
export default function SystemStatus({ status = 'UNKNOWN', loading = false }) {
  if (loading) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-slate-700 bg-slate-900">
        <span className="w-2 h-2 rounded-full bg-slate-700 animate-pulse" />
        <span className="text-xs text-slate-500">Checking…</span>
      </div>
    )
  }

  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.UNKNOWN
  const Icon = cfg.icon

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border ${cfg.ring}`}>
      <span className={`w-2 h-2 rounded-full ${cfg.dot} ${status === 'CRITICAL' ? 'animate-pulse' : ''}`} />
      <span className={`text-xs font-semibold tracking-wide uppercase ${cfg.text}`}>{cfg.label}</span>
    </div>
  )
}

/**
 * deriveSystemStatus — compute overall system health from live API data.
 * Exported so OverviewPage can import it from here directly.
 *
 * @param {object|null} data  full /metrics/live response
 * @returns {'HEALTHY'|'DEGRADED'|'CRITICAL'|'UNKNOWN'}
 */
export function deriveSystemStatus(data) {
  if (!data) return 'UNKNOWN'
  const level = data.risk_level ?? 'LOW'
  const down  = data.system?.num_services_down ?? 0
  const maxErr = data.system?.max_error_rate ?? data.system?.mean_error_rate ?? 0
  if (level === 'CRITICAL' || down >= 2 || maxErr >= 0.35) return 'CRITICAL'
  if (level === 'HIGH'     || down >= 1 || level === 'MEDIUM' || maxErr >= 0.08) return 'DEGRADED'
  return 'HEALTHY'
}

/**
 * StatusRow — one-liner used in headers and summary rows.
 * Returns coloured text + icon inline.
 */
export function StatusRow({ status = 'UNKNOWN' }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.UNKNOWN
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${cfg.text}`}>
      <Icon size={12} />
      {cfg.label}
    </span>
  )
}

/**
 * ServiceStatusDot — tiny coloured dot + label for a single service.
 * Derives status from service_up + error_rate + p99.
 * Noise floor: values below these thresholds are treated as 0 (Prometheus
 * bucket arithmetic produces tiny non-zero floats when no traffic is flowing).
 */
export function deriveServiceStatus(metrics) {
  if (!metrics) return 'UNKNOWN'
  const up  = metrics.service_up ?? 1
  const err = (metrics.error_rate_5xx ?? 0) < 0.001 ? 0 : (metrics.error_rate_5xx ?? 0)
  const p99 = (metrics.p99_latency_s  ?? 0) < 0.005 ? 0 : (metrics.p99_latency_s  ?? 0)
  if (up === 0)                   return 'DOWN'
  if (err > 0.05 || p99 > 1.5)   return 'DEGRADED'
  if (err > 0.01 || p99 > 0.8)   return 'WARNING'
  return 'HEALTHY'
}

export const SERVICE_STATUS_CFG = {
  HEALTHY:  { dot: 'bg-emerald-400', text: 'text-emerald-400', label: 'Healthy'  },
  WARNING:  { dot: 'bg-amber-400',   text: 'text-amber-400',   label: 'Warning'  },
  DEGRADED: { dot: 'bg-orange-500',  text: 'text-orange-400',  label: 'Degraded' },
  DOWN:     { dot: 'bg-red-500',     text: 'text-red-400',     label: 'Down'     },
  UNKNOWN:  { dot: 'bg-slate-500',   text: 'text-slate-400',   label: 'Unknown'  },
}
