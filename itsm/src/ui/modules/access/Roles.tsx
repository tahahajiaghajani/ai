// «نقش‌ها و مجوزها»: the organisation's role catalogue — the built-in roles (changed ones marked, with their difference
// from the default and «بازگشت به پیش‌فرض») and its own roles — and the permission-matrix editor: areas × operations
// with scope drop-downs, field groups, contained roles, workspace and domain reach. Also the organisation's access
// settings: the service-desk preset and domain separation. Every rule here is a grant; restrictions (secure
// workspaces, restricted groups, confidential rows) are set on workspaces, groups and records.
import { useEffect, useMemo, useState } from "react";
import { Button, Checkbox, Drawer, Input, Popconfirm, Segmented, Select, Switch, Tooltip } from "antd";
import { Plus, RotateCcw, ShieldCheck, Trash2, Users } from "lucide-react";
import {
  areas, AREA_GROUPS, builtinRoles, diffRole, fullGrant, OP_LABELS, PERSONAS, ROLE_KEY, SCOPE_LABELS, SCOPED_OPS, FLAG_OPS,
  DESK_PRESETS, compactGrant, type DeskPreset, type FullGrant, type Grant, type RoleChange, type RoleDef, type Scope,
} from "@shared/access";
import { FIELD_GROUPS, type FieldGroup } from "@shared/model/types";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader, Section } from "../../components/layout";
import { Chip, EmptyState, Loader } from "../../components/display";
import { ICON, ICON14, Note, cx } from "../../components/blocks";
import { KEYS, useAccessAdmin, useMyAccess, useRoles, type RoleView } from "./api";
import { RoleSelect, scopeOptions } from "./parts";

const EMPTY_ROLE: RoleDef = { key: "", name: "", description: "", persona: "agent", grants: {}, field_groups: [], contains: [], workspaces: "member", domains: "own", active: true };

export default function Roles() {
  const roles = useRoles();
  const me = useMyAccess();
  const { admin } = useAccessAdmin();
  const [open, setOpen] = useState<RoleView | "new" | null>(null);
  const list = roles.data?.roles ?? [];
  const builtin = list.filter((r) => r.builtin);
  const custom = list.filter((r) => !r.builtin);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="نقش‌ها و مجوزها"
        actions={
          admin ? (
            <Button type="primary" icon={<Plus {...ICON} />} onClick={() => setOpen("new")}>
              نقش تازه
            </Button>
          ) : null
        }
      />
      {me.data ? <AccessSettings admin={admin} preset={me.data.settings.preset} separation={me.data.settings.domain_separation} /> : null}
      {roles.isLoading ? (
        <Loader />
      ) : (
        <>
          <Section title="نقش‌های پیش‌فرض">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {builtin.map((r) => (
                <RoleCard key={r.key} role={r} onOpen={() => setOpen(r)} />
              ))}
            </div>
          </Section>
          <Section title="نقش‌های سازمان">
            {custom.length ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {custom.map((r) => (
                  <RoleCard key={r.key} role={r} onOpen={() => setOpen(r)} />
                ))}
              </div>
            ) : (
              <EmptyState compact icon={ShieldCheck} title="هنوز نقشی ساخته نشده است" action={admin ? <Button onClick={() => setOpen("new")}>نقش تازه</Button> : undefined} />
            )}
          </Section>
        </>
      )}
      <RoleEditor open={open} onClose={() => setOpen(null)} admin={admin} preset={roles.data?.preset ?? "open"} all={list} />
    </div>
  );
}

function RoleCard({ role, onOpen }: { role: RoleView; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx("flex min-w-0 flex-col items-start gap-2 rounded-lg border border-line bg-surface p-4 text-start transition-colors hover:bg-[var(--ds-hover)]", role.active === false && "opacity-70")}
    >
      <span className="flex w-full items-center gap-2">
        <span className="ds-t-title truncate text-ink">{role.name}</span>
        <span className="ms-auto inline-flex items-center gap-1 text-[12px] text-ink-3">
          <Users {...ICON14} aria-hidden />
          <span className="ds-num">{faDigits(role.holders)}</span>
        </span>
      </span>
      <span className="flex flex-wrap gap-1.5">
        <Chip dot={false}>{PERSONAS[role.persona] ?? role.persona}</Chip>
        {role.modified ? <Chip tone="warning">تغییریافته</Chip> : null}
        {role.active === false ? <Chip dot={false}>غیرفعال</Chip> : null}
        <span className="ds-ltr text-[12px] text-ink-3">{role.key}</span>
      </span>
      {role.description ? <span className="line-clamp-2 text-[13px] leading-5 text-ink-2">{role.description}</span> : null}
    </button>
  );
}

