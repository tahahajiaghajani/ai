// The demo pack's loader (docs/DEMO_FA.md): the fictional «بانک نمونهٔ آفتاب» written through the record engine as the
// system (`createIn` with `trusted`, the module services for a major incident's declaration and communications), so
// numbering, hooks, access anchors, history, journal, SLA timers, notifications and RAG indexing behave as for real
// data. Every step runs inside the organisation's demo scope (the job `demo.load` is the pack's own), so each row it
// writes — and each row the jobs it queues write about them — is recorded in sm_demo_rows for the purge.
//
// The load is a list of steps; a step does a bounded amount of work and saves where it stopped (`progress`), so one
// job invocation never outlives the worker's budget and a load resumes after a restart.
import { CHOICE_LISTS, TABLES } from "@shared/tables";
import { uuidv7 } from "@shared/id";
import type { Ctx, ServerConfig } from "../../context";
import type { Row, Tx } from "../../db";
import { createIn, savepoint, systemCtx, updateIn } from "../../engine";
import { hashPassword, readableCode } from "../../auth/password";
import { addTimelineEvent, majorAction, sendUpdate } from "../incident";
import { secureWorkspace } from "../security/common";
import { ARTICLES, BANK_DOMAIN, BANK_NAME, BRANCH_STREETS, CHANGES, DEMO_SIZES, FIRST_NAMES, GROUPS, HQ_DEPARTMENTS, INCIDENTS, KNOWN_NAMES, LAST_NAMES, PROBLEMS, PROVINCES, REGION_OF, REGIONS, REQUESTS, Rng, SERVICES, type DemoSize, type Persona } from "./bank";

/** What the steps share (saved with the pack between job invocations). */
export interface LoadMemo {
  size: DemoSize;
  seed: number;
  /** step index and the cursor inside it */
  step: number;
  cursor: number;
  password?: string;
  hq?: string;
  units: Record<string, string>;
  branches: { unit: string; location: string; region: string; city: string; name: string }[];
  groups: Record<string, string>;
  regionGroups: Record<string, string>;
  people: { agents: Record<string, string[]>; employees: string[]; personas: Partial<Record<Persona, string>> };
  services: Record<string, string>;
  cis: Record<string, string[]>;
  incidents: string[];
  problems: string[];
  suppliers: string[];
  counts: Record<string, number>;
  /** tables whose records a module refused, with its reason (shown with the status) */
  refused?: Record<string, string>;
}

export function newMemo(size: DemoSize, seed = 1405): LoadMemo {
  return { size, seed, step: 0, cursor: 0, units: {}, branches: [], groups: {}, regionGroups: {}, people: { agents: {}, employees: [], personas: {} }, services: {}, cis: {}, incidents: [], problems: [], suppliers: [], counts: {} };
}

// ----- engine helpers -----------------------------------------------------------------------------------------------

function fieldOf(table: string, field: string) {
  return TABLES.get(table)?.fields.find((f) => f.name === field);
}

/** Option values of a choice field (its own options or its choice list). */
function optionValues(table: string, field: string): string[] {
  const f = fieldOf(table, field);
  if (!f) return [];
  const opts = Array.isArray(f.choices) ? f.choices : typeof f.choices === "string" ? (CHOICE_LISTS.get(f.choices) ?? []) : [];
  return opts.map((o) => String(o.value));
}

/** The first preferred value the field offers (else its first option; undefined when it has none). */
function choose(table: string, field: string, preferred: string[] = []): string | undefined {
  const vals = optionValues(table, field);
  if (!vals.length) return undefined;
  for (const p of preferred) if (vals.includes(p)) return p;
  return vals[0];
}

/** Values of fields the table has; choices it does not offer are left out (the engine's default applies). */
function clean(table: string, values: Record<string, unknown>): Record<string, unknown> {
  const def = TABLES.get(table);
  if (!def) throw new Error(`demo: no table ${table}`);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
    const f = def.fields.find((x) => x.name === k);
    if (!f) continue;
    if ((f.type === "choice" || f.type === "multichoice") && v !== null) {
      const vals = optionValues(table, k);
      if (vals.length) {
        if (f.type === "choice" && !vals.includes(String(v))) continue;
        if (f.type === "multichoice") {
          const list = (Array.isArray(v) ? v : [v]).map(String).filter((x) => vals.includes(x));
          if (!list.length) continue;
          out[k] = list;
          continue;
        }
      }
    }
    out[k] = v;
  }
  return out;
}

async function put(tx: Tx, sys: Ctx, table: string, values: Record<string, unknown>): Promise<Row> {
  return createIn(tx, sys, table, clean(table, values), { trusted: true });
}

/** Records a module refused (table → the last reason), shown with the pack's status. */
const refusals = new Map<string, string>();

/** Create a record; when a module refuses the closed form of it (its own rules on closing), create it open instead. */
async function putOpen(tx: Tx, sys: Ctx, table: string, values: Record<string, unknown>, open: Record<string, unknown>): Promise<Row | null> {
  try {
    return await savepoint(tx, () => put(tx, sys, table, values));
  } catch {
    const rest = { ...values, ...open };
    for (const k of ["closed_at", "close_code", "close_notes", "resolved_at", "resolved_by"]) if (!(k in open)) delete rest[k];
    return savepoint(tx, () => put(tx, sys, table, rest)).catch((e: unknown) => {
      refusals.set(`${sys.org.id}:${table}`, e instanceof Error ? e.message : String(e));
      return null;
    });
  }
}

/** Why records of a table were left out of this organisation's pack (empty when none were). */
export function loadRefusals(orgId: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of refusals) if (k.startsWith(`${orgId}:`)) out[k.slice(orgId.length + 1)] = v;
  return out;
}

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const dateOnly = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** A moment in the last year, recent days more likely (a growing backlog of fresh work). */
function pastMoment(rng: Rng, now: number, maxDays = 365): number {
  const days = maxDays * Math.pow(rng.next(), 1.7);
  const t = now - days * DAY;
  // office hours of Tehran (UTC+3:30): 08:00–16:00
  const d = new Date(t);
  d.setUTCHours(4 + rng.int(0, 8), rng.int(0, 59), rng.int(0, 59), 0);
  return Math.min(d.getTime(), now - 60_000);
}

function personName(rng: Rng): string {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
}

function bump(memo: LoadMemo, key: string, n = 1) {
  memo.counts[key] = (memo.counts[key] ?? 0) + n;
}

// ----- steps ------------------------------------------------------------------------------------------------------

export interface StepArgs {
  cfg: ServerConfig;
  orgId: string;
  memo: LoadMemo;
  /** stop a long step (and resume at `memo.cursor`) after this moment */
  deadline: number;
}

type Step = { key: string; label: string; run(a: StepArgs, sys: Ctx): Promise<boolean> };

