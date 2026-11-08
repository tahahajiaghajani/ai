// A queue of the agent workspace: the incident list with the queue's fixed filter (computed when the page opens, so
// «نزدیک به نقض توافق» compares with the current time), its columns and sort; quick filters, saved views, the board
// and bulk actions stay available. The announcements on air for the person sit above it.
import { lazy, Suspense, useMemo } from "react";
import { RecordList } from "../../records";
import { queueOf, rowTone } from "./model";

const TemplatePicker = lazy(() => import("./TemplatePicker"));
const AnnouncementBar = lazy(() => import("./AnnouncementBar"));

export default function QueuePage({ queue }: { queue: string }) {
  const q = queueOf(queue);
  const preset = useMemo(() => (q ? { filter: q.filter(Date.now()), sort: q.sort, columns: q.columns, emptyText: q.emptyText, rowTone: (r: Record<string, unknown>) => rowTone(r) } : undefined), [q]);
  if (!q || !preset) return null;
  return (
    <>
      <Suspense fallback={null}>
        <AnnouncementBar />
      </Suspense>
      <RecordList
        key={q.key}
        table="incident"
        title={q.label}
        preset={preset}
        actions={
          <Suspense fallback={null}>
            <TemplatePicker />
          </Suspense>
        }
      />
    </>
  );
}
