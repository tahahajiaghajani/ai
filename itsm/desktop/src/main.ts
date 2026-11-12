// Electron main process of the Windows app.
// Starts the local server (embedded PostgreSQL + API + UI) in a utility process and shows it in
// a window. In "client" mode it opens the server of another computer of the office network.
import { app, BrowserWindow, utilityProcess, ipcMain, shell, dialog, Menu, Tray, nativeImage, nativeTheme, type UtilityProcess } from "electron";
import { join, isAbsolute } from "node:path";
import http from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync, renameSync } from "node:fs";
import { APP_NAME, APP_NAME_EN, APP_TAGLINE } from "../../src/shared/constants";
import { backendExecArgv } from "../../src/shared/desktop/node-flags";

const APP_TITLE = APP_NAME;
/** electron-builder.yml `appId` (taskbar grouping, notifications): an internal identifier, kept when the product is renamed. */
const APP_ID = "app.itsm.desktop";
/** %APPDATA%\ITSM: Electron's own profile, and the app's data under data\ (also an internal identifier). */
const APP_DIR_NAME = "ITSM";
/** The window canvas of each theme (`--ds-canvas` in src/ui/ds/tokens.css), so the window never flashes white. */
const CANVAS = { light: "#F7F4F0", dark: "#110F0E" } as const;
type ThemePref = "system" | "light" | "dark";
type ThemeMode = keyof typeof CANVAS;
const isSmoke = process.argv.includes("--smoke-test") || process.env.ITSM_SMOKE === "1";

// set explicitly, so neither the profile nor the data follow package.json's name or the product name
const appDir = join(app.getPath("appData"), APP_DIR_NAME);
app.setPath("userData", appDir);
/** %APPDATA%\ITSM\data (ITSM_DATA_DIR overrides it: the smoke test, a portable copy). */
const dataDir = process.env.ITSM_DATA_DIR || join(appDir, "data");
const logDir = join(dataDir, "logs");
mkdirSync(logDir, { recursive: true });
const logFile = join(logDir, "app.log");

function log(line: string) {
  try {
    if (existsSync(logFile) && statSync(logFile).size > 5_000_000) renameSync(logFile, `${logFile}.1`);
    appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* ignore */
  }
}

function readConfig(): Record<string, any> {
  try {
    return JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8"));
  } catch {
    return {};
  }
}
function writeClientServer(url: string | null) {
  const c = readConfig();
  c.client = { ...(c.client ?? {}), server_url: url };
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(c, null, 2));
}

/** Window preferences of the main process (kept apart from config.json, which the local server owns). */
const uiFile = join(dataDir, "window.json");
function readUi(): { theme?: ThemePref } {
  try {
    return JSON.parse(readFileSync(uiFile, "utf8"));
  } catch {
    return {};
  }
}
function themePref(): ThemePref {
  const t = readUi().theme;
  return t === "light" || t === "dark" ? t : "system";
}
function themeMode(pref: ThemePref = themePref()): ThemeMode {
  return pref === "system" ? (nativeTheme.shouldUseDarkColors ? "dark" : "light") : pref;
}

/** Persian digits for the version line of the splash: 1.2.0 → ۱٫۲٫۰ */
const faDigits = (s: string) => s.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]).replace(/\./g, "٫");

let backend: UtilityProcess | null = null;
let win: BrowserWindow | null = null;
let splash: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let serverUrl = "";

// Windows picks the hand-pixelled 16/24/32 px cuts from the .ico; the tray uses tray.png with its @1.5x/@2x cuts.
const iconPath = process.platform === "win32" && existsSync(join(__dirname, "icon.ico")) ? join(__dirname, "icon.ico") : join(__dirname, "icon.png");
const trayIconPath = join(__dirname, "tray.png");