/** Steps of the load, in order. `run` returns true when the step is complete. */
export const STEPS: Step[] = [
  { key: "org", label: "ساختار سازمانی و شعب", run: stepOrg },
  { key: "groups", label: "گروه‌های پشتیبانی", run: stepGroups },
  { key: "people", label: "کارکنان و کارشناسان", run: stepPeople },
  { key: "services", label: "خدمت‌ها و پیکربندی", run: stepServices },
  { key: "suppliers", label: "تأمین‌کنندگان و قراردادها", run: stepSuppliers },
  { key: "assets", label: "دارایی‌ها و ناوگان خودپرداز", run: stepAssets },
  { key: "knowledge", label: "مقاله‌های دانش", run: stepKnowledge },
  { key: "incidents", label: "رخدادها", run: stepIncidents },
  { key: "major", label: "رخداد عمدهٔ سوئیچ کارت", run: stepMajor },
  { key: "problems", label: "مشکل‌ها و خطاهای شناخته‌شده", run: stepProblems },
  { key: "changes", label: "تغییرها", run: stepChanges },
  { key: "requests", label: "درخواست‌ها", run: stepRequests },
  { key: "slm", label: "توافق‌های سطح خدمت", run: stepSlm },
  { key: "security", label: "امنیت", run: stepSecurity },
  { key: "hr", label: "پرونده‌های منابع انسانی", run: stepHr },
  { key: "field", label: "بازدیدهای میدانی", run: stepField },
];

async function stepOrg({ orgId, memo }: StepArgs, sys: Ctx): Promise<boolean> {
  const size = DEMO_SIZES[memo.size];
  const rng = new Rng(memo.seed);
  await sys.write(async (tx) => {
    const hqLoc = await put(tx, sys, "location", { name: `ساختمان مرکزی ${BANK_NAME}`, code: "AFT-HQ", kind: choose("location", "kind", ["building", "site", "office"]), address: "تهران، خیابان آفتاب، پلاک ۱", timezone: "Asia/Tehran" });
    const hq = await put(tx, sys, "org_unit", { name: BANK_NAME, code: "AFT", kind: choose("org_unit", "kind", ["company", "organization", "division"]), location_id: hqLoc.id, description: "سازمان نمایشی؛ همهٔ نام‌ها و داده‌ها ساختگی است." });
    memo.hq = String(hq.id);
    memo.units.hq_location = String(hqLoc.id);
    const hqDiv = await put(tx, sys, "org_unit", { name: "ستاد مرکزی", code: "AFT-HQ", kind: choose("org_unit", "kind", ["division", "department"]), parent_id: hq.id, location_id: hqLoc.id });
    for (const [code, name] of HQ_DEPARTMENTS) {
      const u = await put(tx, sys, "org_unit", { name: `ادارهٔ کل ${name}`, code: `AFT-${code}`, kind: choose("org_unit", "kind", ["department"]), parent_id: hqDiv.id, location_id: hqLoc.id });
      memo.units[code] = String(u.id);
    }
    bump(memo, "org_unit", HQ_DEPARTMENTS.length + 2);
    bump(memo, "location");
    // provinces → regions (the field-support areas) → branches
    const regionUnits: Record<string, string> = {};
    for (const r of REGIONS) {
      const u = await put(tx, sys, "org_unit", { name: `مدیریت شعب منطقهٔ ${r}`, kind: choose("org_unit", "kind", ["region", "division"]), parent_id: hq.id });
      regionUnits[r] = String(u.id);
      bump(memo, "org_unit");
    }
    const total = PROVINCES.reduce((s, p) => s + p[2], 0);
    let made = 0;
    for (const [pi, [province, cities, weight]] of PROVINCES.entries()) {
      const count = pi === PROVINCES.length - 1 ? size.branches - made : Math.max(1, Math.round((size.branches * weight) / total));
      if (count <= 0) continue;
      const pLoc = await put(tx, sys, "location", { name: `استان ${province}`, kind: choose("location", "kind", ["region", "province", "area"]), timezone: "Asia/Tehran" });
      const region = REGION_OF[province] ?? REGIONS[0];
      const pUnit = await put(tx, sys, "org_unit", { name: `امور شعب استان ${province}`, kind: choose("org_unit", "kind", ["region", "division"]), parent_id: regionUnits[region], location_id: pLoc.id });
      bump(memo, "location");
      bump(memo, "org_unit");
      for (let i = 0; i < count && made < size.branches; i++) {
        const city = cities[i % cities.length];
        const street = BRANCH_STREETS[(i + pi) % BRANCH_STREETS.length];
        const code = String(1000 + made);
        const name = `شعبهٔ ${street} ${city}`;
        const loc = await put(tx, sys, "location", { name: `${name} (${code})`, code: `BR-${code}`, kind: choose("location", "kind", ["branch", "site", "office"]), parent_id: pLoc.id, address: `${city}، خیابان ${street}، پلاک ${rng.int(2, 280)}`, timezone: "Asia/Tehran" });
        const unit = await put(tx, sys, "org_unit", { name: `${name} — کد ${code}`, code: `BR-${code}`, kind: choose("org_unit", "kind", ["branch", "department", "team"]), parent_id: pUnit.id, location_id: loc.id });
        memo.branches.push({ unit: String(unit.id), location: String(loc.id), region, city, name });
        made++;
      }
      bump(memo, "branch", count);
    }
  });
  void orgId;
  return true;
}

/** The workspace a demo group works in: HR and legal in their secure department workspaces, the SOC in security's. */
async function workspaceOf(tx: Tx, sys: Ctx, key: string): Promise<string | undefined> {
  if (key === "soc") return secureWorkspace(tx, sys);
  const wsKey = key === "hr" ? "hr" : key === "legal" ? "legal" : null;
  if (!wsKey) return undefined;
  return (await tx.one<{ id: string }>(`select id from sm_workspaces where org_id = $1 and key = $2 and deleted_at is null limit 1`, [sys.org.id, wsKey]))?.id;
}

async function stepGroups({ memo }: StepArgs, sys: Ctx): Promise<boolean> {
  await sys.write(async (tx) => {
    for (const g of GROUPS) {
      const ws = await workspaceOf(tx, sys, g.key);
      const row = await put(tx, sys, "group", { name: g.name, types: g.types, roles: g.roles, active: true, restricted: ws ? true : undefined, workspace_id: ws, description: `گروه نمایشی ${BANK_NAME}` });
      memo.groups[g.key] = String(row.id);
    }
    for (const r of REGIONS) {
      const row = await put(tx, sys, "group", { name: `پشتیبانی میدانی ${r}`, types: ["assignment"], roles: ["agent"], active: true, description: "تکنسین‌های خودپرداز و تجهیزات شعب" });
      memo.regionGroups[r] = String(row.id);
    }
    bump(memo, "group", GROUPS.length + REGIONS.length);
  });
  return true;
}

/** One account of the pack (recorded for the purge; no password unless it is a persona the presenter signs in as). */
async function addPerson(tx: Tx, sys: Ctx, orgId: string, p: { email: string; name: string; title: string; unit?: string; location?: string; manager?: string | null; roles: string[]; hash: string | null; role?: "member" | "viewer" }): Promise<string> {
  const id = uuidv7();
  await tx.query(`insert into sm_users (id, email, full_name, password_hash, prefs) values ($1, $2, $3, $4, $5::jsonb)`, [id, p.email, p.name, p.hash, JSON.stringify({ demo_org: orgId })]);
  await tx.query(`insert into sm_demo_rows (org_id, row_id, tbl) values ($1, $2, 'sm_users') on conflict do nothing`, [orgId, id]);
  await tx.query(`insert into sm_org_members (id, org_id, user_id, role, title, origin) values ($1, $2, $3, $4, $5, $6)`, [uuidv7(), orgId, id, p.role ?? "member", p.title, sys.cfg.origin ?? null]);
  const profile = { user_id: id, name: p.name, title: p.title, org_unit_id: p.unit ?? null, location_id: p.location ?? null, manager_id: p.manager ?? null, roles: p.roles, persona: choose("member_profile", "persona", p.roles.includes("requester") ? ["requester"] : ["agent"]) };
  const existing = await tx.one<{ id: string }>(`select id from sm_member_profiles where org_id = $1 and user_id = $2 and deleted_at is null`, [orgId, id]);
  if (existing) await updateIn(tx, sys, "member_profile", existing.id, clean("member_profile", profile), { trusted: true });
  else await put(tx, sys, "member_profile", profile);
  return id;
}

