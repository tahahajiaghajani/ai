// Two tabs of a connector's page (design A §15): «موارد» — what the tool reported, with each item's reconciliation
// state, its monitor status, its CI and last contact, filtered by state and searched by name or the tool's id; and
// «دریافت هشدار» — where the tool's alerts and records come in: for a push source its addresses and the integration
// user whose key sends to them, for the others the event source the connector's problems become events in (its key
// and receive address are made on that source's page). No key is ever shown here.
import { useState } from "react";
import { Link } from "react-router";
import { Input, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Search } from "lucide-react";
import { ITEM_KINDS, ITEM_STATES, STATUS_WORDS, type KindDescriptor } from "@shared/discovery/types";
import { useOrg } from "../../lib/org";
import { useDebounced } from "../../lib/hooks";
import { EmptyState } from "../../components/display";
import { ServerTable } from "../../components/data";
import { FilterChip } from "../../components/inputs";
import { ChoiceTag } from "../../records/fields/display";
import { displayOf } from "../../records/model/schema";
import type { ConnectorPage } from "./api";
import { ITEM_FILTERS, labelOf, type ItemRow } from "./model";
import { Ago, I16 } from "./parts";

type ItemView = ItemRow & { $ci?: string };

// ---------------------------------------------------------------- «موارد»

export function ItemsTab({ id, tz }: { id: string; tz: string }) {
  const { orgId } = useOrg();
  const [state, setState] = useState("");
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 300);
  const columns: ColumnsType<ItemView> = [
    {
      title: "مورد",
      key: "name",
      render: (_, r) => (
        <div className="dsc-cell">
          <span className="dsc-strong">{r.name || "—"}</span>
          <bdi dir="ltr" className="ds-mono dsc-sub">
            {r.external_id}
          </bdi>
        </div>
      ),
    },
    { title: "گونه", key: "kind", render: (_, r) => (r.kind ? labelOf(ITEM_KINDS, r.kind) : <span className="ds-zero">—</span>) },
    {
      title: "آشتی",
      key: "state",
      render: (_, r) => (r.state ? <ChoiceTag option={ITEM_STATES.find((o) => o.value === r.state)} value={r.state} /> : <span className="ds-status">در انتظار آشتی</span>),
    },
    {
      title: "وضعیت پایش",
      key: "status",
      render: (_, r) => (r.status ? <ChoiceTag option={STATUS_WORDS.find((o) => o.value === r.status)} value={r.status} /> : <span className="ds-zero">—</span>),
    },
    {
      title: "پیکربندی",
      key: "ci",
      render: (_, r) =>
        r.ci_id ? (
          <Link className="ds-link" to={`/${orgId}/cis/${r.ci_id}`}>
            {r.$ci ?? "پیکربندی"}
          </Link>
        ) : (
          <span className="ds-zero">—</span>
        ),
    },
    { title: "آخرین تماس", key: "contact", render: (_, r) => <Ago at={r.last_contact_at} tz={tz} /> },
    { title: "پیام", key: "message", render: (_, r) => (r.message ? <span className="dsc-sub dsc-clamp">{r.message}</span> : <span className="ds-zero">—</span>) },
  ];
  return (
    <ServerTable<ItemView>
      path={`/discovery/connectors/${id}/items`}
      params={{ state: state || undefined, q: q || undefined }}
      queryKey={["discovery-items", id]}
      columns={columns}
      pageSize={50}
      select={(d: { rows?: ItemRow[]; total?: number | null; display?: Record<string, string> } | undefined) => ({
        rows: (d?.rows ?? []).map((r) => ({ ...r, $ci: displayOf(d?.display, r.ci_id) })),
        total: Number(d?.total ?? 0),
      })}
      toolbar={
        <>
          <Input allowClear prefix={<Search {...I16} aria-hidden />} value={text} onChange={(e) => setText(e.target.value)} placeholder="جست‌وجوی نام یا شناسه" aria-label="جست‌وجوی نام یا شناسه" />
          <FilterChip label="آشتی" value={state || null} onChange={(v) => setState(v ?? "")} options={ITEM_FILTERS.filter((o) => o.value)} />
        </>
      }
      filtered={!!q || !!state}
      onClearFilters={() => {
        setText("");
        setState("");
      }}
      empty={<EmptyState compact title="این منبع هنوز موردی گزارش نکرده است" />}
    />
  );
}