function startBackend(): Promise<{ url: string; host: string }> {
  return new Promise((resolve, reject) => {
    const entry = join(__dirname, "backend.cjs");
    backend = utilityProcess.fork(entry, [], {
      serviceName: `${APP_NAME_EN} Server`,
      stdio: "pipe",
      // Windows' certificate store (the bank's CA installed by GPO) for the sync with the server edition, when this
      // Electron's Node can read it (Node 22.15+ / 23.8+; Electron 45 ships Node 24); otherwise NODE_EXTRA_CA_CERTS
      execArgv: backendExecArgv(process.versions.node),
      env: {
        ...process.env,
        ITSM_DATA_DIR: dataDir,
        ITSM_STATIC_DIR: join(__dirname, "renderer"),
        // a first start loads the database made at build time instead of running initdb and every migration
        // (src/desktop/db-template.ts)
        ITSM_DB_TEMPLATE: join(__dirname, "db-template.tar.br"),
        // V8's compiled code of the local server's 12 MB bundle, kept between starts (Node's compile cache; checked
        // against the file's content, so an update compiles once again): about 0.5 s less at every start
        NODE_COMPILE_CACHE: join(appDir, "code-cache"),
        NODE_ENV: "production",
      },
    });
    const timer = setTimeout(() => reject(new Error("سرور محلی در زمان مقرر آماده نشد")), 90_000);
    backend.stdout?.on("data", (d) => {
      const text = String(d);
      log(`[server] ${text.trimEnd()}`);
      // real progress: every database migration the server applies moves the splash on
      const applied = text.match(/migration \S+ applied/g)?.length ?? 0;
      if (applied) onMigrations(applied);
    });
    backend.stderr?.on("data", (d) => log(`[server:err] ${String(d).trimEnd()}`));
    backend.on("message", (m: any) => {
      if (m?.type === "ready") {
        clearTimeout(timer);
        resolve({ url: m.url, host: m.host });
      } else if (m?.type === "error") {
        clearTimeout(timer);
        reject(new Error(m.message));
      }
    });
    backend.on("exit", (code) => {
      log(`[server] exited with ${code}`);
      backend = null;
      if (!quitting && !isSmoke) {
        dialog
          .showMessageBox({
            type: "error",
            title: APP_TITLE,
            message: "سرور داخلی برنامه متوقف شد.",
            detail: `جزئیات در فایل گزارش: ${logFile}`,
            buttons: ["اجرای دوباره", "خروج"],
          })
          .then((r) => {
            if (r.response === 0) {
              app.relaunch();
            }
            app.exit(0);
          });
      }
    });
  });
}

// ---------------------------------------------------------------- splash
// desktop/src/splash.html (copied next to main.cjs): 520 × 320, frameless, rounded, the monogram's launch and a real
// progress line driven by the stages below through its `itsm.*` API. The name and tagline come in the query string.
const SPLASH_MIN_MS = 1100; // let the launch (≈ 1 s) finish even on a fast start
let splashShownAt = 0;
let splashLoaded: Promise<void> = Promise.resolve();

