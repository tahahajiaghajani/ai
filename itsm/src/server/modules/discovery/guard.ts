// Who may do what with a connector (design A §14.5, §14.6, §14.7) — on every write path alike: the record API
// (/r/discovery_connector/:id), AI tools and flows, and the module's routes all pass through this hook.
//
//   · CMDB administrators create, change and delete connectors; a change of the credentials (`secret`, `secret2`), of
//     where they go (the address's host, `hosts`), of `plain_http`, `over_manual`, the create policy, or the missing
//     action to «علامت «مفقود» خودکار» needs a recent proof of identity (needRecentAuth) — a stolen session cannot aim
//     stored credentials at another server or loosen the rules quietly;
//   · a connector's owner who is not a CMDB administrator changes only «فعال», the schedules and the description;
//   · «ساخت دارایی برای دستگاه‌های تازه» is switched by asset managers, software collection by software managers;
//   · a change of the address's host or of `hosts` clears both secrets (unless the same write enters new ones):
//     «کلید به سبب تغییر نشانی پاک شد»; a change of the directory source clears its approval (§14.8);
//   · the address, the root certificate and the unencrypted tick are checked when they are saved (§14.1, §14.2);
//   · delete is soft: the connector's data source is set inactive, its items stay and are marked gone, its running
//     passes stop, and nothing is retired;
//   · the unencrypted tick, `over_manual`, the automatic missing mark and cleared secrets are journaled on the
//     connector (its history records every change; a secret shows only that it changed);
//   · the Windows app neither runs nor configures connectors: «منبع‌های داده و وضعیت پایش روی سرور اجرا و دیده می‌شوند».
import { grantIn, scopeRank, type FullGrant } from "@shared/access";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { demoScopeOrg, isDemoRow } from "../../db/scope";
import { needRecentAuth } from "../../auth/policy";
import { subjectOf } from "../../access";
import { addJournalIn, isSystemCtx, orgSchema, updateIn } from "../../engine";
import { registerHooks, type WriteArgs } from "../../engine/hooks";
import { AppError, bad, forbidden } from "../../http/errors";
import { caProblem } from "../integration/ldap";
import { sysOf } from "../incident/common";
import { CONNECTOR_MESSAGES } from "./kind";
import { addressProblem, editionOf } from "./net";

/** What a person may do with the discovery module (§14.5). */
export interface DiscoveryRights {
  /** CMDB administrator: everything on connectors */
  admin: boolean;
  /** tenant administrator: also the tool's raw JSON in previews */
  tenantAdmin: boolean;
  /** asset write ≥ group: reads connector cards, settles mismatches of assets they may change, switches make_assets */
  assetManager: boolean;
  /** software write ≥ group: switches software collection */
  softwareManager: boolean;
  /** reads the CMDB (connector cards, runs and items of connectors they may read) */
  cmdbRead: boolean;
  /** approves a connector's use of a directory source (§14.8) */
  integrationsAdmin: boolean;
}

const ALL: DiscoveryRights = { admin: true, tenantAdmin: true, assetManager: true, softwareManager: true, cmdbRead: true, integrationsAdmin: true };
const writesGroup = (g: FullGrant) => scopeRank(g.write) >= scopeRank("group");

/** The caller's rights in the module (the system has them all). */
export async function rightsOf(ctx: Ctx, q?: Queryable): Promise<DiscoveryRights> {
  if (isSystemCtx(ctx)) return ALL;
  await orgSchema(ctx, q);
  const tenantByMembership = !ctx.support && (ctx.member.role === "owner" || ctx.member.role === "admin");
  let eff;
  try {
    eff = subjectOf(ctx).eff;
  } catch {
    // another access provider (a test's fake): the membership role's areas decide
    return {
      admin: ctx.can("cmdb" as never, "full"), tenantAdmin: tenantByMembership, assetManager: ctx.can("asset" as never, "edit"), softwareManager: ctx.can("software" as never, "edit"),
      cmdbRead: ctx.can("cmdb" as never, "view"), integrationsAdmin: ctx.can("integrations", "full"),
    };
  }
  const cmdb = grantIn(eff, "cmdb");
  return {
    admin: !!cmdb.admin,
    tenantAdmin: tenantByMembership || eff.roles.includes("tenant_admin"),
    assetManager: writesGroup(grantIn(eff, "asset")),
    softwareManager: writesGroup(grantIn(eff, "software")),
    cmdbRead: cmdb.read !== "none",
    integrationsAdmin: ctx.can("integrations", "full"),
  };
}