// ---------------------------------------------------------------- «دریافت هشدار»

/** Does a connector's page have «دریافت هشدار»? Push sources, and kinds whose problems become events. */
export const receivesAlerts = (d: Pick<KindDescriptor, "kind" | "collects">) => d.kind === "push" || d.collects.includes("problems");

export function ReceiveTab({ page, d }: { page: ConnectorPage; d: KindDescriptor }) {
  const { orgId } = useOrg();
  const row = page.row as ConnectorPage["row"] & { push_user_id?: string | null; event_source_id?: string | null };
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  // the address in Latin digits, and the kit's copy button (it copies where the clipboard API is missing too)
  const copy = (text: string) => (
    <span className="dsc-copy">
      <bdi dir="ltr" className="ds-mono dsc-url">
        {text}
      </bdi>
      <Typography.Text copyable={{ text, tooltips: ["رونوشت", "رونوشت شد"] }} />
    </span>
  );
  const source = row.event_source_id ? displayOf(page.display, row.event_source_id) : undefined;
  return (
    <div className="flex flex-col gap-4">
      {d.kind === "push" ? (
        <section className="ds-card dsc-pane" aria-label="ارسال از ابزار">
          <h3 className="dsc-pane-t">ارسال از ابزار</h3>
          <dl className="dsc-summary">
            <div>
              <dt>نشانی دسته‌ها</dt>
              <dd>{copy(`${origin}/api/v1/discovery/${row.id}/batches`)}</dd>
            </div>
            <div>
              <dt>نشانی وضعیت</dt>
              <dd>{copy(`${origin}/api/v1/discovery/${row.id}/status`)}</dd>
            </div>
            <div>
              <dt>کاربر ارسال‌کننده</dt>
              <dd>{row.push_user_id ? (displayOf(page.display, row.push_user_id) ?? "کاربر یکپارچه‌سازی") : <span className="ds-zero">تعیین نشده</span>}</dd>
            </div>
            <div>
              <dt>کلید</dt>
              <dd>
                {"کلید API همین کاربر، در سرآیند "}
                <bdi dir="ltr" className="ds-mono">
                  Authorization: Bearer
                </bdi>
                {" یا "}
                <bdi dir="ltr" className="ds-mono">
                  X-API-Key
                </bdi>
              </dd>
            </div>
          </dl>
          <pre dir="ltr" className="dsc-raw" aria-label="نمونهٔ ارسال">
            {`curl -X POST ${origin}/api/v1/discovery/${row.id}/batches \\\n  -H "Authorization: Bearer $KARIZ_KEY" -H "Content-Type: application/json" \\\n  -d '{"batch_id":"2026-11-14-01","records":[{"external_id":"srv-01","kind":"device","name":"srv-01"}]}'`}
          </pre>
        </section>
      ) : null}
      {d.collects.includes("problems") ? (
        <section className="ds-card dsc-pane" aria-label="منبع رویداد">
          <h3 className="dsc-pane-t">منبع رویداد</h3>
          {row.event_source_id ? (
            <dl className="dsc-summary">
              <div>
                <dt>منبع رویداد</dt>
                <dd>
                  {source ? (
                    <Link className="ds-link" to={`/${orgId}/event/sources/${row.event_source_id}`}>
                      {source}
                    </Link>
                  ) : (
                    <span className="ds-zero">در دسترس شما نیست</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>نشانی دریافت</dt>
                <dd>
                  <bdi dir="ltr" className="ds-mono dsc-url">{`${origin}/api/public/events/<کلید منبع>`}</bdi>
                </dd>
              </div>
            </dl>
          ) : (
            <EmptyState compact title="هنوز منبع رویدادی به این منبع داده وصل نیست" description="نخستین گذر وضعیت با «مشکل‌ها و هشدارها» آن را می‌سازد." />
          )}
        </section>
      ) : null}
    </div>
  );
}
