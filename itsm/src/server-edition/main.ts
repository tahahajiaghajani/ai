// Entry of the server edition (bundled as app\server.cjs, run by the KarizApp service: node.exe server.cjs).
//   node server.cjs                 supervisor + workers (default)
//   node server.cjs --standalone    one process (development, diagnostics)
// The configuration file comes from ITSM_SERVER_CONFIG (default C:\ProgramData\Kariz\kariz.json).
import cluster from "node:cluster";
import { defaultConfigFile } from "./config";
import { runPrimary } from "./cluster";
import { FatalConfigError, startServerEdition, type RunningServer } from "./worker";
import { EXIT_FATAL_CONFIG } from "./names";

const file = process.env.ITSM_SERVER_CONFIG || defaultConfigFile();

async function runWorker(standalone: boolean) {
  let server: RunningServer | null = null;
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await server?.close().catch(() => undefined);
    process.exit(0);
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) process.on(sig, () => void stop());
  process.on("message", (m: { t?: string }) => {
    if (m?.t === "shutdown") void stop();
  });
  process.on("unhandledRejection", (e) => {
    process.stderr.write(`unhandled rejection: ${String((e as Error)?.stack ?? e)}\n`);
  });
  try {
    server = await startServerEdition({ file, workerId: standalone ? 0 : Number(process.env.ITSM_WORKER_ID ?? 1), ipc: !standalone, migrate: standalone });
    if (standalone) process.stdout.write(`server edition running: ${server.https ?? server.http}\n`);
  } catch (e) {
    process.stderr.write(`server edition failed to start: ${String((e as Error)?.stack ?? e)}\n`);
    process.exit(e instanceof FatalConfigError ? EXIT_FATAL_CONFIG : 1);
  }
}

if (process.argv.includes("--standalone") || process.env.ITSM_STANDALONE === "1") void runWorker(true);
else if (cluster.isPrimary) void runPrimary(file);
else void runWorker(false);
