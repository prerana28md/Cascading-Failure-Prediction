import React, { useState, useEffect, useCallback, useRef } from 'react'

import Header        from './components/Header'
import OverviewPage  from './pages/OverviewPage'
import ServicesPage  from './pages/ServicesPage'
import GraphPage     from './pages/GraphPage'
import IncidentsPage from './pages/IncidentsPage'

import { fetchLiveMetrics, deriveServiceKeys, POLL_MS } from './lib/api'

// Keep up to 120 data points in the frontend (~16 min at 8s interval).
// This is INDEPENDENT of the backend HISTORY deque — it never gets flushed
// on recovery, so charts always show continuous historical variation.
const MAX_HISTORY = 120

export default function App() {
  const [workload,     setWorkload]     = useState('omnistore')
  const [page,         setPage]         = useState('overview')
  const [data,         setData]         = useState(null)
  const [apiStatus,    setApiStatus]    = useState('CHECKING')
  const [lastUpdated,  setLastUpdated]  = useState(null)
  const [loading,      setLoading]      = useState(false)
  const [autoRefresh,  setAutoRefresh]  = useState(true)
  const [riskHistory,  setRiskHistory]  = useState([])
  const requestSequence = useRef(0)
  const activeRequest = useRef(null)

  // metricHistory: { [serviceKey]: Array<{ t, time, error_rate, error_rate_pct, p99, p50, request_rate, availability_pct }> }
  // Each entry is a full snapshot with a timestamp so charts can show time labels
  const [metricHistory, setMetricHistory] = useState({})

  const handleWorkloadChange = (nextWorkload) => {
    if (nextWorkload === workload) return
    requestSequence.current += 1
    activeRequest.current?.abort()
    activeRequest.current = null
    setWorkload(nextWorkload)
    setRiskHistory([])
    setMetricHistory({})
    setData(null)
  }

  const fetchData = useCallback(async () => {
    if (activeRequest.current) return
    const requestId = ++requestSequence.current
    const controller = new AbortController()
    activeRequest.current = controller
    setLoading(true)
    const { data: json } = await fetchLiveMetrics(workload, { signal: controller.signal })

    if (requestId !== requestSequence.current) {
      if (activeRequest.current === controller) activeRequest.current = null
      return
    }

    if (json) {
      setData(json)
      setApiStatus('UP')
      const now  = new Date()
      const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      setLastUpdated(now)

      if (json.system?.prometheus_connected !== false) {
        setRiskHistory(prev => [
          ...prev.slice(-(MAX_HISTORY - 1)),
          {
            t:     now,
            // Store criticality_percentage as the sparkline value so it always
            // matches the gauge (which also shows criticality_percentage).
            // Falls back to cascade_risk*100 if the new field isn't present.
            risk:  json.criticality_percentage ?? Math.round((json.cascade_risk ?? 0) * 100),
            level: json.risk_level ?? 'LOW',
          },
        ])

        const keys = deriveServiceKeys(json.live_metrics, workload)
        setMetricHistory(prev => {
          const next = { ...prev }
          keys.forEach(k => {
            const m = json.live_metrics?.[k] ?? {}
            const requestRate = m.request_rate ?? 0
            const snap = {
              t:              now,
              time,
              error_rate:     m.error_rate_5xx ?? 0,
              error_rate_pct: m.error_rate_pct ?? (
                requestRate > 0 ? (m.error_rate_5xx ?? 0) / requestRate * 100 : (m.fault === 'ERROR' ? 100 : 0)
              ),
              p99:             m.p99_latency_s ?? 0,
              p50:             m.p50_latency_s ?? 0,
              request_rate:    requestRate,
              availability_pct: m.service_up == null ? null : (m.service_up === 1 ? 100 : 0),
              service_up:      m.service_up ?? null,
              fault:           m.fault ?? 'NONE',
            }
            next[k] = [...(next[k] ?? []).slice(-(MAX_HISTORY - 1)), snap]
          })
          return next
        })
      }
    } else {
      setApiStatus('DOWN')
    }

    if (activeRequest.current === controller) activeRequest.current = null
    setLoading(false)
  }, [workload])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(fetchData, POLL_MS)
    return () => clearInterval(id)
  }, [autoRefresh, fetchData])

  const riskLevel = data?.system?.prometheus_connected === false
    && (data?.system?.num_services_down ?? 0) === 0
    ? 'UNKNOWN'
    : data?.risk_level ?? 'LOW'

  return (
    <div className="min-h-screen bg-[#060d1a] text-slate-100 font-sans">

      <Header
        page={page}
        setPage={setPage}
        apiStatus={apiStatus}
        lastUpdated={lastUpdated}
        loading={loading}
        onRefresh={fetchData}
        autoRefresh={autoRefresh}
        setAutoRefresh={setAutoRefresh}
        riskLevel={riskLevel}
        obsStatus={data?.observability_status ?? {}}
        workload={workload}
        setWorkload={handleWorkloadChange}
      />

      {/* API offline banner */}
      {apiStatus === 'DOWN' && (
        <div className="bg-red-950/60 border-b border-red-900/50 px-6 py-2.5 flex items-center justify-between text-xs">
          <span className="text-red-300">
            <span className="font-semibold">Analysis API unreachable.</span>
            {' '}Ensure <code className="bg-red-900/50 px-1 rounded">ml/predict_api.py</code> is running on port 5001.
            {data && ' Showing last known data.'}
          </span>
          <button
            onClick={fetchData}
            disabled={loading}
            className="text-red-300 hover:text-red-100 underline ml-4 shrink-0 disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}

      {apiStatus === 'UP' && data?.system?.prometheus_connected === false && (
        <div className="border-b border-amber-900/50 bg-amber-950/30 px-6 py-2.5 text-xs text-amber-200">
          Prometheus is unavailable. Live charts are paused and service health is shown as unknown rather than healthy.
        </div>
      )}

      <main className="max-w-screen-xl mx-auto px-4 sm:px-6 py-6">

        {page === 'overview' && (
          <OverviewPage
            data={data}
            workload={workload}
            riskHistory={riskHistory}
            metricHistory={metricHistory}
            loading={loading && !data}
            setPage={setPage}
          />
        )}

        {page === 'services' && (
          <ServicesPage
            data={data}
            workload={workload}
            metricHistory={metricHistory}
            loading={loading && !data}
          />
        )}

        {page === 'graph' && (
          <GraphPage
            data={data}
            loading={loading && !data}
          />
        )}

        {page === 'incidents' && (
          <IncidentsPage
            data={data}
            loading={loading && !data}
            onRefresh={fetchData}
            workload={workload}
          />
        )}

      </main>

      <footer className="border-t border-slate-800/60 py-3 text-center text-[11px] text-slate-600">
        Developer Control Center ·
        Workload: <span className="text-slate-400 font-semibold">{workload === 'moviestream' ? 'MovieStream (Streaming)' : 'OmniStore (E-Commerce)'}</span> ·
        ML API: <code className="text-slate-500">:5001</code> ·
        Gateway/Services: <code className="text-slate-500">{workload === 'moviestream' ? ':8087-8093' : ':8080'}</code> ·
        Prometheus: <code className="text-slate-500">:9090</code>
      </footer>

    </div>
  )
}
