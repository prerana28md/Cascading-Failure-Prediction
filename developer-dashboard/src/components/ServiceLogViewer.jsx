import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  Terminal, Search, RefreshCw, X, Copy, Check, Filter,
  AlertTriangle, CheckCircle, Clock, Info, ScrollText,
  WrapText, ChevronDown, Play, Pause, Server
} from 'lucide-react'
import { fetchServiceLogs, WORKLOAD_SERVICES, WORKLOAD_PORTS } from '../lib/api'
import { toLabel, SERVICE_COLOR } from './ServiceCard'

// ── Log Level Detection ──────────────────────────────────────────────────────
export function detectLogLevel(line = '') {
  if (/\b(error|fatal|critical|exception|traceback|failed|failure|500|502|503|504)\b/i.test(line)) {
    return 'error'
  }
  if (/\b(warn|warning|degraded|slow|404|400|401|403)\b/i.test(line)) {
    return 'warning'
  }
  return 'info'
}

/**
 * ServiceLogViewer
 *
 * Embeddable terminal-style service log viewer.
 *
 * Props:
 *   serviceKey         string    e.g. 'order'
 *   workload           string    'omnistore' | 'moviestream'
 *   availableServices  string[]  optional list of services to switch between
 *   onSelectService    fn|null   (serviceKey) => void
 *   embedded           bool      if true, renders inside a panel without outer wrapper card
 *   heightClass        string    e.g. 'max-h-[480px]' or 'h-[400px]'
 */
