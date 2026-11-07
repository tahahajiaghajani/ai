// The activity stream under a record: a composer with two clearly different tabs — «پاسخ به درخواست‌کننده» (a
// public comment the requester sees) and «یادداشت داخلی» (a work note only agents see, tinted, with a lock) — with
// @mentions, attachments, Ctrl+Enter to post and two slots modules fill (`cannedResponses`, `aiDraft`); then the
// journal and the field history merged newest first, with filter chips «همه / یادداشت‌های عمومی / یادداشت‌های داخلی /
// سامانه».
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Tooltip, Upload } from "antd";
import { Paperclip, Lock, Eye, AtSign, X, Send, ArrowLeft, FileText } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { faDigits } from "@shared/format";
import { formatJalaliDateTime } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { Avatar, cx } from "../../components/blocks";
import { recordsApi, attachmentUrl } from "../data/api";
import { useActivity, useMe, useRecordActions } from "../data/hooks";
import { ACTIVITY_FILTERS, activityCounts, filterActivity, JOURNAL_KIND_LABELS, relTime, type ActivityFilter, type ActivityItem } from "../model/activity";
import { insertMention, mentionAt } from "../model/mentions";
import { displayOf, fieldOf, type Schema } from "../model/schema";
import type { AttachmentItem, DisplayMap, TableMeta } from "../model/types";
import type { ComposerContext, RecordContext, RecordExtensions } from "../extensions";
import { FieldValue, RecordMarkdown } from "../fields/display";
import { MarkdownEditor, type MarkdownEditorHandle } from "../fields/MarkdownEditor";

const I14 = { size: 14, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

export interface ActivityStreamProps {
  def: TableMeta;
  schema: Schema;
  ctx: RecordContext;
  ext: RecordExtensions;
  createdAt?: string | null;
}

export function ActivityStream({ def, schema, ctx, ext, createdAt }: ActivityStreamProps) {
  const { tz, userId } = useMe();
  const activity = useActivity(def, ctx.row.id, createdAt);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const counts = useMemo(() => activityCounts(activity.items), [activity.items]);
  const items = useMemo(() => filterActivity(activity.items, filter), [activity.items, filter]);
  const display = { ...ctx.display, ...activity.display };
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <section className="rk-act" aria-label="فعالیت‌ها">
      <h2 className="rk-act-h">فعالیت‌ها</h2>
      {def.features?.journal ? <Composer def={def} ctx={ctx} ext={ext} /> : null}
      <div className="rk-act-chips" role="tablist" aria-label="نوع فعالیت">
        {ACTIVITY_FILTERS.map((f) => (
          <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} className={cx("rk-chip", filter === f.key && "is-on")} onClick={() => setFilter(f.key)}>
            {f.label}
            <span className="rk-chip-n ds-num">{faDigits(counts[f.key])}</span>
          </button>
        ))}
      </div>
      {activity.isLoading ? (
        <div className="rk-act-list" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rk-ai is-skel">
              <i className="ds-skel" style={{ inlineSize: 24, blockSize: 24, borderRadius: "50%" }} />
              <div className="rk-stack-s" style={{ flex: 1 }}>
                <i className="ds-skel" style={{ inlineSize: "30%" }} />
                <i className="ds-skel" style={{ inlineSize: "80%" }} />
              </div>
            </div>
          ))}
        </div>
      ) : items.length ? (
        <ol className="rk-act-list">
          {items.map((i) => (
            <Item key={i.key} item={i} def={def} schema={schema} display={display} me={userId} tz={tz} now={now} />
          ))}
        </ol>
      ) : (
        <p className="rk-hint rk-act-empty">{filter === "all" ? "هنوز فعالیتی ثبت نشده است." : "در این دسته فعالیتی نیست."}</p>
      )}
    </section>
  );
}

