// The builder's approval and fulfilment tab (REQ-024, REQ-026, REQ-027): the item's approval rule (pick one of the
// rules on requested items, or make one bound to this item — the requester's manager, or the manager and then a
// group — and refine its levels on the rule's own page), the fulfilment group, the fulfilment flow (bound to the
// item's code; «ساخت گردش‌کار» drafts one and opens the designer) and, for items without a flow, task templates in
// order (each after the previous one, optionally shown to the requester).
import { useState } from "react";
import { Alert, Button, Empty, Input, Popconfirm, Select, Space, Switch, Tag } from "antd";
import { ExternalLink, Plus, Trash2, Workflow } from "lucide-react";
import { useNavigate } from "react-router";
import { TASK_PHASES } from "@shared/request/vocab";
import { useOrg } from "../../lib/org";
import { useAction, useNotify } from "../../lib/hooks";
import { Card, Field, ICON14 } from "../../components/blocks";
import { RecordSelect, recordPath, recordsApi, useRecordList } from "../../records";
import { requestApi, type Definition } from "./api";
import { nextOrder } from "./model";

type Row = Record<string, any>;

export function Fulfilment({ def, canWrite, onChanged }: { def: Definition; canWrite: boolean; onChanged: () => void }) {
  const { api, orgId } = useOrg();
  const navigate = useNavigate();
  const notify = useNotify();
  const item = def.item;
  const id = String(item.id);
  const [group, setGroup] = useState<string | null>(null);
  const patch = async (data: Row) => {
    try {
      await recordsApi.update(api, "catalog_item", id, data);
      onChanged();
    } catch (e) {
      notify.error(e);
    }
  };
  const bind = useAction((ruleId: string) => requestApi.bindRule(api, id, ruleId), { success: "قاعدهٔ تأیید به قلم بسته شد.", onSuccess: onChanged });
  const make = useAction((levels: unknown[]) => requestApi.newApprovalRule(api, id, { levels }), { success: "قاعدهٔ تأیید ساخته و به قلم بسته شد.", onSuccess: onChanged });
  const flow = useAction(() => requestApi.newFlow(api, id), {
    onSuccess: (r) => {
      onChanged();
      navigate(`/${orgId}/flows/${r.flow.id}/design`);
    },
  });
  const rule = def.approval_rules.find((r) => r.id === item.approval_rule_id);
  const bound = def.flows.filter((f) => f.bound);
  const manager = { name: "مدیر مستقیم", sources: [{ kind: "manager" }], rule: "any" };

  return (
    <div className="rq-form">
      <Card title="تأیید">
        <div className="rq-form">
          {rule ? (
            <Space wrap>
              <span>قاعدهٔ این قلم: {rule.name}</span>
              {!rule.active ? <Tag color="warning">غیرفعال</Tag> : null}
              {!rule.bound ? <Tag color="warning">به قلم بسته نیست</Tag> : null}
              <Button size="small" icon={<ExternalLink {...ICON14} />} onClick={() => navigate(`/${orgId}/${recordPath("approval_rule", rule.id)}`)}>
                سطح‌های تأیید
              </Button>
            </Space>
          ) : (
            <span>این قلم بدون تأیید انجام می‌شود (مگر قاعده‌ای عمومی، مثلاً بر مبلغ، آن را بگیرد).</span>
          )}
          {canWrite ? (
            <>
              <Field label="قاعدهٔ تأیید">
                <Select
                  allowClear
                  placeholder="بدون تأیید"
                  value={item.approval_rule_id ?? undefined}
                  onChange={(v) => (v ? bind.mutate(v) : void patch({ approval_rule_id: null }))}
                  options={def.approval_rules.map((r) => ({ value: r.id, label: r.name }))}
                />
              </Field>
              <Space wrap>
                <Button icon={<Plus {...ICON14} />} loading={make.isPending} onClick={() => make.mutate([manager])}>
                  قاعدهٔ تازه: مدیر مستقیم
                </Button>
                <RecordSelect table="group" value={group} onChange={(v) => setGroup(typeof v === "string" ? v : null)} placeholder="گروه تأییدکننده" />
                <Button icon={<Plus {...ICON14} />} disabled={!group} loading={make.isPending} onClick={() => make.mutate([manager, { name: "گروه", sources: [{ kind: "groups", groups: [group] }], rule: "any" }])}>
                  قاعدهٔ تازه: مدیر، سپس گروه
                </Button>
              </Space>
            </>
          ) : null}
        </div>
      </Card>
      <Card title="انجام">
        <div className="rq-form">
          <Field label="گروه انجام" hint="وظایف بی‌گروه و خود قلم به این گروه می‌روند">
            <RecordSelect table="group" value={item.fulfilment_group_id ?? null} onChange={(v) => patch({ fulfilment_group_id: typeof v === "string" ? v : null })} disabled={!canWrite} allowClear />
          </Field>
          <Field label="گردش‌کار انجام" hint={`گردش‌کارهایی با آغازگر «سفارش از کاتالوگ» و کد «${item.code}» هم با هر سفارش اجرا می‌شوند`}>
            <Space.Compact block>
              <Select
                allowClear
                placeholder="بدون گردش‌کار"
                value={item.flow_id ?? undefined}
                disabled={!canWrite}
                onChange={(v) => patch({ flow_id: v ?? null })}
                options={def.flows.map((f) => ({ value: f.id, label: `${f.name}${f.active ? "" : " (غیرفعال)"}${f.version_no ? "" : " (منتشرنشده)"}` }))}
                style={{ flex: 1 }}
              />
              {canWrite ? (
                <Button icon={<Workflow {...ICON14} />} loading={flow.isPending} onClick={() => flow.mutate(undefined)}>
                  ساخت گردش‌کار
                </Button>
              ) : null}
            </Space.Compact>
          </Field>
          {bound.length ? (
            <Space wrap>
              {bound.map((f) => (
                <Button key={f.id} size="small" icon={<ExternalLink {...ICON14} />} onClick={() => navigate(`/${orgId}/flows/${f.id}/design`)}>
                  {f.name}
                </Button>
              ))}
            </Space>
          ) : null}
        </div>
      </Card>
      <TaskTemplates itemId={id} canWrite={canWrite} hasFlow={!!bound.length} onChanged={onChanged} />
    </div>
  );
}

