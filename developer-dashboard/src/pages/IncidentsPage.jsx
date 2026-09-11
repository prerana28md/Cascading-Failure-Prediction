import React, { useState } from 'react'
import IncidentFeed from '../components/IncidentFeed'
import { deriveServiceKeys, clearIncidents } from '../lib/api'

/**
 * IncidentsPage — full incident log.
 *
 * Uses data.incident_log from /metrics/live.
 * No service names hardcoded — filter list is derived from the log itself.
 *
 * Props:
 *   data      object  — full /metrics/live response
 *   loading   bool
 *   onRefresh fn      — trigger a fresh poll
 */
export default function IncidentsPage({ data, loading, onRefresh }) {
  const incidents   = data?.incident_log ?? []
  const [filter,    setFilter]   = useState('ALL')    // 'ALL' | reason key
  const [svcFilter, setSvcFilter] = useState('ALL')   // 'ALL' | service key
  const [clearing,  setClearing]  = useState(false)

  // Derive filter options from the actual log — no hardcoding
  const reasons  = ['ALL', ...new Set(incidents.map(e => e.reason).filter(Boolean))]
  const services = ['ALL', ...new Set(incidents.map(e => e.service).filter(Boolean))]

  const filtered = incidents.filter(e => {
    const matchReason = filter    === 'ALL' || e.reason  === filter
    const matchSvc    = svcFilter === 'ALL' || e.service === svcFilter
    return matchReason && matchSvc
  })

  // Latest-per-service: deque is newest-first, first entry per service = current state
  const latestPerService = {}
  incidents.forEach(e => { if (!latestPerService[e.service]) latestPerService[e.service] = e })
  const activeCount   = Object.values(latestPerService).filter(e => e.reason !== 'RESOLVED').length
  const resolvedCount = Object.values(latestPerService).filter(e => e.reason === 'RESOLVED').length

  async function handleClear() {
    if (!window.confirm('Clear all incident history?')) return
    setClearing(true)
    await clearIncidents()
    setClearing(false)
    onRefresh()
  }

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-base font-semibold text-slate-100">Incidents</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Rolling log · {activeCount > 0
              ? <span className="text-amber-400 font-medium">{activeCount} active</span>
              : <span className="text-emerald-400">all resolved</span>}
            {resolvedCount > 0 && <span className="text-slate-600"> · {resolvedCount} resolved</span>}
          </p>
        </div>
        <button
          onClick={handleClear}
          disabled={clearing || incidents.length === 0}
          className="text-[11px] px-3 py-1.5 rounded border border-slate-700 text-slate-400 hover:text-red-400 hover:border-red-800/50 hover:bg-red-950/20 transition-colors disabled:opacity-40"
        >
          {clearing ? 'Clearing…' : 'Clear log'}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 text-[11px]">
        {/* Status / reason filter */}
        <FilterGroup
          label="Type"
          options={reasons}
          active={filter}
          onChange={setFilter}
          formatLabel={r => r === 'ALL' ? 'All' : r.replace(/_/g, ' ')}
        />
        {/* Service filter — derived from log, not hardcoded */}
        <FilterGroup
          label="Service"
          options={services}
          active={svcFilter}
          onChange={setSvcFilter}
          formatLabel={s => s === 'ALL' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
        />
      </div>

      {/* Feed */}
      {loading && !incidents.length ? (
        <div className="space-y-2">
          {[1,2,3,4,5].map(n => (
            <div key={n} className="h-12 rounded-md bg-slate-800/50 animate-pulse" />
          ))}
        </div>
      ) : (
        <IncidentFeed
          incidents={filtered}
          loading={false}
          maxItems={0}
          compact={false}
        />
      )}

    </div>
  )
}

function FilterGroup({ label, options, active, onChange, formatLabel }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-slate-500 mr-0.5">{label}:</span>
      {options.map(opt => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`px-2 py-0.5 rounded border transition-colors ${
            active === opt
              ? 'border-indigo-700 bg-indigo-900/50 text-indigo-300'
              : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300'
          }`}
        >
          {formatLabel(opt)}
        </button>
      ))}
    </div>
  )
}
