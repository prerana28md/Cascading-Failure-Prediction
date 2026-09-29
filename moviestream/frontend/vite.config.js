import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3002,
    proxy: {
      '/api/catalog': {
        target: 'http://localhost:8087',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/catalog/, ''),
      },
      '/api/user': {
        target: 'http://localhost:8088',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/user/, ''),
      },
      '/api/watchlist': {
        target: 'http://localhost:8089',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/watchlist/, ''),
      },
      '/api/history': {
        target: 'http://localhost:8092',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/history/, ''),
      },
      '/api/recommendations': {
        target: 'http://localhost:8093',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/recommendations/, ''),
      },
      '/api/gateway': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/gateway/, ''),
      }
    }
  }
})
