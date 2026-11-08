// «نقشهٔ وابستگی» (catalogue CMDB-010/008/014/076): pick one or more CIs or services, the direction (what depends on
// them, what they depend on, or both), the depth, relationship types, a date for the graph as it was then, and open
// work as badges. The map is layered automatically; a card opens its details beside the map (open the record, make it
// the centre, grow the map around it with a double click, start impact analysis from it, highlight the path to the
// centre). Hidden CIs stay as locked placeholders, counted in the legend. Views can be saved as «نقشه‌های ذخیره‌شده».
// The address keeps the view (?root=…&dir=…&depth=…), so a map can be shared with someone who may read the same CIs.
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { App, Button, Input, Modal, Segmented, Select, Space, Switch, Tooltip } from "antd";
import { ArrowDownUp, ArrowLeftRight, Crosshair, ExternalLink, GitFork, Route, Save, Zap } from "lucide-react";
import type { MapNode } from "@shared/cmdb/api";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Card, Note } from "../../components/blocks";
import { Chip, EmptyState, Loader } from "../../components/display";
import { DateInput } from "../../components/inputs";
import { recordsApi } from "../../records/data/api";
import { cmdbApi, CMDB_KEYS } from "./api";
import { CiPicker } from "./CiPicker";
import { ServiceMap } from "./ServiceMap";
import { familyColor, familyCounts, type MapDirection } from "./model";

const DIRS = [
  { value: "both", label: "هر دو سو" },
  { value: "dependents", label: "وابسته‌ها" },
  { value: "dependencies", label: "وابستگی‌ها" },
];
const DEPTHS = [1, 2, 3, 4, 5, 6].map((d) => ({ value: d, label: `${faDigits(d)} گام` }));

const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

export function NodeDetails({ n, onCenter, onExpand, onImpact, onPath, orgId }: { n: MapNode; onCenter?: () => void; onExpand?: () => void; onImpact?: () => void; onPath?: () => void; orgId: string }) {
  const nav = useNavigate();
  if (n.restricted) {
    return (
      <Card title="پیکربندی محدود">
        <p className="text-[13px] text-ink-3">این پیکربندی روی مسیر هست اما اجازهٔ دیدن جزئیات آن را ندارید.</p>
      </Card>
    );
  }
  const ov = n.overlay ?? {};
  return (
    <Card title={n.name} meta={<span className="ds-ltr ds-num">{n.number ? faDigits(n.number) : null}</span>}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        <dt className="text-ink-3">کلاس</dt>
        <dd>
          <span className="me-1 inline-block h-2 w-2 rounded-xs align-middle" style={{ background: familyColor(n.family) }} aria-hidden />
          {n.class_label}
        </dd>
        <dt className="text-ink-3">وضعیت</dt>
        <dd>{n.state_label ?? "—"}</dd>
        {n.health_score !== null && n.health_score !== undefined ? (
          <>
            <dt className="text-ink-3">سلامت داده</dt>
            <dd className="ds-num">{fa(n.health_score)}</dd>
          </>
        ) : null}
        {n.severity !== undefined ? (
          <>
            <dt className="text-ink-3">شدت اثر</dt>
            <dd className="ds-num">{faDigits(Math.round(n.severity * 100))}٪{n.absorbed ? " (جذب با افزونگی)" : ""}</dd>
          </>
        ) : null}
        <dt className="text-ink-3">فاصله</dt>
        <dd className="ds-num">{n.depth ? `${fa(n.depth)} گام` : "مرکز نقشه"}</dd>
        {ov.incidents || ov.problems || ov.changes || ov.findings ? (
          <>
            <dt className="text-ink-3">کار باز</dt>
            <dd className="flex flex-wrap gap-1">
              {ov.incidents ? <Chip tone="danger" fig>{`${fa(ov.incidents)} رخداد`}</Chip> : null}
              {ov.problems ? <Chip tone="warning" fig>{`${fa(ov.problems)} مشکل`}</Chip> : null}
              {ov.changes ? <Chip tone="neutral" fig>{`${fa(ov.changes)} تغییر`}</Chip> : null}
              {ov.findings ? <Chip tone="warning" fig>{`${fa(ov.findings)} یافته`}</Chip> : null}
            </dd>
          </>
        ) : null}
        {n.is_stale ? (
          <>
            <dt className="text-ink-3">داده</dt>
            <dd>
              <Chip tone="warning">کهنه</Chip>
            </dd>
          </>
        ) : null}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="small" icon={<ExternalLink {...ICON} />} onClick={() => nav(n.service_id ? `/${orgId}/services/${n.service_id}` : `/${orgId}/cis/${n.id}`)}>
          {n.service_id ? "صفحهٔ خدمت" : "صفحهٔ پیکربندی"}
        </Button>
        {onCenter ? <Button size="small" icon={<Crosshair {...ICON} />} onClick={onCenter}>مرکز نقشه</Button> : null}
        {onExpand ? <Button size="small" icon={<GitFork {...ICON} />} onClick={onExpand}>گسترش</Button> : null}
        {onPath ? <Button size="small" icon={<Route {...ICON} />} onClick={onPath}>مسیر تا مرکز</Button> : null}
        {onImpact ? <Button size="small" icon={<Zap {...ICON} />} onClick={onImpact}>تحلیل اثر</Button> : null}
      </div>
    </Card>
  );
}

