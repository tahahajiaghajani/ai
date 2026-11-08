// «میز مدیر دانش» (kb/workspace): what needs a knowledge manager today — insight cards (reviews due, expiring,
// flagged, unhealthy, duplicates, gaps, open tasks), the queues behind them (articles about to expire, flagged and
// unhealthy articles with the next best action, duplicate pairs to merge, knowledge gaps by demand, versions waiting
// for review, open knowledge tasks), the built-in knowledge routines with how far they are met, re-owning the articles
// of someone who left, running the checks now, and — when the AI layer adds them — the curator's suggestions.
import "./knowledge.css";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Dropdown, Modal, Progress, Select, Space } from "antd";
import { ArrowLeftRight, FileUp, GitMerge, PlayCircle, UserRoundCog } from "lucide-react";
import type { KbCard } from "@shared/knowledge/api";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { PageHeader } from "../../components/layout";
import { Card } from "../../components/blocks";
import { EmptyState, JDate, Loader, StatCard } from "../../components/display";
import { recordPath, RecordSelect } from "../../records";
import { importFiles, KB_KEYS, kbApi, useKbHome, useKbRefresh, type ImportResult } from "./api";
import { faNum } from "./model";

const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const ACTION: Record<string, string> = { none: "—", review: "بازبینی", update: "اصلاح", merge: "ادغام", retire: "بازنشستگی", translate: "ترجمه" };

