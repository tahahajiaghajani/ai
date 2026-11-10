// Bank screens of IT asset management (docs/modules/itam_FA.md «اموال شعبه‌ها و ناوگان خودپرداز»):
//   «اموال شعبه‌ها»   every branch the person may read: assets by state, value, the ATM fleet's devices down, open
//                     transfers in and out, the last count and its open discrepancies, the period's attestation; the
//                     inbox of transfers waiting for the person's receipt
//   «ناوگان خودپرداز» ATMs, CRSs and kiosks: status, availability per region and per maintenance contract (against its
//                     target, with late hours and penalties), OS end of support, failure risk, preventive maintenance
//   «دفتر اموال»     the asset register of a Jalali fiscal year: cost, opening and closing accumulated depreciation, the
//                     year's charge and book values per asset, totals per branch, Excel export
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Dropdown, InputNumber, Modal, Segmented, Select, Space, Table } from "antd";
import { Download, FilePlus2, Landmark, ShieldAlert, Stamp, Truck, Wrench } from "lucide-react";
import { formatJalali, todayISO } from "@shared/jalali";
import { registerYears } from "@shared/itam/bank";
import { DEVICE_STATUS, MODEL_CATEGORIES } from "@shared/tables/itam";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { exportExcel } from "../../lib/excel";
import { PageHeader } from "../../components/layout";
import { Card, Note } from "../../components/blocks";
import { Chip, EmptyState, Loader, StatCard } from "../../components/display";
import { RecordSelect } from "../../records";
import { bankApi, BANK_KEYS, itamApi, ITAM_KEYS, type BranchRow, type Fleet as FleetData, type FleetDevice, type RegisterRow, type TransferView } from "./api";
import { ICON, Money } from "./parts";
import { ReceiveDrawer } from "./BankParts";

const listOf = (path: string, filter: unknown) => `${path}?filter=${encodeURIComponent(JSON.stringify(filter))}`;
const pctNum = (v: string | number) => new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 2 }).format(Number(v));
const STATUS_TONE: Record<string, "in" | "warning" | "danger" | "neutral" | "accent"> = { in_service: "in", out_of_service: "danger", out_of_cash: "warning", maintenance: "accent", offline: "danger" };
const statusLabel = (v: string) => DEVICE_STATUS.find((s) => s.value === v)?.label ?? v;
const categoryLabel = (v: string | null) => MODEL_CATEGORIES.find((c) => c.value === v)?.label ?? v ?? "—";
const RISK: Record<string, [string, "in" | "warning" | "danger"]> = { low: ["کم", "in"], medium: ["متوسط", "warning"], high: ["زیاد", "danger"] };
const EOS: Record<string, [string, "in" | "warning" | "danger" | "neutral"]> = { past: ["پایان‌یافته", "danger"], soon: ["تا ۶ ماه", "warning"], ok: ["برقرار", "in"], unknown: ["نامعلوم", "neutral"] };
const ATT: Record<string, [string, "in" | "warning" | "danger" | "neutral"]> = { open: ["منتظر تأیید", "warning"], attested: ["تأییدشده", "in"], attested_exceptions: ["تأیید با استثنا", "warning"], reviewed: ["بازبینی‌شده", "in"], canceled: ["لغوشده", "neutral"] };

// ---------------------------------------------------------------------------------------------------------------
// «اموال شعبه‌ها»

