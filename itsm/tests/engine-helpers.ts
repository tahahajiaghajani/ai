// Helpers of the record engine's tests: an organisation on an in-memory server, members with a role, multipart
// uploads, the outbox (sm_jobs) and a direct engine context.
import { makeServer, Client, signupWithOrg, quietLog } from "./helpers";
import type { Db } from "@server/db";
import type { Ctx, ServerConfig } from "@server/context";
import { makeCtx, type MemberRow, type OrgRow, type AuthUser } from "@server/context";

export interface EngineOrg {
  app: { fetch: (r: Request) => Response | Promise<Response> };
  db: Db;
  owner: Client;
  org: string;
  ownerId: string;
  cfg: ServerConfig;
  /** a member with a role, signed in */
  member(role: "member" | "viewer" | "admin", email?: string): Promise<{ client: Client; userId: string }>;
  /** the engine context of a member (for direct service calls) */
  ctxOf(userId: string): Promise<Ctx>;
}

let seq = 0;

export async function engineOrg(opts: { mode?: "cloud" | "desktop"; timezone?: string } = {}): Promise<EngineOrg> {
  const { app, db } = await makeServer({ mode: opts.mode });
  const owner = new Client(app);
  const org = await signupWithOrg(owner, { timezone: opts.timezone ?? "Asia/Tehran" });
  const me = await owner.get("/auth/me");
  const cfg: ServerConfig = {
    mode: opts.mode ?? "cloud",
    db,
    secret: "test-secret",
    allowSignup: true,
    platformAdmins: [],
    origin: "cloud",
    log: quietLog,
    fetch: globalThis.fetch.bind(globalThis),
  };
  return {
    app,
    db,
    owner,
    org,
    ownerId: me.user.id,
    cfg,
    async member(role, email) {
      const mail = email ?? `m${++seq}-${role}@example.com`;
      const added = await owner.post(`/o/${org}/members`, { email: mail, full_name: `همکار ${seq}`, role });
      const client = new Client(app);
      await client.post("/auth/login", { email: mail, password: added.temp_password });
      const who = await client.get("/auth/me");
      return { client, userId: who.user.id };
    },
    async ctxOf(userId) {
      const user = (await db.one<AuthUser>(`select id, email, full_name, mobile, is_platform_admin, disabled, prefs from sm_users where id = $1`, [userId]))!;
      const orgRow = (await db.one<OrgRow>(`select * from sm_orgs where id = $1`, [org]))!;
      const member = (await db.one<MemberRow>(`select id, org_id, user_id, role, overrides, is_active from sm_org_members where org_id = $1 and user_id = $2`, [org, userId]))!;
      return makeCtx(cfg, user, orgRow, member);
    },
  };
}

/** POST a file as multipart/form-data with the client's session. */
export async function upload(app: EngineOrg["app"], client: Client, path: string, name: string, data: Uint8Array, type = "application/octet-stream"): Promise<Response> {
  const form = new FormData();
  form.append("file", new File([Buffer.from(data)], name, { type }));
  const headers: Record<string, string> = {};
  if (client.cookie) headers.cookie = client.cookie;
  return app.fetch(new Request(`http://local.test/api${path}`, { method: "POST", headers, body: form }));
}

/** A GET returning the raw response (binary downloads). */
export async function raw(app: EngineOrg["app"], client: Client, path: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (client.cookie) headers.cookie = client.cookie;
  return app.fetch(new Request(`http://local.test/api${path}`, { headers }));
}

/** Jobs of the outbox, oldest first. */
export async function outbox(db: Db, org: string, kind?: string): Promise<{ kind: string; payload: Record<string, any>; status: string }[]> {
  return db.query(`select kind, payload, status from sm_jobs where org_id = $1 ${kind ? "and kind = $2" : ""} order by created_at, id`, kind ? [org, kind] : [org]);
}

/** Bytes of a 1×1 PNG. */
export const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==", "base64"));
