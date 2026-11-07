// «سطح‌های تأیید» of an approval rule: the levels in order («پشت سر هم») or all at once («هم‌زمان»), each with its
// name, its approvers — people, the members of groups, the requester's manager (or their manager's manager), a user or
// group field of the record, an owner source a module registered — and its rule (one, everyone, n people, p %). Every
// level is read back as a sentence; the levels are checked as the server checks them before they are saved.
import { useEffect, useMemo, useState } from "react";
import { Button, Input, Segmented, Select } from "antd";
import { Plus, X, ArrowUp, ArrowDown, Save, RotateCcw, Trash2 } from "lucide-react";
import type { LevelDef, SourceDef } from "@shared/sla/approvals";
import { levelsProblem } from "@shared/sla/approvals";
import { APPROVAL_MODES, APPROVAL_RULES, APPROVER_SOURCES } from "@shared/tables/approvals";
import { toFa } from "@shared/jalali";
import { NumberInput } from "../../components/inputs";
import { ICON14, Note, cx } from "../../components/blocks";
import { RecordSelect, UserSelect, type RecordContext } from "../../records";
import { useApproverSources } from "./api";
import { emptyLevel, emptySource, levelSentence, moveItem, type Names } from "./model";

const asLevels = (raw: unknown): LevelDef[] =>
  Array.isArray(raw) ? raw.filter((l) => l && typeof l === "object").map((l) => ({ ...(l as LevelDef), sources: Array.isArray((l as LevelDef).sources) ? (l as LevelDef).sources : [] })) : [];

function SourceEditor({
  s,
  onChange,
  fields,
  owners,
  disabled,
}: {
  s: SourceDef;
  onChange: (s: SourceDef) => void;
  fields: { value: string; label: string }[];
  owners: string[];
  disabled: boolean;
}) {
  switch (s.kind) {
    case "users":
      return <UserSelect multiple value={s.users} onChange={(v) => onChange({ kind: "users", users: (v as string[] | null) ?? [] })} disabled={disabled} size="small" placeholder="افراد" />;
    case "groups":
      return <RecordSelect table="group" multiple value={s.groups} onChange={(v) => onChange({ kind: "groups", groups: (v as string[] | null) ?? [] })} disabled={disabled} size="small" placeholder="گروه‌ها" />;
    case "manager":
      return (
        <Segmented
          size="small"
          value={Number(s.depth) === 2 ? 2 : 1}
          disabled={disabled}
          onChange={(v) => onChange({ kind: "manager", ...(v === 2 ? { depth: 2 } : {}) })}
          options={[
            { value: 1, label: "مدیر مستقیم" },
            { value: 2, label: "مدیرِ مدیر" },
          ]}
        />
      );
    case "field":
      return (
        <Select
          size="small"
          className="min-w-[200px]"
          value={s.field || undefined}
          placeholder={fields.length ? "فیلد کاربر یا گروه" : "این جدول فیلد کاربر یا گروه ندارد"}
          disabled={disabled || !fields.length}
          options={fields}
          onChange={(v) => onChange({ kind: "field", field: v })}
        />
      );
    case "owner":
      return (
        <Select
          size="small"
          className="min-w-[200px]"
          value={s.of || undefined}
          placeholder={owners.length ? "منبع مالک" : "هنوز ماژولی منبع مالک ثبت نکرده است"}
          disabled={disabled || !owners.length}
          options={owners.map((o) => ({ value: o, label: o }))}
          onChange={(v) => onChange({ kind: "owner", of: v })}
        />
      );
  }
}

