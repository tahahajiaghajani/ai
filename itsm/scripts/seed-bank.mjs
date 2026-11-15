#!/usr/bin/env node
// Bank-scale seed (docs/PERFORMANCE_FA.md §۳): one organisation the size of a bank — ~30 000 employees in ~2 000
// branches organised province → region → branch, ~3 000 IT/ESM agents in ~150 groups — and five years of records at
// `--scale` (1 = 3M incidents, 1M requests with items and tasks, 200k changes, 50k problems, 20M journal entries,
// 10M history rows, 300k CIs with 1M relationships, 150k assets, 20k knowledge articles, millions of SLA timers,
// notifications and events). Realistic shapes: states by age (old records closed, a live backlog of a few weeks),
// priorities from impact × urgency, a growing yearly volume, work skewed to the busy groups (the central service desk,
// the large provinces), Persian text.
//
//   node scripts/pg-local.mjs start --fast        # bulk-load settings
//   node scripts/seed-bank.mjs --scale 0.25 [--people 1] [--sessions 3000] [--url postgres://…]
//   node scripts/pg-local.mjs restart             # measurement settings (fsync, WAL, autovacuum back on)
//
// The organisation itself is created through the app (sign-up, organisation, every module's seed jobs, the
// need-to-know desk preset); people and the org structure are generated here and loaded with COPY; the record tables
// are generated inside PostgreSQL (INSERT … SELECT over generate_series: nothing crosses the socket) with triggers off
// (`session_replication_role = replica`; numbers and the access version are set afterwards, revisions are 1 — sync
// revisions are transaction ids and generated rows are older than every snapshot). The data
// directory must stay under about 10 GB here: the script stops when less than --min-free GB (default 5) is left.
// Writes .perf/bank.json (organisation, sample people, session tokens) for scripts/loadtest.mjs.
import postgres from "postgres";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadServer } from "./serve-pg.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const [k, v] = a.slice(2).split("=");
    if (v !== undefined) out[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) out[k] = argv[++i];
    else out[k] = true;
  }
  return out;
}

const opts = args(process.argv.slice(2));
const SCALE = Number(opts.scale ?? 0.25);
const PEOPLE = Number(opts.people ?? 1);
const SESSIONS = Number(opts.sessions ?? 3000);
const URL_ = opts.url ?? process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/itsm";
const MIN_FREE_GB = Number(opts["min-free"] ?? 5);
const ONLY = opts.only ? String(opts.only).split(",") : null;
// targeted full-cardinality runs: add this many incidents (numbered after the existing ones, spread over the same five
// years) to an existing seed — e.g. --extra-incidents 2250000 on a 1/4 seed gives the full 3M at full density
const EXTRA_INCIDENTS = Number(opts["extra-incidents"] ?? 0);

/** Volumes at scale 1 (five years of a bank). */
const FULL = {
  incidents: 3_000_000,
  requests: 1_000_000,
  changes: 200_000,
  problems: 50_000,
  journal: 20_000_000,
  history: 10_000_000,
  cis: 300_000,
  rels: 1_000_000,
  assets: 150_000,
  kb: 20_000,
  slas: 6_000_000,
  notifications: 4_000_000,
  notifyLog: 3_000_000,
  events: 3_000_000,
  jobs: 300_000,
};
const N = Object.fromEntries(Object.entries(FULL).map(([k, v]) => [k, Math.max(10, Math.round(v * SCALE))]));

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(5)}s]`, ...a);

function freeGb() {
  const out = execFileSync("df", ["-k", "--output=avail", "/"], { encoding: "utf8" }).trim().split("\n").pop();
  return Number(out) / 1024 / 1024;
}
function guardDisk(step) {
  const free = freeGb();
  log(`disk free ${free.toFixed(1)} GB (${step})`);
  if (free < MIN_FREE_GB) throw new Error(`stopping: only ${free.toFixed(1)} GB free (< ${MIN_FREE_GB} GB)`);
}

// ----- deterministic randomness for the JS-generated parts --------------------------------------------------------
let s32 = 0x9e3779b9;
function rnd() {
  // mulberry32
  s32 = (s32 + 0x6d2b79f5) | 0;
  let t = s32;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (a) => a[Math.floor(rnd() * a.length)];
function uuid7(ms = Date.now()) {
  const h = ms.toString(16).padStart(12, "0");
  const r = () => Math.floor(rnd() * 16).toString(16);
  const rand = Array.from({ length: 18 }, r).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-7${rand.slice(0, 3)}-${(8 + Math.floor(rnd() * 4)).toString(16)}${rand.slice(3, 6)}-${rand.slice(6, 18)}`;
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ----- Persian vocabulary -----------------------------------------------------------------------------------------
const FIRST = "علی محمد حسین رضا مهدی امیر حمید سعید مجید مسعود جواد حسن احمد مرتضی مصطفی بهرام فرهاد کامران داریوش سیاوش مریم زهرا فاطمه سارا نرگس لیلا مینا شیرین پریسا الهام نازنین سمیرا مهسا فرشته آزاده نسرین رویا ژیلا هدیه یاسمن".split(" ");
const LAST = "محمدی حسینی احمدی رضایی موسوی کریمی جعفری صادقی رحیمی کاظمی قاسمی مرادی ابراهیمی نوری عباسی سلیمانی یزدانی شریفی اکبری باقری حیدری رستمی طاهری فرجی زمانی نجفی امیری حسن‌زاده تهرانی اصفهانی شیرازی تبریزی کرمانی رشتی همدانی قزوینی یزدی سمنانی بابایی خسروی".split(" ");
const PROVINCES = [
  ["تهران", 380], ["اصفهان", 120], ["خراسان رضوی", 130], ["فارس", 100], ["آذربایجان شرقی", 85], ["خوزستان", 95], ["البرز", 70],
  ["قم", 35], ["کرمانشاه", 45], ["گیلان", 55], ["مازندران", 70], ["آذربایجان غربی", 60], ["کرمان", 65], ["سیستان و بلوچستان", 45],
  ["هرمزگان", 40], ["یزد", 35], ["همدان", 40], ["اردبیل", 30], ["مرکزی", 35], ["قزوین", 30], ["زنجان", 25], ["گلستان", 40],
  ["لرستان", 35], ["کردستان", 35], ["بوشهر", 30], ["سمنان", 20], ["چهارمحال و بختیاری", 22], ["خراسان شمالی", 20],
  ["خراسان جنوبی", 18], ["کهگیلویه و بویراحمد", 15], ["ایلام", 15],
];
const HQ_DEPTS = [
  ["فناوری اطلاعات", 900], ["منابع انسانی", 260], ["امور مالی", 420], ["حقوقی", 120], ["امنیت اطلاعات", 90], ["عملیات بانکی", 700],
  ["اعتبارات", 520], ["بازاریابی و خدمات مشتریان", 300], ["پشتیبانی و تدارکات", 240],
];
const SPECIALIZED = [
  "شبکه و ارتباطات", "سرورها و مجازی‌سازی", "پایگاه داده", "سامانهٔ کربنکینگ", "کارت و خودپرداز", "سامانه‌های پرداخت (ساتنا، پایا، چکاوک)",
  "بانکداری اینترنتی", "بانکداری همراه", "ایمیل و همکاری", "پشتیبانی رایانه‌های ستاد", "چاپگر و تجهیزات جانبی", "تلفن و ویپ",
  "مرکز داده", "پشتیبان‌گیری و بازیابی", "توسعهٔ نرم‌افزار", "دواپس و استقرار", "مدیریت هویت و دسترسی", "سامانهٔ صندوق",
  "پایانه‌های فروش", "اتوماسیون اداری", "سامانهٔ اعتبارات", "سامانهٔ ارزی", "هوش تجاری و گزارش‌ها", "پرتال و وب‌سایت",
  "مرکز تماس", "میان‌افزار و یکپارچه‌سازی", "ذخیره‌سازی", "پایش و رخدادها", "تغییر و انتشار", "مدیریت پیکربندی",
  "پشتیبانی نرم‌افزارهای مالی", "سامانهٔ حقوق و دستمزد", "سامانهٔ منابع انسانی", "امنیت شبکه", "ضدبدافزار", "دسترسی از راه دور",
  "پشتیبانی شعب تهران بزرگ", "تجهیزات شعب", "قراردادها و تأمین‌کنندگان فناوری", "آموزش کاربران",
];
const INC_SUBJECTS = [
  "عدم دسترسی به سامانهٔ کربنکینگ", "کندی شبکهٔ شعبه", "خرابی چاپگر دفترچه", "قطعی خودپرداز", "خطا در ورود به ایمیل", "خطای کارت‌خوان",
  "قفل شدن حساب کاربری", "درخواست بازنشانی گذرواژه", "عدم اتصال وی‌پی‌ان", "خطای سامانهٔ چکاوک", "کندی سامانهٔ ساتنا", "خرابی صفحه‌کلید",
  "عدم چاپ رسید", "مشکل نرم‌افزار صندوق", "پیام خطای پایگاه داده", "قطعی تلفن داخلی", "خرابی نمایشگر", "آلودگی رایانه به بدافزار",
  "پر شدن دیسک سرور", "خطای گواهی امنیتی", "قطعی اینترنت شعبه", "خطای پایانهٔ فروش", "کندی سامانهٔ اعتبارات", "عدم همگام‌سازی صندوق",
  "خطا در انتقال وجه پایا", "مشکل ثبت چک", "خطای چاپ گزارش", "قطعی برق رک شبکه", "خرابی کارت شبکه", "عدم دسترسی به پوشهٔ اشتراکی",
];
const QUALIFIERS = [
  "از صبح امروز", "به‌صورت متناوب", "برای همهٔ کاربران شعبه", "پس از به‌روزرسانی", "هنگام ورود", "در ساعات اوج", "پس از قطعی برق",
  "فقط روی یک دستگاه", "از دیروز عصر", "با پیام خطای نامشخص", "در پایان روز کاری", "پس از تعویض تجهیز",
];
const DESCRIPTIONS = [
  "کاربر گزارش می‌دهد که سامانه پاسخ نمی‌دهد و مشتریان در صف مانده‌اند.", "تصویر پیام خطا پیوست شده است.", "مشکل پس از راه‌اندازی دوباره نیز ادامه دارد.",
  "سایر همکاران شعبه نیز همین مشکل را دارند.", "لطفاً هرچه زودتر رسیدگی شود؛ کار شعبه متوقف است.", "کابل و اتصالات بررسی شد و سالم است.",
  "این مشکل هفتهٔ گذشته نیز رخ داده بود.", "خطا هنگام ثبت تراکنش‌های بالای سقف رخ می‌دهد.", "رایانه کند است و برنامه‌ها دیر باز می‌شوند.",
];
const NOTES = [
  "با کاربر تماس گرفته شد و مشکل بررسی شد.", "لاگ‌های سرور بررسی شد؛ خطای اتصال دیده می‌شود.", "گذرواژهٔ کاربر بازنشانی شد.",
  "موضوع به گروه شبکه ارجاع شد.", "در انتظار پاسخ کاربر هستیم.", "تجهیز جایگزین برای شعبه ارسال شد.", "پس از راه‌اندازی دوباره مشکل برطرف شد.",
  "دسترسی کاربر در سامانه اصلاح شد.", "وصله‌ی امنیتی نصب شد.", "مشکل از سمت مخابرات بود و پیگیری شد.", "کاربر تأیید کرد که مشکل حل شده است.",
  "راهکار موقت به کاربر اعلام شد.", "زمان مراجعهٔ کارشناس با شعبه هماهنگ شد.", "نسخهٔ نرم‌افزار صندوق به‌روز شد.",
];
const REQ_SUBJECTS = [
  "درخواست رایانهٔ جدید", "درخواست دسترسی به سامانهٔ اعتبارات", "درخواست نصب نرم‌افزار", "درخواست کارت شناسایی", "درخواست تلفن همراه سازمانی",
  "درخواست افزایش فضای ایمیل", "درخواست دسترسی وی‌پی‌ان", "درخواست چاپگر برای شعبه", "درخواست تعویض نمایشگر", "درخواست ایجاد کاربر برای همکار جدید",
];
const CHG_SUBJECTS = [
  "ارتقای نسخهٔ پایگاه داده", "نصب وصله‌های امنیتی سرورها", "تغییر پیکربندی دیوارهٔ آتش", "استقرار نسخهٔ جدید بانکداری همراه", "جابه‌جایی رک مرکز داده",
  "افزایش پهنای باند شعب استان", "تعویض گواهی‌های امنیتی", "به‌روزرسانی نرم‌افزار خودپردازها", "مهاجرت سرور ایمیل", "تغییر زمان‌بندی پشتیبان‌گیری",
];
const PRB_SUBJECTS = [
  "قطعی‌های تکراری خودپردازهای شعب", "کندی دوره‌ای سامانهٔ کربنکینگ", "خطای مکرر همگام‌سازی صندوق", "قطعی‌های پراکندهٔ وی‌پی‌ان",
  "خطاهای تکراری پایانه‌های فروش", "نشت حافظه در سرور برنامه", "کندی گزارش‌های پایان روز",
];
const KB_TITLES = [
  "راهنمای بازنشانی گذرواژه", "رفع خطای چاپگر دفترچه", "اتصال به وی‌پی‌ان سازمانی", "رفع کندی سامانهٔ کربنکینگ", "راهنمای پایانه‌های فروش",
  "رفع خطای کارت‌خوان", "تنظیم ایمیل روی تلفن همراه", "رفع قطعی اینترنت شعبه", "راهنمای ثبت چک در چکاوک", "پیکربندی چاپگر شبکه",
];

