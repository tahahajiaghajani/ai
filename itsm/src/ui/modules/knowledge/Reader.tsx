// The reading view of an article (kb/a/:id), shaped like a polished help-centre page: the path, title and summary, a
// quiet meta line (number, version, last update and review, reading time, views), the banners the server decided
// (retired → its replacement, may be outdated, draft, internal, AI-written, machine translation, stale translation,
// scheduled, expired, compliance), a read-and-acknowledge bar, other languages, the body with its table of contents
// (sticky beside the text on wide screens, folded above it on phones), the internal section for agents, attachments,
// the glossary of the terms it uses, «این مقاله به کارتان آمد؟», stars, «گزارش ایراد», following, related articles.
// Contributors get the editing actions in the header; everything else is what any reader may do.
import "./knowledge.css";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Button, Checkbox, Dropdown, Input, Modal, Radio, Select, Space, Tag, Tooltip } from "antd";
import { Bell, BellOff, BookOpenText, CircleCheck, Clock, Download, ExternalLink, Eye, Flag, History, Languages, Link2, Lock, MoreHorizontal, PencilLine, Printer, RotateCcw, ShieldCheck, Sparkles, Star, ThumbsDown, ThumbsUp, Archive, UserSearch } from "lucide-react";
import type { KbReadView } from "@shared/knowledge/api";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { PageHeader } from "../../components/layout";
import { Note } from "../../components/blocks";
import { EmptyState, JDate, Loader } from "../../components/display";
import { attachmentUrl, recordPath, RecordSelect } from "../../records";
import { ArticleBody } from "./ArticleBody";
import { kbApi, kbSession, useKbMeta, useKbRead, useKbRefresh } from "./api";
import { activeHeading, faNum, FLAG_REASONS, helpfulLine, languageLabel, LANGUAGES, NOT_HELPFUL_REASONS, readingLabel } from "./model";
import { wordCount } from "@shared/knowledge/logic";

