// What a Windows app is linked to (the owner's click-through of 1.1.5: the server edition called itself «نسخهٔ وب», and a
// Windows app linked to it said «آخرین هم‌گامی» with the web version's words). The app learns it from the server's public
// /api/meta — an organisation's server edition answers `edition: "server"` there — when it links, and a link made
// before the app asked learns it once at its next sync; unlinking forgets it. The footer, «نسخهٔ ویندوز», «درباره» and
// «اتصال‌ها و API» read it from `desktop.cloud.edition` (src/ui/lib/edition.ts; the names: tests/shell-edition-ui.test.ts).
import { describe, it, expect } from "vitest";
import { SyncClient } from "../src/desktop/sync-client";
import { defaultConfig } from "../src/desktop/config";
import type { ServerEditionBridge } from "@server/context";
import { makeServer, Client, quietLog } from "./helpers";

const PASSWORD = "edition-pass-1";
let seq = 0;

/** The server edition's bridge as far as /api/meta reads it (the runtime itself lives in src/server-edition). */
const serverEdition: ServerEditionBridge = {
  health: async () => ({}),
  info: () => ({ air_gapped: true, public_url: "https://kariz.bank.local", directory_path: "" }),
  allow: async () => ({ allow: [] }),
};

async function pair(edition: "web" | "server") {
  const cloud = await makeServer({ mode: "cloud", config: edition === "server" ? { server: serverEdition } : {} });
  const desk = await makeServer({ mode: "desktop" });
  const ip = `10.29.${++seq}.1`;
  const asked: string[] = [];
  const cloudFetch = (async (u: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(String(u), init);
    req.headers.set("x-forwarded-for", ip);
    if (new URL(req.url).pathname === "/api/meta") asked.push(req.url);
    return cloud.app.fetch(req);
  }) as typeof fetch;
  const web = new Client({ fetch: (r: Request) => { r.headers.set("x-forwarded-for", ip); return cloud.app.fetch(r); } }, "http://cloud.test");
  const email = `edition-${seq}@example.com`;
  await web.post("/auth/signup", { email, password: PASSWORD, full_name: "مالک" });
  const org = (await web.post<{ id: string }>("/orgs", { name: "سازمان هم‌گام" })).id;
  const config = defaultConfig();
  let saved = 0;
  const client = new SyncClient({ db: desk.db, config, save: () => void saved++, log: quietLog, fetch: cloudFetch });
  return { client, config, org, email, asked, saved: () => saved };
}

describe("a Windows app knows what its link reaches", () => {
  it("linked to an organisation's server edition: «server», kept with the link and forgotten when it is cut", async () => {
    const p = await pair("server");
    // the app's own idea before any link: nothing
    expect(p.config.cloud.edition).toBeUndefined();
    await p.client.link({ url: "http://cloud.test/", email: p.email, password: PASSWORD, orgId: p.org, direction: "download" });
    expect(p.client.state.linked).toBe(true);
    expect(p.config.cloud.edition).toBe("server");
    expect(p.asked.length).toBe(1);
    // the sync that follows asks no more
    await p.client.syncNow();
    expect(p.client.state.last_error).toBeNull();
    expect(p.asked.length).toBe(1);
    await p.client.unlink();
    expect(p.config.cloud.edition).toBeNull();
  }, 120_000);

  it("linked to the web version: «web»", async () => {
    const p = await pair("web");
    await p.client.link({ url: "http://cloud.test", email: p.email, password: PASSWORD, orgId: p.org, direction: "download" });
    expect(p.config.cloud.edition).toBe("web");
  }, 120_000);

  it("a link made before the app asked learns it once, at its next sync, and writes it down", async () => {
    const p = await pair("server");
    await p.client.link({ url: "http://cloud.test", email: p.email, password: PASSWORD, orgId: p.org, direction: "download" });
    // as an older app left its config: the link without the edition
    delete p.config.cloud.edition;
    const asked = p.asked.length;
    const saved = p.saved();
    await p.client.syncNow();
    expect(p.client.state.last_error).toBeNull();
    expect(p.config.cloud.edition).toBe("server");
    expect(p.asked.length).toBe(asked + 1);
    expect(p.saved()).toBe(saved + 1);
    // once per run of the app, whatever the answer
    await p.client.syncNow();
    expect(p.asked.length).toBe(asked + 1);
  }, 120_000);
});
