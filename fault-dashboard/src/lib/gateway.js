/**
 * gateway.js — all API calls for the Fault Injection Lab.
 *
 * This module talks ONLY to the API Gateway (port 8080).
 * No ML API. No Prometheus. No other service.
 *
 * In development (npm run dev):
 *   All requests go to /gateway/... which Vite proxies to http://localhost:8080/...
 *   This avoids any CORS preflight issues in the browser.
 *
 * In production / Docker:
 *   Set  VITE_GATEWAY_BASE  to the full gateway URL, e.g. http://localhost:8080
 *   The proxy is no longer used; requests go directly to that URL.
 *
 * ── Service discovery ───────────────────────────────────────────────────────
 * The gateway does NOT expose a "list services" endpoint, so we use a known
 * list of service keys from the current OmniStore project. This is the ONLY
 * place service names appear — everything else derives from this array at
 * runtime.
 *
 * To adapt for a different microservice system, update KNOWN_SERVICES below.
 * The rest of the UI renders whatever this array contains.
 */

// Resolved at build time from env var, or falls back to the Vite proxy prefix.
const BASE = import.meta.env.VITE_GATEWAY_BASE ?? '/gateway'

// ── Known services in this system ────────────────────────────────────────────
// Each entry is the service key used in fault routes:
//   POST /fault/{key}-service/configure
//   POST /fault/{key}-service/reset
//   GET  /fault/{key}-service/status
export const KNOWN_SERVICES = [
  'order',
  'payment',
  'inventory',
  'shipping',
  'delivery',
  'notification',
]

// ── Fault type definitions ────────────────────────────────────────────────────
// Matches the backend FaultState.FaultType enum exactly.
export const FAULT_TYPES = [
  {
    key:   'LATENCY',
    label: 'Latency Spike',
    desc:  'Adds artificial delay to every response. Simulates slow DB or network.',
    color: 'amber',
  },
  {
    key:   'ERROR',
    label: 'Error Storm',
    desc:  'Returns HTTP 500 on every request. Triggers circuit breaker logic.',
    color: 'orange',
  },
  {
    key:   'DOWN',
    label: 'Service Down',
    desc:  'Returns HTTP 503 immediately. Simulates complete service outage.',
    color: 'red',
  },
]

// ── Low-level fetch ───────────────────────────────────────────────────────────
async function gw(path, options = {}, timeoutMs = 8000) {
  const url        = `${BASE}${path}`
  const controller = new AbortController()
  const tid        = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Accept:         'application/json',
        ...(options.headers ?? {}),
      },
    })
    clearTimeout(tid)

    // Parse body regardless of status so we can return error messages
    let body = null
    const ct = res.headers.get('content-type') ?? ''
    if (ct.includes('application/json')) {
      body = await res.json().catch(() => null)
    } else {
      const text = await res.text().catch(() => '')
      // If the gateway returned its own error string, expose it
      body = text ? { _raw: text } : null
    }

    if (!res.ok) {
      const msg = body?._raw ?? body?.message ?? body?.error ?? `HTTP ${res.status}`
      return { data: null, error: msg, status: res.status }
    }

    return { data: body, error: null, status: res.status }
  } catch (err) {
    clearTimeout(tid)
    const msg = err.name === 'AbortError'
      ? 'Request timed out — is the Gateway running on port 8080?'
      : err.message
    return { data: null, error: msg, status: 0 }
  }
}

// ── Gateway health ────────────────────────────────────────────────────────────

/**
 * Ping the gateway actuator health endpoint.
 * Returns { up: bool, status: string, error: string|null }
 */
export async function checkGatewayHealth() {
  const { data, error, status } = await gw('/actuator/health', {}, 4000)
  if (error) return { up: false, status: 'UNREACHABLE', error }
  const s = data?.status ?? 'UNKNOWN'
  return { up: s === 'UP', status: s, error: null }
}

// ── Fault status ──────────────────────────────────────────────────────────────

/**
 * GET /fault/{key}-service/status
 * Returns: { data: { service, fault, delayMs }, error }
 *
 * Possible fault values from backend: 'NONE' | 'LATENCY' | 'ERROR' | 'DOWN'
 */
export async function getFaultStatus(key) {
  return gw(`/fault/${key}-service/status`)
}

/**
 * Fetch fault status for every service.
 * Tries central GET /fault/status first, falling back to parallel individual queries.
 * Never throws — failed services get { fault: null, error: string }.
 *
 * @param {string[]} [keys]
 * @returns {Promise<Record<string, { fault: string|null, delayMs: number, active?: boolean, error: string|null }>>}
 */
