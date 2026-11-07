import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The single-page app is built once and served by both targets:
// - web: Next.js serves `public/` on Vercel next to the API (/api/*)
// - desktop: the local server inside the Windows app serves the same files
export default defineConfig({
  root: r("./src/ui"),
  publicDir: r("./src/ui/static"),
  base: "/",
  plugins: [react(), tailwindcss()],
  // Tailwind runs as a Vite plugin; an inline (empty) PostCSS config stops Vite from picking up
  // the repository root's postcss.config.mjs, which belongs to another app
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: { "@shared": r("./src/shared"), "@ui": r("./src/ui") },
  },
  build: {
    outDir: process.env.ITSM_UI_OUT ? r(process.env.ITSM_UI_OUT) : r("./public"),
    emptyOutDir: true,
    target: "es2020",
    chunkSizeWarningLimit: 4000,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:3939", changeOrigin: false } },
  },
});
