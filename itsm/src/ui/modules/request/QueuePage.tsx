// A queue of the fulfillers' workspace: the requested items' (or tasks') list with the queue's fixed filter (computed
// when the page opens, so «گذشته از موعد» compares with the current time), its columns and sort; quick filters, saved
// views, the board and bulk actions stay available.
import { useMemo } from "react";
import { RecordList } from "../../records";
import { queueOf, rowTone } from "./model";

export default function QueuePage({ queue }: { queue: string }) {
  const q = queueOf(queue);
  const preset = useMemo(() => (q ? { filter: q.filter(Date.now()), sort: q.sort, columns: q.columns, emptyText: q.emptyText, rowTone: (r: Record<string, unknown>) => rowTone(r) } : undefined), [q]);
  if (!q || !preset) return null;
  return <RecordList key={q.key} table={q.table} title={q.label} preset={preset} />;
}
