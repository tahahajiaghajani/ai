// The order form of a catalogue item (REQ-005…REQ-008, REQ-015, REQ-016) — the one renderer of every channel's form:
// the catalogue's order drawer, the cart, the builder's live preview, the answers of a requested item and, later, the
// requester portal (it embeds this component). Questions are engine fields of a virtual table (`formDef`), so every
// question type uses the record kit's editors; form policies apply live through the shared `formState` (the server
// checks the same rules again); multi-row grids are tables of typed cells; the summary shows the price of the answers,
// the recurring charge and the delivery promise.
import { useMemo } from "react";
import { Button, Tooltip } from "antd";
import { Plus, Trash2, Paperclip } from "lucide-react";
import { answerField, defaultAnswers, formDef, gridDef, priceOf, rowState, type Answers, type FormSchema, type GridDef, type VarDef } from "@shared/request/form";
import { FieldInput, FieldValue, useSchema } from "../../records";
import type { TableMeta } from "../../records";
import { useOrg } from "../../lib/org";
import { Field, Note, ICON14 } from "../../components/blocks";
import { Loader } from "../../components/display";
import { answers as holdsAnswer, money, recurringText, visibleQuestions } from "./model";
import "./request.css";

export interface OrderFormProps {
  schema: FormSchema;
  answers: Answers;
  onChange?: (next: Answers) => void;
  /** the requester's form, or the fulfiller's view of the answers (form policies may differ) */
  mode?: "order" | "fulfil";
  /** problems per question (the server's or the client's check); grid cells as `<grid>.<row>.<column>` */
  errors?: Record<string, string>;
  /** show the answers instead of editors */
  readOnly?: boolean;
  display?: Record<string, string>;
  /** price summary: the quantity ordered and the delivery promise («حدود ۵ روز کاری») */
  summary?: { quantity?: number; promise?: string | null; sle?: string | null } | null;
}

const meta = (d: ReturnType<typeof formDef>): TableMeta => ({ ...d, can: { read: true, create: true } });

/** The answers a new order starts from (defaults: «$me» → the person, «$today» → today). */
export function initialAnswers(schema: FormSchema, me: string | null, today: string): Answers {
  return defaultAnswers(schema, { me, today });
}

