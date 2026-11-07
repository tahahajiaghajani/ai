// Behaviour of the flows' configuration tables (engine hooks, same transaction as the write):
// - flow             trigger settings checked (a record trigger never watches the flows' own tables), a schedule
//                    checked, «سامانه» or another member as the run identity only for flow administrators, the draft
//                    marked `dirty` when it differs from what was published, activation only with a published version
// - flow_version     immutable: created only by publishing (service.ts), never changed or deleted
// - flow_connection  base address (https and public on the web version), allowed hosts, auth settings
// - schedule         target table and template fields, the schedule itself
// Record meta: `meta.schedule` (next/last occurrence, last error) and `meta.flow` (open runs, last run).
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { isSystemCtx, orgSchema, orgTz, registerHooks, registerRecordMeta } from "../../engine";
import { prepareSubject, subjectOf } from "../../access";
import { bad, forbidden } from "../../http/errors";
import { safeExternalUrl } from "../../net";
import { fullGrant, grantIn, type FullGrant } from "@shared/access";
import { FLOW_LIMITS, FLOW_TABLE_KEYS, describeSchedule, emptyGraph, nextOccurrence, scheduleProblem, type ScheduleSpec } from "@shared/flows";
import { faDigits } from "@shared/format";
import { ensureScheduler } from "./scheduler";

const FULL = fullGrant({ read: "all", create: true, write: "all", delete: "all", approve: true, admin: true });

/** The caller's grant in the `flows` area (the system: everything). */
export async function flowsGrant(ctx: Ctx, q?: Queryable): Promise<FullGrant> {
  if (isSystemCtx(ctx)) return FULL;
  await prepareSubject(ctx, q ?? ctx.db);
  const s = subjectOf(ctx);
  return s.kind === "system" ? FULL : grantIn(s.eff, "flows");
}

/** Transactions that may create flow versions (the publish service marks its own). */
export const publishing = new WeakSet<Tx>();

const DRAFT = ["trigger", "trigger_table", "trigger_events", "trigger_fields", "trigger_condition", "schedule", "catalog_item", "run_as", "run_as_user", "graph"];

async function triggerTable(q: Queryable, ctx: Ctx, key: unknown) {
  const table = String(key ?? "").trim();
  if (!table) return null;
  if (FLOW_TABLE_KEYS.includes(table)) throw bad("گردش‌کار نمی‌تواند با تغییر پیکربندی گردش‌کارها آغاز شود", { fields: { trigger_table: "این جدول مجاز نیست" } });
  const def = (await orgSchema(ctx, q)).def(table);
  if (!def || def.virtual) throw bad(`جدول «${table}» وجود ندارد`, { fields: { trigger_table: "جدول وجود ندارد" } });
  return def;
}

function checkGraph(v: unknown) {
  if (v === null || v === undefined) return;
  const g = v as { nodes?: unknown; edges?: unknown };
  if (typeof v !== "object" || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) throw bad("طرح گردش‌کار معتبر نیست");
  if (g.nodes.length > FLOW_LIMITS.nodes) throw bad(`گردش‌کار بیش از ${faDigits(FLOW_LIMITS.nodes)} گام دارد`);
  if (JSON.stringify(v).length > FLOW_LIMITS.graphBytes) throw bad("طرح گردش‌کار بیش از اندازه بزرگ است");
}

const HOST = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;
const RESERVED_HEADERS = new Set(["host", "content-length", "connection", "transfer-encoding", "authorization", "cookie", "idempotency-key"]);

let installed = false;

