import React from 'react'
import { AlertTriangle, XCircle, Clock, CheckCircle, Info } from 'lucide-react'
import { toLabel } from './ServiceCard'

// ── Severity / reason → display config ───────────────────────────────────────
const REASON_CFG = {
  SERVICE_DOWN: {
    icon:  XCircle,
    color: 'text-red-400',
    bg:    'bg-red-950/30 border-red-800/40',
    label: 'Service Down',
    sev:   'CRITICAL',
  },
  HIGH_ERROR_RATE: {
    icon:  AlertTriangle,
    color: 'text-orange-400',
    bg:    'bg-orange-950/20 border-orange-800/30',
    label: 'High Error Rate',
    sev:   'HIGH',
  },
  HIGH_LATENCY: {
    icon:  Clock,
    color: 'text-amber-400',
    bg:    'bg-amber-950/20 border-amber-800/30',
    label: 'High Latency',
    sev:   'WARNING',
  },
  RESOLVED: {
    icon:  CheckCircle,
    color: 'text-slate-500',
    bg:    'border-slate-800/60',
    label: 'Resolved',
    sev:   'INFO',
  },
}

const SEV_BADGE = {
  CRITICAL: 'bg-red-950 text-red-400 border-red-800',
  HIGH:     'bg-orange-950 text-orange-400 border-orange-800',
  WARNING:  'bg-amber-950 text-amber-400 border-amber-800',
  INFO:     'bg-slate-800 text-slate-400 border-slate-700',
}

/**
 * IncidentFeed — renders the incident_log array from /metrics/live.
 *
 * Props:
 *   incidents   array   — data.incident_log
 *   loading     bool
 *   maxItems    number  — cap how many to show (0 = all)
 *   filterService string|null
 *   compact     bool    — shorter row variant
 */
export default function IncidentFeed({
  incidents   = [],
  loading     = false,
  maxItems    = 0,
  filterService = null,
  compact     = false,
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(n => (
          <div key={n} className="h-12 rounded-lg bg-slate-800/50 animate-pulse" />
        ))}
      </div>
    )
  }

  let list = incidents
  if (filterService) list = list.filter(e => e.service === filterService)
  if (maxItems > 0)  list = list.slice(0, maxItems)

  if (!list.length) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-slate-500 text-xs gap-2">
        <CheckCircle size={28} className="text-emerald-600/40" />
        <span>No incidents</span>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {list.map((event, i) => (
        <IncidentRow key={event.id ?? i} event={event} compact={compact} />
      ))}
    </div>
  )
}

export function IncidentRow({ event, compact = false }) {
  const cfg      = REASON_CFG[event.reason] ?? {
    icon:  Info,
    color: 'text-slate-400',
    bg:    'border-slate-800',
    label: event.reason?.replace(/_/g, ' ') ?? 'Event',
    sev:   'INFO',
  }
  const Icon     = cfg.icon
  const resolved = event.reason === 'RESOLVED'
  const badgeCls = SEV_BADGE[cfg.sev] ?? SEV_BADGE.INFO

  return (
    <div className={`flex items-start gap-3 px-3 py-2.5 rounded-md border text-xs transition-all ${cfg.bg} ${resolved ? 'opacity-50' : ''}`}>
      <Icon size={13} className={`${cfg.color} shrink-0 mt-0.5`} />

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {/* Service name — derived from event.service (backend-provided) */}
          <span className="font-medium text-slate-200">
            {toLabel(event.service).replace(' Service', '')}
          </span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border font-mono uppercase ${badgeCls}`}>
            {cfg.label}
          </span>
          {resolved ? (
            <span className="text-[10px] text-emerald-500 font-semibold">RESOLVED</span>
          ) : (
            <span className="text-[10px] text-amber-500 font-semibold">ACTIVE</span>
          )}
        </div>

        {!compact && event.metric && event.value != null && (
          <p className="text-slate-500 mt-0.5 font-mono">
            {event.metric}: <span className="text-slate-300">{event.value}</span>
          </p>
        )}
      </div>

      <div className="text-right shrink-0 min-w-[72px]">
        <p className="text-[10px] font-mono text-slate-500">{event.ts?.split(' ')[1] ?? ''}</p>
        {!compact && <p className="text-[10px] font-mono text-slate-600">{event.ts?.split(' ')[0] ?? ''}</p>}
      </div>
    </div>
  )
}
