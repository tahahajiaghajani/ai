// The bank simulation's API client (docs/qa/BANK_SIM_FA.md): one phase per call, run by
// packaging/server/scripts/bank-sim/bank-sim.ps1 with `node --use-system-ca` (the bank's root CA is trusted through the
// Windows store; certificate checks are never turned off). Every phase writes its checks to --out and shares ids,
// hashes and sessions through --state.
//
//   node --use-system-ca api.mjs --phase <name> --base https://kariz.bank.local --state state.json --out phase.json [...]
//
// Phases:
//   fresh        the installed server before its first-run setup: ready, server edition, air gap, the setup gate
//   populate     after the setup (done in the browser): members, a team, an incident with an attachment, a change, a
//                catalogue order, a knowledge article, Active Directory sign-in (LDAPS) and a notification e-mail
//   notify       (re)point the e-mail channel (--smtp-port, --smtp-security) and prove one notification reaches the relay
//   verify       after an upgrade / restore / re-install: version, sync protocol, every record, the attachment's bytes,
//                members' and AD sign-in, the e-mail channel (--expect-version, --expect-protocol)
//   security     HTTP→HTTPS, HSTS, cookies, TLS 1.0/1.1 refused and 1.2/1.3 accepted, PostgreSQL closed on the LAN
//                address, the setup token single-use, no external origin in the CSP
//   demo-on      after `karizctl demo load`: banner, demo sign-in turned on, a persona signs in; writes the persona
//   demo-off     after `karizctl demo purge`: banner gone, the persona cannot sign in, the real records intact
//   mark         records written after the backup (what the DR drill must lose: RPO)
//   dr           after `karizctl restore`: what the backup had is back, what came later is gone
//   ready        wait for /api/ready and report how long it took (--timeout seconds)
//   load         --users N --seconds S: mixed load (list, search, open, create, update) with p50/p95/p99
import { connect as tlsConnect } from "node:tls";
import { Socket } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { request as httpRequest } from "node:http";
import { Api, Checks, State, parseArgs, waitReady, sleep, log, ADMIN, PEOPLE, PASSWORD } from "./lib.mjs";
import { SERVER_BUDGETS } from "./perf.mjs";

const a = parseArgs();
const BASE = String(a.base ?? "https://kariz.bank.local");
const state = new State(a.state ? String(a.state) : null);
const C = new Checks(String(a.phase), a.out ? String(a.out) : null);
const sha = (b) => createHash("sha256").update(b).digest("hex");

async function admin() {
  const api = new Api(BASE);
  await api.signIn(ADMIN.email, ADMIN.password, state);
  return api;
}
const orgOf = () => state.get("org");

/** Messages the relay received for `to` after `since` (ms), waiting up to `ms`. */
async function mailFor(to, since, ms = 120_000) {
  const file = String(a["mail-file"] ?? "");
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (file && existsSync(file)) {
      const got = readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .filter((m) => m.rcpt.includes(to.toLowerCase()) && Date.parse(m.at) >= since);
      if (got.length) return got;
    }
    await sleep(2000);
  }
  return [];
}

async function members(api, org) {
  return (await api.get(`/o/${org}/members`)).members ?? [];
}

// ------------------------------------------------------------------------------------------------- phases

async function fresh() {
  const ms = await waitReady(BASE, 300_000);
  C.check(true, `the server is ready over HTTPS with the bank's certificate (${ms} ms)`);
  const api = new Api(BASE);
  const meta = (await api.raw("GET", "/meta")).json;
  C.check(meta?.edition === "server", "meta: the server edition", JSON.stringify(meta));
  C.check(meta?.first_run === true, "meta: first run (no account yet)");
  C.check(meta?.server?.air_gapped === true, "meta: air-gapped (AIRGAPPED=1 by default)", JSON.stringify(meta?.server));
  C.metric("version_installed", meta?.version);
  C.metric("sync_protocol_installed", meta?.sync_protocol);
  const gated = await api.raw("GET", "/orgs");
  C.check(gated.status === 503 && gated.json?.error?.code === "setup_required", "every API stays closed until the setup is done", `${gated.status}`);
  const signup = await api.raw("POST", "/auth/signup", { body: { email: "intruder@bank.local", password: PASSWORD, full_name: "نفوذگر" } });
  C.check(signup.status >= 400, "nobody on the network can make the first account through sign-up", `${signup.status}`);
  const url = readFileSync(String(a["setup-file"]), "utf8").trim();
  const u = new URL(url);
  C.check(u.origin === new URL(BASE).origin, "setup-url.txt names the bank's address", u.origin);
  const token = u.searchParams.get("token");
  const st = (await api.raw("GET", `/setup/state?token=${encodeURIComponent(token ?? "")}`)).json;
  C.check(st?.valid === true && st?.required === true, "the one-time setup address is valid", JSON.stringify(st));
  C.check(st?.cert && st.cert.self_signed === false, "the server already serves the bank's certificate (CERTPATH)", JSON.stringify(st?.cert));
  state.set("setup_url", url);
  state.set("setup_token", token);
}