function Item({ item, def, schema, display, me, tz, now }: { item: ActivityItem; def: TableMeta; schema: Schema; display: DisplayMap; me: string | null; tz: string; now: number }) {
  const { orgId } = useOrg();
  const name = item.actor ? (displayOf(display, item.actor) ?? "همکار") : "سامانه";
  const when = (
    <Tooltip title={formatJalaliDateTime(item.at, tz)}>
      <time className="rk-ai-time" dateTime={item.at}>
        {relTime(item.at, now, tz)}
      </time>
    </Tooltip>
  );
  if (item.type === "changes") {
    const changes = item.changes ?? [];
    return (
      <li className="rk-ai is-change">
        <Avatar name={name} />
        <div className="rk-ai-b">
          <div className="rk-ai-h">
            <span className="rk-ai-n">{item.actor === me ? "شما" : name}</span>
            <span className="rk-ai-k">{item.created ? "این رکورد را ثبت کرد" : `${faDigits(changes.length)} فیلد را تغییر داد`}</span>
            {when}
          </div>
          {!item.created ? (
            <ul className="rk-chg">
              {changes.map((c) => {
                const f = fieldOf(def, c.field);
                return (
                  <li key={c.id}>
                    <span className="rk-chg-l">{c.label}</span>
                    {f ? (
                      <>
                        <span className="rk-chg-old">
                          <FieldValue field={f} value={c.old} table={def.key} schema={schema} display={display} compact tz={tz} />
                        </span>
                        <ArrowLeft {...I14} className="rk-chg-arrow" aria-label="به" />
                        <span className="rk-chg-new">
                          <FieldValue field={f} value={c.new} table={def.key} schema={schema} display={display} compact tz={tz} />
                        </span>
                      </>
                    ) : (
                      <span className="text-ink-3">تغییر کرد</span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </li>
    );
  }
  const e = item.entry!;
  const internal = e.visibility === "internal";
  return (
    <li className={cx("rk-ai", internal ? "is-internal" : "is-public", e.kind === "system" && "is-system")}>
      <Avatar name={name} />
      <div className="rk-ai-b">
        <div className="rk-ai-h">
          <span className="rk-ai-n">{item.actor === me ? "شما" : name}</span>
          <span className={cx("rk-ai-badge", internal && "is-internal")}>
            {internal ? <Lock {...I14} aria-hidden /> : null}
            {JOURNAL_KIND_LABELS[e.kind] ?? e.kind}
          </span>
          {when}
        </div>
        <RecordMarkdown text={e.body} display={display} className="rk-ai-body" />
        {e.attachments.length ? (
          <ul className="rk-ai-files">
            {e.attachments.map((a) => (
              <li key={a.id}>
                <a className="ds-link" href={attachmentUrl(orgId, a.id)} target="_blank" rel="noopener noreferrer">
                  <FileText {...I14} aria-hidden /> {a.name}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------- composer

function Composer({ def, ctx, ext }: { def: TableMeta; ctx: RecordContext; ext: RecordExtensions }) {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const actions = useRecordActions(def.key);
  const [kind, setKind] = useState<"comment" | "work_note">("work_note");
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [files, setFiles] = useState<AttachmentItem[]>([]);
  const [uploading, setUploading] = useState(0);
  const [busy, setBusy] = useState(false);
  const editor = useRef<MarkdownEditorHandle>(null);
  const internal = kind === "work_note";

  const mention = mentionAt(text, caret);
  const people = useQuery({
    queryKey: ["records-pick", orgId, "user", mention?.query ?? "", "mention"],
    queryFn: () => recordsApi.list(api, "user", { q: mention?.query || undefined, size: 6, fields: ["name", "email", "is_active"], total: false }),
    enabled: !!mention,
    staleTime: 30_000,
  });
  const [pick, setPick] = useState(0);
  useEffect(() => setPick(0), [mention?.query]);
  const candidates = (people.data?.rows ?? []).filter((u) => u.is_active !== false);
  const choose = (u: { id: string; name?: unknown; email?: unknown }) => {
    if (!mention) return;
    const r = insertMention(text, mention.start, caret, u.id, String(u.name || u.email || ""));
    setText(r.text);
    setCaret(r.caret);
    requestAnimationFrame(() => {
      const t = editor.current?.textarea();
      t?.focus();
      t?.setSelectionRange(r.caret, r.caret);
    });
  };

  const post = async () => {
    const body = text.trim();
    if (!body || busy || uploading) return;
    setBusy(true);
    try {
      await actions.comment(ctx.row.id, kind, body, files.map((f) => f.id));
      setText("");
      setFiles([]);
      n.ok(internal ? "یادداشت داخلی ثبت شد" : "پاسخ فرستاده شد");
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    setUploading((u) => u + 1);
    try {
      const a = await actions.upload(ctx.row.id, file);
      setFiles((f) => [...f, a]);
    } catch (e) {
      n.error(e);
    } finally {
      setUploading((u) => u - 1);
    }
    return false;
  };

  const composerCtx: ComposerContext = {
    record: ctx,
    kind,
    text,
    setText,
    insert: (t) => editor.current?.insert(t),
  };
  const slots: ReactNode[] = [];
  if (ext.cannedResponses) slots.push(<span key="canned">{ext.cannedResponses(composerCtx)}</span>);
  if (ext.aiDraft) slots.push(<span key="ai">{ext.aiDraft(composerCtx)}</span>);

  return (
    <div className={cx("rk-comp", internal ? "is-internal" : "is-public")} data-kind={kind}>
      <div className="rk-comp-tabs" role="tablist" aria-label="نوع نوشته">
        <button type="button" role="tab" aria-selected={!internal} className={cx("rk-comp-tab", !internal && "is-on")} onClick={() => setKind("comment")}>
          <Eye {...I14} aria-hidden /> پاسخ به درخواست‌کننده
        </button>
        <button type="button" role="tab" aria-selected={internal} className={cx("rk-comp-tab", internal && "is-on")} onClick={() => setKind("work_note")}>
          <Lock {...I14} aria-hidden /> یادداشت داخلی
        </button>
      </div>
      <div className="rk-comp-body">
        <MarkdownEditor
          ref={editor}
          bare
          value={text}
          onChange={setText}
          onSelect={setCaret}
          minRows={3}
          maxRows={14}
          display={ctx.display}
          aria-label={internal ? "یادداشت داخلی" : "پاسخ به درخواست‌کننده"}
          placeholder={internal ? "یادداشتی که فقط کارشناسان می‌بینند… (@ برای نام بردن از همکار)" : "پاسخی که درخواست‌کننده می‌بیند…"}
          onKeyDown={(e) => {
            if (mention && candidates.length) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setPick((p) => (p + (e.key === "ArrowDown" ? 1 : candidates.length - 1)) % candidates.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                choose(candidates[pick]);
                return;
              }
            }
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void post();
            }
          }}
          tools={
            <>
              {slots}
              <Tooltip title="نام بردن از همکار (@)">
                <Button type="text" size="small" icon={<AtSign {...I16} />} aria-label="نام بردن از همکار" onClick={() => editor.current?.insert(text && !/\s$/.test(text) ? " @" : "@")} />
              </Tooltip>
              {def.features?.attachments ? (
                <Upload showUploadList={false} multiple beforeUpload={(f) => upload(f)}>
                  <Tooltip title="پیوست">
                    <Button type="text" size="small" icon={<Paperclip {...I16} />} aria-label="پیوست" loading={uploading > 0} />
                  </Tooltip>
                </Upload>
              ) : null}
            </>
          }
        />
        {mention && candidates.length ? (
          <ul className="rk-mention-list" role="listbox" aria-label="همکاران">
            {candidates.map((u, i) => (
              <li key={u.id} role="option" aria-selected={i === pick}>
                <button type="button" className={cx(i === pick && "is-on")} onMouseDown={(e) => (e.preventDefault(), choose(u))}>
                  <Avatar name={String(u.name ?? "")} />
                  <span>{String(u.name || u.email)}</span>
                  {u.email ? <bdi dir="ltr" className="rk-opt-s">{String(u.email)}</bdi> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {files.length ? (
        <ul className="rk-comp-files">
          {files.map((f) => (
            <li key={f.id}>
              <FileText {...I14} aria-hidden />
              <span>{f.name}</span>
              <button
                type="button"
                aria-label={`برداشتن ${f.name}`}
                onClick={async () => {
                  setFiles((x) => x.filter((y) => y.id !== f.id));
                  await actions.removeAttachment(ctx.row.id, f.id).catch(() => undefined);
                }}
              >
                <X {...I14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="rk-comp-foot">
        <span className="rk-comp-who">
          {internal ? (
            <>
              <Lock {...I14} aria-hidden /> فقط کارشناسان این یادداشت را می‌بینند
            </>
          ) : (
            <>
              <Eye {...I14} aria-hidden /> درخواست‌کننده این پاسخ را می‌بیند
            </>
          )}
        </span>
        <span className="rk-comp-kbd">Ctrl+Enter</span>
        <Button type="primary" icon={<Send {...I16} />} onClick={post} loading={busy} disabled={!text.trim() || uploading > 0}>
          {internal ? "ثبت یادداشت" : "ارسال پاسخ"}
        </Button>
      </div>
    </div>
  );
}
