// «گروه‌ها»: assignment, approval, CAB and on-call groups — workspace, parent, manager, restricted flag and the roles
// their members inherit — with their members (bulk add, member / lead / observer, removal). Admins of the org
// structure change everything; a team lead changes the memberships of the groups they work in.
import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Drawer, Form, Input, Select, Switch, Table, Popconfirm, Tabs } from "antd";
import { Plus, Search, Trash2, ShieldAlert } from "lucide-react";
import { GROUP_NOTIFY_OPTIONS, GROUP_TYPES, MEMBER_KINDS } from "@shared/tables/access";
import { groupNotifyWarning, type GroupNotifyMode } from "@shared/notify";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { normalizeFa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Loader } from "../../components/display";
import { ICON, ICON14, Who } from "../../components/blocks";
import { KEYS, useAccessAdmin, useMembers, useMyAccess, useRoles, useTable, type GroupRow, type Rec, type WorkspaceRow } from "./api";
import { forest, GroupSelect, MemberSelect, NoAccess, RoleSelect, subtreeIds, WorkspaceSelect, type TreeNode } from "./parts";

interface Membership extends Rec {
  group_id: string;
  user_id: string;
  kind: "member" | "lead" | "observer";
  valid_to: string | null;
}

const typeLabel = (v: string) => GROUP_TYPES.find((o) => o.value === v)?.label ?? v;

export default function Groups() {
  const groups = useTable<GroupRow>("group");
  const memberships = useTable<Membership>("group_member");
  const workspaces = useTable<WorkspaceRow>("workspace");
  const members = useMembers();
  const { manageOrg } = useAccessAdmin();
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState<string | "new" | null>(null);
  const names = useMemo(() => new Map((members.data ?? []).map((m) => [m.id, m.name || m.email])), [members.data]);
  const wsName = useMemo(() => new Map((workspaces.data ?? []).map((w) => [w.id, w.name])), [workspaces.data]);
  const count = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of memberships.data ?? []) m.set(x.group_id, (m.get(x.group_id) ?? 0) + 1);
    return m;
  }, [memberships.data]);
  const needle = normalizeFa(term.trim());
  const rows = (groups.data ?? []).filter((g) => !needle || normalizeFa(`${g.name} ${g.email ?? ""}`).includes(needle)).sort((a, b) => a.name.localeCompare(b.name, "fa"));
  const parentName = (id: string | null) => (id ? groups.data?.find((g) => g.id === id)?.name ?? "—" : null);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="گروه‌ها"
        subtitle={groups.data ? `${faDigits(groups.data.length)} گروه` : undefined}
        actions={
          manageOrg ? (
            <Button type="primary" icon={<Plus {...ICON} />} onClick={() => setOpen("new")}>
              گروه تازه
            </Button>
          ) : null
        }
      />
      <div className="max-w-sm">
        <Input allowClear prefix={<Search {...ICON14} aria-hidden />} placeholder="جست‌وجوی نام گروه…" value={term} onChange={(e) => setTerm(e.target.value)} />
      </div>
      {groups.isLoading ? (
        <Loader />
      ) : groups.isError ? (
        <NoAccess error={groups.error} />
      ) : !groups.data?.length ? (
        <EmptyState title="هنوز گروهی تعریف نشده است" action={manageOrg ? <Button type="primary" onClick={() => setOpen("new")}>گروه نخست</Button> : undefined} />
      ) : (
        <Table<GroupRow>
          rowKey="id"
          size="middle"
          dataSource={rows}
          pagination={rows.length > 50 ? { pageSize: 50, showSizeChanger: false } : false}
          onRow={(r) => ({ onClick: () => setOpen(r.id), className: "cursor-pointer" })}
          scroll={{ x: 720 }}
          columns={[
            {
              title: "نام",
              key: "name",
              render: (_, r) => (
                <span className="inline-flex flex-col">
                  <span className="inline-flex items-center gap-2 text-ink">
                    {r.name}
                    {r.restricted ? (
                      <Chip tone="warning" dot={false}>
                        <span className="inline-flex items-center gap-1">
                          <ShieldAlert {...ICON14} aria-hidden /> محدود
                        </span>
                      </Chip>
                    ) : null}
                    {!r.active ? <Chip dot={false}>غیرفعال</Chip> : null}
                  </span>
                  {r.parent_id ? <span className="text-[12px] text-ink-3">زیر «{parentName(r.parent_id)}»</span> : null}
                </span>
              ),
            },
            { title: "نوع", key: "types", render: (_, r) => <span className="flex flex-wrap gap-1">{(r.types ?? []).map((t) => <Chip key={t} dot={false}>{typeLabel(t)}</Chip>)}</span> },
            { title: "فضای کاری", key: "ws", render: (_, r) => (r.workspace_id ? wsName.get(r.workspace_id) ?? "—" : <span className="text-ink-3">همهٔ فضاها</span>) },
            { title: "مدیر", key: "manager", render: (_, r) => <Who name={r.manager_id ? names.get(r.manager_id) : null} /> },
            { title: "اعضا", key: "n", align: "end", render: (_, r) => <span className="ds-num">{faDigits(count.get(r.id) ?? 0)}</span> },
          ]}
        />
      )}
      <GroupDrawer
        open={open}
        onClose={() => setOpen(null)}
        group={open && open !== "new" ? groups.data?.find((g) => g.id === open) ?? null : null}
        groups={groups.data ?? []}
        memberships={(memberships.data ?? []).filter((m) => m.group_id === open)}
        names={names}
        onCreated={(id) => setOpen(id)}
      />
    </div>
  );
}

