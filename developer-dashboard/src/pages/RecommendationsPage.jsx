import React, { useState } from 'react'
import {
  Lightbulb, ChevronDown, ChevronUp,
  Terminal, Copy, Check,
  AlertTriangle, AlertCircle, Info, ShieldAlert,
  Zap, Clock, Shield,
  ArrowRight, CheckCircle,
} from 'lucide-react'
import { toLabel } from '../components/ServiceCard'

// ─── Constants ────────────────────────────────────────────────────────────────

const SEVERITY_CFG = {
  CRITICAL: {
    bar:    'bg-red-500',
    badge:  'bg-red-950 text-red-300 border-red-800',
    border: 'border-red-900/50',
    bg:     'bg-red-950/10',
    icon:   <ShieldAlert size={13} className="text-red-400 shrink-0" />,
  },
  HIGH: {
    bar:    'bg-orange-500',
    badge:  'bg-orange-950 text-orange-300 border-orange-800',
    border: 'border-orange-900/40',
    bg:     'bg-orange-950/10',
    icon:   <AlertTriangle size={13} className="text-orange-400 shrink-0" />,
  },
  MEDIUM: {
    bar:    'bg-amber-500',
    badge:  'bg-amber-950 text-amber-300 border-amber-800',
    border: 'border-amber-900/30',
    bg:     'bg-amber-950/10',
    icon:   <AlertCircle size={13} className="text-amber-400 shrink-0" />,
  },
  LOW: {
    bar:    'bg-emerald-500',
    badge:  'bg-emerald-950 text-emerald-300 border-emerald-800',
    border: 'border-emerald-900/30',
    bg:     'bg-emerald-950/10',
    icon:   <Info size={13} className="text-emerald-400 shrink-0" />,
  },
}

const CATEGORY_CFG = {
  IMMEDIATE:   { label: 'Immediate',   color: 'text-red-400',     bg: 'bg-red-950/30 border-red-800/50',     icon: <Zap size={11} className="text-red-400" />   },
  SHORT_TERM:  { label: 'Short-term',  color: 'text-amber-400',   bg: 'bg-amber-950/30 border-amber-800/50', icon: <Clock size={11} className="text-amber-400" /> },
  PREVENTIVE:  { label: 'Preventive',  color: 'text-blue-400',    bg: 'bg-blue-950/30 border-blue-800/50',   icon: <Shield size={11} className="text-blue-400" /> },
}

