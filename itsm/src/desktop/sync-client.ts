// The desktop side of synchronisation with the cloud (the web app on Vercel + Supabase).
// Local changes are queued by triggers in sm_outbox; every few seconds (and right after a local
// change) the client pushes them and then pulls everything new from the cloud.
// Record engine rows: secrets never leave this computer; contents of attachments added here are uploaded after
// the push; tombstones of the pull delete rows (and a record's journal, history, attachments and links) that the
// linked account may no longer read; a `reset` (the account's scope epoch moved) reads everything again.
import { pgArray, type Db } from "@server/db";
import type { Logger } from "@server/context";
import { AGGREGATES, BY_ENTITY, type WireAggregate } from "@server/sync/registry";
import { readAggregates, writeAggregate } from "@server/sync/apply";
import { ident } from "@server/db/sql";
import { SCHEMA_VERSION } from "@server/db/migrations";
import { SYNC_PROTOCOL, APP_VERSION, APP_NAME } from "@shared/constants";
import type { LocalConfig } from "./config";
import { hostname } from "node:os";
import { bumpLocal } from "@server/live";
import { tableDef } from "@shared/tables";
import { localOnlyFields, stripSecrets } from "@server/engine/sync";

export interface SyncState {
  linked: boolean;
  running: boolean;
  online: boolean | null;
  last_sync_at: string | null;
  last_error: string | null;
  pending: number;
  failed: { entity: string; id: string; error: string | null }[];
  conflicts: number;
  pushed: number;
  pulled: number;
}

/**
 * Outbox entries of rows that belong to another organisation on this computer (one that is not the
 * linked one): they are kept for a later link but never pushed into the linked organisation. Built on use,
 * so aggregates registered after this module loaded are covered too.
 */
const foreign = () => `coalesce(case o.entity ${AGGREGATES.map(
  (d) => `when '${d.entity}' then exists (select 1 from ${ident(d.table)} t where t.id = o.id and t.${d.table === "sm_orgs" ? "id" : "org_id"} <> $1)`,
).join(" ")} else false end, false)`;

/** One page of GET /sync/pull (protocol 15). */
interface PullPage {
  aggregates: WireAggregate[];
  tombstones?: { entity: string; id: string }[];
  users: Record<string, unknown>[];
  /** the cursor to keep: the session's snapshot once it is complete */
  cursor?: string;
  /** the session's snapshot and the position within it */
  snap?: string | null;
  after?: string | null;
  /** the session reads everything there is (no cursor): drop what it did not bring */
  full?: boolean;
  has_more: boolean;
  reset?: boolean;
  epoch?: string;
}

/** Start the next pull from nothing (a new link, a protocol update, a restored local database). */
export async function resetSyncCursor(q: Pick<Db, "query">): Promise<void> {
  const kv = `insert into sm_kv (key, value, updated_at) values ($1, $2::jsonb, now()) on conflict (key) do update set value = excluded.value, updated_at = now()`;
  for (const key of ["sync.since", "sync.snap", "sync.after"]) await q.query(kv, [key, JSON.stringify("")]);
  // the numeric cursors of protocol 14 and earlier
  await q.query(`delete from sm_kv where key in ('sync.cursor', 'sync.user_cursor')`);
  await q.query(`delete from sm_sync_seen`);
}

/**
 * The end of a pull session from nothing: engine rows of the organisation it did not bring — and that wait for no
 * upload — leave this computer (with the attachment contents nothing refers to any more): what the account may no
 * longer read (such a session sends no tombstones), tombstones the server removed for good, what a restore of the
 * server took back. The platform's own roots (organisation, members) are always sent whole and only ever soft-deleted,
 * and a membership kept here for an account the web version does not know stays. Returns how many went.
 */
