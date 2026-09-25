import React, { useState } from 'react'
import { AlertTriangle, XCircle, Clock, CheckCircle, Info, ChevronDown, ChevronUp, User, FileText } from 'lucide-react'
import { toLabel } from './ServiceCard'

// ── Config ────────────────────────────────────────────────────────────────────
const REASON_CFG = {
  SERVICE_DOWN: {
    icon: XCircle, color: 'text-red-400',
    bg: 'bg-red-950/30 border-red-800/40', label: 'Service Down', sev: 'CRITICAL',
  },
  HIGH_ERROR_RATE: {
    icon: AlertTriangle, color: 'text-orange-400',
    bg: 'bg-orange-950/20 border-orange-800/30', label: 'High Error Rate', sev: 'HIGH',
  },
  HIGH_LATENCY: {
    icon: Clock, color: 'text-amber-400',
    bg: 'bg-amber-950/20 border-amber-800/30', label: 'High Latency', sev: 'WARNING',
  },
  RESOLVED: {
    icon: CheckCircle, color: 'text-slate-500',
    bg: 'border-slate-800/60', label: 'Resolved', sev: 'INFO',
  },
}

const SEV_BADGE = {
  CRITICAL: 'bg-red-950 text-red-400 border-red-800',
  HIGH:     'bg-orange-950 text-orange-400 border-orange-800',
  WARNING:  'bg-amber-950 text-amber-400 border-amber-800',
  INFO:     'bg-slate-800 text-slate-400 border-slate-700',
}

/**
 * IncidentFeed
 *
 * Props:
 *   incidents      array
 *   loading        bool
 *   maxItems       number   0 = all
 *   filterService  string|null
 *   compact        bool     shorter variant (no metric detail, no resolution note)
 *   onAddNote      fn|null  (event) => void  — if provided, shows "Add Note" on resolved rows
 */
export default function IncidentFeed({
  incidents     = [],
  loading       = false,
  maxItems      = 0,
  filterService = null,
  compact       = false,
  onAddNote     = null,
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(n => <div key={n} className="h-12 rounded-lg bg-slate-800/50 animate-pulse" />)}
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
        <IncidentRow
          key={event.id ?? i}
          event={event}
          compact={compact}
          onAddNote={onAddNote}
        />
      ))}
    </div>
  )
}

// ── Single incident row ───────────────────────────────────────────────────────
export function IncidentRow({ event, compact = false, onAddNote = null }) {
  const [noteOpen, setNoteOpen] = useState(false)

  const cfg      = REASON_CFG[event.reason] ?? {
    icon: Info, color: 'text-slate-400', bg: 'border-slate-800',
    label: event.reason?.replace(/_/g, ' ') ?? 'Event', sev: 'INFO',
  }
  const Icon     = cfg.icon
  const resolved = event.reason === 'RESOLVED'
  const badgeCls = SEV_BADGE[cfg.sev] ?? SEV_BADGE.INFO
  const hasNote  = !!(event.resolution_note || event.resolved_by)

  return (
    <div className={`rounded-md border text-xs transition-all ${cfg.bg} ${resolved ? 'opacity-70' : ''}`}>

      {/* ── Main row ── */}
      <div className="flex items-start gap-3 px-3 py-2.5">
        <Icon size={13} className={`${cfg.color} shrink-0 mt-0.5`} />

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-medium text-slate-200">
              {toLabel(event.service).replace(' Service', '')}
            </span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border font-mono uppercase ${badgeCls}`}>
              {cfg.label}
            </span>
            {resolved
              ? <span className="text-[10px] text-emerald-500 font-semibold">RESOLVED</span>
              : <span className="text-[10px] text-amber-500 font-semibold animate-pulse">● ACTIVE</span>
            }
          </div>

          {!compact && event.metric && event.value != null && (
            <p className="text-slate-500 mt-0.5 font-mono">
              {event.metric}: <span className="text-slate-300">{event.value}</span>
            </p>
          )}

          {/* Resolution note preview (compact: show resolver name only) */}
          {resolved && hasNote && compact && (
            <p className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1">
              <User size={9} />
              <span>Resolved by <span className="text-slate-300">{event.resolved_by}</span></span>
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* View Note toggle — shown on resolved rows that have a note */}
          {resolved && hasNote && !compact && (
            <button
              onClick={() => setNoteOpen(v => !v)}
              className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-emerald-800/50 bg-emerald-950/30 text-emerald-400 hover:bg-emerald-950/50 transition-colors"
            >
              <FileText size={9} />
              {noteOpen ? 'Hide' : 'View Note'}
              {noteOpen
                ? <ChevronUp size={9} />
                : <ChevronDown size={9} />
              }
            </button>
          )}

          {/* Add Note button — only on resolved rows without a note, when handler provided */}
          {resolved && !hasNote && onAddNote && !compact && (
            <button
              onClick={() => onAddNote(event)}
              className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-slate-700 text-slate-400 hover:border-indigo-700 hover:text-indigo-300 hover:bg-indigo-950/20 transition-colors"
            >
              + Add Note
            </button>
          )}

          <div className="text-right min-w-[72px]">
            <p className="text-[10px] font-mono text-slate-500">{event.ts?.split(' ')[1] ?? ''}</p>
            {!compact && <p className="text-[10px] font-mono text-slate-600">{event.ts?.split(' ')[0] ?? ''}</p>}
          </div>
        </div>
      </div>

      {/* ── Resolution note expand panel ── */}
      {noteOpen && resolved && hasNote && (
        <div className="mx-3 mb-3 rounded-lg border border-emerald-900/40 bg-emerald-950/15 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-emerald-900/30 bg-emerald-950/20">
            <CheckCircle size={11} className="text-emerald-400 shrink-0" />
            <p className="text-[10px] font-bold text-emerald-300 uppercase tracking-wider">Resolution Note</p>
          </div>
          <div className="px-3 py-2.5 space-y-2">
            {event.resolved_by && (
              <div className="flex items-center gap-2 text-[11px]">
                <User size={11} className="text-slate-500 shrink-0" />
                <span className="text-slate-400">Resolved by</span>
                <span className="font-semibold text-slate-200">{event.resolved_by}</span>
                {event.resolution_ts && (
                  <span className="text-slate-600 font-mono ml-auto">{event.resolution_ts.split(' ')[1] ?? ''}</span>
                )}
              </div>
            )}
            {event.resolution_note && (
              <p className="text-[11px] text-slate-300 leading-relaxed bg-slate-900/60 rounded px-2.5 py-2 border border-slate-800">
                {event.resolution_note}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
