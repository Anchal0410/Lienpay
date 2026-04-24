import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = (env.VITE_PROXY_TARGET || 'http://localhost:3000').replace(/\/$/, '')

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          // Dev proxy to backend (set VITE_PROXY_TARGET in .env.development)
          target,
          changeOrigin: true,
        },
      },
    },
  }
})