async function populate() {
  const api = await admin();
  const orgs = (await api.get("/orgs")).orgs ?? [];
  C.check(orgs.length === 1, "the setup made one organisation", JSON.stringify(orgs.map((o) => o.name)));
  const org = orgs[0].id;
  state.set("org", org);
  const P = `/o/${org}`;
  const me = (await api.get("/auth/me")).user;
  state.set("admin_id", me.id);

  // members: local accounts the administrator creates (agents with the «کارشناس پشتیبانی» preset, a branch employee)
  const ids = {};
  for (const p of PEOPLE) {
    let m = (await members(api, org)).find((x) => x.email === p.email);
    if (!m) {
      await api.post(`${P}/members`, { email: p.email, full_name: p.full_name, role: "member", password: PASSWORD });
      m = (await members(api, org)).find((x) => x.email === p.email);
    }
    await api.post(`${P}/access/members/${m.user_id}/preset`, { preset: p.preset });
    ids[p.key] = m.user_id;
  }
  state.set("people", ids);
  C.check(Object.keys(ids).length === PEOPLE.length, `${PEOPLE.length} members created with their access presets`);

  // a team with the agents (assignment group)
  const team = (await api.post(`${P}/r/group`, { name: "میز خدمت ستاد", types: ["assignment"] })).row.id;
  await api.post(`${P}/access/groups/${team}/members`, { user_ids: [ids.agent1, ids.agent2, ids.agent3] });
  state.set("team", team);
  C.check(!!team, "an assignment group with the three agents");

  // an incident with an attachment (random bytes, checked byte for byte after the upgrade and the restore)
  const inc = (await api.post(`${P}/r/incident`, { short_description: "خودپرداز شعبهٔ مرکزی کارت را پس نمی‌دهد", description: "شبیه‌سازی نصب بانک", impact: "2", urgency: "2", caller_id: ids.requester })).row;
  const file = randomBytes(256 * 1024);
  const att = await api.upload(`${P}/r/incident/${inc.id}/attachments`, "file", "atm-log-1405.bin", "application/octet-stream", file);
  C.check(!!att.attachment?.id, "an attachment is uploaded to the incident", JSON.stringify(att).slice(0, 300));
  state.set("incident", { id: inc.id, number: inc.number, attachment: att.attachment?.id, sha256: sha(file), size: file.length });

  // a change and a knowledge article
  const chg = (await api.post(`${P}/r/change_request`, { short_description: "به‌روزرسانی سیستم‌عامل خودپردازهای استان تهران", type: "normal" })).row;
  state.set("change", { id: chg.id, number: chg.number });
  C.check(!!chg.number, "a change request is created", chg.number);
  // Active Directory: LDAPS to dc1.bank.local with the bank's root CA pasted as the guide says (docs/AD_FA.md §2-3)
  const info = JSON.parse(readFileSync(String(a["ldap-info"]), "utf8"));
  const ca = readFileSync(String(a["ca-pem"]), "utf8");
  const src = (
    await api.post(`${P}/r/directory_source`, {
      name: "اکتیو دایرکتوری بانک",
      kind: "ldap",
      mode: "apply",
      ldap_url: "ldaps://dc1.bank.local:636",
      tls_mode: "ldaps",
      ca_cert: ca,
      bind_dn: info.service_dn,
      bind_password: info.service_password,
      base_dn: info.base,
      login_enabled: true,
      login_domains: ["CORP", "corp.test"],
      default_role: "requester",
      auto_roles: true,
      timeout_seconds: 10,
      group_map: [{ source: info.agents_group, role: "agent", group_id: team }],
    })
  ).row;
  state.set("directory", { id: src.id });
  const test = await api.post(`${P}/integration/directory/${src.id}/test`);
  C.check(test.ok === true, "«آزمایش اتصال» reaches the domain controller over LDAPS (allow-list from the setup, bank CA)", JSON.stringify(test).slice(0, 600));
  await api.post("/auth/reauth", { password: ADMIN.password });
  const approved = await api.raw("POST", `${P}/integration/directory/${src.id}/approve`, { body: {} });
  C.check(approved.status === 200, "the administrator approves the source (re-authenticated)", `${approved.status} ${JSON.stringify(approved.json).slice(0, 300)}`);
  await adSignIn("ali", "agent");
  await adSignIn("sara", null);

  // the modules' defaults (knowledge bases, the IT catalogue) come from background jobs: 1.1.0 runs them right after
  // the setup; 1.0.0 queued them 10-12 minutes later (finding). Waited for two minutes, then the on-demand seeds an
  // administrator finds on those pages («افزودن پیش‌فرض‌ها») are used.
  const seededNow = async () => ((await api.post(`${P}/r/kb_base/query`, { size: 1, total: false })).rows ?? []).length > 0 && ((await api.get(`${P}/request/catalog`)).items ?? []).length > 0;
  const t0 = Date.now();
  let seeded = false;
  while (Date.now() - t0 < Number(a["seed-wait"] ?? 120) * 1000 && !(seeded = await seededNow())) await sleep(10_000);
  const waited = Math.round((Date.now() - t0) / 1000);
  if (!seeded) {
    C.note(`the modules' defaults were not there ${waited} s after the setup: seeded on demand (knowledge, catalogue)`);
    C.metric("seeds_on_demand", true);
    await api.post(`${P}/knowledge/seed`, {});
    await api.post(`${P}/request/seed`, {});
    seeded = await seededNow();
  } else C.metric("seeds_after_s", waited);
  C.check(seeded, "the modules' defaults (knowledge bases, IT catalogue) are there");
  const base = (await api.post(`${P}/r/kb_base/query`, { size: 1, total: false })).rows?.[0]?.id;
  // the knowledge editor's «مقالهٔ تازه» (an article with its first draft version)
  const kb = (await api.post(`${P}/knowledge/articles`, { base_id: base, title: "راهنمای بازگرداندن کارت گیرکرده در خودپرداز", summary: "گام‌های کارشناس شعبه", body: "۱. دستگاه را در حالت نگهداری بگذارید.\n۲. کارت را از مسیر کارت‌خوان بردارید." })).article;
  state.set("kb", { id: kb.id, number: kb.number });
  C.check(!!kb.id, "a knowledge article is created", kb.number);

  // a catalogue order by the branch employee (the first orderable item that needs no answer)
  const staff = new Api(BASE);
  await staff.signIn(PEOPLE[3].email, PASSWORD, state);
  const cat = await staff.get(`${P}/request/catalog`);
  let ordered = null;
  // the first item whose questions are all free text («درخواست دیگر»: subject and details), answered as a person would
  const items = (cat.items ?? []).filter((x) => x.orderable && x.type !== "order_guide");
  items.sort((x, y) => (y.name === "درخواست دیگر") - (x.name === "درخواست دیگر"));
  for (const it of items) {
    const answers = {};
    let chk = await staff.raw("POST", `${P}/request/catalog/items/${it.id}/check`, { body: { answers } });
    for (const k of Object.keys(chk.json?.errors ?? {})) answers[k] = "کارت‌خوان خودپرداز شعبهٔ مرکزی تعویض شود";
    if (Object.keys(answers).length) chk = await staff.raw("POST", `${P}/request/catalog/items/${it.id}/check`, { body: { answers } });
    if (chk.status !== 200 || (chk.json?.errors && Object.keys(chk.json.errors).length)) continue;
    const r = await staff.raw("POST", `${P}/request/order`, { body: { lines: [{ item_id: it.id, answers }] } });
    if (r.status === 200) {
      ordered = { item: it.name, json: r.json };
      break;
    }
  }
  const reqId = ordered?.json?.request?.id ?? ordered?.json?.id ?? ordered?.json?.requests?.[0]?.id ?? null;
  C.check(!!ordered, "the branch employee orders a catalogue item", ordered ? `${ordered.item}: ${JSON.stringify(ordered.json).slice(0, 300)}` : `${(cat.items ?? []).length} items`);
  if (ordered) {
    const mine = (await staff.post(`${P}/r/request/query`, { size: 5, total: false })).rows ?? [];
    state.set("request", { id: reqId ?? mine[0]?.id, number: mine[0]?.number, item: ordered.item });
  }
}

