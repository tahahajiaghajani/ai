// KanbanBoard: records of a table as cards in columns of a field — the states of the state model (a drop takes the
// transition, asking for the fields it requires; a move the model does not allow is refused with the reason),
// any choice, member, group or reference field (a drop updates it), or a yes/no field. WIP limits per column,
// optional swimlanes, counts from one aggregate, cards from one query per column. Every drag has a click and
// keyboard alternative (WCAG 2.5.7): a card's «انتقال به…» menu does the same move.
import { useMemo, useState, type DragEvent } from "react";
import { Button, Dropdown, Tooltip } from "antd";
import { MoveHorizontal, Inbox } from "lucide-react";
import { useQueries } from "@tanstack/react-query";
import type { Cond } from "@shared/model/conditions";
import type { FieldDef } from "@shared/model/types";
import { faDigits } from "@shared/format";
import { formatJalali } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { cx } from "../../components/blocks";
import { recordsApi } from "../data/api";
import { keys, useAggregate, useMe, useRecordActions } from "../data/hooks";
import { andAll } from "../model/filter";
import { aggregateColumns, boolColumns, choiceColumns, columnKeyOf, EMPTY_KEY, planDrop, wipState, type BoardColumn } from "../model/kanban";
import { defaultSort, displayText, fieldOf, valuesOf, type Schema } from "../model/schema";
import { isConflict, type RecordRow, type TableMeta } from "../model/types";
import { dayOf } from "../model/calendar";
import { FieldValue, RecordNo, UserChip, ChoiceTag } from "../fields/display";
import { TransitionDialog, type TransitionTarget } from "../page/TransitionDialog";