async function stepPeople(a: StepArgs, sys: Ctx): Promise<boolean> {
  const { orgId, memo } = a;
  const size = DEMO_SIZES[memo.size];
  const rng = new Rng(memo.seed + 7);
  const tag = orgId.replace(/-/g, "").slice(0, 6);
  const mail = (local: string) => `${local}.${tag}@${BANK_DOMAIN}`;
  if (memo.cursor === 0) {
    memo.password = readableCode(3, 4);
    const hash = await hashPassword(memo.password);
    await sys.write(async (tx) => {
      const unitOf: Record<Persona, string | undefined> = { agent: memo.units.IT, manager: memo.units.IT, requester: memo.branches[0]?.unit, change: memo.units.IT, assets: memo.units.IT, soc: memo.units.SEC, hr: memo.units.HR };
      for (const [key, p] of Object.entries(KNOWN_NAMES) as [Persona, (typeof KNOWN_NAMES)[Persona]][]) {
        const id = await addPerson(tx, sys, orgId, { email: mail(p.email.split("@")[0]), name: p.name, title: p.title, unit: unitOf[key], location: key === "requester" ? memo.branches[0]?.location : memo.units.hq_location, roles: [...p.roles], hash });
        memo.people.personas[key] = id;
      }
      const P = memo.people.personas;
      const join = async (group: string | undefined, user: string | undefined, manager = false) => {
        if (group && user) await put(tx, sys, "group_member", { group_id: group, user_id: user, kind: choose("group_member", "kind", manager ? ["manager", "lead", "member"] : ["member"]) });
      };
      await join(memo.groups.desk, P.agent);
      await join(memo.groups.desk, P.manager, true);
      await join(memo.groups.cab, P.change, true);
      await join(memo.groups.assets, P.assets, true);
      await join(memo.groups.soc, P.soc);
      await join(memo.groups.hr, P.hr);
      for (const g of [memo.groups.desk, memo.groups.cab, memo.groups.assets, memo.groups.soc, memo.groups.hr]) bump(memo, "group_member");
      await tx.query(`update sm_groups set manager_id = $2 where id = $1`, [memo.groups.desk, P.manager]);
    });
    bump(memo, "person", Object.keys(KNOWN_NAMES).length);
    memo.cursor = 1;
  }
  // agents of every group, then branch employees, in batches
  const plan: { kind: "agent" | "employee"; group?: string; region?: string }[] = [];
  const groupKeys = GROUPS.filter((g) => g.key !== "cab").map((g) => g.key);
  const perGroup = Math.max(2, Math.floor((size.agents - REGIONS.length * 2) / groupKeys.length));
  for (const g of groupKeys) for (let i = 0; i < perGroup; i++) plan.push({ kind: "agent", group: g });
  for (const r of REGIONS) for (let i = 0; i < Math.max(2, Math.floor(size.agents / 30)); i++) plan.push({ kind: "agent", region: r });
  for (let i = 0; i < size.employees; i++) plan.push({ kind: "employee" });
  let i = memo.cursor - 1;
  while (i < plan.length && Date.now() < a.deadline) {
    const batch = plan.slice(i, i + 40);
    await sys.write(async (tx) => {
      for (const [k, p] of batch.entries()) {
        const n = i + k;
        const name = personName(rng);
        if (p.kind === "agent") {
          const g = p.group ? GROUPS.find((x) => x.key === p.group)! : null;
          const group = p.group ? memo.groups[p.group] : memo.regionGroups[p.region!];
          const branch = p.region ? memo.branches.find((b) => b.region === p.region) : undefined;
          const unit = p.group === "hr" ? memo.units.HR : p.group === "legal" ? memo.units.LEGAL : p.group === "soc" ? memo.units.SEC : p.group === "card" ? memo.units.CARD : p.group === "ebank" ? memo.units.EBNK : memo.units.IT;
          const id = await addPerson(tx, sys, orgId, { email: mail(`staff${n}`), name, title: g ? `کارشناس ${g.name}` : `تکنسین پشتیبانی میدانی ${p.region}`, unit: branch?.unit ?? unit, location: branch?.location ?? memo.units.hq_location, roles: g ? g.roles : ["agent"], hash: null });
          await put(tx, sys, "group_member", { group_id: group, user_id: id, kind: choose("group_member", "kind", ["member"]) });
          const key = p.group ?? `field:${p.region}`;
          (memo.people.agents[key] ??= []).push(id);
          bump(memo, "agent");
        } else {
          const b = memo.branches[n % Math.max(1, memo.branches.length)];
          const titles = ["متصدی باجه", "معاون شعبه", "کارشناس اعتبارات", "تحویلدار", "رئیس شعبه", "کارشناس امور مشتریان"];
          const id = await addPerson(tx, sys, orgId, { email: mail(`staff${n}`), name, title: rng.pick(titles), unit: b?.unit, location: b?.location, roles: ["requester"], hash: null });
          memo.people.employees.push(id);
          bump(memo, "employee");
        }
      }
    });
    i += batch.length;
    memo.cursor = i + 1;
  }
  if (i < plan.length) return false;
  memo.cursor = 0;
  return true;
}