export function Branches() {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: BANK_KEYS.branches(orgId), queryFn: () => bankApi.branches(api), staleTime: 30_000 });
  const inbox = useQuery({ queryKey: BANK_KEYS.inbox(orgId), queryFn: () => bankApi.inbox(api), staleTime: 30_000 });
  const meta = useQuery({ queryKey: ITAM_KEYS.meta(orgId), queryFn: () => itamApi.meta(api), staleTime: 300_000 });
  const [receiving, setReceiving] = useState<TransferView | null>(null);
  const open = useMutation({
    mutationFn: () => bankApi.openAttestations(api),
    onSuccess: (r) => {
      message.success(r.opened ? `${fa(r.opened)} تأیید اموال شعبه باز شد` : "دورهٔ تأیید همهٔ شعبه‌ها پیش‌تر باز شده است");
      void qc.invalidateQueries({ queryKey: BANK_KEYS.branches(orgId) });
    },
    onError: (e: Error) => message.error(e.message),
  });
  const go = (path: string) => nav(`/${orgId}/${path}`);
  const d = q.data;
  const columns = [
    {
      title: "شعبه یا واحد", key: "name", render: (_: unknown, r: BranchRow) => (
        <div className="flex flex-col">
          {r.branch_id ? <a onClick={() => go(listOf("assets", { f: "branch_id", op: "eq", v: r.branch_id }))}>{r.name}</a> : <span className="text-ink-3">{r.name}</span>}
          <span className="text-[12px] text-ink-3">{[r.code, r.region].filter(Boolean).join(" · ")}</span>
        </div>
      ),
    },
    { title: "دارایی", key: "total", align: "end" as const, render: (_: unknown, r: BranchRow) => <span className="ds-num">{fa(r.total)}</span> },
    { title: "در استفاده", key: "in_use", align: "end" as const, render: (_: unknown, r: BranchRow) => <span className="ds-num">{fa(r.by_state.in_use ?? 0)}</span> },
    { title: "در انبار", key: "in_stock", align: "end" as const, render: (_: unknown, r: BranchRow) => <span className="ds-num">{fa(r.by_state.in_stock ?? 0)}</span> },
    { title: "مفقود", key: "missing", align: "end" as const, render: (_: unknown, r: BranchRow) => (r.missing ? <Chip tone="danger">{fa(r.missing)}</Chip> : <span className="ds-num text-ink-3">۰</span>) },
    { title: "خودپرداز", key: "fleet", align: "end" as const, render: (_: unknown, r: BranchRow) => (r.fleet ? <span className="ds-num">{r.fleet_down ? <Chip tone="warning">{`${fa(r.fleet_down)} از ${fa(r.fleet)} از سرویس خارج`}</Chip> : fa(r.fleet)}</span> : <span className="text-ink-3">—</span>) },
    { title: "انتقال باز", key: "tr", render: (_: unknown, r: BranchRow) => <span className="ds-num text-[12px]">{`ارسال ${fa(r.transfers_out)} · دریافت ${fa(r.transfers_in)}`}</span> },
    {
      title: "آخرین شمارش", key: "audit", render: (_: unknown, r: BranchRow) => r.last_audit ? (
        <a onClick={() => go(`itam/audits/${r.last_audit!.id}`)} className="text-[12px]">
          {r.last_audit.number} {r.last_audit.completed_at ? `— ${formatJalali(r.last_audit.completed_at.slice(0, 10))}` : ""}
          {r.open_discrepancies ? <Chip tone="danger" className="ms-1">{`${fa(r.open_discrepancies)} مغایرت باز`}</Chip> : null}
        </a>
      ) : <span className="text-ink-3 text-[12px]">شمارش نشده</span>,
    },
    {
      title: "تأیید رئیس شعبه", key: "att", render: (_: unknown, r: BranchRow) => r.attestation ? (
        <a onClick={() => go(`itam/attestations/${r.attestation!.id}`)}>
          <Chip tone={r.attestation.overdue ? "danger" : ATT[r.attestation.state]?.[1] ?? "neutral"}>{r.attestation.overdue ? "دیرکرد" : ATT[r.attestation.state]?.[0] ?? r.attestation.state}</Chip>
        </a>
      ) : <span className="text-ink-3 text-[12px]">—</span>,
    },
    ...(d?.financial ? [{ title: "ارزش دفتری", key: "value", align: "end" as const, render: (_: unknown, r: BranchRow) => <Money v={r.value} compact /> }] : []),
  ];
  return (
    <div>
      <PageHeader
        title="اموال شعبه‌ها"
        actions={
          <Space wrap>
            {d?.can_transfer ? <Button type="primary" icon={<Truck {...ICON} />} onClick={() => go("itam/transfers/new")}>حوالهٔ انتقال</Button> : null}
            {meta.data?.can_approve ? <Button icon={<Stamp {...ICON} />} loading={open.isPending} onClick={() => open.mutate()}>باز کردن دورهٔ تأیید</Button> : null}
          </Space>
        }
      />
      {q.isLoading ? <Loader /> : !d ? <EmptyState title="اموال شعبه‌ها در دسترس نیست" description="به دارایی‌ها دسترسی ندارید یا بارگذاری انجام نشد." /> : (
        <div className="flex flex-col gap-3">
          {inbox.data?.incoming.length ? (
            <Card title="حواله‌های در راه به شعبهٔ شما">
              <ul className="itam-list">
                {inbox.data.incoming.map((t) => (
                  <li key={t.id}>
                    <span>
                      <a onClick={() => go(`itam/transfers/${t.id}`)}>{t.number}</a> — {t.title} <span className="text-ink-3 text-[12px]">{`از ${t.from ?? "—"} · ${fa(t.items)} قلم${t.dispatched_at ? ` · ارسال ${formatJalali(t.dispatched_at.slice(0, 10))}` : ""}`}</span>
                    </span>
                    <Button size="small" type="primary" onClick={() => setReceiving(t)}>ثبت رسید</Button>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <div className="itam-tiles">
            <StatCard title="شعبه و واحد" value={fa(d.branches.filter((b) => b.branch_id).length)} />
            <StatCard title="دارایی" value={fa(d.total)} onClick={() => go("assets")} />
            <StatCard title="بدون شعبه" value={fa(d.branches.find((b) => !b.branch_id)?.total ?? 0)} onClick={() => go(listOf("assets", { f: "branch_id", op: "empty" }))} />
            <StatCard title="مغایرت باز شمارش" value={fa(d.branches.reduce((x, b) => x + b.open_discrepancies, 0))} onClick={() => go("itam/audits")} />
            <StatCard title="تأیید دیرکرده" value={fa(d.branches.filter((b) => b.attestation?.overdue).length)} onClick={() => go("itam/attestations")} />
          </div>
          <Card title="شعبه‌ها">
            <Table<BranchRow> size="small" rowKey={(r) => r.branch_id ?? "none"} columns={columns} dataSource={d.branches} pagination={{ pageSize: 50, hideOnSinglePage: true }} scroll={{ x: true }} />
          </Card>
        </div>
      )}
      {receiving ? <ReceiveDrawer transferId={receiving.id} title={`${receiving.number ?? ""} — ${receiving.title}`} onClose={() => setReceiving(null)} onDone={() => { setReceiving(null); void qc.invalidateQueries({ queryKey: ["itam", orgId] }); }} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// «ناوگان خودپرداز»

export function Fleet() {
  const { api, orgId } = useOrg();
  const { message, modal } = App.useApp();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [days, setDays] = useState(30);
  const [plan, setPlan] = useState<{ every_n: number; interval_unit: string; group_id: string | null } | null>(null);
  const q = useQuery({ queryKey: BANK_KEYS.fleet(orgId, days), queryFn: () => bankApi.fleet(api, days), staleTime: 30_000 });
  const status = useMutation({
    mutationFn: (v: { id: string; status: string; incident: boolean }) => bankApi.setStatus(api, v.id, { status: v.status, incident: v.incident }),
    onSuccess: (r) => {
      message.success(r.incident ? `وضعیت ثبت شد و رخداد ${r.incident.number ?? ""} ساخته شد` : "وضعیت دستگاه ثبت شد");
      void qc.invalidateQueries({ queryKey: ["itam", orgId, "fleet"] });
    },
    onError: (e: Error) => message.error(e.message),
  });
  const pm = useMutation({
    mutationFn: () => bankApi.pmPlans(api, plan ?? {}),
    onSuccess: (r) => {
      message.success(r.created ? `${fa(r.created)} برنامهٔ نگهداری پیشگیرانه ساخته شد` : "همهٔ دستگاه‌ها برنامهٔ نگهداری دارند");
      setPlan(null);
      void qc.invalidateQueries({ queryKey: ["itam", orgId, "fleet"] });
    },
    onError: (e: Error) => message.error(e.message),
  });
  const risk = useMutation({
    mutationFn: (id: string) => bankApi.risk(api, id),
    onSuccess: (r) => modal.info({ title: "پیش‌بینی خرابی", width: 560, content: <div className="whitespace-pre-wrap text-[13px] leading-7">{r.text}</div> }),
    onError: (e: Error) => message.error(e.message),
  });
  const d = q.data;
  const go = (path: string) => nav(`/${orgId}/${path}`);
  const exportRows = () => d && void exportExcel(`ناوگان-خودپرداز-${todayISO()}`, [
    { title: "برچسب اموال", value: (r: FleetDevice) => r.asset_tag ?? r.number },
    { title: "نام", value: (r: FleetDevice) => r.name },
    { title: "رده", value: (r: FleetDevice) => categoryLabel(r.category) },
    { title: "شناسهٔ پایانه", value: (r: FleetDevice) => r.terminal_id },
    { title: "شعبه", value: (r: FleetDevice) => r.branch },
    { title: "منطقه", value: (r: FleetDevice) => r.region },
    { title: "وضعیت", value: (r: FleetDevice) => statusLabel(r.device_status) },
    { title: "دسترس‌پذیری (درصد)", value: (r: FleetDevice) => r.availability, type: "number" as const },
    { title: "سیستم‌عامل", value: (r: FleetDevice) => r.os_name },
    { title: "پایان پشتیبانی", value: (r: FleetDevice) => (r.os_eos_date ? formatJalali(r.os_eos_date) : "") },
    { title: "قرارداد نگهداری", value: (r: FleetDevice) => r.contract },
    { title: "ریسک خرابی", value: (r: FleetDevice) => r.risk.score, type: "number" as const },
    { title: "دستور کار باز", value: (r: FleetDevice) => r.open_work_orders, type: "number" as const },
    { title: "نگهداری بعدی", value: (r: FleetDevice) => (r.next_pm ? formatJalali(r.next_pm) : "") },
  ], d.devices, "ناوگان");
  const columns = [
    { title: "دستگاه", key: "name", render: (_: unknown, r: FleetDevice) => (
      <div className="flex flex-col">
        <a onClick={() => go(`assets/${r.id}`)}>{r.name ?? r.number}</a>
        <span className="text-[12px] text-ink-3" dir="ltr">{[r.asset_tag, r.terminal_id].filter(Boolean).join(" · ")}</span>
      </div>
    ) },
    { title: "شعبه", key: "branch", render: (_: unknown, r: FleetDevice) => <div className="flex flex-col"><span>{r.branch ?? "—"}</span><span className="text-[12px] text-ink-3">{r.region ?? ""}</span></div> },
    { title: "وضعیت", key: "status", render: (_: unknown, r: FleetDevice) => (
      <Dropdown trigger={["click"]} menu={{
        items: [
          ...DEVICE_STATUS.filter((s) => s.value !== r.device_status).map((s) => ({ key: s.value, label: s.label })),
          { type: "divider" as const },
          ...DEVICE_STATUS.filter((s) => s.value !== "in_service" && s.value !== r.device_status).map((s) => ({ key: `inc:${s.value}`, label: `${s.label} و ثبت رخداد` })),
        ],
        onClick: ({ key }) => status.mutate({ id: r.id, status: key.replace(/^inc:/, ""), incident: key.startsWith("inc:") }),
      }}>
        <button type="button" className="cursor-pointer bg-transparent border-0 p-0"><Chip tone={STATUS_TONE[r.device_status] ?? "neutral"}>{statusLabel(r.device_status)}</Chip></button>
      </Dropdown>
    ) },
    { title: "دسترس‌پذیری", key: "av", align: "end" as const, sorter: (x: FleetDevice, y: FleetDevice) => Number(x.availability) - Number(y.availability), render: (_: unknown, r: FleetDevice) => <span className="ds-num">{pctNum(r.availability)}٪</span> },
    { title: "سیستم‌عامل", key: "os", render: (_: unknown, r: FleetDevice) => <div className="flex flex-col"><span dir="ltr" className="text-[12px]">{r.os_name ?? "—"}</span><Chip tone={EOS[r.eos][1]}>{EOS[r.eos][0]}</Chip></div> },
    { title: "ریسک خرابی", key: "risk", sorter: (x: FleetDevice, y: FleetDevice) => x.risk.score - y.risk.score, render: (_: unknown, r: FleetDevice) => (
      <button type="button" className="cursor-pointer bg-transparent border-0 p-0" title={r.risk.reasons.join("؛ ")} onClick={() => risk.mutate(r.id)}><Chip tone={RISK[r.risk.level][1]}>{`${RISK[r.risk.level][0]} (${fa(r.risk.score)})`}</Chip></button>
    ) },
    { title: "دستور کار باز", key: "wo", align: "end" as const, render: (_: unknown, r: FleetDevice) => <span className="ds-num">{fa(r.open_work_orders)}</span> },
    { title: "نگهداری بعدی", key: "pm", render: (_: unknown, r: FleetDevice) => (r.next_pm ? formatJalali(r.next_pm) : <span className="text-ink-3">برنامه ندارد</span>) },
  ];
  return (
    <div>
      <PageHeader
        title="ناوگان خودپرداز"
        actions={
          <Space wrap>
            <Segmented<number> value={days} onChange={setDays} options={[{ label: "۷ روز", value: 7 }, { label: "۳۰ روز", value: 30 }, { label: "۹۰ روز", value: 90 }]} />
            {d?.can_plan ? <Button icon={<Wrench {...ICON} />} onClick={() => setPlan({ every_n: 3, interval_unit: "month", group_id: null })}>نگهداری پیشگیرانه</Button> : null}
            <Button icon={<Download {...ICON} />} disabled={!d?.devices.length} onClick={exportRows}>خروجی اکسل</Button>
          </Space>
        }
      />
      {q.isLoading ? <Loader /> : !d ? <EmptyState title="ناوگان در دسترس نیست" description="به دارایی‌ها دسترسی ندارید یا بارگذاری انجام نشد." /> : !d.total ? (
        <EmptyState title="خودپرداز، CRS یا کیوسکی ثبت نشده است" description="دارایی‌هایی با مدل‌های ردهٔ خودپرداز، CRS و کیوسک اینجا می‌آیند." icon={Landmark} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="itam-tiles ds-stagger">
            <StatCard title="دستگاه" value={fa(d.total)} />
            <StatCard title={`دسترس‌پذیری ${fa(d.days)} روز`} value={`${pctNum(d.availability)}٪`} />
            {DEVICE_STATUS.map((s) => <StatCard key={s.value} title={s.label} value={fa(d.status[s.value] ?? 0)} />)}
            <StatCard title="پشتیبانی سیستم‌عامل پایان‌یافته" value={fa(d.eos.past)} />
            <StatCard title="پایان پشتیبانی تا ۶ ماه" value={fa(d.eos.soon)} />
          </div>
          {d.eos.past ? <Note tone="danger">{`${fa(d.eos.past)} دستگاه با سیستم‌عاملی کار می‌کند که پشتیبانی آن پایان یافته است؛ ارتقا یا جداسازی شبکه را برنامه‌ریزی کنید.`}</Note> : null}
          <div className="itam-two">
            <Card title="دسترس‌پذیری مناطق">
              <Table<FleetData["regions"][number]> size="small" rowKey="id" pagination={false} dataSource={d.regions} columns={[
                { title: "منطقه", dataIndex: "name" },
                { title: "دستگاه", key: "n", align: "end" as const, render: (_: unknown, r: { devices: number }) => <span className="ds-num">{fa(r.devices)}</span> },
                { title: "دسترس‌پذیری", key: "a", align: "end" as const, render: (_: unknown, r: { availability: string }) => <span className="ds-num">{pctNum(r.availability)}٪</span> },
              ]} />
            </Card>
            <Card title="قراردادهای نگهداری">
              {d.contracts.length ? (
                <Table size="small" rowKey="id" pagination={false} dataSource={d.contracts} scroll={{ x: true }} columns={[
                  { title: "قرارداد", key: "c", render: (_: unknown, r: FleetData["contracts"][number]) => <a onClick={() => go(`supplier/contracts/${r.id}`)}>{r.name}</a> },
                  { title: "دسترس‌پذیری", key: "a", align: "end" as const, render: (_: unknown, r: FleetData["contracts"][number]) => <span className="ds-num">{pctNum(r.availability)}٪ {r.target ? <Chip tone={r.below_target ? "danger" : "in"}>{`هدف ${pctNum(r.target)}٪`}</Chip> : null}</span> },
                  { title: "تأخیر رفع", key: "l", align: "end" as const, render: (_: unknown, r: FleetData["contracts"][number]) => <span className="ds-num">{r.breaches ? `${fa(r.breaches)} مورد · ${fa(r.late_hours)} ساعت` : "—"}</span> },
                  ...(d.financial ? [{ title: "جریمه", key: "p", align: "end" as const, render: (_: unknown, r: FleetData["contracts"][number]) => <Money v={r.penalty} compact /> }] : []),
                ]} />
              ) : <div className="text-ink-3 text-[13px]">قرارداد نگهداری‌ای به دستگاه‌ها وصل نیست («قرارداد پشتیبانی» دارایی).</div>}
            </Card>
          </div>
          <Card title="دستگاه‌ها" tools={<span className="text-[12px] text-ink-3"><ShieldAlert size={14} strokeWidth={1.4} className="inline me-1" />برای پیش‌بینی خرابی روی ریسک بزنید</span>}>
            <Table<FleetDevice> size="small" rowKey="id" columns={columns} dataSource={d.devices} pagination={{ pageSize: 50, hideOnSinglePage: true }} scroll={{ x: true }} />
          </Card>
        </div>
      )}
      <Modal open={!!plan} title="نگهداری پیشگیرانه" okText="ساخت برنامه‌ها" cancelText="انصراف" confirmLoading={pm.isPending} onOk={() => pm.mutate()} onCancel={() => setPlan(null)} destroyOnHidden>
        {plan ? (
          <div className="flex flex-col gap-3">
            <div className="text-[13px] text-ink-2">برای هر دستگاهی که پیکربندی دارد و برنامهٔ فعالی ندارد، یک برنامهٔ نگهداری در خدمات میدانی ساخته می‌شود که دستور کار بازدیدها را می‌سازد.</div>
            <Space wrap>
              <span>هر</span>
              <InputNumber min={1} max={12} value={plan.every_n} onChange={(v) => setPlan({ ...plan, every_n: Number(v ?? 3) })} />
              <Select value={plan.interval_unit} onChange={(v) => setPlan({ ...plan, interval_unit: v })} options={[{ value: "week", label: "هفته" }, { value: "month", label: "ماه" }]} style={{ width: 110 }} />
            </Space>
            <RecordSelect table="group" value={plan.group_id} onChange={(v) => setPlan({ ...plan, group_id: (v as string) ?? null })} placeholder="گروه انجام (مثلاً نگهداری خودپردازها)" />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}


// ---------------------------------------------------------------------------------------------------------------
// «دفتر اموال»

export function Register() {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const years = useMemo(() => registerYears(todayISO()), []);
  const [fy, setFy] = useState(years[0]);
  const [branch, setBranch] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const params = { fy, ...(branch ? { branch_id: branch } : {}), ...(category ? { category } : {}) };
  const q = useQuery({ queryKey: BANK_KEYS.register(orgId, JSON.stringify(params)), queryFn: () => bankApi.register(api, params), retry: false });
  const d = q.data;
  const exportRows = async () => {
    if (!d) return;
    try {
      await exportExcel(`دفتر-اموال-${fy}`, [
        { title: "پلاک اموال", value: (r: RegisterRow) => r.asset_tag ?? r.number },
        { title: "شرح", value: (r: RegisterRow) => r.name },
        { title: "رده", value: (r: RegisterRow) => categoryLabel(r.category) },
        { title: "مدل", value: (r: RegisterRow) => r.model },
        { title: "سریال", value: (r: RegisterRow) => r.serial_number },
        { title: "شعبه", value: (r: RegisterRow) => r.branch },
        { title: "کد شعبه", value: (r: RegisterRow) => r.branch_code },
        { title: "تاریخ بهره‌برداری", value: (r: RegisterRow) => (r.in_service ? formatJalali(r.in_service) : "") },
        { title: "بهای تمام‌شده", value: (r: RegisterRow) => r.cost, type: "number" as const },
        { title: "افزایش طی سال", value: (r: RegisterRow) => r.additions, type: "number" as const },
        { title: "کاهش طی سال", value: (r: RegisterRow) => r.disposals, type: "number" as const },
        { title: "استهلاک انباشتهٔ اول سال", value: (r: RegisterRow) => r.opening_accumulated, type: "number" as const },
        { title: "استهلاک سال", value: (r: RegisterRow) => r.charge, type: "number" as const },
        { title: "استهلاک انباشتهٔ پایان سال", value: (r: RegisterRow) => r.closing_accumulated, type: "number" as const },
        { title: "ارزش دفتری پایان سال", value: (r: RegisterRow) => r.closing_book, type: "number" as const },
        { title: "ماه‌های استهلاک سال", value: (r: RegisterRow) => r.months_charged, type: "number" as const },
      ], d.rows, `دفتر اموال ${fy}`);
    } catch (e) {
      message.error((e as Error).message);
    }
  };
  const columns = [
    { title: "پلاک", key: "tag", render: (_: unknown, r: RegisterRow) => <span dir="ltr" className="ds-num">{r.asset_tag ?? r.number}</span> },
    { title: "شرح", key: "name", render: (_: unknown, r: RegisterRow) => <div className="flex flex-col"><span>{r.name}</span><span className="text-[12px] text-ink-3">{categoryLabel(r.category)}</span></div> },
    { title: "شعبه", dataIndex: "branch" },
    { title: "بهره‌برداری", key: "in", render: (_: unknown, r: RegisterRow) => (r.in_service ? formatJalali(r.in_service) : "—") },
    { title: "بها", key: "cost", align: "end" as const, render: (_: unknown, r: RegisterRow) => <Money v={r.cost} suffix={false} /> },
    { title: "انباشتهٔ اول سال", key: "oa", align: "end" as const, render: (_: unknown, r: RegisterRow) => <Money v={r.opening_accumulated} suffix={false} /> },
    { title: "استهلاک سال", key: "ch", align: "end" as const, render: (_: unknown, r: RegisterRow) => <Money v={r.charge} suffix={false} /> },
    { title: "انباشتهٔ پایان سال", key: "ca", align: "end" as const, render: (_: unknown, r: RegisterRow) => <Money v={r.closing_accumulated} suffix={false} /> },
    { title: "ارزش دفتری", key: "bk", align: "end" as const, render: (_: unknown, r: RegisterRow) => <Money v={r.closing_book} suffix={false} /> },
  ];
  return (
    <div>
      <PageHeader title="دفتر اموال" actions={<Button icon={<Download {...ICON} />} disabled={!d?.rows.length} onClick={() => void exportRows()}>خروجی اکسل</Button>} />
      <div className="flex flex-wrap gap-2 mb-3">
        <Select value={fy} onChange={setFy} options={years.map((y) => ({ value: y, label: `سال مالی ${fa(y).replace(/٬/g, "")}` }))} style={{ width: 150 }} aria-label="سال مالی" />
        <div style={{ minWidth: 220 }}><RecordSelect table="org_unit" value={branch} onChange={(v) => setBranch((v as string) ?? null)} placeholder="همهٔ شعبه‌ها" /></div>
        <Select allowClear value={category} onChange={(v) => setCategory(v ?? null)} placeholder="همهٔ رده‌ها" options={MODEL_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))} style={{ width: 220 }} aria-label="رده" />
      </div>
      {q.isLoading ? <Loader /> : q.error ? <Note tone="warning">{(q.error as Error).message}</Note> : !d ? null : !d.rows.length ? (
        <EmptyState title="در این سال مالی دارایی با بهای ثبت‌شده نیست" icon={FilePlus2} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="itam-tiles is-wide">
            <StatCard title="بهای تمام‌شده" value={<Money v={d.totals.cost} compact />} />
            <StatCard title="استهلاک انباشتهٔ اول سال" value={<Money v={d.totals.opening_accumulated} compact />} />
            <StatCard title={`استهلاک سال ${fa(d.fiscal_year).replace(/٬/g, "")}`} value={<Money v={d.totals.charge} compact />} />
            <StatCard title="ارزش دفتری پایان سال" value={<Money v={d.totals.closing_book} compact />} />
          </div>
          {d.branches.length > 1 ? (
            <Card title="به تفکیک شعبه">
              <Table<{ branch: string; count: number; cost: string; charge: string; book: string }> size="small" rowKey="branch" pagination={false} dataSource={d.branches} scroll={{ x: true }} columns={[
                { title: "شعبه", dataIndex: "branch" },
                { title: "تعداد", key: "n", align: "end" as const, render: (_: unknown, r: { count: number }) => <span className="ds-num">{fa(r.count)}</span> },
                { title: "بها", key: "c", align: "end" as const, render: (_: unknown, r: { cost: string }) => <Money v={r.cost} compact /> },
                { title: "استهلاک سال", key: "ch", align: "end" as const, render: (_: unknown, r: { charge: string }) => <Money v={r.charge} compact /> },
                { title: "ارزش دفتری", key: "b", align: "end" as const, render: (_: unknown, r: { book: string }) => <Money v={r.book} compact /> },
              ]} />
            </Card>
          ) : null}
          <Card title={`دارایی‌ها — ${formatJalali(d.from)} تا ${formatJalali(d.to)}`}>
            <Table<RegisterRow> size="small" rowKey="id" columns={columns} dataSource={d.rows} pagination={{ pageSize: 100, hideOnSinglePage: true }} scroll={{ x: true }} />
          </Card>
        </div>
      )}
    </div>
  );
}
