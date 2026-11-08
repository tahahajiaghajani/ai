// «نمایه و بازیابی» (ai:full): the embedding model of retrieval (a connection with an embedding model, or the built-in
// embedder of basic quality), what the index holds per table and per collection (records, chunks, failures, pending
// vectors, last run), the vector backend in use, rebuild and reconcile buttons, the switches (re-ranking, summaries of
// uploads, passages per answer) and a test box that shows what the CURRENT member would get, with citations.
import "../ask/ask.css";
import { useEffect, useState, type ReactNode } from "react";
import { Button, InputNumber, Select, Switch, Table, Input } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Search } from "lucide-react";
import type { AiConnectionPublic, AiSettings } from "@shared/ai/types";
import type { AiRagTableStatus, AiRetrieveResult } from "@shared/ai/rag";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { fa } from "../../lib/fa";
import { Card, Note } from "../../components/blocks";
import { Chip, JDateTime, Skeleton } from "../../components/display";
import { useAiInvalidate } from "../kit/hooks";
import { RAG_KEYS, useRagStatus } from "../ask/api";
import { backendLabel, citationLabel, qualityLabel, runLabel, runStats } from "../ask/model";

const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

function Row({ title, about, children }: { title: string; about: ReactNode; children: ReactNode }) {
  return (
    <label className="ai-sw-r">
      <div>
        <div className="ai-sw-t">{title}</div>
        <div className="ai-sw-d">{about}</div>
      </div>
      {children}
    </label>
  );
}