function createSplash() {
  splash = new BrowserWindow({
    width: 520,
    height: 320,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    center: true,
    title: APP_TITLE,
    icon: iconPath,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  splash.setMenu(null);
  splashLoaded = new Promise((resolve) => {
    splash!.webContents.once("did-finish-load", () => resolve());
    splash!.webContents.once("did-fail-load", () => resolve());
  });
  splash.loadFile(join(__dirname, "splash.html"), { query: { name: APP_NAME, tagline: APP_TAGLINE } });
  splash.once("ready-to-show", () => {
    splashShownAt = Date.now();
    splash?.show();
  });
  splash.on("closed", () => (splash = null));
  void splashCall(`itsm.version(${JSON.stringify(`نسخهٔ ${faDigits(app.getVersion())}`)})`);
}

/** Runs `js` in the splash once it has loaded (ignored when the splash is gone). */
async function splashCall(js: string) {
  await splashLoaded;
  if (!splash || splash.isDestroyed()) return;
  try {
    await splash.webContents.executeJavaScript(js, true);
  } catch {
    /* the splash is only decoration */
  }
}
function splashStep(p: number, cap: number, status: string, tau?: number) {
  void splashCall(`itsm.step(${p}, ${cap}, ${JSON.stringify(status)}${tau ? `, ${tau}` : ""})`);
}

/** Completes the progress line, then swaps the splash for the main window. */
async function finishSplash(show: () => void) {
  if (!splash || splash.isDestroyed()) return show();
  const wait = Math.max(0, SPLASH_MIN_MS - (splashShownAt ? Date.now() - splashShownAt : 0));
  if (wait) await new Promise((r) => setTimeout(r, wait));
  await splashCall(`itsm.ready("آماده است")`);
  await new Promise((r) => setTimeout(r, 650));
  show();
  splash?.destroy();
  splash = null;
}

let migrationsSeen = 0;
let firstRun = false;
let serverReady = false;
function onMigrations(n: number) {
  migrationsSeen += n;
  if (serverReady) return; // a late stdout chunk must not move the status line back
  const p = Math.min(0.6, 0.08 + migrationsSeen * 0.04);
  splashStep(p, Math.min(0.64, p + 0.06), firstRun ? "آماده‌سازی برای نخستین اجرا…" : "به‌روزرسانی داده‌ها…", 1.5);
}

/** Resolves once the page has replaced the boot screen of index.html with the app and painted text (at most `max` ms). */
async function appRendered(w: BrowserWindow, max = 6000) {
  const until = Date.now() + max;
  while (Date.now() < until && !w.isDestroyed()) {
    try {
      const done = await w.webContents.executeJavaScript(`(() => { const r = document.getElementById("root"); return !!r && !r.querySelector(":scope > .boot") && r.innerText.trim().length > 0 && document.fonts.status === "loaded"; })()`, true);
      if (done) return;
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 80));
  }
}

/** The first status line: what the local server is about to do with the database. */
function bootStatus(): { text: string; tau: number } {
  if (existsSync(join(dataDir, "restore.pending"))) return { text: "بازگردانی نسخهٔ پشتیبان…", tau: 6 };
  firstRun = !existsSync(join(dataDir, "db"));
  if (firstRun) return { text: "آماده‌سازی برای نخستین اجرا…", tau: 6 };
  if (process.argv.includes("--updated")) return { text: "به‌روزرسانی داده‌ها…", tau: 4 };
  return { text: "باز کردن داده‌ها…", tau: 2.4 };
}

/** Same origin as the server the window shows (not a prefix test: http://127.0.0.1:3939@evil.example or :39390 pass that). */
function isAppUrl(target: string): boolean {
  try {
    return !!serverUrl && new URL(target).origin === new URL(serverUrl).origin;
  } catch {
    return false;
  }
}

/** Only web and mail links go to the system: file:, smb:, ms-… handlers can run programs. */
function openExternalSafe(target: string) {
  try {
    const u = new URL(target);
    if (u.protocol === "http:" || u.protocol === "https:" || u.protocol === "mailto:") void shell.openExternal(u.href);
  } catch {
    /* not a URL */
  }
}

/** IPC from the app's own page only (a frame of another origin gets nothing from the main process). */
function fromApp(e: { senderFrame?: { url: string } | null }): boolean {
  const url = e.senderFrame?.url;
  return !!url && isAppUrl(url);
}

function createWindow(url: string) {
  win = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: APP_TITLE,
    icon: iconPath,
    backgroundColor: CANVAS[themeMode()],
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.loadURL(url);
  win.webContents.once("did-finish-load", () => splashStep(0.9, 0.97, "آماده‌سازی میز کار…", 1.2));
  win.once("ready-to-show", async () => {
    // while the splash is up, swap only when the app itself has painted (no second boot screen in between)
    if (splash && win) await appRendered(win);
    await finishSplash(() => {
      win?.maximize();
      win?.show();
    });
  });
  // links to other sites open in the default browser; the window itself (which carries the
  // bridge of the preload) only ever shows the app's own server
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (!isAppUrl(target)) openExternalSafe(target);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, target) => {
    if (!isAppUrl(target)) {
      e.preventDefault();
      openExternalSafe(target);
    }
  });
  win.on("close", (e) => {
    const lan = readConfig().lan?.enabled;
    if (lan && !quitting && tray) {
      // keep serving the office network from the tray
      e.preventDefault();
      win?.hide();
    }
  });
  win.on("closed", () => (win = null));
}

function createTray() {
  // tray.png is the 16 px cut; Electron picks tray@1.5x.png / tray@2x.png on scaled displays
  const img = existsSync(trayIconPath) ? nativeImage.createFromPath(trayIconPath) : nativeImage.createFromPath(join(__dirname, "icon.png")).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip(`${APP_NAME} — سرور شبکه فعال است`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `باز کردن ${APP_NAME}`, click: () => (win ? win.show() : createWindow(serverUrl)) },
      { type: "separator" },
      { label: "خروج کامل", click: () => quit() },
    ]),
  );
  tray.on("double-click", () => (win ? win.show() : createWindow(serverUrl)));
}

