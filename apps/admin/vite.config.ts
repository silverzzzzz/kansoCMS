import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const apiOrigin = env.KANSO_API_ORIGIN || 'http://localhost:5173'

  return {
    // Served under /admin/ by the Worker's Static Assets.
    base: '/admin/',
    plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
    build: {
      // The server's Vite build copies public/ into its client output, so the
      // admin bundle ships as part of the single Worker deploy.
      outDir: '../server/public/admin',
      emptyOutDir: true,
    },
    server: {
      port: 5174,
      strictPort: true,
      // In dev the SPA runs on its own port and talks to the Worker via proxy.
      proxy: {
        '/api': apiOrigin,
        '/media': apiOrigin,
      },
    },
  }
})