/** Sign in as CORP\<sam> through Active Directory; `role` the role the mapping must give (agent). */
async function adSignIn(sam, role) {
  const ad = new Api(BASE);
  const r = await ad.raw("POST", "/auth/directory", { body: { login: `CORP\\${sam}`, password: "Passw0rd!" } });
  C.check(r.status === 200, `CORP\\${sam} signs in with the directory password (LDAPS bind)`, `${r.status} ${JSON.stringify(r.json).slice(0, 400)}`);
  if (r.status !== 200) return;
  const me = await ad.get("/auth/me");
  C.check(!!me.user?.id, `CORP\\${sam} has a session`, me.user?.email);
  if (role) {
    const org = orgOf();
    const acc = await ad.raw("GET", `/o/${org}/access/me`);
    const roles = acc.json?.roles ?? [];
    C.check(acc.status === 200 && roles.includes(role), `CORP\\${sam} got the role «${role}» from the Kariz-Agents group (nested)`, JSON.stringify(roles));
  }
  const bad = await new Api(BASE).raw("POST", "/auth/directory", { body: { login: `CORP\\${sam}`, password: "wrong-password" } });
  C.check(bad.status >= 400, `a wrong AD password is refused for CORP\\${sam}`, `${bad.status}`);
}

/** Assign a fresh incident to `who` and wait for the «ارجاع به کارشناس» e-mail at the relay. */
async function notify(api, who, { mayFail = false } = {}) {
  const org = orgOf();
  const P = `/o/${org}`;
  const people = state.get("people");
  const email = PEOPLE.find((p) => p.key === who).email;
  const since = Date.now() - 2000;
  const inc = (await api.post(`${P}/r/incident`, { short_description: `اعلان آزمایشی ${new Date().toISOString()}`, impact: "3", urgency: "3" })).row;
  await api.patch(`${P}/r/incident/${inc.id}`, { assignment_group_id: state.get("team"), assigned_to: people[who], version: inc.version });
  const t0 = Date.now();
  const got = await mailFor(email, since, Number(a["mail-timeout"] ?? 120) * 1000);
  const ok = got.length > 0;
  let where = ok ? `port ${got[0].port}${got[0].tls ? " with STARTTLS" : " without TLS"}, subject ${got[0].subject}` : "nothing reached the relay";
  if (!ok) {
    // the server's own delivery log says why («گزارش ارسال»)
    const lg = (await api.raw("GET", `${P}/notify/log?size=30`)).json?.entries ?? [];
    const last = lg.find((e) => e.channel === "email" && e.record_id === inc.id) ?? lg.find((e) => e.channel === "email");
    if (last) where += `; delivery log: ${last.status} ${last.error ?? last.reason ?? ""}`;
  }
  if (mayFail && !ok) C.note(`notification e-mail to ${email} did not arrive (${where})`);
  else C.check(ok, `a notification e-mail reaches the bank's relay for ${email} (${Math.round((Date.now() - t0) / 1000)} s)`, where);
  if (ok) C.metric(`mail_${who}`, { port: got[0].port, tls: got[0].tls, seconds: Math.round((got[0] && Date.parse(got[0].at) - t0) / 1000) });
  return ok;
}

