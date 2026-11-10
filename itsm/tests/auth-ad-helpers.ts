// A bank's Active Directory for sign-in tests: the fake domain controller of tests/ldap-fake.ts (LDAPS with an internal
// root CA), an installation (cloud flavour, domain controllers on its LAN allowed) with one organisation on the
// enterprise plan, a directory source with sign-in on and approved, and a client that can set request headers and the
// TCP peer address (as the Node server's socket would report it).
import { makeServer, signupWithOrg, Client } from "./helpers";
import { BASE, SVC, fakeLdap, group, person, serviceAccount, testPki, filetime, type FakeEntry, type FakeLdap } from "./ldap-fake";
import type { ServerConfig } from "@server/context";

export const GROUPS = `OU=Groups,${BASE}`;
export const AGENTS = `CN=Kariz-Agents,${GROUPS}`;
export const AGENTS_NET = `CN=Kariz-Agents-Network,${GROUPS}`;
export const ADMINS = `CN=Kariz-Admins,${GROUPS}`;

/** The people of the bank's directory. */
export function bankDirectory(): FakeEntry[] {
  const ali = person("ali", { name: "Ali Rezaei", extra: { title: ["کارشناس شبکه"], department: ["فناوری اطلاعات"], telephoneNumber: ["021-5555"] } });
  const sara = person("sara", { name: "Sara Ahmadi", extra: { department: ["مالی"], manager: [ali.dn] } });
  const reza = person("reza", { name: "Reza Karimi" });
  return [
    serviceAccount(),
    ali,
    sara,
    reza,
    person("disabled", { uac: 514, bindCode: "533" }),
    person("locked", { alwaysCode: "775", extra: { "msDS-User-Account-Control-Computed": ["16"], lockoutTime: [filetime(Date.now() - 60_000)] } }),
    person("expired", { bindCode: "701", extra: { accountExpires: [filetime(Date.now() - 86400_000)] } }),
    person("oldpass", { bindCode: "532", extra: { "msDS-UserPasswordExpiryTimeComputed": [filetime(Date.now() - 3600_000)] } }),
    person("newbie", { bindCode: "773", extra: { pwdLastSet: ["0"] } }),
    person("nomail", { mail: null, upn: "nomail" }),
    group("Kariz-Agents-Network", [ali.dn]),
    group("Kariz-Agents", [AGENTS_NET]),
    group("Kariz-Admins", [reza.dn]),
  ];
}

/** A client whose requests carry chosen headers and, optionally, a TCP peer address. */
export class AdClient {
  cookie = "";
  headers: Record<string, string> = {};
  peer: string | null = null;
  lastHeaders: Headers | null = null;
  constructor(private app: { fetch: (r: Request, env?: unknown) => Response | Promise<Response> }, ip?: string) {
    if (ip) this.headers["x-forwarded-for"] = ip;
  }
  async raw(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<{ status: number; json: any; headers: Headers }> {
    const headers: Record<string, string> = { "content-type": "application/json", ...this.headers, ...extra };
    if (this.cookie) headers.cookie = this.cookie;
    const env = this.peer ? { incoming: { socket: { remoteAddress: this.peer } } } : undefined;
    const res = await this.app.fetch(new Request(`http://local.test/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    this.lastHeaders = res.headers;
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers };
  }
  async req<T = any>(method: string, path: string, body?: unknown, expect = 200): Promise<T> {
    const r = await this.raw(method, path, body);
    if (r.status !== expect) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(r.json)}`);
    return r.json as T;
  }
  get = <T = any>(p: string, expect?: number) => this.req<T>("GET", p, undefined, expect);
  post = <T = any>(p: string, b?: unknown, expect?: number) => this.req<T>("POST", p, b ?? {}, expect);
  put = <T = any>(p: string, b?: unknown, expect?: number) => this.req<T>("PUT", p, b ?? {}, expect);
  patch = <T = any>(p: string, b?: unknown, expect?: number) => this.req<T>("PATCH", p, b ?? {}, expect);
  del = <T = any>(p: string, expect?: number) => this.req<T>("DELETE", p, undefined, expect);
}

let ipSeq = 10;
/** A fresh client address per test (the per-address limits never mix tests). */
export const nextIp = () => `198.51.100.${(ipSeq++ % 250) + 1}`;

export interface AdWorld {
  pki: ReturnType<typeof testPki>;
  dc: FakeLdap;
  app: Awaited<ReturnType<typeof makeServer>>["app"];
  db: Awaited<ReturnType<typeof makeServer>>["db"];
  owner: Client;
  ownerId: string;
  org: string;
  P: string;
  team: string;
  source: Record<string, any>;
  client(ip?: string): AdClient;
  signIn(login: string, password: string, expect?: number, extra?: { source?: string }): Promise<{ c: AdClient; r: any }>;
  close(): Promise<void>;
}

/** The world: a domain controller, an installation, an organisation with an approved sign-in source. */
export async function adWorld(opts: { tls?: "ldaps" | "starttls" | "none"; source?: Record<string, unknown>; config?: Partial<ServerConfig>; entries?: FakeEntry[]; approve?: boolean } = {}): Promise<AdWorld> {
  const tls = opts.tls ?? "ldaps";
  const pki = testPki();
  const dc = await fakeLdap(opts.entries ?? bankDirectory(), { mode: tls === "ldaps" ? "ldaps" : "plain", cert: pki.server, requireTls: tls === "starttls" });
  const { app, db } = await makeServer({ mode: "cloud", config: { auth: { directoryLan: true }, ...opts.config } });
  const owner = new Client(app);
  const org = await signupWithOrg(owner, { email: "owner@bank.test" });
  const ownerId = (await owner.get("/auth/me")).user.id;
  await db.query(`insert into sm_org_admin (org_id, limits) values ($1, '{"plan":"enterprise"}'::jsonb) on conflict (org_id) do update set limits = excluded.limits`, [org]);
  const P = `/o/${org}`;
  const team = (await owner.post(`${P}/r/group`, { name: "شبکه", types: ["assignment"] })).row.id as string;
  const source = (
    await owner.post(`${P}/r/directory_source`, {
      name: "اکتیو دایرکتوری بانک",
      kind: "ldap",
      mode: "apply",
      ldap_url: dc.url,
      tls_mode: tls,
      ca_cert: pki.ca.pem,
      bind_dn: SVC.dn,
      bind_password: SVC.password,
      base_dn: BASE,
      login_enabled: true,
      login_domains: ["CORP", "corp.test"],
      default_role: "requester",
      auto_roles: true,
      unit_from: "department",
      timeout_seconds: 5,
      group_map: [{ source: AGENTS, role: "agent", group_id: team }],
      ...opts.source,
    })
  ).row;
  if (opts.approve !== false) await owner.post(`${P}/integration/directory/${source.id}/approve`);
  const client = (ip?: string) => new AdClient(app, ip ?? nextIp());
  return {
    pki,
    dc,
    app,
    db,
    owner,
    ownerId,
    org,
    P,
    team,
    source,
    client,
    async signIn(login, password, expect = 200, extra = {}) {
      const c = client();
      const r = await c.post("/auth/directory", { login, password, ...(extra.source ? { source: extra.source } : {}) }, expect);
      return { c, r };
    },
    close: () => dc.close(),
  };
}
