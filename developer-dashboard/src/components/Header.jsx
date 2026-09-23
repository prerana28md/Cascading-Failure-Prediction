import React from 'react'
import {
  Activity, LayoutDashboard, Server, Network,
  AlertCircle, ExternalLink, RefreshCw, FlaskConical,
} from 'lucide-react'

const NAV = [
  { id: 'overview',  label: 'Overview',  icon: LayoutDashboard },
  { id: 'services',  label: 'Services',  icon: Server          },
  { id: 'graph',     label: 'Graph',     icon: Network         },
  { id: 'incidents', label: 'Incidents', icon: AlertCircle     },
]

/**
 * Header — sticky top navigation bar.
 * Fault injection is a separate app at localhost:4001 — linked externally.
 *
 * Props:
 *   page           string    current page id
 *   setPage        fn        navigate to page
 *   apiStatus      string    'UP' | 'DOWN' | 'CHECKING'
 *   lastUpdated    Date|null
 *   loading        bool
 *   onRefresh      fn
 *   autoRefresh    bool
 *   setAutoRefresh fn
 *   riskLevel      string    'LOW'|'MEDIUM'|'HIGH'|'CRITICAL'
 */
export default function Header({
  page, setPage,
  apiStatus, lastUpdated, loading,
  onRefresh, autoRefresh, setAutoRefresh,
  riskLevel = 'LOW',
}) {
  const riskDot = {
    LOW:      'bg-emerald-400',
    MEDIUM:   'bg-amber-400',
    HIGH:     'bg-orange-500',
    CRITICAL: 'bg-red-500 animate-pulse',
  }[riskLevel] ?? 'bg-slate-500'

  const since = lastUpdated
    ? Math.round((Date.now() - lastUpdated.getTime()) / 1000)
    : null

  return (
    <header className="sticky top-0 z-50 bg-[#0a0f1e] border-b border-slate-800">
      <div className="max-w-screen-xl mx-auto px-4 sm:px-6">
        <div className="flex items-center h-14 gap-5">

          {/* ── Brand ───────────────────────────────────────────── */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-7 h-7 rounded-md bg-indigo-600 flex items-center justify-center">
              <Activity size={14} className="text-white" />
            </div>
            <div className="leading-none">
              <span className="text-sm font-semibold text-slate-100 tracking-tight">
                Control Center
              </span>
              <span className="block text-[10px] text-slate-500 mt-0.5">
                Cascading Failure Prediction
              </span>
            </div>
          </div>

          {/* ── Main nav ────────────────────────────────────────── */}
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
          </nav>

          {/* ── Spacer ──────────────────────────────────────────── */}
          <div className="flex-1" />

          {/* ── Risk pill ───────────────────────────────────────── */}
          <div className="hidden sm:flex items-center gap-1.5 text-xs">
            <span className={`w-1.5 h-1.5 rounded-full ${riskDot}`} />
            <span className="text-slate-400">{riskLevel} RISK</span>
          </div>

          <div className="h-5 w-px bg-slate-800" />

          {/* ── Live / offline indicator ─────────────────────────── */}
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

          {/* ── Auto-refresh toggle ──────────────────────────────── */}
          <button
            onClick={() => setAutoRefresh(v => !v)}
            title={autoRefresh ? 'Pause auto-refresh' : 'Resume auto-refresh'}
            className={`p-1.5 rounded transition-colors ${
              autoRefresh
                ? 'text-indigo-400 hover:bg-slate-800'
                : 'text-slate-600 hover:bg-slate-800 hover:text-slate-400'
            }`}
          >
            <RefreshCw
              size={13}
              className={autoRefresh && !loading ? 'animate-spin [animation-duration:4s]' : ''}
            />
          </button>

          {/* ── Manual refresh ───────────────────────────────────── */}
          <button
            onClick={onRefresh}
            disabled={loading}
            title="Refresh now"
            className="p-1.5 rounded text-slate-400 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40 transition-colors"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>

          <div className="h-5 w-px bg-slate-800" />

          {/* ── Customer app link ────────────────────────────────── */}
          <a
            href="http://localhost:3000"
            target="_blank"
            rel="noreferrer"
            title="Open Customer App"
            className="hidden md:flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
          >
            <ExternalLink size={11} />
            <span>Customer App</span>
          </a>

          {/* ── Fault Lab link ────────────────────────────────────── */}
          <a
            href="http://localhost:4001"
            target="_blank"
            rel="noreferrer"
            title="Open Fault Injection Lab"
            className="hidden md:flex items-center gap-1 text-[11px] text-amber-500/80 hover:text-amber-400 transition-colors"
          >
            <FlaskConical size={11} />
            <span>Fault Lab (:4001)</span>
          </a>

        </div>
      </div>
    </header>
  )
}
