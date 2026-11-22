import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  root: 'client',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
    // Keep everything (vault code included) in one main bundle: a separate,
    // lazily-loaded "vault" chunk would itself be a giveaway.
    rollupOptions: { output: { manualChunks: undefined, inlineDynamicImports: false } },
  },
  // Generic file name for the key-derivation worker.
  worker: { format: 'es', rollupOptions: { output: { entryFileNames: 'assets/w-[hash].js' } } },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Notes',
        short_name: 'Notes',
        description: 'Simple notes.',
        start_url: '/',
        display: 'standalone',
        background_color: '#fbfaf7',
        theme_color: '#f3f1ec',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Cache the app shell only. Vault data and files are never cached.
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api\//, /^\/ws/],
        runtimeCaching: [],
      },
    }),
  ],
});
