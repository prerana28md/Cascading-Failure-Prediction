/**
 * API layer for the Developer Control Center.
 *
 * Two upstream services:
 *   ML_API  (port 5001) — /metrics/live, /incidents, etc.
 *                          Proxied through Vite dev server as /api → localhost:5001
 *   GATEWAY (port 8080) — /fault/{service}/configure|reset|status
 *                          Accessed directly (no proxy needed for fault endpoints)
 *
 * To override URLs via environment variables:
 *   VITE_ML_API_URL      e.g. http://prod-ml:5001
 *   VITE_GATEWAY_URL     e.g. http://prod-gateway:8080
 */

export const ML_API     = import.meta.env.VITE_ML_API_URL     ?? ''        // '' → uses /api proxy
export const GATEWAY    = import.meta.env.VITE_GATEWAY_URL    ?? 'http://localhost:8080'
export const POLL_MS    = 8000   // live metrics poll interval

// ── Generic fetch wrapper ────────────────────────────────────────────────────
async function apiFetch(url, options = {}) {
  const controller = new AbortController()
  const tid = setTimeout(() => controller.abort(), 12000)
  try {
    const res = await fetch(url, { signal: controller.signal, ...options })
    clearTimeout(tid)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return { data: await res.json(), error: null }
  } catch (err) {
    clearTimeout(tid)
    return { data: null, error: err.name === 'AbortError' ? 'Request timed out' : err.message }
  }
}

// ── ML Prediction API ────────────────────────────────────────────────────────

/** Full live pipeline: metrics, prediction, graph, incidents, etc. */
export async function fetchLiveMetrics() {
  return apiFetch(`${ML_API}/api/metrics/live`)
}

/** Clears the rolling incident log (POST /incidents/clear). */
export async function clearIncidents() {
  return apiFetch(`${ML_API}/api/incidents/clear`, { method: 'POST' })
}

// ── Fault Injection API (via API Gateway) ───────────────────────────────────

/**
 * Fetch fault status for one service.
 * GET /fault/{service}-service/status
 * Returns: { service, fault, delayMs }
 */
export async function fetchFaultStatus(serviceKey) {
  return apiFetch(`${GATEWAY}/fault/${serviceKey}-service/status`)
}

/**
 * Fetch fault status for an array of service keys in parallel.
 * Returns: { [serviceKey]: { fault, delayMs } | null }
 */
export async function fetchAllFaultStatuses(serviceKeys) {
  const results = await Promise.allSettled(
    serviceKeys.map(k => fetchFaultStatus(k))
  )
  return Object.fromEntries(
    serviceKeys.map((k, i) => [
      k,
      results[i].status === 'fulfilled' ? results[i].value.data : null,
    ])
  )
}

/**
 * Inject a fault into a service.
 * POST /fault/{service}-service/configure
 * body: { fault: 'LATENCY'|'ERROR'|'DOWN'|'NONE', delayMs?: number }
 */
export async function injectFault(serviceKey, fault, delayMs = 0) {
  return apiFetch(`${GATEWAY}/fault/${serviceKey}-service/configure`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ fault, delayMs }),
  })
}

/**
 * Reset (clear) fault on a service.
 * POST /fault/{service}-service/reset
 */
export async function resetFault(serviceKey) {
  return apiFetch(`${GATEWAY}/fault/${serviceKey}-service/reset`, { method: 'POST' })
}

/**
 * Reset faults on all given service keys sequentially.
 * Returns array of { serviceKey, ok, error }
 */
export async function resetAllFaults(serviceKeys) {
  const out = []
  for (const k of serviceKeys) {
    const { error } = await resetFault(k)
    out.push({ serviceKey: k, ok: !error, error })
  }
  return out
}

// ── Data helpers ─────────────────────────────────────────────────────────────

/**
 * Derive the list of service keys from the live_metrics object.
 * The backend already knows which services exist — we don't hardcode them.
 * Falls back to [] so callers never crash on null data.
 *
 * @param {object} liveMetrics  data.live_metrics from /metrics/live
 * @returns {string[]}  e.g. ['order','payment','inventory',...]
 */
export function deriveServiceKeys(liveMetrics) {
  if (!liveMetrics || typeof liveMetrics !== 'object') return []
  return Object.keys(liveMetrics)
}

/**
 * Compute the human-readable system status from live API data.
 * Derived entirely from backend values — nothing hardcoded.
 *
 * @returns {'HEALTHY'|'DEGRADED'|'CRITICAL'|'UNKNOWN'}
 */
export function deriveSystemStatus(data) {
  if (!data) return 'UNKNOWN'
  const level = data.risk_level || 'LOW'
  const down  = data.system?.num_services_down ?? 0
  if (level === 'CRITICAL' || down >= 2) return 'CRITICAL'
  if (level === 'HIGH'     || down >= 1) return 'DEGRADED'
  if (level === 'MEDIUM')                return 'DEGRADED'
  return 'HEALTHY'
}

/**
 * Format a raw metric value for display.
 * @param {number|null} v
 * @param {'rate'|'latency'|'pct'|'count'} type
 */
export function fmtMetric(v, type = 'rate') {
  if (v == null || isNaN(v)) return '—'
  switch (type) {
    case 'rate':    return `${(+v).toFixed(4)}/s`
    case 'latency': return `${(+v * 1000).toFixed(0)} ms`
    case 'pct':     return `${(+v * 100).toFixed(1)}%`
    case 'count':   return String(Math.round(+v))
    default:        return String((+v).toFixed(3))
  }
}