/** A PostgreSQL array literal (`$n::text[]` / `::uuid[]`). */
const arr = (list) => `{${list.map((v) => `"${String(v).replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;

const pgText = (v) => {
  if (v === null || v === undefined) return "\\N";
  const s = typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
};

async function copy(sql, table, cols, rows) {
  const w = await sql.unsafe(`copy ${table} (${cols.join(", ")}) from stdin`).writable();
  const done = new Promise((res, rej) => {
    w.on("finish", res);
    w.on("error", rej);
  });
  let buf = "";
  for (const r of rows) {
    buf += `${r.map(pgText).join("\t")}\n`;
    if (buf.length > 1 << 20) {
      if (!w.write(buf)) await new Promise((r2) => w.once("drain", r2));
      buf = "";
    }
  }
  if (buf) w.write(buf);
  w.end();
  await done;
}

// ----- 1. the organisation, through the app -----------------------------------------------------------------------
async function createOrg(s, db) {
  const existing = await db.one(`select id from sm_orgs where name = $1 and deleted_at is null`, ["بانک نمونه"]);
  if (existing) {
    log(`organisation exists: ${existing.id}`);
    return existing.id;
  }
  const cfg = { mode: "cloud", db, secret: "itsm-perf-secret", secretSource: "env", allowSignup: true, platformAdmins: [], origin: "cloud", log: { info() {}, warn() {}, error: console.error }, fetch: globalThis.fetch.bind(globalThis) };
  const app = s.createApp(cfg);
  let cookie = "";
  const call = async (method, path, body) => {
    const res = await app.fetch(new Request(`http://perf.local/api${path}`, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }));
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    if (res.status >= 300) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };
  await call("POST", "/auth/signup", { email: "owner@bank.test", password: "perf-owner-pass-1405", full_name: "مالک سامانه" });
  const { id } = await call("POST", "/orgs", { name: "بانک نمونه", timezone: "Asia/Tehran" });
  log(`organisation ${id}: running the modules' seed jobs`);
  for (let round = 0; round < 400; round++) {
    await db.query(`update sm_jobs set run_at = now() where status = 'queued' and run_at > now() and (kind like '%seed%' or kind like '%install%')`);
    const r = await s.tick(cfg, { budgetMs: 20_000 });
    const left = await db.one(`select count(*)::int as n from sm_jobs where status = 'queued' and (kind like '%seed%' or kind like '%install%')`);
    if (!r.more && !left?.n) break;
  }
  const failed = await db.query(`select kind, last_error from sm_jobs where status = 'failed' and org_id = $1`, [id]);
  for (const f of failed) log(`seed job failed: ${f.kind}: ${String(f.last_error).slice(0, 200)}`);
  return id;
}

