// Users and permissions (کاربران و دسترسی‌ها): the three main roles (مالک، حسابدار، ناظر) as cards, the
// preset roles under «نقش‌های بیشتر», the members with their role, last sign-in and status, per-area
// overrides in the side sheet («هوش مصنوعی» included) and temporary passwords shown once. A business
// always keeps one active owner; only owners add or change owners. The page offers only the changes
// the server allows (`memberChangeRule`: not your own access, not a member above you, nothing above
// your own levels) and «رمز تازه» only where a reset can work (`password_reset` from the server).
import { useMemo, useState } from "react";
import { Button, Table, Modal, Form, Input, Select, Switch, Drawer, Tooltip, message } from "antd";
import { Plus, KeyRound, ShieldCheck, Copy, Users, Crown, Calculator, Eye, ChevronDown, RotateCcw } from "lucide-react";
import { AiIcon } from "../../components/shell/icons";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { useSession } from "../../lib/session";
import { useAction, useNotify } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, JDateTime } from "../../components/display";
import {
  AREAS, CORE_ROLES, PRESET_ROLES, ROLES, LEVEL_ORDER, levelOf, memberChangeRule, permissionMap,
  type MemberActor, type MemberGrant, type Role, type Area, type Level,
} from "@shared/permissions";
import { faDigits } from "@shared/format";
import { Avatar, ICON, ICON14, Note, cx } from "../reports/kit";

const LEVELS: Record<Level, string> = { none: "بدون دسترسی", view: "مشاهده", edit: "ثبت و ویرایش", full: "کامل (حذف و تأیید)" };
/** What each level means for the assistant («هوش مصنوعی» area). */
const AI_LEVELS: Record<Level, string> = {
  none: "بدون دستیار",
  view: "پرسش از دستیار (فقط خواندن)",
  edit: "دستیار پیش‌نویس آماده می‌کند",
  full: "مدیریت کلیدها، تنظیمات و مصرف",
};
const ROLE_ICON: Record<string, typeof Crown> = { owner: Crown, accountant: Calculator, viewer: Eye };

interface MemberRow {
  id: string;
  user_id: string;
  role: Role;
  overrides: Partial<Record<Area, Level>> | null;
  title: string | null;
  is_active: boolean;
  email: string;
  full_name: string;
  last_login_at: string | null;
  /** «رمز تازه» can work: an account this business made, working for no other business */
  password_reset?: boolean;
}

const grantOf = (m: MemberRow): MemberGrant => ({ user_id: m.user_id, role: m.role, overrides: m.overrides });

const levelLabel = (a: Area, l: Level) => (a === "ai" ? AI_LEVELS[l] : LEVELS[l]);
const managesAi = (m: MemberRow) => levelOf(m.role, "ai", m.overrides) === "full";

function RoleCard({ role, count, active, onPick }: { role: Role; count: number; active: boolean; onPick?: () => void }) {
  const r = ROLES[role];
  const Icon = ROLE_ICON[role] ?? ShieldCheck;
  const perms = permissionMap(role);
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      className={cx(
        "flex min-w-0 flex-col items-start gap-2 rounded-lg border bg-surface p-4 text-start transition-colors",
        active ? "border-[var(--ds-accent-border)] bg-accent-tint" : "border-line hover:bg-[var(--ds-hover)]",
      )}
    >
      <span className="flex w-full items-center gap-2">
        <span className="inline-grid size-8 place-items-center rounded-md bg-sunken text-ink-2" aria-hidden>
          <Icon {...ICON} />
        </span>
        <span className="ds-t-title text-ink">{r.title}</span>
        <span className="ms-auto text-[13px] text-ink-3">
          <span className="ds-num">{faDigits(count)}</span> نفر
        </span>
      </span>
      <span className="text-[13px] leading-5 text-ink-2">{r.about}</span>
      <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-3">
        <AiIcon size={13} strokeWidth={1.4} absoluteStrokeWidth aria-hidden />
        {AI_LEVELS[perms.ai]}
      </span>
    </button>
  );
}

