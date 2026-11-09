// «تنظیم درگاه» (PTL-002, PTL-004, PTL-033) for catalogue administrators: the home page of each portal as a list of sections —
// switch on or off, reorder, rename, set how many items, write the text sections, add more — saved as a draft,
// previewed as people will see it (`?preview=1`), then published (the server checks the layout and bumps its version);
// the portal's look (name, colours, logo, privacy notice) is its record; the knowledge published without sign-in
// (for knowledge publishers) with its secret address; and the defaults to create again.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Input, InputNumber, Popconfirm, Select, Skeleton, Switch, Tooltip } from "antd";
import { ArrowDown, ArrowUp, Copy, Eye, ImageUp, Plus, RefreshCw, Rocket, Save, Settings2, Trash2 } from "lucide-react";
import { DEFAULT_LAYOUT, PORTAL_WIDGETS, addableWidgets, layoutProblems, moveWidget, newWidget, normalizeLayout, type WidgetInstance, type WidgetType } from "@shared/portal/logic";
import { formatJalaliDateTime } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { errorText } from "../../lib/api";
import { PageHeader } from "../../components/layout";
import { Card, Note } from "../../components/blocks";
import { Chip, EmptyState } from "../../components/display";
import { recordsApi, uploadAttachment } from "../../records";
import { PORTAL_KEYS, portalApi } from "./api";
import { I16 } from "./parts";
import "./portal.css";

const same = (a: unknown, b: unknown) => JSON.stringify(normalizeLayout(a)) === JSON.stringify(normalizeLayout(b));

function WidgetRow({ w, i, count, onChange, onMove, onRemove }: { w: WidgetInstance; i: number; count: number; onChange: (w: WidgetInstance) => void; onMove: (to: number) => void; onRemove: () => void }) {
  const def = PORTAL_WIDGETS[w.type];
  return (
    <li className="flex flex-col gap-2 border-b border-line px-4 py-3 last:border-b-0" data-off={!w.enabled || undefined}>
      <div className="flex flex-wrap items-center gap-3">
        <Switch size="small" checked={w.enabled} disabled={def.fixed} onChange={(on) => onChange({ ...w, enabled: on })} aria-label={`نمایش ${def.label}`} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium text-ink">{w.title || def.label}</span>
          <span className="text-[12.5px] text-ink-3">{def.description}</span>
        </span>
        {!def.fixed ? (
          <span className="flex items-center gap-1">
            <Tooltip title="بالاتر">
              <Button size="small" type="text" icon={<ArrowUp {...I16} />} disabled={i <= 1} onClick={() => onMove(i - 1)} aria-label={`${def.label} بالاتر`} />
            </Tooltip>
            <Tooltip title="پایین‌تر">
              <Button size="small" type="text" icon={<ArrowDown {...I16} />} disabled={i >= count - 1} onClick={() => onMove(i + 1)} aria-label={`${def.label} پایین‌تر`} />
            </Tooltip>
            {def.repeat ? (
              <Tooltip title="برداشتن">
                <Button size="small" type="text" danger icon={<Trash2 {...I16} />} onClick={onRemove} aria-label={`برداشتن ${def.label}`} />
              </Tooltip>
            ) : null}
          </span>
        ) : (
          <Chip>همیشه نخست</Chip>
        )}
      </div>
      {w.enabled && !def.fixed ? (
        <div className="grid gap-2 ps-12 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Input size="small" value={w.title ?? ""} placeholder={def.label} maxLength={80} onChange={(e) => onChange({ ...w, title: e.target.value || null })} aria-label={`عنوان ${def.label}`} />
          {def.limit ? (
            <InputNumber size="small" min={def.limit.min} max={def.limit.max} value={w.limit ?? def.limit.default} onChange={(v) => onChange({ ...w, limit: v ?? def.limit!.default })} prefix="تعداد" aria-label={`تعداد ${def.label}`} />
          ) : null}
          {def.text ? <Input.TextArea className="sm:col-span-2" value={w.text ?? ""} onChange={(e) => onChange({ ...w, text: e.target.value })} autoSize={{ minRows: 2, maxRows: 8 }} maxLength={4000} placeholder="متن Markdown؛ مثلاً راه‌های تماس و ساعت کاری" aria-label="متن بخش" /> : null}
        </div>
      ) : null}
    </li>
  );
}

