// Visual QA: builds the UI, starts the local (Windows-flavour) server on a fresh data dir, creates
// the owner and an organisation with all modules, fills it with demo data (scripts/demo-seed.mts),
// signs in with Playwright and screenshots pages in light and dark theme (1440×900) plus a few
// pages on a phone (390×844). Writes PNGs and report.json (console errors, page errors and failed
// API calls per page) into the output folder, then stops the server.
//
//   node scripts/ui-shots.mjs [--port 4102] [--out <dir>] [--paths a,b,c] [--themes light,dark]
//        [--mobile [a,b]] [--no-mobile] [--no-build] [--static <dir>] [--concurrency 3]
//        [--full-page] [--keep-data] [--keep-server]
//
// Paths are relative to the organisation (`sales/invoices`, `` for the dashboard) unless they
// start with `/` (`/login`, `/orgs`, `/admin`). `{key}` is replaced by an id from the seed
// (e.g. `parties/{party_customer}`, see seed.json in the output). Default: every route of
// src/ui/modules/*/index.tsx without parameters, the editors of seeded documents, /login, /orgs, /admin.
//
// Assistant states: a path ending in `@ai=<state>` opens «دستیار سیراف» on that page before the screenshot:
//   chat   — a stored conversation with tool steps, a chart, a table, sources and a draft waiting for confirmation
//            (the AI endpoints are answered by the fixture below, so the shot does not depend on a model);
//            «chat-top» is the same conversation scrolled to its start (the chart)
//   empty  — a new conversation with the page's suggested questions
//   setup  — AI not configured yet (the owner's «راه‌اندازی» state)
//   palette — Ctrl K with a question typed: the «بپرس از دستیار» row (palette-empty: the suggested questions)
//   live   — with SIRAF_AI_FAKE=1: the real engine with its fake model (demo-seed adds the fake connection);
//            the question is typed into the composer and the shot waits for the answer
//   live-tools — the same with a question whose fake-model directives run analyze_metric (chart), run_report (table)
//            and propose_invoice (a draft card) on the seeded books; «live-tools-top» shows its start
//   capture — on a form with «خواندن از تصویر»: a PDF whose bytes carry a [json:…] reply is read by the fake vision
//            model and the result is shown; «capture-use» applies it to the form (SIRAF_AI_FAKE=1)
//   plan   — on reports/forecast?tab=plan: writes a plan and shows it
//
// Internal: `tsx scripts/ui-shots.mjs --serve-internal <dataDir> <port> <staticDir>` runs the server.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TSX = join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");

// ---------------------------------------------------------------- internal server mode
if (process.argv[2] === "--serve-internal") {
  const [dataDir, port, staticDir] = process.argv.slice(3);
  const { startLocal } = await import(pathToFileURL(join(ROOT, "src/desktop/server.ts")).href);
  const server = await startLocal({ dataDir, staticDir, port: Number(port) });
  console.log(`ready ${server.url}`);
  const stop = async () => {
    await server.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  // keep running until killed
  await new Promise(() => {});
}

// ---------------------------------------------------------------- options
const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const list = (v) => (v === undefined ? undefined : v.split(",").map((x) => x.trim()).filter((x, i, a) => a.indexOf(x) === i));
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

const PORT = Number(opt("port", "4102"));
const OUT = resolve(opt("out", join(tmpdir(), "siraf-ui-shots", stamp)));
const THEMES = list(opt("themes", "light,dark"));
const CONCURRENCY = Math.max(1, Number(opt("concurrency", "3")));
const FULL_PAGE = flag("full-page");
const NO_BUILD = flag("no-build");
const STATIC = opt("static") ? resolve(opt("static")) : null;
const MOBILE_DEFAULT = ["", "sales/invoices", "sales/invoices/new", "parties", "treasury/receipts", "gold/sale", "fx/rates", "fx/deals/new", "reports/trial-balance", "/login", "reports/income-statement@ai=chat", "@ai=empty"];
const AI_FAKE = process.env.SIRAF_AI_FAKE === "1";
const MOBILE = flag("no-mobile") ? [] : list(opt("mobile")) ?? MOBILE_DEFAULT;
const OWNER = { email: "demo@example.com", password: "Demo-pass-1405", full_name: "سارا محمدی" };
const ORG = { name: "بازرگانی نیک‌آوران", business_kind: "mixed", modules: ["goods", "gold", "fx"], base_currency: "IRR", city: "تهران" };
const THEME_KEYS = ["taraz.theme", "siraf.theme"];

for (const t of THEMES) if (!["light", "dark"].includes(t)) throw new Error(`unknown theme ${t}`);

const t0 = Date.now();
const log = (...a) => console.log(`[ui-shots ${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s]`, ...a);

function run(cmd, args, { env = {}, cwd = ROOT, logFile } = {}) {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const sink = logFile ? createWriteStream(logFile) : null;
    p.stdout.on("data", (d) => ((out += d), sink?.write(d)));
    p.stderr.on("data", (d) => ((out += d), sink?.write(d)));
    p.on("error", fail);
    p.on("close", (code) => {
      sink?.end();
      code === 0 ? ok(out) : fail(new Error(`${cmd} ${args.join(" ")} exited with ${code}\n${out.slice(-3000)}`));
    });
  });
}

