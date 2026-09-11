import React from 'react'

/**
 * FeatureImportance — compact RF feature importance widget.
 *
 * Driven entirely by data.feature_importances from /metrics/live.
 * No feature names are hardcoded — we display whatever the model returns.
 *
 * Props:
 *   importances  array   [{ feature: string, importance: number }, ...]
 *   maxItems     number  how many to show (default 8)
 *   loading      bool
 */
export default function FeatureImportance({ importances = [], maxItems = 8, loading = false }) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[1,2,3,4].map(n => (
          <div key={n} className="h-5 rounded bg-slate-800/60 animate-pulse" />
        ))}
      </div>
    )
  }

  if (!importances?.length) {
    return <p className="text-xs text-slate-500 italic">No feature data available</p>
  }

  // Sort desc, take top N
  const sorted = [...importances]
    .sort((a, b) => b.importance - a.importance)
    .slice(0, maxItems)

  const max = sorted[0]?.importance ?? 1

  return (
    <div className="space-y-2">
      {sorted.map((item, i) => {
        const pct    = (item.importance / max) * 100
        const label  = item.feature
          .replace(/_/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase())
        const valPct = (item.importance * 100).toFixed(1)

        return (
          <div key={i} className="space-y-0.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400 truncate pr-3">{label}</span>
              <span className="text-slate-300 font-mono shrink-0">{valPct}%</span>
            </div>
            <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
