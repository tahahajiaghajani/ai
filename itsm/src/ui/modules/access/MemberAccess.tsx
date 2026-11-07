// «دسترسی اعضا»: every member with their persona, roles, unit and groups; a member's sheet sets their roles (or a
// persona preset), unit, location, manager, domain, workspaces, delegate and absence, and shows where each role
// comes from and the effective permissions they add up to. Members without ITSM roles keep the access of their
// membership role («حالت پیشین») until roles are given.
import { useEffect, useMemo, useState } from "react";
import { Button, Drawer, Form, Input, Select, Switch, Table, Tabs } from "antd";
import { Search, Sparkles } from "lucide-react";
import { PERSONA_PRESETS, PERSONAS, OP_LABELS, type Persona } from "@shared/access";
import { FIELD_GROUPS } from "@shared/model/types";
import { ROLES as MEMBERSHIP_ROLES, type Role } from "@shared/permissions";
import { MEMBER_KINDS } from "@shared/tables/access";
import { faDigits } from "@shared/format";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { normalizeFa } from "../../lib/fa";
import { PageHeader, Section } from "../../components/layout";
import { Chip, EmptyState, Loader } from "../../components/display";
import { DateInput } from "../../components/inputs";
import { ICON14, Note, Who } from "../../components/blocks";
import { KEYS, useAccessAdmin, useRoles, useTable, type MemberAccessDetail, type MemberAccessRow, type UnitRow } from "./api";
import { EffectiveMatrix, MemberSelect, NoAccess, RoleSelect, TreeRefSelect, WorkspaceSelect } from "./parts";

export default function MemberAccess() {
  const { api } = useOrg();
  const q = useQuery({ queryKey: KEYS.members, queryFn: () => api.get<{ members: MemberAccessRow[] }>("/access/members") });
  const roles = useRoles();
  const units = useTable<UnitRow>("org_unit");
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const roleName = (k: string) => roles.data?.roles.find((r) => r.key === k)?.name ?? k;
  const unitName = useMemo(() => new Map((units.data ?? []).map((u) => [u.id, u.name])), [units.data]);
  const needle = normalizeFa(term.trim());
  const rows = (q.data?.members ?? []).filter((m) => !needle || normalizeFa(`${m.name} ${m.email} ${m.title ?? ""}`).includes(needle));
  const legacy = (q.data?.members ?? []).filter((m) => m.is_active && m.legacy).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="دسترسی اعضا" subtitle={q.data ? `${faDigits(q.data.members.length)} عضو` : undefined} />
      {legacy ? <Note>{`${faDigits(legacy)} عضو هنوز نقشی ندارند و با دسترسی نقش عضویت خود کار می‌کنند.`}</Note> : null}
      <div className="max-w-sm">
        <Input allowClear prefix={<Search {...ICON14} aria-hidden />} placeholder="جست‌وجوی نام، ایمیل یا سمت…" value={term} onChange={(e) => setTerm(e.target.value)} />
      </div>
      {q.isLoading ? (
        <Loader />
      ) : q.isError ? (
        <NoAccess error={q.error} />
      ) : !rows.length ? (
        <EmptyState compact title="عضوی پیدا نشد" />
      ) : (
        <Table<MemberAccessRow>
          rowKey="user_id"
          size="middle"
          dataSource={rows}
          pagination={rows.length > 50 ? { pageSize: 50, showSizeChanger: false } : false}
          onRow={(r) => ({ onClick: () => setOpen(r.user_id), className: "cursor-pointer" })}
          scroll={{ x: 760 }}
          columns={[
            { title: "عضو", key: "who", render: (_, r) => <Who name={r.name} sub={r.is_active ? undefined : "(غیرفعال)"} /> },
            { title: "پرسونا", key: "persona", render: (_, r) => (r.persona ? <Chip dot={false}>{PERSONAS[r.persona]}</Chip> : <span className="text-ink-3">—</span>) },
            {
              title: "نقش‌ها",
              key: "roles",
              render: (_, r) =>
                r.legacy ? (
                  <Chip tone="warning" title="بدون نقش؛ با دسترسی نقش عضویت">
                    حالت پیشین · {MEMBERSHIP_ROLES[r.membership_role as Role]?.title ?? r.membership_role}
                  </Chip>
                ) : (
                  <span className="flex flex-wrap gap-1">{r.roles.map((k) => <Chip key={k} dot={false}>{roleName(k)}</Chip>)}</span>
                ),
            },
            { title: "واحد", key: "unit", render: (_, r) => (r.unit_id ? unitName.get(r.unit_id) ?? "—" : <span className="text-ink-3">—</span>) },
            { title: "گروه‌ها", key: "groups", align: "end", render: (_, r) => <span className="ds-num">{faDigits(r.groups)}</span> },
          ]}
        />
      )}
      <MemberSheet userId={open} onClose={() => setOpen(null)} />
    </div>
  );
}