// ---------------------------------------------------------------- default paths
function defaultPaths() {
  const mod = join(ROOT, "src/ui/modules");
  const paths = new Set([""]);
  const add = (p) => {
    if (!p.includes(":") && !p.includes("${")) paths.add(p);
  };
  for (const dir of readdirSync(mod)) {
    const f = join(mod, dir, "index.tsx");
    if (!existsSync(f)) continue;
    for (const m of readFileSync(f, "utf8").matchAll(/\bpath:\s*"([^"]*)"/g)) add(m[1]);
  }
  // commercial documents (goods/labels.ts) and gold document editors (gold/shared.tsx KIND_PATH)
  const labels = join(mod, "goods/labels.ts");
  if (existsSync(labels)) for (const m of readFileSync(labels, "utf8").matchAll(/\bpath:\s*"((?:sales|purchases)\/[^"]+)"/g)) add(m[1]);
  const gold = join(mod, "gold/shared.tsx");
  if (existsSync(gold)) {
    const src = readFileSync(gold, "utf8");
    const block = src.slice(src.indexOf("KIND_PATH"), src.indexOf("};", src.indexOf("KIND_PATH")));
    for (const m of block.matchAll(/:\s*"(gold\/[^"]+)"/g)) add(m[1]);
  }
  const detail = [
    "parties/{party_customer}", "parties/{party_company}", "sales/invoices/{sale_invoice}", "purchases/invoices/{purchase_invoice}",
    "sales/returns/{sale_return}", "sales/quotes/{quote}", "sales/orders/{sale_order}", "sales/price-lists/{price_list}", "inventory/docs/{stock_doc}",
    "accounting/vouchers/{voucher}", "treasury/docs/{receipt}", "treasury/docs/{payment}", "fx/deals/{fx_deal}", "fx/deals/{fx_deal_exchange}",
    "fx/remittances/{remittance}", "fx/remittances/{remittance_in}", "gold/docs/{gold_sale}", "gold/sale/{gold_sale}", "gold/docs/{gold_purchase}",
  ];
  const assistant = ["reports/income-statement@ai=chat", "reports/income-statement@ai=chat-top", "@ai=empty", "sales/invoices@ai=palette", "gold/rates@ai=palette-empty", "sales/invoices@ai=setup", ...(AI_FAKE ? ["@ai=live", "@ai=live-tools", "@ai=live-tools-top", "purchases/invoices/new@ai=capture", "purchases/invoices/new@ai=capture-use", "reports/forecast?tab=plan@ai=plan"] : [])];
  return [...[...paths].sort((a, b) => a.localeCompare(b)), ...detail, ...assistant, "/login", "/orgs", "/admin"];
}