async function stepServices({ memo }: StepArgs, sys: Ctx): Promise<boolean> {
  const size = DEMO_SIZES[memo.size];
  const rng = new Rng(memo.seed + 11);
  await sys.write(async (tx) => {
    for (const s of SERVICES) {
      const row = await put(tx, sys, "service", {
        name: s.name,
        service_type: choose("service", "service_type", s.type === "business" ? ["business"] : ["technical"]),
        description: s.desc,
        support_group_id: memo.groups[s.group],
        owner_group_id: memo.groups[s.group],
        criticality: choose("service", "criticality", s.critical ? ["critical", "1", "high"] : ["medium", "3"]),
        tier: choose("service", "tier", s.critical ? ["tier1", "1", "gold"] : ["tier3", "3"]),
        state: choose("service", "state", ["live"]),
        on_status_page: s.critical,
        availability_target: s.critical ? 99.9 : 99.5,
      });
      memo.services[s.key] = String(row.id);
    }
    bump(memo, "service", SERVICES.length);
    // configuration items behind the services (servers, databases, network gear, HSMs) and their relationships
    const classes = optionValues("ci", "class");
    const cls = (pref: string[]) => pref.find((p) => classes.includes(p)) ?? classes[0];
    const kinds: { svc: string; name: string; cls: string[]; n: number }[] = [
      { svc: "core", name: "سرور پایگاه دادهٔ کربنکینگ", cls: ["database_server", "server", "linux_server"], n: 4 },
      { svc: "core", name: "سرور برنامهٔ کربنکینگ", cls: ["application_server", "server"], n: 6 },
      { svc: "switch", name: "سرور سوئیچ کارت", cls: ["server", "application_server"], n: 4 },
      { svc: "hsm", name: "دستگاه HSM", cls: ["hsm", "appliance", "hardware", "server"], n: 3 },
      { svc: "ibank", name: "سرور وب بانکداری اینترنتی", cls: ["web_server", "server"], n: 4 },
      { svc: "mbank", name: "سرور درگاه بانکداری همراه", cls: ["application_server", "server"], n: 4 },
      { svc: "dc", name: "سوئیچ هستهٔ مرکز داده", cls: ["network_switch", "switch", "network_gear", "network"], n: 4 },
      { svc: "dc", name: "ذخیره‌ساز مرکزی", cls: ["storage", "san", "hardware"], n: 2 },
      { svc: "dr", name: "سرور رونوشت سایت پشتیبان", cls: ["server", "database_server"], n: 3 },
      { svc: "swift", name: "سرور پیام‌رسان بین‌المللی", cls: ["server"], n: 2 },
      { svc: "rtgs", name: "سرور درگاه تسویهٔ آنی", cls: ["server", "application_server"], n: 2 },
      { svc: "ach", name: "سرور درگاه پایاپای", cls: ["server", "application_server"], n: 2 },
      { svc: "cheque", name: "سرور تبادل تصویر چک", cls: ["server", "application_server"], n: 2 },
    ];
    let made = 0;
    for (const k of kinds) {
      for (let i = 1; i <= k.n; i++) {
        const svc = SERVICES.find((s) => s.key === k.svc)!;
        const row = await put(tx, sys, "ci", {
          name: `${k.name} ${String(i).padStart(2, "0")}`,
          class: cls(k.cls),
          environment: choose("ci", "environment", ["production", "prod"]),
          criticality: choose("ci", "criticality", ["critical", "high", "1"]),
          support_group_id: memo.groups[svc.group],
          location_id: k.svc === "dr" ? undefined : memo.units.hq_location,
          hostname: `aft-${k.svc}-${String(i).padStart(2, "0")}`,
          ip_address: `10.${10 + SERVICES.indexOf(svc)}.${i}.${rng.int(10, 250)}`,
          state: choose("ci", "state", ["operational"]),
        });
        (memo.cis[k.svc] ??= []).push(String(row.id));
        made++;
      }
    }
    // branch network gear up to the size's CI count
    for (let i = 0; made < size.cis && i < memo.branches.length; i++, made++) {
      const b = memo.branches[i];
      const row = await put(tx, sys, "ci", { name: `مسیریاب ${b.name}`, class: cls(["router", "network_gear", "network"]), environment: choose("ci", "environment", ["production"]), support_group_id: memo.groups.network, location_id: b.location, hostname: `aft-br-${1000 + i}`, state: choose("ci", "state", ["operational"]) });
      (memo.cis.wan ??= []).push(String(row.id));
    }
    bump(memo, "ci", made);
    // service map: each service runs on its CIs; internet/mobile banking depend on the core
    const types = optionValues("ci_rel", "type");
    const relType = (pref: string[]) => pref.find((p) => types.includes(p)) ?? types[0];
    let rels = 0;
    for (const [svc, list] of Object.entries(memo.cis)) {
      const svcCi = await tx.one<{ ci_id: string | null }>(`select ci_id from sm_services where id = $1`, [memo.services[svc]]);
      const parent = svcCi?.ci_id ?? list[0];
      for (const child of list.slice(svcCi?.ci_id ? 0 : 1, 12)) {
        if (child === parent) continue;
        await put(tx, sys, "ci_rel", { parent_id: parent, child_id: child, type: relType(["depends_on", "runs_on", "uses"]) });
        rels++;
      }
    }
    for (const [from, to] of [["ibank", "core"], ["mbank", "core"], ["atm", "switch"], ["pos", "switch"], ["switch", "hsm"], ["core", "dc"], ["teller", "core"]]) {
      const a = memo.cis[from]?.[0] ?? (await tx.one<{ ci_id: string }>(`select ci_id from sm_services where id = $1`, [memo.services[from]]))?.ci_id;
      const b = memo.cis[to]?.[0] ?? (await tx.one<{ ci_id: string }>(`select ci_id from sm_services where id = $1`, [memo.services[to]]))?.ci_id;
      if (a && b && a !== b) {
        await put(tx, sys, "ci_rel", { parent_id: a, child_id: b, type: relType(["depends_on", "uses"]) });
        rels++;
      }
    }
    bump(memo, "ci_rel", rels);
  });
  return true;
}

async function stepSuppliers({ memo }: StepArgs, sys: Ctx): Promise<boolean> {
  const now = Date.now();
  const list = [
    { name: "شرکت نمونهٔ خدمات خودپرداز پارس", kinds: ["vendor", "maintainer", "service_provider"], contract: "نگهداری و تعمیر خودپردازها", value: 18_500_000_000 },
    { name: "شرکت نمونهٔ ارتباطات داده‌پرداز", kinds: ["service_provider", "telecom"], contract: "خطوط اختصاصی شعب", value: 42_000_000_000 },
    { name: "شرکت نمونهٔ نرم‌افزار بانکی نوین", kinds: ["vendor", "software"], contract: "پشتیبانی سامانهٔ کربنکینگ", value: 65_000_000_000 },
    { name: "شرکت نمونهٔ امنیت شبکهٔ سپهر", kinds: ["vendor", "service_provider"], contract: "پایش امنیت و پاسخ به رخداد", value: 12_000_000_000 },
    { name: "شرکت نمونهٔ تجهیزات پایانهٔ فروش", kinds: ["vendor", "reseller"], contract: "تأمین و نگهداری پایانه‌های فروش", value: 9_800_000_000 },
  ];
  await sys.write(async (tx) => {
    for (const [i, s] of list.entries()) {
      const sup = await put(tx, sys, "supplier", { name: s.name, kinds: s.kinds, criticality: choose("supplier", "criticality", ["critical", "high"]), city: "تهران", country: "ایران", state: choose("supplier", "state", ["active"]), notes: "تأمین‌کنندهٔ ساختگی دادهٔ نمایشی" });
      memo.suppliers.push(String(sup.id));
      const start = now - (200 + i * 40) * DAY;
      await put(tx, sys, "contract", {
        name: s.contract,
        supplier_id: sup.id,
        contract_type: choose("contract", "contract_type", ["maintenance", "support", "service"]),
        start_date: dateOnly(start),
        end_date: dateOnly(start + 365 * DAY),
        value: s.value,
        currency: choose("contract", "currency", ["IRR"]),
        renewal_type: choose("contract", "renewal_type", ["manual"]),
        notice_period_days: 60,
        terms: "زمان پاسخ: ۴ ساعت کاری در شعب شهری، ۸ ساعت در شعب دیگر؛ قطعات اصلی با ضمانت.",
        state: choose("contract", "state", ["active"]),
      });
    }
  });
  bump(memo, "supplier", list.length);
  bump(memo, "contract", list.length);
  return true;
}