// ─── Copy-to-clipboard button ─────────────────────────────────────────────────
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  const handle = () => {
    navigator.clipboard?.writeText(text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }
  return (
    <button
      onClick={handle}
      title="Copy command"
      className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-700 transition-colors shrink-0"
    >
      {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
    </button>
  )
}

// ─── Single recommendation card ───────────────────────────────────────────────
function RecCard({ rec, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const sev  = SEVERITY_CFG[rec.severity]  ?? SEVERITY_CFG.LOW
  const cat  = CATEGORY_CFG[rec.category]  ?? CATEGORY_CFG.PREVENTIVE

  return (
    <div className={`rounded-lg border ${sev.border} ${sev.bg} overflow-hidden`}>

      {/* ── Header row (always visible) ── */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-800/30 transition-colors"
      >
        {/* Priority number */}
        <span className="shrink-0 w-5 h-5 rounded-full bg-slate-800 border border-slate-700 text-slate-400
                         text-[10px] font-bold flex items-center justify-center font-mono">
          {rec.priority}
        </span>

        {/* Severity icon */}
        {sev.icon}

        {/* Title */}
        <span className="flex-1 text-xs font-semibold text-slate-200 leading-snug min-w-0">
          {rec.title}
        </span>

        {/* Severity badge */}
        <span className={`shrink-0 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${sev.badge}`}>
          {rec.severity}
        </span>

        {/* Category pill */}
        <span className={`hidden sm:flex shrink-0 items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border ${cat.bg}`}>
          {cat.icon}
          <span className={cat.color}>{cat.label}</span>
        </span>

        {/* Service label */}
        {rec.service && rec.service !== 'system' && (
          <span className="hidden md:block shrink-0 text-[10px] text-slate-500 font-mono">
            {toLabel(rec.service).replace(' Service', '')}
          </span>
        )}

        {/* Chevron */}
        <span className="shrink-0 text-slate-500">
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </span>
      </button>

      {/* ── Expanded body ── */}
      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-slate-800/60">

          {/* Service tag */}
          {rec.service && (
            <p className="text-[11px] text-slate-500">
              Target:&nbsp;
              <span className="text-slate-300 font-medium">
                {rec.service === 'system' ? 'System-wide' : toLabel(rec.service)}
              </span>
            </p>
          )}

          {/* Description */}
          <p className="text-xs text-slate-300 leading-relaxed">{rec.description}</p>

          {/* Shell command */}
          {rec.command && (
            <div className="flex items-start gap-2 rounded-md bg-slate-950 border border-slate-800 px-3 py-2.5">
              <Terminal size={12} className="text-indigo-400 shrink-0 mt-0.5" />
              <code className="flex-1 text-[11px] text-green-400 font-mono break-all leading-relaxed">
                {rec.command}
              </code>
              <CopyButton text={rec.command} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Summary stat tile ────────────────────────────────────────────────────────
function StatTile({ label, value, color = 'text-slate-200', sub }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 space-y-0.5">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-bold font-mono ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-600">{sub}</p>}
    </div>
  )
}

// ─── Root-cause strip ─────────────────────────────────────────────────────────
function RootCauseStrip({ rootCauses, cascadePath }) {
  if (!rootCauses?.length && !cascadePath?.length) return null
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 space-y-3">
      <h2 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
        Root Causes &amp; Cascade Path
      </h2>
      <div className="flex flex-wrap gap-4">

        {/* Root causes */}
        {rootCauses?.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {rootCauses.map((c, i) => (
              <span
                key={i}
                className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full bg-red-950/30 border border-red-900/50 text-red-300"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
                {toLabel(c.service)} — {c.reason?.replace(/_/g, ' ')}
                {c.value != null && (
                  <span className="text-red-500 font-mono ml-1">({c.value})</span>
                )}
              </span>
            ))}
          </div>
        )}

        {/* Cascade path */}
        {cascadePath?.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {cascadePath.map((svc, i) => (
              <React.Fragment key={svc}>
                <span className={`text-[11px] px-2.5 py-1 rounded-full border font-medium ${
                  i === 0
                    ? 'bg-red-950/30 border-red-800/50 text-red-300'
                    : 'bg-slate-800 border-slate-700 text-slate-300'
                }`}>
                  {toLabel(svc)}
                </span>
                {i < cascadePath.length - 1 && (
                  <ArrowRight size={11} className="text-slate-600 shrink-0" />
                )}
              </React.Fragment>
            ))}
          </div>
        )}

      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function RecommendationsPage({ data, loading }) {
  const [categoryFilter, setCategoryFilter] = useState('ALL')
  const [severityFilter, setSeverityFilter] = useState('ALL')
  const [expandAll,      setExpandAll]      = useState(false)

  const recs        = data?.recommendations ?? []
  const rootCauses  = data?.root_cause      ?? []
  const cascadePath = data?.cascade_path    ?? []
  const riskLevel   = data?.risk_level      ?? 'LOW'

  // ── Counts ──
  const total     = recs.length
  const bySev     = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }
  const byCat     = { IMMEDIATE: 0, SHORT_TERM: 0, PREVENTIVE: 0 }
  recs.forEach(r => {
    if (bySev[r.severity]  != null) bySev[r.severity]++
    if (byCat[r.category]  != null) byCat[r.category]++
  })

  // ── Filter ──
  const filtered = recs.filter(r => {
    const matchCat = categoryFilter === 'ALL' || r.category === categoryFilter
    const matchSev = severityFilter === 'ALL' || r.severity === severityFilter
    return matchCat && matchSev
  })

  // ── Group by category for display ──
  const grouped = { IMMEDIATE: [], SHORT_TERM: [], PREVENTIVE: [] }
  filtered.forEach(r => { (grouped[r.category] ?? grouped.PREVENTIVE).push(r) })

  // Severity filter buttons
  const sevOptions = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
  const catOptions = ['ALL', 'IMMEDIATE', 'SHORT_TERM', 'PREVENTIVE']

  const isEmpty = loading && !data

  return (
    <div className="space-y-5">

      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-base font-semibold text-slate-100">Recommendations</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Actionable remediation steps generated from live analysis
            {total > 0 && <> · <span className="text-slate-300">{total} items</span></>}
          </p>
        </div>
        {recs.length > 0 && (
          <button
            onClick={() => setExpandAll(v => !v)}
            className="text-[11px] px-3 py-1.5 rounded border border-slate-700 text-slate-400
                       hover:text-slate-200 hover:border-slate-600 transition-colors shrink-0"
          >
            {expandAll ? 'Collapse all' : 'Expand all'}
          </button>
        )}
      </div>

      {/* ── Summary tiles ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <StatTile label="Total" value={isEmpty ? '—' : total} />
        <StatTile
          label="Critical"
          value={isEmpty ? '—' : bySev.CRITICAL}
          color={bySev.CRITICAL > 0 ? 'text-red-400' : 'text-slate-400'}
        />
        <StatTile
          label="High"
          value={isEmpty ? '—' : bySev.HIGH}
          color={bySev.HIGH > 0 ? 'text-orange-400' : 'text-slate-400'}
        />
        <StatTile
          label="Medium"
          value={isEmpty ? '—' : bySev.MEDIUM}
          color={bySev.MEDIUM > 0 ? 'text-amber-400' : 'text-slate-400'}
        />
        <StatTile
          label="Immediate"
          value={isEmpty ? '—' : byCat.IMMEDIATE}
          color={byCat.IMMEDIATE > 0 ? 'text-red-300' : 'text-slate-400'}
          sub="act now"
        />
        <StatTile
          label="Short-term"
          value={isEmpty ? '—' : byCat.SHORT_TERM}
          color={byCat.SHORT_TERM > 0 ? 'text-amber-300' : 'text-slate-400'}
          sub="this sprint"
        />
        <StatTile
          label="Preventive"
          value={isEmpty ? '—' : byCat.PREVENTIVE}
          color="text-blue-300"
          sub="hardening"
        />
      </div>

      {/* ── Root cause + cascade path strip ── */}
      <RootCauseStrip rootCauses={rootCauses} cascadePath={cascadePath} />

      {/* ── Filters ── */}
      {recs.length > 0 && (
        <div className="flex flex-wrap gap-4 text-[11px]">
          {/* Category filter */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-slate-500 mr-0.5">Category:</span>
            {catOptions.map(opt => {
              const cfg = opt !== 'ALL' ? CATEGORY_CFG[opt] : null
              return (
                <button
                  key={opt}
                  onClick={() => setCategoryFilter(opt)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded border transition-colors ${
                    categoryFilter === opt
                      ? 'border-indigo-700 bg-indigo-900/50 text-indigo-300'
                      : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300'
                  }`}
                >
                  {cfg?.icon}
                  {opt === 'ALL' ? 'All' : opt.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
                  {opt !== 'ALL' && (
                    <span className="text-slate-500 font-mono ml-0.5">
                      {byCat[opt] ?? 0}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Severity filter */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-slate-500 mr-0.5">Severity:</span>
            {sevOptions.map(opt => (
              <button
                key={opt}
                onClick={() => setSeverityFilter(opt)}
                className={`px-2 py-0.5 rounded border transition-colors ${
                  severityFilter === opt
                    ? 'border-indigo-700 bg-indigo-900/50 text-indigo-300'
                    : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300'
                }`}
              >
                {opt === 'ALL' ? 'All' : opt}
                {opt !== 'ALL' && (
                  <span className="text-slate-500 font-mono ml-1">{bySev[opt] ?? 0}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {isEmpty && (
        <div className="space-y-2">
          {[1,2,3,4].map(n => (
            <div key={n} className="h-12 rounded-lg bg-slate-800/50 animate-pulse" />
          ))}
        </div>
      )}

      {/* ── Empty state ── */}
      {!isEmpty && filtered.length === 0 && recs.length === 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-10 text-center space-y-2">
          <CheckCircle size={32} className="text-emerald-500/60 mx-auto" />
          <p className="text-sm text-slate-400">All systems healthy — no recommendations</p>
          <p className="text-xs text-slate-600">
            The analysis engine found no anomalies. Consider running a chaos experiment to validate resilience.
          </p>
        </div>
      )}

      {/* ── No results for current filter ── */}
      {!isEmpty && filtered.length === 0 && recs.length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-6 text-center">
          <p className="text-sm text-slate-500 italic">No recommendations match the selected filters</p>
          <button
            onClick={() => { setCategoryFilter('ALL'); setSeverityFilter('ALL') }}
            className="text-xs text-indigo-400 hover:text-indigo-300 mt-2 underline"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* ── Grouped recommendation list ── */}
      {!isEmpty && filtered.length > 0 && (
        <div className="space-y-6">
          {['IMMEDIATE', 'SHORT_TERM', 'PREVENTIVE'].map(cat => {
            const items = grouped[cat]
            if (!items?.length) return null
            const catCfg = CATEGORY_CFG[cat]
            return (
              <section key={cat} className="space-y-2">

                {/* Category heading */}
                <div className={`flex items-center gap-2 px-3 py-2 rounded-md border text-xs font-semibold w-fit ${catCfg.bg}`}>
                  {catCfg.icon}
                  <span className={catCfg.color}>
                    {catCfg.label} Actions
                  </span>
                  <span className="text-slate-500 font-mono">({items.length})</span>
                </div>

                <div className="space-y-2">
                  {items.map((rec, i) => (
                    <RecCard
                      key={`${cat}-${i}`}
                      rec={rec}
                      defaultOpen={expandAll || (cat === 'IMMEDIATE' && i === 0)}
                    />
                  ))}
                </div>

              </section>
            )
          })}
        </div>
      )}

      {/* ── Footer note ── */}
      {!isEmpty && recs.length > 0 && (
        <p className="text-[11px] text-slate-600 text-center pt-2">
          Recommendations generated by the Random Forest analysis engine based on live Prometheus metrics.
          Auto-refreshed every 8s.
        </p>
      )}

    </div>
  )
}