export default function MapPage() {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const roots = (sp.get("root") ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 10);
  const direction = (sp.get("dir") as "both" | "dependents" | "dependencies") ?? "both";
  const depth = Math.min(6, Math.max(1, Number(sp.get("depth") ?? 2) || 2));
  const layout = (sp.get("layout") as MapDirection) === "RL" ? "RL" : "TB";
  const asOf = sp.get("as_of");
  const types = (sp.get("types") ?? "").split(",").filter(Boolean);
  const [overlays, setOverlays] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [path, setPath] = useState<Set<string> | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setSp(next, { replace: true });
    setPath(null);
  };
  const classes = useQuery({ queryKey: CMDB_KEYS.classes(orgId), queryFn: () => cmdbApi.classes(api), staleTime: 300_000 });
  const query = { roots, depth, direction, types: types.length ? types : undefined, as_of: asOf || null, overlays };
  const map = useQuery({ queryKey: CMDB_KEYS.map(orgId, query), queryFn: () => cmdbApi.map(api, query), enabled: roots.length > 0, staleTime: 30_000, placeholderData: (prev) => prev });
  const data = map.data;
  const node = data?.nodes.find((n) => n.id === selected) ?? null;
  const legend = useMemo(() => (data ? familyCounts(data.nodes) : []), [data]);
  const showPath = async () => {
    if (!selected || !roots[0]) return;
    const r = await cmdbApi.path(api, roots[0], selected).catch(() => null);
    if (!r?.found) {
      message.info("مسیری که بتوانید ببینید پیدا نشد");
      return;
    }
    setPath(new Set(r.nodes.map((n) => n.id)));
  };
  const save = useMutation({
    mutationFn: () => recordsApi.create(api, "cmdb_map", { name: saveName.trim(), root_ids: roots, depth, direction, types, layout }),
    onSuccess: () => {
      message.success("نقشه ذخیره شد");
      setSaveOpen(false);
    },
    onError: (e: Error) => message.error(e.message),
  });
  return (
    <div>
      <PageHeader
        title="نقشهٔ وابستگی"
        actions={
          <Space wrap>
            <Button icon={<Zap {...ICON} />} disabled={!roots.length} onClick={() => nav(`/${orgId}/cmdb/impact?ci=${roots.join(",")}`)}>
              تحلیل اثر
            </Button>
            <Button icon={<Save {...ICON} />} disabled={!roots.length} onClick={() => setSaveOpen(true)}>
              ذخیرهٔ نقشه
            </Button>
          </Space>
        }
      />
      <div className="cm-toolbar">
        <CiPicker multiple value={roots} onChange={(v) => set({ root: (Array.isArray(v) ? v : v ? [v] : []).join(",") || null })} placeholder="پیکربندی یا خدمت مرکز نقشه" style={{ minWidth: 280, flex: "1 1 280px" }} aria-label="مرکز نقشه" />
        <Segmented value={direction} options={DIRS} onChange={(v) => set({ dir: String(v) === "both" ? null : String(v) })} aria-label="جهت" />
        <Select value={depth} options={DEPTHS} onChange={(v) => set({ depth: String(v) })} style={{ width: 96 }} aria-label="عمق" />
        <Select
          mode="multiple"
          allowClear
          placeholder="همهٔ رابطه‌ها"
          value={types}
          onChange={(v: string[]) => set({ types: v.join(",") || null })}
          options={(classes.data?.types ?? []).map((t) => ({ value: t.key, label: t.label }))}
          style={{ minWidth: 160 }}
          maxTagCount="responsive"
          aria-label="نوع رابطه"
        />
        <Tooltip title="نقشه در این تاریخ (رابطه‌های پایان‌یافته و آینده کنار می‌روند)">
          <span>
            <DateInput value={asOf ?? undefined} onChange={(v) => set({ as_of: v ? String(v) : null })} placeholder="امروز" allowClear />
          </span>
        </Tooltip>
        <Tooltip title={layout === "TB" ? "چیدمان از راست به چپ" : "چیدمان از بالا به پایین"}>
          <Button aria-label="تغییر چیدمان" icon={layout === "TB" ? <ArrowLeftRight {...ICON} /> : <ArrowDownUp {...ICON} />} onClick={() => set({ layout: layout === "TB" ? "RL" : null })} />
        </Tooltip>
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          <Switch size="small" checked={overlays} onChange={setOverlays} />
          کار باز
        </label>
      </div>
      {!roots.length ? (
        <EmptyState title="نقشه‌ای انتخاب نشده" description="یک یا چند پیکربندی یا خدمت را برای مرکز نقشه انتخاب کنید." icon={GitFork} />
      ) : map.isLoading && !data ? (
        <Loader />
      ) : map.isError ? (
        <EmptyState title="نقشه بارگذاری نشد" description={(map.error as Error).message} />
      ) : data ? (
        <>
          {data.truncated ? <Note tone="warning">نقشه به سقف اندازه رسید؛ عمق را کم کنید یا نوع رابطه را محدود کنید.</Note> : null}
          <div className="cm-map-layout">
            <div>
              <ServiceMap
                map={data}
                direction={layout}
                selected={selected}
                onSelect={setSelected}
                onExpand={(id) => !roots.includes(id) && set({ root: [...roots, id].slice(0, 10).join(",") })}
                path={path}
                height="min(72vh, 760px)"
              />
              <div className="cm-legend mt-2" aria-label="راهنمای نقشه">
                {legend.map((l) => (
                  <span key={l.family}>
                    <i style={{ background: familyColor(l.family) }} />
                    {l.label} <span className="ds-num">{fa(l.count)}</span>
                  </span>
                ))}
                {data.restricted ? <span>محدود <span className="ds-num">{fa(data.restricted)}</span></span> : null}
                <span>خط‌چین: رابطهٔ بدون انتقال اثر</span>
                {asOf ? <span>نمای تاریخ گذشته</span> : null}
              </div>
            </div>
            <div className="flex flex-col gap-3">
              {node ? (
                <NodeDetails
                  n={node}
                  orgId={orgId}
                  onCenter={roots.length === 1 && roots[0] === node.id ? undefined : () => set({ root: node.id })}
                  onExpand={roots.includes(node.id) ? undefined : () => set({ root: [...roots, node.id].slice(0, 10).join(",") })}
                  onImpact={() => nav(`/${orgId}/cmdb/impact?ci=${node.id}`)}
                  onPath={roots.includes(node.id) ? undefined : showPath}
                />
              ) : (
                <Card title="نقشه">
                  <p className="text-[13px] text-ink-3">
                    <span className="ds-num">{fa(data.nodes.length)}</span> پیکربندی و <span className="ds-num">{fa(data.edges.length)}</span> رابطه. روی کارتی بزنید تا جزئیاتش را ببینید؛ با دو بار زدن نقشه دور آن گسترش می‌یابد.
                  </p>
                </Card>
              )}
            </div>
          </div>
        </>
      ) : null}
      <Modal open={saveOpen} title="ذخیرهٔ نقشه" onCancel={() => setSaveOpen(false)} onOk={() => save.mutate()} okText="ذخیره" cancelText="انصراف" okButtonProps={{ disabled: !saveName.trim(), loading: save.isPending }} destroyOnHidden>
        <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="نام نقشه (مثلاً «زنجیرهٔ خدمت ایمیل»)" maxLength={120} autoFocus onPressEnter={() => saveName.trim() && save.mutate()} />
      </Modal>
    </div>
  );
}