export default function Members() {
  const { api, can, info, writable, support } = useOrg();
  const { me } = useSession();
  const n = useNotify();
  const q = useQuery({ queryKey: ["members"], queryFn: () => api.get<{ members: MemberRow[] }>("/members") });
  const [add, setAdd] = useState<Role | null>(null);
  const [perm, setPerm] = useState<MemberRow | null>(null);
  const [temp, setTemp] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [roleFilter, setRoleFilter] = useState<Role | null>(null);
  const create = useAction((v: Record<string, unknown>) => api.post("/members", v), {
    invalidate: [["members"], ["org"]],
    onSuccess: (r: any) => {
      setAdd(null);
      if (r.temp_password) setTemp(r.temp_password);
      else n.ok("کاربر افزوده شد.");
    },
  });
  const update = useAction(({ id, ...v }: { id: string } & Record<string, unknown>) => api.patch(`/members/${id}`, v), { success: "ذخیره شد.", invalidate: [["members"]] });
  const reset = useAction((id: string) => api.post(`/members/${id}/password`, {}), { onSuccess: (r: any) => setTemp(r.temp_password) });

  const myId = me?.user?.id ?? "";
  const actor = useMemo<MemberActor>(
    () => ({ user_id: myId, role: info.member.role as Role, permissions: info.member.permissions, support: !!support }),
    [myId, info.member.role, info.member.permissions, support],
  );
  const rule = (before: MemberGrant | null, after: MemberGrant | null) => memberChangeRule(actor, before, after);
  const editable = can("users", "edit") && writable;
  const members = q.data?.members ?? [];
  const activeOwners = members.filter((m) => m.role === "owner" && m.is_active).length;
  const count = (r: Role) => members.filter((m) => m.role === r && m.is_active).length;
  const shown = roleFilter ? members.filter((m) => m.role === roleFilter) : members;
  const aiManagers = members.filter((m) => m.is_active && managesAi(m));
  // the roles this actor may give: to a new member (before null) or instead of a member's current one
  const roleOptions = (before: MemberGrant | null) => {
    const opt = (r: Role) => ({
      value: r,
      label: ROLES[r].title,
      disabled: r !== before?.role && !!rule(before, before ? { ...before, role: r } : { user_id: "", role: r, overrides: {} }),
    });
    return [
      { label: "نقش‌های اصلی", options: CORE_ROLES.map(opt) },
      { label: "نقش‌های بیشتر", options: PRESET_ROLES.map(opt) },
    ];
  };
  // the role a new member starts with: the one asked for when it may be given, else the first that may
  const startRole = (want: Role | null): Role => {
    const ok = (r: Role) => !rule(null, { user_id: "", role: r, overrides: {} });
    return want && ok(want) ? want : ([...CORE_ROLES, ...PRESET_ROLES].find(ok) ?? want ?? "viewer");
  };
  // the last active owner keeps the role and stays active
  const lockedOwner = (m: MemberRow) => (m.role === "owner" && m.is_active && activeOwners <= 1 ? "کسب‌وکار باید دست‌کم یک مالک فعال داشته باشد" : null);
  // role and per-area access: owners only by owners, never your own (below the owner), never a member above you
  const accessLock = (m: MemberRow) => rule(grantOf(m), null) ?? lockedOwner(m);
  // activation: never yourself, owners only by owners, never a member above you
  const activeLock = (m: MemberRow) =>
    m.user_id === myId ? "حساب خودتان را نمی‌توانید غیرفعال کنید" : (rule(grantOf(m), grantOf(m)) ?? lockedOwner(m));
  const canReset = (m: MemberRow) => can("users", "full") && !support && !!m.password_reset && m.user_id !== myId && !rule(grantOf(m), grantOf(m));
  const pick = (r: Role) => setRoleFilter((cur) => (cur === r ? null : r));

  return (
    <div>
      <PageHeader
        title="کاربران و دسترسی‌ها"
        subtitle={members.length ? `${faDigits(members.length)} کاربر` : undefined}
        actions={
          editable ? (
            <Button type="primary" icon={<Plus {...ICON} />} onClick={() => setAdd("accountant")}>
              افزودن کاربر
            </Button>
          ) : null
        }
      />

      <section aria-label="نقش‌ها" className="mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {CORE_ROLES.map((r) => (
            <RoleCard key={r} role={r} count={count(r)} active={roleFilter === r} onPick={() => pick(r)} />
          ))}
        </div>
        <button
          type="button"
          className="mt-3 inline-flex items-center gap-1.5 rounded-md px-1 text-[13px] text-ink-2 hover:text-ink"
          aria-expanded={more}
          onClick={() => setMore((v) => !v)}
        >
          <ChevronDown size={14} strokeWidth={1.4} absoluteStrokeWidth className={cx("transition-transform", more && "rotate-180")} aria-hidden />
          نقش‌های بیشتر
          <span className="text-ink-3">({PRESET_ROLES.map((r) => ROLES[r].title).join("، ")})</span>
        </button>
        {more ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 ds-fade">
            {PRESET_ROLES.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={roleFilter === r}
                onClick={() => pick(r)}
                className={cx(
                  "flex flex-col items-start gap-1 rounded-md border p-3 text-start",
                  roleFilter === r ? "border-[var(--ds-accent-border)] bg-accent-tint" : "border-line bg-surface hover:bg-[var(--ds-hover)]",
                )}
              >
                <span className="flex w-full items-center gap-2 font-medium text-ink">
                  {ROLES[r].title}
                  <span className="ms-auto text-[12px] text-ink-3">
                    <span className="ds-num">{faDigits(count(r))}</span> نفر
                  </span>
                </span>
                <span className="text-[12px] leading-5 text-ink-2">{ROLES[r].about}</span>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {aiManagers.length ? (
        <Note className="mb-4">
          <b>مدیریت کلیدهای هوش مصنوعی:</b> {aiManagers.map((m) => m.full_name).join("، ")}
        </Note>
      ) : null}

      <div className="bk-card">
        <Table<MemberRow>
          className="bk-tbl"
          size="middle"
          rowKey="id"
          loading={q.isLoading}
          dataSource={shown}
          pagination={false}
          scroll={{ x: 960 }}
          locale={{
            emptyText: (
              <EmptyState
                icon={Users}
                title={roleFilter ? `کسی نقش «${ROLES[roleFilter].title}» ندارد` : "کاربری نیست"}
                action={roleFilter && editable ? <Button onClick={() => setAdd(roleFilter)}>افزودن {ROLES[roleFilter].title}</Button> : undefined}
              />
            ),
          }}
          columns={[
            {
              key: "name",
              title: "کاربر",
              render: (_, r) => (
                <span className="flex min-w-0 items-center gap-3">
                  <Avatar name={r.full_name} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 font-medium">
                      {r.full_name}
                      {me?.user?.id === r.user_id ? <span className="bk-plain">(شما)</span> : null}
                    </span>
                    <bdi dir="ltr" className="ds-latin bk-3 block truncate" style={{ fontSize: 12 }}>
                      {r.email}
                    </bdi>
                  </span>
                </span>
              ),
            },
            { key: "title", dataIndex: "title", title: "سمت", width: 140, render: (v) => (v ? <span className="bk-2">{v}</span> : <span className="ds-zero">—</span>) },
            {
              key: "role",
              dataIndex: "role",
              title: "نقش",
              width: 170,
              render: (v: Role, r) => {
                const lock = accessLock(r);
                if (!editable) return <span>{ROLES[v]?.title}</span>;
                const select = (
                  <Select
                    size="small"
                    variant="borderless"
                    value={v}
                    options={roleOptions(grantOf(r))}
                    disabled={!!lock}
                    popupMatchSelectWidth={false}
                    style={{ width: "auto" }}
                    aria-label={`نقش ${r.full_name}`}
                    onChange={(role) => update.mutate({ id: r.id, role })}
                  />
                );
                return lock ? <Tooltip title={lock}>{select}</Tooltip> : select;
              },
            },
            {
              key: "ov",
              title: "دسترسی",
              width: 190,
              render: (_, r) => {
                const k = Object.keys(r.overrides ?? {}).length;
                return (
                  <span className="flex flex-wrap items-center gap-1.5">
                    {k ? (
                      <Chip tone="neutral" fig>
                        {faDigits(k)} بخش ویژه
                      </Chip>
                    ) : null}
                    {managesAi(r) ? (
                      <Tooltip title="کلیدها و تنظیمات هوش مصنوعی را مدیریت می‌کند">
                        <span className="inline-flex items-center gap-1 text-[12px] text-ink-2">
                          <AiIcon size={13} strokeWidth={1.4} absoluteStrokeWidth aria-hidden />
                          کلیدهای هوش مصنوعی
                        </span>
                      </Tooltip>
                    ) : null}
                    {!k && !managesAi(r) ? <span className="ds-zero">—</span> : null}
                  </span>
                );
              },
            },
            { key: "login", dataIndex: "last_login_at", title: "آخرین ورود", width: 160, render: (v) => <span className="bk-2"><JDateTime v={v} /></span> },
            {
              key: "active",
              dataIndex: "is_active",
              title: "فعال",
              width: 72,
              render: (v: boolean, r) => {
                const lock = activeLock(r);
                const sw = (
                  <Switch size="small" checked={v} disabled={!editable || !!lock} onChange={(is_active) => update.mutate({ id: r.id, is_active })} aria-label={`فعال بودن ${r.full_name}`} />
                );
                return lock && editable ? <Tooltip title={lock}>{sw}</Tooltip> : sw;
              },
            },
            {
              key: "a",
              width: 96,
              render: (_, r) => {
                if (!editable) return null;
                const lock = rule(grantOf(r), null);
                return (
                  <span className="bk-ra">
                    <Tooltip title={lock ?? "دسترسی‌ها"}>
                      <Button size="small" type="text" icon={<ShieldCheck {...ICON14} />} onClick={() => setPerm(r)} aria-label={`دسترسی‌های ${r.full_name}`} disabled={!!lock} />
                    </Tooltip>
                    {canReset(r) ? (
                      <Tooltip title="رمز تازه">
                        <Button
                          size="small"
                          type="text"
                          icon={<KeyRound {...ICON14} />}
                          aria-label={`رمز تازه برای ${r.full_name}`}
                          onClick={async () => {
                            if (await n.confirm(`رمز تازه برای ${r.full_name}؟`, "همهٔ ورودهای فعلی این کاربر بسته می‌شود.")) reset.mutate(r.id);
                          }}
                        />
                      </Tooltip>
                    ) : null}
                  </span>
                );
              },
            },
          ]}
        />
      </div>

      <Modal open={!!add} onCancel={() => setAdd(null)} title="افزودن کاربر" footer={null} destroyOnHidden width={480}>
        <Form layout="vertical" requiredMark={false} onFinish={(v) => create.mutate(v)} initialValues={{ role: startRole(add) }}>
          <Form.Item name="full_name" label="نام" rules={[{ required: true, message: "نام را بنویسید." }]}>
            <Input autoFocus />
          </Form.Item>
          <Form.Item name="email" label="ایمیل (نام کاربری)" rules={[{ required: true, type: "email", message: "ایمیل درست نیست." }]}>
            <Input dir="ltr" className="ds-latin" />
          </Form.Item>
          <div className="bk-grid2">
            <Form.Item name="role" label="نقش">
              <Select options={roleOptions(null)} />
            </Form.Item>
            <Form.Item name="title" label="سمت (اختیاری)">
              <Input />
            </Form.Item>
          </div>
          <Form.Item noStyle shouldUpdate={(a, b) => a.role !== b.role}>
            {({ getFieldValue }) => {
              const r = ROLES[getFieldValue("role") as Role];
              return r ? <p className="-mt-2 mb-4 text-[13px] leading-5 text-ink-3">{r.about}</p> : null;
            }}
          </Form.Item>
          <Form.Item name="password" label="رمز اولیه (اختیاری)" extra="خالی بماند تا رمز تصادفی ساخته و یک بار نمایش داده شود. اگر این ایمیل حساب دارد، همان حساب عضو می‌شود.">
            <Input.Password dir="ltr" />
          </Form.Item>
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setAdd(null)}>انصراف</Button>
            <Button type="primary" htmlType="submit" loading={create.isPending}>
              افزودن
            </Button>
          </div>
        </Form>
      </Modal>

      <Modal open={!!temp} onCancel={() => setTemp(null)} onOk={() => setTemp(null)} title="رمز موقت" cancelButtonProps={{ style: { display: "none" } }} okText="یادداشت کردم" width={440}>
        <Note tone="warning" className="mb-4">
          <b>این رمز دوباره نمایش داده نمی‌شود.</b> آن را به کاربر بدهید؛ پس از ورود می‌تواند رمز را عوض کند.
        </Note>
        <div className="bk-copy">
          <code style={{ fontSize: 18, letterSpacing: ".04em" }}>{temp}</code>
          <Tooltip title="رونوشت">
            <Button
              type="text"
              icon={<Copy {...ICON} />}
              aria-label="رونوشت"
              onClick={() => {
                void navigator.clipboard?.writeText(temp ?? "");
                message.success("رونوشت شد.");
              }}
            />
          </Tooltip>
        </div>
      </Modal>

      <Drawer open={!!perm} onClose={() => setPerm(null)} size={500} title={`دسترسی‌های ${perm?.full_name ?? ""}`} destroyOnHidden>
        {perm ? (
          <Overrides
            member={perm}
            actor={actor}
            saving={update.isPending}
            onCancel={() => setPerm(null)}
            // the sheet closes only once the change is saved: a refusal keeps the edits
            onSave={(overrides) => update.mutate({ id: perm.id, overrides }, { onSuccess: () => setPerm(null) })}
          />
        ) : null}
      </Drawer>
    </div>
  );
}

