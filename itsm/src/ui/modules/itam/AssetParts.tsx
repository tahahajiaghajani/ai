// The asset page's extensions (catalogue ITAM-008/043/073/074): header actions — hand over (check-out to a person, a
// unit or a place, permanent or on loan), take back into a stockroom with its condition, print its label, create its
// CI — and the «نمای ۳۶۰» tab: the lifecycle timeline, the assignment history, contracts and warranty, the total cost
// of ownership with the repair-or-replace advice (financial field group only), the linked CI with its software, and
// the analysis summary (AI, or rule-based without a model). Also the «دارایی‌ها» panel of requested items (hand over
// a reserved or available asset) and the leaver's return on member profiles.
import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Input, Modal, Segmented, Select, Space, Table, Timeline } from "antd";
import { ArrowDownToLine, ArrowUpFromLine, Boxes, QrCode, Sparkles, UserMinus } from "lucide-react";
import { CONDITIONS } from "@shared/tables/itam";
import { formatJalali, formatJalaliDateTime } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { Card, Field, Note } from "../../components/blocks";
import { Chip, EmptyState, JDate, Loader } from "../../components/display";
import { DateInput } from "../../components/inputs";
import { RecordMarkdown, RecordSelect, UserSelect } from "../../records";
import type { RecordContext } from "../../records/extensions";
import { itamApi, ITAM_KEYS, type AiText } from "./api";
import { AiLabel, ICON, Money } from "./parts";

const conditionOptions = CONDITIONS.map((c) => ({ value: c.value, label: c.label }));
const RECO: Record<string, [string, "in" | "warning" | "danger"]> = { keep: ["نگه‌داشتن", "in"], watch: ["زیر نظر", "warning"], replace: ["جایگزینی", "danger"] };

