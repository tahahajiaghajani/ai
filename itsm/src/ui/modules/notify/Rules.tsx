// «قانون‌های اعلان»: the built-in rules (assigned to me, replies, done, mentions, SLA, approvals…) — each either as it
// ships or replaced by the organisation's copy — and the organisation's own rules. A switch turns a rule on or off
// (turning a built-in off stores a copy that is off); the name opens the editor.
import { useMemo } from "react";
import { Link, useNavigate } from "react-router";
import { Button, Switch, Tag } from "antd";
import { BellRing, Plus } from "lucide-react";
import { NOTIFY_EVENTS } from "@shared/notify";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { PageHeader } from "../../components/layout";
import { ICON14, Card, cx } from "../../components/blocks";
import { EmptyState, Skeleton } from "../../components/display";
import { useSchema } from "../../records/data/hooks";
import { recordsApi } from "../../records/data/api";
import { KEYS, useRules, type RuleView } from "./api";
import { channelLabels, recipientParts } from "./model";
import { draftOf, rowOf } from "./parts";
import "./notify.css";

export const ruleLink = (r: RuleView) => (r.is_builtin ? `notify/rules/builtin/${r.builtin}` : `notify/rules/${r.id}`);

export default function Rules() {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const { schema } = useSchema();
  const q = useRules();
  const canEdit = !!schema?.def("notification_rule")?.can.create;
  const toggle = useAction(
    async (r: RuleView) => {
      if (r.is_builtin) return recordsApi.create(api, "notification_rule", { ...rowOf(draftOf(r)), builtin: r.builtin, active: !r.active });
      return recordsApi.update(api, "notification_rule", r.id!, { active: !r.active }, r.version ?? undefined);
    },
    { invalidate: [KEYS.rules(orgId)] },
  );
  const rules = q.data?.rules ?? [];
  const builtins = rules.filter((r) => r.is_builtin || r.replaces);
  const own = rules.filter((r) => !r.is_builtin && !r.replaces);
  const tableLabel = useMemo(() => (key: string) => (key === "*" ? "همهٔ جدول‌ها" : (schema?.def(key)?.plural ?? key)), [schema]);

  const row = (r: RuleView) => {
    const def = r.table !== "*" ? schema?.def(r.table) : undefined;
    const who = recipientParts(r.recipients, { field: (n) => def?.fields.find((f) => f.name === n)?.label });
    return (
      <li key={r.key} className={cx("nf-rule", !r.active && "is-off")}>
        <div className="nf-rule-t">
          <Link to={`/${orgId}/${ruleLink(r)}`}>{r.name}</Link>
          <Tag variant="filled">{NOTIFY_EVENTS[r.event]?.label ?? r.event}</Tag>
          <Tag variant="filled">{tableLabel(r.table)}</Tag>
          {r.replaces ? <Tag variant="outlined">تغییر یافته</Tag> : null}
          {r.mandatory ? <Tag variant="outlined" color="warning">اجباری</Tag> : null}
        </div>
        <div className="nf-rule-x">
          <Switch
            size="small"
            checked={r.active}
            disabled={!canEdit}
            loading={toggle.isPending && toggle.variables?.key === r.key}
            onChange={() => toggle.mutate(r)}
            aria-label={`${r.name}: ${r.active ? "فعال" : "خاموش"}`}
          />
        </div>
        <div className="nf-rule-m">
          {who.length ? `به ${who.join("، ")}` : "بی‌گیرنده"} — {channelLabels(r.channels).join("، ")}
        </div>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="قانون‌های اعلان"
        actions={
          canEdit ? (
            <Button type="primary" icon={<Plus {...ICON14} />} onClick={() => nav(`/${orgId}/notify/rules/new`)}>
              قانون تازه
            </Button>
          ) : null
        }
      />
      {q.isLoading ? (
        <Skeleton rows={6} />
      ) : q.error ? (
        <EmptyState icon={BellRing} title={errorText(q.error)} />
      ) : (
        <>
          <Card title="قانون‌های سازمان">
            {own.length ? <ul className="nf-rules">{own.map(row)}</ul> : <EmptyState compact icon={BellRing} title="هنوز قانونی ساخته نشده است" />}
          </Card>
          <Card title="قانون‌های پیش‌فرض">
            <ul className="nf-rules">{builtins.map(row)}</ul>
          </Card>
        </>
      )}
    </div>
  );
}