async function sweepUnseen(tx: Pick<Db, "query">, orgId: string): Promise<number> {
  let n = 0;
  for (const def of AGGREGATES) {
    if (!def.engine) continue;
    const gone = await tx.query(
      `delete from ${ident(def.table)} t where t.org_id = $1
         and not exists (select 1 from sm_sync_seen s where s.entity = $2 and s.id = t.id)
         and not exists (select 1 from sm_outbox o where o.entity = $2 and o.id = t.id)
       returning t.id`,
      [orgId, def.entity],
    );
    n += gone.length;
  }
  await tx.query(`delete from sm_sync_seen`);
  if (n) await tx.query(`delete from sm_blobs b where b.org_id = $1 and not exists (select 1 from sm_attachments a where a.org_id = b.org_id and a.sha256 = b.sha256)`, [orgId]);
  return n;
}

export class SyncClient {
  state: SyncState = { linked: false, running: false, online: null, last_sync_at: null, last_error: null, pending: 0, failed: [], conflicts: 0, pushed: 0, pulled: 0 };
  private timer: NodeJS.Timeout | null = null;
  private debounce: NodeJS.Timeout | null = null;
  private busy: Promise<void> | null = null;

  constructor(private o: { db: Db; config: LocalConfig; save: () => void; log: Logger; fetch?: typeof fetch }) {
    this.state.linked = !!(o.config.cloud.url && o.config.cloud.token && o.config.cloud.org_id);
  }

