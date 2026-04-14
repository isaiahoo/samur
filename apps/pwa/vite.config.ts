// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "icons/*.png"],
      manifest: false, // we provide our own manifest.json in public/
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        runtimeCaching: [
          {
            // Vector tile caching (via our proxy)
            urlPattern: /\/api\/v1\/tiles\/\d+\/\d+\/\d+\.pbf$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "vector-tiles",
              expiration: { maxEntries: 5000, maxAgeSeconds: 7 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Offline style JSON — cache for quick offline access
            urlPattern: /\/api\/v1\/tiles\/offline-style\.json$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "offline-style",
              expiration: { maxEntries: 1, maxAgeSeconds: 30 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // API requests (non-tile): NO runtimeCaching rule.
          // Without a matching route, the SW won't call respondWith(),
          // so the browser handles API fetches directly — bypassing
          // the iOS Safari SW fetch bug that hung NetworkOnly/NetworkFirst.
          {
            // Images
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "images",
              expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@samur/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/socket.io": {
        target: "http://localhost:3000",
        ws: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          maplibre: ["maplibre-gl"],
          recharts: ["recharts"],
        },
      },
    },
  },
});
