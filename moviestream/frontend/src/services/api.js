/**
 * MovieStream Frontend API Service
 * Routes through Vite development proxy or environment URLs to all 5 microservices
 */

const CATALOG_BASE = '/api/catalog'
const USER_BASE = '/api/user'
const WATCHLIST_BASE = '/api/watchlist'
const HISTORY_BASE = '/api/history'
const RECS_BASE = '/api/recommendations'

async function request(url, options = {}) {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs || 5000
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    })
    clearTimeout(timeoutId)
    if (!res.ok) {
      let errorMsg = `HTTP ${res.status}`
      try {
        const body = await res.json()
        errorMsg = body.detail || body.error || errorMsg
      } catch (_) {}
      return { data: null, error: errorMsg, status: res.status }
    }
    const data = await res.json()
    return { data, error: null, status: res.status }
  } catch (err) {
    clearTimeout(timeoutId)
    return {
      data: null,
      error: err.name === 'AbortError' ? 'Request timed out (>5s)' : err.message,
      status: 0
    }
  }
}

// ── Catalog API ──────────────────────────────────────────────────────────────
export async function fetchLiveSyncStatus() {
  return request(`${CATALOG_BASE}/catalog/sync/status`)
}

export async function triggerLiveSync() {
  return request(`${CATALOG_BASE}/catalog/sync/trigger`, { method: 'POST' })
}

export async function fetchBillboard() {
  return request(`${CATALOG_BASE}/catalog/billboard`)
}

export async function fetchCatalogRows() {
  return request(`${CATALOG_BASE}/catalog/rows`)
}

export async function fetchTrending() {
  return request(`${CATALOG_BASE}/catalog/trending`)
}

export async function fetchPopular() {
  return request(`${CATALOG_BASE}/catalog/popular`)
}

export async function fetchTopRated() {
  return request(`${CATALOG_BASE}/catalog/top-rated`)
}

export async function fetchKannadaMovies() {
  return request(`${CATALOG_BASE}/catalog/regional/kannada`)
}

export async function fetchTeluguMovies() {
  return request(`${CATALOG_BASE}/catalog/regional/telugu`)
}

export async function fetchIndianCinema() {
  return request(`${CATALOG_BASE}/catalog/indian`)
}

export async function fetchTVShows() {
  return request(`${CATALOG_BASE}/catalog/tv`)
}

export async function fetchMovies() {
  return request(`${CATALOG_BASE}/catalog/movies`)
}

export async function fetchTop10() {
  return request(`${CATALOG_BASE}/catalog/top10`)
}

export async function fetchOriginals() {
  return request(`${CATALOG_BASE}/catalog/originals`)
}

export async function fetchGenreMovies(genreId) {
  return request(`${CATALOG_BASE}/catalog/genre/${genreId}`)
}

export async function fetchMovieDetails(movieId) {
  return request(`${CATALOG_BASE}/catalog/movie/${movieId}`)
}

export async function fetchMovieTrailer(movieId) {
  return request(`${CATALOG_BASE}/catalog/movie/${movieId}/trailer`)
}

export async function fetchSimilarMovies(movieId) {
  return request(`${CATALOG_BASE}/catalog/movie/${movieId}/similar`)
}

export async function searchMovies(query) {
  return request(`${CATALOG_BASE}/catalog/search?q=${encodeURIComponent(query)}`)
}

// ── User API ────────────────────────────────────────────────────────────────
export async function fetchProfiles() {
  return request(`${USER_BASE}/user/profiles`)
}

export async function fetchUserProfile(userId) {
  return request(`${USER_BASE}/user/profile/${userId}`)
}

export async function loginUser(username) {
  return request(`${USER_BASE}/user/login`, {
    method: 'POST',
    body: JSON.stringify({ username })
  })
}

// ── Watchlist API ───────────────────────────────────────────────────────────
export async function fetchWatchlist(userId) {
  return request(`${WATCHLIST_BASE}/watchlist/${userId}`)
}

export async function addToWatchlist(userId, movie) {
  return request(`${WATCHLIST_BASE}/watchlist/${userId}/add`, {
    method: 'POST',
    body: JSON.stringify(movie)
  })
}

export async function removeFromWatchlist(userId, movieId) {
  return request(`${WATCHLIST_BASE}/watchlist/${userId}/remove/${movieId}`, {
    method: 'DELETE'
  })
}

export async function checkWatchlistStatus(userId, movieId) {
  return request(`${WATCHLIST_BASE}/watchlist/${userId}/check/${movieId}`)
}

// ── History API ─────────────────────────────────────────────────────────────
export async function fetchContinueWatching(userId) {
  return request(`${HISTORY_BASE}/history/${userId}/continue-watching`)
}

export async function fetchHistory(userId) {
  return request(`${HISTORY_BASE}/history/${userId}`)
}

export async function reportPlaybackProgress(userId, progressData) {
  return request(`${HISTORY_BASE}/history/${userId}/progress`, {
    method: 'POST',
    body: JSON.stringify(progressData)
  })
}

export async function markMovieCompleted(userId, movieId) {
  return request(`${HISTORY_BASE}/history/${userId}/complete/${movieId}`, {
    method: 'POST'
  })
}

// ── Recommendation API ──────────────────────────────────────────────────────
export async function fetchRecommendations(userId) {
  return request(`${RECS_BASE}/recommendations/${userId}`, { timeoutMs: 6000 })
}

// ── Microservice Health Radar ───────────────────────────────────────────────
export async function checkMicroservicesHealth() {
  const checks = [
    { key: 'catalog', name: 'Catalog Service', port: 8087, url: `${CATALOG_BASE}/health` },
    { key: 'user', name: 'User Service', port: 8088, url: `${USER_BASE}/health` },
    { key: 'watchlist', name: 'Watchlist Service', port: 8089, url: `${WATCHLIST_BASE}/health` },
    { key: 'history', name: 'History Service', port: 8092, url: `${HISTORY_BASE}/health` },
    { key: 'recommendation', name: 'Recommendation Service', port: 8093, url: `${RECS_BASE}/health` }
  ]

  const results = await Promise.all(
    checks.map(async check => {
      const start = performance.now()
      const res = await request(check.url, { timeoutMs: 2000 })
      const latencyMs = Math.round(performance.now() - start)
      return {
        ...check,
        healthy: res.error === null && res.status === 200,
        latencyMs,
        error: res.error
      }
    })
  )

  return results
}
