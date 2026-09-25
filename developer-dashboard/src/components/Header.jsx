import React, { useState, useRef, useEffect } from 'react'
import {
  Activity, LayoutDashboard, Server, Network,
  AlertCircle, ExternalLink, RefreshCw, FlaskConical,
  Layers, ChevronDown, Wifi, WifiOff, Gauge,
} from 'lucide-react'

const NAV = [
  { id: 'overview',  label: 'Overview',  icon: LayoutDashboard },
  { id: 'services',  label: 'Services',  icon: Server          },
  { id: 'graph',     label: 'Graph',     icon: Network         },
  { id: 'incidents', label: 'Incidents', icon: AlertCircle     },
]

const OBS_TOOLS = [
  {
    key:   'grafana',
    label: 'Grafana',
    sub:   'Dashboards & Alerts',
    url:   'http://localhost:3001',
    color: 'text-orange-400',
    bg:    'hover:bg-orange-950/20',
  },
  {
    key:   'prometheus',
    label: 'Prometheus',
    sub:   'Metrics & Query',
    url:   'http://localhost:9090',
    color: 'text-orange-300',
    bg:    'hover:bg-orange-950/10',
  },
  {
    key:   'jaeger',
    label: 'Jaeger',
    sub:   'Distributed Traces',
    url:   'http://localhost:16686',
    color: 'text-purple-400',
    bg:    'hover:bg-purple-950/20',
  },
]