const I14 = { size: 14, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const PER_COLUMN = 50;

export interface KanbanBoardProps {
  def: TableMeta;
  schema: Schema;
  field: FieldDef;
  filter: Cond | null;
  q?: string;
  wip?: Record<string, number>;
  /** fields on a card besides number and title (default: priority, assignee, due date) */
  cardFields?: string[];
  swimlane?: string;
  onOpen: (row: RecordRow) => void;
}

const colCond = (f: FieldDef, c: BoardColumn): Cond =>
  c.value === null ? { f: f.name, op: "empty" } : { f: f.name, op: "eq", v: f.type === "bool" ? c.value === "true" : c.value };

export function KanbanBoard({ def, schema, field, filter, q, wip = {}, cardFields, swimlane, onOpen }: KanbanBoardProps) {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const { userId, tz } = useMe();
  const actions = useRecordActions(def.key);
  const isChoice = field.type === "choice";
  const agg = useAggregate(def.key, { filter, q, groupBy: [field.name] });
  const columns = useMemo<BoardColumn[]>(() => {
    if (isChoice) return choiceColumns(def, field, schema.choices, wip);
    if (field.type === "bool") return boolColumns();
    return aggregateColumns(agg.data?.rows ?? [], agg.data?.display ?? {});
  }, [isChoice, def, field, schema.choices, wip, agg.data]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of agg.data?.rows ?? []) {
      const k = r.keys[0] === null || r.keys[0] === undefined || r.keys[0] === "" ? EMPTY_KEY : String(r.keys[0]);
      m.set(k, Number(r.values.count ?? 0));
    }
    return m;
  }, [agg.data]);

  const fields = useMemo(() => {
    const wanted = cardFields ?? ["priority", "assigned_to", "due_at"];
    return [...new Set(["number", def.display, field.name, ...(def.states ? [def.states.field] : []), ...wanted, ...(swimlane ? [swimlane] : [])])].filter((x) => !!fieldOf(def, x));
  }, [cardFields, def, field.name, swimlane]);
  const sort = defaultSort(def);
  const queries = useQueries({
    queries: columns.map((c) => {
      const query = { filter: andAll(filter, colCond(field, c)), q: q || undefined, sort, size: PER_COLUMN, fields, total: false };
      return { queryKey: keys.list(orgId, def.key, query), queryFn: () => recordsApi.list(api, def.key, query), staleTime: 10_000 };
    }),
  });

  // optimistic moves: a card shows in its new column until the board reloads
  const [moved, setMoved] = useState<Map<string, string>>(new Map());
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [pending, setPending] = useState<{ row: RecordRow; t: TransitionTarget } | null>(null);
  const all = useMemo(() => {
    const byCol = new Map<string, RecordRow[]>();
    const display: Record<string, string> = {};
    queries.forEach((qr, i) => {
      Object.assign(display, qr.data?.display ?? {});
      for (const r of qr.data?.rows ?? []) {
        const k = moved.get(r.id) ?? columns[i].key;
        byCol.set(k, [...(byCol.get(k) ?? []), r]);
      }
    });
    return { byCol, display };
  }, [queries, columns, moved]);

  const finish = (id: string) =>
    setMoved((m) => {
      const next = new Map(m);
      next.delete(id);
      return next;
    });

  const move = async (row: RecordRow, c: BoardColumn) => {
    const plan = planDrop(def, field, row, c.value);
    if (plan.kind === "none") return;
    if (plan.kind === "blocked") return n.warn(plan.reason);
    if (plan.kind === "transition" && plan.requires.length) return setPending({ row, t: { to: plan.to, label: plan.label, requires: plan.requires } });
    setMoved((m) => new Map(m).set(row.id, c.key));
    try {
      if (plan.kind === "transition") await actions.transition(row.id, plan.to, {}, row.version);
      else await actions.update(row.id, plan.data, row.version);
    } catch (e) {
      if (isConflict(e)) n.warn("این رکورد را کس دیگری تغییر داده است؛ تابلو تازه شد");
      else n.error(e);
    } finally {
      finish(row.id);
    }
  };

  const onDrop = (c: BoardColumn) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData("text/x-record") || dragging;
    setDragging(null);
    if (!id) return;
    const row = [...all.byCol.values()].flat().find((r) => r.id === id);
    if (row) void move(row, c);
  };

  const lanes = useMemo(() => {
    if (!swimlane) return null;
    const f = fieldOf(def, swimlane);
    if (!f) return null;
    const keysSeen = new Map<string, string>();
    for (const r of [...all.byCol.values()].flat()) {
      const k = valuesOf(r[swimlane])[0] ?? "";
      if (!keysSeen.has(k)) keysSeen.set(k, k ? (all.display[k] ?? String(r[swimlane])) : "بدون مقدار");
    }
    return { f, keys: [...keysSeen.entries()] };
  }, [swimlane, def, all]);

  const renderColumn = (c: BoardColumn, i: number, lane?: string) => {
    const cards = (all.byCol.get(c.key) ?? []).filter((r) => lane === undefined || (valuesOf(r[swimlane!])[0] ?? "") === lane);
    const count = counts.get(c.key) ?? (queries[i]?.data ? cards.length : null);
    const ws = wipState(count ?? 0, c.wip);
    const loading = queries[i]?.isLoading;
    return (
      <section
        key={`${c.key}:${lane ?? ""}`}
        className={cx("rk-col-k", over === `${c.key}:${lane ?? ""}` && "is-over", ws !== "ok" && `is-${ws}`)}
        aria-label={c.label}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(`${c.key}:${lane ?? ""}`);
        }}
        onDragLeave={() => setOver(null)}
        onDrop={onDrop(c)}
      >
        {lane === undefined || lanes?.keys[0]?.[0] === lane ? (
          <header className="rk-col-h">
            {isChoice ? <ChoiceTag option={{ value: c.value ?? "", label: c.label, color: c.color }} /> : <span className="rk-col-t">{c.label}</span>}
            <span className="rk-col-n ds-num" title={c.wip ? `سقف کار در جریان: ${faDigits(c.wip)}` : undefined}>
              {count === null ? "" : faDigits(count)}
              {c.wip ? <span className="rk-col-wip">/{faDigits(c.wip)}</span> : null}
            </span>
          </header>
        ) : null}
        <ul className="rk-col-b">
          {loading
            ? [0, 1, 2].map((k) => (
                <li key={k} className="rk-kcard is-skel">
                  <i className="ds-skel" style={{ inlineSize: "40%" }} />
                  <i className="ds-skel" style={{ inlineSize: "90%" }} />
                </li>
              ))
            : cards.map((r) => (
                <li
                  key={r.id}
                  className={cx("rk-kcard", dragging === r.id && "is-drag", moved.has(r.id) && "is-moving")}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/x-record", r.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragging(r.id);
                  }}
                  onDragEnd={() => setDragging(null)}
                >
                  <Card row={r} def={def} schema={schema} display={all.display} fields={fields} skip={[field.name]} me={userId} tz={tz} onOpen={() => onOpen(r)} />
                  <Dropdown
                    trigger={["click"]}
                    rootClassName="ds-glass"
                    menu={{ items: columns.filter((x) => x.key !== columnKeyOf(field, r)).map((x) => ({ key: x.key, label: x.label })), onClick: ({ key }) => void move(r, columns.find((x) => x.key === key)!) }}
                  >
                    <Tooltip title="انتقال به…">
                      <Button type="text" size="small" className="rk-kmove" icon={<MoveHorizontal {...I14} />} aria-label={`انتقال ${r.number ?? ""} به ستون دیگر`} />
                    </Tooltip>
                  </Dropdown>
                </li>
              ))}
          {!loading && !cards.length ? (
            <li className="rk-col-empty">
              <Inbox {...I14} aria-hidden /> خالی
            </li>
          ) : null}
          {!loading && count !== null && count > cards.length && lane === undefined ? <li className="rk-col-more">{`و ${faDigits(count - cards.length)} مورد دیگر — در فهرست ببینید`}</li> : null}
        </ul>
      </section>
    );
  };

  return (
    <div className="rk-board" role="region" aria-label={`تابلوی ${def.plural} بر پایهٔ «${field.label}»`}>
      {lanes ? (
        lanes.keys.map(([k, label]) => (
          <div key={k} className="rk-lane">
            <div className="rk-lane-h">
              {lanes.f.type === "user" ? <UserChip id={k || null} display={all.display} name={k ? undefined : label} /> : <span>{label}</span>}
            </div>
            <div className="rk-cols">{columns.map((c, i) => renderColumn(c, i, k))}</div>
          </div>
        ))
      ) : (
        <div className="rk-cols">{columns.map((c, i) => renderColumn(c, i))}</div>
      )}
      {pending ? (
        <TransitionDialog
          def={def}
          schema={schema}
          row={pending.row}
          display={all.display}
          transition={pending.t}
          onClose={() => setPending(null)}
          onConflict={() => actions.refreshLists()}
        />
      ) : null}
    </div>
  );
}

