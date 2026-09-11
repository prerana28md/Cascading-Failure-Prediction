import React, { useState, useEffect, useCallback } from 'react'
import { FlaskConical, CheckCircle, AlertTriangle, RefreshCw, X, RotateCcw } from 'lucide-react'
import { toLabel } from '../components/ServiceCard'
import {
  GATEWAY,
  injectFault,
  resetFault,
  resetAllFaults,
  fetchAllFaultStatuses,
  deriveServiceKeys,
} from '../lib/api'

/**
 * FaultLabPage — standalone fault injection lab.
 *
 * Service list is derived from live_metrics keys — never hardcoded.
 * Fault types come from the backend enum: NONE | LATENCY | ERROR | DOWN.
 *
 * Props:
 *   liveMetrics  object  — data.live_metrics from /metrics/live (for service list)
 *   loading      bool
 */

// Fault types as supported by the backend FaultState enum
const FAULT_TYPES = [
  { key: 'LATENCY', label: 'Latency Spike',  desc: 'Inject artificial delay into all responses'    },
  { key: 'ERROR',   label: 'Error Storm',    desc: 'Force HTTP 500 on all requests'                },
  { key: 'DOWN',    label: 'Service Down',   desc: 'Return HTTP 503 immediately — full outage'     },
]

export default function FaultLabPage({ liveMetrics = {}, loading = false }) {
  const serviceKeys = deriveServiceKeys(liveMetrics)

  // Per-service fault state from backend (source of truth)
  const [faultStates,  setFaultStates]  = useState({})   // { [svc]: { fault, delayMs } | null }
  const [fetchingStatus, setFetchingStatus] = useState(false)

  // Form state
  const [selService, setSelService] = useState('')
  const [selFault,   setSelFault]   = useState('LATENCY')
  const [delayMs,    setDelayMs]    = useState(2000)

  // Feedback
  const [feedback,   setFeedback]   = useState(null)   // { ok, message, service, fault, delayMs }
  const [injecting,  setInjecting]  = useState(false)
  const [resetting,  setResetting]  = useState(null)   // serviceKey | 'ALL' | null
  const [confirmAll, setConfirmAll] = useState(false)

  // Auto-select first service when list arrives
  useEffect(() => {
    if (serviceKeys.length && !selService) {
      setSelService(serviceKeys[0])
    }
  }, [serviceKeys.join(',')])

  // Fetch real fault status from backend
  const refreshStatuses = useCallback(async () => {
    if (!serviceKeys.length) return
    setFetchingStatus(true)
    const states = await fetchAllFaultStatuses(serviceKeys)
    setFaultStates(states)
    setFetchingStatus(false)
  }, [serviceKeys.join(',')])

  useEffect(() => {
    refreshStatuses()
  }, [refreshStatuses])

  // Inject fault
  async function handleInject() {
    if (!selService) return
    setInjecting(true)
    setFeedback(null)
    const { data, error } = await injectFault(selService, selFault, selFault === 'LATENCY' ? delayMs : 0)
    if (!error && data) {
      setFeedback({ ok: true,  service: selService, fault: selFault, delayMs: selFault === 'LATENCY' ? delayMs : 0 })
    } else {
      setFeedback({ ok: false, message: error ?? 'Unknown error' })
    }
    setInjecting(false)
    await refreshStatuses()
  }

  // Reset one service
  async function handleReset(svc) {
    setResetting(svc)
    setFeedback(null)
    await resetFault(svc)
    setResetting(null)
    await refreshStatuses()
  }

  // Reset all — requires confirmation
  async function handleResetAll() {
    if (!confirmAll) { setConfirmAll(true); return }
    setConfirmAll(false)
    setResetting('ALL')
    setFeedback(null)
    await resetAllFaults(serviceKeys)
    setResetting(null)
    await refreshStatuses()
  }

  const activeFaults = serviceKeys.filter(k => {
    const s = faultStates[k]
    return s?.fault && s.fault !== 'NONE'
  })

  return (
    <div className="space-y-6 max-w-3xl">

      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FlaskConical size={16} className="text-amber-400" />
            <h1 className="text-base font-semibold text-slate-100">Fault Injection Lab</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">Controlled failure testing for service resilience.</p>
          <span className="inline-block mt-2 text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 rounded border border-amber-800/50 bg-amber-950/30 text-amber-500">
            Test / Engineering Environment
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={refreshStatuses}
            disabled={fetchingStatus}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-slate-700 text-slate-400 hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={11} className={fetchingStatus ? 'animate-spin' : ''} />
            Refresh
          </button>

          {confirmAll ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-amber-400">Confirm reset all?</span>
              <button
                onClick={handleResetAll}
                className="text-xs px-3 py-1.5 rounded border border-red-700 bg-red-950/40 text-red-300 hover:bg-red-900/50 transition-colors"
              >
                Yes, reset all
              </button>
              <button
                onClick={() => setConfirmAll(false)}
                className="text-xs px-2 py-1.5 rounded border border-slate-700 text-slate-400 hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={handleResetAll}
              disabled={resetting === 'ALL' || activeFaults.length === 0}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-slate-700 text-slate-400 hover:border-emerald-700/50 hover:text-emerald-400 hover:bg-emerald-950/20 transition-colors disabled:opacity-40"
            >
              <RotateCcw size={11} />
              Reset All
            </button>
          )}
        </div>
      </div>

      {/* Active faults summary */}
      {activeFaults.length > 0 && (
        <div className="rounded-md border border-amber-800/40 bg-amber-950/20 px-4 py-3">
          <p className="text-xs font-semibold text-amber-400 mb-2">
            {activeFaults.length} active fault{activeFaults.length > 1 ? 's' : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            {activeFaults.map(k => {
              const s = faultStates[k]
              return (
                <div key={k} className="flex items-center gap-2 text-[11px] bg-slate-900 border border-slate-700 rounded px-2.5 py-1">
                  <span className="text-slate-300 font-medium">{toLabel(k).replace(' Service','')}</span>
                  <span className="font-mono text-amber-400 font-bold">{s?.fault}</span>
                  {s?.delayMs > 0 && <span className="text-slate-500">{s.delayMs}ms</span>}
                  <button
                    onClick={() => handleReset(k)}
                    disabled={resetting === k}
                    className="ml-1 text-slate-500 hover:text-slate-200 transition-colors"
                  >
                    <X size={11} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Main form + service cards side by side ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

        {/* Inject form */}
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-5 space-y-4">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Inject Fault</h2>

          {/* Service selector */}
          <div className="space-y-1.5">
            <label className="text-[11px] text-slate-500 uppercase tracking-wider">Service</label>
            {loading && !serviceKeys.length ? (
              <div className="h-9 bg-slate-800 rounded animate-pulse" />
            ) : (
              <select
                value={selService}
                onChange={e => setSelService(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded px-3 py-2 focus:outline-none focus:border-indigo-600 transition-colors"
              >
                {serviceKeys.length === 0
                  ? <option value="">No services available</option>
                  : serviceKeys.map(k => (
                    <option key={k} value={k}>{toLabel(k)}</option>
                  ))
                }
              </select>
            )}
          </div>

          {/* Fault type */}
          <div className="space-y-1.5">
            <label className="text-[11px] text-slate-500 uppercase tracking-wider">Fault Type</label>
            <div className="space-y-1.5">
              {FAULT_TYPES.map(ft => (
                <button
                  key={ft.key}
                  onClick={() => setSelFault(ft.key)}
                  className={`w-full flex items-start gap-3 px-3 py-2.5 rounded border text-xs text-left transition-colors ${
                    selFault === ft.key
                      ? 'border-amber-700/60 bg-amber-950/30 text-slate-100'
                      : 'border-slate-700 bg-slate-800/40 text-slate-400 hover:border-slate-600 hover:text-slate-300'
                  }`}
                >
                  <div className="flex-1">
                    <p className="font-semibold">{ft.label}</p>
                    <p className="text-[10px] mt-0.5 text-slate-500">{ft.desc}</p>
                  </div>
                  {selFault === ft.key && (
                    <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0 mt-1" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Delay slider — only for LATENCY */}
          {selFault === 'LATENCY' && (
            <div className="space-y-1.5">
              <label className="text-[11px] text-slate-500 uppercase tracking-wider">
                Delay — <span className="text-slate-200 font-mono">{delayMs} ms</span>
              </label>
              <input
                type="range"
                min={100}
                max={10000}
                step={100}
                value={delayMs}
                onChange={e => setDelayMs(+e.target.value)}
                className="w-full accent-amber-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-600">
                <span>100 ms</span><span>10 s</span>
              </div>
            </div>
          )}

          {/* Inject button */}
          <button
            onClick={handleInject}
            disabled={injecting || !selService}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded bg-amber-700 hover:bg-amber-600 text-white text-sm font-semibold transition-colors disabled:opacity-50"
          >
            <FlaskConical size={14} />
            {injecting ? 'Injecting…' : `Inject → ${selService ? toLabel(selService) : '—'}`}
          </button>

          {/* Feedback */}
          {feedback && (
            <div className={`flex items-start gap-2 text-xs rounded-md border p-3 ${
              feedback.ok
                ? 'border-emerald-800/50 bg-emerald-950/30 text-emerald-300'
                : 'border-red-800/50 bg-red-950/30 text-red-300'
            }`}>
              {feedback.ok
                ? <CheckCircle size={13} className="shrink-0 mt-0.5" />
                : <AlertTriangle size={13} className="shrink-0 mt-0.5" />}
              <div>
                {feedback.ok ? (
                  <>
                    <p className="font-semibold">Fault injected successfully</p>
                    <p className="text-[11px] mt-0.5 opacity-80">
                      {toLabel(feedback.service)} · {feedback.fault}
                      {feedback.delayMs > 0 && ` · ${feedback.delayMs} ms`}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold">Injection failed</p>
                    <p className="text-[11px] mt-0.5 opacity-80">{feedback.message}</p>
                    <p className="text-[10px] mt-1 opacity-60">Gateway: {GATEWAY}</p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Per-service status cards */}
        <div className="space-y-2">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Service Status</h2>
          {serviceKeys.length === 0 ? (
            <p className="text-xs text-slate-500 italic">No services available</p>
          ) : (
            serviceKeys.map(k => (
              <ServiceFaultCard
                key={k}
                serviceKey={k}
                state={faultStates[k]}
                fetching={fetchingStatus}
                resetting={resetting === k}
                onReset={() => handleReset(k)}
              />
            ))
          )}
        </div>

      </div>

      {/* How it works */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 text-xs text-slate-500 space-y-1">
        <p className="font-semibold text-slate-400">How fault injection works</p>
        <p>
          Faults are applied at the Spring MVC interceptor layer inside each service.
          A <code className="bg-slate-800 px-1 rounded text-indigo-300">FaultInterceptor</code> checks{' '}
          <code className="bg-slate-800 px-1 rounded text-indigo-300">FaultState</code> before every request.
          The <code className="bg-slate-800 px-1 rounded text-indigo-300">/fault/**</code> endpoints are excluded from fault application.
        </p>
        <p className="pt-0.5">
          Routed through the API Gateway at{' '}
          <code className="bg-slate-800 px-1 rounded text-indigo-300">{'POST /fault/{service}-service/configure'}</code>.
        </p>
      </div>

    </div>
  )
}

/**
 * ServiceFaultCard — shows the current fault state for one service.
 * Fetched from the backend — not maintained in React state.
 */
function ServiceFaultCard({ serviceKey, state, fetching, resetting, onReset }) {
  const hasFault = state?.fault && state.fault !== 'NONE'
  const label    = toLabel(serviceKey).replace(' Service', '')

  const faultColor = {
    DOWN:    'text-red-400',
    ERROR:   'text-orange-400',
    LATENCY: 'text-amber-400',
    NONE:    'text-emerald-400',
  }[state?.fault] ?? 'text-slate-400'

  return (
    <div className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-md border text-xs transition-colors ${
      hasFault ? 'border-amber-800/40 bg-amber-950/10' : 'border-slate-800 bg-slate-900'
    }`}>
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${hasFault ? 'bg-amber-500' : 'bg-emerald-400'}`} />
        <span className="text-slate-300 font-medium">{label}</span>
      </div>

      <div className="flex items-center gap-3">
        {fetching ? (
          <span className="text-slate-600 font-mono text-[10px] animate-pulse">…</span>
        ) : (
          <span className={`font-mono font-semibold text-[11px] ${faultColor}`}>
            {state?.fault ?? 'UNKNOWN'}
            {state?.delayMs > 0 && <span className="ml-1 text-slate-500">{state.delayMs}ms</span>}
          </span>
        )}

        {hasFault && (
          <button
            onClick={onReset}
            disabled={resetting}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-40"
          >
            <RotateCcw size={9} />
            {resetting ? 'Resetting…' : 'Reset'}
          </button>
        )}
      </div>
    </div>
  )
}
