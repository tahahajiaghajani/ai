// «پرس‌وجوی پیکربندی» (catalogue CMDB-019/020): a visual query over the graph — start from CIs of a class matching a
// condition, then walk relationships step by step («سرورهای عملیاتی ← اجرا می‌کنند ← پایگاه‌های داده»), each step with
// its own class and condition; the result is the CIs of the last step the person may read. A query can be saved as a
// «پرس‌وجوی پیکربندی» record to run again.
import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { App, Button, Input, Modal, Segmented, Select, Space, Table, Tooltip } from "antd";
import { ArrowDown, Play, Plus, Save, Trash2 } from "lucide-react";
import type { Cond } from "@shared/model/conditions";
import { queryBounded } from "@shared/cmdb/logic";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Card, Note } from "../../components/blocks";
import { EmptyState, Loader } from "../../components/display";
import { FilterBuilder } from "../../records/filter/FilterBuilder";
import { useTableDef } from "../../records/data/hooks";
import { recordsApi } from "../../records/data/api";
import { cmdbApi, CMDB_KEYS, type QueryInput } from "./api";

const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

interface Step {
  type: string;
  direction: "out" | "in";
  class: string | null;
  condition: Cond | null;
}

export default function QueryPage() {
  const { api, orgId, timezone } = useOrg();
  const { message } = App.useApp();
  const { def, schema } = useTableDef("ci");
  const classes = useQuery({ queryKey: CMDB_KEYS.classes(orgId), queryFn: () => cmdbApi.classes(api), staleTime: 300_000 });
  const [cls, setCls] = useState<string | null>(null);
  const [cond, setCond] = useState<Cond | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const input: QueryInput = { class: cls, condition: cond, steps: steps.map((s) => ({ type: s.type, direction: s.direction, class: s.class, condition: s.condition })), size: 100 };
  const run = useMutation({ mutationFn: () => cmdbApi.query(api, input), onError: (e: Error) => message.error(e.message) });
  const bounded = queryBounded(input);
  const save = useMutation({
    mutationFn: () => recordsApi.create(api, "cmdb_query", { name: name.trim(), class: cls, condition: cond, steps: input.steps }),
    onSuccess: () => {
      message.success("پرس‌وجو ذخیره شد");
      setSaveOpen(false);
    },
    onError: (e: Error) => message.error(e.message),
  });
  const classOptions = (classes.data?.classes ?? []).map((c) => ({ value: c.key, label: c.label }));
  const typeOptions = (classes.data?.types ?? []).map((t) => ({ value: t.key, label: t.label }));
  const r = run.data;
  if (!def || !schema) return <Loader />;
  return (
    <div>
      <PageHeader
        title="پرس‌وجوی پیکربندی"
        actions={
          <Space wrap>
            <Button icon={<Save {...ICON} />} onClick={() => setSaveOpen(true)}>ذخیره</Button>
            {/* the server refuses a query of the whole database (no class, condition or step): say so before it is sent */}
            <Tooltip title={bounded ? undefined : "یک کلاس، شرط یا گام انتخاب کنید"}>
              <Button type="primary" icon={<Play {...ICON} />} loading={run.isPending} disabled={!bounded} onClick={() => run.mutate()}>اجرا</Button>
            </Tooltip>
          </Space>
        }
      />
      <div className="flex flex-col gap-3">
        <Card title="از پیکربندی‌های">
          <div className="flex flex-col gap-2">
            <Select showSearch={{ optionFilterProp: "label" }} allowClear placeholder="همهٔ کلاس‌ها" value={cls ?? undefined} onChange={(v) => setCls(v ?? null)} options={classOptions} style={{ maxWidth: 320 }} aria-label="کلاس آغاز" />
            <FilterBuilder def={def as never} schema={schema} value={cond} onChange={setCond} tz={timezone} />
          </div>
        </Card>
        {steps.map((s, i) => (
          <div key={i} className="flex flex-col gap-2">
            <ArrowDown size={18} strokeWidth={1.4} absoluteStrokeWidth className="mx-auto text-ink-3" aria-hidden />
            <Card
              title={`گام ${faDigits(i + 1)}`}
              tools={<Button size="small" type="text" icon={<Trash2 {...ICON} />} aria-label="حذف گام" onClick={() => setSteps(steps.filter((_, j) => j !== i))} />}
            >
              <div className="flex flex-col gap-2">
                <Space wrap>
                  <Segmented
                    value={s.direction}
                    onChange={(v) => setSteps(steps.map((x, j) => (j === i ? { ...x, direction: v as Step["direction"] } : x)))}
                    options={[
                      { value: "out", label: "که این‌ها … آن‌ها" },
                      { value: "in", label: "که آن‌ها … این‌ها" },
                    ]}
                  />
                  <Select value={s.type} onChange={(v) => setSteps(steps.map((x, j) => (j === i ? { ...x, type: v } : x)))} options={typeOptions} style={{ minWidth: 180 }} aria-label="نوع رابطه" />
                  <Select allowClear placeholder="هر کلاسی" value={s.class ?? undefined} onChange={(v) => setSteps(steps.map((x, j) => (j === i ? { ...x, class: v ?? null } : x)))} options={classOptions} showSearch={{ optionFilterProp: "label" }} style={{ minWidth: 180 }} aria-label="کلاس گام" />
                </Space>
                <FilterBuilder def={def as never} schema={schema} value={s.condition} onChange={(c) => setSteps(steps.map((x, j) => (j === i ? { ...x, condition: c } : x)))} tz={timezone} noSummary />
              </div>
            </Card>
          </div>
        ))}
        <div>
          <Button icon={<Plus {...ICON} />} disabled={steps.length >= 5 || !typeOptions.length} onClick={() => setSteps([...steps, { type: typeOptions[0]?.value ?? "depends_on", direction: "out", class: null, condition: null }])}>
            گام رابطه
          </Button>
        </div>
        {run.isPending ? <Loader /> : r ? (
          <Card title={`نتیجه — ${fa(r.total)} پیکربندی`} flush>
            {r.steps.length ? <p className="px-4 pt-3 text-[12.5px] text-ink-3">{r.steps.map((s) => `${s.label}: ${fa(s.count)}`).join(" ← ")}</p> : null}
            {r.truncated ? <Note tone="warning">نتیجه بزرگ بود و کوتاه شد؛ شرط‌ها را تنگ‌تر کنید.</Note> : null}
            {r.rows.length ? (
              <Table
                rowKey={(x) => String(x.id)}
                size="small"
                pagination={r.rows.length > 25 ? { pageSize: 25 } : false}
                dataSource={r.rows}
                columns={[
                  { title: "شماره", dataIndex: "number", key: "no", width: 130, render: (v: string) => <span className="ds-ltr ds-num">{faDigits(v ?? "")}</span> },
                  { title: "نام", dataIndex: "name", key: "n", render: (v: string, x: Record<string, unknown>) => <Link className="ds-link" to={`/${orgId}/cis/${x.id}`}>{v}</Link> },
                  { title: "کلاس", dataIndex: "class", key: "c", render: (v: string) => classes.data?.classes.find((c) => c.key === v)?.label ?? v },
                  { title: "وضعیت", dataIndex: "state", key: "s", render: (v: string) => def.states?.states.find((s) => s.value === v)?.label ?? v },
                ]}
              />
            ) : (
              <EmptyState compact title="پیکربندی‌ای پیدا نشد" />
            )}
          </Card>
        ) : null}
      </div>
      <Modal open={saveOpen} title="ذخیرهٔ پرس‌وجو" onCancel={() => setSaveOpen(false)} onOk={() => save.mutate()} okText="ذخیره" cancelText="انصراف" okButtonProps={{ disabled: !name.trim(), loading: save.isPending }} destroyOnHidden>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="نام پرس‌وجو" maxLength={120} autoFocus />
      </Modal>
    </div>
  );
}
