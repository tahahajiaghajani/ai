// Run the Windows flavour (embedded PostgreSQL + API + built UI) without Electron, e.g. for
// development or for a small office server:  npm run build:ui && npm run start:local -- [dataDir] [port]
import { startLocal } from "../src/desktop/server";

const dataDir = process.argv[2] ?? ".local-data";
const port = Number(process.argv[3] ?? 3939);
const server = await startLocal({ dataDir, staticDir: "public", port });
console.log(`ready ${server.url}`);
const stop = async () => {
  await server.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