/** A record card: number and a quiet fact, the title, then people and dates. */
export function Card({ row, def, schema, display, fields, skip = [], me, tz, onOpen }: { row: RecordRow; def: TableMeta; schema: Schema; display: Record<string, string>; fields: string[]; skip?: string[]; me: string | null; tz: string; onOpen: () => void }) {
  const facts = fields.filter((x) => x !== "number" && x !== def.display && !skip.includes(x) && x !== def.states?.field);
  const due = fieldOf(def, "due_at");
  const overdue = due && row.due_at && Date.parse(String(row.due_at)) < Date.now() && !!row.active;
  return (
    <button type="button" className="rk-kcard-b" onClick={onOpen} aria-label={`${row.number ?? ""} ${displayText(def, row)}`}>
      <span className="rk-kcard-l1">
        <RecordNo no={row.number ? String(row.number) : null} />
        {overdue ? <span className="rk-overdue">سررسید گذشته، {formatJalali(dayOf(due!.type, row.due_at, tz))}</span> : null}
      </span>
      <span className="rk-kcard-t">{displayText(def, row)}</span>
      {facts.length ? (
        <span className="rk-kcard-f">
          {facts.map((x) => {
            const f = fieldOf(def, x)!;
            if (x === "due_at" && overdue) return null;
            return (
              <span key={x} className="rk-kcard-v" title={f.label}>
                <FieldValue field={f} value={row[x]} table={def.key} schema={schema} display={display} compact me={me} tz={tz} />
              </span>
            );
          })}
        </span>
      ) : null}
    </button>
  );
}
