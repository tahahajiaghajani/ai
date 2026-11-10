// «چرا می‌بیند؟ چرا نمی‌بیند؟» (catalogue ACC-089, ADM-030): the plain-Persian explanation of an access decision, built
// from the access checker's layers — the AI skill «admin.access_explain» narrates the same facts and falls back to
// this text when no model answers. Pure; never more than the checker said (the checker explains only records its
// caller may read). Imported by the UI: keep it free of server imports.
import type { ExplainLayer, FullGrant, Scope } from "../access";
import { SCOPE_LABELS } from "../access";
import { FIELD_GROUPS, type FieldGroup } from "../model/types";
import { APP_NAME } from "../constants";

export interface ExplainInput {
  user: { name: string };
  table: { label: string; plural: string };
  grant: Pick<FullGrant, "read" | "write" | "delete" | "create">;
  /** role names (or keys) in effect */
  roles: string[];
  legacy: boolean;
  hidden_fields: { label: string; group: FieldGroup | string }[];
  participant_only?: boolean;
  record?: {
    label: string;
    explanation: { read: boolean; write: "full" | "requester" | null; delete: boolean; via: string | null; layers: ExplainLayer[] };
    writable_fields?: string[] | null;
  };
}

const scope = (s: Scope | string) => SCOPE_LABELS[s as Scope] ?? s;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join("، ")} و ${xs[xs.length - 1]}`);

const VIA: Record<string, string> = {
  system: "سامانه به همه چیز دسترسی دارد",
  public: "این جدول دادهٔ مرجع است و همه آن را می‌بینند",
  own: "رکورد مال خود اوست (درخواست‌کننده، ثبت‌کننده یا کارشناس آن است)",
  participant: "در رکورد نقشی دارد (تأییدکننده، مالک خدمت یا مشارکت‌کننده)",
  scope: "دامنهٔ نقش‌هایش این رکورد را در بر می‌گیرد",
  requester_side: "رکورد مال کسی است که او مدیرش است یا در واحد او کار می‌کند",
};

/** The explanation in a few short Persian paragraphs (lines separated by \n). */
export function explainAccessText(x: ExplainInput): string {
  const who = `«${x.user.name}»`;
  const lines: string[] = [];
  const roles = x.legacy ? `دسترسی پیشین عضویت (بدون نقش در ${APP_NAME})` : x.roles.length ? `نقش‌های ${list(x.roles.map((r) => `«${r}»`))}` : "هیچ نقشی";
  if (x.record) {
    const e = x.record.explanation;
    const rec = `«${x.record.label}»`;
    if (e.read) {
      lines.push(`${who} رکورد ${rec} را می‌بیند، چون ${VIA[e.via ?? ""] ?? "قاعده‌های دسترسی اجازه می‌دهند"}.`);
    } else {
      const failed = e.layers.find((l) => l.ok === false);
      lines.push(`${who} رکورد ${rec} را نمی‌بیند${failed ? `: ${failed.detail}` : "."}`);
      const more = e.layers.filter((l) => l.ok === false && l !== failed);
      if (more.length) lines.push(`همچنین: ${more.map((l) => l.detail).join("؛ ")}.`);
    }
    if (e.read) {
      if (e.write === "full") lines.push(`می‌تواند آن را تغییر دهد${e.delete ? " و حذف کند" : ""}.`);
      else if (e.write === "requester") lines.push(`فقط بخش‌هایی را که درخواست‌کننده اجازه دارد تغییر می‌دهد${x.record.writable_fields?.length ? ` (${x.record.writable_fields.length.toLocaleString("fa-IR")} فیلد)` : ""}.`);
      else lines.push("نمی‌تواند آن را تغییر دهد.");
    }
    lines.push(`او با ${roles} کار می‌کند.`);
  } else {
    if (x.grant.read === "none") {
      lines.push(
        x.participant_only
          ? `${who} «${x.table.plural}» را فقط وقتی می‌بیند که در رکوردی نقشی دارد (مثلاً تأییدکننده است).`
          : `${who} به «${x.table.plural}» دسترسی ندارد: هیچ‌یک از ${roles} در این بخش اجازهٔ مشاهده نمی‌دهد.`,
      );
    } else {
      lines.push(`${who} از «${x.table.plural}» آنچه در دامنهٔ «${scope(x.grant.read)}» است می‌بیند (با ${roles}).`);
      const ops: string[] = [];
      if (x.grant.create) ops.push("ثبت تازه");
      if (x.grant.write !== "none") ops.push(`تغییر در دامنهٔ «${scope(x.grant.write)}»`);
      if (x.grant.delete !== "none") ops.push(`حذف در دامنهٔ «${scope(x.grant.delete)}»`);
      lines.push(ops.length ? `می‌تواند: ${list(ops)}.` : "فقط می‌خواند و تغییری نمی‌دهد.");
    }
  }
  if (x.hidden_fields.length) {
    const groups = [...new Set(x.hidden_fields.map((f) => FIELD_GROUPS[f.group as FieldGroup] ?? f.group))];
    lines.push(`فیلدهای ${list(x.hidden_fields.slice(0, 6).map((f) => `«${f.label}»`))}${x.hidden_fields.length > 6 ? " و چند فیلد دیگر" : ""} برای او پنهان است (گروه ${list(groups.map((g) => `«${g}»`))}).`);
  }
  return lines.join("\n");
}