export default function Header({
  page, setPage,
  apiStatus, lastUpdated, loading,
  onRefresh, autoRefresh, setAutoRefresh,
  riskLevel = 'LOW',
  obsStatus = {},       // data?.observability_status from App.jsx
}) {
  const [obsOpen, setObsOpen] = useState(false)
  const dropRef = useRef(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e) {
      if (dropRef.current && !dropRef.current.contains(e.target)) {
        setObsOpen(false)
      }
    }
    if (obsOpen) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [obsOpen])

  const riskDot = {
    LOW:      'bg-emerald-400',
    MEDIUM:   'bg-amber-400',
    HIGH:     'bg-orange-500',
    CRITICAL: 'bg-red-500 animate-pulse',
  }[riskLevel] ?? 'bg-slate-500'

  const since = lastUpdated
    ? Math.round((Date.now() - lastUpdated.getTime()) / 1000)
    : null

  // Count how many obs tools are connected
  const connectedCount = OBS_TOOLS.filter(t => obsStatus[t.key]?.connected).length
  const allConnected   = connectedCount === OBS_TOOLS.length
  const noneConnected  = connectedCount === 0

  return (
    <header className="sticky top-0 z-50 bg-[#0a0f1e] border-b border-slate-800">
      <div className="max-w-screen-xl mx-auto px-4 sm:px-6">
        <div className="flex items-center h-14 gap-5">

          {/* Brand */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-7 h-7 rounded-md bg-indigo-600 flex items-center justify-center">
              <Activity size={14} className="text-white" />
            </div>
            <div className="leading-none">
              <span className="text-sm font-semibold text-slate-100 tracking-tight">Control Center</span>
              <span className="block text-[10px] text-slate-500 mt-0.5">Cascading Failure Prediction</span>
            </div>
          </div>

          {/* Main nav */}
          <nav className="flex items-center gap-1">
            {NAV.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setPage(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  page === id
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Icon size={12} />
                {label}
              </button>
            ))}

            {/* Observability dropdown */}
            <div className="relative" ref={dropRef}>
              <button
                onClick={() => setObsOpen(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  obsOpen
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Layers size={12} />
                Observability
                {/* dot showing overall connectivity status */}
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  noneConnected ? 'bg-slate-600' : allConnected ? 'bg-emerald-400' : 'bg-amber-400'
                }`} />
                <ChevronDown
                  size={10}
                  className={`transition-transform duration-200 ${obsOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {/* Dropdown panel */}
              {obsOpen && (
                <div className="absolute top-full left-0 mt-1.5 w-64 rounded-xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/40 overflow-hidden z-50">

                  {/* Panel header */}
                  <div className="px-3.5 py-2.5 border-b border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Gauge size={12} className="text-slate-400" />
                      <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                        Observability Stack
                      </span>
                    </div>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                      allConnected
                        ? 'text-emerald-300 bg-emerald-950/50 border-emerald-800'
                        : noneConnected
                          ? 'text-slate-500 bg-slate-800 border-slate-700'
                          : 'text-amber-300 bg-amber-950/50 border-amber-800'
                    }`}>
                      {connectedCount}/{OBS_TOOLS.length} Online
                    </span>
                  </div>

                  {/* Tool rows */}
                  <div className="py-1">
                    {OBS_TOOLS.map(tool => {
                      const s          = obsStatus[tool.key]
                      const connected  = s?.connected ?? false
                      const latency    = s?.latency_ms
                      return (
                        <a
                          key={tool.key}
                          href={tool.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={() => setObsOpen(false)}
                          className={`flex items-center gap-3 px-3.5 py-2.5 transition-colors ${tool.bg}`}
                        >
                          {/* Connection status dot */}
                          <span className={`w-2 h-2 rounded-full shrink-0 ${connected ? 'bg-emerald-400' : 'bg-slate-600'}`} />

                          {/* Tool info */}
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs font-semibold ${tool.color}`}>{tool.label}</p>
                            <p className="text-[10px] text-slate-500">{tool.sub}</p>
                          </div>

                          {/* Latency or status */}
                          <div className="text-right shrink-0">
                            {connected ? (
                              <>
                                {latency != null && (
                                  <p className="text-[10px] font-mono text-slate-400">{latency}ms</p>
                                )}
                                <p className="text-[10px] text-emerald-500">Connected</p>
                              </>
                            ) : (
                              <p className="text-[10px] text-slate-600">Offline</p>
                            )}
                          </div>

                          <ExternalLink size={10} className="text-slate-600 shrink-0" />
                        </a>
                      )
                    })}
                  </div>

                  {/* Footer note */}
                  <div className="px-3.5 py-2 border-t border-slate-800">
                    <p className="text-[10px] text-slate-600">
                      Status probed live every 8s by the ML API.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </nav>

          <div className="flex-1" />

          {/* Risk pill */}
          <div className="hidden sm:flex items-center gap-1.5 text-xs">
            <span className={`w-1.5 h-1.5 rounded-full ${riskDot}`} />
            <span className="text-slate-400">{riskLevel} RISK</span>
          </div>

          <div className="h-5 w-px bg-slate-800" />

          {/* Live / offline indicator */}
          <div className="hidden sm:flex items-center gap-2 text-[11px] text-slate-500">
            {apiStatus === 'UP' && since !== null ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>{autoRefresh ? `Live · ${since}s ago` : `Paused · ${since}s ago`}</span>
              </>
            ) : apiStatus === 'CHECKING' ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                <span>Connecting…</span>
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                <span className="text-red-400">API offline</span>
              </>
            )}
          </div>

          {/* Auto-refresh toggle */}
          <button
            onClick={() => setAutoRefresh(v => !v)}
            title={autoRefresh ? 'Pause auto-refresh' : 'Resume auto-refresh'}
            className={`p-1.5 rounded transition-colors ${
              autoRefresh ? 'text-indigo-400 hover:bg-slate-800' : 'text-slate-600 hover:bg-slate-800 hover:text-slate-400'
            }`}
          >
            <RefreshCw size={13} className={autoRefresh && !loading ? 'animate-spin [animation-duration:4s]' : ''} />
          </button>

          {/* Manual refresh */}
          <button
            onClick={onRefresh}
            disabled={loading}
            title="Refresh now"
            className="p-1.5 rounded text-slate-400 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40 transition-colors"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>

          <div className="h-5 w-px bg-slate-800" />

          {/* Customer app link */}
          <a href="http://localhost:3000" target="_blank" rel="noreferrer" title="Open Customer App"
            className="hidden md:flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
            <ExternalLink size={11} />
            <span>Customer App</span>
          </a>

          {/* Fault Lab link */}
          <a href="http://localhost:4001" target="_blank" rel="noreferrer" title="Open Fault Injection Lab"
            className="hidden md:flex items-center gap-1 text-[11px] text-amber-500/80 hover:text-amber-400 transition-colors">
            <FlaskConical size={11} />
            <span>Fault Lab</span>
          </a>

        </div>
      </div>
    </header>
  )
}
