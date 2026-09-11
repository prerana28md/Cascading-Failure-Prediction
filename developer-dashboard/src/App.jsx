import React, { useState, useEffect, useCallback } from 'react'

import Header        from './components/Header'
import OverviewPage  from './pages/OverviewPage'
import ServicesPage  from './pages/ServicesPage'
import GraphPage     from './pages/GraphPage'
import IncidentsPage from './pages/IncidentsPage'

import { fetchLiveMetrics, deriveServiceKeys, POLL_MS } from './lib/api'

const MAX_HISTORY = 30

export default function App() {
  const [page,         setPage]         = useState('overview')
  const [data,         setData]         = useState(null)
  const [apiStatus,    setApiStatus]    = useState('CHECKING')
  const [lastUpdated,  setLastUpdated]  = useState(null)
  const [loading,      setLoading]      = useState(false)
  const [autoRefresh,  setAutoRefresh]  = useState(true)
  const [riskHistory,  setRiskHistory]  = useState([])
  const [metricHistory,setMetricHistory]= useState({})

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data: json, error } = await fetchLiveMetrics()

    if (json) {
      setData(json)
      setApiStatus('UP')
      const now = new Date()
      setLastUpdated(now)

      setRiskHistory(prev => [
        ...prev.slice(-(MAX_HISTORY - 1)),
        { t: now, risk: json.cascade_risk ?? 0, level: json.risk_level ?? 'LOW' },
      ])

      const keys = deriveServiceKeys(json.live_metrics)
      setMetricHistory(prev => {
        const next = { ...prev }
        keys.forEach(k => {
          const val = json.live_metrics?.[k]?.error_rate_5xx ?? 0
          next[k] = [...(next[k] ?? []).slice(-(MAX_HISTORY - 1)), val]
        })
        return next
      })
    } else {
      setApiStatus('DOWN')
    }

    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(fetchData, POLL_MS)
    return () => clearInterval(id)
  }, [autoRefresh, fetchData])

  const riskLevel = data?.risk_level ?? 'LOW'

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

      <main className="max-w-screen-xl mx-auto px-4 sm:px-6 py-6">

        {page === 'overview' && (
          <OverviewPage
            data={data}
            riskHistory={riskHistory}
            metricHistory={metricHistory}
            loading={loading && !data}
            setPage={setPage}
          />
        )}

        {page === 'services' && (
          <ServicesPage
            data={data}
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
          />
        )}

      </main>

      <footer className="border-t border-slate-800/60 py-3 text-center text-[11px] text-slate-600">
        Developer Control Center ·
        ML API: <code className="text-slate-500">:5001</code> ·
        Gateway: <code className="text-slate-500">:8080</code> ·
        Prometheus: <code className="text-slate-500">:9090</code>
      </footer>

    </div>
  )
}
