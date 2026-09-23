import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  FlaskConical, RefreshCw, RotateCcw, X, CheckCircle,
  AlertTriangle, Wifi, WifiOff, Clock, Zap, ServerCrash,
  ExternalLink, ChevronDown, ChevronUp, Store,
} from 'lucide-react'
import {
  KNOWN_SERVICES, FAULT_TYPES, FAULT_COLORS,
  checkGatewayHealth, getAllFaultStatuses,
  injectFault, resetFault, resetAllFaults,
  serviceLabel,
} from './lib/gateway'

// ── Auto-refresh interval for fault statuses (ms) ────────────────────────────
const STATUS_POLL_MS = 5000

// ── Colour helpers (no dynamic Tailwind class construction) ──────────────────
const FAULT_TYPE_STYLES = {
  LATENCY: {
    ring:   'border-amber-700/50 bg-amber-950/20',
    btn:    'bg-amber-700 hover:bg-amber-600',
    badge:  'bg-amber-950 text-amber-300 border-amber-800',
    icon:   Clock,
    color:  'text-amber-400',
  },
  ERROR: {
    ring:   'border-orange-700/50 bg-orange-950/20',
    btn:    'bg-orange-700 hover:bg-orange-600',
    badge:  'bg-orange-950 text-orange-300 border-orange-800',
    icon:   Zap,
    color:  'text-orange-400',
  },
  DOWN: {
    ring:   'border-red-700/50 bg-red-950/20',
    btn:    'bg-red-700 hover:bg-red-600',
    badge:  'bg-red-950 text-red-300 border-red-800',
    icon:   ServerCrash,
    color:  'text-red-400',
  },
}

// ── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  // Gateway connectivity
  const [gwHealth,      setGwHealth]      = useState({ up: false, status: 'CHECKING', error: null })
  const [checkingGw,    setCheckingGw]    = useState(true)

  // Per-service fault states — fetched from Gateway, never invented
  const [faultStates,   setFaultStates]   = useState({})   // { [key]: { fault, delayMs, error } }
  const [loadingStates, setLoadingStates] = useState(false)
  const [autoRefresh,   setAutoRefresh]   = useState(true)
  const [lastFetched,   setLastFetched]   = useState(null)
  const pollRef = useRef(null)

  // Inject form
  const [selService, setSelService] = useState(KNOWN_SERVICES[0])
  const [selFault,   setSelFault]   = useState('LATENCY')
  const [delayMs,    setDelayMs]    = useState(2000)

  // Operation feedback
  const [feedback,   setFeedback]   = useState(null)   // { ok, title, detail } | null
  const [injecting,  setInjecting]  = useState(false)
  const [resetting,  setResetting]  = useState(null)   // key | 'ALL' | null
  const [confirmAll, setConfirmAll] = useState(false)

  // ── Gateway health check ──────────────────────────────────────────────────
  const pingGateway = useCallback(async () => {
    setCheckingGw(true)
    const result = await checkGatewayHealth()
    setGwHealth(result)
    setCheckingGw(false)
    return result.up
  }, [])

  // ── Fetch all fault statuses ──────────────────────────────────────────────
  const refreshStatuses = useCallback(async () => {
    setLoadingStates(true)
    const states = await getAllFaultStatuses(KNOWN_SERVICES)
    setFaultStates(states)
    setLastFetched(new Date())
    setLoadingStates(false)
  }, [])

  // ── Boot: health check then load statuses ─────────────────────────────────
  useEffect(() => {
    pingGateway().then(up => { if (up) refreshStatuses() })
  }, [])

  // ── Auto-refresh polling ──────────────────────────────────────────────────
  useEffect(() => {
    if (!autoRefresh) { clearInterval(pollRef.current); return }
    pollRef.current = setInterval(async () => {
      const up = (await checkGatewayHealth()).up
      setGwHealth(prev => ({ ...prev, up }))
      if (up) refreshStatuses()
    }, STATUS_POLL_MS)
    return () => clearInterval(pollRef.current)
  }, [autoRefresh, refreshStatuses])

  // Clear feedback after 6 s
  useEffect(() => {
    if (!feedback) return
    const t = setTimeout(() => setFeedback(null), 6000)
    return () => clearTimeout(t)
  }, [feedback])

  // ── Actions ───────────────────────────────────────────────────────────────
  async function handleInject() {
    setInjecting(true)
    setFeedback(null)
    const { data, error } = await injectFault(
      selService, selFault, selFault === 'LATENCY' ? delayMs : 0
    )
    if (!error && data) {
      setFeedback({
        ok:     true,
        title:  'Fault injected',
        detail: `${serviceLabel(selService)} · ${selFault}${selFault === 'LATENCY' ? ` · ${delayMs} ms` : ''}`,
      })
    } else {
      setFeedback({
        ok:     false,
        title:  'Injection failed',
        detail: error ?? 'Unknown error — check the gateway is running',
      })
    }
    setInjecting(false)
    await refreshStatuses()
  }

  async function handleReset(key) {
    setResetting(key)
    setFeedback(null)
    const { error } = await resetFault(key)
    if (error) {
      setFeedback({ ok: false, title: 'Reset failed', detail: error })
    }
    setResetting(null)
    await refreshStatuses()
  }

  async function handleResetAll() {
    if (!confirmAll) { setConfirmAll(true); return }
    setConfirmAll(false)
    setResetting('ALL')
    setFeedback(null)
    const results = await resetAllFaults(KNOWN_SERVICES)
    const failed  = results.filter(r => !r.ok)
    if (failed.length) {
      setFeedback({ ok: false, title: 'Some resets failed', detail: failed.map(r => r.key).join(', ') })
    } else {
      setFeedback({ ok: true, title: 'All faults cleared', detail: `${KNOWN_SERVICES.length} services reset` })
    }
    setResetting(null)
    await refreshStatuses()
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const activeFaults = KNOWN_SERVICES.filter(k => {
    const s = faultStates[k]
    return s?.fault && s.fault !== 'NONE'
  })

  const since = lastFetched
    ? Math.round((Date.now() - lastFetched.getTime()) / 1000)
    : null

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#080e1a] text-slate-100 font-sans">

      {/* ── Header ── */}
      <header className="sticky top-0 z-50 bg-[#080e1a] border-b border-slate-800">
        <div className="max-w-5xl mx-auto px-5 h-14 flex items-center gap-4">

          {/* Brand */}
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-amber-700/80 flex items-center justify-center">
              <FlaskConical size={14} className="text-white" />
            </div>
            <div className="leading-none">
              <p className="text-sm font-semibold text-slate-100">Fault Injection Lab</p>
              <p className="text-[10px] text-slate-500 mt-0.5">OmniStore · Engineering Tool</p>
            </div>
          </div>

          <div className="h-5 w-px bg-slate-800" />

          {/* Environment badge */}
          <span className="text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 rounded border border-amber-800/50 bg-amber-950/40 text-amber-500">
            Test Environment
          </span>

          <div className="flex-1" />

          {/* Gateway status */}
          <div className="flex items-center gap-1.5 text-[11px]">
            {checkingGw ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-slate-600 animate-pulse" />
                <span className="text-slate-500">Connecting…</span>
              </>
            ) : gwHealth.up ? (
              <>
                <Wifi size={11} className="text-emerald-400" />
                <span className="text-emerald-400">Gateway</span>
                {since !== null && (
                  <span className="text-slate-600">· {since}s ago</span>
                )}
              </>
            ) : (
              <>
                <WifiOff size={11} className="text-red-400" />
                <span className="text-red-400">Gateway unreachable</span>
              </>
            )}
          </div>

          {/* Auto-refresh toggle */}
          <button
            onClick={() => setAutoRefresh(v => !v)}
            title={autoRefresh ? 'Pause auto-refresh' : 'Resume auto-refresh'}
            className={`p-1.5 rounded border transition-colors ${
              autoRefresh
                ? 'border-slate-700 text-indigo-400 hover:bg-slate-800'
                : 'border-slate-700 text-slate-600 hover:bg-slate-800'
            }`}
          >
            <RefreshCw size={12} className={autoRefresh && !loadingStates ? 'animate-spin [animation-duration:3s]' : ''} />
          </button>

          {/* Manual refresh */}
          <button
            onClick={() => { pingGateway().then(up => { if (up) refreshStatuses() }) }}
            disabled={loadingStates || checkingGw}
            className="p-1.5 rounded border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40 transition-colors"
          >
            <RefreshCw size={12} className={loadingStates ? 'animate-spin' : ''} />
          </button>

          {/* Link to customer store */}
          <a
            href="http://localhost:3000"
            target="_blank"
            rel="noreferrer"
            className="hidden sm:flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            <Store size={10} />
            OmniStore (:3000)
          </a>

          {/* Link to developer dashboard */}
          <a
            href="http://localhost:4000"
            target="_blank"
            rel="noreferrer"
            className="hidden sm:flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
          >
            <ExternalLink size={10} />
            Dashboard (:4000)
          </a>

        </div>
      </header>

      {/* ── Gateway offline banner ── */}
      {!gwHealth.up && !checkingGw && (
        <div className="bg-red-950/50 border-b border-red-900/40 px-5 py-2.5 flex items-center justify-between text-xs">
          <span className="text-red-300">
            <span className="font-semibold">API Gateway unreachable.</span>
            {' '}Start the Docker stack first:{' '}
            <code className="bg-red-900/50 px-1 rounded">docker-compose up -d</code>
          </span>
          <button
            onClick={() => pingGateway().then(up => { if (up) refreshStatuses() })}
            className="text-red-300 hover:text-red-100 underline ml-4 shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Main ── */}
      <main className="max-w-5xl mx-auto px-5 py-7 space-y-7">

        {/* Active faults banner */}
        {activeFaults.length > 0 && (
          <ActiveFaultsBanner
            keys={activeFaults}
            faultStates={faultStates}
            resetting={resetting}
            confirmAll={confirmAll}
            onReset={handleReset}
            onResetAll={handleResetAll}
            onCancelConfirm={() => setConfirmAll(false)}
          />
        )}

        {/* Feedback toast */}
        {feedback && (
          <FeedbackToast feedback={feedback} onDismiss={() => setFeedback(null)} />
        )}

        {/* ── Two-column layout ── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">

          {/* Left — Inject form (2 cols) */}
          <div className="lg:col-span-2">
            <InjectForm
              services={KNOWN_SERVICES}
              selService={selService}
              setSelService={setSelService}
              selFault={selFault}
              setSelFault={setSelFault}
              delayMs={delayMs}
              setDelayMs={setDelayMs}
              onInject={handleInject}
              injecting={injecting}
              gatewayUp={gwHealth.up}
            />
          </div>

          {/* Right — Service status cards (3 cols) */}
          <div className="lg:col-span-3 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Service Status
              </p>
              {loadingStates && (
                <RefreshCw size={11} className="text-slate-600 animate-spin" />
              )}
            </div>

            {KNOWN_SERVICES.map(key => (
              <ServiceStatusCard
                key={key}
                serviceKey={key}
                state={faultStates[key]}
                loading={loadingStates && !faultStates[key]}
                resetting={resetting === key || resetting === 'ALL'}
                onReset={() => handleReset(key)}
              />
            ))}
          </div>

        </div>

        {/* How it works — collapsed by default */}
        <HowItWorks />

      </main>

      <footer className="border-t border-slate-800/60 py-3 text-center text-[11px] text-slate-600">
        Fault Injection Lab · Gateway: <code className="text-slate-500">localhost:8080</code>
        · Developer Dashboard: <a href="http://localhost:4000" className="text-slate-500 hover:text-slate-400" target="_blank" rel="noreferrer">localhost:4000</a>
        · Customer App: <a href="http://localhost:3000" className="text-slate-500 hover:text-slate-400" target="_blank" rel="noreferrer">localhost:3000</a>
      </footer>

    </div>
  )
}