export function RetrievalTab({ settings, connections }: { settings: AiSettings; connections: AiConnectionPublic[] }) {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const refresh = useAiInvalidate();
  const status = useRagStatus();
  const [rag, setRag] = useState(settings.rag);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<AiRetrieveResult | null>(null);
  useEffect(() => setRag(settings.rag), [settings.rag]);
  const dirty = JSON.stringify(rag) !== JSON.stringify(settings.rag);
  const embedders = connections.filter((c) => c.embed?.model);
  const st = status.data;

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/ai/settings", { rag });
      n.ok("تنظیمات نمایه و بازیابی ذخیره شد.");
      refresh();
      void qc.invalidateQueries({ queryKey: RAG_KEYS.status(orgId) });
    } catch (e) {
      n.error(e);
    } finally {
      setSaving(false);
    }
  };

  const run = async (path: string, body: Record<string, unknown>, ok: string) => {
    try {
      await api.post(path, body);
      n.ok(ok);
      void qc.invalidateQueries({ queryKey: RAG_KEYS.status(orgId) });
    } catch (e) {
      n.error(e);
    }
  };

  const tryIt = async () => {
    if (query.trim().length < 2) return;
    setTesting(true);
    try {
      setTest(await api.post<AiRetrieveResult>("/ai/retrieve", { query: query.trim(), k: 8 }));
    } catch (e) {
      n.error(e);
    } finally {
      setTesting(false);
    }
  };

  const columns = [
    { title: "منبع", dataIndex: "label", render: (v: string, r: AiRagTableStatus) => <span title={r.table}>{v}</span> },
    { title: "رکورد", dataIndex: "documents", width: 90, align: "end" as const, render: (v: number) => <span className="ds-num">{fa(v)}</span> },
    { title: "قطعه", dataIndex: "chunks", width: 90, align: "end" as const, render: (v: number) => <span className="ds-num">{fa(v)}</span> },
    {
      title: "وضعیت",
      key: "state",
      width: 200,
      render: (_: unknown, r: AiRagTableStatus) =>
        r.errors ? <Chip tone="danger" title={r.last_error ?? undefined}>{`${fa(r.errors)} خطا`}</Chip> : r.pending ? <Chip tone="warning">{`${fa(r.pending)} در انتظار بردار`}</Chip> : <span className="ds-status">سالم</span>,
    },
    { title: "آخرین نمایه", dataIndex: "last_indexed_at", width: 170, render: (v: string | null) => (v ? <JDateTime v={v} /> : "—") },
    {
      key: "rebuild",
      width: 110,
      render: (_: unknown, r: AiRagTableStatus) => (
        <Button size="small" type="text" onClick={() => void run("/ai/rag/rebuild", { table: r.table }, `بازسازی «${r.label}» در صف قرار گرفت.`)}>
          بازسازی
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {!settings.rag.enabled ? (
        <Note tone="warning">
          <b>نمایه خاموش است.</b> پاسخ‌های مستند و «پرسش از اسناد» تا روشن شدن آن چیزی پیدا نمی‌کنند.
        </Note>
      ) : null}
      <Card title="بردارسازی و جست‌وجو">
        {!st ? (
          <Skeleton rows={3} />
        ) : (
          <div className="ai-sw">
            <Row title="کیفیت جست‌وجو" about={st.embedder.problem ? `مشکل: ${st.embedder.problem}` : st.embedder.quality === "provider" ? `از اتصال «${st.embedder.connection_label ?? ""}»` : "بی‌مدل و بی‌اینترنت کار می‌کند؛ برای جست‌وجوی معنایی، در یکی از اتصال‌ها «مدل بردارسازی» بگذارید."}>
              {st.embedder.quality === "provider" ? <span className="ds-status">{qualityLabel(st)}</span> : <Chip tone="neutral">{qualityLabel(st)}</Chip>}
            </Row>
            <Row title="پایگاه بردارها" about={st.backend.reason && st.backend.kind === "portable" ? `pgvector در دسترس نیست (${st.backend.reason})` : "جست‌وجوی نزدیک‌ترین بردارها در خود پایگاه داده"}>
              <span className="ds-status ds-latin">{backendLabel(st)}</span>
            </Row>
            {st.pending_vectors ? (
              <Row title="بردارهای در انتظار" about="پس از تغییر مدل یا سقف سرویس، بردارها در پس‌زمینه ساخته می‌شوند؛ تا آن زمان جست‌وجوی واژه‌ای و بردارساز داخلی پاسخ می‌دهند.">
                <span className="ds-num">{fa(st.pending_vectors)}</span>
              </Row>
            ) : null}
          </div>
        )}
      </Card>

      <Card
        title="تنظیمات"
        tools={
          <Button type="primary" size="small" onClick={save} loading={saving} disabled={!dirty}>
            ذخیره
          </Button>
        }
      >
        <div className="ai-sw">
          <Row title="نمایه روشن است" about="رکوردها و اسناد نمایه می‌شوند و پاسخ‌های هوش مصنوعی می‌توانند به آن‌ها ارجاع دهند.">
            <Switch checked={rag.enabled} onChange={(v) => setRag({ ...rag, enabled: v })} aria-label="نمایه روشن است" />
          </Row>
          <Row title="اتصال بردارسازی" about="خودکار: نخستین اتصال فعالی که مدل بردارسازی دارد. با عوض شدن مدل، همهٔ قطعه‌ها در پس‌زمینه دوباره بردارسازی می‌شوند.">
            <Select
              className="min-w-[220px]"
              value={rag.embed_connection_id ?? ""}
              onChange={(v: string) => setRag({ ...rag, embed_connection_id: v || null })}
              options={[{ value: "", label: "خودکار" }, ...embedders.map((c) => ({ value: c.id, label: `${c.label} — ${c.embed!.model}` }))]}
              aria-label="اتصال بردارسازی"
            />
          </Row>
          <Row title="مرتب‌سازی دوباره با مدل سریع" about="پیش از هر پاسخ، مدل سریع بخش‌های پیداشده را به‌ترتیب ارتباط می‌چیند؛ یک درخواست بیشتر برای هر پرسش.">
            <Switch checked={rag.rerank} onChange={(v) => setRag({ ...rag, rerank: v })} aria-label="مرتب‌سازی دوباره" />
          </Row>
          <Row title="خلاصهٔ اسناد بارگذاری‌شده" about="برای هر سندی که بارگذاری می‌شود، مدل سریع خلاصه‌ای کوتاه می‌نویسد.">
            <Switch checked={rag.summaries} onChange={(v) => setRag({ ...rag, summaries: v })} aria-label="خلاصهٔ اسناد" />
          </Row>
          <Row title="بخش‌های هر پاسخ" about="شمار بخش‌هایی که هر پاسخ از آن‌ها نوشته می‌شود.">
            <InputNumber min={2} max={20} value={rag.top_k} onChange={(v) => setRag({ ...rag, top_k: Number(v) || 8 })} aria-label="بخش‌های هر پاسخ" />
          </Row>
        </div>
      </Card>

      <Card
        title="نمایه"
        tools={
          <span className="flex gap-2">
            <Button size="small" icon={<RefreshCw size={14} strokeWidth={1.4} absoluteStrokeWidth />} onClick={() => void run("/ai/rag/reconcile", {}, "تطبیق نمایه با رکوردها در صف قرار گرفت.")}>
              تطبیق
            </Button>
            <Button size="small" onClick={() => void run("/ai/rag/rebuild", {}, "بازسازی کامل نمایه در صف قرار گرفت.")}>
              بازسازی همه
            </Button>
          </span>
        }
        flush
      >
        {!st ? <Skeleton rows={4} /> : <Table<AiRagTableStatus> rowKey="table" size="small" columns={columns} dataSource={st.tables} pagination={false} scroll={{ x: 760 }} />}
      </Card>

      {st?.collections.length ? (
        <Card title="مجموعه‌های اسناد" flush>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={st.collections}
            columns={[
              { title: "مجموعه", dataIndex: "name" },
              { title: "سند", dataIndex: "documents", width: 90, align: "end" as const, render: (v: number) => <span className="ds-num">{fa(v)}</span> },
              { title: "آماده", dataIndex: "ready", width: 90, align: "end" as const, render: (v: number) => <span className="ds-num">{fa(v)}</span> },
              { title: "ناخوانده", dataIndex: "failed", width: 100, align: "end" as const, render: (v: number) => (v ? <Chip tone="warning" fig>{fa(v)}</Chip> : <span className="ds-num">{fa(0)}</span>) },
              { title: "قطعه", dataIndex: "chunks", width: 90, align: "end" as const, render: (v: number) => <span className="ds-num">{fa(v)}</span> },
            ]}
          />
        </Card>
      ) : null}

      <Card title="آزمایش بازیابی" meta={<span className="docs-meta">آنچه شما با دسترسی خودتان می‌گیرید</span>}>
        <div className="ask-box mb-3">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} onPressEnter={tryIt} placeholder="یک پرسش بنویسید…" aria-label="پرسش آزمایشی" />
          <Button icon={<Search {...ICON} />} onClick={tryIt} loading={testing}>
            جست‌وجو
          </Button>
        </div>
        {test ? (
          <>
            <div className="docs-meta mb-2">
              {`${fa(test.passages.length)} بخش · ${test.info.quality === "provider" ? "بردار مدل" : "جست‌وجوی پایه"} · ${fa(test.info.ms)} میلی‌ثانیه · واژه‌ها ${fa(test.info.lists.fts)}، بردار ${fa(test.info.lists.vector)}، بردار داخلی ${fa(test.info.lists.local)}`}
            </div>
            <ol className="ask-sources">
              {test.passages.map((p) => (
                <li key={p.chunk_id}>
                  <a className="ask-src" href={`/${orgId}/${p.citation.path}`}>
                    <span className="ask-src-n ds-num">{fa(p.n)}</span>
                    <span className="ask-src-b">
                      <span className="ask-src-t">{p.citation.title}</span>
                      <span className="ask-src-m">{citationLabel(p.citation)}</span>
                      <span className="ask-src-x">{p.text.replace(/\s+/g, " ").slice(0, 240)}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ol>
          </>
        ) : null}
      </Card>

      {st?.runs.length ? (
        <Card title="آخرین اجراها" flush>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={st.runs}
            columns={[
              { title: "کار", dataIndex: "kind", render: (k: string) => runLabel(k) },
              { title: "شروع", dataIndex: "started_at", width: 170, render: (v: string) => <JDateTime v={v} /> },
              { title: "پایان", dataIndex: "finished_at", width: 170, render: (v: string | null) => (v ? <JDateTime v={v} /> : <Chip tone="neutral">در حال اجرا</Chip>) },
              { title: "نتیجه", dataIndex: "stats", render: (s: Record<string, number>) => <span className="docs-meta">{runStats(s)}</span> },
            ]}
          />
        </Card>
      ) : null}
    </div>
  );
}