// ----- 2. people and the organisation structure (COPY) ------------------------------------------------------------
async function people(sql, org) {
  const existingWs = new Map((await sql.unsafe(`select key, id from sm_workspaces where org_id = $1 and deleted_at is null`, [org])).map((r) => [r.key, r.id]));
  const base = Date.parse("2021-03-21T05:00:00Z");
  const units = [];
  const unit = (name, code, kind, parent) => {
    const id = uuid7(base + units.length * 1000);
    const path = `${parent ? parent.path : "/"}${id}/`;
    const u = { id, name, code, kind, parent_id: parent?.id ?? null, path, depth: parent ? parent.depth + 1 : 0, manager_id: null, location_id: null, staff: [] };
    units.push(u);
    return u;
  };
  const root = unit("بانک نمونه", "BANK", "company", null);
  const hq = unit("ستاد مرکزی", "HQ", "division", root);
  const depts = HQ_DEPTS.map(([name, staff], i) => Object.assign(unit(name, `HQ${String(i + 1).padStart(2, "0")}`, "department", hq), { want: Math.round(staff * PEOPLE) }));
  const network = unit("شبکهٔ شعب", "NET", "division", root);
  const locations = [];
  const location = (name, code, parent) => {
    const id = uuid7(base + 10_000_000 + locations.length * 1000);
    const path = `${parent ? parent.path : "/"}${id}/`;
    const l = { id, name, code, parent_id: parent?.id ?? null, path, depth: parent ? parent.depth + 1 : 0 };
    locations.push(l);
    return l;
  };
  const hqLoc = location("ساختمان مرکزی", "L-HQ", null);
  for (const d of depts) d.location_id = hqLoc.id;
  const provinces = [];
  const branches = [];
  let branchNo = 1000;
  PROVINCES.forEach(([name, nb], pi) => {
    const p = unit(`مدیریت شعب استان ${name}`, `P${String(pi + 1).padStart(2, "0")}`, "division", network);
    p.prov = pi;
    const ploc = location(`استان ${name}`, `L-P${pi + 1}`, null);
    p.location_id = ploc.id;
    p.want = Math.round(10 * PEOPLE);
    provinces.push(p);
    const count = Math.max(1, Math.round(nb * PEOPLE));
    const regions = Math.max(1, Math.round(count / 13));
    const regs = [];
    for (let r = 0; r < regions; r++) {
      const ru = unit(`منطقهٔ ${r + 1} استان ${name}`, `${p.code}R${r + 1}`, "department", p);
      ru.prov = pi;
      ru.location_id = ploc.id;
      ru.want = Math.round(5 * PEOPLE);
      regs.push(ru);
    }
    for (let b = 0; b < count; b++) {
      branchNo++;
      const bu = unit(`شعبهٔ ${branchNo} ${name}`, `B${branchNo}`, "branch", regs[b % regs.length]);
      bu.prov = pi;
      bu.location_id = location(`شعبهٔ ${branchNo}`, `L-B${branchNo}`, ploc).id;
      bu.want = 6 + Math.floor(rnd() * 15);
      branches.push(bu);
    }
  });
  // employees (requesters), then agents (IT and ESM staff)
  const users = [];
  const person = (u, kind) => {
    const id = uuid7(base + 50_000_000 + users.length * 1000);
    const n = users.length + 1;
    const p = { id, n, email: `${kind === "agent" ? "a" : "u"}${String(n).padStart(5, "0")}@bank.test`, full_name: `${pick(FIRST)} ${pick(LAST)}`, unit: u, kind, roles: [kind === "agent" ? "agent" : "requester"], manager_id: null };
    users.push(p);
    u.staff.push(p);
    return p;
  };
  for (const u of [...depts, ...provinces, ...units.filter((x) => x.kind === "department" && x.prov !== undefined), ...branches]) {
    for (let i = 0; i < (u.want ?? 0); i++) person(u, "employee");
  }
  const employees = users.length;
  const it = depts[0];
  const groups = [];
  const group = (name, kind, size, ws, extra = {}) => {
    const g = { id: uuid7(base + 80_000_000 + groups.length * 1000), name, kind, size: Math.max(2, Math.round(size * PEOPLE)), ws, members: [], restricted: false, types: ["assignment"], ...extra };
    groups.push(g);
    return g;
  };
  const WS_KEYS = { it: "it", hr: "hr", fin: "finance", sec: "soc", fac: "facilities" };
  const WS = Object.fromEntries(Object.entries(WS_KEYS).map(([k, key], i) => [k, existingWs.get(key) ?? uuid7(base + 90_000_000 + i * 1000)]));
  group("میز خدمت مرکزی", "l1", 450, WS.it);
  const totalBranches = branches.length;
  PROVINCES.forEach(([name], pi) => {
    const nb = branches.filter((b) => b.prov === pi).length;
    group(`پشتیبانی فناوری استان ${name}`, "prov", Math.max(8, (1300 * nb) / totalBranches), WS.it, { prov: pi });
  });
  for (const name of SPECIALIZED) group(name, "spec", 20, WS.it);
  for (let i = 1; i <= 8; i++) group(`امور کارکنان ${i}`, "hr", 10, WS.hr);
  for (let i = 1; i <= 8; i++) group(`امور مالی ${i}`, "fin", 8, WS.fin);
  for (let i = 1; i <= 4; i++) group(`مرکز عملیات امنیت ${i}`, "sec", 10, WS.sec, { restricted: true });
  for (const [name] of PROVINCES.slice(0, 31)) group(`پشتیبانی و تدارکات ${name}`, "fac", 4, WS.fac);
  for (let i = 1; i <= 6; i++) group(`هیئت مشورتی تغییر ${i}`, "cab", 10, WS.it, { types: ["approval", "cab"] });
  while (groups.length < 150) group(`گروه پشتیبانی ${groups.length + 1}`, "spec", 8, WS.it);
  // agents: one per seat of a group (CAB members are agents of other groups)
  for (const g of groups) {
    if (g.kind === "cab") continue;
    const home = g.kind === "prov" ? provinces[g.prov] : g.kind === "hr" ? depts[1] : g.kind === "fin" ? depts[2] : g.kind === "sec" ? depts[4] : g.kind === "fac" ? depts[8] : it;
    for (let i = 0; i < g.size; i++) {
      const a = person(home, "agent");
      g.members.push({ user: a, kind: i === 0 ? "lead" : "member" });
      if (i === 0) a.roles = ["team_lead"];
    }
  }
  const agents = users.filter((u) => u.kind === "agent");
  for (const g of groups.filter((x) => x.kind === "cab")) for (let i = 0; i < g.size; i++) g.members.push({ user: pick(agents), kind: i === 0 ? "lead" : "member" });
  // a fifth of the L1 desk also works in a specialised group
  const spec = groups.filter((g) => g.kind === "spec");
  for (const m of groups[0].members.slice(0, Math.round(groups[0].members.length / 5))) pick(spec).members.push({ user: m.user, kind: "member" });
  agents.slice(0, 5).forEach((a) => (a.roles = ["service_desk_manager"]));
  agents.slice(5, 8).forEach((a) => (a.roles = ["incident_manager"]));
  agents.slice(8, 10).forEach((a) => (a.roles = ["problem_manager"]));
  // managers: the first person of each unit heads it; heads report to the head above
  for (const u of units) u.manager_id = u.staff[0]?.id ?? null;
  const byUnit = new Map(units.map((u) => [u.id, u]));
  const headAbove = (u) => {
    for (let p = byUnit.get(u.parent_id); p; p = byUnit.get(p.parent_id)) if (p.manager_id) return p.manager_id;
    return null;
  };
  for (const p of users) p.manager_id = p.unit.manager_id && p.unit.manager_id !== p.id ? p.unit.manager_id : headAbove(p.unit);
  log(`people: ${employees} employees, ${agents.length} agents, ${units.length} units (${branches.length} branches), ${groups.length} groups, ${locations.length} locations`);

  const now = new Date().toISOString();
  await copy(sql, "sm_users", ["id", "email", "full_name", "prefs", "created_at"], users.map((u) => [u.id, u.email, u.full_name, "{}", now]));
  await copy(sql, "sm_org_members", ["id", "org_id", "user_id", "role", "overrides", "is_active", "rev"], users.map((u, i) => [uuid7(base + 60_000_000 + i), org, u.id, "member", "{}", true, 1]));
  const eng = ["org_id", "created_at", "updated_at", "rev", "version", "custom"];
  const engv = (i) => [org, now, now, 1 + i, 1, "{}"];
  const wsRows = [
    [WS.it, "it", "فناوری اطلاعات", false, false, true, ...engv(1)],
    [WS.hr, "hr", "منابع انسانی", false, true, true, ...engv(2)],
    [WS.fin, "finance", "امور مالی", false, true, true, ...engv(3)],
    [WS.sec, "soc", "مرکز عملیات امنیت", false, true, true, ...engv(4)],
    [WS.fac, "facilities", "پشتیبانی و تدارکات", false, false, true, ...engv(5)],
  ].filter((r) => !existingWs.has(r[1]));
  await copy(sql, "sm_workspaces", ["id", "key", "name", "is_default", "secure", "active", ...eng], wsRows);
  // the departments' workspaces are secure (deny-by-default), whoever created them
  await sql.unsafe(`update sm_workspaces set secure = true where org_id = $1 and key in ('hr', 'finance', 'soc')`, [org]);
  await copy(sql, "sm_locations", ["id", "name", "code", "parent_id", "path", "depth", "active", ...eng], locations.map((l, i) => [l.id, l.name, l.code, l.parent_id, l.path, l.depth, true, ...engv(i)]));
  await copy(sql, "sm_org_units", ["id", "name", "code", "kind", "parent_id", "manager_id", "location_id", "is_domain", "active", "path", "depth", ...eng], units.map((u, i) => [u.id, u.name, u.code, u.kind, u.parent_id, u.manager_id, u.location_id, false, true, u.path, u.depth, ...engv(i)]));
  await copy(sql, "sm_groups", ["id", "name", "types", "restricted", "active", "roles", "workspace_id", "manager_id", ...eng], groups.map((g, i) => [g.id, g.name, g.types, g.restricted, true, [], g.ws, g.members[0]?.user.id ?? null, ...engv(i)]));
  const memberships = [];
  for (const g of groups) for (const m of g.members) memberships.push([uuid7(base + 70_000_000 + memberships.length), g.id, m.user.id, m.kind, ...engv(memberships.length)]);
  await copy(sql, "sm_group_members", ["id", "group_id", "user_id", "kind", ...eng], memberships);
  await copy(sql, "sm_member_profiles", ["id", "user_id", "name", "persona", "roles", "org_unit_id", "location_id", "manager_id", "workspaces", "out_of_office", "vip", ...eng],
    users.map((u, i) => [uuid7(base + 75_000_000 + i), u.id, u.full_name, u.kind === "agent" ? "agent" : "requester", u.roles, u.unit.id, u.unit.location_id ?? null, u.manager_id, u.kind === "agent" ? [WS.it] : [], false, false, ...engv(i)]));

  // helper tables for the record generators
  await sql.unsafe(`drop table if exists perf_emp, perf_grp, perf_agent`);
  await sql.unsafe(`create unlogged table perf_emp (idx int primary key, id uuid not null, unit_id uuid, location_id uuid, prov int, code text, manager_id uuid)`);
  await sql.unsafe(`create unlogged table perf_grp (idx int primary key, id uuid not null, kind text, prov int, ws uuid, members uuid[])`);
  await sql.unsafe(`create unlogged table perf_agent (idx int primary key, id uuid not null)`);
  const emps = shuffle(users.filter((u) => u.kind === "employee"));
  await copy(sql, "perf_emp", ["idx", "id", "unit_id", "location_id", "prov", "code", "manager_id"], emps.map((u, i) => [i + 1, u.id, u.unit.id, u.unit.location_id ?? null, u.unit.prov ?? -1, u.unit.code, u.manager_id]));
  await copy(sql, "perf_grp", ["idx", "id", "kind", "prov", "ws", "members"], groups.map((g, i) => [i + 1, g.id, g.kind, g.prov ?? -1, g.ws, `{${[...new Set(g.members.map((m) => m.user.id))].join(",")}}`]));
  await copy(sql, "perf_agent", ["idx", "id"], shuffle([...agents]).map((a, i) => [i + 1, a.id]));
  await sql.unsafe(`analyze perf_emp; analyze perf_grp; analyze perf_agent`);

  // sessions for the load test: agents (by group kind), requesters, department heads
  const sessions = [];
  const token = (u, i) => {
    const sid = uuid7(base + 95_000_000 + i);
    const secret = createHash("sha256").update(`perf:${u.id}`).digest("base64url");
    sessions.push([sid, u.id, createHash("sha256").update(secret).digest("hex"), "web", new Date(Date.now() + 300 * 86400_000).toISOString()]);
    return `${sid}.${secret}`;
  };
  const sample = { agents: [], requesters: [], heads: [], leads: [] };
  const groupsOf = new Map();
  for (const g of groups) for (const m of g.members) groupsOf.set(m.user.id, [...(groupsOf.get(m.user.id) ?? []), g.kind]);
  for (const a of shuffle([...agents]).slice(0, Math.min(agents.length, Math.round(SESSIONS / 2)))) {
    sample.agents.push({ id: a.id, token: token(a, sessions.length), kinds: groupsOf.get(a.id) ?? [], role: a.roles[0] });
  }
  for (const e of emps.slice(0, Math.round(SESSIONS / 2))) sample.requesters.push({ id: e.id, token: token(e, sessions.length) });
  for (const u of [...provinces, ...units.filter((x) => x.kind === "department" && x.prov !== undefined)].slice(0, 40)) {
    const head = users.find((x) => x.id === u.manager_id);
    if (head) sample.heads.push({ id: head.id, token: token(head, sessions.length), unit: u.name, kind: u.kind === "division" ? "province" : "region" });
  }
  await copy(sql, "sm_sessions", ["id", "user_id", "token_hash", "kind", "expires_at"], sessions);
  return { users: users.length, employees, agents: agents.length, units: units.length, branches: branches.length, groups: groups.length, ws: WS, sample, groupIds: groups.map((g) => ({ id: g.id, kind: g.kind, name: g.name })) };
}

