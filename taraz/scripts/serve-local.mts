// Run the desktop flavour (embedded PostgreSQL + API + built SPA) without Electron:
//   npx tsx scripts/serve-local.mts [dataDir] [port]
import { startLocal } from "../src/desktop/server";
const dataDir = process.argv[2] ?? ".local-data";
const port = Number(process.argv[3] ?? 3939);
const s = await startLocal({ dataDir, staticDir: "public", port });
console.log(`ready ${s.url}`);
process.on("SIGINT", async () => { await s.close(); process.exit(0); });
process.on("SIGTERM", async () => { await s.close(); process.exit(0); });
