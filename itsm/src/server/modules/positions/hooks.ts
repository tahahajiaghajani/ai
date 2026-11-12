// Integrity of organisational roles and their holders (design F §3.4) on every path: the API, imports, Windows pushes
// (`validatePush`, `derivePush`: a push runs no `beforeWrite`) and the system's own writes.
//   · position: a Latin key that never changes once made (published workflow versions name the position by it), a
//     name of its own, a «reports to» that never loops back; a position is not deleted while people hold it or other
//     positions report to it (deactivate it instead); its unit kind does not change under its holders.
//   · position_holder: a live, active position; the unit of the position's kind when it names one (a unit is then
//     required); «از» never after «تا»; one row per position, person and unit (the database index cannot see an empty
//     unit, so the hook checks); provenance is the server's: a person's row is «دستی», an import marks its own,
//     and the directory's (and an import's) rows keep their position, person and unit — they are ended or removed
//     instead, so the directory or the file keeps what it said.
import { faDigits } from "@shared/format";
import { POSITION_KEY } from "@shared/tables/positions";
import { UNIT_KINDS } from "@shared/tables/access";
import { normalizeSearch } from "@shared/model/conditions";
import { bad } from "../../http/errors";
import { isSystemCtx, pushGuard, registerHooks, type PushArgs, type WriteArgs } from "../../engine";
import type { Queryable } from "../../db";

type Row = Record<string, unknown>;

const kindLabel = (k: unknown) => UNIT_KINDS.find((o) => o.value === k)?.label ?? String(k ?? "");
const norm = (s: unknown) => normalizeSearch(String(s ?? "")).toLowerCase().replace(/\s+/g, " ").trim();
const idOf = (v: unknown): string | null => (typeof v === "string" && v ? v.toLowerCase() : null);

// ---------------------------------------------------------------------------------------------------------------
// position