// ----- 3. records, generated inside PostgreSQL --------------------------------------------------------------------
const FUNCS = `
create or replace function pg_temp.uuid7(ts timestamptz) returns uuid language sql volatile as $f$
  select (lpad(to_hex((extract(epoch from ts) * 1000)::bigint), 12, '0') || '7' || substr(md5(random()::text), 1, 3)
          || to_hex(8 + floor(random() * 4)::int) || substr(md5(random()::text), 1, 15))::uuid
$f$;
create or replace function pg_temp.pick(a text[]) returns text language sql volatile as $f$ select a[1 + floor(random() * cardinality(a))::int] $f$;
create or replace function pg_temp.pickz(a uuid[]) returns uuid language sql volatile as $f$
  select case when cardinality(a) is null or cardinality(a) = 0 then null else a[1 + floor(random() * cardinality(a))::int] end
$f$;
`;

async function records(sql, org, meta) {
  const q = (text, params = []) => sql.unsafe(text, params);
  await q(FUNCS);
  await q(`select setseed(0.4242)`);
  await q(`create sequence if not exists perf_rev start 1000`);
  const choices = async (list, fallback) => {
    const r = await q(`select value from sm_choices where org_id = $1 and list = $2 and deleted_at is null and coalesce(active, true) order by sort_order`, [org, list]);
    return r.length ? r.map((x) => x.value) : fallback;
  };
  const cats = await choices("incident.category", ["software", "hardware", "network", "access", "inquiry"]);
  const codes = await choices("incident.close_code", ["solved", "workaround", "not_reproducible", "duplicate"]);
  const channels = await choices("incident.channel", ["portal", "phone", "email", "walk_in", "chat"]);
  const items = await q(`select i.id, i.name, (select v.id from sm_catalog_item_versions v where v.item_id = i.id order by v.created_at desc limit 1) as version_id
                         from sm_catalog_items i where i.org_id = $1 and i.deleted_at is null limit 60`, [org]).catch(() => []);
  const itemIds = items.map((x) => x.id);
  const itemVersions = items.map((x) => x.version_id);
  const slaDefs = (await q(`select id from sm_sla_definitions where org_id = $1 and deleted_at is null limit 20`, [org]).catch(() => [])).map((x) => x.id);
  const kbBase = (await q(`select id from sm_kb_bases where org_id = $1 and deleted_at is null order by created_at limit 1`, [org]).catch(() => []))[0]?.id ?? null;
  const ciClasses = (await q(`select key from sm_ci_classes where org_id = $1 and deleted_at is null limit 40`, [org]).catch(() => [])).map((x) => x.key);
  const relTypes = (await q(`select key from sm_ci_rel_types where org_id = $1 and deleted_at is null limit 20`, [org]).catch(() => [])).map((x) => x.key);
  const counts = (await q(`select (select count(*) from perf_emp)::int as e, (select count(*) from perf_grp)::int as g, (select count(*) from perf_agent)::int as a`))[0];
  const IT = meta.ws.it;
  const want = (step) => !ONLY || ONLY.includes(step);

  // state of a task by age (days): a live backlog of a few weeks, everything older closed
  const STATE = (states) => `case
      when age < 2 then (case when rs < 0.25 then '${states.new}' when rs < 0.70 then '${states.work}' when rs < 0.80 then '${states.hold}' when rs < 0.95 then '${states.resolved}' else '${states.closed}' end)
      when age < 14 then (case when rs < 0.20 then '${states.work}' when rs < 0.28 then '${states.hold}' when rs < 0.53 then '${states.resolved}' else '${states.closed}' end)
      when age < 40 then (case when rs < 0.04 then '${states.work}' when rs < 0.06 then '${states.hold}' when rs < 0.10 then '${states.resolved}' when rs < 0.98 then '${states.closed}' else '${states.canceled}' end)
      else (case when rs < 0.96 then '${states.closed}' else '${states.canceled}' end) end`;
  // creation instants over five years, growing by year; `g` follows time, so numbers grow with it
  const CREATED = (n) => `now() - interval '1826 days' * power(1 - (g::float8 / ${n + 1}), 1.3) - interval '1 minute' * (random() * 20)`;

  async function task(name, table, n, states, extra) {
    if (!want(name)) return;
    const offset = extra.offset ?? 0;
    guardDisk(`before ${name}`);
    const t = Date.now();
    const batch = 250_000;
    for (let from = 1; from <= n; from += batch) {
      const to = Math.min(n, from + batch - 1);
      await q(`
        insert into ${table} (id, org_id, no, short_description, description, state, priority, impact, urgency, category, channel,
          caller_id, requested_for, opened_by, opened_at, assignment_group_id, assigned_to, location_id, resolved_at, resolved_by, closed_at, closed_by,
          close_code, close_notes, watch_list, reassignment_count, reopen_count, time_worked, first_response_at, active, sla_due, knowledge,
          unit_id, workspace_id, created_at, created_by, updated_at, updated_by, rev, version, custom${extra.cols ? `, ${extra.cols}` : ""})
        select pg_temp.uuid7(x.created), $1, ${offset} + x.g,
          pg_temp.pick($2::text[]) || ' ' || pg_temp.pick($3::text[]) || ' — ' || e.code,
          pg_temp.pick($4::text[]) || ' ' || pg_temp.pick($4::text[]),
          x.state, (x.imp + x.urg - 1)::text, x.imp::text, x.urg::text, pg_temp.pick($5::text[]), pg_temp.pick($6::text[]),
          e.id, e.id, case when x.ro < 0.6 then e.id else ag.agent end, x.created, gg.id,
          case when x.state = '${states.new}' and x.ra < 0.6 then null else ag.agent end,
          e.location_id,
          case when x.done then x.resolved end, case when x.done then ag.agent end,
          case when x.closed then x.resolved + interval '3 days' end, case when x.closed then ag.agent end,
          case when x.done then pg_temp.pick($7::text[]) end, case when x.done then pg_temp.pick($8::text[]) end,
          case when x.rw < 0.02 and e.manager_id is not null then jsonb_build_array(e.manager_id) else '[]'::jsonb end,
          case when x.rr < 0.7 then 0 when x.rr < 0.9 then 1 else 2 end, 0,
          case when x.done then (600 + floor(random() * 30000))::bigint end,
          x.created + interval '1 minute' * (5 + random() * 115), not x.done,
          x.created + interval '1 hour' * (case x.imp + x.urg - 1 when 1 then 4 when 2 then 8 when 3 then 24 when 4 then 72 else 120 end), false,
          e.unit_id, ${extra.ws ?? "gg.ws"}, x.created, case when x.ro < 0.6 then e.id else ag.agent end,
          least(now(), case when x.closed then x.resolved + interval '3 days' when x.done then x.resolved else x.created + (now() - x.created) * random() end),
          coalesce(ag.agent, e.id), 1, 2 + floor(random() * 6)::int, '{}'::jsonb${extra.vals ? `, ${extra.vals}` : ""}
        from (
          select y.*, y.state in ('${states.resolved}', '${states.closed}', '${states.canceled}') as done, y.state in ('${states.closed}', '${states.canceled}') as closed,
                 least(now() - interval '1 minute', y.created + interval '1 hour' * exp(random() * 4.8)) as resolved
          from (
            select z.*, ${STATE(states)} as state
            from (
              select g, c as created, extract(epoch from now() - c) / 86400 as age, random() as rs, random() as ro, random() as ra, random() as rw, random() as rr,
                     (case when random() < 0.05 then 1 when random() < 0.3 then 2 else 3 end) as imp,
                     (case when random() < 0.10 then 1 when random() < 0.4 then 2 else 3 end) as urg,
                     1 + floor(power(random(), 1.7) * ${counts.e})::int as ei, random() as rg, random() as rq
              from (select g, ${CREATED(n)} as c from generate_series(${from}, ${to}) g) gs
            ) z
          ) y
        ) x
        join perf_emp e on e.idx = x.ei
        join perf_grp gg on gg.idx = (${extra.group})
        cross join lateral (select pg_temp.pickz(gg.members) as agent) ag`,
        [org, arr(extra.subjects), arr(QUALIFIERS), arr(DESCRIPTIONS), arr(cats), arr(channels), arr(codes), arr(NOTES)],
      );
      process.stdout.write(`\r  ${name} ${to.toLocaleString()} / ${n.toLocaleString()}   `);
    }
    process.stdout.write("\n");
    await q(`insert into sm_numbers (org_id, table_key, last) values ($1, $2, $3) on conflict (org_id, table_key) do update set last = greatest(sm_numbers.last, excluded.last)`, [org, extra.key, offset + n]);
    log(`${name}: ${n.toLocaleString()} rows in ${((Date.now() - t) / 1000).toFixed(0)} s`);
  }

  // incidents: 35 % the central desk, 40 % the caller's province, 25 % a specialised group (busy ones first)
  const GROUP_IT = `case when x.rg < 0.35 then 1 when x.rg < 0.75 then 2 + greatest(e.prov, 0)
                         else 33 + floor(power(x.rq, 1.5) * 40)::int end`;
  const incidentOffset = EXTRA_INCIDENTS ? Number((await q(`select coalesce(max(no), 0)::int as n from sm_incidents where org_id = $1`, [org]))[0].n) : 0;
  await task("incidents", "sm_incidents", EXTRA_INCIDENTS || N.incidents, { new: "new", work: "in_progress", hold: "on_hold", resolved: "resolved", closed: "closed", canceled: "canceled" },
    { key: "incident", subjects: INC_SUBJECTS, group: GROUP_IT, ws: `'${IT}'::uuid`, cols: "affected_users", vals: "'[]'::jsonb", offset: incidentOffset });
  await task("requests", "sm_requests", N.requests, { new: "submitted", work: "in_fulfilment", hold: "awaiting_approval", resolved: "delivered", closed: "closed_complete", canceled: "cancelled" },
    { key: "request", subjects: REQ_SUBJECTS, group: `case when x.rg < 0.5 then 1 else 2 + greatest(e.prov, 0) end`, ws: `'${IT}'::uuid`, cols: "items_count, fulfillers", vals: "1, '[]'::jsonb" });
  await task("changes", "sm_change_requests", N.changes, { new: "new", work: "implement", hold: "authorize", resolved: "review", closed: "closed", canceled: "canceled" },
    { key: "change_request", subjects: CHG_SUBJECTS, group: `33 + floor(power(x.rq, 1.3) * 40)::int`, ws: `'${IT}'::uuid`, cols: "type, planned_start, planned_end", vals: "case when x.rq < 0.7 then 'normal' when x.rq < 0.95 then 'standard' else 'emergency' end, x.created + interval '5 days', x.created + interval '5 days 2 hours'" });
  await task("problems", "sm_problems", N.problems, { new: "new", work: "rca", hold: "pending", resolved: "resolved", closed: "closed", canceled: "canceled" },
    { key: "problem", subjects: PRB_SUBJECTS, group: `33 + floor(power(x.rq, 1.3) * 40)::int`, ws: `'${IT}'::uuid` });

  if (want("items")) {
    guardDisk("before request items");
    const t = Date.now();
    // 1.25 items a request (the catalogue's items), 1.2 tasks an item (a specialised group fulfils)
    await q(`
      insert into sm_request_items (id, org_id, no, short_description, state, priority, caller_id, requested_for, opened_by, opened_at,
        assignment_group_id, assigned_to, location_id, closed_at, active, request_id, cat_item_id, item_version_id, quantity, watch_list, fulfillers,
        unit_id, workspace_id, created_at, created_by, updated_at, updated_by, rev, version, custom)
      select pg_temp.uuid7(r.created_at), r.org_id, row_number() over (order by r.no, k), r.short_description,
        case r.state when 'submitted' then 'pending' when 'delivered' then 'delivered' when 'closed_complete' then 'closed_complete' when 'cancelled' then 'cancelled'
                     when 'awaiting_approval' then 'awaiting_approval' else 'in_fulfilment' end,
        r.priority, r.caller_id, r.requested_for, r.opened_by, r.opened_at, r.assignment_group_id, r.assigned_to, r.location_id, r.closed_at, r.active,
        r.id, ($2::uuid[])[1 + (abs(hashtext(r.id::text || k)) % greatest(cardinality($2::uuid[]), 1))], ($3::uuid[])[1 + (abs(hashtext(r.id::text || k)) % greatest(cardinality($3::uuid[]), 1))],
        1, '[]'::jsonb, '[]'::jsonb, r.unit_id, r.workspace_id, r.created_at, r.created_by, r.updated_at, r.updated_by, 1, r.version, '{}'::jsonb
      from sm_requests r cross join lateral generate_series(1, case when abs(hashtext(r.id::text)) % 4 = 0 then 2 else 1 end) k
      where r.org_id = $1`, [org, arr(itemIds), arr(itemVersions.filter(Boolean))]);
    const ni = Number((await q(`select count(*)::int as n from sm_request_items where org_id = $1`, [org]))[0].n);
    await q(`update sm_requests r set items_count = 2 where org_id = $1 and abs(hashtext(r.id::text)) % 4 = 0`, [org]);
    await q(`
      insert into sm_request_tasks (id, org_id, no, short_description, state, priority, caller_id, requested_for, opened_by, opened_at,
        assignment_group_id, assigned_to, closed_at, active, request_item_id, request_id, sort_order, requester_visible, watch_list,
        unit_id, workspace_id, created_at, created_by, updated_at, updated_by, rev, version, custom)
      select pg_temp.uuid7(i.created_at), i.org_id, row_number() over (order by i.no, k), 'انجام: ' || i.short_description,
        case when i.active then (case when k = 1 then 'work_in_progress' else 'open' end) when i.state = 'cancelled' then 'cancelled' else 'closed_complete' end,
        i.priority, i.caller_id, i.requested_for, i.opened_by, i.opened_at, gg.id, pg_temp.pickz(gg.members), i.closed_at, i.active, i.id, i.request_id, k, false, '[]'::jsonb,
        i.unit_id, i.workspace_id, i.created_at, i.created_by, i.updated_at, i.updated_by, 1, i.version, '{}'::jsonb
      from sm_request_items i cross join lateral generate_series(1, case when abs(hashtext(i.id::text)) % 5 = 0 then 2 else 1 end) k
      join perf_grp gg on gg.idx = 33 + (abs(hashtext(i.id::text || k)) % 40)
      where i.org_id = $1`, [org]);
    const nt = Number((await q(`select count(*)::int as n from sm_request_tasks where org_id = $1`, [org]))[0].n);
    await q(`insert into sm_numbers (org_id, table_key, last) values ($1, 'request_item', $2), ($1, 'request_task', $3) on conflict (org_id, table_key) do update set last = greatest(sm_numbers.last, excluded.last)`, [org, ni, nt]);
    log(`request items ${ni.toLocaleString()}, tasks ${nt.toLocaleString()} in ${((Date.now() - t) / 1000).toFixed(0)} s`);
  }

  // incidents linked to problems (3 %)
  if (want("links")) {
    await q(`update sm_incidents i set problem_id = p.id from (select id, row_number() over (order by no) as rn from sm_problems where org_id = $1) p
             where i.org_id = $1 and i.no % 33 = 0 and p.rn = 1 + (i.no / 33) % ${Math.max(1, N.problems)}`, [org]);
  }

  // journal: comments and work notes spread over the records' lives (60 % on incidents)
  if (want("journal")) {
    guardDisk("before journal");
    const t = Date.now();
    const parts = [
      ["incident", "sm_incidents", Math.round(N.journal * 0.6)],
      ["request", "sm_requests", Math.round(N.journal * 0.1)],
      ["request_item", "sm_request_items", Math.round(N.journal * 0.1)],
      ["request_task", "sm_request_tasks", Math.round(N.journal * 0.1)],
      ["change_request", "sm_change_requests", Math.round(N.journal * 0.06)],
      ["problem", "sm_problems", Math.round(N.journal * 0.04)],
    ];
    for (const [key, table, total] of parts) {
      const rows = Number((await q(`select count(*)::int as n from ${table} where org_id = $1`, [org]))[0].n);
      if (!rows) continue;
      const per = Math.max(1, Math.round((2 * total) / rows) - 1);
      // per record: 1..(2·mean − 1) entries, by a hash of its id (deterministic, mean ≈ total / rows)
      await q(`
        insert into sm_journal (id, org_id, table_key, record_id, kind, visibility, body, author, attachments, created_at, updated_at, rev)
        select pg_temp.uuid7(ts), r.org_id, '${key}', r.id, case when random() < 0.5 then 'work_note' else 'comment' end,
               case when random() < 0.5 then 'internal' else 'public' end, pg_temp.pick($2::text[]),
               coalesce(r.assigned_to, r.caller_id), '[]'::jsonb, ts, ts, 1
        from ${table} r
        cross join lateral generate_series(1, 1 + abs(hashtext(r.id::text)) % ${per}) k
        cross join lateral (select r.created_at + (r.updated_at - r.created_at) * (k::float8 / (2 + abs(hashtext(r.id::text)) % ${per})) as ts) tt
        where r.org_id = $1`, [org, arr(NOTES)]);
      process.stdout.write(`\r  journal ${key} done   `);
      guardDisk(`journal ${key}`);
    }
    process.stdout.write("\n");
    log(`journal: ${Number((await q(`select count(*)::bigint as n from sm_journal where org_id = $1`, [org]))[0].n).toLocaleString()} in ${((Date.now() - t) / 1000).toFixed(0)} s`);
  }

  // history: state and assignment changes
  if (want("history")) {
    guardDisk("before history");
    const t = Date.now();
    const parts = [
      ["incident", "sm_incidents", Math.round(N.history * 0.6), "in_progress"],
      ["request", "sm_requests", Math.round(N.history * 0.15), "in_fulfilment"],
      ["request_item", "sm_request_items", Math.round(N.history * 0.1), "in_fulfilment"],
      ["change_request", "sm_change_requests", Math.round(N.history * 0.1), "implement"],
      ["problem", "sm_problems", Math.round(N.history * 0.05), "rca"],
    ];
    for (const [key, table, total, work] of parts) {
      const rows = Number((await q(`select count(*)::int as n from ${table} where org_id = $1`, [org]))[0].n);
      if (!rows) continue;
      const per = Math.max(1, Math.round(total / rows));
      await q(`
        insert into sm_history (id, org_id, table_key, record_id, field, old, new, actor, at, created_at, updated_at, rev)
        select pg_temp.uuid7(ts), r.org_id, '${key}', r.id,
               case k % 3 when 1 then 'state' when 2 then 'assigned_to' else 'priority' end,
               case k % 3 when 1 then to_jsonb('new'::text) when 2 then 'null'::jsonb else to_jsonb('4'::text) end,
               case k % 3 when 1 then to_jsonb(case when k > 3 then r.state else '${work}' end) when 2 then to_jsonb(r.assigned_to) else to_jsonb(r.priority) end,
               r.updated_by, ts, ts, ts, 1
        from ${table} r
        cross join lateral generate_series(1, ${per}) k
        cross join lateral (select r.created_at + (r.updated_at - r.created_at) * (k::float8 / ${per + 1}) as ts) tt
        where r.org_id = $1`, [org]);
      guardDisk(`history ${key}`);
    }
    log(`history: ${Number((await q(`select count(*)::bigint as n from sm_history where org_id = $1`, [org]))[0].n).toLocaleString()} in ${((Date.now() - t) / 1000).toFixed(0)} s`);
  }

  // CMDB: CIs (servers, workstations, ATMs, network devices, applications…) and their relationships
  if (want("cmdb")) {
    guardDisk("before cmdb");
    const t = Date.now();
    const classes = ciClasses.length ? ciClasses : ["server", "computer", "network_gear", "application", "database", "printer"];
    // the modules' own CIs (services, offerings) keep their numbers
    const ciBase = Number((await q(`select coalesce(max(no), 0)::int as n from sm_cis where org_id = $1`, [org]))[0].n);
    await q(`
      insert into sm_cis (id, org_id, no, name, class, environment, criticality, operational_status, install_status, state, tags, support_group_id, location_id,
        serial_number, hostname, ip_address, health_score, is_stale, supports_critical_function, watch_list, created_at, updated_at, rev, version, custom)
      select pg_temp.uuid7(c), $1, ${ciBase} + g, pg_temp.pick($2::text[]) || '-' || g, pg_temp.pick($2::text[]), case when random() < 0.8 then 'production' else 'test' end,
             case when random() < 0.1 then '1' when random() < 0.4 then '2' else '3' end, 'operational', 'installed', 'operational', '[]'::jsonb,
             (select id from perf_grp where idx = 33 + (g % 40)), e.location_id, 'SN' || g, 'host-' || g, '10.' || (g % 250) || '.' || ((g / 250) % 250) || '.' || (g % 200),
             50 + floor(random() * 50)::int, false, random() < 0.05, '[]'::jsonb, c, c, 1, 1, '{}'::jsonb
      from (select g, ${CREATED(N.cis)} as c from generate_series(1, ${N.cis}) g) x
      join perf_emp e on e.idx = 1 + (g::bigint * 7919) % ${counts.e}`, [org, arr(classes)]);
    await q(`insert into sm_numbers (org_id, table_key, last) values ($1, 'ci', $2) on conflict (org_id, table_key) do update set last = greatest(sm_numbers.last, excluded.last)`, [org, ciBase + N.cis]);
    const types = relTypes.length ? relTypes : ["depends_on", "runs_on", "connects_to", "contains"];
    await q(`
      insert into sm_ci_rels (id, org_id, parent_id, type, child_id, origin_kind, impact_weight, created_at, updated_at, rev, version, custom)
      select pg_temp.uuid7(now() - interval '1000 days' * random()), $1, p.id, pg_temp.pick($2::text[]), c.id, 'manual', 100, now(), now(), 1, 1, '{}'::jsonb
      from generate_series(1, ${N.rels}) g
      join (select id, row_number() over (order by no) as rn from sm_cis where org_id = $1) p on p.rn = 1 + (g::bigint * 31) % ${N.cis}
      join (select id, row_number() over (order by no) as rn from sm_cis where org_id = $1) c on c.rn = 1 + (g::bigint * 7 + g / ${N.cis} + 1) % ${N.cis}
      where p.id <> c.id`, [org, arr(types)]);
    log(`cmdb: ${N.cis.toLocaleString()} CIs, ~${N.rels.toLocaleString()} relationships in ${((Date.now() - t) / 1000).toFixed(0)} s`);
  }

  if (want("assets")) {
    guardDisk("before assets");
    const assetBase = Number((await q(`select coalesce(max(no), 0)::int as n from sm_assets where org_id = $1`, [org]))[0].n);
    await q(`
      insert into sm_assets (id, org_id, no, name, asset_tag, serial_number, category, asset_class, state, substate, quantity, assigned_to, assigned_at, location_id,
        purchase_cost, purchase_date, tags, watch_list, unit_id, created_at, updated_at, rev, version, custom)
      select pg_temp.uuid7(c), $1, ${assetBase} + g, pg_temp.pick(array['رایانهٔ رومیزی', 'لپ‌تاپ', 'چاپگر', 'نمایشگر', 'کارت‌خوان', 'اسکنر']) || ' ' || g, 'AT' || g, 'S' || g,
             'hardware', 'hardware', case when random() < 0.75 then 'in_use' when random() < 0.9 then 'in_stock' else 'retired' end, null, 1,
             e.id, c, e.location_id, (5000000 + floor(random() * 90000000))::numeric, c::date, '[]'::jsonb, '[]'::jsonb, e.unit_id, c, c, 1, 1, '{}'::jsonb
      from (select g, ${CREATED(N.assets)} as c from generate_series(1, ${N.assets}) g) x
      join perf_emp e on e.idx = 1 + (g::bigint * 104729) % ${counts.e}`, [org]);
    await q(`insert into sm_numbers (org_id, table_key, last) values ($1, 'asset', $2) on conflict (org_id, table_key) do update set last = greatest(sm_numbers.last, excluded.last)`, [org, assetBase + N.assets]);
    log(`assets: ${N.assets.toLocaleString()}`);
  }

  if (want("kb") && kbBase) {
    guardDisk("before kb");
    // compiled audience columns as the knowledge module's hook writes them for an article of the base
    const sample = (await q(`select * from sm_kb_articles where org_id = $1 and base_id = $2 and deleted_at is null limit 1`, [org, kbBase]))[0] ?? null;
    const keep = sample ? Object.keys(sample).filter((k) => /^(c_|r_|x_|k_)/.test(k) || ["audience_mode", "units_tree", "read_users", "read_groups", "read_units", "deny_users", "deny_groups", "deny_units"].includes(k)) : [];
    const cols = keep.length ? `, ${keep.join(", ")}` : "";
    const vals = keep.length ? `, ${keep.map((k) => `s.${k}`).join(", ")}` : "";
    await q(`
      insert into sm_kb_articles (id, org_id, no, title, summary, body, keywords, tags, article_type, language, base_id, author_id, owner_group_id, visibility,
        confidential, state, published_at, first_published_at, view_count, helpful_yes, helpful_no, workspace_id, created_at, updated_at, rev, version, custom${cols})
      select pg_temp.uuid7(c), $1, 100000 + g, pg_temp.pick($3::text[]) || ' (' || g || ')', pg_temp.pick($4::text[]),
             repeat(pg_temp.pick($4::text[]) || ' ' || pg_temp.pick($5::text[]) || E'\\n', 6), '[]'::jsonb, '[]'::jsonb, 'how_to', 'fa', $2,
             a.id, (select id from perf_grp where idx = 33 + (g % 40)), 'inherit', false, case when random() < 0.85 then 'published' else 'draft' end,
             c, c, floor(random() * 2000)::int, floor(random() * 50)::int, floor(random() * 10)::int, null, c, c, 1, 1, '{}'::jsonb${vals}
      from (select g, ${CREATED(N.kb)} as c from generate_series(1, ${N.kb}) g) x
      join perf_agent a on a.idx = 1 + (g::bigint * 31) % ${counts.a}
      ${keep.length ? `cross join (select * from sm_kb_articles where id = '${sample.id}') s` : ""}`, [org, kbBase, arr(KB_TITLES), arr(DESCRIPTIONS), arr(NOTES)]);
    await q(`insert into sm_numbers (org_id, table_key, last) values ($1, 'kb_article', $2) on conflict (org_id, table_key) do update set last = greatest(sm_numbers.last, excluded.last)`, [org, 100000 + N.kb]);
    log(`knowledge: ${N.kb.toLocaleString()} articles`);
  }

  // SLA timers: response + resolution on incidents, resolution on request items (active ones still running)
  if (want("slas")) {
    guardDisk("before slas");
    const t = Date.now();
    const defs = slaDefs.length ? `{${slaDefs.join(",")}}` : "{}";
    for (const [key, table, share] of [["incident", "sm_incidents", 0.8], ["request_item", "sm_request_items", 0.2]]) {
      const rows = Number((await q(`select count(*)::int as n from ${table} where org_id = $1`, [org]))[0].n);
      if (!rows) continue;
      const per = Math.max(1, Math.round((N.slas * share) / rows));
      await q(`
        insert into sm_task_slas (id, org_id, name, definition_id, table_key, record_id, record_number, type, target, stage, active, breached, start_at, planned_end_at,
          stop_at, breached_at, paused_total, duration, business_elapsed, percent, warned, timezone, computed_at, created_at, updated_at, rev, version, custom)
        select pg_temp.uuid7(r.created_at), r.org_id, case when k = 1 then 'پاسخ' else 'حل' end, ($2::uuid[])[1 + (k % greatest(cardinality($2::uuid[]), 1))], '${key}', r.id::text, r.number,
               'sla', case when k = 1 then 'response' else 'resolution' end,
               case when r.active then 'in_progress' when random() < 0.08 then 'breached' else 'achieved' end, r.active, random() < 0.08,
               r.created_at, r.created_at + interval '8 hours', case when not r.active then coalesce(r.resolved_at, r.closed_at, r.updated_at) end, null, 0,
               3600, 3600, (random() * 100)::numeric(6, 2), 0, 'Asia/Tehran', r.updated_at, r.created_at, r.updated_at, 1, 1, '{}'::jsonb
        from ${table} r cross join lateral generate_series(1, ${per}) k
        where r.org_id = $1`, [org, defs]);
      guardDisk(`slas ${key}`);
    }
    log(`SLA timers: ${Number((await q(`select count(*)::int as n from sm_task_slas where org_id = $1`, [org]))[0].n).toLocaleString()} in ${((Date.now() - t) / 1000).toFixed(0)} s`);
  }

  if (want("notifications")) {
    guardDisk("before notifications");
    const t = Date.now();
    await q(`
      insert into sm_notifications (id, org_id, user_id, title, body, link, table_key, record_id, record_number, event, kind, read_at, created_at, updated_at, rev, version, custom)
      select pg_temp.uuid7(i.updated_at), i.org_id, coalesce(case when k = 1 then i.assigned_to end, i.caller_id), 'به‌روزرسانی ' || i.number, i.short_description,
             '/r/incident/' || i.id, 'incident', i.id::text, i.number, case when k = 1 then 'record.assigned' else 'record.updated' end, 'direct',
             case when i.active and random() < 0.6 then null else i.updated_at end, i.updated_at, i.updated_at, 1, 1, '{}'::jsonb
      from sm_incidents i cross join lateral generate_series(1, ${Math.max(1, Math.round(N.notifications / Math.max(1, N.incidents)))}) k
      where i.org_id = $1`, [org]);
    await q(`
      insert into sm_notification_log (id, org_id, created_at, updated_at, rule_key, event, table_key, record_id, record_number, channel, recipient_id, target, status, subject)
      select pg_temp.uuid7(i.updated_at), i.org_id, i.updated_at, i.updated_at, 'incident.updated', 'record.updated', 'incident', i.id, i.number, 'email', i.caller_id,
             'user@bank.test', 'sent', 'به‌روزرسانی ' || i.number
      from sm_incidents i where i.org_id = $1 and i.no % ${Math.max(1, Math.round(N.incidents / Math.max(1, N.notifyLog)))} = 0`, [org]);
    log(`notifications in ${((Date.now() - t) / 1000).toFixed(0)} s`);
  }

  if (want("events")) {
    guardDisk("before events");
    await q(`
      insert into sm_events (id, org_id, message, status, severity, node, resource, metric, value, tags, occurred_at, received_at, processed_at, fingerprint, outcome,
        payload, created_at, updated_at, rev, version, custom)
      select pg_temp.uuid7(c), $1, 'هشدار ' || pg_temp.pick(array['پردازنده', 'حافظه', 'دیسک', 'پینگ', 'سرویس']) || ' روی host-' || (g % 5000), case when random() < 0.5 then 'firing' else 'resolved' end,
             pg_temp.pick(array['critical', 'major', 'minor', 'warning', 'info']), 'host-' || (g % 5000), 'svc', 'cpu', (random() * 100)::numeric(6, 2), '[]'::jsonb,
             c, c, c, md5((g % 20000)::text), 'deduplicated', '{}'::jsonb, c, c, 1, 1, '{}'::jsonb
      from (select g, now() - interval '365 days' * power(1 - (g::float8 / ${N.events + 1}), 1.2) as c from generate_series(1, ${N.events}) g) x`, [org]);
    log(`events: ${N.events.toLocaleString()}`);
  }

  if (want("jobs")) {
    // three days of finished jobs (the queue keeps them that long) and a small live backlog
    await q(`
      insert into sm_jobs (id, org_id, kind, payload, status, run_at, attempts, max_attempts, created_at, updated_at, done_at)
      select pg_temp.uuid7(c), $1, pg_temp.pick(array['notify.send', 'record.event', 'sla.check', 'rag.index', 'notify.flush']), '{}'::jsonb, 'done', c, 1, 8, c, c, c + interval '2 seconds'
      from (select g, now() - interval '3 days' * random() as c from generate_series(1, ${N.jobs}) g) x`, [org]);
  }
}

