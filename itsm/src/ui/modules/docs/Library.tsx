// «اسناد هوشمند»: the collections the member may read (with their sharing) at the start, the selected collection's
// documents with their reading status, and uploads by drag and drop (one file at a time, each read in the background).
import "../../ai/ask/ask.css";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Dropdown, Table, Upload } from "antd";
import { BookOpenText, FileText, Library as LibraryIcon, Lock, MessageSquareText, MoreHorizontal, Plus, Upload as UploadIcon, Users } from "lucide-react";
import { DOC_LANGS, DOC_SHARING, DOC_STATUSES } from "@shared/tables/docs";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Card } from "../../components/blocks";
import { Chip, EmptyState, JDateTime, Skeleton } from "../../components/display";
import { RAG_KEYS, uploadDocument, useCollections, useDocuments, type DocumentRow } from "../../ai/ask/api";
import { acceptedFile, DOC_ACCEPT, DOC_STATUS_TONE } from "../../ai/ask/model";

const ICON = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const label = (opts: { value: string; label: string }[], v: string | null | undefined) => opts.find((o) => o.value === v)?.label ?? "";

export default function Library() {
  const { orgId, api } = useOrg();
  const navigate = useNavigate();
  const n = useNotify();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const collections = useCollections();
  const list = collections.data ?? [];
  const selected = sp.get("collection") ?? list[0]?.id ?? null;
  const coll = list.find((c) => c.id === selected) ?? null;
  const docs = useDocuments(selected);
  const [uploading, setUploading] = useState(0);
  const rows = docs.data?.rows ?? [];

  const upload = async (file: File) => {
    if (!selected) return;
    if (!acceptedFile(file.name)) {
      n.warn(`«${file.name}» خوانده نمی‌شود؛ PDF، Word، Excel، CSV، متن، HTML یا تصویر بفرستید.`);
      return;
    }
    setUploading((u) => u + 1);
    try {
      await uploadDocument(orgId, selected, file);
      n.ok(`«${file.name}» بارگذاری شد و در حال خواندن است.`);
    } catch (e) {
      n.error(e);
    } finally {
      setUploading((u) => u - 1);
      void qc.invalidateQueries({ queryKey: RAG_KEYS.documents(orgId, selected) });
    }
  };

  const act = async (doc: DocumentRow, what: "reingest" | "delete") => {
    try {
      if (what === "reingest") await api.post(`/ai/docs/${doc.id}/reingest`, {});
      else await api.del(`/ai/docs/${doc.id}`);
      n.ok(what === "reingest" ? "سند دوباره خوانده می‌شود." : "سند حذف شد.");
      void qc.invalidateQueries({ queryKey: RAG_KEYS.documents(orgId, selected) });
    } catch (e) {
      n.error(e);
    }
  };

  const columns = useMemo(
    () => [
      {
        title: "عنوان",
        dataIndex: "title",
        render: (_: unknown, d: DocumentRow) => (
          <Link className="ds-link inline-flex items-center gap-2" to={`/${orgId}/docs/d/${d.id}`}>
            <FileText size={14} strokeWidth={1.4} absoluteStrokeWidth aria-hidden />
            {d.title}
          </Link>
        ),
      },
      {
        title: "وضعیت",
        dataIndex: "status",
        width: 170,
        render: (s: string, d: DocumentRow) => {
          const tone = DOC_STATUS_TONE[s as keyof typeof DOC_STATUS_TONE];
          const text = label(DOC_STATUSES, s) || s;
          return tone ? <Chip tone={tone} title={d.error ?? undefined}>{text}</Chip> : <span className="ds-status">{text}</span>;
        },
      },
      { title: "صفحه", dataIndex: "pages", width: 80, align: "end" as const, render: (p: number | null) => (p ? <span className="ds-num">{fa(p)}</span> : "") },
      { title: "زبان", dataIndex: "language", width: 120, render: (l: string | null) => <span className="docs-meta">{label(DOC_LANGS, l)}</span> },
      { title: "آخرین تغییر", dataIndex: "updated_at", width: 170, render: (v: string) => <JDateTime v={v} /> },
      {
        key: "more",
        width: 48,
        render: (_: unknown, d: DocumentRow) => (
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                { key: "open", label: "باز کردن", onClick: () => navigate(`/${orgId}/docs/d/${d.id}`) },
                { key: "ask", label: "پرسش از این سند", onClick: () => navigate(`/${orgId}/docs/ask?doc=${d.id}`) },
                { key: "reingest", label: "خواندن دوباره", onClick: () => void act(d, "reingest") },
                { type: "divider" as const },
                { key: "delete", label: "حذف", danger: true, onClick: () => void act(d, "delete") },
              ],
            }}
          >
            <Button type="text" size="small" icon={<MoreHorizontal {...ICON} />} aria-label="کارهای سند" />
          </Dropdown>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orgId, selected],
  );

  return (
    <div>
      <PageHeader
        title="اسناد هوشمند"
        actions={
          <>
            <Button icon={<MessageSquareText {...ICON} />} onClick={() => navigate(`/${orgId}/docs/ask${selected ? `?collection=${selected}` : ""}`)} disabled={!list.length}>
              پرسش از اسناد
            </Button>
            <Button type="primary" icon={<Plus {...ICON} />} onClick={() => navigate(`/${orgId}/docs/collections/new`)}>
              مجموعهٔ تازه
            </Button>
          </>
        }
      />
      {collections.isLoading ? (
        <Card>
          <Skeleton rows={6} />
        </Card>
      ) : !list.length ? (
        <Card>
          <EmptyState icon={LibraryIcon} title="هنوز مجموعهٔ اسنادی ندارید" description="یک مجموعه بسازید، اسناد را در آن بیندازید و از آن‌ها بپرسید." action={<Button type="primary" onClick={() => navigate(`/${orgId}/docs/collections/new`)}>مجموعهٔ تازه</Button>} />
        </Card>
      ) : (
        <div className="docs-grid">
          <Card title="مجموعه‌ها" flush>
            <ul className="docs-colls">
              {list.map((c) => (
                <li key={c.id}>
                  <button type="button" className="docs-coll" aria-current={c.id === selected} onClick={() => setSp({ collection: c.id }, { replace: true })}>
                    {c.sharing === "private" ? <Lock size={14} strokeWidth={1.4} absoluteStrokeWidth aria-label="خصوصی" /> : <Users size={14} strokeWidth={1.4} absoluteStrokeWidth aria-label={label(DOC_SHARING, c.sharing)} />}
                    <span className="docs-coll-n">{c.name}</span>
                    {!c.ai_enabled ? <span className="docs-meta">بیرون از هوش مصنوعی</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <Card
            title={coll?.name ?? "اسناد"}
            meta={coll ? <span className="docs-meta">{label(DOC_SHARING, coll.sharing)}</span> : null}
            tools={
              coll ? (
                <Link className="ds-link text-[13px]" to={`/${orgId}/docs/collections/${coll.id}`}>
                  تنظیمات مجموعه
                </Link>
              ) : null
            }
          >
            <Upload.Dragger
              className="docs-drop"
              multiple
              accept={DOC_ACCEPT}
              showUploadList={false}
              disabled={!selected}
              beforeUpload={(file) => {
                void upload(file as unknown as File);
                return false;
              }}
            >
              <div className="flex flex-col items-center gap-1 py-2">
                <UploadIcon size={20} strokeWidth={1.4} absoluteStrokeWidth aria-hidden className="text-ink-3" />
                <div className="docs-drop-t">{uploading ? `در حال بارگذاری ${fa(uploading)} پرونده…` : "پرونده‌ها را اینجا بیندازید یا برای انتخاب کلیک کنید"}</div>
                <div className="docs-meta">PDF، Word، Excel، CSV، متن، Markdown، HTML و تصویر</div>
              </div>
            </Upload.Dragger>
            {docs.isLoading ? (
              <Skeleton rows={4} />
            ) : rows.length ? (
              <Table<DocumentRow> rowKey="id" size="small" columns={columns} dataSource={rows} pagination={rows.length > 50 ? { pageSize: 50, showSizeChanger: false } : false} scroll={{ x: 720 }} />
            ) : (
              <EmptyState compact icon={BookOpenText} title="این مجموعه هنوز سندی ندارد" description="پرونده‌ها را در کادر بالا بیندازید." />
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