function Overrides({
  member,
  actor,
  saving,
  onSave,
  onCancel,
}: {
  member: MemberRow;
  actor: MemberActor;
  saving: boolean;
  onSave: (o: Partial<Record<Area, Level>>) => void;
  onCancel: () => void;
}) {
  const [form] = Form.useForm();
  const areas = Object.keys(AREAS) as Area[];
  // below the owner, nobody gives more than they have: levels above the actor's own are not offered
  const above = (a: Area, l: Level) => actor.role !== "owner" && LEVEL_ORDER.indexOf(l) > LEVEL_ORDER.indexOf(actor.permissions[a] ?? "none");
  const initial = Object.fromEntries(areas.map((a) => [a, member.overrides?.[a] ?? ""]));
  return (
    <div className="ds-form">
      <Form
        form={form}
        layout="vertical"
        initialValues={initial}
        onFinish={(v: Record<Area, Level | "">) => onSave(Object.fromEntries(Object.entries(v).filter(([, x]) => x)) as Partial<Record<Area, Level>>)}
      >
        <Note className="mb-4">نقش «{ROLES[member.role]?.title}» پیش‌فرض هر بخش را تعیین می‌کند؛ هر بخش را جداگانه می‌توانید تغییر دهید.</Note>
        <div className="ds-form-grid">
          {areas.map((a) => (
            <Form.Item
              key={a}
              name={a}
              label={AREAS[a]}
              style={{ ["--span" as string]: 12 }}
              extra={a === "ai" ? "«کامل» یعنی مدیریت کلیدها، بودجه و گزارش مصرف هوش مصنوعی." : undefined}
            >
              <Select
                options={[
                  { value: "", label: `پیش‌فرض نقش (${levelLabel(a, levelOf(member.role, a))})`, disabled: above(a, levelOf(member.role, a)) },
                  ...LEVEL_ORDER.map((l) => ({ value: l, label: levelLabel(a, l), disabled: above(a, l) })),
                ]}
              />
            </Form.Item>
          ))}
        </div>
        <div className="ds-form-foot">
          <Button icon={<RotateCcw {...ICON14} />} onClick={() => form.setFieldsValue(Object.fromEntries(areas.map((a) => [a, ""])))} className="me-auto">
            پیش‌فرض نقش
          </Button>
          <Button onClick={onCancel}>انصراف</Button>
          <Button type="primary" htmlType="submit" loading={saving}>
            ذخیره
          </Button>
        </div>
      </Form>
    </div>
  );
}