export function AssetActions({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const row = ctx.row as Record<string, any>;
  const [mode, setMode] = useState<"out" | "in" | null>(null);
  const [to, setTo] = useState<"person" | "place">("person");
  const [user, setUser] = useState<string | null>(null);
  const [location, setLocation] = useState<string | null>(row.location_id ?? null);
  const [dept, setDept] = useState<string | null>(null);
  const [usage, setUsage] = useState<"permanent" | "loaner">("permanent");
  const [due, setDue] = useState<string | null>(null);
  const [room, setRoom] = useState<string | null>(row.stockroom_id ?? null);
  const [condition, setCondition] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const done = (text: string) => {
    message.success(text);
    setMode(null);
    ctx.refresh();
    qc.invalidateQueries({ queryKey: ITAM_KEYS.all(orgId) });
  };
  const out = useMutation({
    mutationFn: () => itamApi.checkout(api, row.id, { assigned_to: to === "person" ? user : null, location_id: location, department_id: dept, usage_type: usage, expected_return_at: usage === "loaner" ? due : null, condition, note: note || null }),
    onSuccess: () => done("دارایی تحویل شد"),
    onError: (e: Error) => message.error(e.message),
  });
  const back = useMutation({
    mutationFn: () => itamApi.checkin(api, row.id, { stockroom_id: room!, condition, note: note || null }),
    onSuccess: () => done("دارایی به انبار بازگشت"),
    onError: (e: Error) => message.error(e.message),
  });
  const link = useMutation({
    mutationFn: () => itamApi.linkCi(api, row.id),
    onSuccess: (r) => (r.ci_id ? done("پیکربندی دارایی ساخته و پیوند شد") : message.warning(r.message ?? "پیکربندی ساخته نشد")),
    onError: (e: Error) => message.error(e.message),
  });
  if (!ctx.meta.canWrite) return <Link to={`/${orgId}/itam/labels?ids=${row.id}`}><Button size="small" icon={<QrCode {...ICON} />}>برچسب</Button></Link>;
  const canOut = ["in_stock", "in_use", "in_repair", "in_transit", "missing"].includes(row.state);
  const canIn = ["in_use", "in_repair", "missing", "in_transit", "retired"].includes(row.state);
  return (
    <Space size={6} wrap>
      {canOut ? <Button size="small" icon={<ArrowUpFromLine {...ICON} />} onClick={() => { setNote(""); setCondition(null); setMode("out"); }}>{row.state === "in_use" ? "تحویل به دیگری" : "تحویل"}</Button> : null}
      {canIn ? <Button size="small" icon={<ArrowDownToLine {...ICON} />} onClick={() => { setNote(""); setCondition("good"); setMode("in"); }}>بازگشت به انبار</Button> : null}
      <Link to={`/${orgId}/itam/labels?ids=${row.id}`}><Button size="small" icon={<QrCode {...ICON} />}>برچسب</Button></Link>
      {!row.ci_id ? <Button size="small" icon={<Boxes {...ICON} />} loading={link.isPending} onClick={() => link.mutate()}>ساخت پیکربندی</Button> : null}
      <Modal open={mode === "out"} title="تحویل دارایی" onCancel={() => setMode(null)} onOk={() => out.mutate()} okText="تحویل" confirmLoading={out.isPending} destroyOnHidden okButtonProps={{ disabled: to === "person" ? !user : !location && !dept }}>
        <div className="flex flex-col gap-3">
          <Segmented block value={to} onChange={(v) => setTo(v as "person" | "place")} options={[{ value: "person", label: "به یک نفر" }, { value: "place", label: "به واحد یا مکان" }]} />
          {to === "person" ? <Field label="تحویل‌گیرنده"><UserSelect value={user} onChange={(v) => setUser((v as string) ?? null)} /></Field> : <Field label="واحد"><RecordSelect table="org_unit" value={dept} onChange={(v) => setDept((v as string) ?? null)} /></Field>}
          <Field label="مکان"><RecordSelect table="location" value={location} onChange={(v) => setLocation((v as string) ?? null)} /></Field>
          <Segmented value={usage} onChange={(v) => setUsage(v as "permanent" | "loaner")} options={[{ value: "permanent", label: "دائم" }, { value: "loaner", label: "امانی" }]} />
          {usage === "loaner" ? <Field label="موعد بازگشت"><DateInput value={due} onChange={setDue} /></Field> : null}
          <Field label="وضعیت ظاهری"><Select allowClear value={condition} onChange={setCondition} options={conditionOptions} /></Field>
          <Field label="یادداشت"><Input.TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} /></Field>
        </div>
      </Modal>
      <Modal open={mode === "in"} title="بازگشت به انبار" onCancel={() => setMode(null)} onOk={() => back.mutate()} okText="بازگشت" confirmLoading={back.isPending} destroyOnHidden okButtonProps={{ disabled: !room }}>
        <div className="flex flex-col gap-3">
          <Field label="انبار"><RecordSelect table="stockroom" value={room} onChange={(v) => setRoom((v as string) ?? null)} /></Field>
          <Field label="وضعیت ظاهری" hint="«ضعیف» و «آسیب‌دیده» دارایی را «معیوب» در انبار ثبت می‌کند"><Select value={condition} onChange={setCondition} options={conditionOptions} /></Field>
          <Field label="یادداشت"><Input.TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} /></Field>
        </div>
      </Modal>
    </Space>
  );
}

