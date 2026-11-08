// The record page's side panel: widgets modules add (`sidePanels`), then watchers, attachments (drag-and-drop
// upload, image previews, download, removal), typed links with their Persian relation labels («ناشی از»، «علت»…)
// and the latest field changes. Each card folds; the choice is remembered per person.
import { useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { Button, Image, Input, Select, Tooltip } from "antd";
import { ChevronDown, Eye, EyeOff, FileText, Image as ImageIcon, Link2, Plus, Trash2, Upload as UploadIcon, X, Download } from "lucide-react";
import { LINK_KINDS } from "@shared/model/links";
import { faDigits } from "@shared/format";
import { formatJalaliDateTime } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useLocalState, useNotify } from "../../lib/hooks";
import { cx } from "../../components/blocks";
import { attachmentUrl } from "../data/api";
import { useActivity, useAttachments, useLinks, useMe, useRecordActions, useRecordList } from "../data/hooks";
import { displayOf, displayText, fieldOf, valuesOf, type Schema } from "../model/schema";
import { encodeFilter } from "../model/filter";
import { relTime } from "../model/activity";
import type { LinkItem, TableMeta } from "../model/types";
import { newRecordPath, recordPath, tablePath, type RecordContext, type SidePanelWidget } from "../extensions";
import { RecordNo, UserChip, FieldValue } from "../fields/display";
import { RecordSelect, UserSelect } from "../fields/RecordSelect";