async function stepAssets(a: StepArgs, sys: Ctx): Promise<boolean> {
  const { memo } = a;
  const size = DEMO_SIZES[memo.size];
  const rng = new Rng(memo.seed + 13);
  const now = Date.now();
  // models and stockrooms first (cursor 0), then the fleet in batches
  if (memo.cursor === 0) {
    await sys.write(async (tx) => {
      const models: [string, string[], string[], number][] = [
        ["خودپرداز نمونهٔ آفتاب ATM-500", ["atm", "kiosk", "hardware", "other"], ["hardware"], 3_200_000_000],
        ["دستگاه بازیافت پول CR-200", ["atm", "kiosk", "hardware", "other"], ["hardware"], 4_100_000_000],
        ["پایانهٔ فروش رومیزی POS-T1", ["pos", "terminal", "hardware", "other"], ["hardware"], 95_000_000],
        ["رایانهٔ شعبه BR-PC", ["desktop", "computer"], ["hardware"], 380_000_000],
        ["چاپگر دفترچه PB-90", ["printer", "peripheral"], ["hardware"], 160_000_000],
        ["مسیریاب شعبه RT-20", ["network", "network_gear", "router", "hardware"], ["hardware"], 240_000_000],
      ];
      for (const [name, cat, cls, cost] of models) {
        const m = await put(tx, sys, "asset_model", { name, category: choose("asset_model", "category", cat), asset_class: choose("asset_model", "asset_class", cls), unit_cost: cost, useful_life_months: 84, warranty_months: 24, status: choose("asset_model", "status", ["active", "approved"]) });
        memo.units[`model:${name}`] = String(m.id);
      }
      bump(memo, "asset_model", models.length);
      const central = await put(tx, sys, "stockroom", { name: "انبار مرکزی تجهیزات شعب (نمایشی)", code: "AFT-ST-1", location_id: memo.units.hq_location, group_id: memo.groups.assets, active: true });
      memo.units.stockroom = String(central.id);
      for (const r of REGIONS.slice(0, 3)) {
        const b = memo.branches.find((x) => x.region === r);
        await put(tx, sys, "stockroom", { name: `انبار منطقه‌ای ${r}`, location_id: b?.location, group_id: memo.regionGroups[r], parent_id: central.id, active: true });
      }
      bump(memo, "stockroom", 4);
    });
    memo.cursor = 1;
  }
  const modelIds = Object.entries(memo.units).filter(([k]) => k.startsWith("model:")).map(([, v]) => v);
  const mix: [number, number][] = [[0, 26], [1, 6], [2, 22], [3, 26], [4, 12], [5, 8]];
  let i = memo.cursor - 1;
  while (i < size.assets && Date.now() < a.deadline) {
    const n = Math.min(60, size.assets - i);
    await sys.write(async (tx) => {
      for (let k = 0; k < n; k++) {
        const idx = rng.weighted(mix);
        const b = memo.branches[(i + k) % memo.branches.length];
        const bought = now - rng.int(30, 6 * 365) * DAY;
        const inUse = rng.chance(0.88);
        await put(tx, sys, "asset", {
          model_id: modelIds[idx],
          asset_tag: `AFT-${String(100000 + i + k)}`,
          serial_number: `SN${rng.int(10_000_000, 99_999_999)}`,
          state: inUse ? choose("asset", "state", ["in_use"]) : choose("asset", "state", ["in_stock"]),
          location_id: inUse ? b.location : memo.units.hq_location,
          stockroom_id: inUse ? undefined : memo.units.stockroom,
          managed_by_group_id: idx <= 2 ? memo.groups.card : memo.regionGroups[b.region],
          purchase_date: dateOnly(bought),
          in_service_date: dateOnly(bought + 10 * DAY),
          vendor_id: memo.suppliers[idx <= 1 ? 0 : idx === 2 ? 4 : 2],
          warranty_end: dateOnly(bought + 730 * DAY),
          notes: idx <= 1 ? `دستگاه ${b.name}` : undefined,
        });
      }
    });
    i += n;
    memo.cursor = i + 1;
    bump(memo, "asset", n);
  }
  if (i < size.assets) return false;
  // a physical audit of the central stockroom
  await sys.write(async (tx) => {
    await put(tx, sys, "inventory_audit", { name: "شمارش فصلی انبار مرکزی", scope_kind: choose("inventory_audit", "scope_kind", ["stockroom"]), stockroom_id: memo.units.stockroom, group_id: memo.groups.assets, planned_date: dateOnly(now + 7 * DAY), notes: "شمارش دستگاه‌های رزرو خودپرداز و پایانهٔ فروش" });
  });
  bump(memo, "inventory_audit");
  memo.cursor = 0;
  return true;
}

async function stepKnowledge({ memo }: StepArgs, sys: Ctx): Promise<boolean> {
  const size = DEMO_SIZES[memo.size];
  await sys.write(async (tx) => {
    const base = await tx.one<{ id: string }>(`select id from sm_kb_bases where org_id = $1 and deleted_at is null order by created_at limit 1`, [sys.org.id]);
    if (!base) return;
    for (let i = 0; i < size.articles; i++) {
      const a = ARTICLES[i % ARTICLES.length];
      const round = Math.floor(i / ARTICLES.length);
      await put(tx, sys, "kb_article", {
        title: round ? `${a.title} (ویرایش ${round + 1})` : a.title,
        summary: a.body.split("\n")[0].slice(0, 200),
        body: a.body,
        base_id: base.id,
        author_id: memo.people.personas.agent,
        owner_group_id: memo.groups.desk,
        article_type: choose("kb_article", "article_type", ["how_to", "troubleshooting", "solution"]),
        state: choose("kb_article", "state", i % 7 === 6 ? ["draft"] : ["published"]),
        keywords: ["بانک", "شعبه"],
      });
    }
  });
  bump(memo, "kb_article", size.articles);
  return true;
}

function personOf(memo: LoadMemo, group: string, rng: Rng): string | undefined {
  const list = memo.people.agents[group];
  return list?.length ? rng.pick(list) : undefined;
}

async function stepIncidents(a: StepArgs, sys: Ctx): Promise<boolean> {
  const { memo } = a;
  const size = DEMO_SIZES[memo.size];
  const rng = new Rng(memo.seed + 17 + memo.cursor);
  const now = Date.now();
  const weighted = INCIDENTS.map((x) => [x, x.weight] as const);
  const closeCode = choose("incident", "close_code", ["solved", "resolved", "fixed"]);
  let i = memo.cursor;
  while (i < size.incidents && Date.now() < a.deadline) {
    const n = Math.min(40, size.incidents - i);
    await sys.write(async (tx) => {
      for (let k = 0; k < n; k++) {
        const t = rng.weighted(weighted);
        const branch = rng.pick(memo.branches);
        const opened = pastMoment(rng, now);
        const ageDays = (now - opened) / DAY;
        // old work is closed, a live backlog of the last weeks stays open
        const state = ageDays > 21 ? (rng.chance(0.92) ? "closed" : "resolved") : ageDays > 5 ? rng.weighted([["resolved", 5], ["closed", 3], ["in_progress", 4]]) : rng.weighted([["new", 3], ["in_progress", 5], ["resolved", 2]]);
        const done = state === "resolved" || state === "closed";
        const resolved = done ? Math.min(now - 30_000, opened + rng.int(20, 60 * 30) * 60_000) : null;
        const group = t.group === "card" && t.service === "atm" && rng.chance(0.4) ? memo.regionGroups[branch.region] : memo.groups[t.group];
        const agentKey = group === memo.regionGroups[branch.region] ? `field:${branch.region}` : t.group;
        const caller = rng.chance(0.85) ? rng.pick(memo.people.employees) : memo.people.personas.requester;
        const assignee = state === "new" ? undefined : (personOf(memo, agentKey, rng) ?? memo.people.personas.agent);
        const ci = t.service === "wan" ? memo.cis.wan?.[memo.branches.indexOf(branch)] : memo.cis[t.service]?.[0];
        const row = await put(tx, sys, "incident", {
          short_description: `${t.text} — ${branch.name}`,
          description: t.detail,
          impact: t.impact[0],
          urgency: t.impact[1],
          channel: choose("incident", "channel", [rng.pick(["phone", "portal", "email", "self_service"])]),
          caller_id: caller,
          opened_at: iso(opened),
          assignment_group_id: group,
          assigned_to: assignee,
          service_id: memo.services[t.service],
          ci_id: ci,
          location_id: branch.location,
          state: choose("incident", "state", [state]),
          resolved_at: resolved ? iso(resolved) : undefined,
          resolved_by: resolved ? assignee : undefined,
          closed_at: state === "closed" && resolved ? iso(Math.min(now - 10_000, resolved + 3 * DAY)) : undefined,
          close_code: done ? closeCode : undefined,
          close_notes: done ? rng.pick(["مشکل با راه‌اندازی دوبارهٔ دستگاه برطرف شد.", "قطعه تعویض و دستگاه آزمایش شد.", "پیکربندی اصلاح شد و کاربر تأیید کرد.", "گذرواژه بازنشانی و به کاربر اعلام شد.", "ارتباط با پشتیبان مخابرات برقرار و خط وصل شد."]) : undefined,
        });
        memo.incidents.push(String(row.id));
      }
    });
    i += n;
    memo.cursor = i;
    bump(memo, "incident", n);
  }
  if (i < size.incidents) return false;
  // keep only a sample of ids for later links
  memo.incidents = memo.incidents.slice(-200);
  memo.cursor = 0;
  return true;
}

