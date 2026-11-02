// Electron main process of «سیراف» for Windows.
// Starts the local server (embedded PostgreSQL + API + UI) in a utility process and shows it in
// a window. In "client" mode it opens the server of another computer of the office network.
import { app, BrowserWindow, utilityProcess, ipcMain, shell, dialog, Menu, Tray, nativeImage, type UtilityProcess } from "electron";
import { join } from "node:path";
import http from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync, renameSync } from "node:fs";

const APP_TITLE = "سیراف";
const isSmoke = process.argv.includes("--smoke-test") || process.env.TARAZ_SMOKE === "1";

const dataDir = resolveDataDir();

/** %APPDATA%/Siraf/data; a preview installed under the old name «تراز» keeps its data (moved once). */
function resolveDataDir(): string {
  if (process.env.TARAZ_DATA_DIR) return process.env.TARAZ_DATA_DIR;
  const appData = app.getPath("appData");
  const next = join(appData, "Siraf", "data");
  const old = join(appData, "Taraz", "data");
  if (!existsSync(next) && existsSync(old)) {
    try {
      mkdirSync(join(appData, "Siraf"), { recursive: true });
      renameSync(old, next);
    } catch {
      return old;
    }
  }
  return next;
}
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

let backend: UtilityProcess | null = null;
let win: BrowserWindow | null = null;
let splash: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let serverUrl = "";

const iconPath = join(__dirname, "icon.png");

function startBackend(): Promise<{ url: string; host: string }> {
  return new Promise((resolve, reject) => {
    const entry = join(__dirname, "backend.cjs");
    backend = utilityProcess.fork(entry, [], {
      serviceName: "Siraf Server",
      stdio: "pipe",
      env: {
        ...process.env,
        TARAZ_DATA_DIR: dataDir,
        TARAZ_STATIC_DIR: join(__dirname, "renderer"),
        NODE_ENV: "production",
      },
    });
    const timer = setTimeout(() => reject(new Error("سرور محلی در زمان مقرر آماده نشد")), 90_000);
    backend.stdout?.on("data", (d) => log(`[server] ${String(d).trimEnd()}`));
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

function createSplash() {
  splash = new BrowserWindow({ width: 420, height: 260, frame: false, resizable: false, show: false, center: true, backgroundColor: "#381634", icon: iconPath, skipTaskbar: false });
  const html = `<!doctype html><html dir="rtl" lang="fa"><meta charset="utf-8"><style>
    @font-face{font-family:V;src:url("file://${join(__dirname, "renderer", "fonts", "vazirmatn-var.woff2").replace(/\\/g, "/")}")}
    body{margin:0;height:100vh;display:grid;place-content:center;gap:14px;text-align:center;background:radial-gradient(500px 300px at 20% 0%,#8f4a8355,transparent),linear-gradient(160deg,#50224B,#240D21);color:#fff;font-family:V,Tahoma,sans-serif}
    .t{font-size:44px;font-weight:800}.s{font-size:13px;color:#a9b8c9}.b{width:180px;height:3px;background:#ffffff22;border-radius:3px;overflow:hidden;margin:auto}
    .b i{display:block;height:100%;width:40%;background:linear-gradient(90deg,#E7BADF,#D9B36A);animation:m 1.1s ease-in-out infinite}@keyframes m{0%{transform:translateX(180%)}100%{transform:translateX(-260%)}}
  </style><body><div class="t">سیراف</div><div class="s">در حال آماده‌سازی پایگاه داده…</div><div class="b"><i></i></div></body></html>`;
  splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  splash.once("ready-to-show", () => splash?.show());
}

function createWindow(url: string) {
  win = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: APP_TITLE,
    icon: iconPath,
    backgroundColor: "#f4f6f9",
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
  win.once("ready-to-show", () => {
    splash?.destroy();
    splash = null;
    win?.maximize();
    win?.show();
  });
  // links to other sites open in the default browser
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (!target.startsWith(serverUrl)) shell.openExternal(target);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, target) => {
    if (!target.startsWith(serverUrl) && !target.startsWith("data:")) {
      e.preventDefault();
      shell.openExternal(target);
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
  const img = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip("سیراف — سرور شبکه فعال است");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "باز کردن سیراف", click: () => (win ? win.show() : createWindow(serverUrl)) },
      { type: "separator" },
      { label: "خروج کامل", click: () => quit() },
    ]),
  );
  tray.on("double-click", () => (win ? win.show() : createWindow(serverUrl)));
}

async function quit() {
  quitting = true;
  try {
    if (backend) {
      backend.postMessage({ type: "shutdown" });
      await new Promise((r) => setTimeout(r, 1500));
      backend?.kill();
    }
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
  ipcMain.handle("taraz:print", async (e, opts: { silent?: boolean; printer?: string; landscape?: boolean; pageSize?: string } = {}) => {
    const wc = e.sender;
    return new Promise<void>((resolve, reject) =>
      wc.print({ silent: !!opts.silent, deviceName: opts.printer, landscape: !!opts.landscape, pageSize: (opts.pageSize as any) || "A4", printBackground: true }, (ok, reason) =>
        ok || reason === "cancelled" ? resolve() : reject(new Error(reason)),
      ),
    );
  });
  ipcMain.handle("taraz:printers", async (e) => (await e.sender.getPrintersAsync()).map((p) => ({ name: p.name, isDefault: (p as any).isDefault ?? false })));
  ipcMain.handle("taraz:save-pdf", async (e, name: string) => {
    const r = await dialog.showSaveDialog({ defaultPath: `${name || "siraf"}.pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (r.canceled || !r.filePath) return null;
    const pdf = await e.sender.printToPDF({ printBackground: true, pageSize: "A4" });
    writeFileSync(r.filePath, pdf);
    return r.filePath;
  });
  ipcMain.handle("taraz:open-path", async (_e, p: string) => {
    await shell.openPath(p);
  });
  ipcMain.handle("taraz:set-server", async (_e, url: string | null) => {
    writeClientServer(url);
    app.relaunch();
    await quit();
  });
  ipcMain.handle("taraz:relaunch", async () => {
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
  const out = process.env.TARAZ_SMOKE_OUT;
  try {
    const { url } = await startBackend();
    const health = JSON.parse((await httpGet(`${url}/api/health`)).body);
    const page = (await httpGet(url)).body;
    const meta = JSON.parse((await httpGet(`${url}/api/meta`)).body);
    const ok = health.ok === true && page.includes('id="root"') && meta.mode === "desktop";
    if (out) writeFileSync(out, JSON.stringify({ ok, health, ui: page.includes('id="root"'), schema: meta.schema }));
    log(`[smoke] ${JSON.stringify(health)}`);
    quitting = true;
    backend?.postMessage({ type: "shutdown" });
    await new Promise((r) => setTimeout(r, 1500));
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
  app.setAppUserModelId("ir.siraf.app");
  app.whenReady().then(async () => {
    log(`start ${app.getVersion()} data=${dataDir}`);
    if (isSmoke) return smokeTest();
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
    try {
      const { url } = await startBackend();
      serverUrl = url;
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
