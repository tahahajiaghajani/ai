// The connector's configuration rules (design A §5.1, §6.3, §7.4), on every write path — the record API, AI tools and
// the module's routes alike:
//   · its kind is chosen once, from the built wave-1 kinds (the demo pack's kind by the system only)
//   · a new connector gets its own data source (kind «connector», the kind's priority — a relayed tool's for a push
//     connector — and a staleness window of 30 days), the kind's default create policy and collection
//   · `config_version` moves when the mapping, the options, the create policy or the default class change: it is part
//     of every item hash, so every item is reconciled again (the kind's version is in the hash on its own)
//   · the mapping keeps to the field allow-list and the options to the kind's schema; schedules keep to the edition's
//     minimum
//   · the organisation's sweep is queued with every save of an active connector (§7.2: it is the connectors' clock, and
//     a save — re-entering a key a backup restore dropped, say — brings back a sweep that was lost)
// Who may change which field, and re-authentication, are the connector guard's (§14.5, DA1 part 2).
import { kindDescriptor } from "@shared/discovery/kinds";
import { checkMapping } from "@shared/discovery/mapping";
import type { KindDescriptor } from "@shared/discovery/types";
import { registerHooks, type WriteArgs } from "../../engine/hooks";
import { createIn, isSystemCtx } from "../../engine";
import { bad } from "../../http/errors";
import { sysOf } from "../incident/common";
import { CONNECTOR_MESSAGES } from "./kind";
import { ensureSweepIn, MIN_EVERY_MINUTES, MIN_STATUS_EVERY_MINUTES } from "./jobs";
import { editionOf } from "./net";
import { serverKind } from "./registry";
import { kindOptions } from "./runner";

/** Fields whose change re-reconciles every item of the connector (§5.1). */
export const CONFIG_FIELDS = ["mapping", "options", "create_policy", "default_class"] as const;

const faDigits = (n: number) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

/** The connector's own data source (1:1, §8.1): a free name, the kind's priority, 30 days of authority. */
async function makeDataSource(w: WriteArgs, d: KindDescriptor): Promise<string> {
  const relayed = w.next.kind === "push" && w.next.relay_kind ? kindDescriptor(String(w.next.relay_kind)) : undefined;
  const base = String(w.next.name ?? d.label).trim().slice(0, 100) || d.label;
  const taken = new Set(
    (await w.tx.query<{ name: string }>(`select name from sm_cmdb_sources where org_id = $1 and deleted_at is null and left(name, length($2)) = $2`, [w.ctx.org.id, base])).map((r) => r.name),
  );
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base} (${faDigits(i)})`;
  const src = await createIn(w.tx, sysOf(w.ctx), "cmdb_data_source", {
    name, kind: "connector", priority: (relayed ?? d).priority, stale_after_days: 30, active: true, owner_id: w.next.owner_id ?? null,
    default_class: w.next.default_class ?? null, description: `منبع دادهٔ «${base}» (${relayed?.label ?? d.label})`,
  }, { trusted: true });
  return String(src.id);
}

function checkSchedule(w: WriteArgs): void {
  const edition = editionOf(w.ctx.cfg) === "server" ? "server" : "cloud";
  const every = Number(w.next.every_minutes ?? 0);
  if ((w.op === "create" || w.changed.has("every_minutes")) && every > 0 && every < MIN_EVERY_MINUTES[edition]) {
    throw bad(`کمترین فاصلهٔ خواندن فهرست در این نسخه ${faDigits(MIN_EVERY_MINUTES[edition])} دقیقه است`, { field: "every_minutes" });
  }
  const status = Number(w.next.status_every_minutes ?? 0);
  if ((w.op === "create" || w.changed.has("status_every_minutes")) && status > 0 && status < MIN_STATUS_EVERY_MINUTES[edition]) {
    throw bad(`کمترین فاصلهٔ خواندن وضعیت در این نسخه ${faDigits(MIN_STATUS_EVERY_MINUTES[edition])} دقیقه است`, { field: "status_every_minutes" });
  }
}

function checkConfig(w: WriteArgs, d: KindDescriptor): void {
  if (w.op === "create" || w.changed.has("mapping")) {
    const problems = checkMapping(w.next.mapping ?? {}, { rest: d.kind === "rest" });
    if (problems.length) throw bad(problems[0].key ? `نگاشت «${problems[0].key}»: ${problems[0].message}` : problems[0].message, { field: "mapping", problems });
  }
  if (w.op === "create" || w.changed.has("options")) {
    const kind = serverKind(d.kind);
    if (kind?.ready) {
      const r = kindOptions(kind, w.next.options);
      if ("error" in r) throw bad(r.error, { field: "options" });
    }
  }
}

async function beforeWrite(w: WriteArgs): Promise<void> {
  if (w.op === "create") {
    const d = kindDescriptor(String(w.next.kind ?? ""));
    if (!d) throw bad("نوع منبع شناخته نیست", { field: "kind" });
    if (!d.ready) throw bad(CONNECTOR_MESSAGES.notBuilt(d.label), { field: "kind" });
    if (d.hidden && !isSystemCtx(w.ctx)) throw bad("این نوع منبع را فقط بستهٔ داده‌های نمایشی می‌سازد", { field: "kind" });
    if (!w.input?.has("create_policy")) w.next.create_policy = d.create_policy;
    if (!w.input?.has("collect")) w.next.collect = d.collects.filter((c) => c !== "software");
    if (!w.input?.has("mapping") && d.default_mapping) w.next.mapping = { ...d.default_mapping };
    w.next.config_version = 1;
    checkSchedule(w);
    checkConfig(w, d);
    w.next.source_id = await makeDataSource(w, d);
    return;
  }
  if (w.op !== "update" || !w.prev) return;
  if (w.changed.has("kind")) throw bad("نوع منبع پس از ساخت تغییر نمی‌کند", { field: "kind" });
  const d = kindDescriptor(String(w.prev.kind ?? ""));
  checkSchedule(w);
  if (d) checkConfig(w, d);
  if (CONFIG_FIELDS.some((f) => w.changed.has(f))) w.next.config_version = Number(w.prev.config_version ?? 1) + 1;
}

let installed = false;

/** The connector's configuration hook (once per process, from installDiscoveryModule). */
export function installConnectorConfig(): void {
  if (installed) return;
  installed = true;
  registerHooks("discovery_connector", {
    beforeWrite,
    async afterWrite(w) {
      if ((w.op === "create" || w.op === "update" || w.op === "restore") && w.row.active !== false) await ensureSweepIn(w.tx, w.ctx.org.id);
    },
  });
}