// ---------------------------------------------------------------- assistant fixture (screenshots only)
const AI_NOW = () => new Date().toISOString();
const INVOICE_ID = "3f8a2c10-5b7e-4d21-9c4a-1e2f3a4b5c6d";
function aiStatus(configured) {
  return {
    enabled: true, configured, ok: configured, kind: configured ? null : "not_configured", message_fa: null, remedy_fa: null,
    can_use: true, can_propose: true, can_manage: true,
    features: { assistant: true, proposals: true, insights: true, explain: true, capture: true, forecast: true },
    budget: { state: "ok", month_usd: "3.42", month_cap_usd: "50", today_usd: "0.18", today_cap_usd: null, alert_pct: 80 },
    model: configured ? "claude-sonnet-4-6" : null, connection: configured ? "Anthropic" : null, route: configured ? "direct" : null,
    mode: "desktop", app_secret_missing: false,
  };
}
const AI_THREADS = () => {
  const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
  return [
    { id: "demo", title: "مقایسهٔ فروش و پیش‌فاکتور آریا", updated_at: ago(0.2), pinned: false },
    { id: "t2", title: "چک‌های سررسید این هفته", updated_at: ago(3), pinned: true },
    { id: "t3", title: "حباب سکهٔ امامی", updated_at: ago(26), pinned: false },
    { id: "t4", title: "جریان نقدی ۱۳ هفته", updated_at: ago(80), pinned: false },
  ];
};
function aiMessages() {
  const at = (m) => new Date(Date.now() - m * 60e3).toISOString();
  return [
    { id: "m1", role: "user", text: "فروش شش ماه اخیر را با سود ناخالص مقایسه کن و پرفروش‌ترین کالاها را بگو", created_at: at(14) },
    {
      id: "m2", role: "assistant", created_at: at(13), model: "claude-sonnet-4-6", rating: 1,
      tools: [
        { call_id: "c1", tool: "analyze_metric", title_fa: "تحلیل فروش و سود ماه به ماه", ok: true, summary_fa: "۶ ماه، ۲ سری" },
        { call_id: "c2", tool: "run_report", title_fa: "گزارش فروش کالا", ok: true, summary_fa: "۸ کالا" },
      ],
      text: "فروش **آبان** تا امروز **۱۸۶٫۴ میلیون ریال** است؛ نسبت به مهر **۱۲٪ بیشتر**، و سود ناخالص با رشد کمتری (۷٪) بالا رفته است.\n\n- حاشیهٔ سود ناخالص از **۲۴٫۱٪** به **۲۲٫۸٪** رسیده؛ تخفیف‌های فاکتورهای عمده اثر داشته است.\n- سه کالای اول **۵۸٪** فروش ماه را ساخته‌اند.\n- بزرگ‌ترین فاکتور ماه [فاکتور فروش ۱۰۲۴](siraf:invoice/" + INVOICE_ID + ") به مبلغ ۴۲ میلیون ریال بوده است.",
      refs: [
        { type: "report", id: "sales", label: "گزارش فروش", path: "sales/reports" },
        { type: "invoice", id: INVOICE_ID, label: "فاکتور فروش ۱۰۲۴", path: `sales/invoices/${INVOICE_ID}` },
        { type: "report", id: "income_statement", label: "سود و زیان", path: "reports/income-statement" },
      ],
      charts: [{ data_ref: "d-sales", spec: { kind: "bar", title: "فروش و سود ناخالص شش ماه اخیر", x: "month", series: [{ field: "sales", label: "فروش" }, { field: "profit", label: "سود ناخالص" }], unit: "میلیون ریال" } }],
      tables: [{ data_ref: "d-items", title: "پرفروش‌ترین کالاهای آبان", columns: [{ key: "item", title: "کالا" }, { key: "qty", title: "تعداد", numeric: true }, { key: "amount", title: "مبلغ (ریال)", numeric: true }], total_rows: 8 }],
    },
    { id: "m3", role: "user", text: "برای شرکت آریا تجارت ۲۰ عدد روغن موتور پیش‌نویس فاکتور فروش آماده کن", created_at: at(6) },
    {
      id: "m4", role: "assistant", created_at: at(5), model: "claude-sonnet-4-6", rating: null,
      tools: [
        { call_id: "c3", tool: "find_party", title_fa: "جست‌وجوی شخص", ok: true, summary_fa: "شرکت آریا تجارت" },
        { call_id: "c4", tool: "propose_sales_invoice", title_fa: "آماده کردن پیش‌نویس فاکتور فروش", ok: true },
      ],
      text: "پیش‌نویس آماده است. قیمت از فهرست قیمت عمده و مالیات بر ارزش افزوده ۱۰٪ حساب شده است؛ پیش از ثبت، ردیف‌ها را بررسی کنید.",
      refs: [{ type: "party", id: "8c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f", label: "شرکت آریا تجارت", path: "parties/8c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f" }],
      proposals: [{
        id: "p1", kind: "sales_invoice", title_fa: "پیش‌نویس فاکتور فروش", summary_fa: "برای شرکت آریا تجارت، یک ردیف",
        preview: [{ label: "خریدار", value: "شرکت آریا تجارت" }, { label: "تاریخ", value: "۱۱ آبان ۱۴۰۵" }, { label: "جمع با مالیات", value: "۵۳٬۴۶۰٬۰۰۰ ریال" }, { label: "مالیات بر ارزش افزوده", value: "۴٬۸۶۰٬۰۰۰ ریال" }],
        line_headers: ["کالا", "تعداد", "فی", "مبلغ"],
        lines: [{ cells: ["روغن موتور ۴ لیتری", "۲۰", "۲٬۴۳۰٬۰۰۰", "۴۸٬۶۰۰٬۰۰۰"] }],
        warnings: ["موجودی این کالا پس از این فاکتور به ۱۲ عدد می‌رسد که کمتر از نقطهٔ سفارش است."],
        status: "proposed", edit_path: "sales/invoices/new", result: null, error: null, expires_at: new Date(Date.now() + 2 * 3600e3).toISOString(),
      }],
    },
  ];
}
const AI_DATA = {
  "d-sales": { id: "d-sales", meta: { title: "فروش و سود ناخالص" }, total_rows: 6, truncated: false, rows: [
    { month: "خرداد", sales: "142.5", profit: "35.1" }, { month: "تیر", sales: "151.2", profit: "36.8" }, { month: "مرداد", sales: "138.9", profit: "33.0" },
    { month: "شهریور", sales: "160.4", profit: "39.2" }, { month: "مهر", sales: "166.3", profit: "40.1" }, { month: "آبان", sales: "186.4", profit: "42.5" },
  ] },
  "d-items": { id: "d-items", meta: { title: "پرفروش‌ترین کالاها" }, total_rows: 8, truncated: false, rows: [
    { item: "روغن موتور ۴ لیتری", qty: "64", amount: "155520000" }, { item: "فیلتر روغن", qty: "112", amount: "50400000" }, { item: "لنت ترمز جلو", qty: "38", amount: "47880000" },
    { item: "باتری ۶۰ آمپر", qty: "9", amount: "41400000" }, { item: "شمع موتور", qty: "140", amount: "25200000" }, { item: "تسمه تایم", qty: "12", amount: "19800000" },
  ] },
};

