// The article editor (kb/edit/:versionId): a draft version in an RTL Markdown editor with a toolbar for the article's
// building blocks — headings, bold and italic, lists and numbered steps, quotes and callouts («یادداشت»، «نکته»،
// «مهم»، «هشدار»، «احتیاط»), code blocks and inline code, tables, links (web and other articles), images uploaded to the
// article, reusable blocks — written, previewed exactly as readers will see it, or both side by side; the internal
// section for agents; keywords and tags; the change note and kind. Changes save themselves (with the concurrency
// token: someone else's save is never overwritten) and the checks beside the text — template sections, sensitive data
// in what requesters read, unsafe commands, the rubric, readability, similar articles — refresh after each save.
// Submit sends it to the base's reviewers or publishes it (now or at a time); the AI writing assistant (when on)
// rewrites the selection or suggests a title and summary, always as a proposal the author applies.
import "./knowledge.css";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dropdown, Input, Modal, Popconfirm, Segmented, Select, Space, Tag, Tooltip } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import {
  Bold, Code, Columns2, Eye, FileCode2, Heading2, Heading3, ImagePlus, Italic, Link2, List, ListOrdered, Lock, MessageSquareWarning, Puzzle, Quote, Send, Sparkles, SquarePen, Table, Trash2, Undo2, BookOpenText, CircleAlert, CircleCheck,
} from "lucide-react";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { errorText, ApiError } from "../../lib/api";
import { PageHeader } from "../../components/layout";
import { Card, Note } from "../../components/blocks";
import { EmptyState, JDateTime, Loader } from "../../components/display";
import { DateTimeInput, recordsApi, RecordSelect, uploadAttachment, type RecordRow } from "../../records";
import { prefixLines, wrapText } from "../../records/fields/MarkdownEditor";
import { ArticleBody } from "./ArticleBody";
import { KB_KEYS, kbApi, useKbMeta, useKbRefresh } from "./api";
import { CALLOUTS, draftChanges, faNum, insertArticleLink, insertBlockRef, insertCallout, insertCode, insertImage, insertTable, toggleHeading, type CalloutKind, type DraftValues, type Edit } from "./model";

