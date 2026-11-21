// A Windows app follows its link at once (design F §7.1, docs/DESKTOP_FA.md «همگام‌سازی»): the app's server registers a
// reader of its link (src/server/sync/link-state.ts), read in memory on every call. Right after linking, a start or a
// submission is recorded and pushed for the authority — never applied on the app — and right after unlinking the app
// runs its own cases again; older builds asked the bridge's info() (a database read) and remembered the answer for a
// minute, so a start right after linking created a case, tasks and a run here that the authority never accepts.
import { describe, it, expect, beforeAll } from "vitest";
import { makeServer, quietLog } from "./helpers";
import { SyncClient } from "@local/sync-client";
import { defaultConfig } from "@local/config";
import { makeCtx, type AuthUser, type DesktopBridge, type MemberRow, type OrgRow, type ServerConfig } from "@server/context";
import { registerCloudLink } from "@server/sync/link-state";
import { processesRunHere, startCase } from "@server/modules/process/engine";
import { schedulesRunHere } from "@server/modules/flows/scheduler";
import { uuidv7 } from "@shared/id";
import { edge, node, publish, world, type Published, type World } from "./process-engine-helpers";

const PASS = "link-state-pass-1405";

describe("a Windows app follows its link at once", () => {
  let w: World;
  let proc: Published;
  let email = "";

  beforeAll(async () => {
    w = await world();
    email = `link-${uuidv7().slice(-6)}@bank.test`;
    let user = (await w.o.owner.post(`${w.P}/members`, { email, password: PASS, full_name: "کارمند شعبه", role: "member" })).user_id ?? "";
    if (!user) user = (await w.o.db.one<{ id: string }>(`select id from sm_users where email = $1`, [email]))!.id;
    await w.o.owner.put(`${w.P}/access/members/${user}`, { roles: ["requester"] });
    proc = await publish(
      w,
      {
        nodes: [
          node("t", "trigger"),
          node("s", "form_step", { action: "fill", start: true, form: w.forms.req, rights: { default: "edit", fields: {} } }, "ثبت درخواست"),
          node("ok", "end", { outcome: "completed" }),
        ],
        edges: [edge("t", "s"), edge("s", "ok")],
      },
      { name: "درخواست سادهٔ شعبه" },
    );
  }, 600_000);

  it("right after linking a start is recorded for the server; right after unlinking the app runs its cases again", async () => {
    const config = defaultConfig();
    let client: SyncClient | null = null;
    // the bridge answers from the link like the real one (whose info() reads the database: older builds cached it)
    const bridge = { notifyLocalWrite() {}, fetchBlob: async () => null, info: async () => ({ cloud: { linked: !!client?.state.linked, org_id: config.cloud.org_id } }) } as unknown as DesktopBridge;
    const desk = await makeServer({ mode: "desktop", config: { desktop: bridge, secret: "desktop-secret" } });
    // as the Windows app's server does (src/desktop/server.ts)
    registerCloudLink(desk.db, () => config.cloud);
    const cloudFetch = (async (u: RequestInfo | URL, init?: RequestInit) => w.o.app.fetch(new Request(String(u), init))) as typeof fetch;
    const cfg: ServerConfig = { mode: "desktop", db: desk.db, secret: "desktop-secret", allowSignup: false, platformAdmins: [], origin: "desk", log: quietLog, fetch: cloudFetch, desktop: bridge };
    const ctx = async () => {
      const user = (await desk.db.one<AuthUser>(`select id, email, full_name, mobile, is_platform_admin, disabled, prefs from sm_users where email = $1`, [email]))!;
      const org = (await desk.db.one<OrgRow>(`select * from sm_orgs where id = $1`, [w.o.org]))!;
      const member = (await desk.db.one<MemberRow>(`select id, org_id, user_id, role, overrides, is_active from sm_org_members where org_id = $1 and user_id = $2`, [w.o.org, user.id]))!;
      return makeCtx(cfg, user, org, member);
    };

    // not linked yet: the app would run the organisation's cases and schedules itself
    expect(await processesRunHere(cfg, w.o.org)).toBe(true);
    expect(await schedulesRunHere(cfg, w.o.org)).toBe(true);

    client = new SyncClient({ db: desk.db, config, save() {}, log: quietLog, fetch: cloudFetch });
    await client.link({ url: "http://cloud.test", email, password: PASS, orgId: w.o.org, direction: "download" });
    // linked: at once, not a minute later
    expect(await processesRunHere(cfg, w.o.org)).toBe(false);
    expect(await schedulesRunHere(cfg, w.o.org)).toBe(false);
    const caseId = uuidv7();
    const r = await startCase(await ctx(), { process: proc.process, case_id: caseId, values: { u_amount: "750000000", u_need: "خرید چاپگر" } });
    expect(r).toMatchObject({ result: "pending", case: caseId });
    expect(await desk.db.one(`select 1 as x from sm_process_cases where id = $1`, [caseId])).toBeNull();
    expect(await desk.db.one(`select count(*)::int as n from sm_flow_runs`)).toEqual({ n: 0 });
    // pushed, the authority creates the case once
    await client.syncNow();
    await w.k.drain();
    expect(await w.o.db.one(`select state from sm_process_cases where id = $1`, [caseId])).toBeTruthy();

    // unlinked: at once the app's own organisations' cases run here again
    await client.unlink();
    expect(await processesRunHere(cfg, w.o.org)).toBe(true);
    expect(await schedulesRunHere(cfg, w.o.org)).toBe(true);
  }, 300_000);
});
