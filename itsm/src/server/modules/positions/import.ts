// Holders from a spreadsheet of HR posts (design F §11 q2: «نقش‌های سازمانی» kept by hand, by spreadsheet import and from
// Active Directory, all three). The file is an import set's («مجموعهٔ ورود داده», `import_set` with target table
// `position_holder`): its newest attached CSV/XLSX, its columns through the set's transform map when it has one
// (targets: position_id, user_id, org_unit_id, kind, valid_from, valid_to), else by their usual Persian or English
// headers (a column of unique keys first: an e-mail before a name, a unit's code before its name). The UI may also send
// rows it has already read. Each row names a position (key, or a name only one position carries), a person (e-mail or a
// unique name), a unit (code, or a name only one active unit carries: a shared name is a row error, never a guess), a
// kind and dates (ISO or Jalali). A file longer than the limit is refused whole, never cut.
//   · merge (default): a new position-person-unit becomes a holder kept by the import (`source` import, `source_ref` =
//     the import set); one the import keeps gets the file's kind and dates; rows a person keeps by hand or the directory
//     keeps are left alone (and listed);
//   · replace (an import set only): the holders this import set keeps that the file no longer lists are removed — never
//     a manual or a directory holder, and nothing at all while a row has an error (its holder would look «gone»).
// Writes go through the engine as the person who imports, so their `org` write decides (field and row access, the
// holder hooks); a dry run checks everything and rolls back. Audited as «position_import».
import type { Ctx } from "../../context";
import { pgArray } from "../../db";
import { readSpreadsheet } from "@shared/sheet";
import { applySpec, specProblem, type MapRule, type TransformSpec } from "@shared/admin/mapping";
import { normalizeSearch } from "@shared/model/conditions";
import { HOLDER_KINDS } from "@shared/tables/positions";
import { grantIn } from "@shared/access";
import { faDigits } from "@shared/format";
import { unitFinder } from "@shared/integration/directory";
import { bad, forbidden, notFound } from "../../http/errors";
import { createIn, listAttachments, orgTz, parseDate, readAttachment, removeIn, savepoint, updateIn } from "../../engine";
import { prepareSubject } from "../../access/subject";
import { audit } from "../data/crud";
import { liveRow } from "../incident/common";

export const MAX_HOLDER_ROWS = 5000;

export interface HolderImportInput {
  import_set_id?: string | null;
  rows?: Record<string, unknown>[] | null;
  mode?: "merge" | "replace";
  dry_run?: boolean;
}

export interface HolderImportResult {
  dry_run: boolean;
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  removed: number;
  /** rows left alone: a holder a person keeps by hand or the directory keeps */
  skipped: { row: number; message: string }[];
  errors: { row: number; message: string }[];
}

type Target = "position_id" | "user_id" | "org_unit_id" | "kind" | "valid_from" | "valid_to";
const TARGETS: Target[] = ["position_id", "user_id", "org_unit_id", "kind", "valid_from", "valid_to"];