const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const I14 = { size: 14, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

type Mode = "write" | "preview" | "split";
type Saving = "idle" | "saving" | "saved" | "error";

/** One Markdown area with the knowledge toolbar. */
function BodyEditor({ value, onChange, placeholder, onImage, onArticle, onBlock, assist, disabled, minRows = 14, label }: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  onImage?: (at: { s: number; e: number }) => void;
  onArticle?: (at: { s: number; e: number }) => void;
  onBlock?: (at: { s: number; e: number }) => void;
  assist?: ReactNode;
  disabled?: boolean;
  minRows?: number;
  label: string;
}) {
  const ta = useRef<TextAreaRef>(null);
  const el = () => ta.current?.resizableTextArea?.textArea ?? null;
  const sel = () => {
    const t = el();
    return { s: t?.selectionStart ?? value.length, e: t?.selectionEnd ?? value.length };
  };
  const apply = (r: Edit) => {
    onChange(r.text);
    requestAnimationFrame(() => {
      const t = el();
      if (!t) return;
      t.focus();
      t.setSelectionRange(r.start, r.end);
    });
  };
  const wrap = (b: string, a: string, ph: string) => {
    const { s, e } = sel();
    apply(wrapText(value, s, e, b, a, ph));
  };
  const lines = (p: (i: number) => string) => {
    const { s, e } = sel();
    apply(prefixLines(value, s, e, p));
  };
  const at = (f: (text: string, s: number, e: number) => Edit) => () => {
    const { s, e } = sel();
    apply(f(value, s, e));
  };
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.code === "KeyB") (e.preventDefault(), wrap("**", "**", "متن پررنگ"));
    else if (e.code === "KeyI") (e.preventDefault(), wrap("_", "_", "متن مورب"));
    else if (e.code === "KeyK") (e.preventDefault(), wrap("[", "](https://)", "متن پیوند"));
  };
  const btn = (title: string, icon: ReactNode, onClick: () => void, keysHint?: string) => (
    <Tooltip title={keysHint ? `${title} (${keysHint})` : title} mouseEnterDelay={0.4}>
      <Button type="text" size="small" icon={icon} onClick={onClick} disabled={disabled} aria-label={title} onMouseDown={(e) => e.preventDefault()} />
    </Tooltip>
  );
  const calloutItems = (Object.keys(CALLOUTS) as CalloutKind[]).map((k) => ({ key: k, label: CALLOUTS[k].label, onClick: () => at((t, s, e) => insertCallout(t, s, e, k))() }));
  return (
    <div>
      <div className="kb-ed-bar" role="toolbar" aria-label={`قالب‌بندی ${label}`}>
        {btn("عنوان بخش", <Heading2 {...I16} />, () => apply(toggleHeading(value, sel().s, 2)))}
        {btn("زیرعنوان", <Heading3 {...I16} />, () => apply(toggleHeading(value, sel().s, 3)))}
        <span className="kb-ed-sep" aria-hidden />
        {btn("پررنگ", <Bold {...I16} />, () => wrap("**", "**", "متن پررنگ"), "Ctrl+B")}
        {btn("مورب", <Italic {...I16} />, () => wrap("_", "_", "متن مورب"), "Ctrl+I")}
        {btn("کد درون خط", <Code {...I16} />, () => wrap("`", "`", "کد"))}
        <span className="kb-ed-sep" aria-hidden />
        {btn("فهرست", <List {...I16} />, () => lines(() => "- "))}
        {btn("گام‌های شماره‌دار", <ListOrdered {...I16} />, () => lines((i) => `${i + 1}. `))}
        {btn("نقل قول", <Quote {...I16} />, () => lines(() => "> "))}
        <Dropdown menu={{ items: calloutItems }} trigger={["click"]} disabled={disabled}>
          <Tooltip title="کادر یادداشت یا هشدار" mouseEnterDelay={0.4}>
            <Button type="text" size="small" icon={<MessageSquareWarning {...I16} />} aria-label="کادر یادداشت یا هشدار" onMouseDown={(e) => e.preventDefault()} />
          </Tooltip>
        </Dropdown>
        {btn("بلوک کد", <FileCode2 {...I16} />, at((t, s, e) => insertCode(t, s, e)))}
        {btn("جدول", <Table {...I16} />, at((t, s, e) => insertTable(t, s, e)))}
        <span className="kb-ed-sep" aria-hidden />
        {btn("پیوند", <Link2 {...I16} />, () => wrap("[", "](https://)", "متن پیوند"), "Ctrl+K")}
        {onArticle ? btn("پیوند به مقالهٔ دیگر", <BookOpenText {...I16} />, () => onArticle(sel())) : null}
        {onImage ? btn("افزودن تصویر", <ImagePlus {...I16} />, () => onImage(sel())) : null}
        {onBlock ? btn("بلوک بازکاربرد", <Puzzle {...I16} />, () => onBlock(sel())) : null}
        {assist ? <span className="ms-auto">{assist}</span> : null}
      </div>
      <Input.TextArea
        ref={ta}
        className="kb-ed-area"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={keys}
        autoSize={{ minRows, maxRows: 40 }}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={label}
        spellCheck
      />
    </div>
  );
}