const PROFILE_FIELDS = [
  "persona", "roles", "org_unit_id", "location_id", "manager_id", "domain_unit_id", "workspaces", "title", "phone", "vip", "skills", "language", "timezone",
  "out_of_office", "ooo_until", "delegate_id",
] as const;

function MemberSheet({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const { api } = useOrg();
  const { admin } = useAccessAdmin();
  const roles = useRoles();
  const [form] = Form.useForm();
  const [preset, setPreset] = useState<string | null>(null);
  const q = useQuery({ queryKey: KEYS.member(userId ?? ""), queryFn: () => api.get<MemberAccessDetail>(`/access/members/${userId}`), enabled: !!userId });
  const d = q.data;
  const roleName = (k: string) => roles.data?.roles.find((r) => r.key === k)?.name ?? k;
  useEffect(() => {
    form.resetFields();
    if (d) form.setFieldsValue({ persona: "requester", roles: [], workspaces: [], skills: [], vip: false, out_of_office: false, language: "fa", ...Object.fromEntries(PROFILE_FIELDS.map((k) => [k, d.profile?.[k] ?? undefined]).filter(([, v]) => v !== undefined)) });
    setPreset(null);
  }, [d, form]);
  const invalidate = [KEYS.members, KEYS.member(userId ?? ""), KEYS.me, KEYS.roles, KEYS.table("member_profile")];
  const save = useAction((v: Record<string, unknown>) => api.put<MemberAccessDetail>(`/access/members/${userId}`, { ...v, version: d?.profile?.version }), { success: "دسترسی عضو ذخیره شد.", invalidate });
  const apply = useAction((p: string) => api.post<MemberAccessDetail>(`/access/members/${userId}/preset`, { preset: p }), { success: "پیش‌تنظیم اعمال شد.", invalidate });
  const ooo = Form.useWatch("out_of_office", form);
  const eff = d?.effective;

  const profile = d ? (
    <Form form={form} layout="vertical" requiredMark={false} disabled={!admin} onFinish={(v) => save.mutate(v)}>
      {admin ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-line p-3">
          <Sparkles {...ICON14} aria-hidden className="text-ink-3" />
          <span className="text-[13px] text-ink-2">پیش‌تنظیم دسترسی</span>
          <Select className="min-w-48" value={preset} onChange={setPreset} placeholder="انتخاب…" options={PERSONA_PRESETS.map((p) => ({ value: p.key, label: p.label }))} />
          <Button disabled={!preset} loading={apply.isPending} onClick={() => preset && apply.mutate(preset)}>
            اعمال
          </Button>
        </div>
      ) : null}
      <div className="grid gap-x-3 sm:grid-cols-[1fr_2fr]">
        <Form.Item name="persona" label="پرسونا">
          <Select options={(Object.keys(PERSONAS) as Persona[]).map((p) => ({ value: p, label: PERSONAS[p] }))} />
        </Form.Item>
        <Form.Item name="roles" label="نقش‌ها">
          <RoleSelect placeholder="بدون نقش (حالت پیشین)" />
        </Form.Item>
      </div>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Form.Item name="org_unit_id" label="واحد سازمانی">
          <TreeRefSelect table="org_unit" />
        </Form.Item>
        <Form.Item name="location_id" label="مکان">
          <TreeRefSelect table="location" />
        </Form.Item>
        <Form.Item name="manager_id" label="مدیر مستقیم">
          <MemberSelect exclude={userId ? [userId] : []} />
        </Form.Item>
        <Form.Item name="domain_unit_id" label="دامنه" extra="خالی: دامنهٔ واحد سازمانی">
          <TreeRefSelect table="org_unit" domainsOnly placeholder="از واحد" />
        </Form.Item>
      </div>
      <Form.Item name="workspaces" label="فضاهای کاری (عضویت مستقیم)">
        <WorkspaceSelect multiple placeholder="فقط از راه گروه‌ها" />
      </Form.Item>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Form.Item name="title" label="سمت">
          <Input maxLength={120} />
        </Form.Item>
        <Form.Item name="phone" label="تلفن">
          <Input dir="ltr" maxLength={40} />
        </Form.Item>
      </div>
      <Form.Item name="skills" label="مهارت‌ها">
        <Select mode="tags" tokenSeparators={["،", ","]} open={false} suffixIcon={null} />
      </Form.Item>
      <div className="grid gap-x-3 sm:grid-cols-3">
        <Form.Item name="vip" label="ویژه (VIP)" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="language" label="زبان">
          <Select options={[{ value: "fa", label: "فارسی" }, { value: "en", label: "English" }]} />
        </Form.Item>
        <Form.Item name="timezone" label="منطقهٔ زمانی">
          <Input dir="ltr" placeholder="Asia/Tehran" maxLength={60} />
        </Form.Item>
      </div>
      <Section title="غیبت و جانشین">
        <div className="grid gap-x-3 sm:grid-cols-3">
          <Form.Item name="out_of_office" label="خارج از دفتر" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="ooo_until" label="تا تاریخ">
            <DateInput disabled={!ooo || !admin} allowClear />
          </Form.Item>
          <Form.Item name="delegate_id" label="جانشین" extra="رکوردهای ارجاع‌شده به این عضو را در غیبتش می‌بیند و تغییر می‌دهد.">
            <MemberSelect exclude={userId ? [userId] : []} />
          </Form.Item>
        </div>
      </Section>
      {admin ? (
        <Button type="primary" htmlType="submit" loading={save.isPending} className="mt-2">
          ذخیره
        </Button>
      ) : null}
    </Form>
  ) : null;

  const effective = eff ? (
    <div className="flex flex-col gap-4">
      {eff.legacy ? <Note tone="warning">این عضو نقشی ندارد؛ در بخش‌های پایه با دسترسی نقش عضویت و در بقیه مانند نقش متناظر آن کار می‌کند.</Note> : null}
      <Section title="از کجا">
        <ul className="flex flex-col gap-1.5 text-[13px]">
          {d!.sources.profile.length ? (
            <li>
              <span className="text-ink-3">نقش‌های خود عضو: </span>
              {d!.sources.profile.map(roleName).join("، ")}
            </li>
          ) : null}
          {d!.sources.groups.map((g) => (
            <li key={g.group_id}>
              <span className="text-ink-3">از گروه «{d!.groups.find((x) => x.group_id === g.group_id)?.name}»: </span>
              {g.roles.map(roleName).join("، ")}
            </li>
          ))}
          {d!.sources.membership.length ? (
            <li>
              <span className="text-ink-3">از نقش عضویت «{MEMBERSHIP_ROLES[d!.member.membership_role as Role]?.title}»: </span>
              {d!.sources.membership.map(roleName).join("، ")}
            </li>
          ) : null}
          <li>
            <span className="text-ink-3">همهٔ نقش‌ها (با نقش‌های دربرگرفته): </span>
            {eff.roles.map(roleName).join("، ") || "—"}
          </li>
        </ul>
      </Section>
      <Section title="گروه‌ها">
        {d!.groups.length ? (
          <span className="flex flex-wrap gap-1.5">
            {d!.groups.map((g) => (
              <Chip key={g.id} tone={g.kind === "lead" ? "accent" : "neutral"} dot={false}>
                {g.name} · {MEMBER_KINDS.find((k) => k.value === g.kind)?.label}
              </Chip>
            ))}
          </span>
        ) : (
          <span className="text-[13px] text-ink-3">عضو هیچ گروهی نیست.</span>
        )}
      </Section>
      <Section title="مجوزهای مؤثر">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {eff.field_groups.map((g) => (
            <Chip key={g} dot={false}>{FIELD_GROUPS[g]}</Chip>
          ))}
          <Chip tone={eff.workspaces_all ? "accent" : "neutral"} dot={false}>{eff.workspaces_all ? "همهٔ فضاهای کاری" : `${faDigits(eff.workspaces.length)} فضای کاری`}</Chip>
          {eff.settings.domain_separation ? <Chip dot={false}>{eff.domains_all ? "همهٔ دامنه‌ها" : "دامنهٔ خود"}</Chip> : null}
          {eff.delegators.length ? <Chip tone="warning" dot={false}>{`جانشین ${faDigits(eff.delegators.length)} نفر`}</Chip> : null}
        </div>
        <EffectiveMatrix grants={eff.grants} />
        <p className="mt-2 text-[12px] text-ink-3">ستون‌ها: {(["read", "create", "write", "delete", "approve", "admin"] as const).map((o) => OP_LABELS[o]).join("، ")}</p>
      </Section>
    </div>
  ) : null;

  return (
    <Drawer open={!!userId} onClose={onClose} size={720} destroyOnHidden title={d ? d.member.name : "دسترسی عضو"}>
      {q.isLoading || !d ? (
        <Loader />
      ) : (
        <Tabs
          items={[
            { key: "profile", label: "نقش‌ها و نمایه", children: profile },
            { key: "effective", label: "دسترسی مؤثر", children: effective },
          ]}
        />
      )}
    </Drawer>
  );
}
