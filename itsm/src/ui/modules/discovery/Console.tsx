// «منبع‌های داده» (design A §15): one card per connector the person reads, grouped as the wizard groups the tools —
// its kind, name, state and one status line from its passes («۱۲٬۴۰۸ مورد · ۹۷٪ پیوسته · آخرین اجرا ۱۰ دقیقه پیش»,
// a running pass, a held drop, a missing key, the last failure). CMDB administrators add sources from here.
import { Link, useNavigate } from "react-router";
import { Button } from "antd";
import { CircleAlert, Lock, Plus, Radar, RotateCw } from "lucide-react";
import { KIND_CATEGORIES, type KindCategory } from "@shared/discovery/types";
import { useOrg } from "../../lib/org";
import { errorText, ApiError } from "../../lib/api";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Skeleton } from "../../components/display";
import { relTime } from "../../records/model/activity";
import { useConnectorCards, useDiscoveryMeta } from "./api";
import { scheduleText, statusLine, type ConnectorCard } from "./model";
import { ConnectorStateChip, I16, KindIcon, KindName, cx } from "./parts";

/** The page a refusal leaves: the server's own words (a reader's right, the Windows app). */
export function Refused({ error, retry }: { error: unknown; retry?: () => void }) {
  const status = error instanceof ApiError ? error.status : 0;
  if (status === 403) return <EmptyState icon={Lock} title={errorText(error)} />;
  return (
    <EmptyState
      icon={CircleAlert}
      title="بارگذاری انجام نشد"
      description={errorText(error)}
      action={
        retry ? (
          <Button icon={<RotateCw {...I16} />} onClick={retry}>
            تلاش دوباره
          </Button>
        ) : undefined
      }
    />
  );
}

export default function Console() {
  const { orgId, timezone } = useOrg();
  const nav = useNavigate();
  const meta = useDiscoveryMeta();
  const cards = useConnectorCards();
  const admin = !!meta.data?.can.admin;
  const add = admin ? (
    <Button type="primary" icon={<Plus {...I16} />} onClick={() => nav(`/${orgId}/discovery/new`)}>
      منبع داده تازه
    </Button>
  ) : undefined;
  const error = meta.error ?? cards.error;
  const groups = (Object.keys(KIND_CATEGORIES) as KindCategory[])
    .map((key) => ({ key, label: KIND_CATEGORIES[key], cards: (cards.data ?? []).filter((c) => (c.category in KIND_CATEGORIES ? c.category : "generic") === key) }))
    .filter((g) => g.cards.length);
  const ago = (iso: string) => relTime(iso, Date.now(), timezone);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="منبع‌های داده" actions={add} />
      {error ? (
        <Refused error={error} retry={() => void Promise.all([meta.refetch(), cards.refetch()])} />
      ) : !cards.data || !meta.data ? (
        <Skeleton rows={6} />
      ) : !cards.data.length ? (
        <EmptyState icon={Radar} title="هنوز منبعی وصل نشده است" action={add} />
      ) : (
        groups.map((g) => (
          <section key={g.key} className="dsc-group" aria-labelledby={`dsc-g-${g.key}`}>
            <h2 id={`dsc-g-${g.key}`} className="dsc-group-t">
              {g.label}
            </h2>
            <div className="dsc-cards">
              {g.cards.map((c) => (
                <ConnectorCardView key={c.id} c={c} to={`/${orgId}/discovery/${c.id}`} ago={ago} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

const TONE_CLASS: Record<string, string> = { danger: "text-danger", warning: "text-warning", info: "text-info" };

function ConnectorCardView({ c, to, ago }: { c: ConnectorCard; to: string; ago: (iso: string) => string }) {
  const line = statusLine(c, ago);
  return (
    <article className="ds-card dsc-card" aria-label={c.name}>
      <div className="dsc-card-h">
        <span className="dsc-card-ic">
          <KindIcon icon={c.icon} />
        </span>
        {/* rk-open: the crawler opens a list's first record by it (scripts/ui-crawl.mjs) */}
        <Link to={to} className="rk-open dsc-card-name">
          {c.name}
        </Link>
        <ConnectorStateChip card={c} />
      </div>
      <div className="dsc-card-m">
        <KindName label={c.label} />
        <span aria-hidden>·</span>
        <span>{scheduleText(c.every_minutes)}</span>
        {c.plain_http ? <Chip tone="warning">بدون رمزنگاری</Chip> : null}
      </div>
      <p className={cx("dsc-card-l", line.tone ? TONE_CLASS[line.tone] : null)}>{line.text}</p>
    </article>
  );
}
