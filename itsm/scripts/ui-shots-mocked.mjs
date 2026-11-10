// Screenshots of the surfaces the Windows (desktop) server cannot show: the sign-in page with a directory (AD) source and
// «ورود خودکار با حساب ویندوز», the server edition's first-run setup wizard and «سلامت سرور» — the API answers mocked by
// Playwright (one AD source, a valid one-time setup token, four server workers). Run against a server ui-shots left
// running (it signs in with the same owner): light, dark and phone, PNGs into <outDir>; prints page and console errors.
//
//   node scripts/ui-shots.mjs --keep-server --port 4102 …  then
//   node scripts/ui-shots-mocked.mjs . http://127.0.0.1:4102 <outDir> owner@example.com Owner-pass-1405
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const [root, base, out, email, password] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const require = createRequire(join(root, "package.json"));
const { chromium } = require("playwright");
const browser = await chromium.launch();
const problems = [];

const options = {
  local: true,
  directory: { sources: [{ id: "src1", name: "بانک — دامنهٔ اصلی", domains: ["BANK", "bank.local"] }] },
  sso: { source_id: "src1", mode: "negotiate", auto: false },
};
const setupState = {
  required: true, valid: true, expired: false, public_url: "https://kariz.bank.local", directory_path: "/settings/integrations/directory",
  air_gapped: true, allow: ["mail.bank.local", "ai.bank.local"], backup_dir: "D:\\KarizBackups",
  cert: { subject: "CN=kariz.bank.local", names: ["kariz.bank.local"], valid_to: "2027-06-01T00:00:00Z", days_left: 203, self_signed: false }, self_signed: false, tls: true,
};
const now = new Date().toISOString();
const health = {
  ok: false, checked_at: now,
  checks: [
    { key: "db", title: "پایگاه داده", tone: "ok", value: "PostgreSQL 17 در دسترس است" },
    { key: "workers", title: "فرایندها", tone: "ok", value: "۴ فرایند از ۴ فرایند کار می‌کنند" },
    { key: "disk", title: "فضای دیسک", tone: "warning", value: "۱۲٪ فضای پوشهٔ پشتیبان‌ها آزاد است", detail: "پشتیبان‌های قدیمی را به جای دیگری منتقل کنید یا دیسک را بزرگ‌تر کنید." },
    { key: "cert", title: "گواهی", tone: "ok", value: "تا ۲۰۳ روز دیگر معتبر است" },
  ],
  versions: { app: "1.0.0", node: "22.12.0", postgres: "17.2" },
  db: { bytes: 2.4e9, connections: { total: 18, max: 200 }, cache_hit_ratio: 99.2, extensions: [{ name: "vector", version: "0.8.0" }, { name: "pg_stat_statements", version: "1.11" }],
    slow_statements: [{ query: "select * from sm_incident where org_id = $1 and active order by updated_at desc limit $2", calls: 1820, mean_ms: 42, total_ms: 76440, rows: 50 }], slow_note: null },
  disks: [{ key: "data", path: "C:\\ProgramData\\Kariz\\data", free: 180e9, total: 500e9 }, { key: "backups", path: "D:\\KarizBackups", free: 12e9, total: 100e9 }],
  queue: { due: 3, scheduled: 41, running: 1, failed_24h: 0, oldest_due_s: 4, top_kinds: [{ kind: "notify.deliver", n: 2 }] },
  workers: [0, 1, 2, 3].map((w) => ({ worker: w + 1, pid: 4100 + w, uptime_s: 86400, leader: w === 0, rss_mb: 310 + w * 12, loop_lag_ms: { p50: 1, p99: 6, max: 20 },
    requests: { total: 18000, errors: 2, in_flight: 1, per_min: 120 + w * 7, p95_ms: 84 }, db: { pool: 10, busy: 2, slow: 0 }, slow: [], last_tick: { at: now, ran: 3, failed: 0, ms: 40 } })),
  expected_workers: 4, restarts: 0,
  backup: { enabled: true, dir: "D:\\KarizBackups", time: "02:30", next: now, last: { ok: true, at: now, size: 1.1e9, verified: true, error: null }, count: 14 },
  certificate: { subject: "CN=kariz.bank.local", names: ["kariz.bank.local"], valid_to: "2027-06-01T00:00:00Z", days_left: 203, self_signed: false },
  network: { air_gapped: true, allow: ["mail.bank.local"], refused: [{ host: "update.example.com", at: now, via: "http" }] },
  sign_in: { failed_1h: 2, succeeded_1h: 64, locked_1h: 0, sources: [] }, trusted_proxies: [], public_url: "https://kariz.bank.local",
};

async function shot(name, url, { theme, mobile, routes, auth, wait }) {
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 375, height: 812 } : { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "fa-IR", timezoneId: "Asia/Tehran",
    colorScheme: theme, isMobile: !!mobile, hasTouch: !!mobile, storageState: auth,
  });
  await ctx.addInitScript((t) => { try { localStorage.setItem("itsm.theme", t); } catch {} }, theme);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`${name}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") problems.push(`${name} console: ${m.text().slice(0, 200)}`); });
  for (const [pattern, body] of routes) await page.route(pattern, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(typeof body === "function" ? body() : body) }));
  await page.goto(base + url, { waitUntil: "networkidle" });
  if (wait) await page.waitForSelector(wait, { timeout: 15000 }).catch((e) => problems.push(`${name}: ${e.message.split("\n")[0]}`));
  await page.waitForTimeout(600);
  const file = join(out, `${name}-${mobile ? "phone" : "desktop"}-${theme}.png`);
  await page.screenshot({ path: file });
  await ctx.close();
  return file;
}

// sign in once (for «سلامت سرور»)
const lc = await browser.newContext();
const lp = await lc.newPage();
await lp.goto(`${base}/login`);
await lp.locator('input[autocomplete="username"]').fill(email);
await lp.locator('input[autocomplete="current-password"]').fill(password);
await lp.locator('button[type="submit"]').click();
await lp.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
const auth = await lc.storageState();
await lc.close();

const meta = await (await fetch(`${base}/api/meta`)).json();
for (const theme of ["light", "dark"]) for (const mobile of [false, true]) {
  await shot("login-directory-sso", "/login", { theme, mobile, routes: [["**/api/auth/options**", options]], wait: "text=ورود خودکار با حساب ویندوز" });
  await shot("server-setup", "/setup?token=demo-token", { theme, mobile, routes: [["**/api/meta", { ...meta, mode: "cloud", edition: "server", first_run: true }], ["**/api/setup/state**", setupState]], wait: ".pg-form, form" });
  if (!mobile) await shot("server-health", "/admin/server", { theme, mobile, auth, routes: [["**/api/admin/server", health], ["**/api/meta", { ...meta, mode: "cloud", edition: "server" }]], wait: "text=بررسی‌ها" });
}
await browser.close();
console.log(problems.length ? problems.join("\n") : "no problems");