async function finish(sql, org) {
  const q = (text, params = []) => sql.unsafe(text, params);
  const t = Date.now();
  // revisions are transaction ids: the generated rows carry revision 1 (older than every snapshot); a new sync epoch
  // makes a Windows app that pulled this organisation before the seed read everything again
  await q(`insert into sm_org_sync (org_id, rev, epoch) values ($1, 0, (extract(epoch from clock_timestamp()) * 1000)::bigint)
           on conflict (org_id) do update set epoch = greatest(sm_org_sync.epoch + 1, excluded.epoch)`, [org]);
  await q(`insert into sm_access_state (org_id, version) values ($1, 1) on conflict (org_id) do update set version = sm_access_state.version + 1, updated_at = now()`, [org]);
  await q(`update sm_orgs set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{access}', coalesce(settings -> 'access', '{}'::jsonb) || '{"preset":"need_to_know"}'::jsonb) where id = $1`, [org]);
  log("vacuum analyze (visibility maps for index-only scans)…");
  await q(`vacuum (analyze)`);
  await q(`checkpoint`);
  log(`finished in ${((Date.now() - t) / 1000).toFixed(0)} s`);
}

function writeBank(org, meta) {
  mkdirSync(join(ROOT, ".perf"), { recursive: true });
  writeFileSync(join(ROOT, ".perf", "bank.json"), JSON.stringify({ org, scale: SCALE, people: PEOPLE, volumes: N, ws: meta.ws, groups: meta.groupIds, sample: meta.sample, at: new Date().toISOString() }, null, 1));
}