function LayoutEditor({ row, onSaved }: { row: Record<string, unknown> & { id: string; version: number }; onSaved: () => void }) {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const stored = useMemo(() => normalizeLayout(row.layout ?? row.published_layout ?? DEFAULT_LAYOUT), [row.layout, row.published_layout]);
  const [draft, setDraft] = useState<WidgetInstance[] | null>(null);
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  useEffect(() => setDraft(null), [row.id]);
  const layout = draft ?? stored;
  const problems = layoutProblems(layout);
  const unpublished = !same(layout, row.published_layout ?? []);
  const addable = addableWidgets(layout);
  const set = (next: WidgetInstance[]) => setDraft(next);

  const save = async (): Promise<boolean> => {
    if (!draft) return true;
    setBusy("save");
    try {
      await recordsApi.update(api, "portal", row.id, { layout: normalizeLayout(draft) }, row.version);
      setDraft(null);
      onSaved();
      return true;
    } catch (e) {
      message.error(errorText(e));
      return false;
    } finally {
      setBusy(null);
    }
  };
  const publish = async () => {
    if (!(await save())) return;
    setBusy("publish");
    try {
      await portalApi.publish(api, row.id);
      message.success("صفحهٔ اول منتشر شد؛ همه نسخهٔ تازه را می‌بینند.");
      onSaved();
      void qc.invalidateQueries({ queryKey: PORTAL_KEYS.all(orgId) });
    } catch (e) {
      message.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card
      title="صفحهٔ اول"
      meta={
        <span className="text-[12.5px] text-ink-3">
          {row.published_at ? `نسخهٔ ${Number(row.layout_version ?? 0).toLocaleString("fa-IR")} · منتشرشده در ${formatJalaliDateTime(String(row.published_at))}` : "هنوز منتشر نشده است"}
        </span>
      }
      tools={
        <span className="flex flex-wrap gap-2">
          <Button size="small" icon={<Eye {...I16} />} href={`/${orgId}/portal?portal=${row.id}&preview=1`} target="_blank" disabled={!!draft}>
            پیش‌نمایش
          </Button>
          <Button size="small" icon={<Save {...I16} />} disabled={!draft || problems.length > 0} loading={busy === "save"} onClick={() => void save()}>
            ذخیرهٔ پیش‌نویس
          </Button>
          <Button size="small" type="primary" icon={<Rocket {...I16} />} disabled={problems.length > 0 || (!draft && !unpublished)} loading={busy === "publish"} onClick={() => void publish()}>
            انتشار
          </Button>
        </span>
      }
      flush
    >
      {problems.length ? <Alert className="m-3" type="warning" showIcon title={problems.join(" · ")} /> : null}
      {draft ? <Note className="m-3">تغییرها هنوز ذخیره نشده‌اند. پیش‌نمایش نسخهٔ ذخیره‌شده را نشان می‌دهد.</Note> : unpublished ? <Note className="m-3">پیش‌نویس با نسخهٔ منتشرشده فرق دارد؛ برای دیدن کاربران «انتشار» را بزنید.</Note> : null}
      <ul className="m-0 list-none p-0">
        {layout.map((w, i) => (
          <WidgetRow
            key={w.id}
            w={w}
            i={i}
            count={layout.length}
            onChange={(nw) => set(layout.map((x) => (x.id === w.id ? nw : x)))}
            onMove={(to) => set(moveWidget(layout, i, to))}
            onRemove={() => set(layout.filter((x) => x.id !== w.id))}
          />
        ))}
      </ul>
      {addable.length ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          <Plus {...I16} aria-hidden className="text-ink-3" />
          <Select<WidgetType>
            size="small"
            placeholder="افزودن بخش"
            value={null as unknown as WidgetType}
            style={{ minInlineSize: 220 }}
            options={addable.map((d) => ({ value: d.type, label: d.label }))}
            onChange={(t) => set([...layout, newWidget(layout, t)])}
            aria-label="افزودن بخش"
          />
        </div>
      ) : null}
    </Card>
  );
}