function GroupDrawer({ open, onClose, group, groups, memberships, names, onCreated }: {
  open: string | null;
  onClose: () => void;
  group: GroupRow | null;
  groups: GroupRow[];
  memberships: Membership[];
  names: Map<string, string>;
  onCreated: (id: string) => void;
}) {
  const { api } = useOrg();
  const me = useMyAccess();
  const roles = useRoles();
  const { manageOrg } = useAccessAdmin();
  const [form] = Form.useForm();
  const [adding, setAdding] = useState<string[]>([]);
  const [kind, setKind] = useState<Membership["kind"]>("member");
  const isNew = open === "new";
  const roleName = (k: string) => roles.data?.roles.find((r) => r.key === k)?.name ?? k;
  const orgGrant = me.data?.grants.org;
  const canMembers = !!group && (manageOrg || (!!orgGrant && orgGrant.write !== "none" && orgGrant.create && !!me.data?.write_groups.includes(group.id)));

  useEffect(() => {
    form.resetFields();
    if (group) form.setFieldsValue(group);
    else form.setFieldsValue({ types: ["assignment"], active: true, restricted: false, roles: [], notify_mode: "auto" });
    setAdding([]);
  }, [group?.id, group?.version, open, form]); // eslint-disable-line react-hooks/exhaustive-deps

  const excluded = useMemo(() => {
    if (!group) return undefined;
    const find = (xs: TreeNode<GroupRow>[]): TreeNode<GroupRow> | undefined => {
      for (const x of xs) {
        if (x.key === group.id) return x;
        const hit = find(x.children);
        if (hit) return hit;
      }
      return undefined;
    };
    const node = find(forest(groups));
    return new Set(node ? subtreeIds(node) : [group.id]);
  }, [group, groups]);

  const save = useAction(
    (v: Record<string, unknown>) => (group ? api.patch<{ row: Rec }>(`/r/group/${group.id}`, { ...v, version: group.version }) : api.post<{ row: Rec }>(`/r/group`, v)),
    { success: "گروه ذخیره شد.", invalidate: [KEYS.table("group"), KEYS.me, KEYS.roles], onSuccess: (r) => isNew && onCreated(r.row.id) },
  );
  const remove = useAction(() => api.del(`/r/group/${group!.id}?version=${group!.version}`), { success: "گروه حذف شد.", invalidate: [KEYS.table("group"), KEYS.me], onSuccess: onClose });
  const add = useAction(() => api.post<{ added: number; updated: number }>(`/access/groups/${group!.id}/members`, { user_ids: adding, kind }), {
    success: (r) => `${faDigits(r.added)} عضو افزوده شد${r.updated ? `، ${faDigits(r.updated)} عضویت تغییر کرد` : ""}.`,
    invalidate: [KEYS.table("group_member"), KEYS.me, KEYS.members],
    onSuccess: () => setAdding([]),
  });
  const setKindOf = useAction(({ m, k }: { m: Membership; k: string }) => api.patch(`/r/group_member/${m.id}`, { kind: k, version: m.version }), {
    invalidate: [KEYS.table("group_member"), KEYS.me],
  });
  const drop = useAction((m: Membership) => api.del(`/r/group_member/${m.id}?version=${m.version}`), { success: "از گروه برداشته شد.", invalidate: [KEYS.table("group_member"), KEYS.me, KEYS.members] });

  // a large group under «خودکار» without a lead or a manager notifies every member (and «فقط سرپرستان» nobody)
  const notifyMode = Form.useWatch("notify_mode", form) as GroupNotifyMode | undefined;
  const managerId = Form.useWatch("manager_id", form) as string | null | undefined;
  const notifyWarning = group ? groupNotifyWarning(notifyMode ?? "auto", memberships.length, !!managerId || memberships.some((m) => m.kind === "lead")) : null;

  const details = (
    <Form form={form} layout="vertical" requiredMark={false} disabled={!manageOrg} onFinish={(v) => save.mutate(v)}>
      <Form.Item name="name" label="نام" rules={[{ required: true, message: "نام گروه را بنویسید." }]}>
        <Input maxLength={120} />
      </Form.Item>
      <Form.Item name="types" label="نوع">
        <Select mode="multiple" options={GROUP_TYPES.map((o) => ({ value: o.value, label: o.label }))} />
      </Form.Item>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Form.Item name="workspace_id" label="فضای کاری">
          <WorkspaceSelect placeholder="همهٔ فضاها" />
        </Form.Item>
        <Form.Item name="parent_id" label="گروه بالادستی" extra="سرپرستان گروه بالادستی کار گروه‌های زیرین را هم می‌بینند.">
          <GroupSelect exclude={excluded} placeholder="بدون بالادستی" />
        </Form.Item>
        <Form.Item name="manager_id" label="مدیر گروه">
          <MemberSelect />
        </Form.Item>
        <Form.Item name="email" label="ایمیل گروه">
          <Input dir="ltr" type="email" />
        </Form.Item>
      </div>
      <Form.Item name="roles" label="نقش‌های اعضا" extra="اعضا و سرپرستان گروه (نه ناظران) این نقش‌ها را هم دارند.">
        <RoleSelect />
      </Form.Item>
      <Form.Item name="skills" label="مهارت‌ها">
        <Select mode="tags" tokenSeparators={["،", ","]} open={false} suffixIcon={null} />
      </Form.Item>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Form.Item name="restricted" label="گروه محدود" valuePropName="checked" extra="رکوردهای ارجاع‌شده به آن را فقط اعضای گروه و درخواست‌دهنده می‌بینند.">
          <Switch />
        </Form.Item>
        <Form.Item name="active" label="فعال" valuePropName="checked">
          <Switch />
        </Form.Item>
      </div>
      <Form.Item name="notify_mode" label="اعلان ارجاع به گروه">
        <Select options={GROUP_NOTIFY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
      </Form.Item>
      {notifyWarning ? <Alert type="warning" showIcon className="mb-4" title={notifyWarning} /> : null}
      <Form.Item name="description" label="شرح">
        <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
      </Form.Item>
      {manageOrg ? (
        <div className="flex items-center gap-2">
          <Button type="primary" htmlType="submit" loading={save.isPending}>
            ذخیره
          </Button>
          {group ? (
            <Popconfirm title="این گروه حذف شود؟" okText="حذف" cancelText="انصراف" okButtonProps={{ danger: true }} onConfirm={() => remove.mutate()}>
              <Button danger type="text" icon={<Trash2 {...ICON14} />} className="ms-auto">
                حذف گروه
              </Button>
            </Popconfirm>
          ) : null}
        </div>
      ) : null}
    </Form>
  );

  const people = (
    <div className="flex flex-col gap-3">
      {canMembers ? (
        <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
          <MemberSelect multiple value={adding} onChange={setAdding} exclude={memberships.map((m) => m.user_id)} placeholder="افزودن اعضا…" />
          <div className="flex items-center gap-2">
            <Select value={kind} onChange={setKind} options={MEMBER_KINDS.map((o) => ({ value: o.value, label: o.label }))} className="w-32" />
            <Button type="primary" disabled={!adding.length} loading={add.isPending} onClick={() => add.mutate()}>
              افزودن {adding.length ? `${faDigits(adding.length)} نفر` : ""}
            </Button>
          </div>
        </div>
      ) : null}
      {memberships.length ? (
        <ul className="flex flex-col divide-y divide-[var(--ds-line)]">
          {[...memberships]
            .sort((a, b) => (a.kind === "lead" ? -1 : 0) - (b.kind === "lead" ? -1 : 0) || (names.get(a.user_id) ?? "").localeCompare(names.get(b.user_id) ?? "", "fa"))
            .map((m) => (
              <li key={m.id} className="flex items-center gap-2 py-2">
                <Who name={names.get(m.user_id) ?? "—"} />
                <span className="ms-auto" />
                {canMembers ? (
                  <Select size="small" value={m.kind} onChange={(k) => setKindOf.mutate({ m, k })} options={MEMBER_KINDS.map((o) => ({ value: o.value, label: o.label }))} className="w-28" />
                ) : (
                  <Chip dot={false}>{MEMBER_KINDS.find((o) => o.value === m.kind)?.label}</Chip>
                )}
                {canMembers ? (
                  <Popconfirm title="از گروه برداشته شود؟" okText="بردار" cancelText="انصراف" onConfirm={() => drop.mutate(m)}>
                    <Button type="text" size="small" aria-label="برداشتن از گروه" icon={<Trash2 {...ICON14} />} />
                  </Popconfirm>
                ) : null}
              </li>
            ))}
        </ul>
      ) : (
        <EmptyState compact title="این گروه هنوز عضوی ندارد" />
      )}
      {group?.roles?.length ? <p className="text-[12px] text-ink-3">اعضا این نقش‌ها را هم دارند: {group.roles.map(roleName).join("، ")}</p> : null}
    </div>
  );

  return (
    <Drawer open={!!open} onClose={onClose} size={560} destroyOnHidden title={isNew ? "گروه تازه" : group?.name ?? "گروه"}>
      {isNew ? (
        details
      ) : (
        <Tabs
          items={[
            { key: "people", label: `اعضا (${faDigits(memberships.length)})`, children: people },
            { key: "details", label: "مشخصات", children: details },
          ]}
        />
      )}
    </Drawer>
  );
}
