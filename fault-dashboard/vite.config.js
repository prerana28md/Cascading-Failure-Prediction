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
    },
  },
})