/** Answers the assistant's endpoints from the fixture (states chat, empty, setup). */
async function mockAi(page, state) {
  const json = (route, body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  await page.route(/\/api\/o\/[^/]+\/ai\/(status|threads(?:\/[^/?]+(?:\/messages)?)?|data\/[^/?]+|actions\/[^/]+\/(?:confirm|reject)|messages\/[^/]+\/rating)(?:\?.*)?$/, (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname.replace(/^\/api\/o\/[^/]+\/ai/, "");
    if (p === "/status") return json(route, aiStatus(state !== "setup"));
    if (p === "/threads") return json(route, { threads: state === "chat" ? AI_THREADS() : [] });
    if (/^\/threads\/[^/]+\/messages$/.test(p)) return json(route, { messages: aiMessages(), running: false });
    if (p.startsWith("/data/")) return json(route, AI_DATA[decodeURIComponent(p.slice(6))] ?? { id: "x", rows: [], meta: {}, total_rows: 0, truncated: false });
    return json(route, { ok: true });
  });
}

const LIVE_STATES = ["live", "live-tools", "live-tools-top", "capture", "capture-use", "plan"];
const AI_STATES = ["chat", "chat-top", "empty", "setup", "palette", "palette-empty", ...LIVE_STATES];

/** The fake model's directives for «live-tools» (names from scripts/demo-seed.mts). */
const LIVE_TOOLS_PROMPT = [
  "فروش ماه‌های امسال، تراز آزمایشی و یک پیش‌نویس فاکتور برای علی رضایی",
  '[tool:analyze_metric {"metric":"sales_amount","period":{"preset":"this_year"},"group_by":"month"}]',
  '[tool:run_report {"report":"trial_balance","params":{"level":1}}]',
  '[tool:propose_invoice {"kind":"sale","party":"علی رضایی","lines":[{"item":"گوشی شیائومی Redmi Note 13","qty":2},{"item":"گوشی سامسونگ Galaxy A55 ۲۵۶ گیگ","qty":1}]}]',
].join(" ");

/** A «scanned» purchase invoice for «capture»: a PDF whose bytes carry the fake vision model's [json:…] reply. */
function capturePdf() {
  const f = (value, confidence) => ({ value, confidence });
  const reply = {
    fields: {
      seller_name: f("شرکت پخش البرز", 0.96), seller_economic_code: f("۴۱۱۴۵۶۷۸۹۱۲۳", 0.71), invoice_no: f("۴۵۸۲", 0.93), date: f("۱۴۰۵/۰۸/۰۹", 0.9),
      subtotal: f("۵۲۴٬۰۰۰٬۰۰۰", 0.88), discount: f(null, 0), tax: f("۵۲٬۴۰۰٬۰۰۰", 0.82), total: f("۵۷۶٬۴۰۰٬۰۰۰", 0.95), currency_unit: f("ریال", 0.9),
    },
    lines: [
      { description: f("گوشی شیائومی Redmi Note 13", 0.92), qty: f("۲", 0.97), unit: f("دستگاه", 0.8), unit_price: f("۱۲۸٬۰۰۰٬۰۰۰", 0.9), total: f("۲۵۶٬۰۰۰٬۰۰۰", 0.9) },
      { description: f("گوشی سامسونگ Galaxy A55 ۲۵۶ گیگ", 0.66), qty: f("۱", 0.95), unit: f("دستگاه", 0.8), unit_price: f("۲۶۸٬۰۰۰٬۰۰۰", 0.58), total: f("۲۶۸٬۰۰۰٬۰۰۰", 0.86) },
    ],
  };
  return Buffer.from(`%PDF-1.4\n%fake scan for screenshots\n[json:${JSON.stringify(reply)}]\n%%EOF\n`, "utf8");
}

/** Opens the assistant in the job's state and waits until it has settled. */
async function openAi(page, state) {
  if (state === "plan") {
    await page.getByRole("button", { name: /نوشتن برنامه/ }).click({ timeout: 15000 });
    await page.locator(".ai-plan-md").waitFor({ timeout: 60000 });
    await page.waitForTimeout(400);
    return;
  }
  if (state.startsWith("capture")) {
    await page.locator("button.ai-xb").first().click({ timeout: 15000 });
    await page.locator(".ai-cap-m input[type=file]").first().setInputFiles({ name: "فاکتور-البرز.pdf", mimeType: "application/pdf", buffer: capturePdf() });
    await page.locator(".ai-cap-m .ant-modal-footer button.ant-btn-primary, .ai-cap-m .ai-sheet-foot button.ant-btn-primary").last().click({ timeout: 10000 });
    await page.locator(".ai-res").waitFor({ timeout: 30000 });
    if (state === "capture-use") {
      await page.locator(".ai-cap-m .ai-sheet-foot button.ant-btn-primary").last().click();
      await page.locator(".ai-cap-m").waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1500);
    } else await page.waitForTimeout(500);
    return;
  }
  if (state.startsWith("palette")) {
    await page.keyboard.press("Control+KeyK");
    await page.locator(".sh-pal input").waitFor({ timeout: 10000 });
    if (state === "palette") await page.keyboard.type("فروش این ماه چقدر بود؟");
    await page.waitForTimeout(600);
    return;
  }
  const chat = state.startsWith("chat");
  await page.evaluate((c) => window.dispatchEvent(new CustomEvent("siraf:assistant", { detail: c ? { threadId: "demo" } : { fresh: true } })), chat);
  await page.locator('.sa-panel[data-open="true"]').waitFor({ timeout: 15000 });
  if (state.startsWith("live")) {
    const box = page.locator(".sa-comp-in");
    await box.fill(state === "live" ? "خلاصهٔ امروز کسب‌وکار را با عددها بگو" : LIVE_TOOLS_PROMPT);
    await box.press("Enter");
    await page.locator(".sa-msg-a").last().waitFor({ timeout: 15000 });
    await page.waitForFunction(() => !document.querySelector(".sa-msg-a.is-live"), null, { timeout: 60000 });
  }
  await page.waitForFunction(() => !document.querySelector(".sa-panel .sf-skel"), null, { timeout: 15000 }).catch(() => {});
  if (chat || state === "live-tools" || state === "live-tools-top") await page.locator(".sa-card").first().waitFor({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(900); // the panel's slide and the charts' first draw
  if (state === "chat-top" || state === "live-tools-top") {
    await page.evaluate(() => document.querySelector(".sa-body")?.scrollTo({ top: 0 }));
    await page.waitForTimeout(200);
  }
}

const slug = (p) => (p === "" ? "dashboard" : p.replace(/@ai=/, "__ai-").replace(/^__/, "dashboard__").replace(/^\//, "").replace(/[{}]/g, "").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "id").replace(/[?&=]/g, "-").replace(/\//g, "__")) || "root";

// ---------------------------------------------------------------- main
let server = null;
let dataDir = null;
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  if (flag("keep-server")) {
    log(`server left running (pid ${server.pid})`);
    return;
  }
  await new Promise((ok) => {
    const timer = setTimeout(() => (server.kill("SIGKILL"), ok()), 15000);
    server.once("exit", () => (clearTimeout(timer), ok()));
    server.kill("SIGTERM");
  });
  log("server stopped");
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  log(`output ${OUT}`);

  // 1. build the UI into a directory of our own (never into public/ — another build may use it)
  let staticDir = STATIC ?? join(tmpdir(), "siraf-ui-shots-build");
  if (!NO_BUILD) {
    log(`building UI into ${staticDir}`);
    await run(join(ROOT, "node_modules", ".bin", "vite"), ["build", "--logLevel", "warn"], { env: { TARAZ_UI_OUT: staticDir }, logFile: join(OUT, "build.log") });
  } else if (!existsSync(join(staticDir, "index.html"))) {
    staticDir = join(ROOT, "public");
    log(`--no-build: no build in the default dir, serving ${staticDir}`);
  }
  if (!existsSync(join(staticDir, "index.html"))) throw new Error(`no index.html in ${staticDir}`);

  // 2. start the server on a fresh data dir
  dataDir = mkdtempSync(join(tmpdir(), "siraf-ui-shots-data-"));
  log(`starting server on port ${PORT} (data ${dataDir})`);
  const serverLog = createWriteStream(join(OUT, "server.log"));
  server = spawn(TSX, [fileURLToPath(import.meta.url), "--serve-internal", dataDir, String(PORT), staticDir], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  const url = await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error("server did not start within 90 s (see server.log)")), 90000);
    let buf = "";
    const onData = (d) => {
      serverLog.write(d);
      buf += d;
      const m = buf.match(/ready (http:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        ok(m[1]);
      }
    };
    server.stdout.on("data", onData);
    server.stderr.on("data", (d) => serverLog.write(d));
    server.on("exit", (code) => fail(new Error(`server exited with ${code} (see server.log)`)));
  });
  if (!url.endsWith(`:${PORT}`)) log(`warning: port ${PORT} was busy, the server took ${url}`);
  log(`server ready at ${url}`);

  // 3. owner + organisation with all modules
  let cookie = "";
  const call = async (method, path, body) => {
    const res = await fetch(`${url}/api${path}`, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
    return data;
  };
  const meta = await call("GET", "/meta");
  if (meta.first_run) await call("POST", "/auth/signup", { ...OWNER, mobile: "09121112233" });
  else await call("POST", "/auth/login", { email: OWNER.email, password: OWNER.password });
  const orgs = (await call("GET", "/orgs")).orgs;
  const orgId = orgs.find((o) => o.name === ORG.name)?.id ?? (await call("POST", "/orgs", ORG)).id;
  log(`owner ${OWNER.email}, organisation ${orgId}`);

  // 4. demo data
  const seedFile = join(OUT, "seed.json");
  const seedStart = Date.now();
  const seedOut = await run(TSX, [join(ROOT, "scripts/demo-seed.mts"), "--base", url, "--org", orgId, "--email", OWNER.email, "--password", OWNER.password, "--ids-out", seedFile], { logFile: join(OUT, "seed.log") });
  const seed = JSON.parse(readFileSync(seedFile, "utf8"));
  log(`seeded in ${((Date.now() - seedStart) / 1000).toFixed(1)}s (${seed.requests} requests) ${JSON.stringify(seed.counts)}`);
  void seedOut;

  // 5. screenshots
  const requested = list(opt("paths")) ?? defaultPaths();
  const resolvePath = (p) => {
    let missing = null;
    const filled = p.replace(/\{(\w+)\}/g, (_, k) => {
      if (!seed.ids[k]) missing = k;
      return seed.ids[k] ?? k;
    });
    if (missing) return { skip: `no seeded id «${missing}»` };
    const [page, ai = null] = filled.split("@ai=");
    if (ai && !AI_STATES.includes(ai)) return { skip: `unknown assistant state «${ai}»` };
    if (LIVE_STATES.includes(ai) && !AI_FAKE) return { skip: `@ai=${ai} needs SIRAF_AI_FAKE=1` };
    return { href: page.startsWith("/") ? page : `/${orgId}${page ? `/${page}` : ""}`, auth: !/^\/(login|setup|recover|signup)\b/.test(page), ai };
  };

  const require = createRequire(join(ROOT, "package.json"));
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const report = { started: new Date(t0).toISOString(), url, org_id: orgId, owner: OWNER.email, out: OUT, static_dir: staticDir, seed: { seconds: seed.seconds, requests: seed.requests, counts: seed.counts, ids: seed.ids }, pages: [], skipped: [] };

  // sign in once through the login form, keep the session for every context
  const loginCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "fa-IR", timezoneId: "Asia/Tehran" });
  const lp = await loginCtx.newPage();
  await lp.goto(`${url}/login`);
  try {
    await lp.locator('input[autocomplete="username"]').fill(OWNER.email, { timeout: 15000 });
    await lp.locator('input[autocomplete="current-password"]').fill(OWNER.password);
    await lp.locator('button[type="submit"]').click();
    await lp.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
    log("signed in through the login form");
  } catch (e) {
    log(`login form failed (${e.message.split("\n")[0]}), signing in through the API`);
    report.login_form_error = e.message.split("\n")[0];
    const r = await loginCtx.request.post(`${url}/api/auth/login`, { data: { email: OWNER.email, password: OWNER.password } });
    if (!r.ok()) throw new Error(`login failed: ${r.status()}`);
  }
  const storageState = await loginCtx.storageState();
  await loginCtx.close();

  const jobs = [];
  const queue = (variant, theme, viewport, paths) => {
    for (const p of paths) {
      const r = resolvePath(p);
      if (r.skip) {
        report.skipped.push({ path: p, variant, theme, reason: r.skip });
        continue;
      }
      jobs.push({ path: p, ...r, variant, theme, viewport });
    }
  };
  for (const theme of THEMES) queue("desktop", theme, { width: 1440, height: 900 }, requested);
  for (const theme of THEMES) queue("mobile", theme, { width: 390, height: 844 }, MOBILE);
  log(`${jobs.length} screenshots to take (${requested.length} paths × ${THEMES.length} themes + ${MOBILE.length} mobile × ${THEMES.length})`);

  const contexts = new Map();
  async function contextFor(job) {
    const key = `${job.variant}|${job.theme}|${job.auth}`;
    if (!contexts.has(key)) {
      const ctx = await browser.newContext({
        viewport: job.viewport,
        deviceScaleFactor: 1,
        isMobile: job.variant === "mobile",
        hasTouch: job.variant === "mobile",
        locale: "fa-IR",
        timezoneId: "Asia/Tehran",
        colorScheme: job.theme,
        storageState: job.auth ? storageState : undefined,
      });
      await ctx.addInitScript(({ keys, theme, org }) => {
        try {
          for (const k of keys) localStorage.setItem(k, theme);
          localStorage.setItem("taraz.lastOrg", org);
          localStorage.setItem("siraf.lastOrg", org);
        } catch {}
      }, { keys: THEME_KEYS, theme: job.theme, org: orgId });
      contexts.set(key, ctx);
    }
    return contexts.get(key);
  }

  async function shoot(job) {
    const ctx = await contextFor(job);
    const page = await ctx.newPage();
    const entry = { path: job.path, href: job.href, variant: job.variant, theme: job.theme, viewport: job.viewport, file: null, ms: 0, final_url: null, console_errors: [], console_warnings: 0, page_errors: [], failed_requests: [], flags: [] };
    const started = Date.now();
    let pending = 0;
    const isApi = (u) => u.startsWith(`${url}/api/`);
    page.on("console", (m) => {
      if (m.type() === "error") entry.console_errors.push(m.text().slice(0, 800));
      else if (m.type() === "warning") entry.console_warnings++;
    });
    page.on("pageerror", (e) => entry.page_errors.push(String(e?.stack ?? e).slice(0, 1500)));
    page.on("request", (r) => isApi(r.url()) && pending++);
    page.on("requestfinished", async (r) => {
      if (!isApi(r.url())) return;
      pending--;
      const res = await r.response().catch(() => null);
      if (res && res.status() >= 400) {
        let message = null;
        try {
          message = (await res.json())?.error?.message ?? null;
        } catch {}
        entry.failed_requests.push({ method: r.method(), url: r.url().slice(url.length), status: res.status(), message });
      }
    });
    page.on("requestfailed", (r) => {
      if (isApi(r.url())) pending--;
      const err = r.failure()?.errorText ?? "failed";
      if (err.includes("ERR_ABORTED")) return; // navigations / cancelled queries
      entry.failed_requests.push({ method: r.method(), url: r.url().startsWith(url) ? r.url().slice(url.length) : r.url(), status: 0, message: err });
    });
    try {
      if (job.ai && !LIVE_STATES.includes(job.ai)) await mockAi(page, job.ai.startsWith("chat") ? "chat" : job.ai);
      await page.goto(`${url}${job.href}`, { waitUntil: "load", timeout: 30000 });
      // settled = no API request in flight, no spinner/skeleton and no boot screen for 500 ms
      const deadline = Date.now() + 20000;
      let quietSince = 0;
      while (Date.now() < deadline) {
        // skeletons of the kit (sf-skel, db-sk, aria-busy) count as loading too, so lazy pages are shot with their data
        const busy = pending > 0 || (await page.locator('.boot, .ant-spin-spinning, .ant-skeleton-active, .sf-skel, .db-sk, main [aria-busy="true"]').count().catch(() => 0)) > 0;
        if (busy) quietSince = 0;
        else if (!quietSince) quietSince = Date.now();
        else if (Date.now() - quietSince > 500) break;
        await page.waitForTimeout(100);
      }
      if (Date.now() >= deadline) entry.flags.push("not_settled_in_20s");
      if (job.ai) await openAi(page, job.ai);
      await page.evaluate(() => document.fonts?.ready).catch(() => {});
      await page.waitForTimeout(250);
      const state = await page.evaluate(() => ({
        theme: document.documentElement.dataset.theme ?? null,
        notFound: document.body.innerText.includes("این صفحه پیدا نشد"),
        result: [...document.querySelectorAll(".ant-result-error .ant-result-title, .ant-result-warning .ant-result-title, .ant-result-403 .ant-result-title, .ant-result-500 .ant-result-title")].map((e) => e.textContent).join(" | "),
        alerts: [...document.querySelectorAll(".ant-alert-error")].map((e) => e.textContent?.slice(0, 200)),
        hscroll: document.documentElement.scrollWidth > window.innerWidth + 1,
      }));
      if (state.theme !== job.theme && !(job.theme === "light" && !state.theme)) entry.flags.push(`theme_is_${state.theme}`);
      if (state.notFound) entry.flags.push("route_not_found");
      if (state.result) entry.flags.push(`result: ${state.result}`);
      for (const a of state.alerts) entry.flags.push(`error_alert: ${a}`);
      if (state.hscroll) entry.flags.push("horizontal_scroll");
      entry.final_url = page.url().slice(url.length);
      if (job.auth && entry.final_url.startsWith("/login")) entry.flags.push("redirected_to_login");
      const dir = join(OUT, job.variant === "mobile" ? `mobile-${job.theme}` : job.theme);
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${slug(job.path)}.png`);
      await page.screenshot({ path: file, fullPage: FULL_PAGE, animations: "disabled", caret: "hide" });
      entry.file = file.slice(OUT.length + 1);
    } catch (e) {
      entry.flags.push(`exception: ${String(e.message ?? e).split("\n")[0]}`);
    } finally {
      entry.ms = Date.now() - started;
      await page.close().catch(() => {});
    }
    if (!job.auth) {
      // signed out: the app asks /api/auth/me once and gets 401 — that is how it learns it, not a fault
      const expected = (r) => r.status === 401 && r.url.startsWith("/api/auth/me");
      if (entry.failed_requests.some(expected)) {
        entry.expected = entry.failed_requests.filter(expected).map((r) => `${r.status} ${r.url}`);
        entry.failed_requests = entry.failed_requests.filter((r) => !expected(r));
        entry.console_errors = entry.console_errors.filter((m) => !/status of 401/.test(m));
      }
    }
    entry.ok = !entry.console_errors.length && !entry.page_errors.length && !entry.failed_requests.length && !entry.flags.length;
    report.pages.push(entry);
    const n = report.pages.length;
    if (!entry.ok || n % 20 === 0) log(`${String(n).padStart(3)}/${jobs.length} ${entry.ok ? "ok " : "ERR"} ${job.variant}/${job.theme} ${job.href}${entry.ok ? "" : ` ${JSON.stringify({ c: entry.console_errors.length, p: entry.page_errors.length, f: entry.failed_requests.map((r) => `${r.status} ${r.url}`), flags: entry.flags })}`}`);
  }

  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) await shoot(jobs[next++]);
  }));
  for (const ctx of contexts.values()) await ctx.close().catch(() => {});
  await browser.close();

  // 6. report
  const order = (e) => jobs.findIndex((j) => j.href === e.href && j.theme === e.theme && j.variant === e.variant);
  report.pages.sort((a, b) => order(a) - order(b));
  const bad = report.pages.filter((p) => !p.ok);
  report.finished = new Date().toISOString();
  report.seconds = (Date.now() - t0) / 1000;
  report.summary = {
    screenshots: report.pages.filter((p) => p.file).length,
    pages_with_problems: bad.length,
    console_errors: report.pages.reduce((a, p) => a + p.console_errors.length, 0),
    page_errors: report.pages.reduce((a, p) => a + p.page_errors.length, 0),
    failed_requests: report.pages.reduce((a, p) => a + p.failed_requests.length, 0),
    flagged: report.pages.filter((p) => p.flags.length).length,
    problems: bad.map((p) => ({ variant: p.variant, theme: p.theme, href: p.href, console_errors: p.console_errors.length, page_errors: p.page_errors.length, failed: p.failed_requests.map((r) => `${r.status} ${r.method} ${r.url}`), flags: p.flags })),
  };
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
  log(`${report.summary.screenshots} screenshots, ${bad.length} with problems → ${join(OUT, "report.json")}`);
  return bad.length;
}

let exitCode = 0;
try {
  const bad = await main();
  exitCode = bad && flag("strict") ? 1 : 0;
} catch (e) {
  console.error(e?.stack ?? e);
  exitCode = 1;
} finally {
  await stopServer();
  if (dataDir && !flag("keep-data") && !flag("keep-server")) rmSync(dataDir, { recursive: true, force: true });
  else if (dataDir) log(`data kept in ${dataDir}`);
}
process.exit(exitCode);