async function notifyPhase() {
  const api = await admin();
  const P = `/o/${orgOf()}`;
  const ch = (await api.post(`${P}/r/email_channel/query`, { size: 5, total: false })).rows?.find((x) => x.is_default) ?? null;
  C.check(!!ch, "the default e-mail channel from the setup exists", ch?.name);
  if (!ch) return;
  const want = { smtp_port: Number(a["smtp-port"]), smtp_security: String(a["smtp-security"]) };
  if (ch.smtp_port !== want.smtp_port || ch.smtp_security !== want.smtp_security) {
    await api.patch(`${P}/r/email_channel/${ch.id}`, { ...want, version: ch.version });
    C.note(`e-mail channel set to port ${want.smtp_port} (${want.smtp_security})`);
  }
  const ok = await notify(api, String(a.who ?? "agent2"), { mayFail: !!a["may-fail"] });
  C.metric("delivered", ok);
}

/** After the upgrade: LDAPS with no root pasted in the source trusts the Windows store (1.1: --use-system-ca). */
async function adStore() {
  const api = await admin();
  const P = `/o/${orgOf()}`;
  const id = state.get("directory").id;
  const cur = (await api.get(`${P}/r/directory_source/${id}`)).row;
  const ca = cur.ca_cert;
  await api.patch(`${P}/r/directory_source/${id}`, { ca_cert: null, version: cur.version });
  try {
    const test = await api.post(`${P}/integration/directory/${id}/test`);
    C.check(test.ok === true, "LDAPS without a pasted root: the bank CA is trusted through the Windows store", JSON.stringify(test).slice(0, 500));
    await adSignIn("maryam", "agent");
  } finally {
    const now = (await api.get(`${P}/r/directory_source/${id}`)).row;
    await api.patch(`${P}/r/directory_source/${id}`, { ca_cert: ca, version: now.version });
    // another administrator's edit clears the approval: approve the source again (re-authenticated)
    await api.post("/auth/reauth", { password: ADMIN.password });
    const ap = await api.raw("POST", `${P}/integration/directory/${id}/approve`, { body: {} });
    C.check(ap.status === 200, "the source is approved again after the edit", `${ap.status}`);
  }
}