/** Task templates of an item fulfilled without a flow (or tasks created before approval). */
function TaskTemplates({ itemId, canWrite, hasFlow, onChanged }: { itemId: string; canWrite: boolean; hasFlow: boolean; onChanged: () => void }) {
  const { api } = useOrg();
  const list = useRecordList("catalog_task_template", { filter: { f: "item_id", op: "eq", v: itemId }, sort: "sort_order", size: 100, fields: ["short_description", "sort_order", "assignment_group_id", "phase", "depends_on_previous", "requester_visible", "active"] });
  const rows = (list.data?.rows ?? []) as Row[];
  const display = list.data?.display ?? {};
  const [title, setTitle] = useState("");
  const changed = () => {
    void list.refetch();
    onChanged();
  };
  const add = useAction(() => recordsApi.create(api, "catalog_task_template", { item_id: itemId, short_description: title.trim(), sort_order: nextOrder(rows) }), {
    onSuccess: () => {
      setTitle("");
      changed();
    },
  });
  const save = useAction(({ id, data }: { id: string; data: Row }) => recordsApi.update(api, "catalog_task_template", id, data), { onSuccess: changed });
  const remove = useAction((id: string) => recordsApi.remove(api, "catalog_task_template", id), { onSuccess: changed });
  return (
    <Card title="وظایف انجام">
      <div className="rq-form">
        {hasFlow ? <Alert type="info" title="این قلم گردش‌کار انجام دارد؛ وظایف «پس از تأیید» را گردش‌کار می‌سازد و الگوهای زیر فقط برای «پیش از تأیید» به کار می‌روند." /> : null}
        {!rows.length ? <Empty description="الگوی وظیفه‌ای ندارد" /> : null}
        {rows.map((r) => (
          <div key={r.id} className="rq-qrow">
            <div className="rq-qrow-b">
              <span>{r.short_description}</span>
              <span className="rq-line-m">
                {r.assignment_group_id ? <span>{display[r.assignment_group_id] ?? "گروه"}</span> : <span>گروه انجام قلم</span>}
                <span>{TASK_PHASES.find((p) => p.value === r.phase)?.label}</span>
                {r.depends_on_previous ? <span>پس از وظیفهٔ پیشین</span> : <span>هم‌زمان</span>}
                {r.requester_visible ? <span>دیدنی برای درخواست‌کننده</span> : null}
              </span>
            </div>
            {canWrite ? (
              <span className="rq-qrow-x">
                <Select size="small" value={r.phase} onChange={(v) => save.mutate({ id: r.id, data: { phase: v } })} options={TASK_PHASES.map((p) => ({ value: p.value, label: p.label }))} aria-label="زمان ایجاد" />
                <Switch size="small" checked={!!r.requester_visible} onChange={(v) => save.mutate({ id: r.id, data: { requester_visible: v } })} aria-label="دیدنی برای درخواست‌کننده" />
                <Popconfirm title="این الگو حذف شود؟" okText="حذف" cancelText="انصراف" onConfirm={() => remove.mutate(r.id)}>
                  <Button size="small" type="text" danger icon={<Trash2 {...ICON14} />} aria-label="حذف" />
                </Popconfirm>
              </span>
            ) : null}
          </div>
        ))}
        {canWrite ? (
          <Space.Compact block>
            <Input placeholder="عنوان وظیفهٔ تازه" value={title} onChange={(e) => setTitle(e.target.value)} onPressEnter={() => title.trim() && add.mutate(undefined)} maxLength={200} />
            <Button icon={<Plus {...ICON14} />} disabled={!title.trim()} loading={add.isPending} onClick={() => add.mutate(undefined)}>
              افزودن
            </Button>
          </Space.Compact>
        ) : null}
      </div>
    </Card>
  );
}
