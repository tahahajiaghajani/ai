import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@shared": r("./src/shared"),
      "@server": r("./src/server"),
      "@ui": r("./src/ui"),
      "@local": r("./src/desktop"),
    },
  },
  test: { include: ["tests/**/*.test.ts"], environment: "node", testTimeout: 60000, hookTimeout: 60000, pool: "forks" },
});
