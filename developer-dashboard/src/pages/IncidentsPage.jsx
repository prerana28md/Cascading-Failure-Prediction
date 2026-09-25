import React, { useState } from 'react'
import IncidentFeed from '../components/IncidentFeed'
import { deriveServiceKeys, clearIncidents, resolveIncident } from '../lib/api'
import {
  X, User, FileText, CheckCircle, AlertTriangle, Send,
} from 'lucide-react'

export default function IncidentsPage({ data, loading, onRefresh }) {
  const incidents   = data?.incident_log ?? []
  const [filter,    setFilter]    = useState('ALL')
  const [svcFilter, setSvcFilter] = useState('ALL')
  const [clearing,  setClearing]  = useState(false)

  // Resolution note modal state
  const [noteTarget,    setNoteTarget]    = useState(null)   // the incident being noted
  const [noteName,      setNoteName]      = useState('')
  const [noteText,      setNoteText]      = useState('')
  const [noteSubmitting,setNoteSubmitting]= useState(false)
  const [noteError,     setNoteError]     = useState('')
  const [noteSuccess,   setNoteSuccess]   = useState(false)

  const reasons  = ['ALL', ...new Set(incidents.map(e => e.reason).filter(Boolean))]
  const services = ['ALL', ...new Set(incidents.map(e => e.service).filter(Boolean))]

  const filtered = incidents.filter(e => {
    const matchReason = filter    === 'ALL' || e.reason  === filter
    const matchSvc    = svcFilter === 'ALL' || e.service === svcFilter
    return matchReason && matchSvc
  })

  // Per-service latest entry
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

  // Open the Add Note modal for a resolved incident
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
      // Refresh data so the note appears immediately
      onRefresh()
      // Close after short delay so the success state is visible
      setTimeout(closeNoteModal, 1200)
    }
  }

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-base font-semibold text-slate-100">Incidents</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Rolling log ·{' '}
            {activeCount > 0
              ? <span className="text-amber-400 font-medium">{activeCount} active</span>
              : <span className="text-emerald-400">all resolved</span>}
            {resolvedCount > 0 && <span className="text-slate-600"> · {resolvedCount} resolved</span>}
            <span className="text-slate-600"> · Click &ldquo;Add Note&rdquo; on a resolved incident to log who fixed it and how</span>
          </p>
        </div>
        <button
          onClick={handleClear}
          disabled={clearing || incidents.length === 0}
          className="text-[11px] px-3 py-1.5 rounded border border-slate-700 text-slate-400 hover:text-red-400 hover:border-red-800/50 hover:bg-red-950/20 transition-colors disabled:opacity-40 shrink-0"
        >
          {clearing ? 'Clearing…' : 'Clear log'}
        </button>
      </div>

      {/* Developer note hint banner */}
      <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-lg border border-indigo-900/50 bg-indigo-950/20 text-xs text-indigo-300">
        <FileText size={13} className="text-indigo-400 shrink-0 mt-0.5" />
        <p>
          <span className="font-semibold">Developer notes</span> — on any resolved incident, click{' '}
          <span className="font-mono bg-indigo-900/40 px-1 rounded">+ Add Note</span> to record who resolved it and what action was taken.
          Notes persist and are visible via <span className="font-semibold">View Note</span> on the same row.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 text-[11px]">
        <FilterGroup
          label="Type"
          options={reasons}
          active={filter}
          onChange={setFilter}
          formatLabel={r => r === 'ALL' ? 'All' : r.replace(/_/g, ' ')}
        />
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
          {[1,2,3,4,5].map(n => <div key={n} className="h-12 rounded-md bg-slate-800/50 animate-pulse" />)}
        </div>
      ) : (
        <IncidentFeed
          incidents={filtered}
          loading={false}
          maxItems={0}
          compact={false}
          onAddNote={openNoteModal}
        />
      )}

      {/* ── Add Note Modal ── */}
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
                    {(noteTarget.service ?? '').charAt(0).toUpperCase() + (noteTarget.service ?? '').slice(1)} Service
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

              {/* Success state */}
              {noteSuccess ? (
                <div className="flex flex-col items-center justify-center py-6 gap-3 text-center">
                  <div className="w-12 h-12 rounded-full bg-emerald-950/60 border border-emerald-700 flex items-center justify-center">
                    <CheckCircle size={22} className="text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-emerald-300">Note saved!</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">The resolution note has been attached to this incident.</p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Incident context */}
                  <div className="rounded-lg bg-slate-800/60 border border-slate-700/50 px-3 py-2.5 text-[11px] space-y-1">
                    <p className="text-slate-400">
                      <span className="text-slate-500">Incident: </span>
                      <span className="font-mono text-slate-300">#{noteTarget.id}</span>
                    </p>
                    {noteTarget.metric && noteTarget.value != null && (
                      <p className="text-slate-400 font-mono">
                        {noteTarget.metric}: <span className="text-slate-300">{noteTarget.value}</span>
                      </p>
                    )}
                    <p className="text-slate-500 font-mono text-[10px]">{noteTarget.ts}</p>
                  </div>

                  {/* Developer name */}
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

                  {/* Resolution note */}
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                      <FileText size={11} className="text-slate-500" />
                      What did you do to resolve it? <span className="text-red-400">*</span>
                    </label>
                    <textarea
                      value={noteText}
                      onChange={e => setNoteText(e.target.value)}
                      placeholder="e.g. Restarted the order-service container. Root cause was a MongoDB Atlas connection timeout after the cluster auto-paused due to inactivity."
                      rows={4}
                      maxLength={500}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600/40 transition-colors resize-none leading-relaxed"
                    />
                    <p className="text-[10px] text-slate-600 text-right">{noteText.length}/500</p>
                  </div>

                  {/* Error */}
                  {noteError && (
                    <div className="flex items-start gap-2 text-[11px] text-red-300 bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">
                      <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                      {noteError}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Modal footer */}
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
