import React, { useState } from 'react'
import IncidentFeed from '../components/IncidentFeed'
import { deriveServiceKeys, clearIncidents, resolveIncident, WORKLOAD_SERVICES, WORKLOAD_PORTS, fmtMetric } from '../lib/api'
import { toLabel, SERVICE_COLOR } from '../components/ServiceCard'
import { deriveServiceStatus, SERVICE_STATUS_CFG } from '../components/SystemStatus'
import {
  X, User, FileText, CheckCircle, AlertTriangle, Send,
  Server, Flame, Activity, Trash2, Filter, ChevronRight,
  RefreshCw, Shield, Clock, Zap
} from 'lucide-react'

export default function IncidentsPage({ data, loading, onRefresh, workload = 'omnistore' }) {
  const incidents = data?.incident_log ?? []
  const liveMetrics = data?.live_metrics ?? {}

  const [filter, setFilter] = useState('ALL') // Type filter: ALL, SERVICE_DOWN, HIGH_ERROR_RATE, etc.
  const [selectedService, setSelectedService] = useState('ALL') // Microservice filter: ALL or specific key
  const [clearing, setClearing] = useState(false)

  // Resolution note modal state
  const [noteTarget, setNoteTarget] = useState(null)
  const [noteName, setNoteName] = useState('')
  const [noteText, setNoteText] = useState('')
  const [noteSubmitting, setNoteSubmitting] = useState(false)
  const [noteError, setNoteError] = useState('')
  const [noteSuccess, setNoteSuccess] = useState(false)

  // Workload-specific microservice keys
  const activeWorkloadServices = WORKLOAD_SERVICES[workload] ?? deriveServiceKeys(liveMetrics)

  // Calculate incident counts per microservice
  const incidentCountByService = {}
  const activeCountByService = {}

  activeWorkloadServices.forEach(s => {
    incidentCountByService[s] = 0
    activeCountByService[s] = 0
  })

  // Group latest incident state per microservice
  const latestPerService = {}
  incidents.forEach(e => {
    if (e.service) {
      if (!latestPerService[e.service]) latestPerService[e.service] = e
      if (incidentCountByService[e.service] !== undefined) {
        incidentCountByService[e.service]++
      }
      if (e.reason !== 'RESOLVED' && activeCountByService[e.service] !== undefined) {
        activeCountByService[e.service]++
      }
    }
  })

  const totalActiveIncidents = Object.values(latestPerService).filter(e => e.reason !== 'RESOLVED').length
  const totalResolvedIncidents = Object.values(latestPerService).filter(e => e.reason === 'RESOLVED').length

  // Filter incidents for display
  const filteredIncidents = incidents.filter(e => {
    // Ensure incident belongs to active workload microservices
    const isWorkloadService = activeWorkloadServices.includes(e.service)
    if (!isWorkloadService && e.service) return false

    const matchType = filter === 'ALL' || e.reason === filter
    const matchSvc = selectedService === 'ALL' || e.service === selectedService
    return matchType && matchSvc
  })

  // Reasons present in current filtered set
  const availableReasons = ['ALL', ...new Set(incidents.map(e => e.reason).filter(Boolean))]

  async function handleClear(svcKey = null) {
    const targetLabel = svcKey ? `${toLabel(svcKey)}` : `${workload === 'moviestream' ? 'MovieStream' : 'OmniStore'} workload`
    if (!window.confirm(`Clear incident history for ${targetLabel}?`)) return
    setClearing(true)
    await clearIncidents(workload, svcKey)
    setClearing(false)
    onRefresh()
  }

  function openNoteModal(event) {
    setNoteTarget(event)
    setNoteName('')
    setNoteText('')
    setNoteError('')
    setNoteSuccess(false)
  }

  function closeNoteModal() {
    setNoteTarget(null)
    setNoteName('')
    setNoteText('')
    setNoteError('')
    setNoteSuccess(false)
  }

  async function submitNote() {
    if (!noteName.trim()) { setNoteError('Please enter your name.'); return }
    if (!noteText.trim()) { setNoteError('Please enter a resolution note.'); return }
    setNoteError('')
    setNoteSubmitting(true)
    const { error } = await resolveIncident(noteTarget.id, noteName.trim(), noteText.trim())
    setNoteSubmitting(false)
    if (error) {
      setNoteError(`Failed to save note: ${error}`)
    } else {
      setNoteSuccess(true)
      onRefresh()
      setTimeout(closeNoteModal, 1200)
    }
  }

  // Selected microservice details
  const selMetrics = selectedService !== 'ALL' ? (liveMetrics[selectedService] ?? {}) : null
  const selStatus = selectedService !== 'ALL' ? deriveServiceStatus(selMetrics) : null
  const selCfg = selStatus ? SERVICE_STATUS_CFG[selStatus] : null
  const selPort = selectedService !== 'ALL' ? (WORKLOAD_PORTS[selectedService] ?? '?') : null

  return (
    <div className="space-y-5">

      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold text-slate-100">Microservice Incident Management</h1>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300">
              {workload === 'moviestream' ? 'MovieStream' : 'OmniStore'} Cluster
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage microservice incidents separately ·{' '}
            {totalActiveIncidents > 0
              ? <span className="text-amber-400 font-medium">{totalActiveIncidents} active across services</span>
              : <span className="text-emerald-400">all microservices healthy</span>}
            {totalResolvedIncidents > 0 && <span className="text-slate-600"> · {totalResolvedIncidents} resolved</span>}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {selectedService !== 'ALL' && (
            <button
              onClick={() => handleClear(selectedService)}
              disabled={clearing || incidentCountByService[selectedService] === 0}
              className="text-[11px] px-3 py-1.5 rounded border border-red-900/50 bg-red-950/30 text-red-300 hover:bg-red-900/40 transition-colors disabled:opacity-40 flex items-center gap-1.5"
            >
              <Trash2 size={11} /> Clear {toLabel(selectedService).replace(' Service', '')} Log
            </button>
          )}

          <button
            onClick={() => handleClear(null)}
            disabled={clearing || incidents.length === 0}
            className="text-[11px] px-3 py-1.5 rounded border border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-40 flex items-center gap-1.5"
          >
            <RefreshCw size={11} className={clearing ? 'animate-spin' : ''} /> Clear All Workload Log
          </button>
        </div>
      </div>

      {/* Microservice Separator Navigation Bar */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-2 space-y-2">
        <div className="flex items-center justify-between px-2 pt-1 text-xs">
          <span className="font-semibold text-slate-400 uppercase tracking-wider text-[10px]">
            Select Microservice to Manage Separately
          </span>
          <span className="text-[10px] text-slate-500 font-mono">
            {activeWorkloadServices.length} Microservices Configured
          </span>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {/* ALL Microservices tab */}
          <button
            onClick={() => setSelectedService('ALL')}
            className={`px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all whitespace-nowrap ${
              selectedService === 'ALL'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-950'
                : 'bg-slate-800/80 border border-slate-700/60 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Activity size={13} className={selectedService === 'ALL' ? 'text-white' : 'text-indigo-400'} />
            <span>All Microservices</span>
            <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono ${
              selectedService === 'ALL' ? 'bg-indigo-700 text-white' : 'bg-slate-900 text-slate-400'
            }`}>
              {incidents.length}
            </span>
          </button>

          {/* Individual Microservice Tabs */}
          {activeWorkloadServices.map(key => {
            const m = liveMetrics[key]
            const st = deriveServiceStatus(m)
            const activeInc = activeCountByService[key] || 0
            const totalInc = incidentCountByService[key] || 0
            const isSel = selectedService === key
            const color = SERVICE_COLOR[key] ?? '#6366f1'

            return (
              <button
                key={key}
                onClick={() => setSelectedService(key)}
                className={`px-3 py-2 rounded-lg text-xs flex items-center gap-2 transition-all whitespace-nowrap ${
                  isSel
                    ? 'bg-slate-800 border-2 text-white shadow-md'
                    : 'bg-slate-950/60 border border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
                style={isSel ? { borderColor: color } : {}}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <span className="font-semibold">{toLabel(key).replace(' Service', '')}</span>

                {activeInc > 0 ? (
                  <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-amber-950 border border-amber-800 text-amber-400 animate-pulse">
                    {activeInc} active
                  </span>
                ) : totalInc > 0 ? (
                  <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-slate-900 text-slate-500">
                    {totalInc}
                  </span>
                ) : (
                  <span className="text-[9px] text-emerald-500 font-mono">OK</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Single Microservice Management Banner (When a specific service is selected) */}
      {selectedService !== 'ALL' && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4 space-y-3 animate-in fade-in duration-150">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center border"
                style={{
                  backgroundColor: `${SERVICE_COLOR[selectedService] ?? '#6366f1'}20`,
                  borderColor: `${SERVICE_COLOR[selectedService] ?? '#6366f1'}50`
                }}
              >
                <Server size={16} style={{ color: SERVICE_COLOR[selectedService] ?? '#6366f1' }} />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <span>{toLabel(selectedService)}</span>
                  <span className="text-xs font-mono text-slate-500 font-normal">:{selPort}</span>
                </h2>
                <p className="text-[11px] text-slate-400">
                  Dedicated incident telemetry and log management for {toLabel(selectedService)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {selCfg && (
                <span className={`flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full border ${selCfg.badge || ''}`}>
                  <span className={`w-2 h-2 rounded-full ${selCfg.dot} ${selStatus === 'DOWN' ? 'animate-pulse' : ''}`} />
                  {selCfg.label}
                </span>
              )}
            </div>
          </div>

          {/* Microservice Live KPI Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="bg-slate-950/60 rounded-lg p-2.5 border border-slate-800/80">
              <span className="text-[10px] text-slate-500">Error Rate</span>
              <p className={`font-mono font-bold mt-0.5 ${(selMetrics?.error_rate_5xx ?? 0) > 0.01 ? 'text-red-400' : 'text-slate-200'}`}>
                {fmtMetric(selMetrics?.error_rate_5xx ?? 0, 'rate')}
              </p>
            </div>
            <div className="bg-slate-950/60 rounded-lg p-2.5 border border-slate-800/80">
              <span className="text-[10px] text-slate-500">P99 Latency</span>
              <p className={`font-mono font-bold mt-0.5 ${(selMetrics?.p99_latency_s ?? 0) > 0.5 ? 'text-amber-400' : 'text-slate-200'}`}>
                {fmtMetric(selMetrics?.p99_latency_s ?? 0, 'latency')}
              </p>
            </div>
            <div className="bg-slate-950/60 rounded-lg p-2.5 border border-slate-800/80">
              <span className="text-[10px] text-slate-500">Active Incidents</span>
              <p className={`font-mono font-bold mt-0.5 ${(activeCountByService[selectedService] || 0) > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {activeCountByService[selectedService] || 0}
              </p>
            </div>
            <div className="bg-slate-950/60 rounded-lg p-2.5 border border-slate-800/80">
              <span className="text-[10px] text-slate-500">Total Logged Incidents</span>
              <p className="font-mono font-bold text-slate-200 mt-0.5">
                {incidentCountByService[selectedService] || 0}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Incident Type Filter & Quick Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] bg-slate-900/50 p-2.5 rounded-lg border border-slate-800">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-slate-500 flex items-center gap-1">
            <Filter size={11} /> Filter Event Type:
          </span>
          {availableReasons.map(r => (
            <button
              key={r}
              onClick={() => setFilter(r)}
              className={`px-2.5 py-0.5 rounded border transition-colors ${
                filter === r
                  ? 'border-indigo-700 bg-indigo-900/50 text-indigo-300'
                  : 'border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-300'
              }`}
            >
              {r === 'ALL' ? 'All Types' : r.replace(/_/g, ' ')}
            </button>
          ))}
        </div>

        <span className="text-[11px] text-slate-500">
          Showing <strong className="text-slate-300">{filteredIncidents.length}</strong> incident logs
          {selectedService !== 'ALL' && <span> for <strong className="text-indigo-400">{toLabel(selectedService)}</strong></span>}
        </span>
      </div>

      {/* Incident Feed */}
      {loading && !incidents.length ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map(n => <div key={n} className="h-12 rounded-md bg-slate-800/50 animate-pulse" />)}
        </div>
      ) : (
        <IncidentFeed
          incidents={filteredIncidents}
          loading={false}
          maxItems={0}
          compact={false}
          onAddNote={openNoteModal}
        />
      )}

      {/* Add Resolution Note Modal */}
      {noteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={e => { if (e.target === e.currentTarget) closeNoteModal() }}
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/60 overflow-hidden">

            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-emerald-950/60 border border-emerald-800/50 flex items-center justify-center">
                  <CheckCircle size={13} className="text-emerald-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-100">Add Resolution Note</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {toLabel(noteTarget.service)}
                    {noteTarget.reason && <span className="ml-1 text-slate-600">· {noteTarget.reason.replace(/_/g, ' ')}</span>}
                  </p>
                </div>
              </div>
              <button onClick={closeNoteModal}
                className="p-1.5 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors">
                <X size={15} />
              </button>
            </div>

            {/* Modal body */}
            <div className="px-5 py-4 space-y-4">
              {noteSuccess ? (
                <div className="flex flex-col items-center justify-center py-6 gap-3 text-center">
                  <div className="w-12 h-12 rounded-full bg-emerald-950/60 border border-emerald-700 flex items-center justify-center">
                    <CheckCircle size={22} className="text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-emerald-300">Note saved!</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">The resolution note has been attached to this microservice incident.</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="rounded-lg bg-slate-800/60 border border-slate-700/50 px-3 py-2.5 text-[11px] space-y-1">
                    <p className="text-slate-400">
                      <span className="text-slate-500">Incident ID: </span>
                      <span className="font-mono text-slate-300">#{noteTarget.id}</span>
                      <span className="ml-2 text-indigo-400 font-semibold">{toLabel(noteTarget.service)}</span>
                    </p>
                    {noteTarget.metric && noteTarget.value != null && (
                      <p className="text-slate-400 font-mono">
                        {noteTarget.metric}: <span className="text-slate-300">{noteTarget.value}</span>
                      </p>
                    )}
                    <p className="text-slate-500 font-mono text-[10px]">{noteTarget.ts}</p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                      <User size={11} className="text-slate-500" />
                      Your Name <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={noteName}
                      onChange={e => setNoteName(e.target.value)}
                      placeholder="e.g. Alice Chen"
                      maxLength={60}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600/40 transition-colors"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                      <FileText size={11} className="text-slate-500" />
                      Resolution Steps Taken <span className="text-red-400">*</span>
                    </label>
                    <textarea
                      value={noteText}
                      onChange={e => setNoteText(e.target.value)}
                      placeholder={`e.g. Restarted ${toLabel(noteTarget.service)} container. Verified database connectivity and reset fault status.`}
                      rows={4}
                      maxLength={500}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600/40 transition-colors resize-none leading-relaxed"
                    />
                    <p className="text-[10px] text-slate-600 text-right">{noteText.length}/500</p>
                  </div>

                  {noteError && (
                    <div className="flex items-start gap-2 text-[11px] text-red-300 bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">
                      <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                      {noteError}
                    </div>
                  )}
                </>
              )}
            </div>

            {!noteSuccess && (
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-800 bg-slate-900/60">
                <button onClick={closeNoteModal}
                  className="px-4 py-2 rounded-lg text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={submitNote}
                  disabled={noteSubmitting || !noteName.trim() || !noteText.trim()}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors"
                >
                  <Send size={11} />
                  {noteSubmitting ? 'Saving…' : 'Save Note'}
                </button>
              </div>
            )}

          </div>
        </div>
      )}

    </div>
  )
}
