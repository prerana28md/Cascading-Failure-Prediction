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
export const GATEWAY    = import.meta.env.VITE_GATEWAY_URL    ?? '/gateway'
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

/**
 * Add a developer resolution note to a resolved incident.
 * @param {string|number} id  incident id
 * @param {string} resolvedBy developer name
 * @param {string} note       resolution message
 */
export async function resolveIncident(id, resolvedBy, note) {
  return apiFetch(`${ML_API}/api/incidents/resolve`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ id, resolved_by: resolvedBy, note }),
  })
}

export const KNOWN_SERVICES = ['order', 'payment', 'inventory', 'shipping', 'delivery', 'notification']

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
 * Fetch fault status for an array of service keys.
 * Tries central GET /fault/status first, then falls back to parallel individual queries.
 * Returns: { [serviceKey]: { fault, delayMs, active? } | null }
 */
export async function fetchAllFaultStatuses(serviceKeys = KNOWN_SERVICES) {
  const keys = serviceKeys && serviceKeys.length ? serviceKeys : KNOWN_SERVICES
  const { data, error } = await apiFetch(`${GATEWAY}/fault/status`)
  if (!error && data && typeof data === 'object') {
    const sMap = {}
    if (Array.isArray(data.services)) {
      data.services.forEach(item => {
        const raw = item.service || item.name || ''
        sMap[raw] = item
        sMap[raw.replace(/-service$/, '')] = item
      })
    }
    Object.keys(data).forEach(k => {
      if (k !== 'services') {
        sMap[k] = data[k]
        sMap[k.replace(/-service$/, '')] = data[k]
      }
    })

    const out = {}
    for (const k of keys) {
      const sData = sMap[k] || sMap[`${k}-service`] || {}
      const f = sData.fault || sData.faultType || 'NONE'
      out[k] = {
        service: k,
        fault:   f,
        delayMs: Number(sData.delayMs || sData.delay_ms || 0),
        active:  Boolean(sData.active || (f && f !== 'NONE')),
      }
    }
    return out
  }

  const results = await Promise.allSettled(
    keys.map(k => fetchFaultStatus(k))
  )
  return Object.fromEntries(
    keys.map((k, i) => [
      k,
      results[i].status === 'fulfilled' ? results[i].value.data : null,
    ])
  )
}

/**
 * Inject a fault into a service.
 * POST /fault/configure (fallback: /fault/{service}-service/configure)
 * body: { service, fault, faultType, delayMs, delay_ms }
 */
export async function injectFault(serviceKey, fault, delayMs = 0) {
  const payload = {
    service:   serviceKey,
    fault:     fault,
    faultType: fault,
    delayMs:   fault === 'LATENCY' ? delayMs : 0,
    delay_ms:  fault === 'LATENCY' ? delayMs : 0,
  }

  const res = await apiFetch(`${GATEWAY}/fault/configure`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  })
  if (!res.error) return res

  return apiFetch(`${GATEWAY}/fault/${serviceKey}-service/configure`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  })
}

/**
 * Reset (clear) fault on a service.
 * POST /fault/reset (fallback: /fault/{service}-service/reset)
 */
export async function resetFault(serviceKey) {
  const res = await apiFetch(`${GATEWAY}/fault/reset`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ service: serviceKey }),
  })
  if (!res.error) return res

  return apiFetch(`${GATEWAY}/fault/${serviceKey}-service/reset`, { method: 'POST' })
}

/**
 * Reset faults on all given service keys.
 * Uses atomic /fault/reset with service: 'ALL', falling back to sequential reset.
 * Returns array of { serviceKey, ok, error }
 */
export async function resetAllFaults(serviceKeys = KNOWN_SERVICES) {
  const keys = serviceKeys && serviceKeys.length ? serviceKeys : KNOWN_SERVICES
  const res = await apiFetch(`${GATEWAY}/fault/reset`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ service: 'ALL' }),
  })
  if (!res.error) {
    return keys.map(k => ({ serviceKey: k, ok: true }))
  }

  const out = []
  for (const k of keys) {
    const { error } = await resetFault(k)
    out.push({ serviceKey: k, ok: !error, error })
  }
  return out
}

// ── Data helpers ─────────────────────────────────────────────────────────────

/**
 * Derive the list of service keys from the live_metrics object.
 * Falls back to KNOWN_SERVICES if live_metrics is empty or not yet loaded.
 *
 * @param {object} liveMetrics  data.live_metrics from /metrics/live
 * @returns {string[]}  e.g. ['order','payment','inventory',...]
 */
export function deriveServiceKeys(liveMetrics) {
  if (!liveMetrics || typeof liveMetrics !== 'object' || Object.keys(liveMetrics).length === 0) {
    return KNOWN_SERVICES
  }
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
  const maxErr = data.system?.max_error_rate ?? data.system?.mean_error_rate ?? 0
  if (level === 'CRITICAL' || down >= 2 || maxErr >= 0.35) return 'CRITICAL'
  if (level === 'HIGH'     || down >= 1 || level === 'MEDIUM' || maxErr >= 0.02) return 'DEGRADED'
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
