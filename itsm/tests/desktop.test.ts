// The Windows installation: who can reach the local server, backups and restores, the local
// settings, and the Electron main process (navigation, links and IPC from the page).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir, networkInterfaces } from "node:os";
import { join } from "node:path";
import http from "node:http";
import "./fixtures/module";
import { Client } from "./helpers";
import { startLocal, type LocalServer } from "@local/server";
import { scheduleRestore, pruneBackups, listBackups } from "@local/backup";
import { loadConfig, configPath } from "@local/config";

const quiet = { info() {}, warn() {}, error() {} };
const staticDir = join(__dirname, "..", "public");
const httpClient = (base: string) => new Client({ fetch: (r: Request) => fetch(r) }, base);
const tmp = () => mkdtempSync(join(tmpdir(), "itsm-desk-"));
const OWNER = { email: "owner@example.com", password: "s3cret-pass", full_name: "مالک" };
const ORG = { name: "دفتر فناوری اطلاعات" };

function lanAddress(): string | null {
  for (const list of Object.values(networkInterfaces())) for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) return a.address;
  return null;
}

/** A raw request with a Host header of our choosing (fetch does not let one set it). */
function rawRequest(url: string, method: string, host: string, body?: unknown): Promise<number> {
  return new Promise((ok, fail) => {
    const u = new URL(url);
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method, headers: { host, "content-type": "application/json", ...(data ? { "content-length": Buffer.byteLength(data) } : {}) } }, (res) => {
      res.resume();
      res.on("end", () => ok(res.statusCode ?? 0));
    });
    req.on("error", fail);
    if (data) req.write(data);
    req.end();
  });
}

