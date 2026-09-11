import React, { useState } from 'react'
import ServiceCard, { ServiceDetailPanel } from '../components/ServiceCard'
import { deriveServiceKeys } from '../lib/api'

/**
 * ServicesPage — full per-service metrics view.
 *
 * Left: grid of service cards (all services from live_metrics keys)
 * Right: detail panel when a card is selected
 *
 * Props:
 *   data          object   — full /metrics/live response
 *   metricHistory object   — { [svc]: number[] }
 *   loading       bool
 */
export default function ServicesPage({ data, metricHistory, loading }) {
  const liveMetrics  = data?.live_metrics  ?? {}
  const incidents    = data?.incident_log  ?? []
  const serviceKeys  = deriveServiceKeys(liveMetrics)

  const [selected, setSelected] = useState(null)

  // Auto-select first service if none selected
  const activeKey = selected ?? serviceKeys[0] ?? null

  return (
    <div className="space-y-4">

      {/* Page header */}
      <div>
        <h1 className="text-base font-semibold text-slate-100">Services</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          {serviceKeys.length > 0
            ? `${serviceKeys.length} services · select a card for details`
            : 'Waiting for service data…'}
        </p>
      </div>

      {loading && !serviceKeys.length ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {[1,2,3,4,5,6].map(n => (
            <div key={n} className="h-40 rounded-lg bg-slate-800/50 animate-pulse" />
          ))}
        </div>
      ) : serviceKeys.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-8 text-center">
          <p className="text-sm text-slate-500 italic">No service data available</p>
          <p className="text-xs text-slate-600 mt-1">Ensure the ML API and Prometheus are running</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">

          {/* Service card grid */}
          <div className="lg:col-span-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
            {serviceKeys.map(key => (
              <ServiceCard
                key={key}
                serviceKey={key}
                metrics={liveMetrics[key]}
                history={metricHistory[key] ?? []}
                selected={activeKey === key}
                onClick={() => setSelected(key)}
              />
            ))}
          </div>

          {/* Detail panel */}
          <div className="lg:col-span-2">
            {activeKey ? (
              <ServiceDetailPanel
                serviceKey={activeKey}
                metrics={liveMetrics[activeKey]}
                history={metricHistory[activeKey] ?? []}
                incidents={incidents}
              />
            ) : (
              <div className="rounded-lg border border-slate-800 bg-slate-900 p-8 text-center h-40 flex items-center justify-center">
                <p className="text-xs text-slate-500 italic">Select a service to view details</p>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  )
}