export function OrderForm({ schema, answers, onChange, mode = "order", errors = {}, readOnly, display = {}, summary }: OrderFormProps) {
  const { schema: tables } = useSchema();
  const { timezone } = useOrg();
  const def = useMemo(() => meta(formDef(schema)), [schema]);
  const view = useMemo(() => visibleQuestions(schema, answers, mode), [schema, answers, mode]);
  if (!tables) return <Loader />;
  const set = (name: string, v: unknown) => onChange?.({ ...answers, [name]: v });

  const question = (v: VarDef) => {
    if (v.type === "label") return <div key={v.name} className="rq-label">{v.label}</div>;
    if (v.type === "attachment") {
      return (
        <div key={v.name} className="rq-q">
          <Note>
            <Paperclip {...ICON14} /> {v.label}: پیوست را پس از ثبت، در صفحهٔ قلم درخواست‌شده بیفزایید.
          </Note>
        </div>
      );
    }
    const base = answerField(v);
    if (!base) return null;
    const required = view.state.required.has(v.name);
    const locked = view.state.readonly.has(v.name);
    const field = { ...base, required, readonly: locked };
    const err = errors[v.name];
    return (
      <div key={v.name} className={v.width === "half" ? "rq-q is-half" : "rq-q"}>
        <Field
          htmlFor={`rq-${v.name}`}
          label={
            <>
              {v.label}
              {required && !readOnly ? <span className="rq-req" aria-hidden>*</span> : null}
            </>
          }
          hint={readOnly ? undefined : v.help}
        >
          {readOnly ? (
            <FieldValue field={field} value={answers[v.name]} table={def.key} schema={tables} display={display} tz={timezone} />
          ) : (
            <FieldInput
              id={`rq-${v.name}`}
              field={field}
              value={answers[v.name]}
              onChange={(x) => set(v.name, x)}
              def={def}
              schema={tables}
              row={answers}
              display={display}
              tz={timezone}
              disabled={locked}
              status={err ? "error" : undefined}
              aria-label={v.label}
            />
          )}
          {err ? <div className="rq-err" role="alert">{err}</div> : null}
        </Field>
      </div>
    );
  };

  const show = summary && schema.item.show_price !== false;
  const price = show ? priceOf(schema, answers, summary?.quantity ?? 1) : null;
  return (
    <div className="rq-form">
      {view.state.messages.length ? (
        <div className="rq-msgs">
          {view.state.messages.map((m) => (
            <Note key={m.key}>{m.text}</Note>
          ))}
        </div>
      ) : null}
      {view.sections.map((s) => (
        <section key={s.key} className="rq-sec" aria-label={s.label ?? schema.item.name}>
          {s.label ? <h3 className="rq-sec-h">{s.label}</h3> : null}
          <div className="rq-grid">{s.variables.map(question)}</div>
        </section>
      ))}
      {view.grids.map((g) => (
        <section key={g.code} className="rq-sec" aria-label={g.label}>
          <h3 className="rq-sec-h">
            {g.label}
            {view.state.required.has(g.code) && !readOnly ? <span className="rq-req" aria-hidden>*</span> : null}
          </h3>
          {g.help ? <div className="blk-f-h">{g.help}</div> : null}
          <GridInput schema={schema} grid={g} rows={Array.isArray(answers[g.code]) ? (answers[g.code] as Answers[]) : []} onChange={(rows) => set(g.code, rows)} readOnly={readOnly} errors={errors} mode={mode} display={display} />
          {errors[g.code] ? <div className="rq-err" role="alert">{errors[g.code]}</div> : null}
        </section>
      ))}
      {!view.sections.length && !view.grids.length ? <Note>این قلم پرسشی ندارد.</Note> : null}
      {summary ? (
        <dl className="rq-sum">
          {price ? (
            <>
              <div>
                <dt>قیمت</dt>
                <dd>{Number(price.total) > 0 ? money(price.total) : "رایگان"}</dd>
              </div>
              {price.recurring ? (
                <div>
                  <dt>هزینهٔ دوره‌ای</dt>
                  <dd>{recurringText(price.recurring_total, schema.item.recurring_frequency)}</dd>
                </div>
              ) : null}
            </>
          ) : null}
          {summary.promise ? (
            <div>
              <dt>زمان تحویل</dt>
              <dd>{summary.promise}</dd>
            </div>
          ) : null}
          {summary.sle ? (
            <div>
              <dt>تجربهٔ گذشته</dt>
              <dd>{summary.sle}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}

/** A multi-row question set (REQ-007): one row per entry, typed cells, the set's policies per row, row limits. */
function GridInput({ schema, grid, rows, onChange, readOnly, errors, mode, display }: { schema: FormSchema; grid: GridDef; rows: Answers[]; onChange: (rows: Answers[]) => void; readOnly?: boolean; errors: Record<string, string>; mode: "order" | "fulfil"; display: Record<string, string> }) {
  const { schema: tables } = useSchema();
  const { timezone } = useOrg();
  const def = useMemo(() => meta(gridDef(grid)), [grid]);
  const columns = grid.columns.filter(holdsAnswer);
  if (!tables) return null;
  const put = (i: number, name: string, v: unknown) => onChange(rows.map((r, j) => (j === i ? { ...r, [name]: v } : r)));
  const full = rows.length >= grid.max_rows;
  return (
    <div className="rq-rows">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.name} scope="col">
                {c.label}
                {c.required ? <span className="rq-req" aria-hidden>*</span> : null}
              </th>
            ))}
            {!readOnly ? <th className="rq-rows-x" aria-label="حذف سطر" /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const rs = rowState(schema, grid, r, { mode });
            return (
              <tr key={i}>
                {columns.map((c) => {
                  const f = answerField(c);
                  const err = errors[`${grid.code}.${i}.${c.name}`];
                  if (!f || rs.hidden.has(c.name)) return <td key={c.name} />;
                  const field = { ...f, required: rs.required.has(c.name), readonly: rs.readonly.has(c.name) };
                  return (
                    <td key={c.name}>
                      {readOnly ? (
                        <FieldValue field={field} value={r[c.name]} table={def.key} schema={tables} display={display} tz={timezone} compact />
                      ) : (
                        <FieldInput field={field} value={r[c.name]} onChange={(x) => put(i, c.name, x)} def={def} schema={tables} row={r} display={display} tz={timezone} compact disabled={field.readonly} status={err ? "error" : undefined} aria-label={`${c.label}، سطر ${(i + 1).toLocaleString("fa-IR")}`} />
                      )}
                      {err ? <div className="rq-err">{err}</div> : null}
                    </td>
                  );
                })}
                {!readOnly ? (
                  <td className="rq-rows-x">
                    <Tooltip title="حذف سطر">
                      <Button size="small" type="text" icon={<Trash2 {...ICON14} />} aria-label="حذف سطر" onClick={() => onChange(rows.filter((_, j) => j !== i))} disabled={rows.length <= grid.min_rows} />
                    </Tooltip>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="rq-rows-foot">
        <span>
          {rows.length.toLocaleString("fa-IR")} از {grid.max_rows.toLocaleString("fa-IR")} سطر
        </span>
        {!readOnly ? (
          <Button size="small" icon={<Plus {...ICON14} />} onClick={() => onChange([...rows, {}])} disabled={full}>
            سطر تازه
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export default OrderForm;