const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const I14 = { size: 14, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

/** The table of contents, with the heading in view marked. */
function Toc({ toc, active }: { toc: KbReadView["toc"]; active: string | null }) {
  const items = toc.filter((h) => h.level >= 2 && h.level <= 4);
  if (items.length < 2) return null;
  return (
    <ul className="kb-toc">
      {items.map((h) => (
        <li key={h.slug} className={`lv${h.level}`}>
          <a href={`#${h.slug}`} className={active === h.slug ? "is-active" : undefined}>
            {h.text}
          </a>
        </li>
      ))}
    </ul>
  );
}

function useActiveHeading(slugs: string[]): string | null {
  const [active, setActive] = useState<string | null>(slugs[0] ?? null);
  useEffect(() => {
    if (!slugs.length) return;
    const onScroll = () => {
      const tops = slugs.map((slug) => ({ slug, top: document.getElementById(slug)?.getBoundingClientRect().top ?? Infinity })).filter((t) => t.top !== Infinity);
      setActive(activeHeading(tops, 120));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [slugs]);
  return active;
}

const sizeText = (n: number) => (n >= 1024 * 1024 ? `${faNum((n / 1024 / 1024).toFixed(1))} مگابایت` : `${faNum(Math.max(1, Math.round(n / 1024)))} کیلوبایت`);

/** «این مقاله به کارتان آمد؟», stars, «گزارش ایراد» and following. */
function Feedback({ v, query }: { v: KbReadView; query: string | null }) {
  const { api } = useOrg();
  const refresh = useKbRefresh();
  const id = v.article.id as string;
  const [no, setNo] = useState(false);
  const [reason, setReason] = useState<string>("unclear");
  const [comment, setComment] = useState("");
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagReason, setFlagReason] = useState("incorrect");
  const [flagComment, setFlagComment] = useState("");
  const [thanks, setThanks] = useState<string | null>(null);
  const vote = useAction((helpful: boolean) => kbApi.vote(api, id, helpful, helpful ? null : reason, helpful ? null : comment || null), {
    onSuccess: (_d, helpful) => {
      setNo(false);
      setThanks(helpful ? "خوشحالیم که به کارتان آمد." : "سپاس؛ نظرتان به نویسندهٔ مقاله می‌رسد.");
      void refresh();
    },
  });
  const rate = useAction((r: number) => kbApi.rate(api, id, r), { success: "امتیاز شما ثبت شد", onSuccess: () => void refresh() });
  const flag = useAction(() => kbApi.flag(api, id, flagReason, flagComment || null), {
    success: "گزارش شما ثبت شد؛ مسئولان مقاله آن را بررسی می‌کنند.",
    onSuccess: () => {
      setFlagOpen(false);
      setFlagComment("");
      void refresh();
    },
  });
  const sub = useAction((on: boolean) => kbApi.subscribe(api, "kb_article", id, on), { success: (d) => (d.subscribed ? "از تغییرهای این مقاله باخبر می‌شوید" : "دیگر دنبال نمی‌کنید"), onSuccess: () => void refresh() });
  const solved = useAction(() => kbApi.deflect(api, id, query, kbSession()), { success: "خوشحالیم که مشکل حل شد." });
  const a = v.article as Record<string, number>;
  const line = helpfulLine(Number(a.helpful_yes ?? 0), Number(a.helpful_no ?? 0));
  return (
    <section className="kb-feedback no-print" aria-label="بازخورد">
      {v.can.feedback ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="ds-t-title">این مقاله به کارتان آمد؟</span>
            <Space size={6}>
              <Button icon={<ThumbsUp {...I16} />} type={v.my.vote === "helpful" ? "primary" : "default"} onClick={() => vote.mutate(true)} loading={vote.isPending && vote.variables === true}>
                بله
              </Button>
              <Button icon={<ThumbsDown {...I16} />} type={v.my.vote === "not_helpful" ? "primary" : "default"} onClick={() => setNo((x) => !x)}>
                نه
              </Button>
            </Space>
            {line ? <span className="text-[12px] text-ink-3">{line}</span> : null}
          </div>
          {thanks ? <p className="mt-2 text-[13px] text-ink-2">{thanks}</p> : null}
          {no ? (
            <div className="mt-3 flex flex-col gap-2">
              <Radio.Group value={reason} onChange={(e) => setReason(e.target.value)} optionType="button" size="small" options={NOT_HELPFUL_REASONS} />
              <Input.TextArea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={4000} autoSize={{ minRows: 2, maxRows: 6 }} placeholder="چه چیزی کم بود یا درست کار نکرد؟ (اختیاری)" />
              <div>
                <Button type="primary" onClick={() => vote.mutate(false)} loading={vote.isPending && vote.variables === false}>
                  فرستادن
                </Button>
              </div>
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
            <span className="flex items-center gap-2">
              <span className="text-[13px] text-ink-2">امتیاز شما</span>
              <span className="kb-stars" role="radiogroup" aria-label="امتیاز از ۱ تا ۵">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={v.my.rating === n} aria-label={`${faNum(n)} از ۵`} className={(v.my.rating ?? 0) >= n ? "is-on" : undefined} onClick={() => rate.mutate(n)}>
                    <Star size={18} strokeWidth={1.4} fill={(v.my.rating ?? 0) >= n ? "currentColor" : "none"} />
                  </button>
                ))}
              </span>
            </span>
            {query ? (
              <Button size="small" icon={<CircleCheck {...I14} />} onClick={() => solved.mutate()} loading={solved.isPending}>
                مشکلم حل شد
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
        {v.can.flag ? (
          <Button size="small" type="text" icon={<Flag {...I14} />} onClick={() => setFlagOpen(true)}>
            گزارش ایراد
          </Button>
        ) : null}
        {v.can.subscribe ? (
          <Button size="small" type="text" icon={v.my.subscribed ? <BellOff {...I14} /> : <Bell {...I14} />} onClick={() => sub.mutate(!v.my.subscribed)} loading={sub.isPending}>
            {v.my.subscribed ? "دنبال نکردن" : "دنبال کردن تغییرها"}
          </Button>
        ) : null}
      </div>
      <Modal open={flagOpen} title="گزارش ایراد این مقاله" okText="ثبت گزارش" cancelText="انصراف" onOk={() => flag.mutate()} confirmLoading={flag.isPending} onCancel={() => setFlagOpen(false)} destroyOnHidden>
        <div className="flex flex-col gap-3">
          <Radio.Group value={flagReason} onChange={(e) => setFlagReason(e.target.value)} className="flex flex-col gap-1.5" options={FLAG_REASONS} />
          <Input.TextArea value={flagComment} onChange={(e) => setFlagComment(e.target.value)} maxLength={4000} autoSize={{ minRows: 3, maxRows: 8 }} placeholder="کجای مقاله و چه چیزی باید درست شود؟" />
        </div>
      </Modal>
    </section>
  );
}

/** The contributors' actions of the header. */
function Actions({ v }: { v: KbReadView }) {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const refresh = useKbRefresh();
  const id = v.article.id as string;
  const [retireOpen, setRetireOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [replacement, setReplacement] = useState<string | null>(null);
  const [translateOpen, setTranslateOpen] = useState(false);
  const [lang, setLang] = useState("en");
  const [machine, setMachine] = useState(false);
  const meta = useKbMeta();
  const ai = (meta.data?.ai ?? []).includes("translate");
  const [explainOpen, setExplainOpen] = useState(false);
  const [who, setWho] = useState<string | null>(null);
  const [explained, setExplained] = useState<Awaited<ReturnType<typeof kbApi.explain>> | null>(null);
  const edit = useAction(() => (v.can.draft ? Promise.resolve({ version: { id: v.can.draft } }) : kbApi.draft(api, id, "minor")), { onSuccess: (d) => nav(`/${orgId}/kb/edit/${d.version.id}`) });
  const reviewed = useAction(() => kbApi.review(api, id, "confirm"), { success: "بازبینی ثبت شد؛ موعد بعدی جلو رفت", onSuccess: () => void refresh() });
  const retire = useAction(() => kbApi.retire(api, id, reason, replacement), {
    success: (d) => (d.row.state === "pending_retirement" ? "درخواست بازنشستگی برای تأیید فرستاده شد" : "مقاله بازنشسته شد"),
    onSuccess: () => {
      setRetireOpen(false);
      void refresh();
    },
  });
  const restore = useAction(() => kbApi.restore(api, id), { success: "مقاله بازگردانده شد", onSuccess: () => void refresh() });
  const translate = useAction(() => kbApi.translate(api, id, lang, machine && ai), { success: (d) => (d.article.machine_translated ? "ترجمهٔ ماشینی آماده شد؛ پیش از انتشار آن را بخوانید" : "پیش‌نویس ترجمه ساخته شد"), onSuccess: (d) => nav(`/${orgId}/kb/edit/${d.version.id}`) });
  const explain = useAction((user: string) => kbApi.explain(api, id, user), { onSuccess: (d) => setExplained(d) });
  const items = [
    { key: "record", icon: <History {...I14} />, label: "نسخه‌ها و جزئیات", onClick: () => nav(`/${orgId}/${recordPath("kb_article", id)}`) },
    ...(v.can.review ? [{ key: "review", icon: <ShieldCheck {...I14} />, label: "هنوز درست است (بازبینی شد)", onClick: () => reviewed.mutate() }] : []),
    ...(v.can.edit && !v.article.translation_of ? [{ key: "translate", icon: <Languages {...I14} />, label: "ترجمه به زبان دیگر", onClick: () => setTranslateOpen(true) }] : []),
    ...(v.can.retire ? [{ key: "retire", icon: <Archive {...I14} />, label: "بازنشسته کردن…", danger: true, onClick: () => setRetireOpen(true) }] : []),
    ...(v.can.manage ? [{ key: "explain", icon: <UserSearch {...I14} />, label: "چه کسی این مقاله را می‌بیند؟", onClick: () => setExplainOpen(true) }] : []),
  ];
  const any = v.can.edit || v.can.restore || items.length > 1;
  if (!any) return null;
  return (
    <>
      {v.can.restore ? (
        <Button icon={<RotateCcw {...I16} />} onClick={() => restore.mutate()} loading={restore.isPending}>
          بازگرداندن
        </Button>
      ) : null}
      {v.can.edit ? (
        <Button type="primary" icon={<PencilLine {...I16} />} onClick={() => edit.mutate()} loading={edit.isPending}>
          {v.can.draft ? "ادامهٔ پیش‌نویس" : "ویرایش"}
        </Button>
      ) : null}
      <Dropdown menu={{ items }} trigger={["click"]} placement="bottomLeft">
        <Button icon={<MoreHorizontal {...I16} />} aria-label="کارهای دیگر" />
      </Dropdown>
      <Modal open={retireOpen} title="بازنشسته کردن مقاله" okText="بازنشسته شود" okButtonProps={{ danger: true, disabled: reason.trim().length < 3 }} cancelText="انصراف" onOk={() => retire.mutate()} confirmLoading={retire.isPending} onCancel={() => setRetireOpen(false)} destroyOnHidden>
        <div className="flex flex-col gap-3">
          <Input.TextArea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} autoSize={{ minRows: 2, maxRows: 6 }} placeholder="چرا این مقاله دیگر لازم نیست؟" aria-label="دلیل بازنشستگی" />
          <div>
            <div className="mb-1 text-[13px] text-ink-2">مقالهٔ جایگزین (اختیاری)</div>
            <RecordSelect table="kb_article" value={replacement} onChange={(x) => setReplacement((x as string) || null)} filter={{ f: "state", op: "eq", v: "published" }} placeholder="مقاله‌ای که خوانندگان به آن بروند" allowClear />
          </div>
        </div>
      </Modal>
      <Modal open={translateOpen} title="ترجمهٔ مقاله" okText="ساخت پیش‌نویس ترجمه" cancelText="انصراف" onOk={() => translate.mutate()} confirmLoading={translate.isPending} onCancel={() => setTranslateOpen(false)} destroyOnHidden>
        <div className="flex flex-col gap-3">
          <Select className="w-full" value={lang} onChange={setLang} options={LANGUAGES.filter((l) => l.value !== (v.article.language ?? "fa"))} aria-label="زبان ترجمه" />
          {ai ? (
            <Checkbox checked={machine} onChange={(e) => setMachine(e.target.checked)}>
              ترجمهٔ ماشینی با هوش مصنوعی (برچسب می‌خورد و پیش از انتشار باید تأیید شود)
            </Checkbox>
          ) : null}
        </div>
      </Modal>
      <Modal open={explainOpen} title="چه کسی این مقاله را می‌بیند؟" footer={null} onCancel={() => (setExplainOpen(false), setExplained(null))} destroyOnHidden>
        <div className="flex flex-col gap-3">
          <RecordSelect table="user" value={who} onChange={(x) => (setWho((x as string) || null), x ? explain.mutate(x as string) : setExplained(null))} placeholder="یک همکار را انتخاب کنید" />
          {explain.isPending ? <Loader /> : null}
          {explained ? (
            <div className="flex flex-col gap-2">
              <Note tone={explained.readable ? "neutral" : "warning"}>{explained.readable ? `${explained.user.name ?? "این همکار"} این مقاله را می‌بیند.` : `${explained.user.name ?? "این همکار"} این مقاله را نمی‌بیند.`}</Note>
              <ul className="flex flex-col gap-1.5">
                {explained.layers.map((l) => (
                  <li key={l.key} className="flex items-start gap-2 text-[13px]">
                    <span className={l.ok === false ? "text-danger" : l.ok ? "text-in" : "text-ink-3"}>{l.ok === false ? "✕" : l.ok ? "✓" : "–"}</span>
                    <span>
                      <span className="text-ink">{l.label}</span>
                      <span className="text-ink-3"> — {l.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-[12px] text-ink-3">پاسخ‌های هوش مصنوعی: {explained.ai.reason}</p>
            </div>
          ) : null}
        </div>
      </Modal>
    </>
  );
}

export default function Reader() {
  const { id = "" } = useParams();
  const { api, orgId } = useOrg();
  const [sp] = useSearchParams();
  const query = sp.get("q");
  const q = useKbRead(id, kbSession());
  const refresh = useKbRefresh();
  const v = q.data;
  const slugs = useMemo(() => (v?.toc ?? []).filter((h) => h.level >= 2 && h.level <= 4).map((h) => h.slug), [v?.toc]);
  const active = useActiveHeading(slugs);
  const ack = useAction((attId: string) => kbApi.ack(api, attId), { success: "تأیید مطالعهٔ شما ثبت شد", onSuccess: () => void refresh() });
  useEffect(() => {
    // a link with #section scrolls there once the body is rendered
    if (v && window.location.hash) document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView();
  }, [v]);

  if (q.isLoading) return <Loader />;
  if (q.error || !v)
    return (
      <div>
        <PageHeader title="مرکز دانش" back={`/${orgId}/kb`} />
        <EmptyState icon={BookOpenText} title="این مقاله پیدا نشد" description={q.error ? errorText(q.error) : "شاید حذف شده باشد یا به آن دسترسی نداشته باشید."} action={<Link to={`/${orgId}/kb`}>رفتن به مرکز دانش</Link>} />
      </div>
    );

  const a = v.article as Record<string, any>;
  const words = wordCount(`${v.body}\n${v.internal_body ?? ""}`);
  const meta: ReactNode[] = [
    a.number ? (
      <span key="n" className="ds-num" dir="ltr">
        {a.number}
      </span>
    ) : null,
    a.version_label ? <span key="v">نسخهٔ <bdi className="ds-num">{faNum(a.version_label)}</bdi></span> : null,
    a.published_at ? (
      <span key="p">
        به‌روزرسانی <JDate v={a.published_at} />
      </span>
    ) : null,
    a.last_reviewed_at ? (
      <span key="r">
        <ShieldCheck {...I14} /> بازبینی <JDate v={a.last_reviewed_at} />
        {v.reviewer_name ? ` · ${v.reviewer_name}` : ""}
      </span>
    ) : null,
    <span key="t">
      <Clock {...I14} /> {readingLabel(words)}
    </span>,
    Number(a.view_count) ? (
      <span key="w">
        <Eye {...I14} /> <span className="ds-num">{faNum(a.view_count)}</span> بازدید
      </span>
    ) : null,
    v.owner_name ? <span key="o">مسئول: {v.owner_name}</span> : null,
  ].filter(Boolean);

  return (
    <div>
      <PageHeader title="مرکز دانش" back={`/${orgId}/kb`} actions={<Actions v={v} />} />
      <div className="kb-read">
        <article className="kb-article">
          <nav className="kb-crumbs" aria-label="مسیر">
            <Link to={`/${orgId}/kb`}>مرکز دانش</Link>
            {v.base ? (
              <>
                <span aria-hidden>‹</span>
                <Link to={`/${orgId}/kb/search?base=${v.base.id}`}>{v.base.name}</Link>
              </>
            ) : null}
            {v.path.map((p) => (
              <span key={p.id} className="contents">
                <span aria-hidden>‹</span>
                <Link to={`/${orgId}/kb/search?category=${p.id}`}>{p.name}</Link>
              </span>
            ))}
          </nav>
          <h1 className="kb-title">{String(a.title ?? "")}</h1>
          {a.summary ? <p className="kb-summary">{String(a.summary)}</p> : null}
          <div className="kb-meta">{meta}</div>

          {v.banners.length ? (
            <div className="mb-5 flex flex-col gap-2">
              {v.banners.map((b) => (
                <Note key={b.kind} tone={b.tone === "info" ? "neutral" : b.tone}>
                  {b.text}
                  {b.link ? (
                    <>
                      {" "}
                      <Link className="ds-link" to={`/${orgId}/kb/a/${b.link.id}`}>
                        {b.link.title}
                      </Link>
                    </>
                  ) : null}
                </Note>
              ))}
            </div>
          ) : null}

          {v.my.acknowledgement && !v.my.acknowledgement.acked_at ? (
            <div className="mb-5">
              <Note
                tone="warning"
                action={
                  <Button type="primary" size="small" onClick={() => ack.mutate(v.my.acknowledgement!.attestation_id)} loading={ack.isPending}>
                    خواندم و می‌پذیرم
                  </Button>
                }
              >
                «{v.my.acknowledgement.title}»: این سند را تا <JDate v={v.my.acknowledgement.due_at} /> بخوانید و مطالعهٔ آن را تأیید کنید.
              </Note>
            </div>
          ) : v.my.acknowledgement?.acked_at ? (
            <p className="mb-4 flex items-center gap-1.5 text-[13px] text-in">
              <CircleCheck {...I14} /> مطالعهٔ این سند را <JDate v={v.my.acknowledgement.acked_at} /> تأیید کرده‌اید.
            </p>
          ) : null}

          {v.translations.length ? (
            <div className="mb-5 flex flex-wrap items-center gap-2 text-[13px]">
              <Languages {...I14} className="text-ink-3" />
              <span className="text-ink-3">زبان‌های دیگر:</span>
              {v.translations.map((t) => (
                <Link key={t.id} to={`/${orgId}/kb/a/${t.id}`} className="ds-link">
                  {languageLabel(t.language)}
                  {t.master ? " (اصلی)" : ""}
                  {t.stale ? " · کهنه" : ""}
                </Link>
              ))}
            </div>
          ) : null}

          {slugs.length > 1 ? (
            <details className="kb-toc-inline">
              <summary>در این مقاله</summary>
              <div className="mt-2">
                <Toc toc={v.toc} active={active} />
              </div>
            </details>
          ) : null}

          {a.article_type === "link" && a.external_url ? (
            <div className="mb-5">
              <Note
                action={
                  <Button type="primary" size="small" href={String(a.external_url)} target="_blank" rel="noopener noreferrer nofollow" icon={<ExternalLink {...I14} />}>
                    رفتن به منبع
                  </Button>
                }
              >
                این مقاله به منبعی بیرون از مرکز دانش می‌رود: <bdi className="ds-ltr">{String(a.external_url).replace(/^https?:\/\//, "").slice(0, 80)}</bdi>
              </Note>
            </div>
          ) : null}

          <ArticleBody text={v.body} />

          {v.internal_body ? (
            <section className="kb-internal" aria-label="بخش داخلی">
              <div className="kb-internal-label">
                <Lock {...I14} /> فقط کارشناسان — درخواست‌کنندگان این بخش را نمی‌بینند
              </div>
              <ArticleBody text={v.internal_body} />
            </section>
          ) : null}

          {v.attachments.length ? (
            <section className="mt-8" aria-label="پیوست‌ها">
              <h2 className="ds-t-title mb-2">پیوست‌ها</h2>
              <ul className="kb-list">
                {v.attachments.map((f) => (
                  <li key={f.id}>
                    <a className="ds-link min-w-0 truncate" href={attachmentUrl(orgId, f.id)} download>
                      <Download {...I14} className="me-1 inline" /> {f.name}
                    </a>
                    <span className="ms-auto shrink-0 text-[12px] text-ink-3">{sizeText(f.size)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {v.glossary.length ? (
            <details className="mt-6">
              <summary className="cursor-pointer text-[13px] text-ink-2">واژه‌های این مقاله ({faNum(v.glossary.length)})</summary>
              <dl className="mt-2 flex flex-col gap-2">
                {v.glossary.map((g) => (
                  <div key={g.term}>
                    <dt className="font-medium text-ink">
                      {g.term}
                      {g.approved_fa && g.approved_fa !== g.term ? <span className="text-ink-3"> — برابر مصوب: {g.approved_fa}</span> : null}
                    </dt>
                    {g.definition ? <dd className="m-0 text-[13px] text-ink-2">{g.definition}</dd> : null}
                  </div>
                ))}
              </dl>
            </details>
          ) : null}

          {v.provenance ? (
            <p className="mt-6 flex items-center gap-1.5 text-[12px] text-ink-3">
              <Sparkles {...I14} />
              {v.provenance.machine_translated ? "ترجمهٔ ماشینی" : "نوشته‌شده با کمک هوش مصنوعی"}
              {v.provenance.model ? ` (${v.provenance.model})` : ""}
              {v.provenance.validated_by_name ? ` · تأییدشده به دست ${v.provenance.validated_by_name}` : " · هنوز کسی آن را تأیید نکرده است"}
            </p>
          ) : null}

          <Feedback v={v} query={query} />

          {v.related.length ? (
            <section className="mt-8" aria-label="مقاله‌های مرتبط">
              <h2 className="ds-t-title mb-2">مقاله‌های مرتبط</h2>
              <ul className="kb-list">
                {v.related.map((r) => (
                  <li key={r.id}>
                    <Link className="ds-link min-w-0" to={`/${orgId}/kb/a/${r.id}`}>
                      {r.title}
                    </Link>
                    {r.internal ? (
                      <Tag className="ms-auto" variant="filled">
                        داخلی
                      </Tag>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </article>
        <aside className="kb-aside" aria-label="فهرست مطالب">
          {slugs.length > 1 ? (
            <>
              <div className="kb-toc-title">در این مقاله</div>
              <Toc toc={v.toc} active={active} />
            </>
          ) : null}
          <div className="mt-6 flex flex-col items-start gap-1">
            <Button size="small" type="text" icon={<Printer {...I14} />} onClick={() => window.print()}>
              چاپ یا PDF
            </Button>
            <Button size="small" type="text" icon={<Link2 {...I14} />} onClick={() => void navigator.clipboard?.writeText(`${window.location.origin}/${orgId}/kb/a/${a.id}`).catch(() => undefined)}>
              رونوشت پیوند
            </Button>
          </div>
          {v.base ? (
            <div className="mt-6 text-[12px] text-ink-3">
              <Tooltip title="همهٔ مقاله‌های این پایگاه">
                <Link to={`/${orgId}/kb/search?base=${v.base.id}`} className="ds-link">
                  {v.base.name}
                </Link>
              </Tooltip>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
