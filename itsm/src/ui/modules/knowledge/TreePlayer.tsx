// «درخت تصمیم» (kb/tree/:id): guided self-help and call scripts. Each node shows its question or guidance (Markdown)
// and its options; an option leads to the next node; a node without options is an outcome — its answer, and the
// article it points to. «بازگشت» and «از نو» walk back; starts and outcomes are counted (drop-off per node is in the
// knowledge event stream). Nodes: `{ id, title?, text?, options?: [{ label, next }], article_id?, outcome? }`.
import "./knowledge.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Space } from "antd";
import { CircleCheck, RotateCcw, Undo2, Signpost } from "lucide-react";
import { useOrg } from "../../lib/org";
import { errorText } from "../../lib/api";
import { PageHeader } from "../../components/layout";
import { Card } from "../../components/blocks";
import { EmptyState, Loader } from "../../components/display";
import { recordsApi } from "../../records";
import { ArticleBody } from "./ArticleBody";
import { kbApi } from "./api";
import { treeNodes, type TreeStep } from "./model";

const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

export default function TreePlayer() {
  const { id = "" } = useParams();
  const { api, orgId } = useOrg();
  const q = useQuery({ queryKey: ["knowledge", orgId, "tree", id], queryFn: () => recordsApi.get(api, "kb_decision_tree", id), retry: false });
  const row = q.data?.row;
  const { nodes, start } = useMemo(() => treeNodes(row?.nodes, row?.start as string | null | undefined), [row]);
  const [path, setPath] = useState<string[]>([]);
  const counted = useRef<{ start: boolean; finish: string | null }>({ start: false, finish: null });
  const current: TreeStep | undefined = nodes.get(path[path.length - 1] ?? start ?? "");
  useEffect(() => {
    if (start && !path.length) setPath([start]);
  }, [start, path.length]);
  useEffect(() => {
    if (!current || !row) return;
    if (!counted.current.start) {
      counted.current.start = true;
      void kbApi.treeEvent(api, id, "start", current.id).catch(() => undefined);
    }
    if (!current.options.length && counted.current.finish !== current.id) {
      counted.current.finish = current.id;
      void kbApi.treeEvent(api, id, "finish", current.id).catch(() => undefined);
    }
  }, [current, row, api, id]);
  if (q.isLoading) return <Loader />;
  if (!row) return <EmptyState icon={Signpost} title="این درخت تصمیم پیدا نشد" description={q.error ? errorText(q.error) : undefined} />;
  return (
    <div>
      <PageHeader title={String(row.title ?? "درخت تصمیم")} back={`/${orgId}/kb`} />
      <Card className="max-w-3xl">
        {row.description && path.length <= 1 ? <p className="mb-4 text-[14px] text-ink-2">{String(row.description)}</p> : null}
        {!current ? (
          <p className="text-[13px] text-ink-3">این درخت هنوز گره‌ای ندارد.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {current.title ? <h2 className="ds-t-section m-0">{current.title}</h2> : null}
            {current.text ? <ArticleBody text={current.text} /> : null}
            {current.options.length ? (
              <div className="flex flex-col gap-2" role="group" aria-label="گزینه‌ها">
                {current.options.map((o, i) => (
                  <Button key={`${o.next}-${i}`} size="large" className="justify-start text-start" disabled={!nodes.has(o.next)} onClick={() => setPath((p) => [...p, o.next])}>
                    {o.label}
                  </Button>
                ))}
              </div>
            ) : (
              <div className="kb-answer">
                <div className="mb-1 flex items-center gap-1.5 text-[13px] text-in">
                  <CircleCheck size={14} strokeWidth={1.4} /> {current.outcome || "پاسخ"}
                </div>
                {current.article_id ? (
                  <Link className="ds-link" to={`/${orgId}/kb/a/${current.article_id}`}>
                    مقالهٔ کامل این راه‌حل
                  </Link>
                ) : null}
              </div>
            )}
            <Space className="border-t border-line pt-3">
              <Button icon={<Undo2 {...I16} />} disabled={path.length <= 1} onClick={() => setPath((p) => p.slice(0, -1))}>
                بازگشت
              </Button>
              <Button icon={<RotateCcw {...I16} />} disabled={path.length <= 1} onClick={() => setPath(start ? [start] : [])}>
                از نو
              </Button>
            </Space>
          </div>
        )}
      </Card>
    </div>
  );
}
