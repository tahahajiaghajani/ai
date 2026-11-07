// A smart document: its text page by page (read by the server, or by a vision model for scans), the cited passage
// highlighted and scrolled into view when the page is opened from an answer (?page=…&hl=<chunk>), the AI summary
// (labelled), and the actions: ask about this document, edit its details, read it again, download the file.
import "../../ai/ask/ask.css";
import { useEffect, useMemo } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "antd";
import { Download, MessageSquareText, Pencil, RefreshCw } from "lucide-react";
import { DOC_LANGS, DOC_STATUSES } from "@shared/tables/docs";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Card, Note } from "../../components/blocks";
import { Chip, EmptyState, Skeleton } from "../../components/display";
import { RAG_KEYS, useDocPages, type DocumentRow } from "../../ai/ask/api";
import { coveredParagraphs, DOC_STATUS_TONE, paragraphs } from "../../ai/ask/model";

const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const label = (opts: { value: string; label: string }[], v: string | null | undefined) => opts.find((o) => o.value === v)?.label ?? "";

export default function Viewer() {
  const { id = "" } = useParams();
  const [sp] = useSearchParams();
  const { api, orgId } = useOrg();
  const navigate = useNavigate();
  const n = useNotify();
  const qc = useQueryClient();
  const chunk = sp.get("hl");
  const wantedPage = Number(sp.get("page")) || null;
  const doc = useQuery({
    queryKey: ["ai-rag", orgId, "doc", id],
    queryFn: () => api.get<{ row: DocumentRow; display: Record<string, string> }>(`/r/doc_document/${id}`),
    refetchInterval: (q) => (q.state.data?.row.status === "ingesting" ? 3000 : false),
  });
  const pages = useDocPages(id, chunk);
  const row = doc.data?.row;
  const hl = pages.data?.highlight ?? null;

  const marked = useMemo(() => {
    const out = new Map<number, Set<number>>();
    if (!hl || !pages.data) return out;
    for (const p of pages.data.pages) {
      if (hl.page !== null && hl.page !== p.page) continue;
      const idx = coveredParagraphs(p.text, hl.text);
      if (idx.length) out.set(p.page, new Set(idx));
    }
    return out;
  }, [hl, pages.data]);

  // open at the cited passage (or the page asked for)
  useEffect(() => {
    if (!pages.data) return;
    const target = document.querySelector(".docv-para.is-hl") ?? (wantedPage ? document.getElementById(`p-${wantedPage}`) : null);
    target?.scrollIntoView({ block: "center" });
  }, [pages.data, marked, wantedPage]);

  const reingest = async () => {
    try {
      await api.post(`/ai/docs/${id}/reingest`, {});
      n.ok("سند دوباره خوانده می‌شود.");
      void qc.invalidateQueries({ queryKey: ["ai-rag", orgId, "doc", id] });
      void qc.invalidateQueries({ queryKey: RAG_KEYS.pages(orgId, id, chunk) });
    } catch (e) {
      n.error(e);
    }
  };

  if (doc.isLoading) {
    return (
      <div>
        <PageHeader title="سند" back={`/${orgId}/docs`} />
        <Card>
          <Skeleton rows={8} />
        </Card>
      </div>
    );
  }
  if (!row) {
    return (
      <div>
        <PageHeader title="سند" back={`/${orgId}/docs`} />
        <Card>
          <EmptyState title="سند پیدا نشد" description="شاید حذف شده باشد یا به مجموعه‌اش دسترسی نداشته باشید." />
        </Card>
      </div>
    );
  }
  const tone = DOC_STATUS_TONE[row.status as keyof typeof DOC_STATUS_TONE];
  const collectionName = doc.data?.display?.[row.collection_id] ?? "";

  return (
    <div>
      <PageHeader
        title={row.title}
        back={`/${orgId}/docs?collection=${row.collection_id}`}
        subtitle={
          <span className="docs-meta">
            {collectionName}
            {row.pages ? ` · ${fa(row.pages)} صفحه` : ""}
            {row.language ? ` · ${label(DOC_LANGS, row.language)}` : ""}
            {row.ocr ? " · خوانده با مدل تصویر" : ""}
          </span>
        }
        actions={
          <>
            <Button icon={<MessageSquareText {...ICON} />} onClick={() => navigate(`/${orgId}/docs/ask?doc=${id}`)} disabled={row.status !== "ready"}>
              پرسش از این سند
            </Button>
            <Button icon={<Pencil {...ICON} />} onClick={() => navigate(`/${orgId}/docs/d/${id}/edit`)} aria-label="ویرایش جزئیات" />
            {row.file_id ? (
              <Button icon={<Download {...ICON} />} href={`/api/o/${orgId}/attachments/${row.file_id}/content`} aria-label="دریافت پرونده" />
            ) : null}
          </>
        }
      />
      {tone && row.status !== "ingesting" ? (
        <Note tone={row.status === "failed" ? "danger" : "warning"} className="mb-4" action={<Button size="small" icon={<RefreshCw size={14} strokeWidth={1.4} absoluteStrokeWidth />} onClick={reingest}>خواندن دوباره</Button>}>
          <b>{label(DOC_STATUSES, row.status)}.</b> {row.error ?? ""}
        </Note>
      ) : null}
      {row.status === "ingesting" ? (
        <Note className="mb-4">
          <b>در حال خواندن سند.</b> متن آن به‌زودی اینجا و در پاسخ‌ها در دسترس است.
        </Note>
      ) : null}
      {row.summary ? (
        <Card title="خلاصه" meta={<Chip tone="accent" dot={false}>نوشتهٔ هوش مصنوعی</Chip>} className="mb-4">
          <p className="docv-para">{row.summary}</p>
        </Card>
      ) : null}
      <Card title="متن سند" meta={tone && row.status === "ingesting" ? <Chip tone="neutral">{label(DOC_STATUSES, row.status)}</Chip> : null}>
        {pages.isLoading ? (
          <Skeleton rows={10} />
        ) : !pages.data?.pages.length ? (
          <EmptyState compact title="متنی برای نمایش نیست" description={row.status === "needs_ocr" ? "این پرونده تصویر یا اسکن است و هنوز خوانده نشده است." : "متن این سند هنوز خوانده نشده است."} />
        ) : (
          pages.data.pages.map((p) => (
            <section key={p.page} id={`p-${p.page}`} className="docv-page" aria-label={`صفحهٔ ${fa(p.page)}`}>
              <div className="docv-page-h">صفحهٔ {fa(p.page)}</div>
              {paragraphs(p.text).map((para, i) => (
                <p key={i} className={`docv-para ${marked.get(p.page)?.has(i) ? "is-hl" : ""}`}>
                  {para}
                </p>
              ))}
            </section>
          ))
        )}
      </Card>
      <div className="mt-3">
        <Link className="ds-link text-[13px]" to={`/${orgId}/docs?collection=${row.collection_id}`}>
          بازگشت به مجموعه
        </Link>
      </div>
    </div>
  );
}
