// Chart of accounts (کدینگ حساب‌ها): group → general → subsidiary as a keyboard-navigable tree with each account's
// kind, nature, dimensions (subsidiary, currency, gold weight, automatic-posting role) and how many lines it carries.
// ↑/↓ move, ← opens a branch and → closes it (mirrored for RTL), Enter edits.
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button, Drawer, Dropdown, Form, Input, Select, Switch, Tooltip } from "antd";
import { Plus, Pencil, Trash2, Search, Download, ChevronLeft, ListTree, ChevronsDownUp, ChevronsUpDown, Ellipsis } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { useAction, useNotify } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { EmptyState, Skeleton } from "../../components/display";
import { faDigits } from "@shared/format";
import { exportExcel } from "../../lib/excel";
import { matchesFa, normalizeFa } from "../../lib/fa";
import { ICON, ICON14, cx } from "../reports/kit";
import { KIND_LABEL, NATURE_LABEL, DETAIL_KINDS } from "./labels";

interface Acc {
  id: string;
  parent_id: string | null;
  code: string;
  name: string;
  level: number;
  kind: string;
  nature: string;
  is_postable: boolean;
  detail_mode: string;
  detail_kinds: string[];
  fx_mode: string;
  weight_mode: string;
  system_key: string | null;
  is_active: boolean;
  line_count: number;
  description: string | null;
}

const LEVEL = ["", "گروه", "کل", "معین"];
const MODE = [
  { value: "none", label: "ندارد" },
  { value: "optional", label: "اختیاری" },
  { value: "required", label: "الزامی" },
];

/** Highlights the matched words of a name (ink at 600, never Dusk). */
function Hl({ text, q }: { text: string; q: string }) {
  const words = normalizeFa(q).split(" ").filter(Boolean);
  if (!words.length) return <>{text}</>;
  const parts = text.split(/(\s+)/);
  return (
    <>
      {parts.map((p, i) => (words.some((w) => normalizeFa(p).includes(w)) && p.trim() ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>))}
    </>
  );
}

