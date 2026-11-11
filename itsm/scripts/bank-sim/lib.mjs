// Shared helpers of the bank simulation's Node scripts (docs/qa/BANK_SIM_FA.md): arguments, a HTTPS client of the
// installed server that trusts only what Windows trusts (the scripts run with `node --use-system-ca`; nothing here
// ever turns certificate checks off), a cookie per account, checks that end in a JSON result file, and the state
// shared between phases (ids, hashes, sessions).
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = true;
  }
  return out;
}

const t0 = Date.now();
export const log = (m) => process.stdout.write(`${new Date().toISOString()} ${m}\n`);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Checks of one phase: printed as they happen and written to --out as JSON (the PowerShell report reads it). */
export class Checks {
  constructor(phase, out) {
    this.phase = phase;
    this.out = out;
    this.items = [];
    this.metrics = {};
    this.notes = [];
  }
  check(ok, what, detail = "") {
    const d = typeof detail === "string" ? detail : JSON.stringify(detail);
    this.items.push({ ok: !!ok, what, detail: d.slice(0, 1500) });
    log(`${ok ? "ok  " : "FAIL"} ${what}${!ok && d ? ` — ${d.slice(0, 800)}` : ""}`);
    return !!ok;
  }
  note(m) {
    this.notes.push(m);
    log(`note ${m}`);
  }
  metric(k, v) {
    this.metrics[k] = v;
    log(`metric ${k} = ${typeof v === "object" ? JSON.stringify(v) : v}`);
  }
  get failures() {
    return this.items.filter((x) => !x.ok).length;
  }
  save(extra = {}) {
    if (!this.out) return;
    mkdirSync(dirname(this.out), { recursive: true });
    writeFileSync(this.out, JSON.stringify({ phase: this.phase, seconds: Math.round((Date.now() - t0) / 100) / 10, failures: this.failures, checks: this.items, metrics: this.metrics, notes: this.notes, ...extra }, null, 2));
  }
  /** Run the phase; any exception is a failed check; exits 1 when something failed. */
  async run(fn) {
    try {
      await fn(this);
    } catch (e) {
      this.check(false, "the phase ran to its end", e?.stack ?? String(e));
    }
    this.save();
    log(this.failures ? `${this.failures} check(s) failed in ${this.phase}` : `all ${this.items.length} checks passed in ${this.phase}`);
    process.exit(this.failures ? 1 : 0);
  }
}

export class State {
  constructor(file) {
    this.file = file;
    this.data = file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  }
  get(k, d = undefined) {
    return this.data[k] ?? d;
  }
  set(k, v) {
    this.data[k] = v;
    this.save();
  }
  save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }
}

/**
 * A client of the installed server at `base` (https://kariz.bank.local): the host name resolves through the hosts file
 * to the server's LAN address and the certificate is checked against the Windows store (--use-system-ca).
 */
