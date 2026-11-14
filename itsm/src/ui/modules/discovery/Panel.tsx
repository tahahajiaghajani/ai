// «منبع‌ها و وضعیت پایش» (design A §15, §9): the side panel of a CI or an asset. Everyone it shows for reads the
// status — the word with its dot and colour, since when, and the last contact (relative; Jalali in the tooltip). CMDB
// readers also read one row per source: its name (to its page), its own status and last contact, and «باز کردن در
// Zabbix» (the tool, in a new tab); then the alerts that hold a status. A branch officer never sees a tool's name: the
// server sends no sources to them. The panel shows only where the record's meta says so (panel.ts): requesters, the
// Windows app and records no tool reports get no panel.
import { Link } from "react-router";
import { Tooltip } from "antd";
import { ExternalLink } from "lucide-react";
import { kindDescriptor } from "@shared/discovery/kinds";
import { STATUS_WORDS } from "@shared/discovery/types";
import { useOrg } from "../../lib/org";
import { Skeleton } from "../../components/display";
import { ChoiceTag } from "../../records/fields/display";
import type { RecordContext } from "../../records/extensions";
import { usePanel } from "./api";
import { safeLink, sourcesText, toolName, type PanelData } from "./model";
import { Ago, KindName } from "./parts";

const I14 = { size: 14, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const word = (state: string | null | undefined, label?: string | null) => <ChoiceTag option={STATUS_WORDS.find((o) => o.value === state)} value={label ?? state ?? "نامعلوم"} />;

export default function DiscoveryPanel({ ctx }: { ctx: RecordContext }) {
  const { orgId, timezone } = useOrg();
  const table = ctx.table === "ci" ? "ci" : "asset";
  const p = usePanel(table, String(ctx.row.id));
  if (p.isLoading) return <Skeleton rows={2} />;
  if (p.error || !p.data) return <p className="dsc-meta">وضعیت پایش بارگذاری نشد.</p>;
  return <PanelBody data={p.data} orgId={orgId} timezone={timezone} />;
}

export function PanelBody({ data, orgId, timezone }: { data: PanelData; orgId: string; timezone: string }) {
  const s = data.status;
  return (
    <div className="dsc-panel">
      {s ? (
        <dl className="dsc-pairs">
          <div>
            <dt>وضعیت</dt>
            <dd className="dsc-inline">
              {word(s.state, s.label)}
              {s.since ? (
                <span className="dsc-sub">
                  {"از "}
                  <Ago at={s.since} tz={timezone} />
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>آخرین تماس</dt>
            <dd>
              <Ago at={s.last_contact_at} tz={timezone} />
            </dd>
          </div>
          <div>
            <dt>منبع‌ها</dt>
            <dd>{sourcesText(s.sources)}</dd>
          </div>
          {s.message ? (
            <div>
              <dt>پیام</dt>
              <dd className="dsc-clamp">{s.message}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="dsc-meta">هنوز وضعیتی برای این مورد ثبت نشده است.</p>
      )}
      {data.sources.length ? (
        <ul className="dsc-sources" aria-label="منبع‌ها">
          {data.sources.map((x) => {
            const link = safeLink(x.link_url);
            const tool = toolName(x.kind);
            return (
              <li key={x.connector_id}>
                <div className="dsc-inline">
                  <Link className="ds-link" to={`/${orgId}/discovery/${x.connector_id}`}>
                    {x.name}
                  </Link>
                  {x.status ? word(x.status, x.status_label) : null}
                </div>
                <span className="dsc-sub">
                  <KindName label={kindDescriptor(x.kind)?.label ?? x.kind} />
                  {" · آخرین تماس "}
                  <Ago at={x.last_contact_at ?? x.reported_at} tz={timezone} />
                </span>
                {link ? (
                  <Tooltip title={link}>
                    <a className="ds-link dsc-inline" href={link} target="_blank" rel="noopener noreferrer">
                      <ExternalLink {...I14} aria-hidden />
                      {tool ? (
                        <span>
                          {"باز کردن در "}
                          <bdi dir="ltr" className="ds-latin">
                            {tool}
                          </bdi>
                        </span>
                      ) : (
                        "باز کردن در ابزار"
                      )}
                    </a>
                  </Tooltip>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {data.signals.length ? (
        <ul className="dsc-sources" aria-label="هشدارها">
          {data.signals.map((g) => (
            <li key={g.key}>
              <div className="dsc-inline">
                <span>{g.name ? `هشدار از «${g.name}»` : "هشدار"}</span>
                {word(g.state)}
              </div>
              {g.since ? (
                <span className="dsc-sub">
                  {"از "}
                  <Ago at={g.since} tz={timezone} />
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
