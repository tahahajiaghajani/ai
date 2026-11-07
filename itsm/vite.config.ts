import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { APP_DESCRIPTION, APP_NAME } from "./src/shared/constants";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The web app manifest («افزودن به صفحهٔ اصلی»), named from src/shared/constants.ts like everything else. */
export function webManifest(): string {
  return `${JSON.stringify(
    {
      name: APP_NAME,
      short_name: APP_NAME,
      description: APP_DESCRIPTION,
      lang: "fa",
      dir: "rtl",
      id: "/",
      start_url: "/",
      scope: "/",
      display: "standalone",
      orientation: "any",
      background_color: "#F7F4F0",
      theme_color: "#F7F4F0",
      categories: ["business", "productivity", "utilities"],
      icons: [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
        { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    null,
    2,
  )}\n`;
}

/** The product's name and description into index.html (%APP_NAME%, %APP_DESCRIPTION%) and manifest.webmanifest. */
function appIdentity(): Plugin {
  return {
    name: "app-identity",
    transformIndexHtml: (html) => html.replaceAll("%APP_NAME%", escapeHtml(APP_NAME)).replaceAll("%APP_DESCRIPTION%", escapeHtml(APP_DESCRIPTION)),
    configureServer(server) {
      server.middlewares.use("/manifest.webmanifest", (_req, res) => {
        res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
        res.end(webManifest());
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: webManifest() });
    },
  };
}

// The single-page app is built once and served by both targets:
// - web: Next.js serves `public/` on Vercel next to the API (/api/*)
// - desktop: the local server inside the Windows app serves the same files
export default defineConfig({
  root: r("./src/ui"),
  publicDir: r("./src/ui/static"),
  base: "/",
  plugins: [react(), tailwindcss(), appIdentity()],
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
