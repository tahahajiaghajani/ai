// The outage announcements on air for the person (GET /incident/announcements: the audience decides), above the
// agent workspace's queues: one quiet note per announcement in its kind's tone — the title, the end of its window,
// the incident when they may read it — expandable to the full text and dismissable for the session.
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Button } from "antd";
import { X } from "lucide-react";
import { formatJalaliDateTime } from "@shared/jalali";
import { ANNOUNCEMENT_KINDS } from "@shared/tables/incident";
import { useOrg } from "../../lib/org";
import { ICON14, Note } from "../../components/blocks";
import { RecordMarkdown, recordPath } from "../../records";
import { useAnnouncements, type AnnouncementItem } from "./api";

const KEY = "incident:announcements:dismissed";
const TONE: Record<string, "danger" | "warning" | "neutral"> = { outage: "danger", degradation: "warning" };

function readDismissed(): string[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function saveDismissed(ids: string[]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(ids.slice(-50)));
  } catch {
    // private windows and blocked storage: dismissed until the page reloads
  }
}

export default function AnnouncementBar() {
  const q = useAnnouncements();
  const [hidden, setHidden] = useState<string[]>(readDismissed);
  const items = useMemo(() => (q.data?.items ?? []).filter((a) => !hidden.includes(a.id)), [q.data, hidden]);
  if (!items.length) return null;
  const dismiss = (id: string) => {
    const next = [...hidden, id];
    setHidden(next);
    saveDismissed(next);
  };
  return (
    <section className="mb-4 flex flex-col gap-2" aria-label="اطلاعیه‌ها">
      {items.map((a) => (
        <Item key={a.id} a={a} onDismiss={() => dismiss(a.id)} />
      ))}
    </section>
  );
}

function Item({ a, onDismiss }: { a: AnnouncementItem; onDismiss: () => void }) {
  const { orgId, timezone } = useOrg();
  const [open, setOpen] = useState(false);
  const kind = ANNOUNCEMENT_KINDS.find((k) => k.value === a.kind)?.label;
  return (
    <Note tone={TONE[a.kind] ?? "neutral"} action={<Button size="small" type="text" aria-label="بستن اطلاعیه" icon={<X {...ICON14} />} onClick={onDismiss} />}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <b>
          {kind ? `${kind}: ` : ""}
          {a.title}
        </b>
        {a.ends_at ? <span className="text-[12px] text-ink-3">تا {formatJalaliDateTime(a.ends_at, timezone)}</span> : null}
        {a.incident ? (
          <Link to={`/${orgId}/${recordPath("incident", a.incident.id)}`} className="text-[12px]">
            <bdi className="ds-num">{a.incident.number}</bdi>
          </Link>
        ) : null}
        {a.body ? (
          <Button size="small" type="link" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "کمتر" : "بیشتر"}
          </Button>
        ) : null}
      </div>
      {open && a.body ? (
        <div className="mt-2">
          <RecordMarkdown text={a.body} />
        </div>
      ) : null}
    </Note>
  );
}
