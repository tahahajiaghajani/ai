// Building blocks of the access pages: pickers over the org structure and the directory, tree data for antd, kind
// icons, scope labels and the read-only matrix of an effective access (areas × operations).
import { useMemo, type ReactNode } from "react";
import { Select, TreeSelect, Tooltip } from "antd";
import {
  Building2, Network, Users, UsersRound, Wallet, Store, Globe2, Flag, Map as MapIcon, MapPin, Building, Layers, DoorOpen, Landmark,
  Check, Minus, type LucideIcon,
} from "lucide-react";
import { areas, AREA_GROUPS, OPS, OP_LABELS, SCOPE_HINTS, SCOPE_LABELS, SCOPED_OPS, type FullGrant, type Scope } from "@shared/access";
import { normalizeFa } from "../../lib/fa";
import { ICON14, cx } from "../../components/blocks";
import { EmptyState } from "../../components/display";
import { useMembers, useRoles, useTable, type GroupRow, type Rec, type UnitRow, type WorkspaceRow } from "./api";

export const UNIT_ICON: Record<string, LucideIcon> = {
  company: Building2,
  division: Landmark,
  department: Network,
  team: UsersRound,
  cost_center: Wallet,
  branch: Store,
};

export const LOCATION_ICON: Record<string, LucideIcon> = {
  region: Globe2,
  country: Flag,
  province: MapIcon,
  city: Building,
  site: MapPin,
  building: Building2,
  floor: Layers,
  room: DoorOpen,
};

export interface TreeNode<T> {
  key: string;
  row: T;
  children: TreeNode<T>[];
}