/** The load test's people when the organisation is already loaded (a resumed seed): sessions and kinds from the database. */
async function sampleFromDb(sql, org) {
  const ws = (await sql.unsafe(`select key, id from sm_workspaces where org_id = $1`, [org])).reduce((m, r) => ({ ...m, [r.key === "finance" ? "fin" : r.key === "soc" ? "sec" : r.key === "facilities" ? "fac" : r.key]: r.id }), {});
  const secret = (id) => createHash("sha256").update(`perf:${id}`).digest("base64url");
  const rows = await sql.unsafe(`
    select s.id as sid, s.user_id, u.email, p.roles, (select array_agg(distinct g.kind) from perf_grp g where s.user_id = any(g.members)) as kinds,
           (select o.kind || ':' || o.name from sm_org_units o where o.manager_id = s.user_id and o.org_id = $1 and o.kind in ('division', 'department') limit 1) as heads
    from sm_sessions s join sm_users u on u.id = s.user_id left join sm_member_profiles p on p.user_id = s.user_id and p.org_id = $1
    where s.revoked_at is null and u.email like '%@bank.test' order by s.id`, [org]);
  const sample = { agents: [], requesters: [], heads: [], leads: [] };
  for (const r of rows) {
    const token = `${r.sid}.${secret(r.user_id)}`;
    if (r.heads) sample.heads.push({ id: r.user_id, token, unit: r.heads.split(":")[1], kind: r.heads.startsWith("division") ? "province" : "region" });
    else if (r.email.startsWith("a")) sample.agents.push({ id: r.user_id, token, kinds: r.kinds ?? [], role: (r.roles ?? [])[0] ?? "agent" });
    else sample.requesters.push({ id: r.user_id, token });
  }
  const groupIds = (await sql.unsafe(`select id, kind from perf_grp order by idx`)).map((g) => ({ id: g.id, kind: g.kind }));
  log(`sample from the database: ${sample.agents.length} agents, ${sample.requesters.length} requesters, ${sample.heads.length} heads`);
  return { ws, sample, groupIds };
}

