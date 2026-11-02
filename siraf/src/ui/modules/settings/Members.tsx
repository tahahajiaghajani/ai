// Users and permissions (کاربران و دسترسی‌ها): the three main roles (مالک، حسابدار، ناظر) as cards, the
// preset roles under «نقش‌های بیشتر», the members with their role, last sign-in and status, per-area
// overrides in the side sheet («هوش مصنوعی» included) and temporary passwords shown once. A business
// always keeps one active owner; only owners add or change owners.
import { useMemo, useState } from "react";
import { Button, Table, Modal, Form, Input, Select, Switch, Drawer, Tooltip, message } from "antd";
import { Plus, KeyRound, ShieldCheck, Copy, Users, Sparkles, Crown, Calculator, Eye, ChevronDown, RotateCcw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { useSession } from "../../lib/session";
import { useAction, useNotify } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, JDateTime } from "../../components/display";
import { AREAS, CORE_ROLES, PRESET_ROLES, ROLES, LEVEL_ORDER, levelOf, permissionMap, type Role, type Area, type Level } from "@shared/permissions";
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
}

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
        active ? "border-[var(--sf-accent-border)] bg-accent-tint" : "border-line hover:bg-[var(--sf-hover)]",
      )}
    >
      <span className="flex w-full items-center gap-2">
        <span className="inline-grid size-8 place-items-center rounded-md bg-sunken text-ink-2" aria-hidden>
          <Icon {...ICON} />
        </span>
        <span className="sf-t-title text-ink">{r.title}</span>
        <span className="ms-auto text-[13px] text-ink-3">
          <span className="sf-num">{faDigits(count)}</span> نفر
        </span>
      </span>
      <span className="text-[13px] leading-5 text-ink-2">{r.about}</span>
      <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-3">
        <Sparkles size={13} strokeWidth={1.4} absoluteStrokeWidth aria-hidden />
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

  const iAmOwner = info.member.role === "owner";
  const editable = can("users", "edit") && writable;
  const members = q.data?.members ?? [];
  const activeOwners = members.filter((m) => m.role === "owner" && m.is_active).length;
  const count = (r: Role) => members.filter((m) => m.role === r && m.is_active).length;
  const shown = roleFilter ? members.filter((m) => m.role === roleFilter) : members;
  const aiManagers = members.filter((m) => m.is_active && managesAi(m));
  const roleOptions = useMemo(
    () => [
      { label: "نقش‌های اصلی", options: CORE_ROLES.map((r) => ({ value: r, label: ROLES[r].title, disabled: r === "owner" && !iAmOwner })) },
      { label: "نقش‌های بیشتر", options: PRESET_ROLES.map((r) => ({ value: r, label: ROLES[r].title })) },
    ],
    [iAmOwner],
  );
  // the last active owner keeps the role and stays active; owners are changed only by owners
  const lockedOwner = (m: MemberRow) => (m.role === "owner" && m.is_active && activeOwners <= 1 ? "کسب‌وکار باید دست‌کم یک مالک فعال داشته باشد" : null);
  const ownerOnly = (m: MemberRow) => (m.role === "owner" && !iAmOwner ? "فقط مالک می‌تواند نقش مالک را تغییر دهد" : null);
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
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 sf-fade">
            {PRESET_ROLES.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={roleFilter === r}
                onClick={() => pick(r)}
                className={cx(
                  "flex flex-col items-start gap-1 rounded-md border p-3 text-start",
                  roleFilter === r ? "border-[var(--sf-accent-border)] bg-accent-tint" : "border-line bg-surface hover:bg-[var(--sf-hover)]",
                )}
              >
                <span className="flex w-full items-center gap-2 font-medium text-ink">
                  {ROLES[r].title}
                  <span className="ms-auto text-[12px] text-ink-3">
                    <span className="sf-num">{faDigits(count(r))}</span> نفر
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
                    <bdi dir="ltr" className="sf-latin bk-3 block truncate" style={{ fontSize: 12 }}>
                      {r.email}
                    </bdi>
                  </span>
                </span>
              ),
            },
            { key: "title", dataIndex: "title", title: "سمت", width: 140, render: (v) => (v ? <span className="bk-2">{v}</span> : <span className="sf-zero">—</span>) },
            {
              key: "role",
              dataIndex: "role",
              title: "نقش",
              width: 170,
              render: (v: Role, r) => {
                const lock = ownerOnly(r) ?? lockedOwner(r);
                if (!editable) return <span>{ROLES[v]?.title}</span>;
                const select = (
                  <Select
                    size="small"
                    variant="borderless"
                    value={v}
                    options={roleOptions}
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
                          <Sparkles size={13} strokeWidth={1.4} absoluteStrokeWidth aria-hidden />
                          کلیدهای هوش مصنوعی
                        </span>
                      </Tooltip>
                    ) : null}
                    {!k && !managesAi(r) ? <span className="sf-zero">—</span> : null}
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
                const lock = me?.user?.id === r.user_id ? "حساب خودتان را نمی‌توانید غیرفعال کنید" : (ownerOnly(r) ?? lockedOwner(r));
                const sw = (
                  <Switch size="small" checked={v} disabled={!editable || !!lock} onChange={(is_active) => update.mutate({ id: r.id, is_active })} aria-label={`فعال بودن ${r.full_name}`} />
                );
                return lock && editable ? <Tooltip title={lock}>{sw}</Tooltip> : sw;
              },
            },
            {
              key: "a",
              width: 96,
              render: (_, r) =>
                editable ? (
                  <span className="bk-ra">
                    <Tooltip title="دسترسی‌ها">
                      <Button size="small" type="text" icon={<ShieldCheck {...ICON14} />} onClick={() => setPerm(r)} aria-label={`دسترسی‌های ${r.full_name}`} disabled={!!ownerOnly(r)} />
                    </Tooltip>
                    {can("users", "full") && !support ? (
                      <Tooltip title="رمز تازه">
                        <Button
                          size="small"
                          type="text"
                          icon={<KeyRound {...ICON14} />}
                          aria-label={`رمز تازه برای ${r.full_name}`}
                          disabled={!!ownerOnly(r)}
                          onClick={async () => {
                            if (await n.confirm(`رمز تازه برای ${r.full_name}؟`, "همهٔ ورودهای فعلی این کاربر بسته می‌شود.")) reset.mutate(r.id);
                          }}
                        />
                      </Tooltip>
                    ) : null}
                  </span>
                ) : null,
            },
          ]}
        />
      </div>

      <Modal open={!!add} onCancel={() => setAdd(null)} title="افزودن کاربر" footer={null} destroyOnHidden width={480}>
        <Form layout="vertical" requiredMark={false} onFinish={(v) => create.mutate(v)} initialValues={{ role: add ?? "accountant" }}>
          <Form.Item name="full_name" label="نام" rules={[{ required: true, message: "نام را بنویسید." }]}>
            <Input autoFocus />
          </Form.Item>
          <Form.Item name="email" label="ایمیل (نام کاربری)" rules={[{ required: true, type: "email", message: "ایمیل درست نیست." }]}>
            <Input dir="ltr" className="sf-latin" />
          </Form.Item>
          <div className="bk-grid2">
            <Form.Item name="role" label="نقش">
              <Select options={roleOptions} />
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
        {perm ? <Overrides member={perm} onCancel={() => setPerm(null)} onSave={(overrides) => (update.mutate({ id: perm.id, overrides }), setPerm(null))} /> : null}
      </Drawer>
    </div>
  );
}