export default function Accounts() {
  const { api, can } = useOrg();
  const q = useQuery({ queryKey: ["accounts"], queryFn: () => api.get<{ accounts: Acc[] }>("/accounting/accounts").then((r) => r.accounts) });
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<Partial<Acc> | null>(null);
  const [open, setOpen] = useState<Set<string> | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const n = useNotify();
  const full = can("accounting", "full");
  const del = useAction((id: string) => api.del(`/accounting/accounts/${id}`), { success: "حساب حذف شد.", invalidate: [["accounts"]] });
  const addChild = (a: Acc) => setEdit({ parent_id: a.id, kind: a.kind, nature: a.nature, level: a.level + 1 });
  const remove = async (a: Acc) => {
    if (await n.confirm(`حذف حساب «${a.name}»؟`, "این حساب گردشی ندارد و از کدینگ برداشته می‌شود.", true)) del.mutate(a.id);
  };
  const accounts = q.data ?? [];

  const kids = useMemo(() => {
    const m = new Map<string | null, Acc[]>();
    for (const a of accounts) m.set(a.parent_id, [...(m.get(a.parent_id) ?? []), a]);
    for (const list of m.values()) list.sort((x, y) => x.code.localeCompare(y.code, "en", { numeric: true }));
    return m;
  }, [accounts]);
  const expanded = open ?? new Set(accounts.filter((a) => a.level === 1).map((a) => a.id));

  // the visible rows, depth-first; a search shows every match with its ancestors, all open
  const rows = useMemo(() => {
    const s = search.trim();
    const hit = (a: Acc) => matchesFa(a.name, s) || a.code.startsWith(s.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))));
    const keep = (a: Acc): boolean => !s || hit(a) || (kids.get(a.id) ?? []).some(keep);
    const out: { a: Acc; depth: number; hasKids: boolean; last: boolean[] }[] = [];
    const walk = (pid: string | null, depth: number, last: boolean[]) => {
      const list = (kids.get(pid) ?? []).filter(keep);
      list.forEach((a, i) => {
        const hasKids = (kids.get(a.id) ?? []).some(keep);
        const isLast = i === list.length - 1;
        out.push({ a, depth, hasKids, last: [...last, isLast] });
        if (hasKids && (s || expanded.has(a.id))) walk(a.id, depth + 1, [...last, isLast]);
      });
    };
    walk(null, 0, []);
    return out;
  }, [kids, search, expanded]);

  const toggle = (id: string, to?: boolean) => {
    const next = new Set(expanded);
    const on = to ?? !next.has(id);
    if (on) next.add(id);
    else next.delete(id);
    setOpen(next);
  };
  const focusRow = (id: string) => {
    setCursor(id);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus());
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>, i: number) => {
    const r = rows[i];
    if (e.key === "ArrowDown" && rows[i + 1]) {
      e.preventDefault();
      focusRow(rows[i + 1].a.id);
    } else if (e.key === "ArrowUp" && rows[i - 1]) {
      e.preventDefault();
      focusRow(rows[i - 1].a.id);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (r.hasKids && !expanded.has(r.a.id)) toggle(r.a.id, true);
      else if (r.hasKids && rows[i + 1]) focusRow(rows[i + 1].a.id);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      if (r.hasKids && expanded.has(r.a.id) && !search) toggle(r.a.id, false);
      else if (r.a.parent_id) focusRow(r.a.parent_id);
    } else if (e.key === "Enter" && full) {
      e.preventDefault();
      setEdit(r.a);
    }
  };

  const save = useAction(
    (v: any) => (edit?.id ? api.patch(`/accounting/accounts/${edit.id}`, v) : api.post("/accounting/accounts", { ...v, parent_id: edit?.parent_id ?? null })),
    { success: "حساب ذخیره شد.", invalidate: [["accounts"], ["options", "account"]], onSuccess: () => setEdit(null) },
  );

  const counts = [1, 2, 3].map((l) => accounts.filter((a) => a.level === l).length);
  const allOpen = accounts.filter((a) => (kids.get(a.id) ?? []).length).every((a) => expanded.has(a.id));
  const parent = edit?.parent_id ? accounts.find((a) => a.id === edit.parent_id) : null;

  return (
    <div>
      <PageHeader
        title="کدینگ حساب‌ها"
        subtitle={accounts.length ? <span className="sf-num">{faDigits(counts[0])} گروه، {faDigits(counts[1])} کل، {faDigits(counts[2])} معین</span> : null}
        actions={
          <>
            <Tooltip title="خروجی اکسل">
              <Button
                type="text"
                icon={<Download {...ICON} />}
                aria-label="خروجی اکسل"
                onClick={() =>
                  exportExcel("کدینگ حساب‌ها", [
                    { title: "کد", value: (a: Acc) => a.code },
                    { title: "نام", value: (a: Acc) => a.name },
                    { title: "سطح", value: (a: Acc) => LEVEL[a.level] },
                    { title: "ماهیت", value: (a: Acc) => NATURE_LABEL[a.nature] },
                    { title: "نوع", value: (a: Acc) => KIND_LABEL[a.kind] },
                  ], accounts)
                }
              />
            </Tooltip>
            {full ? (
              <Button type="primary" icon={<Plus {...ICON} />} onClick={() => setEdit({ parent_id: null, level: 1, kind: "asset", nature: "debit" })}>
                گروه جدید
              </Button>
            ) : null}
          </>
        }
      />
      <section className="bk-card">
        <header className="bk-card-h">
          <Input allowClear prefix={<Search {...ICON} className="bk-3" />} placeholder="کد یا نام حساب" style={{ flex: "1 1 200px", maxInlineSize: 288 }} value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="bk-card-x">
            <Tooltip title={allOpen ? "بستن همه" : "باز کردن همه"}>
              <Button
                type="text"
                icon={allOpen ? <ChevronsDownUp {...ICON} /> : <ChevronsUpDown {...ICON} />}
                aria-label={allOpen ? "بستن همه" : "باز کردن همه"}
                disabled={!!search}
                onClick={() => setOpen(allOpen ? new Set() : new Set(accounts.map((a) => a.id)))}
              />
            </Tooltip>
          </div>
        </header>
        {q.isLoading ? (
          <div className="bk-card-b">
            <Skeleton rows={8} />
          </div>
        ) : !rows.length ? (
          <EmptyState icon={ListTree} title={search ? `برای «${search}» حسابی پیدا نشد` : "هنوز حسابی تعریف نشده"} action={search ? <Button onClick={() => setSearch("")}>پاک کردن جستجو</Button> : undefined} />
        ) : (
          <div className="bk-tree" role="tree" aria-label="کدینگ حساب‌ها" ref={listRef}>
            <div className="bk-tree-h" aria-hidden>
              <span>کد و نام حساب</span>
              <span>نوع</span>
              <span>ماهیت</span>
              <span>ویژگی‌ها</span>
              <span>گردش</span>
              <span />
            </div>
            {rows.map(({ a, depth, hasKids }, i) => {
              const isOpen = !!search || expanded.has(a.id);
              return (
                <div
                  key={a.id}
                  data-id={a.id}
                  role="treeitem"
                  aria-level={depth + 1}
                  aria-expanded={hasKids ? isOpen : undefined}
                  tabIndex={cursor === a.id || (!cursor && i === 0) ? 0 : -1}
                  className={cx("bk-tree-r", `is-l${a.level}`, !a.is_active && "is-off", cursor === a.id && "is-cursor")}
                  onFocus={() => setCursor(a.id)}
                  onKeyDown={(e) => onKey(e, i)}
                  onDoubleClick={() => full && setEdit(a)}
                >
                  <div className="bk-tree-name">
                    <span className="bk-tree-ind" aria-hidden>
                      {Array.from({ length: depth }, (_, k) => (
                        <i key={k} />
                      ))}
                    </span>
                    {hasKids ? (
                      <button type="button" tabIndex={-1} className="bk-tree-tg" aria-expanded={isOpen} aria-label={isOpen ? "بستن" : "باز کردن"} onClick={() => !search && toggle(a.id)}>
                        <ChevronLeft {...ICON14} />
                      </button>
                    ) : (
                      <span className="bk-tree-tg is-leaf" aria-hidden>
                        <i />
                      </span>
                    )}
                    <span className="bk-tree-code">{faDigits(a.code)}</span>
                    <span className="bk-tree-label">
                      <Hl text={a.name} q={search} />
                    </span>
                  </div>
                  <span className="bk-tree-c">{KIND_LABEL[a.kind] ?? a.kind}</span>
                  <span className="bk-tree-c">{NATURE_LABEL[a.nature] ?? a.nature}</span>
                  <span className="bk-tree-tags">
                    {a.detail_mode !== "none" ? <span className="bk-tag">تفصیلی {a.detail_mode === "required" ? "الزامی" : "اختیاری"}</span> : null}
                    {a.fx_mode !== "none" ? <span className="bk-tag">ارزی</span> : null}
                    {a.weight_mode !== "none" ? <span className="bk-tag">وزنی</span> : null}
                    {a.system_key ? (
                      <Tooltip title={<>نقش در ثبت خودکار: <bdi dir="ltr" className="sf-latin">{a.system_key}</bdi></>}>
                        <span className="bk-tag">خودکار</span>
                      </Tooltip>
                    ) : null}
                  </span>
                  <span className="bk-tree-c sf-num">{a.line_count ? faDigits(a.line_count) : "—"}</span>
                  {full ? (
                    <span className="bk-tree-act" onClick={(e) => e.stopPropagation()}>
                      <span className="bk-ra">
                        {a.level < 3 ? (
                          <Tooltip title={`${LEVEL[a.level + 1]} تازه زیر این حساب`}>
                            <Button size="small" type="text" tabIndex={-1} icon={<Plus {...ICON14} />} onClick={() => addChild(a)} aria-label="زیرحساب" />
                          </Tooltip>
                        ) : null}
                        <Tooltip title="ویرایش">
                          <Button size="small" type="text" tabIndex={-1} icon={<Pencil {...ICON14} />} onClick={() => setEdit(a)} aria-label="ویرایش" />
                        </Tooltip>
                        {!a.line_count ? (
                          <Tooltip title="حذف">
                            <Button size="small" type="text" tabIndex={-1} icon={<Trash2 {...ICON14} />} onClick={() => remove(a)} aria-label="حذف" />
                          </Tooltip>
                        ) : null}
                      </span>
                      {/* phones: one ⋯ menu instead of three always-visible icons */}
                      <Dropdown
                        trigger={["click"]}
                        rootClassName="sf-glass"
                        placement="bottomLeft"
                        menu={{
                          items: [
                            ...(a.level < 3 ? [{ key: "add", icon: <Plus {...ICON14} />, label: `${LEVEL[a.level + 1]} تازه زیر این حساب`, onClick: () => addChild(a) }] : []),
                            { key: "edit", icon: <Pencil {...ICON14} />, label: "ویرایش", onClick: () => setEdit(a) },
                            ...(!a.line_count ? [{ key: "del", icon: <Trash2 {...ICON14} />, label: "حذف", danger: true, onClick: () => remove(a) }] : []),
                          ],
                        }}
                      >
                        <Button size="small" type="text" tabIndex={-1} className="bk-ra-m" icon={<Ellipsis {...ICON} />} aria-label="کارها" />
                      </Dropdown>
                    </span>
                  ) : (
                    <span />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Drawer
        open={!!edit}
        onClose={() => setEdit(null)}
        size={480}
        title={edit?.id ? `ویرایش ${edit.name ?? "حساب"}` : `${LEVEL[edit?.level ?? 3] || "حساب"} جدید`}
        destroyOnHidden
      >
        {edit ? (
          <div className="sf-form">
            <Form
              layout="vertical"
              requiredMark={false}
              initialValues={{ ...edit, detail_kinds: edit.detail_kinds ?? [], is_active: edit.is_active ?? true, detail_mode: edit.detail_mode ?? "none", fx_mode: edit.fx_mode ?? "none", weight_mode: edit.weight_mode ?? "none" }}
              onFinish={(v) => save.mutate(v)}
            >
              {parent ? (
                <div className="bk-well mb-4 text-[13px]">
                  <span className="bk-3">زیر </span>
                  <span className="sf-num bk-3">{faDigits(parent.code)}</span> {parent.name}
                </div>
              ) : null}
              <div className="sf-form-grid">
                <Form.Item name="code" label="کد" extra="خالی بماند تا خودکار پر شود" style={{ ["--span" as string]: 8 }}>
                  <Input dir="ltr" className="sf-num" style={{ textAlign: "right" }} />
                </Form.Item>
                <Form.Item name="name" label="نام حساب" rules={[{ required: true, message: "نام حساب را بنویسید." }]} style={{ ["--span" as string]: 16 }}>
                  <Input autoFocus />
                </Form.Item>
                <Form.Item name="kind" label="نوع" style={{ ["--span" as string]: 12 }}>
                  <Select options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))} />
                </Form.Item>
                <Form.Item name="nature" label="ماهیت" style={{ ["--span" as string]: 12 }}>
                  <Select options={Object.entries(NATURE_LABEL).map(([value, label]) => ({ value, label }))} />
                </Form.Item>
              </div>
              {(edit.level ?? 3) >= 3 || edit.is_postable ? (
                <div className="sf-form-sec">
                  <div className="sf-form-sec-t">ابعاد ثبت</div>
                  <div className="sf-form-grid">
                    <Form.Item name="detail_mode" label="حساب تفصیلی" style={{ ["--span" as string]: 12 }}>
                      <Select options={MODE} />
                    </Form.Item>
                    <Form.Item name="detail_kinds" label="تفصیلی‌های مجاز" style={{ ["--span" as string]: 12 }}>
                      <Select mode="multiple" options={DETAIL_KINDS} placeholder="همه" maxTagCount="responsive" />
                    </Form.Item>
                    <Form.Item name="fx_mode" label="مبلغ ارزی" style={{ ["--span" as string]: 12 }}>
                      <Select options={MODE} />
                    </Form.Item>
                    <Form.Item name="weight_mode" label="وزن طلا" style={{ ["--span" as string]: 12 }}>
                      <Select options={MODE} />
                    </Form.Item>
                    <Form.Item name="system_key" label="نقش در ثبت‌های خودکار (اختیاری)" extra="برای نمونه cash، ar یا sales؛ فقط اگر ثبت‌های خودکار باید از این حساب استفاده کنند.">
                      <Input dir="ltr" className="sf-code" />
                    </Form.Item>
                  </div>
                </div>
              ) : null}
              <div className="sf-form-sec">
                <div className="sf-form-grid">
                  <Form.Item name="description" label="توضیحات (اختیاری)">
                    <Input.TextArea autoSize={{ minRows: 2 }} />
                  </Form.Item>
                  <Form.Item name="is_active" label="فعال" valuePropName="checked" style={{ ["--span" as string]: 12 }}>
                    <Switch />
                  </Form.Item>
                </div>
              </div>
              <div className="sf-form-foot">
                <Button onClick={() => setEdit(null)}>انصراف</Button>
                <Button type="primary" htmlType="submit" loading={save.isPending}>
                  ذخیره
                </Button>
              </div>
            </Form>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