/** Rows with parent_id → a forest, siblings by name (a row whose parent is missing becomes a root). */
export function forest<T extends Rec & { parent_id: string | null; name: string }>(rows: T[]): TreeNode<T>[] {
  const byId = new Map(rows.map((r) => [r.id, { key: r.id, row: r, children: [] as TreeNode<T>[] }]));
  const roots: TreeNode<T>[] = [];
  for (const n of byId.values()) {
    const parent = n.row.parent_id ? byId.get(n.row.parent_id) : undefined;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  const sort = (xs: TreeNode<T>[]) => {
    xs.sort((a, b) => a.row.name.localeCompare(b.row.name, "fa"));
    for (const x of xs) sort(x.children);
  };
  sort(roots);
  return roots;
}

/** The ids of a node and every node below it. */
export function subtreeIds<T>(n: TreeNode<T>): string[] {
  return [n.key, ...n.children.flatMap(subtreeIds)];
}

function selectTree<T extends Rec & { parent_id: string | null; name: string }>(rows: T[], icon?: (r: T) => ReactNode, disabled?: Set<string>) {
  const map = (n: TreeNode<T>): Record<string, unknown> => ({
    value: n.key,
    title: (
      <span className="inline-flex items-center gap-1.5">
        {icon?.(n.row)}
        {n.row.name}
      </span>
    ),
    label: n.row.name,
    disabled: disabled?.has(n.key),
    children: n.children.map(map),
  });
  return forest(rows).map(map);
}

const filterLabel = (input: string, node: { label?: unknown }) => normalizeFa(String(node.label ?? "")).includes(normalizeFa(input));

/** A unit (or location) from its tree. */
export function TreeRefSelect({ table, value, onChange, placeholder, exclude, allowClear = true, domainsOnly }: {
  table: "org_unit" | "location";
  value?: string | null;
  onChange?: (v: string | null) => void;
  placeholder?: string;
  /** ids that may not be picked (a node and its subtree when choosing its own parent) */
  exclude?: Set<string>;
  allowClear?: boolean;
  domainsOnly?: boolean;
}) {
  const rows = useTable<UnitRow>(table);
  const icons = table === "org_unit" ? UNIT_ICON : LOCATION_ICON;
  const data = useMemo(() => {
    const all = rows.data ?? [];
    const disabled = new Set(exclude ?? []);
    if (domainsOnly) for (const r of all) if (!r.is_domain) disabled.add(r.id);
    return selectTree(all, (r) => {
      const I = icons[r.kind] ?? Network;
      return <I {...ICON14} aria-hidden className="text-ink-3" />;
    }, disabled);
  }, [rows.data, exclude, icons, domainsOnly]);
  return (
    <TreeSelect
      value={value ?? undefined}
      onChange={(v) => onChange?.((v as string) ?? null)}
      treeData={data as never}
      treeDefaultExpandAll
      showSearch={{ filterTreeNode: filterLabel as never }}
      treeNodeLabelProp="label"
      allowClear={allowClear}
      loading={rows.isLoading}
      placeholder={placeholder ?? "انتخاب…"}
      className="w-full"
      popupMatchSelectWidth
    />
  );
}

/** One or several members of the organisation. */
export function MemberSelect({ value, onChange, multiple, placeholder, exclude }: {
  value?: string | string[] | null;
  onChange?: (v: any) => void;
  multiple?: boolean;
  placeholder?: string;
  exclude?: string[];
}) {
  const members = useMembers();
  const options = useMemo(
    () =>
      (members.data ?? [])
        .filter((m) => !exclude?.includes(m.id))
        .map((m) => ({ value: m.id, label: m.name || m.email, search: `${m.name} ${m.email}`, disabled: !m.is_active })),
    [members.data, exclude],
  );
  return (
    <Select
      mode={multiple ? "multiple" : undefined}
      value={value ?? undefined}
      onChange={(v) => onChange?.(v ?? (multiple ? [] : null))}
      options={options}
      showSearch={{ filterOption: (input, o) => normalizeFa(String((o as { search?: string })?.search ?? "")).includes(normalizeFa(input)) }}
      allowClear
      loading={members.isLoading}
      placeholder={placeholder ?? "جست‌وجوی نام یا ایمیل…"}
      className="w-full"
      maxTagCount="responsive"
    />
  );
}

/** A group (or several). */
export function GroupSelect({ value, onChange, multiple, exclude, placeholder }: { value?: string | string[] | null; onChange?: (v: any) => void; multiple?: boolean; exclude?: Set<string>; placeholder?: string }) {
  const groups = useTable<GroupRow>("group");
  const data = useMemo(() => selectTree(groups.data ?? [], undefined, exclude), [groups.data, exclude]);
  return (
    <TreeSelect
      multiple={multiple}
      value={value ?? undefined}
      onChange={(v) => onChange?.(v ?? (multiple ? [] : null))}
      treeData={data as never}
      treeDefaultExpandAll
      showSearch={{ filterTreeNode: filterLabel as never }}
      treeNodeLabelProp="label"
      allowClear
      loading={groups.isLoading}
      placeholder={placeholder ?? "انتخاب گروه…"}
      className="w-full"
      maxTagCount="responsive"
    />
  );
}

/** A workspace (or several). */
export function WorkspaceSelect({ value, onChange, multiple, placeholder }: { value?: string | string[] | null; onChange?: (v: any) => void; multiple?: boolean; placeholder?: string }) {
  const rows = useTable<WorkspaceRow>("workspace");
  return (
    <Select
      mode={multiple ? "multiple" : undefined}
      value={value ?? undefined}
      onChange={(v) => onChange?.(v ?? (multiple ? [] : null))}
      options={(rows.data ?? []).map((w) => ({ value: w.id, label: w.secure ? `${w.name} (امن)` : w.name, disabled: !w.active }))}
      allowClear
      loading={rows.isLoading}
      placeholder={placeholder ?? "انتخاب فضای کاری…"}
      className="w-full"
    />
  );
}

/** Roles of the organisation's catalogue. */
export function RoleSelect({ value, onChange, exclude, placeholder }: { value?: string[]; onChange?: (v: string[]) => void; exclude?: string[]; placeholder?: string }) {
  const roles = useRoles();
  const options = (roles.data?.roles ?? [])
    .filter((r) => !exclude?.includes(r.key))
    .map((r) => ({ value: r.key, label: r.name, disabled: r.active === false }));
  return (
    <Select
      mode="multiple"
      value={value ?? []}
      onChange={(v) => onChange?.(v)}
      options={options}
      showSearch={{ filterOption: (input, o) => normalizeFa(String(o?.label ?? "")).includes(normalizeFa(input)) }}
      loading={roles.isLoading}
      placeholder={placeholder ?? "انتخاب نقش‌ها…"}
      className="w-full"
      maxTagCount="responsive"
    />
  );
}

export const scopeOptions = (min: Scope = "none") =>
  (Object.keys(SCOPE_LABELS) as Scope[]).slice((Object.keys(SCOPE_LABELS) as Scope[]).indexOf(min)).map((s) => ({ value: s, label: SCOPE_LABELS[s], title: SCOPE_HINTS[s] }));

/** One cell of a matrix: a scope word, a check or a dash. */
export function GrantCell({ g, op }: { g: FullGrant; op: (typeof OPS)[number] }) {
  if ((SCOPED_OPS as readonly string[]).includes(op)) {
    const s = g[op as "read"] as Scope;
    if (s === "none") return <Minus {...ICON14} aria-label="هیچ" className="text-ink-4" />;
    return (
      <Tooltip title={SCOPE_HINTS[s]}>
        <span className={cx("text-[12px]", s === "all" ? "text-ink" : "text-ink-2")}>{SCOPE_LABELS[s]}</span>
      </Tooltip>
    );
  }
  return g[op as "create"] ? <Check {...ICON14} aria-label="بله" className="text-in" /> : <Minus {...ICON14} aria-label="خیر" className="text-ink-4" />;
}

/** The effective grants of a subject, area by area (only areas with something unless `all`). */
export function EffectiveMatrix({ grants, all }: { grants: Record<string, FullGrant>; all?: boolean }) {
  const list = areas().filter((a) => all || (grants[a.key] && grants[a.key].read !== "none"));
  if (!list.length) return <p className="text-[13px] text-ink-3">در هیچ حوزه‌ای دسترسی ندارد.</p>;
  let lastGroup = "";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-[13px]">
        <thead>
          <tr className="text-ink-3">
            <th className="py-1.5 pe-3 text-start font-normal">حوزه</th>
            {OPS.map((op) => (
              <th key={op} className="px-2 py-1.5 text-center font-normal">
                {OP_LABELS[op]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.map((a) => {
            const g = grants[a.key];
            const head = a.group !== lastGroup;
            lastGroup = a.group;
            return [
              head ? (
                <tr key={`g-${a.group}`}>
                  <td colSpan={OPS.length + 1} className="pt-3 pb-1 text-[12px] text-ink-3">
                    {AREA_GROUPS[a.group]}
                  </td>
                </tr>
              ) : null,
              <tr key={a.key} className="border-t border-line">
                <td className="py-1.5 pe-3 text-ink">{a.label}</td>
                {OPS.map((op) => (
                  <td key={op} className="px-2 py-1.5 text-center">
                    {g ? <GrantCell g={g} op={op} /> : <Minus {...ICON14} className="text-ink-4" />}
                  </td>
                ))}
              </tr>,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A small icon + label for a unit or location kind. */
export function KindLabel({ icon: I, label }: { icon?: LucideIcon; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-ink-2">
      {I ? <I {...ICON14} aria-hidden /> : null}
      {label}
    </span>
  );
}

export { Users };

/** What a page shows when the server refuses the caller (their roles do not reach this part of the settings). */
export function NoAccess({ error }: { error: unknown }) {
  const status = (error as { status?: number } | null)?.status;
  return (
    <EmptyState
      title={status === 403 ? "به این بخش دسترسی ندارید" : "این بخش بار نشد"}
      description={status === 403 ? "دیدن و تغییر آن با مدیر سامانه است." : undefined}
    />
  );
}