export async function getAllFaultStatuses(keys = KNOWN_SERVICES) {
  const targetKeys = keys && keys.length ? keys : KNOWN_SERVICES
  const { data, error } = await gw('/fault/status')
  if (!error && data && typeof data === 'object') {
    const sMap = {}
    if (Array.isArray(data.services)) {
      data.services.forEach(item => {
        const raw = item.service || ''
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
    for (const k of targetKeys) {
      const sData = sMap[k] || sMap[`${k}-service`] || {}
      const f = sData.fault || sData.faultType || 'NONE'
      out[k] = {
        service: k,
        fault: f,
        delayMs: Number(sData.delayMs || sData.delay_ms || 0),
        active: Boolean(sData.active || (f && f !== 'NONE')),
        error: null,
      }
    }
    return out
  }

  // Fallback to parallel individual queries
  const settled = await Promise.allSettled(targetKeys.map(k => getFaultStatus(k)))
  return Object.fromEntries(
    targetKeys.map((k, i) => {
      const r = settled[i]
      if (r.status === 'fulfilled' && r.value.data) {
        return [k, { ...r.value.data, error: null }]
      }
      const err = r.status === 'fulfilled' ? r.value.error : r.reason?.message
      return [k, { fault: null, delayMs: 0, error: err ?? 'Unknown error' }]
    })
  )
}

// ── Fault injection ───────────────────────────────────────────────────────────

/**
 * POST /fault/configure (fallback: /fault/{key}-service/configure)
 * body: { service, fault, faultType, delayMs, delay_ms }
 *
 * @returns { data, error }
 */
export async function injectFault(key, faultType, delayMs = 0) {
  const payload = {
    service:   key,
    fault:     faultType,
    faultType: faultType,
    delayMs:   faultType === 'LATENCY' ? delayMs : 0,
    delay_ms:  faultType === 'LATENCY' ? delayMs : 0,
  }

  // Primary: Central API Gateway fault controller
  const res = await gw('/fault/configure', {
    method: 'POST',
    body:   JSON.stringify(payload),
  })
  if (!res.error) return res

  // Fallback: Direct service route via gateway
  return gw(`/fault/${key}-service/configure`, {
    method: 'POST',
    body:   JSON.stringify(payload),
  })
}

/**
 * POST /fault/reset (fallback: /fault/{key}-service/reset)
 * Clears whatever fault is active on this service.
 *
 * @returns { data, error }
 */
export async function resetFault(key) {
  const res = await gw('/fault/reset', {
    method: 'POST',
    body:   JSON.stringify({ service: key }),
  })
  if (!res.error) return res

  return gw(`/fault/${key}-service/reset`, { method: 'POST' })
}

/**
 * Reset all services.
 * Uses atomic /fault/reset with service: 'ALL', falling back to sequential reset.
 * Returns array of { key, ok, error }.
 */
export async function resetAllFaults(keys = KNOWN_SERVICES) {
  const targetKeys = keys && keys.length ? keys : KNOWN_SERVICES
  const res = await gw('/fault/reset', {
    method: 'POST',
    body:   JSON.stringify({ service: 'ALL' }),
  })
  if (!res.error) {
    return targetKeys.map(k => ({ key: k, ok: true, error: null }))
  }

  const results = []
  for (const k of targetKeys) {
    const { error } = await resetFault(k)
    results.push({ key: k, ok: !error, error: error ?? null })
  }
  return results
}

// ── Display helpers ───────────────────────────────────────────────────────────

/**
 * Convert a service key to a human-readable label.
 *   'order'     → 'Order Service'
 *   'payment'   → 'Payment Service'
 *   'my-svc'    → 'My Svc Service'
 */
export function serviceLabel(key) {
  if (!key) return ''
  const words = key.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1))
  return words.join(' ') + ' Service'
}

/**
 * CSS colour tokens for each fault type and connection state.
 * Returns Tailwind class strings so no dynamic colour construction.
 */
export const FAULT_COLORS = {
  NONE:    { dot: 'bg-emerald-400', text: 'text-emerald-400', badge: 'bg-emerald-950 text-emerald-300 border-emerald-800' },
  LATENCY: { dot: 'bg-amber-400',   text: 'text-amber-400',   badge: 'bg-amber-950  text-amber-300  border-amber-800'  },
  ERROR:   { dot: 'bg-orange-500',  text: 'text-orange-400',  badge: 'bg-orange-950 text-orange-300 border-orange-800' },
  DOWN:    { dot: 'bg-red-500',     text: 'text-red-400',     badge: 'bg-red-950    text-red-300    border-red-800'    },
  UNKNOWN: { dot: 'bg-slate-500',   text: 'text-slate-400',   badge: 'bg-slate-800  text-slate-400  border-slate-700'  },
}