function Articles({ items, extra }: { items: (KbCard & { health_score?: number | null; next_action?: string | null })[]; extra?: (a: KbCard & { health_score?: number | null; next_action?: string | null }) => React.ReactNode }) {
  const { orgId } = useOrg();
  if (!items.length) return <p className="text-[13px] text-ink-3">موردی نیست.</p>;
  return (
    <ul className="kb-list">
      {items.map((a) => (
        <li key={a.id}>
          <Link className="ds-link min-w-0 flex-1 truncate" to={`/${orgId}/kb/a/${a.id}`}>
            {a.title}
          </Link>
          {extra ? <span className="shrink-0 text-[12px] text-ink-3">{extra(a)}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** «درون‌ریزی»: Markdown, text, HTML, Word and PDF files become drafts of a base (titles from the first heading). */
function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { orgId } = useOrg();
  const nav = useNavigate();
  const home = useKbHome();
  const refresh = useKbRefresh();
  const bases = (home.data?.bases ?? []).filter((b) => b.contribute);
  const [base, setBase] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const run = useAction(() => importFiles(orgId, (base ?? bases[0]?.id)!, files), {
    onSuccess: (r) => {
      setResult(r);
      setFiles([]);
      void refresh();
    },
  });
  const close = () => {
    setResult(null);
    setFiles([]);
    onClose();
  };
  return (
    <Modal open={open} title="درون‌ریزی مقاله‌ها" okText="درون‌ریزی" cancelText="بستن" onOk={() => run.mutate()} okButtonProps={{ disabled: !files.length || !(base ?? bases[0]?.id) }} confirmLoading={run.isPending} onCancel={close} destroyOnHidden>
      <div className="flex flex-col gap-3">
        <Select className="w-full" value={base ?? bases[0]?.id} onChange={setBase} options={bases.map((b) => ({ value: b.id, label: b.name }))} aria-label="پایگاه دانش" />
        <label className="flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed border-line-2 px-4 py-6 text-center text-[13px] text-ink-2 hover:border-line-3">
          <FileUp size={20} strokeWidth={1.4} className="text-ink-3" />
          {files.length ? `${faNum(files.length)} پرونده انتخاب شد` : "پرونده‌های Markdown، متن، HTML، Word یا PDF (تا ۲۰ پرونده، روی هم ۲۰ مگابایت)"}
          <input type="file" multiple accept=".md,.markdown,.txt,.html,.htm,.docx,.pdf" className="hidden" onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, 20))} />
        </label>
        <p className="m-0 text-[12px] text-ink-3">هر پرونده پیش‌نویسی تازه می‌شود؛ عنوان از نخستین سرتیتر یا نام پرونده است. پیش از انتشار آن‌ها را بخوانید.</p>
        {result ? (
          <div className="flex flex-col gap-1 text-[13px]">
            {result.created.map((c) => (
              <button key={c.id} type="button" className="ds-link border-0 bg-transparent p-0 text-start" onClick={() => (close(), nav(`/${orgId}/kb/a/${c.id}`))}>
                ✓ {c.title}
              </button>
            ))}
            {result.failed.map((f) => (
              <span key={f.name} className="text-danger">
                ✕ {f.name}: {f.message}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

export default function Workspace() {
  const { api, orgId } = useOrg();
  const nav = useNavigate();
  const refresh = useKbRefresh();
  const w = useQuery({ queryKey: KB_KEYS.workspace(orgId), queryFn: () => kbApi.workspace(api), retry: false });
  const [reown, setReown] = useState(false);
  const [importing, setImporting] = useState(false);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const sweep = useAction(() => kbApi.sweep(api), { success: "بررسی‌های دانش اجرا شد", onSuccess: () => void refresh() });
  const merge = useAction((a: { id: string; keep: "a" | "b" }) => kbApi.mergeDuplicate(api, a.id, a.keep), { success: "ادغام شد: مقالهٔ دیگر با جایگزین بازنشسته شد", onSuccess: () => void refresh() });
  const move = useAction(() => kbApi.reown(api, from!, to!), {
    success: (d) => `${faNum(d.moved)} مقاله به مالک تازه رسید`,
    onSuccess: () => {
      setReown(false);
      void refresh();
    },
  });
  if (w.isLoading) return <Loader />;
  if (w.error || !w.data)
    return (
      <div>
        <PageHeader title="میز مدیر دانش" />
        <EmptyState title="این صفحه برای مدیران دانش است" description={w.error ? errorText(w.error) : undefined} />
      </div>
    );
  const d = w.data;
  return (
    <div>
      <PageHeader
        title="میز مدیر دانش"
        actions={
          <Space>
            <Button icon={<FileUp {...I16} />} onClick={() => setImporting(true)}>
              درون‌ریزی
            </Button>
            <Button icon={<UserRoundCog {...I16} />} onClick={() => setReown(true)}>
              انتقال مالکیت
            </Button>
            <Button icon={<PlayCircle {...I16} />} onClick={() => sweep.mutate()} loading={sweep.isPending}>
              اجرای بررسی‌ها
            </Button>
          </Space>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {d.cards.map((c) => (
          <StatCard
            key={c.key}
            title={c.label}
            value={<span className={`ds-num ${c.tone === "danger" && c.count ? "text-danger" : ""}`}>{faNum(c.count)}</span>}
            onClick={c.path ? () => (c.path.startsWith("kb/workspace#") ? document.getElementById(c.path.split("#")[1])?.scrollIntoView({ behavior: "smooth" }) : nav(`/${orgId}/${c.path}`)) : undefined}
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="منتظر بازبینی شما">
          {d.reviews.length ? (
            <ul className="kb-list">
              {d.reviews.map((r) => (
                <li key={r.id}>
                  <Link className="ds-link min-w-0 flex-1 truncate" to={`/${orgId}/kb/diff?article=${r.article_id}&b=${r.id}`}>
                    {r.title}
                  </Link>
                  <span className="shrink-0 text-[12px] text-ink-3">
                    <bdi className="ds-num">{faNum(r.version_label ?? "")}</bdi> {r.submitted_at ? <JDate v={r.submitted_at} /> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-3">نسخه‌ای منتظر شما نیست.</p>
          )}
        </Card>
        <Card title="کارهای دانش">
          {d.tasks.length ? (
            <ul className="kb-list">
              {d.tasks.map((t) => (
                <li key={t.id}>
                  <Link className="ds-link min-w-0 flex-1 truncate" to={`/${orgId}/${recordPath("kb_task", t.id)}`}>
                    <bdi className="ds-num">{t.number}</bdi> {t.short_description}
                  </Link>
                  {t.sla_due ? (
                    <span className="shrink-0 text-[12px] text-ink-3">
                      مهلت <JDate v={t.sla_due} />
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-3">کار بازی نیست.</p>
          )}
        </Card>
        <div id="expiring" className="scroll-mt-20">
          <Card title="نزدیک به پایان اعتبار">
            <Articles items={d.expiring} />
          </Card>
        </div>
        <div id="flagged" className="scroll-mt-20">
          <Card title="گزارش‌شده از سوی خوانندگان">
            <Articles items={d.flagged} />
          </Card>
        </div>
        <Card title="ناسالم‌ترین مقاله‌ها">
          <Articles items={d.unhealthy} extra={(a) => <>سلامت <span className="ds-num">{faNum(a.health_score ?? 0)}</span>، {ACTION[a.next_action ?? "none"] ?? a.next_action}</>} />
        </Card>
        <Card title="احتمالاً تکراری">
          {d.duplicates.length ? (
            <ul className="flex flex-col gap-2">
              {d.duplicates.map((x) => (
                <li key={x.id} className="rounded-md bg-sunken px-2.5 py-2 text-[13px]">
                  <div className="flex flex-col gap-0.5">
                    {x.a ? <Link className="ds-link truncate" to={`/${orgId}/kb/a/${x.a.id}`}>{x.a.title}</Link> : null}
                    {x.b ? <Link className="ds-link truncate" to={`/${orgId}/kb/a/${x.b.id}`}>{x.b.title}</Link> : null}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[12px] text-ink-3">
                      همانندی <span className="ds-num">{faNum(x.similarity)}</span>٪
                    </span>
                    {x.a && x.b ? (
                      <Dropdown
                        trigger={["click"]}
                        menu={{
                          items: [
                            { key: "a", label: `«${x.a.title.slice(0, 50)}» بماند` },
                            { key: "b", label: `«${x.b.title.slice(0, 50)}» بماند` },
                          ],
                          onClick: ({ key }) => merge.mutate({ id: x.id, keep: key as "a" | "b" }),
                        }}
                      >
                        <Button size="small" icon={<GitMerge size={14} strokeWidth={1.4} />} className="ms-auto" loading={merge.isPending && merge.variables?.id === x.id}>
                          ادغام…
                        </Button>
                      </Dropdown>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-3">جفت تکراری پیدا نشد.</p>
          )}
        </Card>
        <Card title="کمبودهای دانش">
          {d.gaps.length ? (
            <ul className="kb-list">
              {d.gaps.map((g) => (
                <li key={g.id}>
                  <Link className="ds-link min-w-0 flex-1 truncate" to={`/${orgId}/${recordPath("kb_gap", g.id)}`}>
                    {g.title}
                  </Link>
                  <span className="shrink-0 text-[12px] text-ink-3">
                    <span className="ds-num">{faNum(g.demand)}</span> بار
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-3">کمبودی گزارش نشده است.</p>
          )}
        </Card>
        <Card title="روال‌های دانش">
          <ul className="flex flex-col gap-3">
            {d.routines.map((r) => (
              <li key={r.key} className="text-[13px]">
                <div className="mb-1 flex items-center gap-2">
                  <span className="min-w-0 flex-1 text-ink">{r.label}</span>
                  <span className="ds-num shrink-0 text-ink-3">
                    {faNum(r.met)} از {faNum(r.total)}
                  </span>
                </div>
                <Progress percent={r.total ? Math.round((100 * r.met) / r.total) : 100} showInfo={false} size="small" strokeColor="var(--ds-chart-1)" />
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {d.ai.length ? (
        <Card title="پیشنهادهای دستیار دانش" className="mt-5">
          <ul className="m-0 flex list-disc flex-col gap-1 ps-5 text-[13px] text-ink-2">
            {d.ai.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </Card>
      ) : null}
      <ImportDialog open={importing} onClose={() => setImporting(false)} />
      <Modal open={reown} title="انتقال مالکیت مقاله‌ها" okText="انتقال" cancelText="انصراف" okButtonProps={{ disabled: !from || !to || from === to, icon: <ArrowLeftRight size={14} strokeWidth={1.4} /> }} onOk={() => move.mutate()} confirmLoading={move.isPending} onCancel={() => setReown(false)} destroyOnHidden>
        <div className="flex flex-col gap-3">
          <RecordSelect table="user" value={from} onChange={(v) => setFrom((v as string) || null)} placeholder="مالک کنونی (مثلاً همکاری که رفته است)" />
          <RecordSelect table="user" value={to} onChange={(v) => setTo((v as string) || null)} placeholder="مالک تازه" />
        </div>
      </Modal>
    </div>
  );
}