export default function LevelsBuilder({ ctx }: { ctx: RecordContext }) {
  const canEdit = ctx.meta.canWrite && !ctx.meta.locked;
  const saved = useMemo(() => asLevels(ctx.row.levels), [ctx.row.levels]);
  const savedMode = ctx.row.mode === "parallel" ? "parallel" : "sequential";
  const [levels, setLevels] = useState<LevelDef[]>(saved);
  const [mode, setMode] = useState<string>(savedMode);
  const [saving, setSaving] = useState(false);
  useEffect(() => setLevels(saved), [saved]);
  useEffect(() => setMode(savedMode), [savedMode]);
  const owners = useApproverSources().data?.owners ?? [];
  const target = ctx.schema.def(String(ctx.row.table_key ?? ""));
  const fieldOptions = useMemo(
    () => (target?.fields ?? []).filter((f) => ["user", "users", "group"].includes(f.type) && !f.hidden).map((f) => ({ value: f.name, label: f.label })),
    [target],
  );
  const problem = levelsProblem(levels, (n) => target?.fields.find((f) => f.name === n)?.type, owners);
  const dirty = JSON.stringify(levels) !== JSON.stringify(saved) || mode !== savedMode;
  const names: Names = { user: () => undefined, group: () => undefined, field: (n) => target?.fields.find((f) => f.name === n)?.label };
  const setLevel = (i: number, l: LevelDef) => setLevels((xs) => xs.map((x, j) => (j === i ? l : x)));
  const save = async () => {
    setSaving(true);
    await ctx.save({ levels, mode });
    setSaving(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={mode} disabled={!canEdit} onChange={(v) => setMode(String(v))} options={APPROVAL_MODES.map((o) => ({ value: o.value, label: o.label }))} />
        {!target ? <span className="text-[13px] text-danger">جدول این قاعده پیدا نشد</span> : null}
        {canEdit ? (
          <div className="ms-auto flex gap-2">
            <Button
              size="small"
              icon={<RotateCcw {...ICON14} />}
              disabled={!dirty}
              onClick={() => {
                setLevels(saved);
                setMode(savedMode);
              }}
            >
              بازگردانی
            </Button>
            <Button size="small" type="primary" icon={<Save {...ICON14} />} disabled={!dirty || !!problem} loading={saving} onClick={() => void save()}>
              ذخیرهٔ سطح‌ها
            </Button>
          </div>
        ) : null}
      </div>
      {problem && levels.length ? <Note tone="warning">{problem}</Note> : null}
      <ol className="flex flex-col gap-0">
        {levels.map((l, i) => (
          <li key={i} className="flex flex-col">
            {i > 0 ? (
              <span className="ms-6 flex h-6 items-center gap-2 border-s-2 border-line ps-3 text-[12px] text-ink-3" aria-hidden>
                {mode === "parallel" ? "هم‌زمان" : "سپس"}
              </span>
            ) : null}
            <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3" aria-label={`سطح ${toFa(i + 1)}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="ds-num inline-grid size-6 place-items-center rounded-full bg-sunken text-[12px] text-ink-2">{toFa(i + 1)}</span>
                <Input size="small" className="max-w-[240px]" placeholder="نام سطح (مانند مدیر واحد)" value={l.name ?? ""} disabled={!canEdit} maxLength={120} onChange={(e) => setLevel(i, { ...l, name: e.target.value })} />
                <Select
                  size="small"
                  className="min-w-[150px]"
                  value={l.rule ?? "any"}
                  disabled={!canEdit}
                  options={APPROVAL_RULES.map((o) => ({ value: o.value, label: o.label }))}
                  onChange={(v) => setLevel(i, { ...l, rule: v as LevelDef["rule"], threshold: v === "count" || v === "percent" ? l.threshold ?? (v === "percent" ? 50 : 2) : undefined })}
                />
                {l.rule === "count" || l.rule === "percent" ? (
                  <NumberInput
                    size="small"
                    className="!w-[110px]"
                    value={l.threshold ?? null}
                    disabled={!canEdit}
                    suffix={l.rule === "percent" ? "٪" : "نفر"}
                    onChange={(v) => setLevel(i, { ...l, threshold: v === null ? undefined : Number(v) })}
                  />
                ) : null}
                {canEdit ? (
                  <span className="ms-auto flex gap-0.5">
                    <Button size="small" type="text" aria-label="بالاتر" icon={<ArrowUp {...ICON14} />} disabled={i === 0} onClick={() => setLevels((xs) => moveItem(xs, i, i - 1))} />
                    <Button size="small" type="text" aria-label="پایین‌تر" icon={<ArrowDown {...ICON14} />} disabled={i === levels.length - 1} onClick={() => setLevels((xs) => moveItem(xs, i, i + 1))} />
                    <Button size="small" type="text" danger aria-label="حذف سطح" icon={<Trash2 {...ICON14} />} disabled={levels.length === 1} onClick={() => setLevels((xs) => xs.filter((_, j) => j !== i))} />
                  </span>
                ) : null}
              </div>
              <div className="flex flex-col gap-2">
                {l.sources.map((s, k) => (
                  <div key={k} className="flex flex-wrap items-center gap-2">
                    {k > 0 ? <span className="text-[12px] text-ink-3">یا</span> : null}
                    <Select
                      size="small"
                      className="min-w-[170px]"
                      value={s.kind}
                      disabled={!canEdit}
                      options={APPROVER_SOURCES.map((o) => ({ value: o.value, label: o.label }))}
                      onChange={(v) => setLevel(i, { ...l, sources: l.sources.map((x, j) => (j === k ? emptySource(v as SourceDef["kind"]) : x)) })}
                    />
                    <div className="min-w-[200px] flex-1">
                      <SourceEditor s={s} fields={fieldOptions} owners={owners} disabled={!canEdit} onChange={(x) => setLevel(i, { ...l, sources: l.sources.map((y, j) => (j === k ? x : y)) })} />
                    </div>
                    {canEdit && l.sources.length > 1 ? (
                      <Button size="small" type="text" aria-label="حذف منبع" icon={<X {...ICON14} />} onClick={() => setLevel(i, { ...l, sources: l.sources.filter((_, j) => j !== k) })} />
                    ) : null}
                  </div>
                ))}
                {canEdit ? (
                  <Button size="small" type="text" className="self-start" icon={<Plus {...ICON14} />} disabled={l.sources.length >= 20} onClick={() => setLevel(i, { ...l, sources: [...l.sources, emptySource("users")] })}>
                    منبع دیگر
                  </Button>
                ) : null}
              </div>
              <p className={cx("text-[13px]", problem ? "text-ink-3" : "text-ink-2")}>{levelSentence(l, i, names)}</p>
            </section>
          </li>
        ))}
      </ol>
      {canEdit ? (
        <Button className="self-start" icon={<Plus {...ICON14} />} disabled={levels.length >= 10} onClick={() => setLevels((xs) => [...xs, emptyLevel()])}>
          سطح تازه
        </Button>
      ) : null}
    </div>
  );
}