  private get f() {
    return this.o.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private base(url?: string | null) {
    return String(url ?? this.o.config.cloud.url ?? "").replace(/\/+$/, "");
  }

  async api<T = any>(path: string, init: { method?: string; body?: unknown; token?: string | null; url?: string | null; timeout?: number } = {}): Promise<T> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), init.timeout ?? 60000);
    try {
      const res = await this.f(`${this.base(init.url)}/api${path}`, {
        method: init.method ?? (init.body ? "POST" : "GET"),
        headers: {
          "content-type": "application/json",
          ...(init.token ?? this.o.config.cloud.token ? { authorization: `Bearer ${init.token ?? this.o.config.cloud.token}` } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: ctrl.signal,
      });
      const text = await res.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!res.ok) {
        const msg = data?.error?.message ?? `خطای ${res.status} از سرور ابری`;
        const err = new Error(msg) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }
      return data as T;
    } catch (e) {
      if ((e as Error).name === "AbortError") throw new Error("سرور ابری پاسخ نداد (اتصال اینترنت را بررسی کنید)");
      if ((e as Error).message?.includes("fetch failed")) throw new Error("اتصال به سرور ابری برقرار نشد");
      throw e;
    } finally {
      clearTimeout(t);
    }
  }

  /** A binary GET/PUT against the linked cloud (attachment contents); null on 404. */
  async raw(path: string, init: { method?: string; body?: Uint8Array; timeout?: number } = {}): Promise<Uint8Array | null> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), init.timeout ?? 120000);
    try {
      const res = await this.f(`${this.base()}/api${path}`, {
        method: init.method ?? "GET",
        headers: { authorization: `Bearer ${this.o.config.cloud.token}`, ...(init.body ? { "content-type": "application/octet-stream" } : {}) },
        body: init.body ? Buffer.from(init.body) : undefined,
        signal: ctrl.signal,
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`خطای ${res.status} از سرور ابری`);
      return new Uint8Array(await res.arrayBuffer());
    } finally {
      clearTimeout(t);
    }
  }

  /** The content of an attachment from the cloud (opened here for the first time). */
  async fetchBlob(orgId: string, attachmentId: string): Promise<Uint8Array | null> {
    if (!this.state.linked || orgId !== this.o.config.cloud.org_id) return null;
    return this.raw(`/o/${orgId}/attachments/${attachmentId}/content`);
  }

  /** Upload the contents of attachments added on this computer that the cloud does not have yet. */
  private async uploadBlobs(attachmentIds: string[]) {
    const org = this.o.config.cloud.org_id;
    if (!org || !attachmentIds.length) return;
    const rows = await this.o.db.query<{ sha256: string }>(
      `select distinct a.sha256 from sm_attachments a join sm_blobs b on b.org_id = a.org_id and b.sha256 = a.sha256 where a.id = any($1::uuid[])`,
      [`{${attachmentIds.join(",")}}`],
    );
    if (!rows.length) return;
    const { missing } = await this.api<{ missing: string[] }>(`/o/${org}/blobs/missing`, { body: { sha256: rows.map((r) => r.sha256) } });
    for (const sha of missing ?? []) {
      const blob = await this.o.db.one<{ b64: string }>(`select encode(data, 'base64') as b64 from sm_blobs where org_id = $1 and sha256 = $2`, [org, sha]);
      if (blob) await this.raw(`/o/${org}/blobs/${sha}`, { method: "PUT", body: new Uint8Array(Buffer.from(blob.b64, "base64")) });
    }
  }

  async login(url: string, email: string, password: string): Promise<string> {
    const r = await this.api<{ token: string }>("/auth/login", { url, token: null, body: { email, password, device: { name: `${APP_NAME} ویندوز — ${hostname()}`, platform: "windows" } } });
    return r.token;
  }

  async cloudOrgs(url: string, email: string, password: string) {
    const token = await this.login(url, email, password);
    const r = await this.api<{ orgs: unknown[] }>("/orgs", { url, token });
    return { orgs: r.orgs };
  }

  /**
   * Check a password against the cloud (sign-in on this computer with an account whose password
   * is not stored here). "wrong" when the cloud answered no, "limited" when it refused for too many
   * attempts, "unreachable" when it could not be
   * asked. The check's own cloud session is closed right away.
   */
  async verifyCloudPassword(email: string, password: string): Promise<{ status: "ok"; user_id: string } | { status: "wrong" | "unreachable" | "limited" }> {
    if (!this.state.linked) return { status: "unreachable" };
    let r: { token?: string; user_id?: string };
    try {
      r = await this.api("/auth/login", { token: null, body: { email, password, device: { name: `بررسی ورود — ${hostname()}`, platform: "windows" } }, timeout: 15000 });
    } catch (e) {
      const status = (e as { status?: number }).status;
      return { status: status === 429 ? "limited" : status && status >= 400 && status < 500 ? "wrong" : "unreachable" };
    }
    if (r.token) await this.api("/auth/logout", { method: "POST", token: r.token, timeout: 15000 }).catch(() => undefined);
    if (!r.user_id) return { status: "wrong" };
    // the account's row is needed here; a sync under way pulls it too, so wait for it and then
    // read only what is new (a full read after an update is left to the sync itself)
    if (this.busy) await this.busy.catch(() => undefined);
    await this.pullAll({ upgrade: false }).catch((e) => this.o.log.warn("pull after a cloud sign-in failed", String((e as Error).message ?? e)));
    return { status: "ok", user_id: r.user_id };
  }

  async link(input: { url: string; email: string; password: string; orgId?: string; direction: "download" | "upload" }) {
    const url = this.base(input.url);
    const token = await this.login(url, input.email, input.password);
    let orgId = input.orgId;
    if (input.direction === "upload") {
      const local = await this.o.db.query<Record<string, unknown>>(`select * from sm_orgs where deleted_at is null order by created_at`);
      const org = orgId ? local.find((o) => o.id === orgId) : local[0];
      if (!org) throw new Error("سازمانی روی این رایانه نیست که بارگذاری شود");
      orgId = String(org.id);
      await this.api("/sync/adopt", { url, token, body: { org } });
    } else {
      if (!orgId) throw new Error("سازمان ابری را انتخاب کنید");
      const exists = await this.o.db.one(`select 1 from sm_orgs where id = $1`, [orgId]);
      const others = await this.o.db.one<{ n: number }>(`select count(*)::int as n from sm_orgs where id <> $1 and deleted_at is null`, [orgId]);
      if (!exists && (others?.n ?? 0) > 0) {
        // allowed: several organisations side by side; nothing to clear
      }
    }
    const reg = await this.api<{ device_id: string }>("/sync/register", { url, token, body: { org_id: orgId, device_id: this.o.config.device_id, name: hostname(), platform: "windows", app_version: APP_VERSION } });
    this.o.config.cloud = { ...this.o.config.cloud, url, token, org_id: orgId!, email: input.email, linked_at: new Date().toISOString() };
    this.o.config.device_id = reg.device_id;
    this.o.save();
    this.state.linked = true;
    await resetSyncCursor(this.o.db);
    if (input.direction === "upload") await this.queueEverything(orgId!);
    await this.syncNow();
    return { ok: true, org_id: orgId, state: this.state };
  }

  async unlink() {
    this.o.config.cloud = { ...this.o.config.cloud, token: null, org_id: null, linked_at: null };
    this.o.save();
    this.state.linked = false;
  }

  /** Mark every local row of the organisation for upload. */
  private async queueEverything(orgId: string) {
    for (const def of AGGREGATES) {
      await this.o.db.query(
        `insert into sm_outbox (entity, id, changed_at) select $1, id, now() from ${ident(def.table)} where ${def.table === "sm_orgs" ? "id" : "org_id"} = $2
         on conflict (entity, id) do update set changed_at = now(), attempts = 0`,
        [def.entity, orgId],
      );
    }
  }

  private async kvGet<T>(key: string, dflt: T): Promise<T> {
    const r = await this.o.db.one<{ value: T }>(`select value from sm_kv where key = $1`, [key]);
    return (r?.value ?? dflt) as T;
  }
  private async kvSet(key: string, value: unknown) {
    await this.o.db.query(`insert into sm_kv (key, value, updated_at) values ($1, $2::jsonb, now()) on conflict (key) do update set value = excluded.value, updated_at = now()`, [key, JSON.stringify(value)]);
  }

  /**
   * Once after an update. Uploads that failed are tried again after every update of the database
   * (`sync.schema`): the new version may accept them. Everything is read again from the start only
   * when the sync protocol changed (`sync.protocol`): an earlier version dropped the columns and
   * the kinds of data it did not know when it pulled. Rows waiting for upload are skipped by the
   * pull, the rest is the cloud's copy anyway.
   */
  private async afterUpgrade() {
    const schema = await this.kvGet<string | null>("sync.schema", null);
    const protocol = await this.kvGet<number | null>("sync.protocol", null);
    if (schema === SCHEMA_VERSION && protocol === SYNC_PROTOCOL) return;
    await this.o.db.tx(async (tx) => {
      const kv = `insert into sm_kv (key, value, updated_at) values ($1, $2::jsonb, now()) on conflict (key) do update set value = excluded.value, updated_at = now()`;
      if (protocol !== SYNC_PROTOCOL) await resetSyncCursor(tx);
      await tx.query(`update sm_outbox set attempts = 0, last_error = null where attempts > 0`);
      await tx.query(kv, ["sync.schema", JSON.stringify(SCHEMA_VERSION)]);
      await tx.query(kv, ["sync.protocol", JSON.stringify(SYNC_PROTOCOL)]);
    });
  }

  async refreshPending() {
    const org = this.o.config.cloud.org_id;
    if (!org) {
      this.state.pending = 0;
      this.state.failed = [];
      return;
    }
    const r = await this.o.db.one<{ n: number }>(`select count(*)::int as n from sm_outbox o where not ${foreign()}`, [org]);
    this.state.pending = r?.n ?? 0;
    this.state.failed = await this.o.db.query(`select entity, id, last_error as error from sm_outbox o where attempts >= 5 and not ${foreign()} order by changed_at limit 50`, [org]);
  }

  async push(): Promise<number> {
    let total = 0;
    for (let round = 0; round < 50; round++) {
      const queued = await this.o.db.query<{ entity: string; id: string; changed_at: string }>(
        `select entity, id, changed_at from sm_outbox o where attempts < 5 and not ${foreign()} order by changed_at limit 200`,
        [this.o.config.cloud.org_id],
      );
      if (!queued.length) break;
      const aggregates: WireAggregate[] = [];
      const byEntity = new Map<string, string[]>();
      for (const q of queued) byEntity.set(q.entity, [...(byEntity.get(q.entity) ?? []), q.id]);
      for (const [entity, ids] of byEntity) {
        const def = BY_ENTITY.get(entity);
        if (!def) continue;
        const read = await readAggregates(this.o.db, def, ids);
        // secrets of engine records stay on this computer (each runtime seals its own)
        const tdef = def.engine === "record" ? tableDef(entity) : undefined;
        if (tdef) for (const a of read) stripSecrets(tdef, a.row);
        aggregates.push(...read);
      }
      const found = new Set(aggregates.map((a) => `${a.entity}:${a.id}`));
      for (const q of queued) if (!found.has(`${q.entity}:${q.id}`)) await this.o.db.query(`delete from sm_outbox where entity = $1 and id = $2`, [q.entity, q.id]);
      if (!aggregates.length) continue;
      const res = await this.api<{ results: { entity: string; id: string; status: string; rev?: number; message?: string; renumbered?: { column: string; to: unknown }; aggregate?: WireAggregate }[] }>(
        "/sync/push",
        { body: { org_id: this.o.config.cloud.org_id, device_id: this.o.config.device_id, protocol: SYNC_PROTOCOL, aggregates } },
      );
      const sentAt = new Map(queued.map((q) => [`${q.entity}:${q.id}`, q.changed_at]));
      await this.o.db.tx(async (tx) => {
        await tx.query("set local itsm.applying = 'on'");
        for (const r of res.results) {
          const def = BY_ENTITY.get(r.entity);
          const key = `${r.entity}:${r.id}`;
          if (r.status === "ok" && def) {
            const extra = r.renumbered ? `, ${ident(r.renumbered.column)} = $3` : "";
            await tx.query(`update ${ident(def.table)} set rev = $2${extra} where id = $1`, r.renumbered ? [r.id, r.rev ?? 0, r.renumbered.to] : [r.id, r.rev ?? 0]);
            await tx.query(`delete from sm_outbox where entity = $1 and id = $2 and changed_at <= $3`, [r.entity, r.id, sentAt.get(key)]);
            total++;
          } else if (r.status === "conflict" && def) {
            this.state.conflicts++;
            // take the cloud's winning copy now: a pull may already have moved past its revision
            // (it skips aggregates waiting in the outbox). A newer local edit is pushed again.
            const newer = await tx.one(`select 1 from sm_outbox where entity = $1 and id = $2 and changed_at > $3`, [r.entity, r.id, sentAt.get(key)]);
            if (!newer) {
              if (r.aggregate) await writeAggregate(tx, def, r.aggregate, this.o.config.cloud.org_id!, "local-yields");
              await tx.query(`delete from sm_outbox where entity = $1 and id = $2`, [r.entity, r.id]);
            }
          } else if (r.status === "conflict" || r.status === "skipped") {
            await tx.query(`delete from sm_outbox where entity = $1 and id = $2`, [r.entity, r.id]);
          } else {
            await tx.query(`update sm_outbox set attempts = attempts + 1, last_error = $3 where entity = $1 and id = $2`, [r.entity, r.id, r.message ?? "خطا"]);
          }
        }
      });
      // the web version renumbered a record or won a conflict: open screens show its copy
      if (res.results.some((r) => r.renumbered || (r.status === "conflict" && r.aggregate))) bumpLocal(this.o.config.cloud.org_id!);
      // contents of attachments added here travel separately (the cloud fetches nothing from this computer)
      const attachments = res.results.filter((r) => r.entity === "attachment" && r.status === "ok").map((r) => r.id);
      await this.uploadBlobs(attachments).catch((e) => this.o.log.warn("attachment upload failed", String((e as Error).message ?? e)));
      if (queued.length < 200) break;
    }
    this.state.pushed += total;
    return total;
  }

  /**
   * Download what the web version changed since the last complete pull. The cursor is the server's snapshot of that
   * pull (`sync.since`; revisions are transaction ids, docs/spec/ENGINE.md §13); a pull session reads the delta up to
   * its own snapshot (`sync.snap`) a page at a time (`sync.after`), each page applied in one local transaction together
   * with the cursor, so an interrupted session resumes where it stopped. A session from nothing (first link, an update
   * of the protocol, a `reset`) reads everything there is: rows of the organisation it did not receive (and that wait
   * for no upload) are dropped at its end — what the account may no longer read, what a restore of the server took
   * back, tombstones the server removed for good — and one more session follows at once for rows that changed while it
   * ran.
   */
  async pullAll(opts: { upgrade?: boolean } = {}): Promise<number> {
    let count = 0;
    if (opts.upgrade !== false) await this.afterUpgrade();
    let swept = false;
    for (let round = 0; round < 10000; round++) {
      const since = await this.kvGet<string>("sync.since", "");
      const snap = await this.kvGet<string>("sync.snap", "");
      const after = await this.kvGet<string>("sync.after", "");
      const epoch = await this.kvGet<string | number | null>("sync.epoch", null);
      const qs = new URLSearchParams({ org_id: String(this.o.config.cloud.org_id), device_id: String(this.o.config.device_id), protocol: String(SYNC_PROTOCOL) });
      if (since) qs.set("since", String(since));
      if (snap) qs.set("snap", String(snap));
      if (after) qs.set("after", String(after));
      if (epoch !== null && epoch !== undefined) qs.set("epoch", String(epoch));
      const page = await this.api<PullPage>(`/sync/pull?${qs.toString()}`);
      // a web version from before transaction-id revisions answers numeric cursors: it needs the update, not this app
      if (!page.reset && typeof page.snap !== "string") {
        throw new Error(`نسخه‌ی وب ${APP_NAME} هنوز به‌روز نشده است؛ دریافت تغییرها پس از به‌روزرسانی وب انجام می‌شود`);
      }
      const orgId = this.o.config.cloud.org_id!;
      let sweep = false;
      await this.o.db.tx(async (tx) => {
        await tx.query("set local itsm.applying = 'on'");
        const kv = `insert into sm_kv (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now()`;
        if (page.reset) {
          // what this account may read changed, or the server was restored: read everything again (and drop the rest)
          await resetSyncCursor(tx);
          await tx.query(kv, ["sync.epoch", JSON.stringify(page.epoch ?? "")]);
          return;
        }
        // a session from nothing starts: what it receives is recorded, the rest goes at its end
        if (page.full && !snap) await tx.query(`delete from sm_sync_seen`);
        if (page.full) {
          const byEntity = new Map<string, string[]>();
          for (const a of page.aggregates) byEntity.set(a.entity, [...(byEntity.get(a.entity) ?? []), a.id]);
          for (const [entity, ids] of byEntity) {
            await tx.query(`insert into sm_sync_seen (entity, id) select $1, unnest($2::uuid[]) on conflict do nothing`, [entity, pgArray(ids)]);
          }
        }
        for (const u of page.users) await this.mergeUser(tx, u);
        const dirty = new Set((await tx.query<{ entity: string; id: string }>(`select entity, id from sm_outbox`)).map((r) => `${r.entity}:${r.id}`));
        const sorted = [...page.aggregates].sort((a, b) => (BY_ENTITY.get(a.entity)?.order ?? 99) - (BY_ENTITY.get(b.entity)?.order ?? 99));
        for (const agg of sorted) {
          const def = BY_ENTITY.get(agg.entity);
          if (!def || dirty.has(`${agg.entity}:${agg.id}`)) continue;
          await writeAggregate(tx, def, agg, orgId, "local-yields");
          count++;
        }
        for (const t of page.tombstones ?? []) {
          const def = BY_ENTITY.get(t.entity);
          if (!def?.engine || dirty.has(`${t.entity}:${t.id}`)) continue;
          const gone = await tx.one(`delete from ${ident(def.table)} where id = $1 and org_id = $2 returning id`, [t.id, orgId]);
          if (def.engine === "record") {
            // the record's own trail leaves with it
            await tx.query(`delete from sm_journal where org_id = $1 and record_id = $2`, [orgId, t.id]);
            await tx.query(`delete from sm_history where org_id = $1 and record_id = $2`, [orgId, t.id]);
            await tx.query(`delete from sm_attachments where org_id = $1 and record_id = $2`, [orgId, t.id]);
            await tx.query(`delete from sm_links where org_id = $1 and (from_id = $2 or to_id = $2)`, [orgId, t.id]);
          }
          if (gone) count++;
        }
        if (page.tombstones?.length) {
          // contents no attachment here refers to any more leave this computer too
          await tx.query(`delete from sm_blobs b where b.org_id = $1 and not exists (select 1 from sm_attachments a where a.org_id = b.org_id and a.sha256 = b.sha256)`, [orgId]);
        }
        if (page.full && !page.has_more) {
          count += await sweepUnseen(tx, orgId);
          sweep = true;
        }
        await tx.query(kv, ["sync.since", JSON.stringify(page.cursor ?? "")]);
        await tx.query(kv, ["sync.snap", JSON.stringify(page.has_more ? page.snap ?? "" : "")]);
        await tx.query(kv, ["sync.after", JSON.stringify(page.has_more ? page.after ?? "" : "")]);
        if (page.epoch !== undefined) await tx.query(kv, ["sync.epoch", JSON.stringify(page.epoch)]);
      });
      if (page.reset) continue;
      if (page.has_more) continue;
      // after a session from nothing, one more (rows that changed while it ran come now, not at the next sync)
      if (sweep && !swept) {
        swept = true;
        continue;
      }
      break;
    }
    await this.purgeLocalOnly();
    this.state.pulled += count;
    // open screens refresh what the web version changed
    if (count) bumpLocal(this.o.config.cloud.org_id!);
    return count;
  }

  /**
   * Fields kept out of replicas (`FieldDef.noSync`: sensitive answers) leave this computer once nothing waits for
   * upload: what was typed here went to the web version with the push, and pulls never bring them.
   */
  private async purgeLocalOnly() {
    const orgId = this.o.config.cloud.org_id;
    if (!orgId) return;
    for (const def of AGGREGATES) {
      if (def.engine !== "record") continue;
      const tdef = tableDef(def.entity);
      const cols = tdef ? localOnlyFields(tdef).map((f) => f.name) : [];
      if (!cols.length) continue;
      await this.o.db.tx(async (tx) => {
        await tx.query("set local itsm.applying = 'on'");
        await tx.query(
          `update ${ident(def.table)} set ${cols.map((c) => `${ident(c)} = null`).join(", ")}
           where org_id = $1 and (${cols.map((c) => `${ident(c)} is not null`).join(" or ")}) and id not in (select id from sm_outbox where entity = $2)`,
          [orgId, def.entity],
        );
        await tx.query(`delete from sm_history where org_id = $1 and table_key = $2 and field = any($3::text[])`, [orgId, def.entity, `{${cols.join(",")}}`]);
      });
    }
  }

  /** A cloud user replaces a local user with the same e-mail (references are moved over). */
  private async mergeUser(tx: Pick<Db, "query" | "one">, u: Record<string, unknown>) {
    const local = await tx.one<{ id: string }>(`select id from sm_users where lower(email) = lower($1)`, [u.email]);
    if (local && local.id !== u.id) {
      await tx.query(`update sm_users set email = email || '.local-' || substr(id::text, 1, 8) where id = $1`, [local.id]);
      await tx.query(`insert into sm_users (id, email, full_name, mobile, password_hash, disabled, prefs, rev, created_at, updated_at)
                      values ($1, $2, $3, $4, $5, $6, coalesce($7::jsonb, '{}'::jsonb), $8, $9, $10)`,
        [u.id, u.email, u.full_name, u.mobile ?? null, u.password_hash ?? null, !!u.disabled, u.prefs ? JSON.stringify(u.prefs) : null, u.rev ?? 0, u.created_at ?? new Date().toISOString(), u.updated_at ?? new Date().toISOString()]);
      await tx.query(`update sm_sessions set user_id = $2 where user_id = $1`, [local.id, u.id]);
      await tx.query(`update sm_org_members set user_id = $2 where user_id = $1 and not exists (select 1 from sm_org_members m2 where m2.user_id = $2 and m2.org_id = sm_org_members.org_id)`, [local.id, u.id]);
      return;
    }
    // The cloud shares a password hash only with devices whose user could set that password
    // anyway; for any other account it says so (`password_withheld`) and a hash kept here from an
    // earlier version or an earlier sign-in is dropped: that person signs in through the cloud.
    const hash = u.password_withheld ? "excluded.password_hash" : "coalesce(excluded.password_hash, sm_users.password_hash)";
    await tx.query(
      `insert into sm_users (id, email, full_name, mobile, password_hash, disabled, prefs, rev, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, coalesce($7::jsonb, '{}'::jsonb), $8, $9, $10)
       on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, mobile = excluded.mobile,
         password_hash = ${hash}, disabled = excluded.disabled, rev = excluded.rev, updated_at = excluded.updated_at`,
      [u.id, u.email, u.full_name, u.mobile ?? null, u.password_hash ?? null, !!u.disabled, u.prefs ? JSON.stringify(u.prefs) : null, u.rev ?? 0, u.created_at ?? new Date().toISOString(), u.updated_at ?? new Date().toISOString()],
    );
  }

  async syncNow(): Promise<SyncState> {
    if (!this.state.linked) return this.state;
    if (this.busy) {
      await this.busy;
      return this.state;
    }
    this.busy = (async () => {
      this.state.running = true;
      try {
        await this.afterUpgrade();
        // a push the cloud refuses (an organisation made read-only by the platform admin, an older
        // server) must not stop this computer from receiving the cloud's changes
        let refused: string | null = null;
        try {
          await this.push();
        } catch (e) {
          const status = (e as { status?: number }).status;
          if (!status || status < 400 || status >= 500 || status === 401) throw e;
          refused = String((e as Error).message ?? e);
          this.o.log.warn("sync push refused", refused);
          if (status === 400 && (await this.serverProtocol()) < SYNC_PROTOCOL) {
            // this app is newer than the web version: it is the web that needs the update
            refused = `نسخه‌ی وب ${APP_NAME} هنوز به‌روز نشده است؛ تغییرهای این رایانه همین‌جا نگه داشته می‌شوند و پس از به‌روزرسانی وب فرستاده می‌شوند`;
          }
        }
        await this.pullAll();
        this.state.online = true;
        this.state.last_error = refused;
        this.state.last_sync_at = new Date().toISOString();
      } catch (e) {
        const msg = String((e as Error).message ?? e);
        this.state.last_error = msg;
        this.state.online = !/اتصال|پاسخ نداد/.test(msg) ? true : false;
        if ((e as { status?: number }).status === 401) {
          this.state.last_error = "ورود به حساب ابری منقضی شده است؛ از تنظیمات ← همگام‌سازی دوباره وصل شوید";
        }
        this.o.log.warn("sync failed", msg);
      } finally {
        this.state.running = false;
        await this.refreshPending().catch(() => {});
        this.busy = null;
      }
    })();
    await this.busy;
    return this.state;
  }

  /** The cloud's sync protocol (Infinity when it cannot be read: nothing is assumed then). */
  private async serverProtocol(): Promise<number> {
    try {
      const r = await this.api<{ protocol?: number }>(`/sync/status?org_id=${this.o.config.cloud.org_id}`, { timeout: 15000 });
      return typeof r?.protocol === "number" ? r.protocol : Infinity;
    } catch {
      return Infinity;
    }
  }

  start() {
    void this.refreshPending().catch(() => {});
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.state.linked && this.o.config.cloud.auto_sync) void this.syncNow();
    }, 30000);
    setTimeout(() => this.state.linked && void this.syncNow(), 3000);
  }

  /** After a local write: sync a few seconds later (several writes are batched). */
  nudge() {
    if (!this.state.linked || !this.o.config.cloud.auto_sync) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.syncNow(), 2500);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
    this.timer = null;
    if (this.busy) await this.busy.catch(() => {});
  }
}