async function stepMajor({ memo }: StepArgs, sys: Ctx): Promise<boolean> {
  const now = Date.now();
  const opened = now - 3 * 3600_000;
  const inc = await sys.write((tx) =>
    put(tx, sys, "incident", {
      short_description: "قطعی سوئیچ کارت: تراکنش‌های کارتی همهٔ شعب و خودپردازها ناموفق است",
      description: "از ساعت ۱۰:۱۲ تراکنش‌های خودپرداز و پایانه‌های فروش پاسخ «صادرکننده در دسترس نیست» می‌گیرند. ارتباط با شبکهٔ بین‌بانکی کارت برقرار است؛ خطا از سوئیچ کارت بانک گزارش می‌شود.",
      impact: "1",
      urgency: "1",
      channel: choose("incident", "channel", ["monitoring", "event", "phone"]),
      caller_id: memo.people.personas.agent,
      opened_at: iso(opened),
      assignment_group_id: memo.groups.card,
      assigned_to: personOf(memo, "card", new Rng(memo.seed)) ?? memo.people.personas.agent,
      service_id: memo.services.switch,
      ci_id: memo.cis.switch?.[0],
      state: choose("incident", "state", ["in_progress"]),
    }),
  );
  await majorAction(sys, String(inc.id), "declare", { reason: "اختلال سراسری در خدمت کارت؛ همهٔ شعب متأثرند", mi_manager_id: memo.people.personas.manager, mi_comms_id: memo.people.personas.manager, comm_cadence: 30, bridge_url: "https://bridge.aftab-bank.example/mi" });
  const events: [string, string][] = [
    ["detection", "پایش سوئیچ: نرخ خطای تراکنش‌ها از ۴۰ درصد گذشت"],
    ["action", "گره دوم سوئیچ کارت فعال شد؛ صف پیام‌ها در حال تخلیه است"],
    ["decision", "خودپردازها تا پایداری کامل در حالت «فقط مانده و برداشت» می‌مانند"],
  ];
  for (const [i, [kind, title]] of events.entries()) {
    await addTimelineEvent(sys, String(inc.id), { kind: kind as "detection", title, at: iso(opened + (i + 1) * 20 * 60_000), key: i === 0 });
  }
  await sendUpdate(sys, String(inc.id), { audience: "stakeholders", subject: "اطلاع‌رسانی ۱: اختلال در تراکنش‌های کارتی", body: "تراکنش‌های کارتی در همهٔ شعب با خطا روبه‌روست. تیم کارت و خودپرداز در حال جابه‌جایی به گره پشتیبان است. اطلاع‌رسانی بعدی تا ۳۰ دقیقهٔ دیگر.", channels: ["in_app"] }).catch(() => ({ recipients: 0 }));
  bump(memo, "major_incident");
  memo.incidents.push(String(inc.id));
  return true;
}

async function stepProblems({ memo }: StepArgs, sys: Ctx): Promise<boolean> {
  const size = DEMO_SIZES[memo.size];
  const rng = new Rng(memo.seed + 19);
  const now = Date.now();
  await sys.write(async (tx) => {
    for (let i = 0; i < size.problems; i++) {
      const p = PROBLEMS[i % PROBLEMS.length];
      const opened = pastMoment(rng, now, 300);
      const state = rng.weighted([["rca", 3], ["fix_in_progress", 2], ["resolved", 2], ["closed", 3], ["assess", 2]]);
      const row = await put(tx, sys, "problem", {
        short_description: i < PROBLEMS.length ? p.text : `${p.text} (${i + 1})`,
        description: `علت ریشه‌ای احتمالی: ${p.cause}`,
        impact: "2",
        urgency: "2",
        opened_at: iso(opened),
        assignment_group_id: memo.groups[p.group],
        assigned_to: personOf(memo, p.group, rng),
        manager_id: memo.people.personas.manager,
        service_id: memo.services[p.service],
        state: choose("problem", "state", [state]),
        resolved_at: state === "resolved" || state === "closed" ? iso(Math.min(now - 60_000, opened + 20 * DAY)) : undefined,
        closed_at: state === "closed" ? iso(Math.min(now - 30_000, opened + 25 * DAY)) : undefined,
        close_code: state === "resolved" || state === "closed" ? choose("problem", "close_code", ["fixed", "resolved"]) : undefined,
        close_notes: state === "resolved" || state === "closed" ? "راه‌حل دائمی اجرا و پایش شد." : undefined,
      });
      memo.problems.push(String(row.id));
      if (i < PROBLEMS.length) {
        await put(tx, sys, "known_error", { short_description: `خطای شناخته‌شده: ${p.text}`, problem_id: row.id, symptoms: p.text, root_cause: p.cause, workaround: p.workaround, assignment_group_id: memo.groups[p.group], service_id: memo.services[p.service], state: choose("known_error", "state", ["published"]) });
        bump(memo, "known_error");
      }
    }
  });
  bump(memo, "problem", size.problems);
  return true;
}

