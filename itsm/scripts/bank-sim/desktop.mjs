// The Windows app on the bank's intranet, headless (docs/qa/BANK_SIM_FA.md, scenario 12): the desktop flavour's local
// server (src/desktop/server.ts through scripts/serve-local.mts: embedded database, the sync client, the same code the
// Kariz-Setup app runs in its utility process) started with --use-system-ca as the app starts its backend
// (src/shared/desktop/node-flags.ts), linked to https://kariz.bank.local through its own API (/api/local/cloud/*, what
// «اتصال به سرور» does), then one sync round trip: the server's records come down, a record written on the PC goes up.
//
//   node --use-system-ca desktop.mjs --base https://kariz.bank.local --state state.json --out x.json --data <dir>
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Api, Checks, State, parseArgs, sleep, log, ADMIN } from "./lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const a = parseArgs();
const BASE = String(a.base ?? "https://kariz.bank.local");
const state = new State(a.state ? String(a.state) : null);
const C = new Checks("desktop", a.out ? String(a.out) : null);
const data = String(a.data ?? join(ROOT, ".bank-sim-desktop"));
mkdirSync(data, { recursive: true });

await C.run(async () => {
  const port = Number(a.port ?? 3949);
  // tsx as a loader in this one process: its command line forks a child Node.js without --use-system-ca, which then
  // cannot trust the bank's CA (the Windows app's own backend gets the flag from src/shared/desktop/node-flags.ts)
  const child = spawn(process.execPath, ["--use-system-ca", "--import", "tsx", "scripts/serve-local.mts", data, String(port)], { cwd: ROOT, env: { ...process.env, NODE_OPTIONS: "" }, stdio: ["ignore", "pipe", "pipe"] });
  let url = null;
  child.stdout.on("data", (d) => {
    const s = d.toString();
    process.stdout.write(`[desktop] ${s}`);
    const m = /ready (http\S+)/.exec(s);
    if (m) url = m[1];
  });
  child.stderr.on("data", (d) => process.stdout.write(`[desktop:err] ${d}`));
  try {
    const until = Date.now() + 180_000;
    while (!url && Date.now() < until && child.exitCode === null) await sleep(500);
    C.check(!!url, "the Windows app's local server starts (embedded database)", url ?? `exit ${child.exitCode}`);
    if (!url) return;
    const desk = new Api(url);
    const org = state.get("org");
    const orgs = await desk.post("/local/cloud/orgs", { url: BASE, email: ADMIN.email, password: ADMIN.password });
    C.check((orgs.orgs ?? []).some((o) => o.id === org), "the app reaches https://kariz.bank.local and lists the bank's organisation (TLS via the Windows store)", JSON.stringify(orgs).slice(0, 300));
    const t0 = Date.now();
    // the app's own API while the first sync downloads the organisation (docs/qa/PERFORMANCE_E2E_FA.md): a request the
    // window makes every 250 ms (/api/health reads the database), timed — how long a click would wait behind the sync
    const probe = { on: true, ms: [] };
    const probing = (async () => {
      while (probe.on) {
        const t = Date.now();
        await desk.raw("GET", "/health").catch(() => null);
        probe.ms.push(Date.now() - t);
        await sleep(250);
      }
    })();
    const linked = await desk.post("/local/cloud/link", { url: BASE, email: ADMIN.email, password: ADMIN.password, org_id: org, direction: "download" });
    probe.on = false;
    await probing;
    const sorted = [...probe.ms].sort((x, y) => x - y);
    const during = { samples: sorted.length, p50_ms: sorted[Math.floor(sorted.length / 2)] ?? null, p95_ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? null, max_ms: sorted.at(-1) ?? null };
    C.metric("api_during_first_sync", during);
    C.check(linked.ok === true, `the app links to the server and downloads the organisation (${Math.round((Date.now() - t0) / 1000)} s; the app's API meanwhile p50 ${during.p50_ms} ms, p95 ${during.p95_ms} ms, max ${during.max_ms} ms)`, JSON.stringify(linked).slice(0, 300));
    await desk.post("/auth/login", { email: ADMIN.email, password: ADMIN.password });
    const inc = state.get("incident");
    const local = await desk.get(`/o/${org}/r/incident/${inc.id}`, null);
    C.check(local?.row?.number === inc.number, `the server's incident ${inc.number} is on the PC`, JSON.stringify(local).slice(0, 200));
    const mark = `ثبت در برنامهٔ ویندوز ${Date.now()}`;
    const made = (await desk.post(`/o/${org}/r/incident`, { short_description: mark })).row;
    C.check(!!made?.id, "an incident is written on the PC");
    const server = new Api(BASE);
    await server.signIn(ADMIN.email, ADMIN.password, state);
    let up = null;
    const t1 = Date.now();
    for (let i = 0; i < 30 && !up; i++) {
      await desk.raw("POST", "/local/sync");
      const r = await server.raw("GET", `/o/${org}/r/incident/${made.id}`);
      if (r.status === 200) up = r.json.row;
      else await sleep(2000);
    }
    C.check(up?.short_description === mark, `the PC's incident reaches the server (${Math.round((Date.now() - t1) / 1000)} s)`, up ? up.number : "not on the server");
    const st = await desk.get("/local/sync", null);
    C.metric("sync_status", st);
  } finally {
    child.kill();
    log("desktop: stopped");
  }
});