/** Fields a connector's owner changes without being a CMDB administrator (§14.5). */
export const OWNER_FIELDS = ["active", "every_minutes", "status_every_minutes", "description"] as const;
/** «ساخت دارایی برای دستگاه‌های تازه»: asset managers only (§11.1). */
export const ASSET_FIELDS = ["make_assets", "make_assets_daily"] as const;
/** Changes that need a recent proof of identity (§14.5), besides the address's host and the automatic missing mark. */
export const REAUTH_FIELDS = ["secret", "secret2", "hosts", "plain_http", "over_manual", "create_policy"] as const;
export const ADMIN_ONLY_MESSAGE = "منبع داده را مدیر پیکربندی می‌سازد و تنظیم می‌کند";
export const OWNER_ONLY_MESSAGE = "مسئول منبع فقط «فعال»، زمان‌بندی و شرح را تغییر می‌دهد؛ دیگر تنظیمات با مدیر پیکربندی است";
export const ASSET_ONLY_MESSAGE = "«ساخت دارایی برای دستگاه‌های تازه» را مدیر دارایی روشن و خاموش می‌کند";
export const SOFTWARE_ONLY_MESSAGE = "گردآوری نرم‌افزارهای نصب‌شده را مدیر دارایی نرم‌افزار روشن می‌کند";
export const SECRETS_CLEARED = "کلید به سبب تغییر نشانی پاک شد";
export const DEMO_PEOPLE_MESSAGE = "کاربران داده‌های نمایشی با منبع‌های داده واقعی کار نمی‌کنند";

const hostOf = (url: unknown): string => {
  try {
    return url ? new URL(String(url)).hostname.toLowerCase().replace(/\.+$/, "") : "";
  } catch {
    return "";
  }
};
const tagsOf = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim().toLowerCase()).filter(Boolean).sort() : []);
const softwareOn = (v: unknown) => Array.isArray(v) && v.includes("software");

/** Did the write move where the credentials go (the address's host or the extra hosts)? */
function hostMoved(w: WriteArgs): boolean {
  if (!w.prev) return false;
  if (w.changed.has("base_url") && hostOf(w.prev.base_url) !== hostOf(w.next.base_url)) return true;
  return w.changed.has("hosts") && JSON.stringify(tagsOf(w.prev.hosts)) !== JSON.stringify(tagsOf(w.next.hosts));
}

