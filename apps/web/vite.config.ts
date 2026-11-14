import { copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
// VITE_DEMO=1 builds a backend-free click-through demo with invented data (src/demo). The demo
// entry is swapped in here, so regular builds never contain the fake backend or its fixtures.
const demo = process.env.VITE_DEMO === '1';
const rawBase = process.env.VITE_BASE?.trim() || '/';
const base = rawBase === '/' ? '/' : `/${rawBase.replace(/^\/+|\/+$/g, '')}/`;
export default defineConfig({
  base,
  plugins: [
    demo && {
      name: 'bnature-demo-entry',
      transformIndexHtml: {
        order: 'pre' as const,
        handler: (html: string) =>
          html
            .replace('/src/app/main.tsx', '/src/demo/entry.ts')
            .replace('<title>b*nature Vereinsplattform</title>', '<title>b*nature Demo</title>')
            .replace('<head>', '<head>\n    <meta name="robots" content="noindex, nofollow" />'),
      },
      // SPA fallback for static hosts (Netlify, Cloudflare Pages, GitHub Pages).
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: '_redirects',
          source: `/* ${base}index.html 200\n`,
        });
      },
      async writeBundle(options) {
        if (options.dir)
          await copyFile(resolve(options.dir, 'index.html'), resolve(options.dir, '404.html'));
      },
    },
    react(),
    tailwind(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: demo ? 'b*nature Demo' : 'b*nature Vereinsplattform',
        short_name: demo ? 'b*nature Demo' : 'b*nature',
        description: 'Vereinsverwaltung für b*nature',
        lang: 'de',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#fafafa',
        theme_color: '#171717',
        icons: [
          { src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          {
            src: `${base}icon-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: `${base}index.html`,
        navigateFallbackDenylist: [/^\/api(?:\/|$)/],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
        // The app is still one bundle (1.7 MB production, 2.1 MB with the development React
        // build used by the browser tests); above Workbox's 2 MiB default the build aborts.
        // Follow-up: split routes into lazy chunks and lower this again.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: process.env.API_PROXY_URL ?? 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
    proxy: {
      '/api': { target: process.env.API_PROXY_URL ?? 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
  build: { sourcemap: false },
});
