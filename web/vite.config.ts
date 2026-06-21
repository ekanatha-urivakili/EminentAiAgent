import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Forward all /api/* calls to the ASP.NET backend so the browser
      // never hits CORS issues and works on any port Vite picks.
      '/api': {
        target: 'http://127.0.0.1:5210',
        changeOrigin: true,
      },
      // Mailpit dashboard API
      '/mailpit-api': {
        target: 'http://localhost:8025',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/mailpit-api/, ''),
      },
    },
  },
})