async function verify() {
  const ms = await waitReady(BASE, 300_000);
  C.check(true, `ready (${ms} ms)`);
  const api = new Api(BASE);
  const meta = (await api.raw("GET", "/meta")).json;
  if (a["expect-version"]) C.check(meta?.version === String(a["expect-version"]), `meta reports version ${a["expect-version"]}`, meta?.version);
  if (a["expect-protocol"]) C.check(String(meta?.sync_protocol) === String(a["expect-protocol"]), `meta reports sync protocol ${a["expect-protocol"]}`, String(meta?.sync_protocol));
  C.check(meta?.first_run === false, "not a first run: the data is there");
  C.check(!meta?.schema?.pending?.length, "no migration pending", JSON.stringify(meta?.schema));
  C.metric("schema", meta?.schema?.current ?? null);
  // members sign in with their passwords (fresh sign-ins, not saved sessions)
  for (const p of [{ email: ADMIN.email }, ...PEOPLE]) {
    const c = new Api(BASE);
    const r = await c.raw("POST", "/auth/login", { body: { email: p.email, password: PASSWORD } });
    C.check(r.status === 200, `${p.email} signs in`, `${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  }
  const adm = await admin();
  const P = `/o/${orgOf()}`;
  const inc = state.get("incident");
  const row = (await adm.raw("GET", `${P}/r/incident/${inc.id}`)).json?.row;
  C.check(row?.number === inc.number, `incident ${inc.number} is intact`, row?.number);
  const list = (await adm.get(`${P}/r/incident/${inc.id}/attachments`)).attachments ?? [];
  const att = list.find((x) => x.id === inc.attachment);
  C.check(!!att, "its attachment is listed", JSON.stringify(list.map((x) => x.name)));
  if (att) {
    const body = await adm.raw("GET", `${P}/attachments/${att.id}/content`, { raw: true });
    C.check(body.status === 200 && body.body.length === inc.size && sha(body.body) === inc.sha256, "the attachment is byte-identical (SHA-256)", `${body.status} ${body.body.length} bytes`);
  }
  for (const [key, table] of [["change", "change_request"], ["kb", "kb_article"], ["request", "request"]]) {
    const s = state.get(key);
    if (!s?.id) {
      C.check(false, `${table} from the populate phase is known`);
      continue;
    }
    const r = await adm.raw("GET", `${P}/r/${table}/${s.id}`);
    C.check(r.status === 200, `${table} ${s.number ?? s.id} is intact`, `${r.status}`);
  }
  const ch = (await adm.post(`${P}/r/email_channel/query`, { size: 5, total: false })).rows?.find((x) => x.is_default);
  C.check(ch?.smtp_host === "smtp.bank.local", "the e-mail channel's settings are kept", JSON.stringify({ host: ch?.smtp_host, port: ch?.smtp_port, security: ch?.smtp_security }));
  const dir = state.get("directory");
  if (dir?.id) {
    const src = (await adm.raw("GET", `${P}/r/directory_source/${dir.id}`)).json?.row;
    C.check(src?.ldap_url === "ldaps://dc1.bank.local:636" && src?.login_enabled === true, "the directory source is kept", JSON.stringify({ url: src?.ldap_url, login: src?.login_enabled }));
    await adSignIn("ali", "agent");
  }
}

function tlsTry(host, port, servername, version) {
  return new Promise((resolve) => {
    const s = tlsConnect({ host, port, servername, minVersion: version, maxVersion: version, ciphers: version === "TLSv1.3" ? undefined : "DEFAULT@SECLEVEL=0", timeout: 10_000 }, () => {
      const p = s.getProtocol();
      s.end();
      resolve({ ok: true, protocol: p });
    });
    s.on("error", (e) => resolve({ ok: false, error: e.code ?? e.message }));
    s.on("timeout", () => {
      s.destroy();
      resolve({ ok: false, error: "timeout" });
    });
  });
}

function tcpTry(host, port) {
  return new Promise((resolve) => {
    const s = new Socket();
    s.setTimeout(5000);
    s.once("connect", () => {
      s.destroy();
      resolve("open");
    });
    s.once("timeout", () => {
      s.destroy();
      resolve("timeout");
    });
    s.once("error", (e) => resolve(e.code ?? e.message));
    s.connect(port, host);
  });
}

async function security() {
  const u = new URL(BASE);
  const lan = String(a.lan);
  // HTTP → HTTPS
  const http = await new Promise((resolve) => {
    const r = httpRequest({ host: u.hostname, port: Number(a["http-port"] ?? 80), path: "/incidents?x=1", method: "GET", timeout: 10_000 }, (res) => {
      res.resume();
      resolve({ status: res.statusCode, location: res.headers.location ?? "" });
    });
    r.on("error", (e) => resolve({ status: 0, location: e.message }));
    r.end();
  });
  C.check([301, 302, 307, 308].includes(http.status) && String(http.location).startsWith(`https://${u.hostname}`), "HTTP redirects to HTTPS on the bank's name", JSON.stringify(http));
  const api = new Api(BASE);
  const r = await api.raw("GET", "/ready");
  const hsts = String(r.headers["strict-transport-security"] ?? "");
  C.check(/max-age=\d{7,}/.test(hsts), "HSTS with a long max-age", hsts);
  const csp = String(r.headers["content-security-policy"] ?? "");
  const page = await api.raw("GET", "/", { prefix: "" });
  const pageCsp = String(page.headers["content-security-policy"] ?? csp);
  C.check(!/https?:\/\/(?!kariz\.bank\.local)/i.test(pageCsp), "the page's CSP names no external origin", pageCsp.slice(0, 400));
  const login = await api.raw("POST", "/auth/login", { body: { email: ADMIN.email, password: ADMIN.password } });
  const cookie = String((login.headers["set-cookie"] ?? [])[0] ?? "");
  C.check(/;\s*secure/i.test(cookie) && /;\s*httponly/i.test(cookie), "the session cookie is Secure and HttpOnly", cookie.replace(/=[^;]+/, "=…"));
  // TLS versions
  for (const v of ["TLSv1", "TLSv1.1"]) {
    const t = await tlsTry(lan, Number(u.port || 443), u.hostname, v);
    C.check(!t.ok, `${v} is refused`, JSON.stringify(t));
  }
  for (const v of ["TLSv1.2", "TLSv1.3"]) {
    const t = await tlsTry(u.hostname, Number(u.port || 443), u.hostname, v);
    C.check(t.ok && t.protocol === v, `${v} is accepted with the bank's certificate`, JSON.stringify(t));
  }
  // PostgreSQL only on loopback
  const pg = await tcpTry(lan, Number(a["pg-port"] ?? 5432));
  C.check(pg !== "open", `PostgreSQL is not reachable on the LAN address ${lan}`, pg);
  const pgLocal = await tcpTry("127.0.0.1", Number(a["pg-port"] ?? 5432));
  C.check(pgLocal === "open", "PostgreSQL listens on 127.0.0.1", pgLocal);
  // the setup token works once
  const token = state.get("setup_token");
  const st = (await api.raw("GET", `/setup/state?token=${encodeURIComponent(token ?? "")}`)).json;
  C.check(st?.valid === false && st?.required === false, "the used setup address is no longer valid", JSON.stringify(st));
  const again = await new Api(BASE).raw("POST", "/setup/complete", { body: { token, org: { name: "سازمان دوم" }, admin: { full_name: "مهاجم", email: "x@bank.local", password: PASSWORD }, public_url: BASE } });
  C.check(again.status === 409 || again.status === 403, "the setup cannot run a second time", `${again.status}`);
  // a guessed default: PostgreSQL superuser without a password or with a well-known one
  try {
    const postgres = (await import("postgres")).default;
    for (const [user, pass] of [["postgres", "postgres"], ["kariz_admin", ""], ["kariz_admin", "postgres"], ["kariz_app", ""], ["postgres", ""]]) {
      const sql = postgres({ host: "127.0.0.1", port: Number(a["pg-port"] ?? 5432), user, password: pass, database: "kariz", connect_timeout: 5, max: 1, onnotice: () => {} });
      let ok = false;
      let why = "";
      try {
        await sql`select 1`;
        ok = true;
      } catch (e) {
        why = e.code ?? e.message;
      }
      await sql.end({ timeout: 1 }).catch(() => {});
      C.check(!ok, `PostgreSQL refuses ${user} with ${pass ? "a default password" : "no password"}`, why);
    }
  } catch (e) {
    C.note(`PostgreSQL default-password probe skipped: ${e.message}`);
  }
}

async function demoOn() {
  const api = await admin();
  const P = `/o/${orgOf()}`;
  const banner = await api.get(`${P}/demo/banner`);
  C.check(banner.active === true && banner.state === "loaded", "the demo banner is on after `karizctl demo load`", JSON.stringify(banner));
  await api.post("/auth/reauth", { password: ADMIN.password });
  const st = await api.post(`${P}/demo/signin`, { on: true });
  const persona = (st.accounts ?? []).find((x) => x.persona === "agent") ?? st.accounts?.[0];
  C.check(!!persona && !!st.password, "demo sign-in turned on for a presentation (shared password shown to the administrator)", JSON.stringify({ accounts: (st.accounts ?? []).length }));
  if (!persona) return;
  const p = new Api(BASE);
  const r = await p.raw("POST", "/auth/login", { body: { email: persona.email, password: st.password } });
  C.check(r.status === 200, `the demo persona ${persona.email} signs in`, `${r.status}`);
  state.set("demo", { email: persona.email, password: st.password, counts: st.counts ?? null });
  C.metric("demo_counts", st.counts ?? null);
  // the real records stay what they were
  const inc = state.get("incident");
  C.check((await api.raw("GET", `${P}/r/incident/${inc.id}`)).status === 200, "the bank's real incident is still there with the demo pack loaded");
}

async function demoOff() {
  const api = await admin();
  const P = `/o/${orgOf()}`;
  const banner = await api.get(`${P}/demo/banner`);
  C.check(banner.active === false, "the demo banner is gone after `karizctl demo purge`", JSON.stringify(banner));
  const d = state.get("demo");
  if (d) {
    const r = await new Api(BASE).raw("POST", "/auth/login", { body: { email: d.email, password: d.password } });
    C.check(r.status >= 400, `the demo persona ${d.email} can no longer sign in`, `${r.status}`);
  }
  const inc = state.get("incident");
  const row = (await api.raw("GET", `${P}/r/incident/${inc.id}`)).json?.row;
  C.check(row?.number === inc.number, "the bank's real incident survived the purge");
  const att = await api.raw("GET", `${P}/attachments/${inc.attachment}/content`, { raw: true });
  C.check(att.status === 200 && sha(att.body) === inc.sha256, "its attachment survived the purge byte for byte");
  for (const p of PEOPLE.slice(0, 2)) {
    const r = await new Api(BASE).raw("POST", "/auth/login", { body: { email: p.email, password: PASSWORD } });
    C.check(r.status === 200, `the real member ${p.email} still signs in`);
  }
}

async function mark() {
  const api = await admin();
  const P = `/o/${orgOf()}`;
  const made = [];
  for (let i = 0; i < 3; i++) made.push((await api.post(`${P}/r/incident`, { short_description: `ثبت‌شده پس از پشتیبان ${i + 1}` })).row);
  state.set("after_backup", { at: new Date().toISOString(), ids: made.map((x) => x.id), numbers: made.map((x) => x.number) });
  C.check(made.length === 3, "three incidents written after the backup (the DR drill must lose them)", made.map((x) => x.number).join(", "));
}

async function dr() {
  const ms = await waitReady(BASE, 600_000);
  C.check(true, `ready after the restore (${ms} ms)`);
  C.metric("ready_after_restore_ms", ms);
  const api = await admin();
  const P = `/o/${orgOf()}`;
  const inc = state.get("incident");
  C.check((await api.raw("GET", `${P}/r/incident/${inc.id}`)).status === 200, `incident ${inc.number} from before the backup is back`);
  const att = await api.raw("GET", `${P}/attachments/${inc.attachment}/content`, { raw: true });
  C.check(att.status === 200 && sha(att.body) === inc.sha256, "the attachment is back byte for byte");
  const after = state.get("after_backup");
  let lost = 0;
  for (const id of after?.ids ?? []) if ((await api.raw("GET", `${P}/r/incident/${id}`)).status === 404) lost++;
  C.check(lost === (after?.ids ?? []).length, `the ${lost} incidents written after the backup are gone (RPO = the time since the backup)`);
  const count = (await api.post(`${P}/r/incident/query`, { size: 1, total: true })).total;
  C.metric("incidents_after_restore", count);
  const meta = (await api.raw("GET", "/meta")).json;
  C.check(!meta?.schema?.pending?.length, "the restored database was migrated to this version's schema", JSON.stringify(meta?.schema));
}

async function ready() {
  const ms = await waitReady(BASE, Number(a.timeout ?? 300) * 1000);
  C.metric("ready_ms", ms);
  C.check(true, `ready in ${Math.round(ms / 100) / 10} s`);
}

// ------------------------------------------------------------------------------------------------- load

function pct(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

async function load() {
  const users = Number(a.users ?? 40);
  const seconds = Number(a.seconds ?? 180);
  const org = orgOf();
  const P = `/o/${org}`;
  const accounts = [{ email: ADMIN.email }, ...PEOPLE.filter((p) => p.preset === "agent")];
  const sessions = [];
  for (const acc of accounts) {
    const c = new Api(BASE, { timeoutMs: 30_000 });
    await c.signIn(acc.email, PASSWORD, state);
    sessions.push(c.cookie);
  }
  const lat = {};
  const all = [];
  const errors = [];
  let n = 0;
  const record = (k, ms, ok, detail) => {
    (lat[k] ??= []).push(ms);
    all.push(ms);
    n++;
    if (!ok) errors.push(`${k}: ${detail}`);
  };
  // every endpoint on its own as well (an operation of several calls is one operation above)
  const ep = {};
  const timed = async (key, p) => {
    const t = Date.now();
    const r = await p;
    (ep[key] ??= []).push(Date.now() - t);
    return r;
  };
  const TERMS = ["خودپرداز", "شعبه", "کارت", "VPN", "چاپگر", "سوئیچ"];
  const pick = (x) => x[Math.floor(Math.random() * x.length)];
  const end = Date.now() + seconds * 1000;
  const vu = async (i) => {
    const api = new Api(BASE, { cookie: sessions[i % sessions.length], timeoutMs: 30_000 });
    const mine = [];
    let rows = [];
    await sleep(Math.random() * 5000);
    while (Date.now() < end) {
      const kind = pick(["list", "list", "list", "search", "search", "open", "open", "open", "create", "update"]);
      const t = Date.now();
      try {
        if (kind === "list") {
          const r = await timed("GET r/incident (list)", api.raw("GET", `${P}/r/incident?size=50&sort=-updated_at`));
          if (r.status === 200) rows = r.json.rows ?? rows;
          record("list", Date.now() - t, r.status === 200, r.status);
        } else if (kind === "search") {
          const r = await timed("GET r/incident?q (search)", api.raw("GET", `${P}/r/incident?q=${encodeURIComponent(pick(TERMS))}&size=10&total=false`));
          record("search", Date.now() - t, r.status === 200, r.status);
        } else if (kind === "open") {
          const row = rows.length ? pick(rows) : null;
          if (!row) continue;
          const rs = await Promise.all([
            timed("GET r/incident/:id", api.raw("GET", `${P}/r/incident/${row.id}`)),
            timed("GET r/incident/:id/journal", api.raw("GET", `${P}/r/incident/${row.id}/journal?limit=50`)),
            timed("GET r/incident/:id/attachments", api.raw("GET", `${P}/r/incident/${row.id}/attachments`)),
          ]);
          record("open", Date.now() - t, rs.every((x) => x.status === 200), rs.map((x) => x.status).join("/"));
        } else if (kind === "create") {
          const r = await timed("POST r/incident", api.raw("POST", `${P}/r/incident`, { body: { short_description: `آزمون بار ${i}-${mine.length + 1}: ${pick(TERMS)} شعبه` } }));
          if (r.status === 200) mine.push(r.json.row);
          record("create", Date.now() - t, r.status === 200, `${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
        } else {
          const row = mine.length ? pick(mine) : null;
          if (!row) continue;
          const r = await timed("PATCH r/incident/:id", api.raw("PATCH", `${P}/r/incident/${row.id}`, { body: { description: `به‌روزرسانی ${new Date().toISOString()}`, version: row.version } }));
          if (r.status === 200) row.version = r.json.row?.version ?? row.version + 1;
          record("update", Date.now() - t, r.status === 200, `${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
        }
      } catch (e) {
        record(kind, Date.now() - t, false, e.message);
      }
      await sleep(500 + Math.random() * 1500);
    }
  };
  const t0 = Date.now();
  await Promise.all(Array.from({ length: users }, (_, i) => vu(i)));
  const secs = (Date.now() - t0) / 1000;
  const per = Object.fromEntries(Object.entries(lat).map(([k, v]) => [k, { n: v.length, p50: pct(v, 50), p95: pct(v, 95), p99: pct(v, 99) }]));
  const endpoints = Object.fromEntries(Object.entries(ep).map(([k, v]) => [k, { n: v.length, p50: pct(v, 50), p95: pct(v, 95), p99: pct(v, 99) }]));
  C.metric("load", { users, seconds: Math.round(secs), requests: n, rps: Math.round((n / secs) * 10) / 10, p50: pct(all, 50), p95: pct(all, 95), p99: pct(all, 99), errors: errors.length, per: { ...per, ...endpoints }, machine: { cpus: cpus().length, model: cpus()[0]?.model, ram_gb: Math.round(totalmem() / 1073741824) } });
  C.check(errors.length === 0, `${n} operations by ${users} virtual users in ${Math.round(secs)} s without an error`, errors.slice(0, 10).join(" | "));
  // the budgets of perf.mjs, per endpoint (docs/qa/PERFORMANCE_E2E_FA.md §2)
  const B = SERVER_BUDGETS;
  for (const [k, v] of Object.entries(endpoints)) {
    if (v.n < 5) continue;
    C.check(v.p95 <= B.load_endpoint_p95_ms, `load ${k}: p95 ${v.p95} ms ≤ ${B.load_endpoint_p95_ms} ms (${v.n} calls)`);
    C.check(v.p99 <= B.load_endpoint_p99_ms, `load ${k}: p99 ${v.p99} ms ≤ ${B.load_endpoint_p99_ms} ms`);
  }
}

const PHASES = { fresh, populate, notify: notifyPhase, "ad-store": adStore, verify, security, "demo-on": demoOn, "demo-off": demoOff, mark, dr, ready, load };
const fn = PHASES[String(a.phase)];
if (!fn) {
  log(`unknown phase ${a.phase}`);
  process.exit(2);
}
await C.run(fn);
