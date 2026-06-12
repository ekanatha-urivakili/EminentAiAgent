import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy Mailpit API to avoid CORS — browser calls /mailpit-api/...
      // Vite rewrites it to http://localhost:8025/...
      '/mailpit-api': {
        target: 'http://localhost:8025',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/mailpit-api/, ''),
      },
    },
  },
})
