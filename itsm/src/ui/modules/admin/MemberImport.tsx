// «ورود گروهی اعضا»: people from a spreadsheet (CSV or XLSX) — e-mail, name, title, phone, unit, manager and groups —
// checked first (a dry run lists what would be created, updated or skipped and why), then imported in one go. New
// members get the membership chosen here; an ITSM role only when the administrator names one (never by default).
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Button, Checkbox, Form, Radio, Select } from "antd";
import { FileSpreadsheet } from "lucide-react";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { ImportSheet, type ImportTarget } from "../../components/import";
import { Card, ICON, Note } from "../../components/blocks";
import { useRoles } from "../access/api";

interface RowResult {
  row: number;
  email: string;
  action: "create" | "update" | "skip";
  message?: string;
}

const FIELDS = [
  { name: "email", label: "ایمیل", required: true },
  { name: "name", label: "نام و نام خانوادگی", required: true },
  { name: "title", label: "سمت" },
  { name: "phone", label: "تلفن" },
  { name: "unit", label: "واحد سازمانی" },
  { name: "manager", label: "ایمیل مدیر" },
  { name: "groups", label: "گروه‌ها (جداشده با ویرگول)" },
];

export default function MemberImport() {
  const { api, orgId, can } = useOrg();
  const roles = useRoles();
  const [open, setOpen] = useState(false);
  const [membership, setMembership] = useState<"member" | "viewer">("viewer");
  const [role, setRole] = useState<string | null>(null);
  const [createUnits, setCreateUnits] = useState(false);

  const target = useMemo<ImportTarget>(
    () => ({
      plural: "اعضا",
      fields: FIELDS,
      updateLabel: null,
      batch: 2000,
      invalidate: [["access"], ["admin"]],
      run: async (rows, o) => {
        const r = await api.post<{ created: number; updated: number; skipped: number; rows: RowResult[] }>("/admin/members/import", {
          rows: rows.map((x) => ({ ...x, groups: (x.groups ?? "").split(/[,،]/).map((g) => g.trim()).filter(Boolean) })),
          dry_run: o.dry,
          membership_role: membership,
          role,
          create_units: createUnits,
        });
        return {
          created: r.created,
          updated: r.updated,
          failed: r.skipped,
          results: r.rows.map((x) => ({ row: o.offset + x.row - 1, ok: x.action !== "skip", action: x.action === "skip" ? undefined : x.action, label: x.email, error: x.message })),
        };
      },
    }),
    [api, membership, role, createUnits],
  );

  const roleOptions = (roles.data?.roles ?? []).filter((r) => r.key !== "tenant_admin").map((r) => ({ value: r.key, label: r.name }));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="ورود گروهی اعضا"
        actions={
          can("users", "edit") ? (
            <Button type="primary" icon={<FileSpreadsheet {...ICON} />} onClick={() => setOpen(true)}>
              انتخاب فایل
            </Button>
          ) : undefined
        }
      />
      <Card title="اعضای تازه">
        <Form layout="vertical" className="max-w-xl">
          <Form.Item label="عضویت">
            <Radio.Group value={membership} onChange={(e) => setMembership(e.target.value)}>
              <Radio value="viewer">بیننده</Radio>
              <Radio value="member">عضو</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item label="نقش" extra="بدون انتخاب، نقشی داده نمی‌شود و مدیر بعداً نقش هر نفر را تعیین می‌کند.">
            <Select allowClear value={role ?? undefined} onChange={(v) => setRole(v ?? null)} options={roleOptions} placeholder="بدون نقش" loading={roles.isLoading} />
          </Form.Item>
          <Form.Item>
            <Checkbox checked={createUnits} onChange={(e) => setCreateUnits(e.target.checked)}>
              واحدهای ناموجود ساخته شوند
            </Checkbox>
          </Form.Item>
        </Form>
        <Note>
          پیش از ورود، بررسی آزمایشی نشان می‌دهد چه کسانی افزوده، به‌روز یا کنار گذاشته می‌شوند. اعضای فهرست کاربران (LDAP و SCIM) را از <Link to={`/${orgId}/integrations/directory`}>فهرست کاربران</Link> همگام کنید.
        </Note>
      </Card>
      <ImportSheet target={target} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
