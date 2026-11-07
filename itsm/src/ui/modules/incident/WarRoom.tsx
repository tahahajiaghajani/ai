// «اتاق عملیات»: one pane for a major incident's manager, communications lead and resolvers (catalogue INC-046,
// INC-048, INC-053, INC-055). Overview (state, priority, SLA, time since the disruption began, impact), the live
// timeline (key events, back-dated entries, decisions — add, mark as key, remove), roles (manager, communications
// lead), communications (the cadence, a stakeholder update to stakeholders, the affected people or the team), child
// incidents, tasks, and the post-incident review. Everything refreshes live («زنده»).
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Button, Checkbox, Form, Input, Modal, Segmented, Select, Tooltip } from "antd";
import { Star, Trash2, Plus, Send, ExternalLink, ClipboardCheck } from "lucide-react";
import { MANUAL_KINDS, TIMELINE_KINDS, type TimelineKind } from "@shared/incident/logic";
import { MAJOR_STATES } from "@shared/tables/incident";
import { formatJalaliDateTime } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { Card, ICON14 } from "../../components/blocks";
import { Chip, EmptyState, Loader } from "../../components/display";
import { ChoiceTag, DateTimeInput, RecordMarkdown, RefLink, SlaChips, UserChip, UserSelect, recordPath, recordsApi, useRecord, useRecordList, useTableDef } from "../../records";
import { optionsOf } from "../../records/model/schema";
import { incidentApi, useIncidentMeta, useIncidentRefresh, useTimeline } from "./api";
import { cadence, durationText, visibleTimeline } from "./model";