/**
 * Asks the local server to close the database and waits until it has exited (at most `ms`), then makes sure it is gone.
 * Closing is a checkpoint and PGlite's own shutdown (src/server/db/pglite.ts): usually well under a second, as the
 * running app checkpoints its log as it goes. Killing it earlier only costs a replay of the log at the next start.
 */
async function stopBackend(ms = 10_000) {
  const b = backend;
  if (!b) return;
  const exited = new Promise<void>((r) => b.once("exit", () => r()));
  b.postMessage({ type: "shutdown" });
  await Promise.race([exited, new Promise((r) => setTimeout(r, ms))]);
  if (backend === b) b.kill();
}

async function quit() {
  quitting = true;
  try {
    await stopBackend();
  } finally {
    app.exit(0);
  }
}

function setupMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: "برنامه",
      submenu: [
        { label: "بارگذاری دوباره", accelerator: "F5", click: () => win?.webContents.reload() },
        { label: "بزرگ‌نمایی", accelerator: "CmdOrCtrl+=", role: "zoomIn" },
        { label: "کوچک‌نمایی", accelerator: "CmdOrCtrl+-", role: "zoomOut" },
        { label: "اندازه‌ی عادی", accelerator: "CmdOrCtrl+0", role: "resetZoom" },
        { label: "تمام صفحه", accelerator: "F11", role: "togglefullscreen" },
        { type: "separator" },
        { label: "پوشه‌ی داده‌ها", click: () => shell.openPath(dataDir) },
        { label: "ابزار توسعه", accelerator: "CmdOrCtrl+Shift+I", role: "toggleDevTools" },
        { type: "separator" },
        { label: "خروج", accelerator: "Alt+F4", click: () => quit() },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

function registerIpc() {
  // the page reports its theme (preference and the theme in effect): the title bar, the window canvas and the next start follow it
  ipcMain.on("itsm:theme", (e, t: { pref?: string; mode?: string }) => {
    const pref: ThemePref = t?.pref === "light" || t?.pref === "dark" ? t.pref : "system";
    const mode: ThemeMode = t?.mode === "dark" ? "dark" : "light";
    if (nativeTheme.themeSource !== pref) nativeTheme.themeSource = pref;
    BrowserWindow.fromWebContents(e.sender)?.setBackgroundColor(CANVAS[mode]);
    if (readUi().theme !== pref) {
      try {
        writeFileSync(uiFile, JSON.stringify({ ...readUi(), theme: pref }, null, 2));
      } catch {
        /* ignore */
      }
    }
  });
  // pageSize: a named paper («A5») or a custom one in microns ({ width, height }: an 80 mm roll, labels)
  ipcMain.handle("itsm:print", async (e, opts: { silent?: boolean; printer?: string; landscape?: boolean; pageSize?: string | { width: number; height: number } } = {}) => {
    if (!fromApp(e)) throw new Error("forbidden");
    const wc = e.sender;
    return new Promise<void>((resolve, reject) =>
      wc.print({ silent: !!opts.silent, deviceName: opts.printer, landscape: !!opts.landscape, pageSize: (opts.pageSize as any) || "A4", printBackground: true }, (ok, reason) =>
        ok || reason === "cancelled" ? resolve() : reject(new Error(reason)),
      ),
    );
  });
  ipcMain.handle("itsm:printers", async (e) => {
    if (!fromApp(e)) throw new Error("forbidden");
    return (await e.sender.getPrintersAsync()).map((p) => ({ name: p.name, isDefault: (p as any).isDefault ?? false }));
  });
  ipcMain.handle("itsm:save-pdf", async (e, name: string) => {
    if (!fromApp(e)) throw new Error("forbidden");
    // a suggested file name only, never a path
    const safe = String(name ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 120) || APP_NAME_EN;
    const r = await dialog.showSaveDialog({ defaultPath: `${safe}.pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (r.canceled || !r.filePath) return null;
    // the page's own @page size wins (A4 landscape for wide tables, A5 slips); A4 when it sets none
    const pdf = await e.sender.printToPDF({ printBackground: true, pageSize: "A4", preferCSSPageSize: true });
    writeFileSync(r.filePath, pdf);
    return r.filePath;
  });
  // opens a folder (the backups folder) in Explorer; shell.openPath on a file would run it
  ipcMain.handle("itsm:open-path", async (e, p: string) => {
    // local folders only: a network path (\\host\share) would hand the Windows sign-in to that host
    if (!fromApp(e) || typeof p !== "string" || !isAbsolute(p) || /^[\\/]{2}/.test(p)) throw new Error("forbidden");
    let dir = false;
    try {
      dir = statSync(p).isDirectory();
    } catch {
      dir = false;
    }
    if (!dir) throw new Error("فقط پوشه باز می‌شود");
    await shell.openPath(p);
  });
  ipcMain.handle("itsm:set-server", async (e, url: string | null) => {
    if (!fromApp(e)) throw new Error("forbidden");
    let next: string | null = null;
    if (url !== null && url !== undefined && url !== "") {
      let u: URL;
      try {
        u = new URL(String(url));
      } catch {
        throw new Error("نشانی سرور درست نیست");
      }
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("نشانی سرور درست نیست");
      next = u.origin;
    }
    writeClientServer(next);
    app.relaunch();
    await quit();
  });
  ipcMain.handle("itsm:relaunch", async (e) => {
    if (!fromApp(e)) throw new Error("forbidden");
    app.relaunch();
    await quit();
  });
}

/** GET a local URL with Node's http module (retries while the server warms up). */
function httpGet(url: string, attempts = 10): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const once = (left: number) => {
      const req = http.get(url, { timeout: 15000 }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on("error", (e) => (left > 0 ? setTimeout(() => once(left - 1), 1000) : reject(e)));
      req.on("timeout", () => req.destroy(new Error("timeout")));
    };
    once(attempts);
  });
}

async function smokeTest() {
  const out = process.env.ITSM_SMOKE_OUT;
  try {
    const { url } = await startBackend();
    const health = JSON.parse((await httpGet(`${url}/api/health`)).body);
    const page = (await httpGet(url)).body;
    const meta = JSON.parse((await httpGet(`${url}/api/meta`)).body);
    const ok = health.ok === true && page.includes('id="root"') && meta.mode === "desktop";
    if (out) writeFileSync(out, JSON.stringify({ ok, health, ui: page.includes('id="root"'), schema: meta.schema }));
    log(`[smoke] ${JSON.stringify(health)}`);
    quitting = true;
    await stopBackend();
    app.exit(ok ? 0 : 1);
  } catch (e) {
    if (out) writeFileSync(out, JSON.stringify({ ok: false, error: String(e) }));
    log(`[smoke] failed ${String(e)}`);
    app.exit(1);
  }
}

if (!app.requestSingleInstanceLock() && !isSmoke) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  app.setAppUserModelId(APP_ID);
  app.whenReady().then(async () => {
    log(`start ${app.getVersion()} data=${dataDir}`);
    if (isSmoke) return smokeTest();
    nativeTheme.themeSource = themePref(); // dark title bars and menus when the app is dark
    registerIpc();
    setupMenu();
    const client = readConfig().client?.server_url as string | undefined;
    if (client) {
      serverUrl = client.replace(/\/+$/, "");
      createWindow(serverUrl);
      win?.webContents.on("did-fail-load", async () => {
        const r = await dialog.showMessageBox({
          type: "warning",
          title: APP_TITLE,
          message: "اتصال به سرور شبکه برقرار نشد",
          detail: `${serverUrl}\nرایانه‌ی سرور روشن است و «حالت شبکه» در آن فعال است؟`,
          buttons: ["تلاش دوباره", "کار روی همین رایانه", "خروج"],
        });
        if (r.response === 0) win?.loadURL(serverUrl);
        else if (r.response === 1) {
          writeClientServer(null);
          app.relaunch();
          await quit();
        } else await quit();
      });
      return;
    }
    createSplash();
    const boot = bootStatus();
    splashStep(0.06, 0.62, boot.text, boot.tau);
    try {
      const { url } = await startBackend();
      serverUrl = url;
      serverReady = true;
      splashStep(0.7, 0.88, "آماده‌سازی میز کار…", 1.6);
      createWindow(url);
      if (readConfig().lan?.enabled) createTray();
    } catch (e) {
      splash?.destroy();
      await dialog.showMessageBox({ type: "error", title: APP_TITLE, message: "اجرای برنامه ممکن نشد", detail: `${String((e as Error).message ?? e)}\n\nگزارش: ${logFile}` });
      app.exit(1);
    }
  });
  app.on("window-all-closed", () => {
    if (!tray) void quit();
  });
  app.on("before-quit", () => {
    quitting = true;
  });
}
