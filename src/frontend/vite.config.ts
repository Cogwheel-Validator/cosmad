import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    // In standalone dev mode (pnpm --filter @cosmad/frontend dev),
    // the API runs on :3000 and Vite proxies these paths across.
    // When started via the runner (pnpm dev), Vite runs in middleware
    // mode on the same port as Hono so no proxy is needed.
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
