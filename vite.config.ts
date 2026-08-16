import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    // Must come before react() so generated routes are transformed.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Tasks',
        short_name: 'Tasks',
        description: 'A personal task app backed by Google Tasks',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0a0a0a',
        theme_color: '#0a0a0a',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Shell only. Dexie is the source of truth for data, so no API
        // response ever goes through the service worker cache.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        // /api/auth/start is a *top-level navigation*, so without this the
        // installed app answers it with the shell instead of letting it reach
        // Google — breaking sign-in only once the service worker exists, which
        // is to say only on the phone.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    proxy: {
      // Points at the functions emulator. Deliberately no `changeOrigin`: the
      // function builds its OAuth redirect_uri from the Host header, and
      // rewriting it would produce a redirect_uri that is not registered.
      '/api': {
        target: 'http://127.0.0.1:5001/tasks-505418/us-central1/api',
        changeOrigin: false,
      },
    },
  },
})
