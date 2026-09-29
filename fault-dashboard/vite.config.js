import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Fault Dashboard — standalone Vite app.
 *
 * Talks ONLY to the API Gateway on port 8080.
 * No ML API dependency whatsoever.
 *
 * The /gateway proxy rewrites requests so the browser never hits a
 * cross-origin URL in development — avoiding CORS preflight issues.
 *
 *   /gateway/fault/...  →  http://localhost:8080/fault/...
 *   /gateway/actuator/health  →  http://localhost:8080/actuator/health
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4001,
    proxy: {
      '/gateway': {
        target:      'http://localhost:8080',
        changeOrigin: true,
        rewrite:     path => path.replace(/^\/gateway/, ''),
      },
      '/ms-catalog': {
        target:      'http://localhost:8087',
        changeOrigin: true,
        rewrite:     path => path.replace(/^\/ms-catalog/, ''),
      },
      '/ms-user': {
        target:      'http://localhost:8088',
        changeOrigin: true,
        rewrite:     path => path.replace(/^\/ms-user/, ''),
      },
      '/ms-watchlist': {
        target:      'http://localhost:8089',
        changeOrigin: true,
        rewrite:     path => path.replace(/^\/ms-watchlist/, ''),
      },
      '/ms-history': {
        target:      'http://localhost:8092',
        changeOrigin: true,
        rewrite:     path => path.replace(/^\/ms-history/, ''),
      },
      '/ms-recommendation': {
        target:      'http://localhost:8093',
        changeOrigin: true,
        rewrite:     path => path.replace(/^\/ms-recommendation/, ''),
      },
    },
  },
})