export function Asset360Tab({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const id = String(ctx.row.id);
  const q = useQuery({ queryKey: ITAM_KEYS.a360(orgId, id), queryFn: () => itamApi.a360(api, id) });
  const [summary, setSummary] = useState<AiText | null>(null);
  const run = useMutation({ mutationFn: () => itamApi.summary(api, id), onSuccess: setSummary, onError: (e: Error) => message.error(e.message) });
  const d = q.data;
  if (q.isLoading) return <Loader />;
  if (!d) return <EmptyState compact title="نمای ۳۶۰ در دسترس نیست" />;
  const w = d.warranty;
  return (
    <div className="flex flex-col gap-3">
      <Card title="خلاصهٔ تحلیلی" tools={<Button size="small" icon={<Sparkles {...ICON} />} loading={run.isPending} onClick={() => run.mutate()}>{summary ? "دوباره" : "ساخت خلاصه"}</Button>}>
        {summary ? (
          <div className="flex flex-col gap-1">
            <RecordMarkdown text={summary.text} />
            <AiLabel ai={summary.ai} model={summary.model} />
          </div>
        ) : (
          <div className="text-ink-3 text-[13px]">وضعیت، ضمانت، تحویل‌ها، هزینه و پیشنهاد تعمیر یا جایگزینی در چند خط</div>
        )}
      </Card>
      <div className="itam-two">
        <Card title="چرخهٔ عمر">
          <Timeline
            items={d.timeline.slice(0, 30).map((t) => ({
              key: `${t.at}-${t.title}`,
              color: t.kind === "repair" ? "orange" : t.kind === "assignment" ? "green" : t.kind === "audit" ? "purple" : "blue",
              children: (
                <div className="text-[13px]">
                  <div>{t.link ? <Link className="ds-link" to={`/${orgId}/r/${t.link.table}/${t.link.id}`}>{t.title}</Link> : t.title}</div>
                  <div className="text-ink-3 text-[12px]">{formatJalaliDateTime(t.at)}{t.detail ? ` — ${t.detail}` : ""}</div>
                </div>
              ),
            }))}
          />
        </Card>
        <div className="flex flex-col gap-3">
          <Card title="ضمانت و قراردادها">
            <div className="mb-2">
              {w.status === "none" ? <Chip tone="neutral">بدون ضمانت</Chip> : w.status === "expired" ? <Chip tone="danger">ضمانت پایان یافته ({formatJalali(w.end)})</Chip> : w.status === "expiring" ? <Chip tone="warning">{`${fa(w.days_left ?? 0)} روز تا پایان ضمانت`}</Chip> : <Chip tone="in">ضمانت تا {formatJalali(w.end)}</Chip>}
            </div>
            {d.contracts.length ? (
              <ul className="itam-list">
                {d.contracts.map((c) => (
                  <li key={c.id}>
                    <Link className="ds-link" to={`/${orgId}/contracts/${c.id}`}>{c.number} {c.name}</Link>
                    <span className="text-ink-3 text-[12px]">{c.supplier ?? ""} {c.end_date ? `— تا ${formatJalali(c.end_date)}` : ""}</span>
                  </li>
                ))}
              </ul>
            ) : <div className="text-ink-3 text-[13px]">قراردادی این دارایی را پوشش نمی‌دهد</div>}
          </Card>
          <Card title="پیکربندی پیوسته">
            {d.ci ? (
              <div className="flex flex-col gap-1 text-[13px]">
                <Link className="ds-link" to={`/${orgId}/cis/${d.ci.id}`}>{d.ci.number} — {d.ci.name}</Link>
                <span className="text-ink-3">سلامت داده: {d.ci.health_score === null ? "—" : fa(d.ci.health_score)}</span>
                {d.software.length ? <span className="text-ink-3">{fa(d.software.length)} نرم‌افزار نصب‌شده: {d.software.slice(0, 8).map((s) => s.model ?? s.name).join("، ")}</span> : null}
              </div>
            ) : <div className="text-ink-3 text-[13px]">پیکربندی ندارد یا اجازهٔ دیدنش را ندارید</div>}
          </Card>
        </div>
      </div>
      <Card title="تاریخچهٔ تحویل" flush>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={d.assignments}
          locale={{ emptyText: "هنوز تحویل نشده است" }}
          columns={[
            { title: "تحویل‌گیرنده", dataIndex: "name", key: "name", render: (v: string | null, r) => v ?? r.location ?? "—" },
            { title: "از", dataIndex: "from_at", key: "from", render: (v: string) => <JDate v={v.slice(0, 10)} /> },
            { title: "تا", dataIndex: "to_at", key: "to", render: (v: string | null) => (v ? <JDate v={v.slice(0, 10)} /> : <Chip tone="in">در دست</Chip>) },
            { title: "نوع", dataIndex: "usage_type", key: "usage", render: (v: string | null) => (v === "loaner" ? "امانی" : "دائم") },
            { title: "وضعیت بازگشت", dataIndex: "condition_in", key: "cond", render: (v: string | null) => CONDITIONS.find((c) => c.value === v)?.label ?? "—" },
          ]}
        />
      </Card>
      {d.costs ? (
        <Card title="هزینهٔ کل مالکیت">
          <div className="itam-tiles">
            <div className="itam-fig"><span>خرید</span><Money v={d.costs.acquisition} /></div>
            <div className="itam-fig"><span>تعمیرها</span><Money v={d.costs.repairs} /></div>
            <div className="itam-fig"><span>سهم قراردادها (سالانه)</span><Money v={d.costs.contracts} /></div>
            <div className="itam-fig"><span>سایر هزینه‌ها</span><Money v={d.costs.other} /></div>
            <div className="itam-fig"><span>جمع</span><Money v={d.costs.total} /></div>
            <div className="itam-fig"><span>ارزش دفتری</span><Money v={d.costs.book_value} /></div>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[13px]">
            <span>پیشنهاد:</span>
            <Chip tone={RECO[d.costs.recommendation][1]}>{RECO[d.costs.recommendation][0]}</Chip>
            <span className="text-ink-3">{d.costs.reasons.join("؛ ")}</span>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

/** «دارایی‌ها» on a requested item: what is reserved or handed over for it, and what is available to hand over. */
export function RequestAssetsPanel({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const id = String(ctx.row.id);
  const q = useQuery({ queryKey: ITAM_KEYS.item(orgId, id), queryFn: () => itamApi.requestItem(api, id), retry: false });
  const assign = useMutation({
    mutationFn: (assetId: string) => itamApi.assignToItem(api, id, assetId),
    onSuccess: () => {
      message.success("دارایی تحویل شد");
      qc.invalidateQueries({ queryKey: ITAM_KEYS.item(orgId, id) });
      ctx.refresh();
    },
    onError: (e: Error) => message.error(e.message),
  });
  const d = q.data;
  if (!d) return <div className="text-ink-3 text-[13px]">{q.isLoading ? "…" : "اجازهٔ دیدن دارایی‌ها را ندارید"}</div>;
  if (!d.models.length && !d.assets.length) return <div className="text-ink-3 text-[13px]">این قلم به مدلی از کاتالوگ دارایی بسته نیست</div>;
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      {d.assets.map((a) => (
        <div key={a.id} className="flex items-center justify-between gap-2">
          <Link className="ds-link" to={`/${orgId}/assets/${a.id}`}>{a.asset_tag ?? a.number} {a.name}</Link>
          {a.state === "in_use" ? <Chip tone="in">تحویل‌شده</Chip> : a.substate === "reserved" ? <Button size="small" loading={assign.isPending} onClick={() => assign.mutate(a.id)}>تحویل</Button> : <Chip tone="neutral">{a.state}</Chip>}
        </div>
      ))}
      {d.candidates.length && !d.assets.some((a) => a.state === "in_use") ? (
        <>
          <div className="text-ink-3">موجود در انبار:</div>
          {d.candidates.slice(0, 6).map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2">
              <span>{a.asset_tag ?? a.number} <span className="text-ink-3">{a.stockroom ?? ""}</span></span>
              <Button size="small" loading={assign.isPending} onClick={() => assign.mutate(a.id)}>تحویل این</Button>
            </div>
          ))}
        </>
      ) : !d.assets.length ? <Note tone="warning">موجودی آماده‌ای از {d.models.map((m) => m.name).join("، ")} نیست</Note> : null}
    </div>
  );
}

/** «بازپس‌گیری دارایی‌ها» on a member profile (ITAM-011): the leaver's assets to be returned by a date. */
export function LeaverAction({ ctx }: { ctx: RecordContext }) {
  const { api, allows } = useOrg();
  const { message, modal } = App.useApp();
  const [due, setDue] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const userId = String((ctx.row as Record<string, unknown>).user_id ?? "");
  const run = useMutation({
    mutationFn: () => itamApi.leaver(api, userId, due),
    onSuccess: (r) => {
      setOpen(false);
      modal.info({ title: "بازپس‌گیری ثبت شد", content: `${fa(r.assets)} دارایی برای بازگشت علامت خورد، ${fa(r.allocations)} مجوز و ${fa(r.accounts)} حساب SaaS آزاد شد.` });
    },
    onError: (e: Error) => message.error(e.message),
  });
  if (!userId || !allows({ area: "asset", op: "write", scope: "all" })) return null;
  return (
    <>
      <Button size="small" icon={<UserMinus {...ICON} />} onClick={() => setOpen(true)}>بازپس‌گیری دارایی‌ها</Button>
      <Modal open={open} title="بازپس‌گیری دارایی‌های کارمند خروجی" onCancel={() => setOpen(false)} onOk={() => run.mutate()} okText="ثبت" confirmLoading={run.isPending} destroyOnHidden>
        <Field label="موعد بازگرداندن"><DateInput value={due} onChange={setDue} /></Field>
      </Modal>
    </>
  );
}