async function stepChanges({ memo }: StepArgs, sys: Ctx): Promise<boolean> {
  const size = DEMO_SIZES[memo.size];
  const rng = new Rng(memo.seed + 23);
  const now = Date.now();
  const types = optionValues("change_request", "type");
  await sys.write(async (tx) => {
    for (let i = 0; i < size.changes; i++) {
      const c = CHANGES[i % CHANGES.length];
      // past changes are closed; upcoming ones scheduled on weekend nights (Thursday/Friday)
      const future = i % 4 === 0;
      let start = future ? now + rng.int(1, 45) * DAY : pastMoment(rng, now, 360);
      const d = new Date(start);
      const toFriday = (5 - d.getUTCDay() + 7) % 7;
      start = d.getTime() + toFriday * DAY;
      const s = new Date(start);
      s.setUTCHours(22, 30, 0, 0);
      start = s.getTime();
      const emergency = i % 9 === 4;
      const type = emergency ? (types.includes("emergency") ? "emergency" : types[0]) : c.risk === "low" ? (types.includes("standard") ? "standard" : types[0]) : types.includes("normal") ? "normal" : types[0];
      const state = future ? rng.pick(["assess", "authorize", "scheduled"]) : start > now ? "scheduled" : rng.chance(0.9) ? "closed" : "review";
      await putOpen(tx, sys, "change_request", {
        short_description: c.text,
        description: c.plan,
        type,
        impact: c.risk === "high" ? "1" : "2",
        urgency: emergency ? "1" : "3",
        assignment_group_id: memo.groups[c.group],
        assigned_to: personOf(memo, c.group, rng),
        service_id: memo.services[c.service],
        ci_id: memo.cis[c.service]?.[0],
        opened_at: iso(Math.min(now - 60_000, start - 7 * DAY)),
        start_date: iso(start),
        end_date: iso(start + 4 * 3600_000),
        planned_start: iso(start),
        planned_end: iso(start + 4 * 3600_000),
        risk: choose("change_request", "risk", [c.risk]),
        state: choose("change_request", "state", [state]),
        justification: "الزام عملیاتی و امنیتی بانک",
        implementation_plan: c.plan,
        backout_plan: "بازگشت به نسخه و پیکربندی پیشین طبق دستورالعمل بازگشت.",
        test_plan: "آزمون دود پس از اجرا و پایش ۲ ساعته.",
        closed_at: state === "closed" ? iso(Math.min(now - 30_000, start + 6 * 3600_000)) : undefined,
        close_code: state === "closed" ? choose("change_request", "close_code", ["successful"]) : undefined,
        close_notes: state === "closed" ? "تغییر طبق برنامه اجرا و آزمون شد." : undefined,
      }, { state: choose("change_request", "state", ["scheduled", "new"]) });
    }
  });
  bump(memo, "change_request", size.changes);
  return true;
}

/** Answers to an item's questions as a requester would give them (required ones; defaults where the item has them). */
async function answersFor(tx: Tx, orgId: string, itemId: string, who: string): Promise<Record<string, unknown>> {
  const vars = await tx.query<{ name: string; type: string; required: boolean; default_value: string | null; choices: unknown; ref_table: string | null }>(
    `select v.name, v.type, v.required, v.default_value, v.choices, v.ref_table from sm_catalog_variables v
      where v.org_id = $1 and v.deleted_at is null and coalesce(v.active, true)
        and (v.item_id = $2 or v.set_id in (select jsonb_array_elements_text(coalesce(i.variable_sets, '[]'::jsonb))::uuid from sm_catalog_items i where i.id = $2))`,
    [orgId, itemId],
  );
  const out: Record<string, unknown> = {};
  for (const v of vars) {
    if (v.default_value !== null && v.default_value !== "") {
      out[v.name] = v.type === "checkbox" || v.type === "boolean" ? v.default_value === "true" : v.default_value;
      continue;
    }
    if (!v.required) continue;
    const first = Array.isArray(v.choices) && v.choices.length ? v.choices[0] : null;
    const choice = Array.isArray(first) ? first[0] : first && typeof first === "object" ? (first as { value?: unknown }).value : first;
    if (choice !== null && choice !== undefined) out[v.name] = String(choice);
    else if (["checkbox", "boolean", "yes_no"].includes(v.type)) out[v.name] = v.type === "yes_no" ? "yes" : true;
    else if (["date"].includes(v.type)) out[v.name] = dateOnly(Date.now() + 7 * DAY);
    else if (["datetime"].includes(v.type)) out[v.name] = iso(Date.now() + 7 * DAY);
    else if (["number", "integer", "decimal", "money"].includes(v.type)) out[v.name] = 1;
    else if (["user", "reference"].includes(v.type) && (!v.ref_table || v.ref_table === "user")) out[v.name] = who;
    else out[v.name] = "برای کار روزانهٔ شعبه";
  }
  return out;
}

async function stepRequests({ memo }: StepArgs, sys: Ctx): Promise<boolean> {
  const size = DEMO_SIZES[memo.size];
  const rng = new Rng(memo.seed + 29);
  const now = Date.now();
  let made = 0;
  await sys.write(async (tx) => {
    const items = await tx.query<{ id: string; name: string; category_id: string | null }>(`select id, name, category_id from sm_catalog_items where org_id = $1 and deleted_at is null and state = 'published'`, [sys.org.id]);
    const byName = new Map(items.map((x) => [x.name, x]));
    for (let i = 0; i < size.requests; i++) {
      const r = REQUESTS[i % REQUESTS.length];
      const item = byName.get(r.item);
      if (!item) continue;
      const who = rng.chance(0.8) ? rng.pick(memo.people.employees) : memo.people.personas.requester!;
      const opened = pastMoment(rng, now, 360);
      const age = (now - opened) / DAY;
      const state = age > 30 ? "closed_complete" : age > 10 ? rng.pick(["in_fulfilment", "delivered", "closed_complete"]) : rng.pick(["submitted", "awaiting_approval", "in_fulfilment"]);
      const answers = await answersFor(tx, sys.org.id, item.id, who);
      // an item whose questions this generator cannot answer is left out (never a half-written request)
      await savepoint(tx, async () => {
        const req = await put(tx, sys, "request", { short_description: r.text, description: r.detail, caller_id: who, requested_for: who, opened_at: iso(opened), state: choose("request", "state", [state]), assignment_group_id: memo.groups.desk });
        await put(tx, sys, "request_item", {
          short_description: r.text,
          description: r.detail,
          request_id: req.id,
          cat_item_id: item.id,
          category_id: item.category_id,
          quantity: 1,
          answers,
          caller_id: who,
          requested_for: who,
          opened_at: iso(opened),
          assignment_group_id: r.item === "درخواست دسترسی" ? memo.groups.core : memo.groups.desk,
          state: choose("request_item", "state", [state === "submitted" ? "pending" : state]),
        });
        made++;
      }).catch(() => undefined);
    }
  });
  bump(memo, "request", made);
  return true;
}

async function stepSlm({ memo }: StepArgs, sys: Ctx): Promise<boolean> {
  const now = Date.now();
  await sys.write(async (tx) => {
    for (const [key, unit] of [["core", "OPS"], ["atm", "CARD"], ["ibank", "EBNK"], ["mbank", "EBNK"]] as const) {
      await put(tx, sys, "service_agreement", {
        name: `توافق سطح خدمت ${SERVICES.find((s) => s.key === key)!.name}`,
        customer_unit_id: memo.units[unit],
        service_id: memo.services[key],
        kind: choose("service_agreement", "kind", ["sla"]),
        valid_from: dateOnly(now - 200 * DAY),
        valid_to: dateOnly(now + 165 * DAY),
        compliance_target: key === "core" ? 99.9 : 99.5,
        at_risk_target: key === "core" ? 99.95 : 99.7,
        provider_group_id: memo.groups[SERVICES.find((s) => s.key === key)!.group],
        terms: "دسترس‌پذیری ماهانه، زمان پاسخ رخدادهای اولویت ۱ در ۱۵ دقیقه و حل در ۴ ساعت.",
        state: choose("service_agreement", "state", ["active"]),
      });
    }
  });
  bump(memo, "service_agreement", 4);
  return true;
}