export function installFlowHooks(): void {
  if (installed) return;
  installed = true;

  registerHooks("flow", {
    async beforeWrite(w) {
      if (w.op === "delete") return;
      const n = w.next;
      if (w.op === "create" && (n.graph === null || n.graph === undefined)) n.graph = emptyGraph();
      checkGraph(n.graph);
      if (n.trigger === "record" && n.trigger_table) {
        const def = await triggerTable(w.tx, w.ctx, n.trigger_table);
        const fields = Array.isArray(n.trigger_fields) ? (n.trigger_fields as string[]) : [];
        for (const f of fields) if (!def?.fields.some((x) => x.name === f)) throw bad(`فیلد «${f}» در «${def?.label}» نیست`, { fields: { trigger_fields: `فیلد «${f}» در این جدول نیست` } });
      }
      if (n.trigger === "schedule" && n.schedule !== null && n.schedule !== undefined) {
        const p = scheduleProblem(n.schedule);
        if (p) throw bad(p, { fields: { schedule: p } });
      }
      if (n.run_as === "user" && !n.run_as_user) throw bad("کاربری را که گردش‌کار با دسترسی او اجرا می‌شود انتخاب کنید", { fields: { run_as_user: "کاربر اجرا را انتخاب کنید" } });
      const who = w.op === "create" || w.changed.has("run_as") || w.changed.has("run_as_user");
      if (who && !isSystemCtx(w.ctx)) {
        const elevated = n.run_as === "system" || (n.run_as === "user" && n.run_as_user && n.run_as_user !== w.ctx.user.id);
        if (elevated && !(await flowsGrant(w.ctx, w.tx)).admin) {
          throw forbidden("اجرای گردش‌کار با دسترسی سامانه یا عضوی دیگر را فقط مدیر گردش‌کارها تعیین می‌کند");
        }
      }
      if (w.op === "create") n.dirty = true;
      else if (!w.changed.has("version_id") && DRAFT.some((f) => w.changed.has(f))) n.dirty = true;
      if (n.active && !n.version_id) throw bad("پیش از فعال‌کردن، نسخه‌ای از گردش‌کار را منتشر کنید", { fields: { active: "ابتدا منتشر کنید" } });
    },
    async afterWrite(w) {
      if (w.op === "delete" || !w.row.active) return;
      if (["active", "version_id", "trigger", "schedule"].some((f) => w.changed.has(f))) await ensureScheduler(w.tx, w.ctx.org.id);
    },
  });

  registerHooks("flow_version", {
    beforeWrite(w) {
      if (isSystemCtx(w.ctx)) return;
      if (w.op === "create" && publishing.has(w.tx)) return;
      throw bad("نسخه‌های گردش‌کار فقط با «انتشار» ساخته می‌شوند و تغییر نمی‌کنند");
    },
  });

  registerHooks("flow_connection", {
    beforeWrite(w) {
      if (w.op === "delete") return;
      const n = w.next;
      const base = String(n.base_url ?? "");
      if (w.ctx.cfg.mode === "cloud") {
        const p = safeExternalUrl(base);
        if (p) throw bad(p, { fields: { base_url: p } });
      } else if (!/^https?:\/\//i.test(base)) throw bad("نشانی باید با https:// یا http:// شروع شود", { fields: { base_url: "نشانی معتبر نیست" } });
      for (const h of Array.isArray(n.hosts) ? (n.hosts as string[]) : []) {
        const host = String(h).trim();
        if (!HOST.test(host)) throw bad(`«${host}» نام میزبان معتبری نیست`, { fields: { hosts: `«${host}» معتبر نیست` } });
        if (w.ctx.cfg.mode === "cloud" && safeExternalUrl(`https://${host.replace(/^\*\./, "x.")}/`)) throw bad(`میزبان داخلی «${host}» در نسخهٔ وب مجاز نیست`, { fields: { hosts: "میزبان داخلی مجاز نیست" } });
      }
      if ((n.auth === "header" || n.auth === "query") && !/^[A-Za-z0-9_.-]{1,80}$/.test(String(n.auth_name ?? ""))) {
        throw bad("نام سرآیند یا پارامتر کلید را وارد کنید", { fields: { auth_name: "نام سرآیند یا پارامتر را وارد کنید" } });
      }
      if (n.auth === "header" && RESERVED_HEADERS.has(String(n.auth_name).toLowerCase())) throw bad("این نام سرآیند رزرو شده است", { fields: { auth_name: "نام دیگری انتخاب کنید" } });
      if (n.auth === "basic" && !String(n.username ?? "").trim()) throw bad("نام کاربری را وارد کنید", { fields: { username: "نام کاربری را وارد کنید" } });
      if (n.headers !== null && n.headers !== undefined) {
        const h = n.headers as Record<string, unknown>;
        if (typeof h !== "object" || Array.isArray(h)) throw bad("سرآیندهای ثابت باید شیء JSON باشد", { fields: { headers: "شیء JSON لازم است" } });
        for (const [k, v] of Object.entries(h)) {
          if (!/^[A-Za-z0-9_.-]{1,80}$/.test(k) || RESERVED_HEADERS.has(k.toLowerCase()) || (typeof v !== "string" && typeof v !== "number")) {
            throw bad(`سرآیند «${k}» مجاز نیست`, { fields: { headers: `سرآیند «${k}» مجاز نیست` } });
          }
        }
      }
    },
  });

  registerHooks("schedule", {
    async beforeWrite(w) {
      if (w.op === "delete") return;
      const n = w.next;
      const table = String(n.table_key ?? "").trim();
      if (FLOW_TABLE_KEYS.includes(table)) throw bad("این جدول را نمی‌توان زمان‌بندی کرد", { fields: { table_key: "این جدول مجاز نیست" } });
      const def = (await orgSchema(w.ctx, w.tx)).def(table);
      if (!def || def.virtual) throw bad(`جدول «${table}» وجود ندارد`, { fields: { table_key: "جدول وجود ندارد" } });
      const p = scheduleProblem(n.spec);
      if (p) throw bad(p, { fields: { spec: p } });
      const t = (n.template ?? {}) as Record<string, unknown>;
      if (typeof t !== "object" || Array.isArray(t)) throw bad("مقدارهای رکورد معتبر نیست", { fields: { template: "شیء JSON لازم است" } });
      if (n.active && !Object.keys(t).length) throw bad("پیش از فعال‌کردن، مقدارهای رکورد را تعیین کنید", { fields: { template: "دست‌کم یک مقدار لازم است" } });
      for (const k of Object.keys(t)) {
        const f = def.fields.find((x) => x.name === k);
        if (!f) throw bad(`فیلد «${k}» در «${def.label}» نیست`, { fields: { template: `فیلد «${k}» در این جدول نیست` } });
        if (f.readonly || f.system) throw bad(`فیلد «${f.label}» فقط‌خواندنی است`, { fields: { template: `«${f.label}» فقط‌خواندنی است` } });
      }
    },
    async afterWrite(w) {
      if (w.op !== "delete" && w.row.active) await ensureScheduler(w.tx, w.ctx.org.id);
    },
  });

  registerRecordMeta("schedule", async ({ q, ctx, row }) => {
    const t = await q.one<{ next_at: string | null; last_at: string | null; last_error: string | null }>(
      `select next_at, last_at, last_error from sm_flow_timers where org_id = $1 and kind = 'schedule' and ref_id = $2`,
      [ctx.org.id, row.id],
    );
    const tz = orgTz(ctx);
    const spec = row.spec as ScheduleSpec | null;
    const planned = t?.next_at ? new Date(String(t.next_at)).toISOString() : spec && !scheduleProblem(spec) && row.active ? nextOccurrence(spec, Date.now(), tz) : null;
    return {
      schedule: {
        description: describeSchedule(spec, tz),
        next_at: typeof planned === "number" ? new Date(planned).toISOString() : planned,
        last_at: t?.last_at ? new Date(String(t.last_at)).toISOString() : null,
        last_error: t?.last_error ?? null,
      },
    };
  });

  registerRecordMeta("flow", async ({ q, ctx, row }) => {
    const r = await q.one<{ open: number; last_id: string | null; last_state: string | null; last_at: string | null }>(
      `select (select count(*)::int from sm_flow_runs where org_id = $1 and flow_id = $2 and state in ('running', 'waiting')) as open,
              l.id as last_id, l.state as last_state, l.started_at as last_at
       from (select 1) x left join lateral (select id, state, started_at from sm_flow_runs where org_id = $1 and flow_id = $2 order by started_at desc limit 1) l on true`,
      [ctx.org.id, row.id],
    );
    return {
      flow: {
        open_runs: r?.open ?? 0,
        last_run: r?.last_id ? { id: r.last_id, state: r.last_state, started_at: new Date(String(r.last_at)).toISOString() } : null,
        webhook_path: `/api/hooks/flows/${row.id}`,
      },
    };
  });
}