function AccessSettings({ admin, preset, separation }: { admin: boolean; preset: DeskPreset; separation: boolean }) {
  const { api } = useOrg();
  const save = useAction((v: { preset?: DeskPreset; domain_separation?: boolean }) => api.put("/access/settings", v), {
    success: "تنظیمات دسترسی ذخیره شد.",
    invalidate: [KEYS.me, KEYS.roles, KEYS.members, ["org"]],
  });
  return (
    <Section title="تنظیمات دسترسی">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-8">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[13px] text-ink-2">دید کارشناسان</span>
          <Segmented<DeskPreset>
            value={preset}
            disabled={!admin || save.isPending}
            onChange={(v) => save.mutate({ preset: v })}
            options={(Object.keys(DESK_PRESETS) as DeskPreset[]).map((k) => ({ value: k, label: DESK_PRESETS[k].label }))}
          />
          <span className="text-[12px] leading-5 text-ink-3">{DESK_PRESETS[preset].about}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] text-ink-2">جداسازی دامنه‌ها</span>
          <Switch checked={separation} disabled={!admin || save.isPending} onChange={(v) => save.mutate({ domain_separation: v })} />
        </div>
      </div>
    </Section>
  );
}

/** A role being edited: its grants spelled out per area (the "*" row covers every area not listed). */
interface Draft extends RoleDef {
  version?: number | null;
}