export class Api {
  constructor(base, { cookie = "", timeoutMs = 120_000 } = {}) {
    this.base = new URL(base);
    this.cookie = cookie;
    this.timeoutMs = timeoutMs;
  }
  raw(method, path, { body, headers = {}, raw = false, prefix = "/api" } = {}) {
    const u = new URL(`${prefix}${path}`, this.base);
    const isBuf = Buffer.isBuffer(body);
    const payload = body === undefined ? undefined : isBuf ? body : JSON.stringify(body);
    const req = u.protocol === "https:" ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      const r = req(
        u,
        {
          method,
          timeout: this.timeoutMs,
          headers: { ...(isBuf ? {} : { "content-type": "application/json" }), ...(this.cookie ? { cookie: this.cookie } : {}), ...(payload !== undefined ? { "content-length": Buffer.byteLength(payload) } : {}), ...headers },
        },
        (res) => {
          const set = res.headers["set-cookie"];
          if (set?.length) {
            const c = set.find((x) => /^[^=]+=[^;]+/.test(x) && !/=;/.test(x));
            if (c) this.cookie = c.split(";")[0];
          }
          const chunks = [];
          res.on("data", (d) => chunks.push(d));
          res.on("end", () => {
            const buf = Buffer.concat(chunks);
            if (raw) return resolve({ status: res.statusCode ?? 0, headers: res.headers, body: buf, json: null });
            const text = buf.toString("utf8");
            let json = null;
            try {
              json = text ? JSON.parse(text) : null;
            } catch {
              json = { raw: text.slice(0, 400) };
            }
            resolve({ status: res.statusCode ?? 0, headers: res.headers, json, body: buf });
          });
          res.on("error", reject);
        },
      );
      r.on("timeout", () => r.destroy(new Error(`timeout ${method} ${path}`)));
      r.on("error", reject);
      r.end(payload);
    });
  }
  async call(method, path, body, expect = 200) {
    const r = await this.raw(method, path, { body });
    if (expect !== null && r.status !== expect) throw Object.assign(new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(r.json)?.slice(0, 600)}`), { status: r.status, json: r.json });
    return r.json;
  }
  get = (p, expect) => this.call("GET", p, undefined, expect);
  post = (p, b = {}, expect) => this.call("POST", p, b, expect);
  patch = (p, b = {}, expect) => this.call("PATCH", p, b, expect);
  put = (p, b = {}, expect) => this.call("PUT", p, b, expect);

  /** multipart/form-data with one file field */
  async upload(path, field, name, type, data) {
    const boundary = `----kariz-bank-sim-${randomUUID()}`;
    const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`, "utf8");
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
    const r = await this.raw("POST", path, { body: Buffer.concat([head, data, tail]), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } });
    if (r.status !== 200) throw new Error(`upload ${path} → ${r.status}: ${JSON.stringify(r.json)?.slice(0, 400)}`);
    return r.json;
  }

  /** Sign in with e-mail and password; reuses a session saved in the state when it is still valid. */
  async signIn(email, password, state = null) {
    const saved = state?.get("sessions", {})[email];
    if (saved) {
      this.cookie = saved;
      const me = await this.raw("GET", "/auth/me");
      if (me.status === 200 && me.json?.user?.email?.toLowerCase() === email.toLowerCase()) return me.json;
    }
    this.cookie = "";
    const r = await this.raw("POST", "/auth/login", { body: { email, password } });
    if (r.status !== 200) throw Object.assign(new Error(`sign-in ${email} → ${r.status}: ${JSON.stringify(r.json)?.slice(0, 300)}`), { status: r.status, json: r.json });
    if (state) state.set("sessions", { ...state.get("sessions", {}), [email]: this.cookie });
    return r.json;
  }
}

/** Wait until /api/ready answers 200 with ok; returns the milliseconds it took (or throws after `ms`). */
export async function waitReady(base, ms = 300_000) {
  const api = new Api(base, { timeoutMs: 10_000 });
  const start = Date.now();
  let last = "";
  while (Date.now() - start < ms) {
    try {
      let r = await api.raw("GET", "/ready");
      // the desktop flavour (a local dry run of these scripts) has no /ready: its /health then
      if (r.status === 404) r = await api.raw("GET", "/health");
      if (r.status === 200 && r.json?.ok) return Date.now() - start;
      last = `${r.status} ${JSON.stringify(r.json)}`;
    } catch (e) {
      last = e.message;
    }
    await sleep(1000);
  }
  throw new Error(`not ready after ${Math.round(ms / 1000)} s: ${last}`);
}

export const PASSWORD = "Bank-Sim-Pass-1405!";
export const ADMIN = { email: "it.admin@bank.local", full_name: "مدیر فناوری اطلاعات", password: PASSWORD };
/** The bank's people created by the administrator (local accounts; AD people come from the directory). */
export const PEOPLE = [
  { key: "agent1", email: "agent1@bank.local", full_name: "کارشناس میز خدمت یک", preset: "agent" },
  { key: "agent2", email: "agent2@bank.local", full_name: "کارشناس میز خدمت دو", preset: "agent" },
  { key: "agent3", email: "agent3@bank.local", full_name: "کارشناس شبکه", preset: "agent" },
  { key: "requester", email: "branch.staff@bank.local", full_name: "کارمند شعبهٔ مرکزی", preset: "requester" },
];
