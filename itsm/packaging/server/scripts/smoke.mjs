// Smoke test of an installed server edition, through its public API only (Node built-ins: runs with the bundled
// node.exe on the air-gapped CI machine). Two phases:
//   node smoke.mjs --phase first --base https://kariz.ci.local --ca <self-signed.crt> --setup-file <setup-url.txt> --state <state.json>
//     readiness, the setup gate, first-run setup through its API, sign-in, an incident created and opened, the air gap
//     refusing an internet AI service, «سلامت سرور» for the platform administrator
//   node smoke.mjs --phase after-upgrade --base … --ca … --state <state.json>
//   (--connect <address> reaches the server by address when the host name does not resolve on this machine)
//     the same server after a re-install or an upgrade: setup not offered again, sign-in, the incident still there
import { request } from "node:https";
import { readFileSync, writeFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]?.startsWith("--") ? true : all[i + 1]]] : acc), []),
);
const base = new URL(String(args.base));
const ca = args.ca ? readFileSync(String(args.ca), "utf8") : undefined;
let cookie = "";
let failures = 0;

const log = (m) => process.stdout.write(`${new Date().toISOString()} ${m}\n`);
function check(ok, what, detail = "") {
  if (ok) log(`ok   ${what}`);
  else {
    failures++;
    log(`FAIL ${what}${detail ? ` — ${detail}` : ""}`);
  }
  return ok;
}

function call(method, path, body) {
  return new Promise((resolve, reject) => {
    const req = request(
      // --connect 127.0.0.1 reaches the server by address while TLS and Host still name the public host (like curl --resolve)
      { host: args.connect ? String(args.connect) : base.hostname, port: base.port || 443, path: `/api${path}`, method, ca, servername: base.hostname, timeout: 60_000, headers: { host: base.host, "content-type": "application/json", ...(cookie ? { cookie } : {}) } },
      (res) => {
        const set = res.headers["set-cookie"];
        if (set?.length) cookie = set[0].split(";")[0];
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (d) => (text += d));
        res.on("end", () => {
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = { raw: text.slice(0, 300) };
          }
          resolve({ status: res.statusCode ?? 0, json, headers: res.headers });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

async function waitReady() {
  const until = Date.now() + 180_000;
  let last = "";
  while (Date.now() < until) {
    try {
      const r = await call("GET", "/ready");
      if (r.status === 200 && r.json?.ok) return true;
      last = JSON.stringify(r.json);
    } catch (e) {
      last = e.message;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  log(`not ready: ${last}`);
  return false;
}

const PASSWORD = "Kariz-Smoke-Pass-1405!";
const EMAIL = "admin@ci.bank.local";

async function first() {
  check(await waitReady(), "the server is ready (TLS with its certificate, database, migrations)");
  const r0 = await call("GET", "/ready");
  check(r0.headers["strict-transport-security"]?.includes("max-age"), "HSTS header");
  check(!/https?:\/\/(?!'self')/.test(String(r0.headers["content-security-policy"] ?? "")), "CSP names no external origin");
  const meta = (await call("GET", "/meta")).json;
  check(meta?.edition === "server" && meta?.first_run === true && meta?.server?.air_gapped === true, "meta: server edition, first run, air-gapped", JSON.stringify(meta));
  const gated = await call("GET", "/orgs");
  check(gated.status === 503 && gated.json?.error?.code === "setup_required", "every API stays closed until the setup is done", `${gated.status}`);
  const url = readFileSync(String(args["setup-file"]), "utf8").trim();
  const token = new URL(url).searchParams.get("token");
  check(!!token, "the installer issued a one-time setup address", url.replace(/token=.*/, "token=…"));
  const state = (await call("GET", `/setup/state?token=${encodeURIComponent(token)}`)).json;
  check(state?.valid === true, "the setup token is valid", JSON.stringify(state));
  const done = await call("POST", "/setup/complete", {
    token,
    org: { name: "بانک آزمایشی CI" },
    admin: { full_name: "مدیر فناوری", email: EMAIL, password: PASSWORD },
    public_url: base.origin,
    ai: [{ base_url: "http://127.0.0.1:11434/v1", kind: "ollama" }],
  });
  check(done.status === 200 && done.json?.org_id, "first-run setup through its API", JSON.stringify(done.json));
  const again = await call("POST", "/setup/complete", { token, org: { name: "x" }, admin: { full_name: "xx", email: "x@x.local", password: PASSWORD }, public_url: base.origin });
  check(again.status === 409 || again.status === 403, "the setup address works only once", `${again.status}`);
  cookie = "";
  const login = await call("POST", "/auth/login", { email: EMAIL, password: PASSWORD });
  check(login.status === 200, "sign-in", JSON.stringify(login.json));
  const org = done.json?.org_id;
  const inc = await call("POST", `/o/${org}/r/incident`, { short_description: "آزمون دود: چاپگر شعبه کار نمی‌کند" });
  check(inc.status === 200 && inc.json?.row?.id, "an incident is created", JSON.stringify(inc.json).slice(0, 300));
  const id = inc.json?.row?.id;
  const open = await call("GET", `/o/${org}/r/incident/${id}`);
  check(open.status === 200 && open.json?.row?.number, "the incident opens", JSON.stringify(open.json).slice(0, 200));
  const blocked = await call("POST", `/o/${org}/ai/connections`, { preset: "custom-openai", base_url: "https://api.openai.com/v1", key: "sk-smoke-1234567890", protocol: "openai-chat" });
  check(blocked.status === 400 && String(blocked.json?.error?.message ?? "").includes("شبکهٔ بسته"), "the air gap refuses an internet AI service with a Persian message", JSON.stringify(blocked.json));
  const health = await call("GET", "/admin/server");
  check(health.status === 200 && Array.isArray(health.json?.checks), "«سلامت سرور» answers the platform administrator", `${health.status}`);
  for (const c of health.json?.checks ?? []) log(`     ${c.tone.padEnd(7)} ${c.key}: ${c.value}`);
  writeFileSync(String(args.state), JSON.stringify({ org, id, email: EMAIL }, null, 2));
}

async function afterUpgrade() {
  const saved = JSON.parse(readFileSync(String(args.state), "utf8"));
  check(await waitReady(), "the server is ready again");
  const meta = (await call("GET", "/meta")).json;
  check(meta?.first_run === false, "the data survived: not a first run", JSON.stringify(meta));
  const login = await call("POST", "/auth/login", { email: saved.email, password: PASSWORD });
  check(login.status === 200, "sign-in with the same account");
  const open = await call("GET", `/o/${saved.org}/r/incident/${saved.id}`);
  check(open.status === 200, "the incident is still there");
  const more = await call("POST", `/o/${saved.org}/r/incident`, { short_description: "پس از ارتقا" });
  check(more.status === 200, "writes work after the upgrade");
}

try {
  if (args.phase === "after-upgrade") await afterUpgrade();
  else await first();
} catch (e) {
  failures++;
  log(`FAIL ${e.stack ?? e}`);
}
log(failures ? `${failures} check(s) failed` : "all checks passed");
process.exit(failures ? 1 : 0);