function RoleEditor({ open, onClose, admin, preset, all }: { open: RoleView | "new" | null; onClose: () => void; admin: boolean; preset: DeskPreset; all: RoleView[] }) {
  const { api } = useOrg();
  const isNew = open === "new";
  const source = open && open !== "new" ? open : null;
  const [draft, setDraft] = useState<Draft>(EMPTY_ROLE);
  useEffect(() => {
    setDraft(source ? { ...source, grants: { ...source.grants } } : { ...EMPTY_ROLE });
  }, [source?.key, source?.version, open]); // eslint-disable-line react-hooks/exhaustive-deps
  const base = useMemo(() => (source?.builtin ? builtinRoles(preset).find((r) => r.key === source.key) ?? null : null), [source, preset]);
  const changes = useMemo(() => (base ? diffRole(base, draft) : []), [base, draft]);
  const changed = (area: string, op: string) => changes.some((c) => c.what === "grant" && c.area === area && c.op === op);
  const keyProblem = isNew && draft.key && !ROLE_KEY.test(draft.key) ? "حروف لاتین کوچک، رقم و _ (دست‌کم دو نویسه)" : null;

  const save = useAction(
    () =>
      api.put(`/access/roles/${draft.key}`, {
        name: draft.name,
        description: draft.description ?? null,
        persona: draft.persona,
        grants: draft.grants,
        field_groups: draft.field_groups,
        contains: draft.contains,
        workspaces: draft.workspaces,
        domains: draft.domains,
        active: draft.active !== false,
        version: draft.version ?? null,
      }),
    { success: "نقش ذخیره شد.", invalidate: [KEYS.roles, KEYS.me, KEYS.members], onSuccess: onClose },
  );
  const reset = useAction(() => api.post(`/access/roles/${draft.key}/reset`), { success: "نقش به پیش‌فرض برگشت.", invalidate: [KEYS.roles, KEYS.me, KEYS.members], onSuccess: onClose });
  const remove = useAction(() => api.del(`/access/roles/${draft.key}`), { success: "نقش حذف شد.", invalidate: [KEYS.roles, KEYS.me], onSuccess: onClose });

  const grantOf = (area: string): FullGrant => fullGrant(draft.grants[area]);
  const setGrant = (area: string, patch: Partial<FullGrant>) => {
    const next = compactGrant({ ...grantOf(area), ...patch });
    const grants = { ...draft.grants };
    if (Object.keys(next).length) grants[area] = next as Grant;
    else delete grants[area];
    setDraft({ ...draft, grants });
  };
  const rows = [{ key: "*", label: "همهٔ حوزه‌های دیگر", group: "" }, ...areas().map((a) => ({ key: a.key, label: a.label, group: a.group }))];
  let lastGroup: string | null = null;
  const ro = !admin;

  return (
    <Drawer open={!!open} onClose={onClose} size={980} destroyOnHidden title={isNew ? "نقش تازه" : source?.name ?? "نقش"}>
      <div className="flex flex-col gap-5">
        {source?.builtin ? (
          <Note action={source.modified && admin ? (
            <Popconfirm title="این نقش به پیش‌فرض برگردد؟" okText="بازگشت" cancelText="انصراف" onConfirm={() => reset.mutate()}>
              <Button size="small" icon={<RotateCcw {...ICON14} />}>بازگشت به پیش‌فرض</Button>
            </Popconfirm>
          ) : undefined}>
            {source.modified ? "سازمان این نقش پیش‌فرض را تغییر داده است." : "نقش پیش‌فرض؛ تغییر آن نسخهٔ سازمان را می‌سازد."}
          </Note>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[13px] text-ink-2">نام</span>
            <Input value={draft.name} disabled={ro} maxLength={120} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[13px] text-ink-2">کلید</span>
            <Input value={draft.key} disabled={!isNew || ro} dir="ltr" maxLength={41} status={keyProblem ? "error" : undefined} onChange={(e) => setDraft({ ...draft, key: e.target.value.trim() })} placeholder="night_shift" />
            {keyProblem ? <span className="text-[12px] text-danger">{keyProblem}</span> : null}
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[13px] text-ink-2">شرح</span>
            <Input.TextArea value={draft.description ?? ""} disabled={ro} autoSize={{ minRows: 1, maxRows: 4 }} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[13px] text-ink-2">پرسونا</span>
            <Select value={draft.persona} disabled={ro} onChange={(v) => setDraft({ ...draft, persona: v })} options={Object.entries(PERSONAS).map(([value, label]) => ({ value, label }))} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[13px] text-ink-2">نقش‌های دربرگرفته</span>
            <RoleSelect value={draft.contains} onChange={(v) => !ro && setDraft({ ...draft, contains: v })} exclude={[draft.key]} placeholder="بدون نقش دربرگرفته" />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-[13px] text-ink-2">فضاهای کاری</span>
            <Segmented<"member" | "all"> value={draft.workspaces} disabled={ro} onChange={(v) => setDraft({ ...draft, workspaces: v })} options={[{ value: "member", label: "فضاهای عضو" }, { value: "all", label: "همهٔ فضاها (جز امن)" }]} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[13px] text-ink-2">دامنه‌ها</span>
            <Segmented<"own" | "all"> value={draft.domains} disabled={ro} onChange={(v) => setDraft({ ...draft, domains: v })} options={[{ value: "own", label: "دامنهٔ خود" }, { value: "all", label: "همهٔ دامنه‌ها" }]} />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-[13px] text-ink-2">گروه‌های فیلد</span>
          <Checkbox.Group
            disabled={ro}
            value={draft.field_groups}
            onChange={(v) => setDraft({ ...draft, field_groups: v as FieldGroup[] })}
            options={(Object.keys(FIELD_GROUPS) as FieldGroup[]).map((g) => ({ value: g, label: FIELD_GROUPS[g] }))}
          />
        </div>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[720px] text-[13px]" aria-label="ماتریس مجوزها">
            <thead className="bg-sunken text-ink-2">
              <tr>
                <th className="px-3 py-2 text-start font-medium">حوزه</th>
                {(["read", "create", "write", "delete", "approve", "admin"] as const).map((op) => (
                  <th key={op} className="px-2 py-2 text-center font-medium">
                    {OP_LABELS[op]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const g = grantOf(a.key);
                const head = a.group && a.group !== lastGroup;
                if (a.group) lastGroup = a.group;
                return [
                  head ? (
                    <tr key={`h-${a.group}`}>
                      <td colSpan={7} className="bg-canvas px-3 pt-3 pb-1 text-[12px] text-ink-3">
                        {AREA_GROUPS[a.group as keyof typeof AREA_GROUPS]}
                      </td>
                    </tr>
                  ) : null,
                  <tr key={a.key} className="border-t border-line">
                    <td className={cx("px-3 py-1.5", a.key === "*" ? "text-ink-2" : "text-ink")}>{a.label}</td>
                    {SCOPED_OPS.slice(0, 1).map((op) => (
                      <ScopeCell key={op} value={g[op]} changed={changed(a.key, op)} disabled={ro} onChange={(s) => setGrant(a.key, { [op]: s })} />
                    ))}
                    <FlagCell value={g.create} changed={changed(a.key, "create")} disabled={ro} label={`${OP_LABELS.create} در ${a.label}`} onChange={(v) => setGrant(a.key, { create: v })} />
                    {(["write", "delete"] as const).map((op) => (
                      <ScopeCell key={op} value={g[op]} changed={changed(a.key, op)} disabled={ro} onChange={(s) => setGrant(a.key, { [op]: s })} />
                    ))}
                    {FLAG_OPS.slice(1).map((op) => (
                      <FlagCell key={op} value={g[op]} changed={changed(a.key, op)} disabled={ro} label={`${OP_LABELS[op]} در ${a.label}`} onChange={(v) => setGrant(a.key, { [op]: v })} />
                    ))}
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
        {base && changes.length ? <Changes changes={changes} all={all} /> : null}
        {admin ? (
          <div className="flex flex-wrap items-center gap-2">
            <Switch checked={draft.active !== false} onChange={(v) => setDraft({ ...draft, active: v })} />
            <span className="text-[13px] text-ink-2">فعال</span>
            <span className="ms-auto" />
            {source && !source.builtin ? (
              <Popconfirm title="این نقش حذف شود؟" okText="حذف" cancelText="انصراف" okButtonProps={{ danger: true }} onConfirm={() => remove.mutate()}>
                <Button danger type="text" icon={<Trash2 {...ICON14} />}>
                  حذف نقش
                </Button>
              </Popconfirm>
            ) : null}
            <Button type="primary" loading={save.isPending} disabled={!draft.name.trim() || !draft.key || !!keyProblem} onClick={() => save.mutate()}>
              ذخیره
            </Button>
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}

function ScopeCell({ value, onChange, changed, disabled }: { value: Scope; onChange: (s: Scope) => void; changed: boolean; disabled: boolean }) {
  return (
    <td className={cx("px-1.5 py-1 text-center", changed && "bg-warning-tint")}>
      <Select<Scope> size="small" value={value} disabled={disabled} onChange={onChange} options={scopeOptions()} popupMatchSelectWidth={false} className="w-32" variant="borderless" />
    </td>
  );
}

function FlagCell({ value, onChange, changed, disabled, label }: { value: boolean; onChange: (v: boolean) => void; changed: boolean; disabled: boolean; label: string }) {
  return (
    <td className={cx("px-1.5 py-1 text-center", changed && "bg-warning-tint")}>
      <Checkbox checked={value} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
    </td>
  );
}

function Changes({ changes, all }: { changes: RoleChange[]; all: RoleView[] }) {
  const roleName = (k: string) => all.find((r) => r.key === k)?.name ?? k;
  const areaLabel = (k: string) => (k === "*" ? "همهٔ حوزه‌های دیگر" : areas().find((a) => a.key === k)?.label ?? k);
  const value = (c: RoleChange, v: unknown) => {
    if (c.what === "grant") return typeof v === "boolean" ? (v ? "بله" : "خیر") : SCOPE_LABELS[v as Scope];
    if (c.what === "field_groups") return (v as FieldGroup[]).map((g) => FIELD_GROUPS[g]).join("، ") || "هیچ";
    if (c.what === "contains") return (v as string[]).map(roleName).join("، ") || "هیچ";
    if (c.what === "workspaces") return v === "all" ? "همهٔ فضاها" : "فضاهای عضو";
    if (c.what === "domains") return v === "all" ? "همهٔ دامنه‌ها" : "دامنهٔ خود";
    if (c.what === "active") return v ? "فعال" : "غیرفعال";
    return String(v ?? "—");
  };
  const what = (c: RoleChange) =>
    c.what === "grant" ? `${OP_LABELS[c.op!]} در «${areaLabel(c.area!)}»` : ({ field_groups: "گروه‌های فیلد", contains: "نقش‌های دربرگرفته", workspaces: "فضاهای کاری", domains: "دامنه‌ها", name: "نام", description: "شرح", persona: "پرسونا", active: "وضعیت" } as Record<string, string>)[c.what];
  return (
    <Section title="تفاوت با پیش‌فرض">
      <ul className="flex flex-col gap-1.5 text-[13px]">
        {changes.map((c, i) => (
          <li key={i} className="flex flex-wrap items-center gap-1.5">
            <span className="text-ink">{what(c)}:</span>
            <Tooltip title="پیش‌فرض">
              <span className="text-ink-3 line-through">{value(c, c.from)}</span>
            </Tooltip>
            <span className="text-ink-3">←</span>
            <span className="text-ink">{value(c, c.to)}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