async function positionGuard(w: WriteArgs): Promise<void> {
  const { tx, ctx } = w;
  const org = ctx.org.id;
  if (w.op === "delete") {
    const id = String(w.prev?.id ?? "");
    const held = await tx.one<{ n: number }>(`select count(*)::int as n from sm_position_holders where org_id = $1 and position_id = $2 and deleted_at is null`, [org, id]);
    if (held && held.n > 0) throw bad(`«${w.prev?.name ?? ""}» ${faDigits(held.n)} دارنده دارد؛ نخست دارندگان آن را بردارید یا نقش را غیرفعال کنید`);
    const below = await tx.query<{ name: string }>(`select name from sm_positions where org_id = $1 and reports_to = $2 and deleted_at is null order by name limit 3`, [org, id]);
    if (below.length) throw bad(`${below.map((r) => `«${r.name}»`).join("، ")} به این نقش گزارش می‌دهند؛ نخست «گزارش به» آن‌ها را تغییر دهید`);
    return;
  }
  if (w.op !== "create" && w.op !== "update") return;
  const n = w.next;
  if (w.op === "update" && w.changed.has("key")) throw bad("کلید نقش سازمانی پس از ساخت تغییر نمی‌کند؛ گردش‌کارها با آن به این نقش اشاره می‌کنند");
  if (w.op === "create") {
    n.key = String(n.key ?? "").trim();
    if (!POSITION_KEY.test(String(n.key))) throw bad("کلید نقش سازمانی با حرف لاتین کوچک شروع می‌شود و فقط حرف لاتین کوچک، رقم و _ دارد (مانند branch_head)");
  }
  if (w.op === "create" || w.changed.has("name")) {
    const name = String(n.name ?? "").trim();
    const same = await tx.query<{ id: string; name: string }>(`select id, name from sm_positions where org_id = $1 and deleted_at is null and id <> $2`, [org, n.id ?? "00000000-0000-0000-0000-000000000000"]);
    if (same.some((r) => norm(r.name) === norm(name))) throw bad(`نقش سازمانی «${name}» هست؛ نام دیگری برگزینید`);
  }
  if (w.op === "create" || w.changed.has("reports_to")) {
    let at = idOf(n.reports_to);
    const self = idOf(n.id);
    for (let hops = 0; at && hops < 60; hops++) {
      if (at === self) throw bad("«گزارش به» دور می‌سازد: این نقش در زنجیرهٔ بالادست خودش است");
      const up = await tx.one<{ reports_to: string | null }>(`select reports_to from sm_positions where org_id = $1 and id = $2 and deleted_at is null`, [org, at]);
      if (!up) break;
      at = idOf(up.reports_to);
    }
  }
  if (w.op === "update" && w.changed.has("unit_kind") && n.unit_kind) {
    const other = await tx.one<{ n: number }>(
      `select count(*)::int as n from sm_position_holders h join sm_org_units u on u.id = h.org_unit_id and u.org_id = h.org_id
       where h.org_id = $1 and h.position_id = $2 and h.deleted_at is null and u.kind is distinct from $3`,
      [org, n.id, n.unit_kind],
    );
    const loose = await tx.one<{ n: number }>(`select count(*)::int as n from sm_position_holders where org_id = $1 and position_id = $2 and deleted_at is null and org_unit_id is null`, [org, n.id]);
    const count = (other?.n ?? 0) + (loose?.n ?? 0);
    if (count) throw bad(`${faDigits(count)} دارندهٔ این نقش در واحدی از نوع «${kindLabel(n.unit_kind)}» نیستند؛ نخست واحد آن‌ها را درست کنید`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// position_holder

interface PositionRow {
  id: string;
  name: string;
  unit_kind: string | null;
  active: boolean;
}

async function positionOf(q: Queryable, orgId: string, id: unknown): Promise<PositionRow | null> {
  const pid = idOf(id);
  if (!pid) return null;
  return q.one<PositionRow>(`select id, name, unit_kind, active from sm_positions where org_id = $1 and id = $2 and deleted_at is null`, [orgId, pid]);
}

const FIXED = ["position_id", "user_id", "org_unit_id"];

/** The checks of a holder row (no change to it): the API's `beforeWrite` and a Windows push alike. */
async function holderGuard(w: WriteArgs): Promise<void> {
  if (w.op !== "create" && w.op !== "update") return;
  const { tx, ctx, next: n, prev: p } = w;
  const org = ctx.org.id;
  const machine = isSystemCtx(ctx) || !!w.trusted;
  if (w.op === "update" && !machine && p && p.source && p.source !== "manual" && FIXED.some((f) => w.changed.has(f))) {
    throw bad(
      p.source === "directory"
        ? "این دارنده را فهرست کاربران (AD) نگه می‌دارد؛ نقش، شخص یا واحد آن را در AD تغییر دهید، یا آن را پایان دهید یا بردارید"
        : "این دارنده از ورود فایل آمده است؛ نقش، شخص یا واحد آن را در فایل تغییر دهید و دوباره وارد کنید، یا آن را پایان دهید یا بردارید",
    );
  }
  const placed = w.op === "create" || FIXED.some((f) => w.changed.has(f));
  if (placed) {
    const pos = await positionOf(tx, org, n.position_id);
    if (!pos) throw bad("نقش سازمانی پیدا نشد");
    if (pos.active === false) throw bad(`نقش سازمانی «${pos.name}» غیرفعال است؛ نخست آن را فعال کنید`);
    const unitId = idOf(n.org_unit_id);
    if (pos.unit_kind) {
      if (!unitId) throw bad(`«${pos.name}» در واحدهای نوع «${kindLabel(pos.unit_kind)}» است؛ واحد را انتخاب کنید`);
      const u = await tx.one<{ name: string; kind: string | null }>(`select name, kind from sm_org_units where org_id = $1 and id = $2 and deleted_at is null`, [org, unitId]);
      if (u && u.kind !== pos.unit_kind) throw bad(`«${u.name}» از نوع «${kindLabel(u.kind)}» است؛ «${pos.name}» در واحدهای نوع «${kindLabel(pos.unit_kind)}» است`);
    }
    const user = idOf(n.user_id);
    const twin = await tx.one<{ id: string }>(
      `select id from sm_position_holders where org_id = $1 and position_id = $2 and user_id = $3 and org_unit_id is not distinct from $4 and deleted_at is null and id <> $5 limit 1`,
      [org, pos.id, user, unitId, n.id ?? "00000000-0000-0000-0000-000000000000"],
    );
    if (twin) {
      const who = await tx.one<{ name: string }>(`select coalesce(nullif(full_name, ''), email) as name from sm_users where id = $1`, [user]);
      const where = unitId ? await tx.one<{ name: string }>(`select name from sm_org_units where id = $1`, [unitId]) : null;
      throw bad(`«${who?.name ?? ""}» همین حالا «${pos.name}»${where ? ` در «${where.name}»` : ""} است`);
    }
  }
  if ((w.op === "create" || w.changed.has("valid_from") || w.changed.has("valid_to")) && n.valid_from && n.valid_to && String(n.valid_from).slice(0, 10) > String(n.valid_to).slice(0, 10)) {
    throw bad("«تا تاریخ» نباید پیش از «از تاریخ» باشد");
  }
}

/** A person's new row is «دستی»; an import (the generic import of a spreadsheet) marks its own. */
async function holderBefore(w: WriteArgs): Promise<void> {
  if (w.op === "create" && !isSystemCtx(w.ctx) && !w.trusted) {
    w.next.source = w.via === "import" ? "import" : "manual";
    w.next.source_ref = null;
  }
  await holderGuard(w);
}

/** A pushed holder: provenance is the cloud's (a new row is «دستی»; a stored row keeps its source). */
function holderDerivePush(p: PushArgs): Row {
  return p.prev ? { source: p.prev.source ?? "manual", source_ref: p.prev.source_ref ?? null } : { source: "manual", source_ref: null };
}

let installed = false;
export function installPositionHooks(): void {
  if (installed) return;
  installed = true;
  registerHooks("position", {
    beforeWrite: positionGuard,
    validatePush: pushGuard(positionGuard),
    validatePushDelete: async (p) => {
      try {
        await positionGuard({ tx: p.tx, ctx: p.ctx, def: p.def, op: "delete", next: p.next, prev: p.next, changed: new Set(["deleted_at"]), env: p.env, via: "sync", trusted: false });
        return null;
      } catch (e) {
        const status = (e as { status?: unknown })?.status;
        if (typeof status === "number" && status >= 400 && status < 500) return String((e as Error).message);
        throw e;
      }
    },
  });
  registerHooks("position_holder", { beforeWrite: holderBefore, derivePush: holderDerivePush, validatePush: pushGuard(holderGuard) });
}