async function stepSecurity({ memo }: StepArgs, sys: Ctx): Promise<boolean> {
  const size = DEMO_SIZES[memo.size];
  const rng = new Rng(memo.seed + 31);
  const now = Date.now();
  const texts = ["کارزار فیشینگ با موضوع به‌روزرسانی حساب", "تلاش‌های ناموفق مکرر ورود به درگاه بانکداری اینترنتی", "بدافزار روی رایانهٔ یک شعبه", "اسکن درگاه‌های شبکهٔ شعب از نشانی ناشناس", "نشت احتمالی گذرواژه در یک انجمن"];
  let made = 0;
  await sys.write(async (tx) => {
    for (let i = 0; i < size.security; i++) {
      const opened = pastMoment(rng, now, 300);
      const closed = (now - opened) / DAY > 20;
      const row = await putOpen(tx, sys, "sec_incident", {
        short_description: texts[i % texts.length],
        description: "رخداد امنیتی نمایشی؛ شاخص‌ها و جزئیات ساختگی است.",
        category: choose("sec_incident", "category", ["phishing", "malware", "unauthorized_access", "reconnaissance"]),
        severity: choose("sec_incident", "severity", i % 4 === 0 ? ["high", "2"] : ["medium", "3"]),
        business_impact: choose("sec_incident", "business_impact", ["medium", "low", "2", "3"]),
        classification: choose("sec_incident", "classification", ["confidential", "internal", "restricted"]),
        assignment_group_id: memo.groups.soc,
        assigned_to: personOf(memo, "soc", rng) ?? memo.people.personas.soc,
        opened_at: iso(opened),
        state: choose("sec_incident", "state", [closed ? "closed" : "analysis"]),
        closed_at: closed ? iso(Math.min(now - 30_000, opened + 4 * DAY)) : undefined,
        close_code: closed ? choose("sec_incident", "close_code", ["resolved", "contained"]) : undefined,
        close_notes: closed ? "مهار و ریشه‌کن شد؛ درس‌آموخته ثبت شد." : undefined,
      }, { state: choose("sec_incident", "state", ["analysis"]) });
      if (row) made++;
    }
    const cves = [["CVE-2026-10001", "آسیب‌پذیری اجرای کد در سرور برنامه"], ["CVE-2026-10002", "دور زدن احراز هویت در درگاه مدیریت"], ["CVE-2026-10003", "افشای اطلاعات در کتابخانهٔ رمزنگاری"]];
    for (const [cve, title] of cves) await put(tx, sys, "sec_vulnerability", { cve_id: cve, title: `${title} (نمایشی)`, severity: choose("sec_vulnerability", "severity", ["high", "critical"]), cvss_score: 8.1, description: "شناسهٔ ساختگی برای دادهٔ نمایشی." });
  });
  bump(memo, "sec_incident", made);
  bump(memo, "sec_vulnerability", 3);
  return true;
}

async function stepHr({ memo }: StepArgs, sys: Ctx): Promise<boolean> {
  const size = DEMO_SIZES[memo.size];
  const rng = new Rng(memo.seed + 37);
  const now = Date.now();
  const texts = ["درخواست گواهی اشتغال به کار", "اصلاح مرخصی ثبت‌شده", "پرسش دربارهٔ فیش حقوقی", "انتقال به شعبهٔ دیگر", "ثبت دورهٔ آموزشی اجباری"];
  let made = 0;
  await sys.write(async (tx) => {
    for (let i = 0; i < size.hr; i++) {
      const who = rng.pick(memo.people.employees);
      const opened = pastMoment(rng, now, 200);
      const closed = (now - opened) / DAY > 15;
      const row = await putOpen(tx, sys, "hr_case", {
        short_description: texts[i % texts.length],
        description: "پروندهٔ ساختگی منابع انسانی (دادهٔ نمایشی).",
        caller_id: who,
        requested_for: who,
        opened_at: iso(opened),
        assignment_group_id: memo.groups.hr,
        assigned_to: personOf(memo, "hr", rng) ?? memo.people.personas.hr,
        state: choose("hr_case", "state", [closed ? "closed_complete" : "in_progress"]),
        closed_at: closed ? iso(Math.min(now - 30_000, opened + 3 * DAY)) : undefined,
        close_code: closed ? choose("hr_case", "close_code", ["resolved", "completed", "solved"]) : undefined,
        close_notes: closed ? "پاسخ داده شد." : undefined,
        sensitive: i % 5 === 0,
      }, { state: choose("hr_case", "state", ["in_progress"]) });
      if (row) made++;
    }
  });
  bump(memo, "hr_case", made);
  return true;
}

async function stepField({ memo }: StepArgs, sys: Ctx): Promise<boolean> {
  const size = DEMO_SIZES[memo.size];
  const rng = new Rng(memo.seed + 41);
  const now = Date.now();
  let made = 0;
  await sys.write(async (tx) => {
    for (let i = 0; i < size.visits; i++) {
      const b = rng.pick(memo.branches);
      const opened = pastMoment(rng, now, 240);
      const done = (now - opened) / DAY > 7;
      const row = await putOpen(tx, sys, "work_order", {
        short_description: `بازدید تکنسین خودپرداز — ${b.name}`,
        description: rng.pick(["تعویض تسمهٔ مخزن اسکناس", "تعمیر کارت‌خوان", "سرویس دوره‌ای و تمیزکاری", "تعویض چاپگر رسید"]),
        location_id: b.location,
        assignment_group_id: memo.regionGroups[b.region],
        assigned_to: personOf(memo, `field:${b.region}`, rng),
        opened_at: iso(opened),
        work_type: choose("work_order", "work_type", ["corrective", "repair", "maintenance"]),
        state: choose("work_order", "state", [done ? "closed_complete" : "scheduled"]),
        closed_at: done ? iso(Math.min(now - 30_000, opened + 2 * DAY)) : undefined,
        close_code: done ? choose("work_order", "close_code", ["completed", "resolved", "fixed"]) : undefined,
        close_notes: done ? "دستگاه آزمایش و به سرویس برگشت." : undefined,
      }, { state: choose("work_order", "state", ["scheduled", "draft"]) });
      if (row) made++;
    }
  });
  bump(memo, "work_order", made);
  return true;
}

/** Records created now but opened in the past carry their opening moment as their creation time (reports by month). */
export async function backdate(sys: Ctx): Promise<void> {
  const tables = ["incident", "problem", "change_request", "request", "request_item", "sec_incident", "hr_case", "work_order"];
  await sys.write(async (tx) => {
    for (const key of tables) {
      const def = TABLES.get(key);
      if (!def) continue;
      await tx.query(
        `update ${def.table} set created_at = opened_at where org_id = $1 and opened_at is not null and opened_at < created_at
           and id in (select row_id from sm_demo_rows where org_id = $1 and tbl = $2)`,
        [sys.org.id, def.table],
      );
    }
  });
}

/** Run the load from where it stopped until the deadline. Returns true when every step is done. */
export async function runLoad(cfg: ServerConfig, orgId: string, memo: LoadMemo, deadline: number, onStep?: (memo: LoadMemo) => Promise<void>): Promise<boolean> {
  const sys = await systemCtx(cfg, orgId);
  while (memo.step < STEPS.length) {
    if (Date.now() >= deadline) return false;
    const step = STEPS[memo.step];
    const done = await step.run({ cfg, orgId, memo, deadline }, sys);
    const refused = loadRefusals(orgId);
    if (Object.keys(refused).length) memo.refused = { ...memo.refused, ...refused };
    if (done) {
      memo.step++;
      memo.cursor = 0;
    }
    await onStep?.(memo);
    if (!done) return false;
  }
  await backdate(sys);
  return true;
}