export default function ServiceLogViewer({
  serviceKey,
  workload = 'omnistore',
  availableServices = [],
  onSelectService = null,
  embedded = false,
  heightClass = 'max-h-[420px]',
}) {
  const [logs, setLogs] = useState([])
  const [source, setSource] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [level, setLevel] = useState('all') // 'all' | 'error' | 'warning' | 'info'
  const [limit, setLimit] = useState(100)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [wordWrap, setWordWrap] = useState(true)
  const [copied, setCopied] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const logContainerRef = useRef(null)

  const activeWorkloadServices = availableServices.length > 0
    ? availableServices
    : (WORKLOAD_SERVICES[workload] ?? WORKLOAD_SERVICES.omnistore)

  const loadLogs = useCallback(async () => {
    if (!serviceKey) return
    setLoading(true)
    const { data, error: requestError } = await fetchServiceLogs(serviceKey, workload, limit)
    setLoading(false)

    if (requestError) {
      setError(requestError)
      return
    }

    setError(null)
    setLogs(data?.logs ?? [])
    setSource(data?.source ?? null)
    setUpdatedAt(new Date())
  }, [serviceKey, workload, limit])

  useEffect(() => {
    loadLogs()
  }, [loadLogs])

  useEffect(() => {
    if (!autoRefresh) return
    const timer = setInterval(loadLogs, 6000)
    return () => clearInterval(timer)
  }, [loadLogs, autoRefresh])

  // Filter logs based on search and level
  const visibleLogs = logs.filter(({ line = '' }) => {
    const matchesSearch = !search || line.toLowerCase().includes(search.toLowerCase())
    const detected = detectLogLevel(line)
    const matchesLevel = level === 'all'
      || (level === 'error' && detected === 'error')
      || (level === 'warning' && detected === 'warning')
      || (level === 'info' && detected === 'info')
    return matchesSearch && matchesLevel
  })

  // Copy logs handler
  async function handleCopy() {
    if (!visibleLogs.length) return
    const text = visibleLogs.map((entry, idx) => {
      const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : 'LOCAL'
      return `[${ts}] ${entry.line}`
    }).join('\n')

    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const el = document.createElement('textarea')
      el.value = text
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const port = WORKLOAD_PORTS[serviceKey] ?? '?'
  const color = SERVICE_COLOR[serviceKey] ?? '#6366f1'

  return (
    <div className={`space-y-3 ${embedded ? '' : 'rounded-xl border border-slate-800 bg-slate-900/95 p-4'}`}>

      {/* ── Top Bar: Service Info, Selector & Actions ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2.5 flex-wrap">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center border"
            style={{ backgroundColor: `${color}20`, borderColor: `${color}50` }}
          >
            <Terminal size={15} style={{ color }} />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                {toLabel(serviceKey)}
              </span>
              <span className="text-[10px] font-mono text-slate-500">:{port}</span>

              {/* Service Switcher Dropdown (if onSelectService provided) */}
              {onSelectService && activeWorkloadServices.length > 1 && (
                <div className="relative inline-block ml-1">
                  <select
                    value={serviceKey}
                    onChange={e => onSelectService(e.target.value)}
                    className="bg-slate-800/90 text-slate-300 text-[11px] font-medium border border-slate-700 rounded-md px-2 py-0.5 pr-6 cursor-pointer hover:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 appearance-none"
                  >
                    {activeWorkloadServices.map(svc => (
                      <option key={svc} value={svc}>
                        Switch to: {toLabel(svc).replace(' Service', '')} (:{WORKLOAD_PORTS[svc] ?? '?'})
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={11} className="absolute right-1.5 top-1.5 text-slate-400 pointer-events-none" />
                </div>
              )}
            </div>

            <p className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1.5">
              <span>{source === 'loki' ? 'Loki Observability Log' : source === 'local-file' ? 'Local Service Log' : 'Log Feed'}</span>
              <span>·</span>
              <span>{updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : 'Live'}</span>
            </p>
          </div>
        </div>

        {/* Global actions: Refresh, Auto-refresh toggle, Copy */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setAutoRefresh(v => !v)}
            title={autoRefresh ? 'Disable auto-refresh (6s)' : 'Enable auto-refresh (6s)'}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono border transition-colors ${
              autoRefresh
                ? 'border-emerald-800/60 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/40'
                : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-300 hover:border-slate-700'
            }`}
          >
            {autoRefresh ? <Pause size={10} className="animate-pulse text-emerald-400" /> : <Play size={10} />}
            <span>Auto {autoRefresh ? 'ON' : 'OFF'}</span>
          </button>

          <button
            onClick={loadLogs}
            disabled={loading}
            title="Refresh logs now"
            className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800/70 px-2 py-1 text-[10px] text-slate-300 hover:border-indigo-600 hover:text-slate-100 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>

          <button
            onClick={handleCopy}
            disabled={!visibleLogs.length}
            title="Copy visible log lines to clipboard"
            className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800/70 px-2 py-1 text-[10px] text-slate-300 hover:border-indigo-600 hover:text-slate-100 disabled:opacity-40 transition-colors"
          >
            {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
            <span>{copied ? 'Copied!' : 'Copy'}</span>
          </button>
        </div>
      </div>

      {/* ── Filter Bar: Search, Level, Limit, Wrap ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-950/50 p-2 rounded-lg border border-slate-800/80 text-[11px]">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <div className="relative flex-1">
            <Search size={11} className="absolute left-2.5 top-2 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={`Filter ${toLabel(serviceKey)} logs...`}
              className="w-full bg-slate-900 border border-slate-700/80 rounded pl-7 pr-6 py-1 text-slate-200 placeholder-slate-600 text-[11px] focus:outline-none focus:border-indigo-600"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-1.5 top-1.5 text-slate-500 hover:text-slate-300"
              >
                <X size={11} />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Level Filter Buttons */}
          <div className="flex items-center rounded border border-slate-800 bg-slate-900 p-0.5 text-[10px]">
            <button
              onClick={() => setLevel('all')}
              className={`px-2 py-0.5 rounded transition-colors ${
                level === 'all' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setLevel('error')}
              className={`px-2 py-0.5 rounded transition-colors ${
                level === 'error' ? 'bg-red-950 border border-red-800 text-red-300 font-semibold' : 'text-slate-400 hover:text-red-400'
              }`}
            >
              Errors
            </button>
            <button
              onClick={() => setLevel('warning')}
              className={`px-2 py-0.5 rounded transition-colors ${
                level === 'warning' ? 'bg-amber-950 border border-amber-800 text-amber-300 font-semibold' : 'text-slate-400 hover:text-amber-400'
              }`}
            >
              Warnings
            </button>
            <button
              onClick={() => setLevel('info')}
              className={`px-2 py-0.5 rounded transition-colors ${
                level === 'info' ? 'bg-slate-800 text-slate-200 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Info
            </button>
          </div>

          {/* Line Limit Selector */}
          <select
            value={limit}
            onChange={e => setLimit(Number(e.target.value))}
            className="rounded border border-slate-800 bg-slate-900 px-2 py-1 text-[10px] text-slate-400 focus:outline-none hover:border-slate-700"
          >
            <option value={50}>50 lines</option>
            <option value={100}>100 lines</option>
            <option value={200}>200 lines</option>
            <option value={500}>500 lines</option>
          </select>

          {/* Wrap Toggle */}
          <button
            onClick={() => setWordWrap(v => !v)}
            title={wordWrap ? 'Switch to horizontal scroll (no wrap)' : 'Switch to word wrap'}
            className={`p-1 rounded border transition-colors ${
              wordWrap
                ? 'border-indigo-700/60 bg-indigo-950/40 text-indigo-300'
                : 'border-slate-800 bg-slate-900 text-slate-500 hover:text-slate-300'
            }`}
          >
            <WrapText size={12} />
          </button>
        </div>
      </div>

      {/* ── Main Terminal Display ── */}
      {error ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-900/50 bg-amber-950/20 p-4 text-xs text-amber-300">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-400" />
          <div className="space-y-1">
            <p className="font-semibold text-amber-200">Unable to load logs for {toLabel(serviceKey)}</p>
            <p className="text-[11px] text-amber-400/90 leading-relaxed">{error}</p>
            <p className="text-[10px] text-slate-400 mt-1">
              {workload === 'moviestream'
                ? 'Ensure the MovieStream microservices are running and producing logs to local files.'
                : 'Ensure Grafana Loki is running on :3100 (part of the observability stack) or start with start_all.bat.'}
            </p>
          </div>
        </div>
      ) : loading && !logs.length ? (
        <div className="rounded-lg border border-slate-800 bg-slate-950 p-8 text-center space-y-2">
          <RefreshCw size={18} className="mx-auto animate-spin text-indigo-400" />
          <p className="text-xs text-slate-400 font-mono">Fetching latest logs for {toLabel(serviceKey)}...</p>
        </div>
      ) : visibleLogs.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-8 text-center space-y-2 text-xs text-slate-500">
          <ScrollText size={22} className="mx-auto text-slate-600" />
          <p className="font-medium text-slate-400">
            {logs.length > 0 ? 'No log lines match current filters' : `No logs recorded for ${toLabel(serviceKey)}`}
          </p>
          <p className="text-[11px] text-slate-600">
            {logs.length > 0 ? 'Try clearing the search or changing the level filter' : 'Logs will appear as requests flow through this microservice'}
          </p>
        </div>
      ) : (
        <div
          ref={logContainerRef}
          className={`${heightClass} overflow-auto rounded-lg border border-slate-800 bg-slate-950 font-mono text-[11px] shadow-inner`}
        >
          {/* Header sticky strip */}
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800/80 bg-slate-900/95 px-3 py-1.5 text-[10px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>Showing {visibleLogs.length} of {logs.length} lines</span>
              {search && <span className="text-indigo-400 font-semibold">(filtered)</span>}
            </span>
            <span className="text-slate-500 font-mono">Newest first</span>
          </div>

          {/* Log Lines */}
          <div className="divide-y divide-slate-900/80">
            {visibleLogs.map((entry, index) => {
              const detected = detectLogLevel(entry.line)
              const isErr = detected === 'error'
              const isWarn = detected === 'warning'

              const timeStr = entry.timestamp
                ? new Date(entry.timestamp).toLocaleTimeString()
                : 'LOCAL'

              return (
                <div
                  key={`${entry.timestamp ?? 'l'}-${index}`}
                  className={`flex items-start gap-2.5 px-3 py-1.5 transition-colors hover:bg-slate-900/50 ${
                    isErr
                      ? 'bg-red-950/15 text-red-300 border-l-2 border-l-red-500'
                      : isWarn
                      ? 'bg-amber-950/15 text-amber-300 border-l-2 border-l-amber-500'
                      : 'text-slate-300'
                  }`}
                >
                  {/* Line index & Timestamp */}
                  <div className="shrink-0 flex items-center gap-2 select-none text-[10px] text-slate-600 font-mono pt-0.5">
                    <span className="w-6 text-right opacity-60">{index + 1}</span>
                    <span className="text-slate-500">{timeStr}</span>
                    <span
                      className={`px-1 py-0.2 rounded text-[8px] font-bold uppercase tracking-wider ${
                        isErr
                          ? 'bg-red-950 border border-red-800 text-red-400'
                          : isWarn
                          ? 'bg-amber-950 border border-amber-800 text-amber-400'
                          : 'bg-slate-900 border border-slate-800 text-slate-500'
                      }`}
                    >
                      {isErr ? 'ERR' : isWarn ? 'WRN' : 'INF'}
                    </span>
                  </div>

                  {/* Line content */}
                  <div className={`flex-1 min-w-0 ${wordWrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre overflow-x-auto'}`}>
                    <HighlightMatches text={entry.line} query={search} isErr={isErr} isWarn={isWarn} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      <div className="flex flex-wrap items-center justify-between text-[10px] text-slate-500 pt-1">
        <span>Target: <code className="text-slate-400">{serviceKey}-service</code> on port <code className="text-slate-400">{port}</code></span>
        <span>Auto-refreshes when active · Scroll inside terminal for full history</span>
      </div>

    </div>
  )
}

/** Helper component to highlight search keyword matches in log lines */
function HighlightMatches({ text, query, isErr, isWarn }) {
  if (!query || !query.trim()) {
    return <span>{text}</span>
  }

  const parts = []
  const qLower = query.toLowerCase()
  let remaining = text

  while (remaining.length > 0) {
    const idx = remaining.toLowerCase().indexOf(qLower)
    if (idx === -1) {
      parts.push({ text: remaining, match: false })
      break
    }
    if (idx > 0) {
      parts.push({ text: remaining.slice(0, idx), match: false })
    }
    parts.push({ text: remaining.slice(idx, idx + query.length), match: true })
    remaining = remaining.slice(idx + query.length)
  }

  return (
    <span>
      {parts.map((p, i) =>
        p.match ? (
          <mark key={i} className="bg-yellow-400/30 text-yellow-200 px-0.5 rounded font-bold">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </span>
  )
}
