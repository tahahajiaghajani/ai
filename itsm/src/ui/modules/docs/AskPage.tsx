// «پرسش از اسناد» (docs/ask: chosen collections, or one document with ?doc=) and «پرسش از هوش مصنوعی» (ask: every source
// the member may read; ?q= asks right away — the command palette's row). Answers cite their sources; nothing outside the
// member's access is ever searched.
import "../../ai/ask/ask.css";
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { Select } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Card } from "../../components/blocks";
import { AskPanel } from "../../ai/ask/AskPanel";
import { useCollections, type DocumentRow } from "../../ai/ask/api";

export default function AskPage({ mode }: { mode: "docs" | "all" }) {
  const { api, orgId } = useOrg();
  const [sp, setSp] = useSearchParams();
  const collections = useCollections();
  const docId = sp.get("doc");
  const chosen = useMemo(() => (sp.get("collection") ?? "").split(",").filter(Boolean), [sp]);
  const doc = useQuery({
    queryKey: ["ai-rag", orgId, "doc", docId],
    queryFn: () => api.get<{ row: DocumentRow }>(`/r/doc_document/${docId}`),
    enabled: mode === "docs" && !!docId,
  });

  if (mode === "all") {
    return (
      <div>
        <PageHeader title="پرسش از هوش مصنوعی" />
        <Card>
          <AskPanel initialQuestion={sp.get("q") ?? undefined} placeholder="هر پرسشی دربارهٔ رکوردها و اسنادی که به آن‌ها دسترسی دارید…" intro="پاسخ فقط از رکوردها و اسنادی نوشته می‌شود که شما می‌توانید ببینید، با شمارهٔ منبع برای هر جمله." />
        </Card>
      </div>
    );
  }

  const options = (collections.data ?? []).map((c) => ({ value: c.id, label: c.name }));
  // nothing chosen: every document the member may read (the server filters by access; no list of ids to outgrow)
  const scope = docId ? { documents: [docId] } : chosen.length ? { collections: chosen } : { tables: ["doc_document"] };
  const empty = !docId && !options.length;
  return (
    <div>
      <PageHeader title="پرسش از اسناد" back={`/${orgId}/docs`} />
      <Card>
        <div className="mb-3">
          {docId ? (
            <span className="docs-meta">
              فقط در سند «{doc.data?.row.title ?? "…"}»{" "}
              <button type="button" className="ds-link border-0 bg-transparent p-0 text-[12px]" onClick={() => setSp({}, { replace: true })}>
                همهٔ مجموعه‌ها
              </button>
            </span>
          ) : (
            <Select
              mode="multiple"
              className="w-full"
              value={chosen}
              onChange={(v: string[]) => setSp(v.length ? { collection: v.join(",") } : {}, { replace: true })}
              options={options}
              placeholder="همهٔ مجموعه‌هایی که می‌بینید"
              aria-label="مجموعه‌ها"
              allowClear
              showSearch={{ optionFilterProp: "label" }}
              loading={collections.isLoading}
            />
          )}
        </div>
        <AskPanel
          key={docId ?? chosen.join(",")}
          scope={scope}
          placeholder="پرسش خود را دربارهٔ این اسناد بنویسید…"
          disabledReason={empty ? "هنوز مجموعهٔ اسنادی نمی‌بینید؛ اول در «اسناد هوشمند» سند بارگذاری کنید." : null}
          intro="پاسخ فقط از متن همین اسناد نوشته می‌شود؛ هر جمله شمارهٔ منبعش را دارد و با کلیک روی آن، همان بخش سند باز می‌شود."
        />
      </Card>
    </div>
  );
}