/** Checks of what is saved, whoever saves it (§14.1, §14.2). */
function checkSettings(w: WriteArgs): void {
  const edition = editionOf(w.ctx.cfg);
  const set = (f: string) => w.op === "create" || w.changed.has(f);
  if (w.next.plain_http === true && set("plain_http") && edition !== "server") throw bad(CONNECTOR_MESSAGES.plainHttp, { field: "plain_http" });
  if (w.next.base_url && (set("base_url") || set("plain_http"))) {
    const problem = addressProblem(String(w.next.base_url), { plainHttp: w.next.plain_http === true, edition: edition === "desktop" ? "cloud" : edition });
    if (problem) throw bad(problem, { field: "base_url" });
  }
  if (set("hosts")) {
    for (const h of Array.isArray(w.next.hosts) ? w.next.hosts : []) {
      const host = String(h ?? "").trim();
      if (!host) continue;
      if (/[/\s@:?#]/.test(host.replace(/^\[[0-9a-f:.]+\]$/i, "")) || host.length > 253) throw bad(`میزبان «${host.slice(0, 80)}» باید فقط نام یا نشانی میزبان باشد`, { field: "hosts" });
      const problem = addressProblem(`https://${host}/`, { plainHttp: false, edition: "cloud" });
      if (problem) throw bad(problem, { field: "hosts" });
    }
  }
  if (set("ca_cert") && w.next.ca_cert) {
    const problem = caProblem(String(w.next.ca_cert));
    if (problem) throw bad(problem, { field: "ca_cert" });
  }
}

async function beforeWrite(w: WriteArgs): Promise<void> {
  const ctx = w.ctx;
  const system = isSystemCtx(ctx);
  // the Windows app neither runs nor configures connectors (§14.7)
  if (editionOf(ctx.cfg) === "desktop") throw new AppError(403, "desktop", CONNECTOR_MESSAGES.desktop);
  // the demo pack's people change only the pack's connectors (their work is demo work, removed with the pack)
  if (w.prev && !system && demoScopeOrg() === ctx.org.id && !(await isDemoRow(w.tx, ctx.org.id, String(w.prev.id)))) throw forbidden(DEMO_PEOPLE_MESSAGE);
  const rights = await rightsOf(ctx, w.tx);
  if (w.op === "delete" || w.op === "restore") {
    if (!rights.admin) throw forbidden(ADMIN_ONLY_MESSAGE);
    return;
  }
  if (w.op === "create") {
    if (!rights.admin) throw forbidden(ADMIN_ONLY_MESSAGE);
    if (w.next.make_assets === true && !rights.assetManager) throw forbidden(ASSET_ONLY_MESSAGE);
    if (softwareOn(w.next.collect) && !rights.softwareManager) throw forbidden(SOFTWARE_ONLY_MESSAGE);
    checkSettings(w);
    // loosening choices made with the connector need a recent proof of identity too
    if (!system && !w.trusted && (w.next.plain_http === true || w.next.over_manual === true || w.next.missing_action === "auto")) needRecentAuth(ctx);
    return;
  }
  if (w.op !== "update" || !w.prev) return;
  const changed = [...w.changed];
  if (!rights.admin) {
    const may = new Set<string>(OWNER_FIELDS);
    if (rights.assetManager) for (const f of ASSET_FIELDS) may.add(f);
    const refused = changed.filter((f) => !may.has(f) && !(f === "collect" && rights.softwareManager && JSON.stringify(tagsOf(w.prev!.collect).filter((x) => x !== "software")) === JSON.stringify(tagsOf(w.next.collect).filter((x) => x !== "software"))));
    if (refused.length) throw forbidden(OWNER_ONLY_MESSAGE);
  }
  if (ASSET_FIELDS.some((f) => w.changed.has(f)) && !rights.assetManager) throw forbidden(ASSET_ONLY_MESSAGE);
  if (w.changed.has("collect") && softwareOn(w.next.collect) && !softwareOn(w.prev.collect) && !rights.softwareManager) throw forbidden(SOFTWARE_ONLY_MESSAGE);
  checkSettings(w);
  const moved = hostMoved(w);
  const toAuto = w.changed.has("missing_action") && w.next.missing_action === "auto";
  if (!system && !w.trusted && (moved || toAuto || REAUTH_FIELDS.some((f) => w.changed.has(f)))) needRecentAuth(ctx);
  // the credentials never follow the connector to another server unless they are entered again (§5.1, §14.1)
  if (moved) {
    for (const f of ["secret", "secret2"]) if (!w.input?.has(f) && w.prev[f] !== null && w.prev[f] !== undefined) w.next[f] = null;
  }
  // a directory source used by another connector or changed needs its approval again (§14.8)
  if (w.changed.has("directory_source_id") && !w.input?.has("directory_approved_by")) {
    w.next.directory_approved_by = null;
    w.next.directory_approved_at = null;
  }
}

/** Journal lines of the decisions the design asks to keep (§14.6). */
function journalLines(w: WriteArgs & { row: Record<string, any> }): string[] {
  const lines: string[] = [];
  const was = (f: string) => (w.prev ? w.prev[f] : undefined);
  const now = (f: string) => w.row[f];
  const turned = (f: string) => (w.op === "create" ? now(f) === true : w.changed.has(f) && !!now(f) !== !!was(f));
  if (turned("plain_http")) lines.push(now("plain_http") ? "«اتصال بدون رمزنگاری (فقط شبکهٔ داخلی)» روشن شد: کلیدها بی‌رمزنگاری در شبکه می‌روند" : "«اتصال بدون رمزنگاری» خاموش شد");
  if (turned("over_manual")) lines.push(now("over_manual") ? "«معتبرتر از ویرایش دستی» روشن شد: مقدارهای این منبع می‌توانند بر ویرایش دستی پیش بیفتند" : "«معتبرتر از ویرایش دستی» خاموش شد");
  const auto = (v: unknown) => v === "auto";
  if (w.op === "create" ? auto(now("missing_action")) : w.changed.has("missing_action") && auto(now("missing_action")) !== auto(was("missing_action"))) {
    lines.push(auto(now("missing_action")) ? "علامت «مفقود» خودکار روشن شد: دارایی در حال استفاده‌ای که با هیچ ابزاری تماس ندارد خودکار «مفقود» می‌شود" : "علامت «مفقود» خودکار خاموش شد: برای دارایی بی‌تماس کار پیگیری ساخته می‌شود");
  }
  if (w.op === "update" && hostMoved(w) && ["secret", "secret2"].some((f) => was(f) !== null && was(f) !== undefined && (now(f) === null || now(f) === undefined))) lines.push(SECRETS_CLEARED);
  return lines;
}

async function afterWrite(w: WriteArgs & { row: Record<string, any> }): Promise<void> {
  const org = w.ctx.org.id;
  if (w.op === "delete") {
    // soft delete (§5.1): the source stops counting as active, the items stay (gone), running passes stop, nothing retires
    if (w.row.source_id) {
      const live = await w.tx.one(`select id from sm_cmdb_sources where org_id = $1 and id = $2 and deleted_at is null and active`, [org, w.row.source_id]);
      if (live) await updateIn(w.tx, sysOf(w.ctx), "cmdb_data_source", String(w.row.source_id), { active: false }, { trusted: true });
    }
    await w.tx.query(`update sm_discovery_items set state = 'gone', updated_at = now() where org_id = $1 and connector_id = $2 and deleted_at is null and (state is null or state <> 'gone')`, [org, w.row.id]);
    await w.tx.query(`update sm_discovery_runs set state = 'canceled', finished_at = now(), lease_by = null, lease_until = null, updated_at = now() where org_id = $1 and connector_id = $2 and state = 'running'`, [org, w.row.id]);
    return;
  }
  if (w.op === "restore" && w.row.source_id && w.row.active !== false) {
    const off = await w.tx.one(`select id from sm_cmdb_sources where org_id = $1 and id = $2 and deleted_at is null and not active`, [org, w.row.source_id]);
    if (off) await updateIn(w.tx, sysOf(w.ctx), "cmdb_data_source", String(w.row.source_id), { active: true }, { trusted: true });
  }
  if (w.op !== "create" && w.op !== "update") return;
  const lines = journalLines(w);
  if (lines.length) await addJournalIn(w.tx, w.ctx, w.def, w.row, { kind: "system", visibility: "internal", body: lines.join("\n") }, { trusted: true });
}

let installed = false;

/** The connector guard (once per process, from installDiscoveryModule; before the configuration hook, so a refused write makes nothing). */
export function installConnectorGuard(): void {
  if (installed) return;
  installed = true;
  registerHooks("discovery_connector", { beforeWrite, afterWrite });
}
