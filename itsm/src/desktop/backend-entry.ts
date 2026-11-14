// Entry of the local server inside the Windows app (Electron utility process).
// Reports readiness to the main process and closes the database cleanly on shutdown.
import { flushCompileCache } from "node:module";
import { startLocal } from "./server";

type ParentPort = { postMessage(m: unknown): void; on(ev: "message", fn: (e: { data: any }) => void): void };
const parent = (process as unknown as { parentPort?: ParentPort }).parentPort;

async function main() {
  const dataDir = process.env.ITSM_DATA_DIR;
  const staticDir = process.env.ITSM_STATIC_DIR;
  if (!dataDir || !staticDir) throw new Error("ITSM_DATA_DIR / ITSM_STATIC_DIR missing");
  const port = process.env.ITSM_PORT ? Number(process.env.ITSM_PORT) : undefined;
  // ITSM_DB_TEMPLATE: the database made at build time, for a first start (desktop/src/main.ts sets it)
  const server = await startLocal({ dataDir, staticDir, port, template: process.env.ITSM_DB_TEMPLATE || undefined });
  const ready = { type: "ready", url: server.url, port: server.port, host: server.host };
  if (parent) parent.postMessage(ready);
  else console.log(JSON.stringify(ready));
  // the compiled code of this bundle (NODE_COMPILE_CACHE, set by desktop/src/main.ts) is on disk for the next start
  // now, not only when this process exits — it may be killed on its way out
  try {
    flushCompileCache?.();
  } catch {
    /* an optimisation only */
  }
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
  };
  parent?.on("message", (e) => {
    if (e?.data?.type === "shutdown") void shutdown();
  });
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((e) => {
  const message = String((e as Error)?.stack ?? e);
  console.error(message);
  parent?.postMessage({ type: "error", message: String((e as Error)?.message ?? e) });
  setTimeout(() => process.exit(1), 200);
});