async function sizes(sql) {
  return sql.unsafe(`select relname as table, n_live_tup::bigint as rows, pg_size_pretty(pg_total_relation_size(relid)) as size, pg_total_relation_size(relid) as bytes
                     from pg_stat_user_tables order by pg_total_relation_size(relid) desc limit 25`);
}

async function main() {
  guardDisk("start");
  log(`scale ${SCALE} (people ${PEOPLE}): ${JSON.stringify(N)}`);
  const s = await loadServer();
  const db = s.createPostgresDb({ url: URL_, max: 4, ssl: false });
  await s.migrate(db, (m) => log(m));
  const org = await createOrg(s, db);
  const sql = postgres(URL_, { max: 1, onnotice: () => {}, connection: { application_name: "itsm-seed" } });
  const reserved = await sql.reserve();
  await reserved.unsafe(`set session_replication_role = replica`);
  await reserved.unsafe(`set synchronous_commit = off`);
  await reserved.unsafe(`set maintenance_work_mem = '512MB'`);
  let meta;
  const have = await reserved.unsafe(`select count(*)::int as n from sm_member_profiles where org_id = $1`, [org]);
  if (Number(have[0].n) > 1000) {
    log("people already loaded");
    meta = await sampleFromDb(reserved, org);
  } else {
    meta = await people(reserved, org);
  }
  writeBank(org, meta);
  if (!ONLY || !ONLY.includes("people-only")) await records(reserved, org, meta);
  await reserved.unsafe(`set session_replication_role = origin`);
  await finish(reserved, org);
  const sz = await sizes(reserved);
  const total = (await reserved.unsafe(`select pg_database_size(current_database())::bigint as b`))[0].b;
  reserved.release();
  await sql.end();
  await db.close();
  log(`database ${(Number(total) / 1024 ** 3).toFixed(2)} GB`);
  for (const r of sz) console.log(`  ${r.table.padEnd(28)} ${String(r.rows).padStart(11)}  ${r.size}`);
  guardDisk("end");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