const norm = (s: unknown) =>
  normalizeSearch(String(s ?? ""))
    .toLowerCase()
    .replace(/[\s_\-.:/\\()[\]{}«»"'،,؛;]+/g, "")
    .trim();

/** Usual headers of an HR file, per target field, in order of preference: unique keys first (a position's key, an
 * e-mail, a unit's code), then names. */
const HEADERS: Record<Target, string[]> = {
  position_id: ["کلید نقش", "position_key", "نقش سازمانی", "نقش", "سمت", "پست", "position", "post", "role"],
  user_id: ["ایمیل", "پست الکترونیک", "رایانامه", "email", "کاربر", "دارنده", "شخص", "نام", "user", "holder", "name"],
  org_unit_id: ["کد واحد", "کد شعبه", "unit_code", "branch_code", "واحد", "واحد سازمانی", "شعبه", "unit", "branch"],
  kind: ["نوع", "نوع تصدی", "kind", "type"],
  valid_from: ["از تاریخ", "از", "تاریخ شروع", "شروع", "valid_from", "from", "start"],
  valid_to: ["تا تاریخ", "تا", "تاریخ پایان", "پایان", "valid_to", "to", "end"],
};

/** The default mapping: each target field from the file's column of its most preferred usual header (whatever the
 * columns' order: «نام» before «ایمیل» still matches people by e-mail). */
function guessSpec(headers: string[]): TransformSpec {
  const rules: MapRule[] = [];
  for (const t of TARGETS) {
    const h = HEADERS[t].map((a) => headers.find((x) => norm(x) === norm(a))).find((x) => x !== undefined);
    if (h) rules.push({ source: h, target: t });
  }
  return { rules };
}

const tooLong = () => bad(`در هر بار حداکثر ${faDigits(MAX_HOLDER_ROWS)} ردیف؛ فایل را چند بخش کنید`);

class DryRun extends Error {}

interface Planned {
  row: number;
  position_id: string;
  user_id: string;
  org_unit_id: string | null;
  kind: string;
  valid_from: string | null;
  valid_to: string | null;
}

/** The import set's newest attached file, as rows of named cells. */
async function setRows(ctx: Ctx, setId: string): Promise<{ rows: Record<string, unknown>[]; spec: TransformSpec | null; headers: string[] }> {
  const set = await liveRow(ctx.db, ctx, "import_set", setId);
  if (!set) throw notFound("مجموعهٔ ورود پیدا نشد");
  if (set.target_table !== "position_holder") throw bad("جدول مقصد این مجموعهٔ ورود «دارندگان نقش‌های سازمانی» نیست");
  if (set.source === "url") throw bad("دارندگان نقش‌ها از فایل پیوست مجموعهٔ ورود خوانده می‌شوند؛ فایل را به آن پیوست کنید");
  const { attachments } = await listAttachments(ctx, "import_set", setId);
  const file = [...attachments].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  if (!file) throw bad("نخست فایل CSV یا اکسل دارندگان را به این مجموعه پیوست کنید");
  const { data } = await readAttachment(ctx, file.id);
  // one row past the limit is read so that a longer file is refused, not cut (the header is a row too)
  const sheet = await readSpreadsheet(file.name, data, { maxRows: MAX_HOLDER_ROWS + 2 });
  if (sheet.rows.length > MAX_HOLDER_ROWS + 1) throw tooLong();
  const [head = [], ...rest] = sheet.rows;
  const headers = head.map((h, i) => String(h ?? "").trim() || `ستون ${i + 1}`);
  const rows = rest.filter((r) => r.some((c) => String(c ?? "").trim() !== "")).map((r) => Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? "")])));
  let spec: TransformSpec | null = null;
  if (set.transform_map_id) {
    const map = await liveRow(ctx.db, ctx, "transform_map", set.transform_map_id);
    if (!map || map.active === false) throw bad("نقشهٔ تبدیل این مجموعه پیدا نشد یا غیرفعال است");
    if (map.target_table !== "position_holder") throw bad("جدول مقصد نقشهٔ تبدیل «دارندگان نقش‌های سازمانی» نیست");
    spec = { rules: (Array.isArray(map.rules) ? map.rules : []) as MapRule[] };
  }
  return { rows, spec, headers };
}