/** The checks of the saved draft (refetched after each save). */
function Checks({ versionId, savedAt }: { versionId: string; savedAt: number }) {
  const { api, orgId } = useOrg();
  const c = useQuery({ queryKey: [...KB_KEYS.check(orgId, versionId), savedAt], queryFn: () => kbApi.check(api, versionId), staleTime: 0 });
  if (c.isLoading) return <Loader />;
  const d = c.data;
  if (!d) return <p className="text-[13px] text-ink-3">{c.error ? errorText(c.error) : "بررسی در دسترس نیست."}</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <span className="ds-t-figure ds-num">{faNum(d.score)}</span>
        <span className="flex flex-wrap gap-x-3 text-[13px] text-ink-3">
          <span>از ۱۰۰</span>
          <span>
            <bdi className="ds-num">{faNum(d.words)}</bdi> واژه
          </span>
          <span>
            خوانایی <bdi className="ds-num">{faNum(d.readability)}</bdi>
          </span>
        </span>
      </div>
      {d.missing.length ? <Note tone="danger">بخش‌های الزامی قالب خالی‌اند: {d.missing.map((m) => `«${m}»`).join("، ")}</Note> : null}
      {d.findings.length ? (
        <Note tone="danger">
          {d.external ? "در متنی که درخواست‌کنندگان می‌بینند داده‌های حساس هست:" : "داده‌های حساس در متن:"}{" "}
          {d.findings.slice(0, 6).map((f, i) => (
            <span key={i} className="me-2 inline-block">
              {f.label}: <bdi className="ds-ltr">{f.text}</bdi>
            </span>
          ))}
          {d.external ? " — آن را حذف کنید یا به بخش داخلی ببرید." : null}
        </Note>
      ) : null}
      {d.unsafe.length ? <Note tone="warning">دستورهای پرخطر: {d.unsafe.map((u) => u.label).join("، ")} — پیش از آن هشدار بنویسید.</Note> : null}
      <ul className="kb-checks m-0 list-none p-0">
        {d.items.map((it) => (
          <li key={it.key}>
            {it.ok ? <CircleCheck {...I14} className="mt-0.5 shrink-0 text-in" /> : <CircleAlert {...I14} className={`mt-0.5 shrink-0 ${it.blocking ? "text-danger" : "text-ink-3"}`} />}
            <span>
              <span className={it.ok ? "text-ink-2" : "text-ink"}>{it.label}</span>
              {!it.ok && it.hint ? <span className="block text-[12px] text-ink-3">{it.hint}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {d.duplicates.length ? (
        <div>
          <div className="mb-1 text-[13px] text-ink-2">مقاله‌های مشابه منتشرشده</div>
          <ul className="kb-list">
            {d.duplicates.map((x) => (
              <li key={x.id}>
                <Link className="ds-link min-w-0 flex-1 truncate" to={`/${orgId}/kb/a/${x.id}`} target="_blank">
                  {x.title}
                </Link>
                <span className="ds-num shrink-0 text-[12px] text-ink-3">{faNum(x.similarity)}٪</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

const pick = (row: RecordRow): DraftValues => ({
  title: row.title ?? "",
  summary: row.summary ?? "",
  body: row.body ?? "",
  internal_body: row.internal_body ?? "",
  keywords: (row.keywords as string[] | null) ?? [],
  tags: (row.tags as string[] | null) ?? [],
  change_note: row.change_note ?? "",
  change_kind: row.change_kind ?? "minor",
});

export default function Editor() {
  const { versionId = "" } = useParams();
  const { api, orgId, timezone } = useOrg();
  const nav = useNavigate();
  const qc = useQueryClient();
  const refresh = useKbRefresh();
  const meta = useKbMeta();
  const rec = useQuery({ queryKey: ["knowledge", orgId, "version", versionId], queryFn: () => recordsApi.get(api, "kb_version", versionId), retry: false });
  const row = rec.data?.row;
  const articleId = (row?.article_id as string) ?? "";
  const art = useQuery({ queryKey: ["knowledge", orgId, "version-article", articleId], queryFn: () => recordsApi.get(api, "kb_article", articleId), enabled: !!articleId });
  const [vals, setVals] = useState<DraftValues | null>(null);
  const [saved, setSaved] = useState<DraftValues | null>(null);
  const token = useRef<number | undefined>(undefined);
  const [saving, setSaving] = useState<Saving>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(0);
  const [mode, setMode] = useState<Mode>("write");
  const [showInternal, setShowInternal] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [publishAt, setPublishAt] = useState<string | null>(null);
  const [linkAt, setLinkAt] = useState<{ s: number; e: number; field: "body" | "internal_body" } | null>(null);
  const [blockAt, setBlockAt] = useState<{ s: number; e: number; field: "body" | "internal_body" } | null>(null);
  const [assist, setAssist] = useState<{ action: string; label: string; text: string; target: "title" | "summary" | "body" } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const imageAt = useRef<{ s: number; e: number; field: "body" | "internal_body" } | null>(null);

  useEffect(() => {
    if (!row || vals) return;
    const v = pick(row);
    setVals(v);
    setSaved(v);
    token.current = row.version;
    setShowInternal(!!row.internal_body);
  }, [row, vals]);

  const editable = row?.state === "draft" && !!rec.data?.meta.canWrite;
  const published = !!(art.data?.row.published_version_id as string | null);
  const set = (patch: DraftValues) => setVals((v) => ({ ...(v ?? {}), ...patch }));

  const save = useCallback(async () => {
    if (!vals || !saved || !editable) return true;
    const changes = draftChanges(saved, vals);
    if (!Object.keys(changes).length) return true;
    setSaving("saving");
    try {
      const r = await recordsApi.update(api, "kb_version", versionId, changes, token.current);
      token.current = r.row.version;
      setSaved((s) => ({ ...(s ?? {}), ...changes }));
      setSaving("saved");
      setSaveError(null);
      setSavedAt(Date.now());
      return true;
    } catch (e) {
      setSaving("error");
      setSaveError(e instanceof ApiError && e.status === 409 ? "کس دیگری این پیش‌نویس را تغییر داده است؛ صفحه را دوباره باز کنید تا تغییرهایش را ببینید (متن شما در همین صفحه می‌ماند)." : errorText(e));
      return false;
    }
  }, [api, editable, saved, vals, versionId]);

  // autosave a moment after the last keystroke
  useEffect(() => {
    if (!vals || !saved || !editable) return;
    if (!Object.keys(draftChanges(saved, vals)).length) return;
    const t = setTimeout(() => void save(), 1500);
    return () => clearTimeout(t);
  }, [vals, saved, editable, save]);
  // leaving with unsaved changes
  useEffect(() => {
    const dirty = vals && saved && Object.keys(draftChanges(saved, vals)).length > 0;
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [vals, saved]);

  const submit = useAction(
    async () => {
      if (!(await save())) throw new Error(saveError ?? "پیش‌نویس ذخیره نشد");
      return kbApi.submit(api, versionId, publishAt);
    },
    {
      success: (d) => (d.row.state === "published" ? "مقاله منتشر شد" : d.row.state === "scheduled" ? "انتشار زمان‌بندی شد" : "برای بازبینی فرستاده شد"),
      onSuccess: () => {
        setSubmitOpen(false);
        void refresh();
        nav(`/${orgId}/kb/a/${articleId}`);
      },
    },
  );
  const withdraw = useAction(() => kbApi.withdraw(api, versionId), {
    success: "نسخه به پیش‌نویس برگشت",
    onSuccess: () => {
      setVals(null);
      void rec.refetch();
    },
  });
  const discard = useAction(() => recordsApi.transition(api, "kb_version", versionId, "discarded", {}, token.current), {
    success: "پیش‌نویس کنار گذاشته شد",
    onSuccess: () => {
      void refresh();
      nav(published ? `/${orgId}/kb/a/${articleId}` : `/${orgId}/kb`);
    },
  });
  const validate = useAction(() => kbApi.validateAi(api, versionId), { success: "متن هوش مصنوعی تأیید شد", onSuccess: () => void rec.refetch() });
  const write = useAction((a: { action: string; label: string; text: string; target: "title" | "summary" | "body" }) => kbApi.write(api, a.action, a.text, (art.data?.row.base_id as string) ?? null), {
    onSuccess: (d, a) => setAssist({ ...a, text: d.text }),
  });

  const upload = async (f: File) => {
    const at = imageAt.current;
    if (!at || !vals) return;
    try {
      const att = await uploadAttachment(orgId, "kb_article", articleId, f);
      const field = at.field;
      const r = insertImage(String(vals[field] ?? ""), at.s, at.e, att.id, f.name.replace(/\.[a-z0-9]+$/i, ""));
      set({ [field]: r.text });
      void qc.invalidateQueries({ queryKey: ["knowledge", orgId, "read", articleId] });
    } catch (e) {
      setSaveError(errorText(e));
    }
  };
  const insertLink = async (id: string | null) => {
    const at = linkAt;
    setLinkAt(null);
    if (!id || !at || !vals) return;
    const a = (await recordsApi.get(api, "kb_article", id)).row;
    const r = insertArticleLink(String(vals[at.field] ?? ""), at.s, at.e, String(a.number ?? ""), String(a.title ?? ""));
    set({ [at.field]: r.text });
  };
  const insertBlock = async (id: string | null) => {
    const at = blockAt;
    setBlockAt(null);
    if (!id || !at || !vals) return;
    const b = (await recordsApi.get(api, "kb_block", id)).row;
    const r = insertBlockRef(String(vals[at.field] ?? ""), at.s, at.e, String(b.number ?? ""));
    set({ [at.field]: r.text });
  };

  const assistMenu = useMemo(() => {
    const actions = meta.data?.write_actions ?? {};
    if (!(meta.data?.ai ?? []).includes("write") || !Object.keys(actions).length) return null;
    return Object.entries(actions).map(([k, label]) => ({ key: k, label }));
  }, [meta.data]);

  if (rec.isLoading || (row && !vals)) return <Loader />;
  if (!row || !vals) return <EmptyState icon={SquarePen} title="این پیش‌نویس پیدا نشد" description={rec.error ? errorText(rec.error) : undefined} action={<Link to={`/${orgId}/kb`}>مرکز دانش</Link>} />;

  const state = String(row.state);
  const status = saving === "saving" ? "در حال ذخیره…" : saving === "error" ? "ذخیره نشد" : saving === "saved" ? "ذخیره شد" : "";
  const body = String(vals.body ?? "");
  const internal = String(vals.internal_body ?? "");
  const assistButton = assistMenu ? (
    <Dropdown
      trigger={["click"]}
      menu={{
        items: assistMenu,
        onClick: ({ key }) => {
          const label = meta.data?.write_actions[key] ?? key;
          const target = key === "title" ? "title" : key === "summary" ? "summary" : "body";
          write.mutate({ action: key, label, text: body, target });
        },
      }}
    >
      <Button size="small" type="text" icon={<Sparkles {...I14} />} loading={write.isPending}>
        دستیار نگارش
      </Button>
    </Dropdown>
  ) : null;

  return (
    <div>
      <PageHeader
        title={vals.title ? String(vals.title) : "مقالهٔ بی‌عنوان"}
        back={published ? `/${orgId}/kb/a/${articleId}` : `/${orgId}/kb`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {art.data?.row.number ? <bdi className="ds-num">{String(art.data.row.number)}</bdi> : null}
            <span>
              نسخهٔ <bdi className="ds-num">{faNum(String(row.version_label ?? ""))}</bdi>
            </span>
            <Tag variant="filled">{state === "draft" ? "پیش‌نویس" : state === "in_review" ? "در بازبینی" : state === "scheduled" ? "زمان‌بندی‌شده" : state}</Tag>
            {status ? <span className={saving === "error" ? "text-danger" : "text-ink-3"}>{status}</span> : null}
          </span>
        }
        actions={
          <Space wrap>
            <Segmented
              size="small"
              value={mode}
              onChange={(v) => setMode(v as Mode)}
              options={[
                { value: "write", label: "نوشتن", icon: <SquarePen {...I14} /> },
                { value: "preview", label: "پیش‌نمایش", icon: <Eye {...I14} /> },
                { value: "split", label: "کنار هم", icon: <Columns2 {...I14} /> },
              ]}
            />
            {editable ? (
              <Popconfirm title="این پیش‌نویس کنار گذاشته شود؟" okText="کنار بگذار" cancelText="انصراف" okButtonProps={{ danger: true }} onConfirm={() => discard.mutate()}>
                <Button icon={<Trash2 {...I16} />} aria-label="کنار گذاشتن پیش‌نویس" />
              </Popconfirm>
            ) : null}
            {state === "in_review" || state === "scheduled" ? (
              <Button icon={<Undo2 {...I16} />} onClick={() => withdraw.mutate()} loading={withdraw.isPending}>
                برگرداندن به پیش‌نویس
              </Button>
            ) : null}
            {editable ? (
              <Button type="primary" icon={<Send {...I16} />} onClick={() => setSubmitOpen(true)}>
                ارسال
              </Button>
            ) : null}
          </Space>
        }
      />
      {!editable ? (
        <Note className="mb-4">{state === "draft" ? "اجازهٔ ویرایش این پیش‌نویس را ندارید." : state === "in_review" ? "این نسخه در بازبینی است و ویرایش نمی‌شود؛ برای ویرایش آن را به پیش‌نویس برگردانید." : "این نسخه دیگر ویرایش نمی‌شود."}</Note>
      ) : null}
      {saveError ? (
        <Note tone="danger" className="mb-4">
          {saveError}
        </Note>
      ) : null}
      {row.ai_provenance && !row.ai_validated_by ? (
        <Note
          tone="warning"
          className="mb-4"
          action={
            <Button size="small" onClick={() => validate.mutate()} loading={validate.isPending}>
              متن را خواندم و تأیید می‌کنم
            </Button>
          }
        >
          بخشی از این متن را هوش مصنوعی نوشته است؛ پیش از انتشار کسی جز درخواست‌کنندهٔ آن باید آن را بخواند و تأیید کند.
        </Note>
      ) : null}

      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Input size="large" value={String(vals.title ?? "")} onChange={(e) => set({ title: e.target.value })} maxLength={250} placeholder="عنوان مقاله: کوتاه و همان واژه‌هایی که خوانندگان جست‌وجو می‌کنند" disabled={!editable} aria-label="عنوان" />
          <Input.TextArea value={String(vals.summary ?? "")} onChange={(e) => set({ summary: e.target.value })} maxLength={1000} autoSize={{ minRows: 2, maxRows: 4 }} placeholder="خلاصه در یک یا دو جمله: این مقاله چه مشکلی را حل می‌کند؟" disabled={!editable} aria-label="خلاصه" />
          <div className={`kb-ed ${mode === "split" ? "is-split" : ""}`}>
            {mode !== "preview" ? (
              <BodyEditor
                label="متن مقاله"
                value={body}
                onChange={(t) => set({ body: t })}
                placeholder={"## گام‌ها\n\n1. …\n\nبرای بخش تازه «##» بنویسید؛ برای کادر هشدار از نوار ابزار استفاده کنید."}
                disabled={!editable}
                onImage={(at) => ((imageAt.current = { ...at, field: "body" }), file.current?.click())}
                onArticle={(at) => setLinkAt({ ...at, field: "body" })}
                onBlock={(at) => setBlockAt({ ...at, field: "body" })}
                assist={editable ? assistButton : null}
              />
            ) : null}
            {mode !== "write" ? (
              <div className="kb-ed-preview" aria-label="پیش‌نمایش">
                {vals.title ? <h1 className="kb-title">{String(vals.title)}</h1> : null}
                {vals.summary ? <p className="kb-summary">{String(vals.summary)}</p> : null}
                {body.trim() ? <ArticleBody text={body} preview /> : <p className="text-ink-3">هنوز متنی نیست.</p>}
                {internal.trim() ? (
                  <section className="kb-internal">
                    <div className="kb-internal-label">
                      <Lock {...I14} /> فقط کارشناسان
                    </div>
                    <ArticleBody text={internal} preview />
                  </section>
                ) : null}
              </div>
            ) : null}
          </div>

          {showInternal ? (
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[13px] text-ink-2">
                <Lock {...I14} /> بخش داخلی — فقط کارشناسان آن را می‌بینند (علت، دستورهای سرور، نکته‌های عیب‌یابی)
              </div>
              <BodyEditor
                label="بخش داخلی"
                value={internal}
                onChange={(t) => set({ internal_body: t })}
                placeholder="آنچه درخواست‌کنندگان نباید ببینند…"
                disabled={!editable}
                minRows={5}
                onImage={(at) => ((imageAt.current = { ...at, field: "internal_body" }), file.current?.click())}
                onArticle={(at) => setLinkAt({ ...at, field: "internal_body" })}
              />
            </div>
          ) : editable ? (
            <Button type="dashed" icon={<Lock {...I14} />} onClick={() => setShowInternal(true)} className="self-start">
              افزودن بخش داخلی (فقط کارشناسان)
            </Button>
          ) : null}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1 text-[13px] text-ink-2">کلیدواژه‌ها</div>
              <Select mode="tags" className="w-full" value={(vals.keywords as string[]) ?? []} onChange={(v) => set({ keywords: v.slice(0, 50) })} tokenSeparators={["،", ","]} placeholder="واژه‌هایی که خوانندگان جست‌وجو می‌کنند" disabled={!editable} aria-label="کلیدواژه‌ها" open={false} suffixIcon={null} />
            </div>
            <div>
              <div className="mb-1 text-[13px] text-ink-2">برچسب‌ها</div>
              <Select mode="tags" className="w-full" value={(vals.tags as string[]) ?? []} onChange={(v) => set({ tags: v.slice(0, 50) })} tokenSeparators={["،", ","]} placeholder="برای دسته‌بندی و گزارش" disabled={!editable} aria-label="برچسب‌ها" open={false} suffixIcon={null} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <Input value={String(vals.change_note ?? "")} onChange={(e) => set({ change_note: e.target.value })} maxLength={2000} placeholder="شرح تغییر: چه چیزی و چرا عوض شد؟" disabled={!editable} aria-label="شرح تغییر" />
            {published ? (
              <Segmented
                value={String(vals.change_kind ?? "minor")}
                onChange={(v) => set({ change_kind: v })}
                disabled={!editable}
                options={[
                  { value: "minor", label: "ویرایش جزئی" },
                  { value: "major", label: "نسخهٔ اصلی تازه" },
                ]}
              />
            ) : null}
          </div>
        </div>
        <Card title="بررسی پیش از انتشار" className="self-start 2xl:sticky 2xl:top-20">
          <Checks versionId={versionId} savedAt={savedAt} />
        </Card>
      </div>

      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void upload(f);
        }}
      />
      <Modal open={submitOpen} title="ارسال مقاله" okText="ارسال" cancelText="انصراف" onOk={() => submit.mutate()} confirmLoading={submit.isPending} onCancel={() => setSubmitOpen(false)} destroyOnHidden>
        <div className="flex flex-col gap-3">
          <p className="m-0 text-[14px] text-ink-2">اگر این پایگاه انتشار را با تأیید می‌خواهد، مقاله برای تأییدکنندگان پایگاه فرستاده می‌شود؛ وگرنه منتشر می‌شود.</p>
          <div>
            <div className="mb-1 text-[13px] text-ink-2">انتشار در زمانی دیگر (اختیاری)</div>
            <DateTimeInput value={publishAt} onChange={setPublishAt} tz={timezone} allowClear />
          </div>
        </div>
      </Modal>
      <Modal open={!!linkAt} title="پیوند به مقالهٔ دیگر" footer={null} onCancel={() => setLinkAt(null)} destroyOnHidden>
        <RecordSelect table="kb_article" value={null} onChange={(v) => void insertLink((v as string) || null)} filter={{ f: "state", op: "eq", v: "published" }} placeholder="عنوان یا شمارهٔ مقاله" autoFocus />
      </Modal>
      <Modal open={!!blockAt} title="افزودن بلوک بازکاربرد" footer={null} onCancel={() => setBlockAt(null)} destroyOnHidden>
        <RecordSelect table="kb_block" value={null} onChange={(v) => void insertBlock((v as string) || null)} filter={{ f: "state", op: "eq", v: "published" }} placeholder="نام بلوک" autoFocus />
      </Modal>
      <Modal
        open={!!assist}
        title={
          <span className="flex items-center gap-2">
            <Sparkles {...I16} /> پیشنهاد دستیار: {assist?.label}
          </span>
        }
        onCancel={() => setAssist(null)}
        footer={
          <Space>
            <Button onClick={() => setAssist(null)}>انصراف</Button>
            {assist?.target === "body" ? (
              <Button
                onClick={() => {
                  set({ body: `${body.trimEnd()}\n\n${assist.text}\n` });
                  setAssist(null);
                }}
              >
                افزودن به پایان متن
              </Button>
            ) : null}
            <Button
              type="primary"
              onClick={() => {
                if (!assist) return;
                if (assist.target === "title") set({ title: assist.text.slice(0, 250) });
                else if (assist.target === "summary") set({ summary: assist.text.slice(0, 1000) });
                else set({ body: assist.text });
                setAssist(null);
              }}
            >
              جایگزین شود
            </Button>
          </Space>
        }
        width={760}
        destroyOnHidden
      >
        <p className="mb-2 text-[12px] text-ink-3">متن پیشنهادی را هوش مصنوعی نوشته است؛ پیش از به‌کاربردن آن را بخوانید.</p>
        <div className="max-h-[60vh] overflow-auto rounded-md border border-line p-3">{assist ? assist.target === "body" ? <ArticleBody text={assist.text} preview /> : <p className="m-0">{assist.text}</p> : null}</div>
      </Modal>
      {row.updated_at ? (
        <p className="mt-6 text-[12px] text-ink-3">
          آخرین ذخیره: <JDateTime v={String(row.updated_at)} />
        </p>
      ) : null}
    </div>
  );
}