function PublicKnowledge() {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: PORTAL_KEYS.publications(orgId), queryFn: () => portalApi.publications(api), retry: false });
  const [busy, setBusy] = useState<string | null>(null);
  if (q.isError) return null;
  const set = async (id: string, enabled: boolean, regenerate = false) => {
    setBusy(id);
    try {
      const r = await portalApi.setPublication(api, id, enabled, regenerate);
      message.success(r.enabled ? (regenerate ? "نشانی تازه ساخته شد؛ نشانی پیشین دیگر کار نمی‌کند." : "دانش برای همگان منتشر شد") : "انتشار متوقف شد");
      void qc.invalidateQueries({ queryKey: PORTAL_KEYS.publications(orgId) });
    } catch (e) {
      message.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card title="دانش بی‌ورود" meta={<span className="text-[12.5px] text-ink-3">راهنماهایی که هر کسی بی‌ورود می‌بیند؛ فقط مقاله‌های عمومیِ پایگاه‌های بیرونی</span>} flush>
      {q.isLoading ? (
        <div className="p-4">
          <Skeleton active />
        </div>
      ) : !q.data?.publications.length ? (
        <p className="m-0 p-4 text-[13px] text-ink-3">
          هنوز انتشاری تعریف نشده است. در{" "}
          <Link className="ds-link" to={`/${orgId}/portal-admin/public-kb`}>
            انتشارهای دانش
          </Link>{" "}
          یکی بسازید و پایگاه‌هایش را برگزینید.
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {q.data.publications.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 border-b border-line px-4 py-3 last:border-b-0">
              <div className="flex flex-wrap items-center gap-3">
                <Switch size="small" checked={p.active} loading={busy === p.id} onChange={(on) => void set(p.id, on)} aria-label={`انتشار ${p.name}`} />
                <Link className="ds-link font-medium" to={`/${orgId}/portal-admin/public-kb/${p.id}`}>
                  {p.name}
                </Link>
                <span className="text-[12.5px] text-ink-3">{p.bases.map((b) => `${b.name} (${b.articles.toLocaleString("fa-IR")} عمومی${b.held_back ? `، ${b.held_back.toLocaleString("fa-IR")} نگه‌داشته` : ""})`).join(" · ")}</span>
              </div>
              {p.active && p.url ? (
                <div className="flex flex-wrap items-center gap-2 ps-12">
                  <bdi className="ltr truncate text-[12.5px]" dir="ltr">
                    {p.url}
                  </bdi>
                  <Button size="small" type="text" icon={<Copy {...I16} />} aria-label="رونوشت نشانی" onClick={() => void navigator.clipboard?.writeText(p.url!).then(() => message.success("نشانی رونوشت شد"), () => undefined)} />
                  <Popconfirm title="نشانی تازه ساخته شود؟" description="نشانی کنونی دیگر کار نمی‌کند." okText="بسازید" cancelText="انصراف" onConfirm={() => void set(p.id, true, true)}>
                    <Button size="small" type="text" icon={<RefreshCw {...I16} />}>
                      نشانی تازه
                    </Button>
                  </Popconfirm>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The portal's logo: an image attached to the portal's record (its id in `logo_id`), shown in the portal's header. */
function Logo({ row, onSaved }: { row: Record<string, unknown> & { id: string; version: number }; onSaved: () => void }) {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const id = typeof row.logo_id === "string" && row.logo_id ? row.logo_id : null;
  const set = async (file: File | null) => {
    setBusy(true);
    try {
      let logo: string | null = null;
      if (file) {
        if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 1024 * 1024) throw new Error("نشان باید تصویر PNG، JPG یا WebP و کمتر از یک مگابایت باشد");
        logo = String((await uploadAttachment(orgId, "portal", row.id, file)).id);
      }
      await recordsApi.update(api, "portal", row.id, { logo_id: logo }, row.version);
      message.success(logo ? "نشان درگاه گذاشته شد" : "نشان برداشته شد");
      onSaved();
    } catch (e) {
      message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex items-center gap-2">
      {id ? <img src={`/api/o/${orgId}/portal/logo/${row.id}?v=${id.slice(0, 8)}`} alt="نشان درگاه" className="h-8 w-8 rounded-sm object-contain" /> : null}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ""; if (f) void set(f); }} />
      <Button size="small" icon={<ImageUp {...I16} />} loading={busy} onClick={() => input.current?.click()}>
        {id ? "نشان تازه" : "گذاشتن نشان"}
      </Button>
      {id ? (
        <Button size="small" type="text" disabled={busy} onClick={() => void set(null)}>
          برداشتن نشان
        </Button>
      ) : null}
    </span>
  );
}

export default function PortalAdmin() {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const [sel, setSel] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const q = useQuery({
    queryKey: [...PORTAL_KEYS.all(orgId), "admin", "portals"],
    queryFn: () => recordsApi.list(api, "portal", { size: 50, sort: "sort_order", fields: ["name", "active", "layout", "published_layout", "layout_version", "published_at", "sort_order", "logo_id"] }),
  });
  const rows = (q.data?.rows ?? []) as (Record<string, unknown> & { id: string; version: number })[];
  const row = rows.find((r) => r.id === sel) ?? rows[0] ?? null;
  const seed = async () => {
    setSeeding(true);
    try {
      const r = await portalApi.seed(api);
      const n = Object.values(r.created).reduce((a, b) => a + b, 0);
      message.success(n ? `${n.toLocaleString("fa-IR")} مورد پیش‌فرض ساخته شد` : "پیش‌فرض‌ها از پیش ساخته شده‌اند");
      void q.refetch();
    } catch (e) {
      message.error(errorText(e));
    } finally {
      setSeeding(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="تنظیم درگاه"
        actions={
          <>
            <Button icon={<Eye {...I16} />} href={`/${orgId}/portal`} target="_blank">
              دیدن درگاه
            </Button>
            <Popconfirm title="پیش‌فرض‌های درگاه ساخته شود؟" description="درگاه، نظرسنجی‌ها و موضوع‌های دستیار که نیستند ساخته می‌شوند؛ چیزی پاک نمی‌شود." okText="بسازید" cancelText="انصراف" onConfirm={() => void seed()}>
              <Button loading={seeding}>ساختن پیش‌فرض‌ها</Button>
            </Popconfirm>
          </>
        }
      />
      {q.isLoading ? (
        <Skeleton active />
      ) : !row ? (
        <EmptyState title="هنوز درگاهی تعریف نشده است" description="«ساختن پیش‌فرض‌ها» یک درگاه آماده با صفحهٔ اول، نظرسنجی رضایت و موضوع‌های دستیار می‌سازد." />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            {rows.length > 1 ? <Select value={row.id} onChange={setSel} options={rows.map((r) => ({ value: r.id, label: String(r.name) }))} style={{ minInlineSize: 220 }} aria-label="درگاه" /> : <span className="font-medium text-ink">{String(row.name)}</span>}
            {row.active === false ? <Chip tone="warning">غیرفعال</Chip> : null}
            <Logo row={row} onSaved={() => void q.refetch()} />
            <Link className="ds-link inline-flex items-center gap-1 text-[13px]" to={`/${orgId}/portal-admin/portals/${row.id}`}>
              <Settings2 {...I16} /> نام، رنگ، پانویس و حریم خصوصی
            </Link>
          </div>
          <LayoutEditor row={row} onSaved={() => void q.refetch()} />
        </>
      )}
      <PublicKnowledge />
      <Card title="بخش‌های دیگر">
        <div className="flex flex-wrap gap-2">
          {[
            ["portal-admin/links", "پیوندهای سریع"],
            ["portal-admin/topics", "موضوع‌ها"],
            ["portal-admin/surveys", "نظرسنجی‌ها"],
            ["portal-admin/results", "نتیجهٔ نظرسنجی‌ها"],
            ["portal-admin/channels", "پیام‌رسان‌ها"],
            ["portal-admin/widgets", "ابزارک وب‌سایت"],
            ["portal-admin/feedback", "بازخوردها"],
            ["portal-admin/analytics", "آمار درگاه"],
          ].map(([path, label]) => (
            <Link key={path} className="pt-chip-btn" to={`/${orgId}/${path}`}>
              {label}
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