function Overrides({ member, onSave, onCancel }: { member: MemberRow; onSave: (o: Partial<Record<Area, Level>>) => void; onCancel: () => void }) {
  const [form] = Form.useForm();
  const areas = Object.keys(AREAS) as Area[];
  const initial = Object.fromEntries(areas.map((a) => [a, member.overrides?.[a] ?? ""]));
  return (
    <div className="sf-form">
      <Form
        form={form}
        layout="vertical"
        initialValues={initial}
        onFinish={(v: Record<Area, Level | "">) => onSave(Object.fromEntries(Object.entries(v).filter(([, x]) => x)) as Partial<Record<Area, Level>>)}
      >
        <Note className="mb-4">نقش «{ROLES[member.role]?.title}» پیش‌فرض هر بخش را تعیین می‌کند؛ هر بخش را جداگانه می‌توانید تغییر دهید.</Note>
        <div className="sf-form-grid">
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
                  { value: "", label: `پیش‌فرض نقش (${levelLabel(a, levelOf(member.role, a))})` },
                  ...LEVEL_ORDER.map((l) => ({ value: l, label: levelLabel(a, l) })),
                ]}
              />
            </Form.Item>
          ))}
        </div>
        <div className="sf-form-foot">
          <Button icon={<RotateCcw {...ICON14} />} onClick={() => form.setFieldsValue(Object.fromEntries(areas.map((a) => [a, ""])))} className="me-auto">
            پیش‌فرض نقش
          </Button>
          <Button onClick={onCancel}>انصراف</Button>
          <Button type="primary" htmlType="submit">
            ذخیره
          </Button>
        </div>
      </Form>
    </div>
  );
}