const I14 = { size: 14, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

/** «۱٫۲ مگابایت» */
export function fileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${faDigits(bytes)} بایت`;
  if (bytes < 1024 * 1024) return `${faDigits((bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)).replace(".", "٫")} کیلوبایت`;
  return `${faDigits((bytes / 1024 / 1024).toFixed(1)).replace(".", "٫")} مگابایت`;
}

export function SideCard({ id, title, count, actions, children }: { id: string; title: string; count?: number | null; actions?: ReactNode; children: ReactNode }) {
  const [closed, setClosed] = useLocalState<string[]>("itsm.records.side.closed", []);
  const open = !closed.includes(id);
  const bodyId = `rk-side-${id}`;
  return (
    <section className={cx("rk-side-card", !open && "is-closed")} aria-label={title}>
      <header className="rk-side-h">
        <button type="button" className="rk-side-t" aria-expanded={open} aria-controls={bodyId} onClick={() => setClosed(open ? [...closed, id] : closed.filter((x) => x !== id))}>
          <ChevronDown {...I14} className="rk-side-chev" aria-hidden />
          <span>{title}</span>
          {count ? <span className="rk-side-n ds-num">{faDigits(count)}</span> : null}
        </button>
        {open && actions ? <span className="rk-side-x">{actions}</span> : null}
      </header>
      {open ? (
        <div className="rk-side-b" id={bodyId}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

export function SidePanel({ def, schema, ctx, widgets }: { def: TableMeta; schema: Schema; ctx: RecordContext; widgets: SidePanelWidget[] }) {
  return (
    <aside className="rk-side" aria-label="جزئیات کناری">
      {widgets
        .filter((w) => !w.when || w.when(ctx))
        .map((w) => (
          <SideCard key={w.key} id={`w-${w.key}`} title={w.title}>
            {w.render(ctx)}
          </SideCard>
        ))}
      {(def.form?.related ?? [])
        .filter((r) => !!schema.def(r.table))
        .map((r) => (
          <RelatedCard key={`${r.table}:${r.field}`} schema={schema} ctx={ctx} table={r.table} field={r.field} label={r.label} />
        ))}
      {def.features?.watchers ? <Watchers def={def} ctx={ctx} /> : null}
      {def.features?.attachments ? <Attachments def={def} ctx={ctx} /> : null}
      {def.features?.links ? <Links def={def} schema={schema} ctx={ctx} /> : null}
      {def.features?.history !== false ? <RecentChanges def={def} schema={schema} ctx={ctx} /> : null}
    </aside>
  );
}

// ---------------------------------------------------------------- related lists

/** A related list in brief: how many, the first five, and the whole list (filtered to this record) one click away. */
function RelatedCard({ schema, ctx, table, field, label }: { schema: Schema; ctx: RecordContext; table: string; field: string; label?: string }) {
  const { orgId } = useOrg();
  const target = schema.def(table)!;
  const cond = { f: field, op: "eq" as const, v: ctx.row.id };
  const list = useRecordList(table, { filter: cond, size: 5, sort: "-updated_at", fields: ["number", target.display, ...(target.states ? [target.states.field] : [])] });
  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? rows.length;
  const stateF = target.states ? fieldOf(target, target.states.field) : undefined;
  return (
    <SideCard
      id={`rel-${table}-${field}`}
      title={label ?? target.plural}
      count={total}
      actions={
        target.can.create ? (
          <Tooltip title={`${target.label} تازه`}>
            <Link className="rk-x" to={`/${orgId}/${newRecordPath(table)}?${new URLSearchParams({ [field]: ctx.row.id })}`} aria-label={`${target.label} تازه`}>
              <Plus {...I14} aria-hidden />
            </Link>
          </Tooltip>
        ) : null
      }
    >
      {rows.length ? (
        // long titles wrap (up to three lines, the whole title on hover) instead of running out of the narrow panel
        <ul className="rk-rel">
          {rows.map((r) => {
            const title = displayText(target, r);
            return (
              <li key={r.id} className="rk-rel-i">
                <Link className="rk-rel-a" to={`/${orgId}/${recordPath(table, r.id)}`} title={title || undefined}>
                  {r.number ? <RecordNo no={String(r.number)} /> : null}
                  <span className="rk-rel-t">{title || "—"}</span>
                </Link>
                {stateF ? (
                  <span className="rk-rel-s">
                    <FieldValue field={stateF} value={r[stateF.name]} table={table} schema={schema} compact />
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : list.isLoading ? null : (
        <p className="rk-hint">موردی ندارد.</p>
      )}
      {total > rows.length ? (
        <Link className="ds-link rk-more" to={`/${orgId}/${tablePath(table)}?filter=${encodeURIComponent(encodeFilter(cond))}`}>
          همهٔ {faDigits(total)} مورد
        </Link>
      ) : null}
    </SideCard>
  );
}

// ---------------------------------------------------------------- watchers

function Watchers({ def, ctx }: { def: TableMeta; ctx: RecordContext }) {
  const actions = useRecordActions(def.key);
  const n = useNotify();
  const { userId } = useMe();
  const [adding, setAdding] = useState(false);
  const field = def.scope?.watchers ?? "watch_list";
  const ids = valuesOf(ctx.row[field]);
  const watching = ctx.meta.watching ?? (!!userId && ids.includes(userId));
  const run = async (on: boolean, who?: string) => {
    try {
      await actions.watch(ctx.row.id, on, who);
    } catch (e) {
      n.error(e);
    }
  };
  return (
    <SideCard
      id="watchers"
      title="پیگیری‌کنندگان"
      count={ids.length}
      actions={
        <Tooltip title={watching ? "دیگر پیگیری نمی‌کنم" : "پیگیری می‌کنم"}>
          <Button size="small" type="text" icon={watching ? <EyeOff {...I14} /> : <Eye {...I14} />} onClick={() => run(!watching)} aria-label={watching ? "دیگر پیگیری نمی‌کنم" : "پیگیری می‌کنم"} />
        </Tooltip>
      }
    >
      {ids.length ? (
        <ul className="rk-plist">
          {ids.map((id) => (
            <li key={id}>
              <UserChip id={id} display={ctx.display} me={userId} />
              {ctx.meta.canWrite && id !== userId ? (
                <button type="button" className="rk-x" aria-label="برداشتن از پیگیری‌کنندگان" onClick={() => run(false, id)}>
                  <X {...I14} aria-hidden />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rk-hint">هنوز کسی این رکورد را پیگیری نمی‌کند.</p>
      )}
      {ctx.meta.canWrite ? (
        adding ? (
          <UserSelect
            value={null}
            autoFocus
            size="small"
            onChange={(v) => {
              setAdding(false);
              if (typeof v === "string") void run(true, v);
            }}
            onBlur={() => setAdding(false)}
            placeholder="افزودن همکار…"
          />
        ) : (
          <Button size="small" type="text" icon={<Plus {...I14} />} onClick={() => setAdding(true)}>
            افزودن همکار
          </Button>
        )
      ) : null}
    </SideCard>
  );
}

// ---------------------------------------------------------------- attachments

function Attachments({ def, ctx }: { def: TableMeta; ctx: RecordContext }) {
  const { orgId } = useOrg();
  const { userId, tz } = useMe();
  const n = useNotify();
  const actions = useRecordActions(def.key);
  const list = useAttachments(def.key, ctx.row.id);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const items = list.data?.attachments ?? [];
  const display = { ...ctx.display, ...(list.data?.display ?? {}) };
  const upload = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      setBusy((b) => b + 1);
      try {
        await actions.upload(ctx.row.id, f);
      } catch (e) {
        n.error(e);
      } finally {
        setBusy((b) => b - 1);
      }
    }
  };
  const remove = async (id: string, name: string) => {
    if (!(await n.confirm(`حذف «${name}»؟`, "فایل از پیوست‌های این رکورد برداشته می‌شود.", true))) return;
    try {
      await actions.removeAttachment(ctx.row.id, id);
    } catch (e) {
      n.error(e);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files?.length) void upload(e.dataTransfer.files);
  };
  return (
    <SideCard id="files" title="پیوست‌ها" count={items.length}>
      <div
        className={cx("rk-drop", over && "is-over")}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <input ref={input} type="file" multiple hidden onChange={(e) => e.target.files && void upload(e.target.files).then(() => (e.target.value = ""))} />
        <Button size="small" icon={<UploadIcon {...I14} />} loading={busy > 0} onClick={() => input.current?.click()}>
          افزودن فایل
        </Button>
        <span className="rk-hint">یا فایل را اینجا رها کنید</span>
      </div>
      {items.length ? (
        <Image.PreviewGroup>
          <ul className="rk-files">
            {items.map((a) => (
              <li key={a.id}>
                {a.previewable ? (
                  <Image src={attachmentUrl(orgId, a.id, true)} alt={a.name} width={40} height={40} className="rk-thumb" preview={{ src: attachmentUrl(orgId, a.id, true) }} />
                ) : (
                  <span className="rk-file-ic" aria-hidden>
                    {a.mime.startsWith("image/") ? <ImageIcon {...I16} /> : <FileText {...I16} />}
                  </span>
                )}
                <span className="rk-file-b">
                  <a className="rk-file-n ds-link" href={attachmentUrl(orgId, a.id)} target="_blank" rel="noopener noreferrer" title={a.name}>
                    {a.name}
                  </a>
                  <span className="rk-file-m">
                    {fileSize(a.size)}، {displayOf(display, a.uploaded_by) ?? "همکار"}، <span title={formatJalaliDateTime(a.created_at, tz)}>{relTime(a.created_at, Date.now(), tz)}</span>
                  </span>
                </span>
                <a className="rk-x" href={attachmentUrl(orgId, a.id)} aria-label={`دریافت ${a.name}`} download>
                  <Download {...I14} aria-hidden />
                </a>
                {ctx.meta.canWrite || a.uploaded_by === userId ? (
                  <button type="button" className="rk-x" aria-label={`حذف ${a.name}`} onClick={() => remove(a.id, a.name)}>
                    <Trash2 {...I14} aria-hidden />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </Image.PreviewGroup>
      ) : list.isLoading ? null : (
        <p className="rk-hint">پیوستی ندارد.</p>
      )}
    </SideCard>
  );
}

// ---------------------------------------------------------------- links

function Links({ def, schema, ctx }: { def: TableMeta; schema: Schema; ctx: RecordContext }) {
  const { orgId } = useOrg();
  const n = useNotify();
  const actions = useRecordActions(def.key);
  const links = useLinks(def.key, ctx.row.id);
  const [adding, setAdding] = useState(false);
  const groups = useMemo(() => {
    const m = new Map<string, LinkItem[]>();
    for (const l of links.data?.links ?? []) m.set(l.label, [...(m.get(l.label) ?? []), l]);
    return [...m.entries()];
  }, [links.data]);
  const remove = async (l: LinkItem) => {
    try {
      await actions.removeLink(ctx.row.id, l.id);
    } catch (e) {
      n.error(e);
    }
  };
  const count = links.data?.links.length ?? 0;
  return (
    <SideCard
      id="links"
      title="پیوندها"
      count={count}
      actions={
        ctx.meta.canWrite ? (
          <Tooltip title="پیوند تازه">
            <Button size="small" type="text" icon={<Plus {...I14} />} onClick={() => setAdding(true)} aria-label="پیوند تازه" />
          </Tooltip>
        ) : null
      }
    >
      {adding ? <AddLink def={def} schema={schema} ctx={ctx} onDone={() => setAdding(false)} /> : null}
      {groups.length ? (
        <div className="rk-links">
          {groups.map(([label, items]) => (
            <div key={label} className="rk-link-g">
              <span className="rk-link-l">{label}</span>
              <ul>
                {items.map((l) => {
                  const known = !!schema.def(l.other.table);
                  const body = (
                    <>
                      <RecordNo no={l.other.number} />
                      <span className="rk-link-t">{l.other.display}</span>
                    </>
                  );
                  return (
                    <li key={l.id}>
                      {known ? (
                        <Link className="rk-link-a" to={`/${orgId}/${recordPath(l.other.table, l.other.id)}`}>
                          {body}
                        </Link>
                      ) : (
                        <span className="rk-link-a">{body}</span>
                      )}
                      {l.other.state_label ? <span className="rk-link-s">{l.other.state_label}</span> : null}
                      {ctx.meta.canWrite ? (
                        <button type="button" className="rk-x" aria-label="حذف پیوند" onClick={() => remove(l)}>
                          <X {...I14} aria-hidden />
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ) : !adding && !links.isLoading ? (
        <p className="rk-hint">پیوندی ندارد.</p>
      ) : null}
    </SideCard>
  );
}

function AddLink({ def, schema, ctx, onDone }: { def: TableMeta; schema: Schema; ctx: RecordContext; onDone: () => void }) {
  const n = useNotify();
  const actions = useRecordActions(def.key);
  const [kind, setKind] = useState("related");
  const [table, setTable] = useState(def.key);
  const [other, setOther] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const tables = [...schema.tables.values()].filter((t) => !t.virtual && t.key !== "view" && t.key !== "custom_field" && t.key !== "choice");
  const submit = async () => {
    if (!other) return;
    setBusy(true);
    try {
      await actions.addLink(ctx.row.id, { kind, table, id: other, ...(note.trim() ? { note: note.trim() } : {}) });
      onDone();
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rk-addlink">
      <Select size="small" value={kind} onChange={setKind} options={Object.entries(LINK_KINDS).map(([k, v]) => ({ value: k, label: v.out }))} aria-label="نوع پیوند" popupMatchSelectWidth={false} />
      <Select size="small" value={table} onChange={(t) => (setTable(t), setOther(null))} options={tables.map((t) => ({ value: t.key, label: t.plural }))} aria-label="جدول" popupMatchSelectWidth={false} />
      <RecordSelect table={table} value={other} onChange={(v) => setOther(typeof v === "string" ? v : null)} size="small" aria-label="رکورد" />
      <Input size="small" value={note} onChange={(e) => setNote(e.target.value)} placeholder="یادداشت (اختیاری)" maxLength={500} />
      <span className="rk-addlink-a">
        <Button size="small" onClick={onDone}>
          انصراف
        </Button>
        <Button size="small" type="primary" icon={<Link2 {...I14} />} onClick={submit} loading={busy} disabled={!other}>
          پیوند
        </Button>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- recent changes

function RecentChanges({ def, schema, ctx }: { def: TableMeta; schema: Schema; ctx: RecordContext }) {
  const { tz } = useMe();
  const activity = useActivity(def, ctx.row.id, typeof ctx.row.created_at === "string" ? ctx.row.created_at : null);
  const changes = activity.items.filter((i) => i.type === "changes" && !i.created).slice(0, 5);
  if (!changes.length) return null;
  const display = { ...ctx.display, ...activity.display };
  return (
    <SideCard id="history" title="آخرین تغییرات">
      <ul className="rk-hist">
        {changes.map((i) => (
          <li key={i.key}>
            <span className="rk-hist-h">
              {displayOf(display, i.actor) ?? "سامانه"}، <span title={formatJalaliDateTime(i.at, tz)}>{relTime(i.at, Date.now(), tz)}</span>
            </span>
            {(i.changes ?? []).slice(0, 3).map((c) => {
              const f = fieldOf(def, c.field);
              return (
                <span key={c.id} className="rk-hist-c">
                  {c.label}: {f ? <FieldValue field={f} value={c.new} table={def.key} schema={schema} display={display} compact tz={tz} /> : null}
                </span>
              );
            })}
          </li>
        ))}
      </ul>
    </SideCard>
  );
}