export default function WarRoom() {
  const { id = "" } = useParams();
  const { api, orgId, timezone } = useOrg();
  const nav = useNavigate();
  const rec = useRecord("incident", id);
  const { def, schema } = useTableDef("incident");
  const tl = useTimeline(id);
  const refresh = useIncidentRefresh();
  const [keyOnly, setKeyOnly] = useState(false);
  const [adding, setAdding] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const kids = useRecordList("incident", { filter: { f: "parent_id", op: "eq", v: id }, size: 20, sort: "-opened_at", fields: ["number", "short_description", "state", "caller_id"], total: true });
  const tasks = useRecordList("incident_task", { filter: { f: "incident_id", op: "eq", v: id }, size: 30, sort: "sort_order,number", fields: ["number", "short_description", "state", "assignment_group_id", "assigned_to"], total: true });
  const reviews = useRecordList("incident_review", { filter: { and: [{ f: "incident_id", op: "eq", v: id }, { f: "state", op: "ne", v: "canceled" }] }, size: 1, fields: ["number", "title", "state"], total: false });
  const after = () => {
    void rec.refetch();
    void refresh();
  };
  const toggleKey = useAction(({ ev, key }: { ev: string; key: boolean }) => incidentApi.keyEvent(api, id, ev, key), { onSuccess: after });
  const remove = useAction((ev: string) => incidentApi.removeEvent(api, id, ev), { success: "رویداد حذف شد.", onSuccess: after });
  const review = useAction(() => incidentApi.review(api, id), { onSuccess: (d) => nav(`/${orgId}/${recordPath("incident_review", d.row.id)}`) });
  const saveRole = useAction((data: Record<string, unknown>) => recordsApi.update(api, "incident", id, data, rec.data?.row.version as number | undefined), { success: "ذخیره شد.", onSuccess: after });

  const items = useMemo(() => visibleTimeline(tl.data?.items ?? [], keyOnly), [tl.data, keyOnly]);
  if (rec.isLoading || !def || !schema) return <Loader />;
  if (!rec.data) return <EmptyState title="این رخداد پیدا نشد" description="شاید حذف شده باشد یا به آن دسترسی نداشته باشید." />;
  const { row, display, meta } = rec.data;
  const may = (meta as { incident?: { can_work?: boolean } }).incident?.can_work ?? false;
  const fieldOpts = (name: string) => {
    const f = def.fields.find((x) => x.name === name);
    return f ? optionsOf(f, schema.choices) : [];
  };
  const opt = (name: string, v: unknown) => fieldOpts(name).find((o) => o.value === v);
  const started = Date.parse(String(row.detected_at ?? row.opened_at ?? ""));
  const ended = Date.parse(String(row.resolved_at ?? ""));
  const elapsed = Number.isNaN(started) ? null : Math.max(0, ((Number.isNaN(ended) ? now : ended) - started) / 1000);
  const c = row.major_state === "accepted" ? cadence(row.next_update_at as string | null, now) : { tone: null, text: "" };
  const allDisplay = { ...display, ...(tl.data?.display ?? {}), ...(kids.data?.display ?? {}), ...(tasks.data?.display ?? {}) };
  const comms = (tl.data?.items ?? []).filter((x) => x.kind === "communication").slice(-3).reverse();

  return (
    <div>
      <PageHeader
        title={<span>اتاق عملیات <bdi className="ds-num">{String(row.number ?? "")}</bdi></span>}
        subtitle={String(row.short_description ?? "")}
        back={`/${orgId}/${recordPath("incident", id)}`}
        actions={
          <>
            {row.bridge_url ? (
              <Button icon={<ExternalLink {...ICON14} />} href={String(row.bridge_url)} target="_blank" rel="noreferrer noopener">
                جلسهٔ هماهنگی
              </Button>
            ) : null}
            {may ? (
              <Button type="primary" icon={<Send {...ICON14} />} onClick={() => setUpdating(true)}>
                اطلاع‌رسانی
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="وضعیت">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <ChoiceTag option={MAJOR_STATES.find((o) => o.value === row.major_state)} value={String(row.major_state ?? "")} strong />
                <ChoiceTag option={opt("state", row.state)} value={String(row.state ?? "")} />
                <ChoiceTag option={opt("priority", row.priority)} value={String(row.priority ?? "")} />
                {elapsed !== null ? <span className="text-[13px] text-ink-3">{row.resolved_at ? "مدت اختلال" : "از آغاز اختلال"}: <span className="ds-num">{durationText(elapsed)}</span></span> : null}
              </div>
              <SlaChips raw={(meta as { sla?: unknown }).sla} />
              {(row.affected_services as string[] | undefined)?.length || (row.affected_cis as string[] | undefined)?.length ? (
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="text-ink-3">متأثر:</span>
                  {[...((row.affected_services as string[]) ?? []).map((x) => ["service", x] as const), ...((row.affected_cis as string[]) ?? []).map((x) => ["ci", x] as const)].map(([t, x]) => (
                    <RefLink key={x} table={t} id={x} display={display} />
                  ))}
                </div>
              ) : null}
              {row.business_impact ? <RecordMarkdown text={String(row.business_impact)} display={display} /> : null}
            </div>
          </Card>
          <Card
            title="خط زمانی"
            tools={
              <div className="flex items-center gap-2">
                <Segmented size="small" value={keyOnly ? "key" : "all"} onChange={(v) => setKeyOnly(v === "key")} options={[{ value: "all", label: "همه" }, { value: "key", label: "رویدادهای کلیدی" }]} />
                {may ? (
                  <Button size="small" icon={<Plus {...ICON14} />} onClick={() => setAdding(true)}>
                    رویداد
                  </Button>
                ) : null}
              </div>
            }
          >
            {tl.isLoading ? (
              <Loader />
            ) : !items.length ? (
              <p className="text-[13px] text-ink-3">رویدادی ثبت نشده است.</p>
            ) : (
              <ol className="flex flex-col" aria-label="خط زمانی رخداد">
                {items.map((x) => (
                  <li key={x.id} className="flex flex-col gap-1 border-b border-line py-2 last:border-b-0 sm:flex-row sm:gap-3">
                    <span className="ds-num shrink-0 text-[12px] text-ink-3 sm:w-[132px]">{formatJalaliDateTime(x.at, timezone)}</span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex items-start gap-2">
                        <ChoiceTag option={{ value: x.kind, label: TIMELINE_KINDS[x.kind]?.label ?? x.kind, color: TIMELINE_KINDS[x.kind]?.color as never }} value={x.kind} />
                        <span className="min-w-0 flex-1 text-[13px] text-ink">{x.title}</span>
                        {x.removable && may ? (
                          <span className="flex shrink-0 gap-0.5">
                            <Tooltip title={x.key ? "برداشتن از رویدادهای کلیدی" : "رویداد کلیدی"}>
                              <Button size="small" type="text" aria-pressed={!!x.key} aria-label="رویداد کلیدی" icon={<Star {...ICON14} fill={x.key ? "currentColor" : "none"} />} onClick={() => toggleKey.mutate({ ev: x.id, key: !x.key })} />
                            </Tooltip>
                            <Tooltip title="حذف">
                              <Button size="small" type="text" aria-label="حذف" icon={<Trash2 {...ICON14} />} onClick={() => remove.mutate(x.id)} />
                            </Tooltip>
                          </span>
                        ) : null}
                      </div>
                      {x.body ? <p className="line-clamp-4 whitespace-pre-wrap text-[12px] text-ink-2">{x.body}</p> : null}
                      {x.by ? (
                        <span className="text-[12px] text-ink-3">
                          <UserChip id={x.by} display={allDisplay} compact />
                        </span>
                      ) : null}
                      {x.ref ? <RefLink table={x.ref.table} id={x.ref.id} display={allDisplay} /> : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card title="نقش‌ها">
            <Form layout="vertical" requiredMark={false} disabled={!may}>
              <Form.Item label="مدیر رخداد عمده" className="mb-2">
                <UserSelect value={(row.mi_manager_id as string) ?? null} onChange={(v) => saveRole.mutate({ mi_manager_id: v ?? null })} aria-label="مدیر رخداد عمده" />
              </Form.Item>
              <Form.Item label="مسئول اطلاع‌رسانی" className="mb-0">
                <UserSelect value={(row.mi_comms_id as string) ?? null} onChange={(v) => saveRole.mutate({ mi_comms_id: v ?? null })} allowClear aria-label="مسئول اطلاع‌رسانی" />
              </Form.Item>
            </Form>
          </Card>
          <Card title="اطلاع‌رسانی">
            <div className="flex flex-col gap-2 text-[13px]">
              {c.text ? <Chip tone={c.tone === "danger" ? "danger" : c.tone === "warning" ? "warning" : "neutral"}>{c.text}</Chip> : null}
              <span className="text-ink-3">
                آخرین اطلاع‌رسانی: {row.last_update_at ? <span className="ds-num">{formatJalaliDateTime(String(row.last_update_at), timezone)}</span> : "هنوز نه"}
              </span>
              {comms.map((x) => (
                <div key={x.id} className="rounded-md bg-sunken px-2.5 py-1.5">
                  <div className="text-ink">{x.title}</div>
                  <div className="ds-num text-[12px] text-ink-3">{formatJalaliDateTime(x.at, timezone)}</div>
                </div>
              ))}
            </div>
          </Card>
          <Card title="رخدادهای فرزند" meta={kids.data?.total ? <span className="ds-num text-ink-3">{String(kids.data.total)}</span> : undefined}>
            {!kids.data?.rows.length ? (
              <p className="text-[13px] text-ink-3">رخداد فرزندی نیست.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-[13px]">
                {kids.data.rows.map((k) => (
                  <li key={k.id} className="flex items-center gap-2">
                    <RefLink table="incident" id={k.id} display={{ [k.id]: `${k.number} — ${k.short_description}` }} />
                    <span className="ms-auto shrink-0">
                      <ChoiceTag option={opt("state", k.state)} value={String(k.state ?? "")} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="کارها" meta={tasks.data?.total ? <span className="ds-num text-ink-3">{String(tasks.data.total)}</span> : undefined}>
            {!tasks.data?.rows.length ? (
              <p className="text-[13px] text-ink-3">کاری تعریف نشده است.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-[13px]">
                {tasks.data.rows.map((t) => (
                  <li key={t.id} className="flex items-center gap-2">
                    <RefLink table="incident_task" id={t.id} display={{ [t.id]: `${t.number} — ${t.short_description}` }} />
                    <span className="ms-auto shrink-0 text-[12px] text-ink-3">{t.assigned_to ? <UserChip id={t.assigned_to as string} display={allDisplay} compact /> : null}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="بازبینی پس از رخداد">
            {reviews.data?.rows[0] ? (
              <RefLink table="incident_review" id={reviews.data.rows[0].id} display={{ [reviews.data.rows[0].id]: `${reviews.data.rows[0].number} — ${reviews.data.rows[0].title}` }} />
            ) : (
              <Button icon={<ClipboardCheck {...ICON14} />} onClick={() => review.mutate(undefined)} loading={review.isPending}>
                پیش‌نویس بازبینی
              </Button>
            )}
          </Card>
        </div>
      </div>
      {adding ? <AddEvent id={id} onClose={() => setAdding(false)} onDone={after} /> : null}
      {updating ? <SendUpdate id={id} number={String(row.number ?? "")} onClose={() => setUpdating(false)} onDone={after} /> : null}
    </div>
  );
}

function AddEvent({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const { api, timezone } = useOrg();
  const [kind, setKind] = useState<TimelineKind>("decision");
  const [at, setAt] = useState<string | null>(new Date().toISOString());
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [key, setKey] = useState(true);
  const run = useAction(() => incidentApi.addEvent(api, id, { kind, at, title: title.trim(), body: body.trim() || null, key }), {
    success: "به خط زمانی افزوده شد.",
    onSuccess: () => {
      onClose();
      onDone();
    },
  });
  return (
    <Modal open title="رویداد تازهٔ خط زمانی" okText="افزودن" cancelText="انصراف" onCancel={onClose} onOk={() => run.mutate(undefined)} confirmLoading={run.isPending} okButtonProps={{ disabled: !title.trim() }} destroyOnHidden>
      <Form layout="vertical" requiredMark={false}>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Form.Item label="نوع">
            <Select value={kind} onChange={setKind} options={MANUAL_KINDS.map((k) => ({ value: k, label: TIMELINE_KINDS[k].label }))} />
          </Form.Item>
          <Form.Item label="زمان" extra="برای ثبت آنچه پیش‌تر رخ داده، زمان را به عقب ببرید">
            <DateTimeInput value={at} onChange={setAt} tz={timezone} />
          </Form.Item>
        </div>
        <Form.Item label="عنوان" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
        </Form.Item>
        <Form.Item label="شرح">
          <Input.TextArea value={body} onChange={(e) => setBody(e.target.value)} autoSize={{ minRows: 2, maxRows: 8 }} maxLength={4000} />
        </Form.Item>
        <Checkbox checked={key} onChange={(e) => setKey(e.target.checked)}>
          رویداد کلیدی (در گزارش مدیران و بازبینی)
        </Checkbox>
      </Form>
    </Modal>
  );
}

function SendUpdate({ id, number, onClose, onDone }: { id: string; number: string; onClose: () => void; onDone: () => void }) {
  const { api } = useOrg();
  const meta = useIncidentMeta();
  const [audience, setAudience] = useState("stakeholders");
  const [subject, setSubject] = useState(`به‌روزرسانی رخداد ${number}`);
  const [body, setBody] = useState("");
  const [channels, setChannels] = useState<string[]>(["in_app", "email"]);
  const run = useAction(() => incidentApi.sendUpdate(api, id, { audience, subject: subject.trim(), body: body.trim(), channels }), {
    success: (d) => `اطلاع‌رسانی برای ${d.recipients.toLocaleString("fa-IR")} نفر فرستاده شد.`,
    onSuccess: () => {
      onClose();
      onDone();
    },
  });
  const audiences = Object.entries(meta.data?.audiences ?? { stakeholders: "ذی‌نفعان", affected: "کاربران متأثر", team: "تیم رسیدگی" });
  return (
    <Modal open title="اطلاع‌رسانی رخداد" okText="فرستادن" cancelText="انصراف" onCancel={onClose} onOk={() => run.mutate(undefined)} confirmLoading={run.isPending} okButtonProps={{ disabled: !subject.trim() || !body.trim() || !channels.length }} destroyOnHidden width={620}>
      <Form layout="vertical" requiredMark={false}>
        <Form.Item label="مخاطب">
          <Segmented value={audience} onChange={(v) => setAudience(String(v))} options={audiences.map(([value, label]) => ({ value, label }))} />
        </Form.Item>
        <Form.Item label="موضوع" required>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
        </Form.Item>
        <Form.Item label="متن" required extra="چه رخ داده، چه کسانی متأثرند، چه می‌کنیم و اطلاع‌رسانی بعدی کی است">
          <Input.TextArea value={body} onChange={(e) => setBody(e.target.value)} autoSize={{ minRows: 5, maxRows: 14 }} maxLength={20000} />
        </Form.Item>
        <Form.Item label="مجراها" className="mb-0">
          <Checkbox.Group value={channels} onChange={(v) => setChannels(v as string[])} options={[{ value: "in_app", label: "اعلان برنامه" }, { value: "email", label: "ایمیل" }, { value: "sms", label: "پیامک" }]} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