describe("restoring a backup", () => {
  it("a backup that cannot be loaded leaves the current database in place", async () => {
    const dataDir = tmp();
    try {
      let s = await startLocal({ dataDir, staticDir, port: 0, log: quiet });
      let c = httpClient(s.url);
      await c.post("/auth/signup", OWNER);
      const org = (await c.post("/orgs", ORG)).id;
      await c.post(`/o/${org}/data/test_item`, { name: "قلم ماندگار" });
      await s.close();

      mkdirSync(join(dataDir, "backups"), { recursive: true });
      const broken = join(dataDir, "backups", "itsm-manual-20260101-000000.tar.gz");
      writeFileSync(broken, "not a tarball");
      scheduleRestore(dataDir, broken);

      s = await startLocal({ dataDir, staticDir, port: 0, log: quiet });
      c = httpClient(s.url);
      expect((await c.get("/meta")).first_run).toBe(false);
      await c.post("/auth/login", { email: OWNER.email, password: OWNER.password });
      const items = await c.get(`/o/${org}/data/test_item?q=ماندگار`);
      expect(items.total).toBe(1);
      expect(existsSync(join(dataDir, "restore.pending"))).toBe(false);
      await s.close();
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("restores a listed backup only and takes no changes until the restart applies it", async () => {
    const dataDir = tmp();
    try {
      let s = await startLocal({ dataDir, staticDir, port: 0, log: quiet });
      let c = httpClient(s.url);
      await c.post("/auth/signup", OWNER);
      const org = (await c.post("/orgs", ORG)).id;
      await c.post(`/o/${org}/data/test_item`, { name: "پیش از پشتیبان" });
      const { file } = await c.post<{ file: string }>("/local/backups");
      expect(file).toMatch(/itsm-manual-\d{8}-\d{6}\.tar\.gz$/);
      await c.post(`/o/${org}/data/test_item`, { name: "پس از پشتیبان" });

      // not a backup: any file of the computer (here the configuration) is refused
      await c.post("/local/backups/restore", { file: configPath(dataDir) }, 400);
      expect(existsSync(join(dataDir, "restore.pending"))).toBe(false);

      await c.post("/local/backups/restore", { file });
      // e.g. a colleague on another computer of the office network keeps working: refused, not silently lost
      await c.post(`/o/${org}/data/test_item`, { name: "بعد از دستور بازگردانی" }, 503);
      expect((await c.get(`/o/${org}/data/test_item?q=بازگردانی`)).total).toBe(0);
      await s.close();

      s = await startLocal({ dataDir, staticDir, port: 0, log: quiet });
      c = httpClient(s.url);
      await c.post("/auth/login", { email: OWNER.email, password: OWNER.password });
      const names = (await c.get(`/o/${org}/data/test_item`)).rows.map((r: { name: string }) => r.name);
      expect(names).toContain("پیش از پشتیبان");
      expect(names).not.toContain("پس از پشتیبان");
      // writable again after the restart
      await c.post(`/o/${org}/data/test_item`, { name: "پس از بازگردانی" });
      await s.close();
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  // A standalone app (never linked: where the «کوچک» demo pack is documented to run) restores its own automatic backup.
  // The restore starts a sync cursor again only where one exists: a database that never synced gains no `sync.*` key —
  // what tells an app that synced with a server or the web version apart (demo/index.ts refuseLinkedDesktop).
  it("a standalone app stays standalone after a restore: the demo can still be loaded and purged there", async () => {
    const dataDir = tmp();
    try {
      let s = await startLocal({ dataDir, staticDir, port: 0, log: quiet });
      let c = httpClient(s.url);
      await c.post("/auth/signup", OWNER);
      const org = (await c.post("/orgs", ORG)).id;
      const { file } = await c.post<{ file: string }>("/local/backups");
      await c.post("/local/backups/restore", { file });
      await s.close();

      s = await startLocal({ dataDir, staticDir, port: 0, log: quiet });
      try {
        c = httpClient(s.url);
        await c.post("/auth/login", { email: OWNER.email, password: OWNER.password });
        // nothing to purge — not «linked to a server»
        const none = await c.post(`/o/${org}/demo/purge`, { confirm: "حذف کامل" }, 409);
        expect(none.error.message).toBe("این سازمان دادهٔ نمایشی ندارد");
        expect((await c.post(`/o/${org}/demo/load`, { size: "small" })).state).toBe("loading");
        expect((await c.post(`/o/${org}/demo/purge`, { confirm: "حذف کامل" })).state).toBe("purging");
      } finally {
        await s.close();
      }
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe("backups folder", () => {
  it("a broken «keep» never deletes every automatic copy", () => {
    const dir = tmp();
    try {
      for (let i = 0; i < 3; i++) writeFileSync(join(dir, `itsm-auto-2026010${i + 1}-000000.tar.gz`), "x");
      pruneBackups(dir, Number("abc"));
      expect(listBackups(dir).length).toBe(3);
      pruneBackups(dir, 2);
      expect(listBackups(dir).length).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("local settings", () => {
  let s: LocalServer;
  let c: Client;
  let dataDir = "";
  beforeAll(async () => {
    dataDir = tmp();
    s = await startLocal({ dataDir, staticDir, port: 0, memory: true, log: quiet });
    c = httpClient(s.url);
    await c.post("/auth/signup", OWNER);
    await c.post("/orgs", ORG);
  });
  afterAll(async () => {
    await s?.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("refuses values that would break the next start or delete the backups", async () => {
    await c.patch("/local/settings", { lan: { enabled: true, port: "abc" } }, 400);
    await c.patch("/local/settings", { backups: { keep: "all" } }, 400);
    await c.patch("/local/settings", { backups: { every_hours: 0 } }, 400);
    const saved = loadConfig(dataDir);
    expect(saved.lan.enabled).toBe(false);
    expect(saved.backups.keep).toBe(30);
  });

  it("stores the port typed in the text box as a number", async () => {
    const r = await c.patch("/local/settings", { lan: { enabled: true, port: "4000" } });
    expect(r.lan).toEqual({ enabled: true, port: 4000 });
    expect(loadConfig(dataDir).lan.port).toBe(4000);
    // patching one field keeps the others
    await c.patch("/local/settings", { backups: { keep: 10 } });
    expect(loadConfig(dataDir).backups).toMatchObject({ keep: 10, auto: true, every_hours: 6, dir: null });
    await c.patch("/local/settings", { lan: { enabled: false } });
  });

  it("a hand-edited or older config.json with text numbers still starts on a TCP port", () => {
    const dir = tmp();
    try {
      writeFileSync(configPath(dir), JSON.stringify({ port: "abc", lan: { enabled: true, port: "4000" }, backups: { keep: "x", every_hours: "y" } }));
      const cfg = loadConfig(dir);
      expect(cfg.port).toBe(3939);
      expect(cfg.lan.port).toBe(4000);
      expect(cfg.backups.keep).toBe(30);
      expect(cfg.backups.every_hours).toBe(6);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("first start in network mode", () => {
  const lan = lanAddress();
  let s: LocalServer;
  let dataDir = "";
  beforeAll(async () => {
    dataDir = tmp();
    s = await startLocal({ dataDir, staticDir, port: 0, host: "0.0.0.0", memory: true, log: quiet });
  });
  afterAll(async () => {
    await s?.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("only this computer can set up the installation (not the office network, not a rebound host name)", async () => {
    // a web page that points its own host name at 127.0.0.1 (DNS rebinding)
    expect(await rawRequest(`${s.url}/api/local/settings`, "PATCH", `evil.example:${s.port}`, { lan: { enabled: true } })).toBe(403);
    expect(await rawRequest(`${s.url}/api/auth/signup`, "POST", `evil.example:${s.port}`, OWNER)).toBe(403);
    if (lan) {
      const remote = httpClient(`http://${lan}:${s.port}`);
      await remote.get("/local/settings", 403);
      await remote.post("/local/cloud/orgs", { url: "http://cloud.example", email: "a@example.com", password: "x" }, 403);
      await remote.post("/auth/signup", { ...OWNER, email: "intruder@example.com" }, 403);
      // the public bits still answer (the client app checks the server with them)
      expect((await remote.get("/health")).ok).toBe(true);
    }
    const local = httpClient(s.url);
    await local.post("/auth/signup", OWNER);
    await local.post("/orgs", ORG);
    if (lan) {
      // once the installation has its administrator, the network signs in as usual
      const remote = httpClient(`http://${lan}:${s.port}`);
      await remote.post("/auth/login", { email: OWNER.email, password: OWNER.password });
      expect((await remote.get("/local/settings")).lan).toBeTruthy();
    }
  });
});

// ------------------------------------------------------------------ Electron main process
const h = vi.hoisted(() => ({
  ipc: new Map<string, (e: unknown, ...a: unknown[]) => unknown>(),
  wcHandlers: new Map<string, (...a: unknown[]) => unknown>(),
  openHandler: null as null | ((d: { url: string }) => unknown),
  external: [] as string[],
  opened: [] as string[],
  relaunched: 0,
  paths: new Map<string, string>(),
  splashQuery: null as null | Record<string, string>,
}));

vi.mock("electron", () => {
  const webContents = {
    once() {},
    on(ev: string, fn: (...a: unknown[]) => unknown) {
      h.wcHandlers.set(ev, fn);
    },
    setWindowOpenHandler(fn: (d: { url: string }) => unknown) {
      h.openHandler = fn;
    },
    executeJavaScript: async () => true,
    reload() {},
  };
  class BrowserWindow {
    webContents = webContents;
    static fromWebContents() {
      return null;
    }
    loadURL() {}
    loadFile() {}
    once() {}
    on() {}
    show() {}
    hide() {}
    maximize() {}
    setMenu() {}
    isDestroyed() {
      return false;
    }
    destroy() {}
  }
  const app = {
    getPath: (name: string) => (name === "appData" ? join(tmpdir(), "AppData", "Roaming") : tmpdir()),
    setPath: (name: string, p: string) => {
      h.paths.set(name, p);
    },
    getVersion: () => "1.0.0",
    requestSingleInstanceLock: () => true,
    setAppUserModelId() {},
    on() {},
    whenReady: () => Promise.resolve(),
    relaunch() {
      h.relaunched++;
    },
    exit() {},
    quit() {},
  };
  const electron = {
    app,
    BrowserWindow,
    utilityProcess: { fork() {} },
    ipcMain: {
      handle(ch: string, fn: (e: unknown, ...a: unknown[]) => unknown) {
        h.ipc.set(ch, fn);
      },
      on() {},
    },
    shell: {
      openExternal: async (u: string) => {
        h.external.push(u);
      },
      openPath: async (p: string) => {
        h.opened.push(p);
        return "";
      },
    },
    dialog: { showMessageBox: async () => ({ response: 2 }), showSaveDialog: async () => ({ canceled: true }) },
    Menu: { buildFromTemplate: () => ({}), setApplicationMenu() {} },
    Tray: class {},
    nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
    nativeTheme: { shouldUseDarkColors: false, themeSource: "system" },
  };
  return { ...electron, default: electron };
});

describe("Windows app window and bridge", () => {
  const SERVER = "http://127.0.0.1:3939";
  let dataDir = "";
  const fromApp = { senderFrame: { url: `${SERVER}/settings/desktop` }, sender: {} };
  const fromElsewhere = { senderFrame: { url: "http://192.0.2.50:8080/" }, sender: {} };

  beforeAll(async () => {
    dataDir = tmp();
    // client mode: the window shows the server of another computer straight away (no local backend)
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ client: { server_url: SERVER } }));
    process.env.ITSM_DATA_DIR = dataDir;
    const main = "../desktop/src/main.ts";
    await import(/* @vite-ignore */ main);
    for (let i = 0; i < 50 && !h.ipc.size; i++) await new Promise((r) => setTimeout(r, 20));
  });
  afterAll(() => {
    delete process.env.ITSM_DATA_DIR;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("keeps the window on the app's own server", () => {
    const nav = h.wcHandlers.get("will-navigate")!;
    expect(nav).toBeTruthy();
    const go = (url: string) => {
      let prevented = false;
      nav({ preventDefault: () => (prevented = true) }, url);
      return prevented;
    };
    expect(go(`${SERVER}/settings/users`)).toBe(false);
    expect(go("http://127.0.0.1:3939@evil.example/")).toBe(true);
    expect(go("http://127.0.0.1:39390/")).toBe(true);
    expect(go("data:text/html,<script>itsm.openPath('C:/x')</script>")).toBe(true);
  });

  it("hands only web links to the system", () => {
    h.external.length = 0;
    h.openHandler!({ url: "https://www.example.com/help" });
    h.openHandler!({ url: "file:///C:/Windows/System32/calc.exe" });
    h.openHandler!({ url: "ms-msdt:/id PCWDiagnostic" });
    h.openHandler!({ url: "http://127.0.0.1:3939@evil.example/" });
    expect(h.external).toEqual(["https://www.example.com/help", "http://127.0.0.1:3939@evil.example/"]);
  });

  it("opens folders only, and only for the app's own page", async () => {
    const open = h.ipc.get("itsm:open-path")!;
    h.opened.length = 0;
    const exe = join(dataDir, "run.exe");
    writeFileSync(exe, "MZ");
    await expect(Promise.resolve().then(() => open(fromApp, exe))).rejects.toThrow();
    await expect(Promise.resolve().then(() => open(fromApp, "\\\\attacker\\share"))).rejects.toThrow();
    await expect(Promise.resolve().then(() => open(fromElsewhere, dataDir))).rejects.toThrow();
    expect(h.opened).toEqual([]);
    await open(fromApp, dataDir);
    expect(h.opened).toEqual([dataDir]);
  });

  it("accepts only a web address as the network server", async () => {
    const set = h.ipc.get("itsm:set-server")!;
    const before = readdirSync(dataDir).length;
    await expect(Promise.resolve().then(() => set(fromApp, "file:///C:/Users/Public/evil.html"))).rejects.toThrow();
    await expect(Promise.resolve().then(() => set(fromElsewhere, "http://192.0.2.50:8080"))).rejects.toThrow();
    expect(h.relaunched).toBe(0);
    expect(readdirSync(dataDir).length).toBe(before);
  });
});

describe("Windows app identity", () => {
  it("keeps Electron's profile and the data under %APPDATA%\\ITSM, set explicitly", () => {
    // main.ts ran above (client mode, ITSM_DATA_DIR set): the profile path was still pinned to ITSM
    expect(h.paths.get("userData")).toBe(join(tmpdir(), "AppData", "Roaming", "ITSM"));
  });

  it("names the installer, the executable and the shortcut after APP_NAME_EN, with the app's own identifiers", async () => {
    const { APP_NAME_EN, APP_VERSION } = await import("@shared/constants");
    const yml = readFileSync(join(__dirname, "..", "desktop", "electron-builder.yml"), "utf8");
    const field = (k: string) => yml.match(new RegExp(`^\\s*${k}:\\s*"?([^"\\n]+)"?\\s*$`, "m"))?.[1];
    expect(field("appId")).toBe("app.itsm.desktop");
    expect(field("productName")).toBe(APP_NAME_EN);
    expect(field("executableName")).toBe(APP_NAME_EN);
    expect(field("shortcutName")).toBe(APP_NAME_EN);
    expect(field("artifactName")).toBe(`${APP_NAME_EN}-Setup-\${version}.exe`);
    const main = readFileSync(join(__dirname, "..", "desktop", "src", "main.ts"), "utf8");
    expect(main).toContain(`const APP_ID = "app.itsm.desktop"`);
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "desktop", "package.json"), "utf8"));
    expect(pkg.version).toBe(APP_VERSION);
    // the bridge is exposed under one name only, and every IPC channel is itsm:*
    const preload = readFileSync(join(__dirname, "..", "desktop", "src", "preload.ts"), "utf8");
    expect([...preload.matchAll(/exposeInMainWorld\("([^"]+)"/g)].map((m) => m[1])).toEqual(["itsm"]);
    const channels = [...`${preload}\n${main}`.matchAll(/(?:invoke|send|handle|on)\("([a-z-]+:[a-z-]+)"/g)].map((m) => m[1]);
    expect(channels.length).toBeGreaterThan(6);
    for (const ch of channels) expect(ch).toMatch(/^itsm:/);
  });
});
