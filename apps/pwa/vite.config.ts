// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    // VitePWA removed — the generated Service Worker causes iOS Safari to
    // hang all fetch requests on repeat visits. The app works fully without
    // a SW. "Add to Home Screen" still works via manifest.json + apple-touch-icon.
    // We can re-add a minimal SW later for tile caching once iOS bugs are resolved.
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@samur/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
      // Shared legal documents live at monorepo root — single source of
      // truth so the privacy policy isn't duplicated between the audit
      // trail and the PWA. Imported via `@legal/privacy-policy.md?raw`.
      "@legal": path.resolve(__dirname, "../../legal"),
    },
  },
  server: {
    port: 5173,
    // Allow dev-mode imports from the monorepo-root legal/ directory.
    // Build mode ignores this — vite bundles whatever the graph touches.
    fs: {
      allow: [path.resolve(__dirname, "../..")],
    },
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