/** Import holders (see the header). */
export async function importHolders(ctx: Ctx, input: HolderImportInput): Promise<HolderImportResult> {
  if (ctx.actor !== "user") throw forbidden("دارندگان نقش‌های سازمانی را عضو سازمان وارد می‌کند");
  // holders are placed where the person's `org` write reaches (unit, unit tree, domain or all; each row is checked again)
  const org = grantIn((await prepareSubject(ctx)).subject.eff, "org");
  if (!org.create || !["unit", "unit_tree", "domain", "all"].includes(org.write)) throw forbidden("نگه‌داری دارندگان نقش‌های سازمانی با کسانی است که ساختار سازمانی را تغییر می‌دهند");
  const setId = input.import_set_id ? String(input.import_set_id).toLowerCase() : null;
  const mode = input.mode === "replace" ? "replace" : "merge";
  if (mode === "replace" && !setId) throw bad("جایگزینی فقط با یک مجموعهٔ ورود ممکن است: دارندگانی که همان مجموعه وارد کرده بود و در فایل نیستند برداشته می‌شوند");
  let raw: Record<string, unknown>[];
  let spec: TransformSpec;
  if (setId) {
    const read = await setRows(ctx, setId);
    raw = read.rows;
    spec = read.spec ?? guessSpec(read.headers);
    const problem = specProblem(spec, new Set(TARGETS), read.headers);
    if (problem) throw bad(problem);
  } else {
    raw = Array.isArray(input.rows) ? input.rows : [];
    spec = guessSpec([...new Set(raw.flatMap((r) => Object.keys(r ?? {})))]);
  }
  if (raw.length > MAX_HOLDER_ROWS) throw tooLong();
  const targets = new Set(spec.rules.map((r) => r.target));
  for (const t of ["position_id", "user_id"] as const) if (!targets.has(t)) throw bad(t === "position_id" ? "ستون نقش سازمانی در فایل پیدا نشد" : "ستون ایمیل یا نام دارنده در فایل پیدا نشد");

  const orgId = ctx.org.id;
  const tz = orgTz(ctx);
  const positions = await ctx.db.query<{ id: string; key: string; name: string; active: boolean }>(`select id, key, name, active from sm_positions where org_id = $1 and deleted_at is null`, [orgId]);
  const members = await ctx.db.query<{ user_id: string; email: string; name: string }>(
    `select m.user_id, lower(u.email) as email, coalesce(nullif(p.name, ''), nullif(u.full_name, ''), '') as name
     from sm_org_members m join sm_users u on u.id = m.user_id
     left join sm_member_profiles p on p.org_id = m.org_id and p.user_id = m.user_id and p.deleted_at is null
     where m.org_id = $1 and m.deleted_at is null`,
    [orgId],
  );
  const units = await ctx.db.query<{ id: string; name: string; code: string | null; active: boolean | null }>(`select id, name, code, active from sm_org_units where org_id = $1 and deleted_at is null`, [orgId]);
  // a position by its key, else by a name only one position carries as this file reads names (punctuation aside)
  const byKey = new Map(positions.map((p) => [p.key.toLowerCase(), p.id]));
  const byPositionName = new Map<string, string[]>();
  for (const p of positions) if (norm(p.name)) byPositionName.set(norm(p.name), [...(byPositionName.get(norm(p.name)) ?? []), p.id]);
  const positionOf = (text: string): { id: string | null; ambiguous: boolean } => {
    const named = byPositionName.get(norm(text)) ?? [];
    const id = byKey.get(text.toLowerCase()) ?? (named.length === 1 ? named[0] : null);
    return { id, ambiguous: !id && named.length > 1 };
  };
  const byEmail = new Map(members.map((m) => [m.email, m.user_id]));
  const nameCount = new Map<string, number>();
  for (const m of members) if (m.name) nameCount.set(norm(m.name), (nameCount.get(norm(m.name)) ?? 0) + 1);
  const byName = new Map(members.filter((m) => m.name && nameCount.get(norm(m.name)) === 1).map((m) => [norm(m.name), m.user_id]));
  const unitOf = unitFinder(units, norm);

  const result: HolderImportResult = { dry_run: input.dry_run !== false, total: raw.length, created: 0, updated: 0, unchanged: 0, removed: 0, skipped: [], errors: [] };
  const planned: Planned[] = [];
  const seen = new Set<string>();
  raw.forEach((r, i) => {
    const row = i + 1;
    const cells = applySpec((r ?? {}) as Record<string, unknown>, spec);
    const error = (message: string) => result.errors.push({ row, message });
    const posText = String(cells.position_id ?? "").trim();
    const found = posText ? positionOf(posText) : { id: null, ambiguous: false };
    if (found.ambiguous) return error(`نام نقش سازمانی «${posText}» یکتا نیست؛ کلید نقش را بنویسید`);
    const position = found.id;
    if (!position) return error(posText ? `نقش سازمانی «${posText}» پیدا نشد` : "نقش سازمانی خالی است");
    const who = String(cells.user_id ?? "").trim();
    const user = byEmail.get(who.toLowerCase()) ?? byName.get(norm(who));
    if (!user) return error(who ? `«${who}» عضو این سازمان نیست (یا نامش یکتا نیست؛ ایمیل را بنویسید)` : "دارنده خالی است");
    const unitText = String(cells.org_unit_id ?? "").trim();
    const placed = unitText ? unitOf(unitText) : { unit: null, ambiguous: false };
    if (placed.ambiguous) return error(`نام واحد «${unitText}» یکتا نیست؛ کد واحد را بنویسید`);
    const unit = placed.unit?.id ?? null;
    if (unitText && !unit) return error(`واحد «${unitText}» پیدا نشد`);
    const kindText = String(cells.kind ?? "").trim();
    const kind = kindText ? HOLDER_KINDS.find((k) => norm(k.value) === norm(kindText) || norm(k.label) === norm(kindText))?.value : "primary";
    if (!kind) return error(`نوع «${kindText}» شناخته نیست (اصلی، سرپرست (کفیل) یا موقت)`);
    const date = (t: Target) => {
      const v = String(cells[t] ?? "").trim();
      if (!v) return { ok: true as const, value: null };
      const d = parseDate(v, tz);
      return d ? { ok: true as const, value: d } : { ok: false as const, value: v };
    };
    const from = date("valid_from");
    const to = date("valid_to");
    if (!from.ok) return error(`تاریخ «${from.value}» خوانده نشد`);
    if (!to.ok) return error(`تاریخ «${to.value}» خوانده نشد`);
    const key = `${position}|${user}|${unit ?? ""}`;
    if (seen.has(key)) return error("همین نقش، شخص و واحد پیش‌تر در فایل آمده است");
    seen.add(key);
    planned.push({ row, position_id: position, user_id: user, org_unit_id: unit, kind, valid_from: from.value, valid_to: to.value });
  });

  const ids = [...new Set(planned.map((p) => p.position_id))];
  const stored = await ctx.db.query<{ id: string; position_id: string; user_id: string; org_unit_id: string | null; kind: string; valid_from: string | null; valid_to: string | null; source: string | null; source_ref: string | null }>(
    `select id, position_id, user_id, org_unit_id, kind, valid_from::text as valid_from, valid_to::text as valid_to, source, source_ref from sm_position_holders
     where org_id = $1 and deleted_at is null and (position_id = any($2::uuid[]) or (source = 'import' and source_ref = $3))`,
    [orgId, pgArray(ids), setId ?? ""],
  );
  const existing = new Map(stored.map((h) => [`${h.position_id}|${h.user_id}|${h.org_unit_id ?? ""}`, h]));
  const ref = setId;
  const kept = new Set<string>();
  const run = async () => {
    await ctx.write(async (tx) => {
      for (const p of planned) {
        const key = `${p.position_id}|${p.user_id}|${p.org_unit_id ?? ""}`;
        const h = existing.get(key);
        if (h) kept.add(h.id);
        if (h && h.source !== "import") {
          result.skipped.push({ row: p.row, message: h.source === "directory" ? "این دارنده را فهرست کاربران (AD) نگه می‌دارد؛ دست نخورد" : "این دارنده دستی ثبت شده است؛ دست نخورد" });
          continue;
        }
        try {
          await savepoint(tx, async () => {
            if (!h) {
              await createIn(tx, ctx, "position_holder", { position_id: p.position_id, user_id: p.user_id, org_unit_id: p.org_unit_id, kind: p.kind, valid_from: p.valid_from, valid_to: p.valid_to, source: "import", source_ref: ref }, { trusted: true, via: "import" });
              result.created++;
              return;
            }
            const patch: Record<string, unknown> = {};
            if (h.kind !== p.kind) patch.kind = p.kind;
            if ((h.valid_from ?? null) !== p.valid_from) patch.valid_from = p.valid_from;
            if ((h.valid_to ?? null) !== p.valid_to) patch.valid_to = p.valid_to;
            if ((h.source_ref ?? null) !== ref) patch.source_ref = ref;
            if (!Object.keys(patch).length) {
              result.unchanged++;
              return;
            }
            await updateIn(tx, ctx, "position_holder", h.id, patch, { trusted: true, via: "import" });
            result.updated++;
          });
        } catch (e) {
          const message = (e as { status?: number; message?: string })?.status ? String((e as Error).message) : null;
          if (!message) throw e;
          result.errors.push({ row: p.row, message });
        }
      }
      // a row with an error says nothing about its holder: replacing then would remove it (and any after a cut)
      if (mode === "replace" && result.errors.length) result.errors.push({ row: 0, message: "چون ردیف‌هایی خطا دارند، دارندگانی که در فایل نیستند برداشته نشدند؛ خطاها را درست کنید و دوباره جایگزین کنید" });
      else if (mode === "replace") {
        for (const h of stored) {
          if (h.source !== "import" || h.source_ref !== setId || kept.has(h.id)) continue;
          try {
            await savepoint(tx, () => removeIn(tx, ctx, "position_holder", h.id, { via: "import" }));
            result.removed++;
          } catch (e) {
            if (!(e as { status?: number })?.status) throw e;
            result.errors.push({ row: 0, message: String((e as Error).message) });
          }
        }
      }
      if (result.dry_run) throw new DryRun();
      await audit(
        tx,
        ctx,
        "position_import",
        setId ? "import_set" : "position_holder",
        setId,
        `ورود دارندگان نقش‌های سازمانی: ${faDigits(result.created)} تازه، ${faDigits(result.updated)} به‌روز، ${faDigits(result.removed)} برداشته، ${faDigits(result.errors.length)} خطا`,
        { created: result.created, updated: result.updated, unchanged: result.unchanged, removed: result.removed, skipped: result.skipped.length, errors: result.errors.length, mode },
      );
    });
  };
  try {
    await run();
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }
  return result;
}