// ── Active faults banner ──────────────────────────────────────────────────────
function ActiveFaultsBanner({ keys, faultStates, resetting, confirmAll, onReset, onResetAll, onCancelConfirm }) {
  return (
    <div className="rounded-lg border border-amber-800/40 bg-amber-950/15 px-4 py-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <AlertTriangle size={13} className="text-amber-400 shrink-0" />
          <p className="text-xs font-semibold text-amber-300">
            {keys.length} active fault{keys.length > 1 ? 's' : ''}
          </p>
        </div>

        {confirmAll ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-amber-400">Reset all services?</span>
            <button
              onClick={onResetAll}
              disabled={resetting === 'ALL'}
              className="text-xs px-3 py-1 rounded border border-red-700 bg-red-950/50 text-red-300 hover:bg-red-900/50 transition-colors disabled:opacity-50"
            >
              {resetting === 'ALL' ? 'Resetting…' : 'Confirm'}
            </button>
            <button
              onClick={onCancelConfirm}
              className="text-xs px-2 py-1 rounded border border-slate-700 text-slate-400 hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={onResetAll}
            disabled={resetting === 'ALL'}
            className="flex items-center gap-1.5 text-xs px-3 py-1 rounded border border-slate-700 text-slate-400 hover:border-emerald-700/50 hover:text-emerald-400 hover:bg-emerald-950/20 transition-colors disabled:opacity-40"
          >
            <RotateCcw size={11} />
            Reset All
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        {keys.map(k => {
          const s   = faultStates[k]
          const cfg = FAULT_COLORS[s?.fault] ?? FAULT_COLORS.UNKNOWN
          return (
            <span key={k} className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded border font-medium ${cfg.badge}`}>
              {serviceLabel(k).replace(' Service', '')}
              <span className="font-bold">{s?.fault}</span>
              {s?.delayMs > 0 && <span className="opacity-70">{s.delayMs}ms</span>}
              <button
                onClick={() => onReset(k)}
                disabled={resetting === k || resetting === 'ALL'}
                className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity disabled:opacity-30"
              >
                <X size={10} />
              </button>
            </span>
          )
        })}
      </div>
    </div>
  )
}

// ── Feedback toast ────────────────────────────────────────────────────────────
function FeedbackToast({ feedback, onDismiss }) {
  const ok = feedback.ok
  return (
    <div className={`flex items-start gap-3 px-4 py-3 rounded-lg border text-sm ${
      ok
        ? 'border-emerald-800/50 bg-emerald-950/30 text-emerald-200'
        : 'border-red-800/50    bg-red-950/30    text-red-200'
    }`}>
      {ok
        ? <CheckCircle  size={15} className="text-emerald-400 shrink-0 mt-0.5" />
        : <AlertTriangle size={15} className="text-red-400    shrink-0 mt-0.5" />}
      <div className="flex-1 min-w-0">
        <p className="font-semibold">{feedback.title}</p>
        {feedback.detail && (
          <p className="text-xs mt-0.5 opacity-80">{feedback.detail}</p>
        )}
      </div>
      <button onClick={onDismiss} className="opacity-50 hover:opacity-100 transition-opacity shrink-0">
        <X size={14} />
      </button>
    </div>
  )
}

// ── Inject form ───────────────────────────────────────────────────────────────
function InjectForm({
  services, selService, setSelService,
  selFault, setSelFault,
  delayMs, setDelayMs,
  onInject, injecting, gatewayUp,
}) {
  const activeStyle = FAULT_TYPE_STYLES[selFault]

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-5 space-y-5">

      <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
        Inject Fault
      </h2>

      {/* Service selector */}
      <div className="space-y-1.5">
        <label className="text-[11px] text-slate-500 uppercase tracking-wider block">
          Target Service
        </label>
        <select
          value={selService}
          onChange={e => setSelService(e.target.value)}
          className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-md px-3 py-2 focus:outline-none focus:border-indigo-500 transition-colors"
        >
          {services.map(k => (
            <option key={k} value={k}>{serviceLabel(k)}</option>
          ))}
        </select>
      </div>

      {/* Fault type */}
      <div className="space-y-1.5">
        <label className="text-[11px] text-slate-500 uppercase tracking-wider block">
          Fault Type
        </label>
        <div className="space-y-2">
          {FAULT_TYPES.map(ft => {
            const style  = FAULT_TYPE_STYLES[ft.key]
            const Icon   = style.icon
            const active = selFault === ft.key
            return (
              <button
                key={ft.key}
                onClick={() => setSelFault(ft.key)}
                className={`w-full flex items-start gap-3 px-3 py-3 rounded-md border text-xs text-left transition-all ${
                  active
                    ? style.ring + ' text-slate-100'
                    : 'border-slate-700 bg-slate-800/30 text-slate-400 hover:border-slate-600 hover:text-slate-200'
                }`}
              >
                <Icon size={14} className={`shrink-0 mt-0.5 ${active ? style.color : 'text-slate-600'}`} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">{ft.label}</p>
                  <p className="text-[10px] mt-0.5 text-slate-500 leading-relaxed">{ft.desc}</p>
                </div>
                {active && <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1 ${style.color.replace('text-', 'bg-')}`} />}
              </button>
            )
          })}
        </div>
      </div>

      {/* Delay — only for LATENCY */}
      {selFault === 'LATENCY' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[11px] text-slate-500 uppercase tracking-wider">Delay</label>
            <span className="text-sm font-mono font-semibold text-amber-300">{delayMs} ms</span>
          </div>
          <input
            type="range" min={100} max={10000} step={100}
            value={delayMs}
            onChange={e => setDelayMs(+e.target.value)}
            className="w-full accent-amber-500 cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-600">
            <span>100 ms</span>
            <span>10 s</span>
          </div>
        </div>
      )}

      {/* Inject button */}
      <button
        onClick={onInject}
        disabled={injecting || !gatewayUp}
        className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-md text-white text-sm font-semibold transition-colors disabled:opacity-50 ${
          activeStyle?.btn ?? 'bg-slate-700 hover:bg-slate-600'
        }`}
      >
        <FlaskConical size={14} />
        {injecting
          ? 'Injecting…'
          : !gatewayUp
            ? 'Gateway offline'
            : `Inject ${selFault} → ${serviceLabel(selService).replace(' Service', '')}`
        }
      </button>

    </div>
  )
}

// ── Per-service status card ───────────────────────────────────────────────────
function ServiceStatusCard({ serviceKey, state, loading, resetting, onReset }) {
  const fault    = state?.fault ?? (loading ? null : 'UNKNOWN')
  const hasFault = fault && fault !== 'NONE' && fault !== 'UNKNOWN'
  const cfg      = FAULT_COLORS[fault] ?? FAULT_COLORS.UNKNOWN
  const hasError = !!state?.error

  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-3 rounded-md border transition-colors text-sm ${
      hasError  ? 'border-slate-700 bg-slate-900/50 opacity-60' :
      hasFault  ? 'border-amber-800/40 bg-amber-950/10'          :
                  'border-slate-800   bg-slate-900'
    }`}>

      {/* Left: name + status */}
      <div className="flex items-center gap-2.5 min-w-0">
        {loading ? (
          <span className="w-1.5 h-1.5 rounded-full bg-slate-700 animate-pulse" />
        ) : (
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot} ${hasFault ? 'animate-pulse' : ''}`} />
        )}
        <span className="text-slate-200 font-medium truncate">
          {serviceLabel(serviceKey).replace(' Service', '')}
        </span>
      </div>

      {/* Right: fault badge + delay + reset */}
      <div className="flex items-center gap-2.5 shrink-0">
        {loading ? (
          <span className="text-[11px] text-slate-600 font-mono animate-pulse">loading…</span>
        ) : hasError ? (
          <span className="text-[11px] text-red-400 font-mono" title={state.error}>unreachable</span>
        ) : (
          <>
            <span className={`text-[11px] font-bold font-mono px-2 py-0.5 rounded border ${cfg.badge}`}>
              {fault ?? '—'}
            </span>
            {state?.delayMs > 0 && (
              <span className="text-[11px] text-slate-500 font-mono">{state.delayMs}ms</span>
            )}
          </>
        )}

        {hasFault && !hasError && (
          <button
            onClick={onReset}
            disabled={resetting}
            className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-100 hover:bg-slate-800 hover:border-slate-600 transition-colors disabled:opacity-40"
          >
            <RotateCcw size={10} />
            {resetting ? '…' : 'Reset'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Collapsible "How it works" section ────────────────────────────────────────
function HowItWorks() {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-xs text-slate-400 hover:text-slate-200 transition-colors"
      >
        <span className="font-semibold uppercase tracking-wider">How fault injection works</span>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {open && (
        <div className="px-4 pb-4 text-xs text-slate-500 space-y-3 border-t border-slate-800 pt-3">

          <p>
            Each Spring Boot service contains a{' '}
            <code className="bg-slate-800 px-1 rounded text-indigo-300">FaultInterceptor</code>{' '}
            that runs before every incoming request. It reads the current{' '}
            <code className="bg-slate-800 px-1 rounded text-indigo-300">FaultState</code>{' '}
            singleton and applies the configured behaviour.
          </p>

          <div className="space-y-2">
            {[
              { fault: 'LATENCY', desc: 'Calls Thread.sleep(delayMs) before continuing. Simulates slow database, network congestion, or a downstream bottleneck.' },
              { fault: 'ERROR',   desc: 'Returns HTTP 500 with a JSON error body immediately. Triggers circuit breaker and error-rate anomaly detection.' },
              { fault: 'DOWN',    desc: 'Returns HTTP 503 immediately for every request. Simulates a complete service crash or container restart.' },
            ].map(({ fault, desc }) => {
              const cfg = FAULT_COLORS[fault]
              return (
                <div key={fault} className="flex gap-3">
                  <span className={`text-[11px] font-bold font-mono px-1.5 py-0.5 rounded border shrink-0 ${cfg.badge}`}>
                    {fault}
                  </span>
                  <p>{desc}</p>
                </div>
              )
            })}
          </div>

          <p>
            The <code className="bg-slate-800 px-1 rounded text-indigo-300">/fault/**</code> endpoints
            are excluded from fault application — so you can always reset a broken service.
          </p>

          <div className="font-mono text-[11px] bg-slate-950 border border-slate-800 rounded p-3 space-y-1">
            <p className="text-slate-600"># Inject via gateway</p>
            <p className="text-slate-300">POST /fault/{'{'}<span className="text-indigo-300">service</span>{'}'}-service/configure</p>
            <p className="text-slate-300">{'{'} "fault": "DOWN" {'}'}</p>
            <p className="text-slate-600 mt-2"># Reset</p>
            <p className="text-slate-300">POST /fault/{'{'}<span className="text-indigo-300">service</span>{'}'}-service/reset</p>
            <p className="text-slate-600 mt-2"># Check status</p>
            <p className="text-slate-300">GET  /fault/{'{'}<span className="text-indigo-300">service</span>{'}'}-service/status</p>
          </div>

        </div>
      )}
    </div>
  )
}
